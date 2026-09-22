import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  activeLeaseOwner,
  buildRelevanceBatch,
  createCursor,
  encodeCursor,
  expiredRelevanceIds,
  normalizeBatchSize,
  parseCursorInput,
  persistRelevanceBatch,
  planRelevancePersistence,
  RELEVANCE_WINDOW_HOURS,
  type RelevanceRow,
} from "./relevance.ts";

const LEASE_MS = 3 * 60 * 1000;
const CLEANUP_PAGE_SIZE = 1000;
const DELETE_CHUNK_SIZE = 200;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SECRET_KEYS = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const SECRET = SECRET_KEYS.default ||
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_TOKEN_SHA256 =
  "effaf6f60c8e45cc921f5a4137a9483e78432fbfe7e2df99d485fb79230d483d";

async function rest(path: string, init: RequestInit = {}) {
  if (!SECRET) throw new Error("server secret unavailable");
  const headers = new Headers(init.headers);
  headers.set("apikey", SECRET);
  headers.set("Authorization", `Bearer ${SECRET}`);
  headers.set("Content-Type", "application/json");
  const response = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function authorizedCronRequest(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7).trim();
  if (!token) return false;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hex = [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return hex === CRON_TOKEN_SHA256;
}

async function startRun(metadata: Record<string, unknown>) {
  const rows = await rest("collector_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ source: "relevance", status: "running", metadata }),
  });
  const id = Number(rows?.[0]?.id);
  if (!Number.isSafeInteger(id)) throw new Error("failed to create relevance run");
  return id;
}

async function finishRun(
  id: number,
  status: "success" | "error",
  items: number,
  metadata: Record<string, unknown>,
  error?: unknown,
) {
  await rest(`collector_runs?id=eq.${id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      status,
      finished_at: new Date().toISOString(),
      items_fetched: items,
      ...(error ? { error_message: String(error) } : {}),
      metadata,
    }),
  });
}

async function acquireLease(metadata: Record<string, unknown>) {
  const now = Date.now();
  const id = await startRun({
    ...metadata,
    lease_expires_at: new Date(now + LEASE_MS).toISOString(),
  });
  const running = await rest(
    "collector_runs?select=id,metadata&source=eq.relevance&status=eq.running&order=id.asc",
    { method: "GET" },
  );
  const owner = activeLeaseOwner(running || [], now);
  if (owner !== id) {
    await finishRun(id, "success", 0, { ...metadata, skipped: "overlap" });
    return null;
  }
  return id;
}

const RELEVANCE_SELECT =
  "id,subject_type,topic_id,cluster_key,relevance_domain,category_key,relevance_score,relevance_level,matched_rule_ids,matched_terms,matched_entity_ids,evidence,evaluated_at";

function quotedInValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function existingRowsForBatch(topicIds: number[], clusterKeys: string[]) {
  const requests: Promise<any>[] = [];
  if (topicIds.length) {
    requests.push(
      rest(
        `relevance_results?select=${RELEVANCE_SELECT}&topic_id=in.(${
          topicIds.join(",")
        })`,
        { method: "GET" },
      ),
    );
  }
  if (clusterKeys.length) {
    const values = encodeURIComponent(
      `(${clusterKeys.map(quotedInValue).join(",")})`,
    );
    requests.push(
      rest(
        `relevance_results?select=${RELEVANCE_SELECT}&cluster_key=in.${values}`,
        { method: "GET" },
      ),
    );
  }
  return (await Promise.all(requests)).flat();
}

async function allRelevanceSubjects() {
  const rows: RelevanceRow[] = [];
  for (let offset = 0;; offset += CLEANUP_PAGE_SIZE) {
    const page = await rest(
      `relevance_results?select=id,subject_type,topic_id,cluster_key&order=id.asc&limit=${CLEANUP_PAGE_SIZE}&offset=${offset}`,
      { method: "GET" },
    );
    rows.push(...(page || []));
    if (!page || page.length < CLEANUP_PAGE_SIZE) return rows;
  }
}

async function deleteRelevanceIds(ids: number[]) {
  for (let offset = 0; offset < ids.length; offset += DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + DELETE_CHUNK_SIZE);
    await rest(`relevance_results?id=in.(${chunk.join(",")})`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!(await authorizedCronRequest(req))) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // Empty bodies use safe defaults.
  }
  const limit = normalizeBatchSize(body.limit);
  const parsedCursor = parseCursorInput(body.cursor);
  if (!parsedCursor.valid) {
    return Response.json({ ok: false, error: "invalid cursor" }, { status: 400 });
  }
  const suppliedCursor = parsedCursor.cursor;
  const cutoff = suppliedCursor?.cutoff ||
    new Date(Date.now() - RELEVANCE_WINDOW_HOURS * 60 * 60 * 1000)
      .toISOString();
  const lastId = suppliedCursor?.lastId || 0;
  let runId: number | null = null;

  try {
    runId = await acquireLease({ cursor: body.cursor || null, limit, cutoff });
    if (runId == null) {
      return Response.json({ ok: false, status: "busy", retryable: true }, {
        status: 409,
      });
    }
    const maxIdFilter = suppliedCursor ? `&id=lte.${suppliedCursor.maxId}` : "";
    const [allRules, entities, topics] = await Promise.all([
      rest(
        "watch_rules?select=id,rule_type,value,relevance_domain,category_key,match_terms,strong_terms,enabled&enabled=eq.true",
        { method: "GET" },
      ),
      rest(
        "relevance_entities?select=id,relevance_domain,category_key,entity_value,relevance_level,enabled&enabled=eq.true",
        { method: "GET" },
      ),
      rest(
        `trend_topics?select=id,title,cluster_key,cluster_label,last_seen_at&last_seen_at=gte.${
          encodeURIComponent(cutoff)
        }${maxIdFilter}&order=id.asc`,
        { method: "GET" },
      ),
    ]);
    const rules = (allRules || []).filter((rule: any) =>
      rule.rule_type === "industry"
    );
    const excludes = (allRules || []).filter((rule: any) =>
      rule.rule_type === "exclude"
    );
    if (rules.length === 0 && (entities || []).length === 0) {
      throw new Error("no enabled relevance definitions");
    }
    const runCursor = suppliedCursor || createCursor(cutoff, topics || []);
    const batch = buildRelevanceBatch({
      topics: topics || [],
      rules,
      entities: entities || [],
      excludes,
      cursor: lastId,
      limit,
    });
    const existingRows = await existingRowsForBatch(
      batch.selectedTopicIds,
      batch.clusterKeys,
    );
    const plan = planRelevancePersistence(
      existingRows || [],
      batch.rows,
      batch.selectedTopicIds,
      batch.clusterKeys,
    );
    await persistRelevanceBatch(plan, {
      async upsertById(rows: RelevanceRow[]) {
        await rest("relevance_results?on_conflict=id", {
          method: "POST",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(rows),
        });
      },
      async insert(rows: RelevanceRow[]) {
        await rest("relevance_results", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(rows),
        });
      },
      async deleteByIds(ids: number[]) {
        await deleteRelevanceIds(ids);
      },
    });
    let removedExpired = 0;
    if (!batch.hasMore) {
      const existingSubjects = await allRelevanceSubjects();
      const activeTopicIds = (topics || []).map((topic: any) => Number(topic.id));
      const activeClusterKeys: string[] = [...new Set<string>(
        (topics || []).map((topic: any) => String(topic.cluster_key || ""))
          .filter(Boolean),
      )];
      const expiredIds = expiredRelevanceIds(
        existingSubjects,
        activeTopicIds,
        activeClusterKeys,
      );
      await deleteRelevanceIds(expiredIds);
      removedExpired = expiredIds.length;
    }
    const nextCursor = batch.hasMore
      ? encodeCursor({ ...runCursor, lastId: batch.nextCursor })
      : null;
    const result = {
      status: "success",
      selected: batch.selected,
      processed_clusters: batch.clusterKeys.length,
      results: batch.rows.length,
      updated: plan.updates.length,
      inserted: plan.inserts.length,
      removed_stale: plan.staleIds.length,
      removed_expired: removedExpired,
      next_cursor: nextCursor,
      cursor_last_id: batch.nextCursor,
      has_more: batch.hasMore,
      remaining: batch.remaining,
      limit,
      window_hours: RELEVANCE_WINDOW_HOURS,
    };
    await finishRun(runId, "success", batch.rows.length, result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    if (runId != null) {
      await finishRun(runId, "error", 0, {
        cursor: body.cursor || null,
        limit,
        window_hours: RELEVANCE_WINDOW_HOURS,
      }, error).catch(() => {});
    }
    return Response.json({
      ok: false,
      error: String(error),
      cursor: body.cursor || null,
      limit,
    }, {
      status: 500,
    });
  }
});
