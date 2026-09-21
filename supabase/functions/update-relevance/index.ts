import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  buildRelevanceBatch,
  normalizeBatchSize,
  persistRelevanceBatch,
  planRelevancePersistence,
  RELEVANCE_WINDOW_HOURS,
  type RelevanceRow,
} from "./relevance.ts";

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

async function recordRun(
  status: "success" | "error",
  items: number,
  metadata: Record<string, unknown>,
  error?: unknown,
) {
  await rest("collector_runs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      source: "relevance",
      status,
      finished_at: new Date().toISOString(),
      items_fetched: items,
      ...(error ? { error_message: String(error) } : {}),
      metadata,
    }),
  });
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
  const cursor = Math.max(0, Math.trunc(Number(body.cursor || 0)));
  const cutoff = new Date(Date.now() - RELEVANCE_WINDOW_HOURS * 60 * 60 * 1000)
    .toISOString();

  try {
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
        }&order=id.asc`,
        { method: "GET" },
      ),
    ]);
    const rules = (allRules || []).filter((rule: any) =>
      rule.rule_type === "industry"
    );
    const excludes = (allRules || []).filter((rule: any) =>
      rule.rule_type === "exclude"
    );
    const batch = buildRelevanceBatch({
      topics: topics || [],
      rules,
      entities: entities || [],
      excludes,
      cursor,
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
        await rest(`relevance_results?id=in.(${ids.join(",")})`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        });
      },
    });
    const result = {
      status: "success",
      selected: batch.selected,
      processed_clusters: batch.clusterKeys.length,
      results: batch.rows.length,
      updated: plan.updates.length,
      inserted: plan.inserts.length,
      removed_stale: plan.staleIds.length,
      next_cursor: batch.nextCursor,
      has_more: batch.hasMore,
      remaining: batch.remaining,
      limit,
      window_hours: RELEVANCE_WINDOW_HOURS,
    };
    await recordRun("success", batch.rows.length, result);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    await recordRun("error", 0, {
      cursor,
      limit,
      window_hours: RELEVANCE_WINDOW_HOURS,
    }, error).catch(() => {});
    return Response.json({ ok: false, error: String(error), cursor, limit }, {
      status: 500,
    });
  }
});
