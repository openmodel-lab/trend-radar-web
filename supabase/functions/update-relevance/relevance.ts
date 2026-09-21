export const RELEVANCE_WINDOW_HOURS = 24;
export const DEFAULT_BATCH_SIZE = 75;
export const MAX_BATCH_SIZE = 100;

export type Topic = {
  id: number;
  title: string;
  cluster_key: string | null;
  cluster_label: string | null;
  last_seen_at?: string;
};

export type RelevanceRow = {
  id?: number;
  subject_type: "topic" | "cluster";
  topic_id: number | null;
  cluster_key: string | null;
  relevance_domain: string;
  category_key: string;
  relevance_score: number;
  relevance_level: string;
  matched_rule_ids: number[];
  matched_terms: string[];
  matched_entity_ids: number[];
  evidence: Record<string, unknown>;
  evaluated_at: string;
};

export type PersistencePlan = {
  updates: RelevanceRow[];
  inserts: RelevanceRow[];
  staleIds: number[];
};

export interface PersistenceAdapter {
  upsertById(rows: RelevanceRow[]): Promise<void>;
  insert(rows: RelevanceRow[]): Promise<void>;
  deleteByIds(ids: number[]): Promise<void>;
}

export function normalizeBatchSize(value: unknown) {
  const parsed = Number(value ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(MAX_BATCH_SIZE, Math.trunc(parsed)));
}

function relNorm(s: string) {
  return (s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function relHas(text: string, term: string) {
  const x = relNorm(text), t = relNorm(term);
  if (!t) return false;
  if (t.length === 1) return x === t;
  let from = 0;
  while (true) {
    const i = x.indexOf(t, from);
    if (i < 0) return false;
    const before = i > 0 ? x[i - 1] : "";
    const after = i + t.length < x.length ? x[i + t.length] : "";
    const ascii = /[a-z0-9]/i, katakana = /[ァ-ヶー]/;
    const asciiTerm = /^[a-z0-9.+#-]+$/i.test(t);
    const katakanaTerm = /^[ァ-ヶー]+$/.test(t);
    if (asciiTerm) {
      if (!ascii.test(before) && !ascii.test(after)) return true;
    } else if (katakanaTerm) {
      if (
        !ascii.test(before) && !ascii.test(after) && !katakana.test(before) &&
        !katakana.test(after)
      ) return true;
    } else if (!ascii.test(before) && !ascii.test(after)) {
      return true;
    }
    from = i + 1;
  }
}

function uniq<T>(items: T[]) {
  return [...new Set(items)];
}

function pruneMatches(items: string[]) {
  const sorted = uniq(items).sort((a, b) =>
    relNorm(b).length - relNorm(a).length
  );
  const kept: string[] = [];
  for (const term of sorted) {
    const normalized = relNorm(term);
    if (!kept.some((item) => relNorm(item).includes(normalized))) {
      kept.push(term);
    }
  }
  return kept;
}

function levelFromScore(score: number) {
  return score >= 80
    ? "high"
    : score >= 60
    ? "medium"
    : score >= 40
    ? "low"
    : "none";
}

export function evalRelevance(
  text: string,
  rules: any[],
  entities: any[],
  excludes: any[],
) {
  const by = new Map<string, any>();
  function put(
    domain: string,
    category: string,
    score: number,
    ruleIds: number[] = [],
    terms: string[] = [],
    entityIds: number[] = [],
  ) {
    if (!category || score <= 0) return;
    const key = `${domain}|${category}`;
    const old = by.get(key) ||
      {
        relevance_domain: domain,
        category_key: category,
        relevance_score: 0,
        matched_rule_ids: [],
        matched_terms: [],
        matched_entity_ids: [],
      };
    old.relevance_score = Math.max(old.relevance_score, score);
    old.matched_rule_ids = uniq([...old.matched_rule_ids, ...ruleIds]);
    old.matched_terms = uniq([...old.matched_terms, ...terms]);
    old.matched_entity_ids = uniq([...old.matched_entity_ids, ...entityIds]);
    by.set(key, old);
  }
  for (const entity of entities || []) {
    if (entity.enabled !== false && relHas(text, entity.entity_value)) {
      put(entity.relevance_domain, entity.category_key, 100, [], [
        entity.entity_value,
      ], [entity.id]);
    }
  }
  for (const rule of rules || []) {
    if (rule.enabled === false || !rule.category_key) continue;
    const blocked = (excludes || []).some((exclude: any) =>
      exclude.enabled !== false &&
      exclude.relevance_domain === rule.relevance_domain &&
      exclude.category_key === rule.category_key &&
      (exclude.match_terms || []).some((term: string) => relHas(text, term))
    );
    if (blocked) continue;
    const matches = pruneMatches(
      (rule.match_terms || []).filter((term: string) => relHas(text, term)),
    );
    const strongNorm = new Set(
      (rule.strong_terms || []).map((term: string) => relNorm(term)),
    );
    const strong = matches.filter((term: string) =>
      strongNorm.has(relNorm(term))
    );
    const score = strong.length >= 2
      ? 85
      : matches.length >= 2
      ? 65
      : matches.length === 1
      ? 40
      : 0;
    if (score > 0) {
      put(
        rule.relevance_domain,
        rule.category_key,
        score,
        [rule.id],
        matches,
        [],
      );
    }
  }
  return [...by.values()].map((row) => ({
    ...row,
    relevance_level: levelFromScore(row.relevance_score),
  }));
}

function rowKey(
  row: Pick<
    RelevanceRow,
    | "subject_type"
    | "topic_id"
    | "cluster_key"
    | "relevance_domain"
    | "category_key"
  >,
) {
  const subject = row.subject_type === "topic"
    ? `topic:${row.topic_id}`
    : `cluster:${row.cluster_key}`;
  return `${subject}|${row.relevance_domain}|${row.category_key}`;
}

export function buildRelevanceBatch(args: {
  topics: Topic[];
  rules: any[];
  entities: any[];
  excludes: any[];
  cursor?: number;
  limit?: number;
  evaluatedAt?: string;
}) {
  const cursor = Math.max(0, Math.trunc(Number(args.cursor || 0)));
  const limit = normalizeBatchSize(args.limit);
  const ordered = [...(args.topics || [])].sort((a, b) =>
    Number(a.id) - Number(b.id)
  );
  const pending = ordered.filter((topic) => Number(topic.id) > cursor);
  const selected = pending.slice(0, limit);
  const allGroups = new Map<string, Topic[]>();
  for (const topic of ordered) {
    if (!topic.cluster_key) continue;
    const members = allGroups.get(topic.cluster_key) || [];
    members.push(topic);
    allGroups.set(topic.cluster_key, members);
  }
  const clusterKeys = uniq(
    selected.map((topic) => topic.cluster_key).filter((key): key is string =>
      Boolean(key)
    ),
  );
  const evaluatedAt = args.evaluatedAt || new Date().toISOString();
  const rows: RelevanceRow[] = [];
  for (const topic of selected) {
    const hits = evalRelevance(
      topic.title || "",
      args.rules || [],
      args.entities || [],
      args.excludes || [],
    );
    for (const hit of hits) {
      rows.push({
        subject_type: "topic",
        topic_id: topic.id,
        cluster_key: null,
        ...hit,
        evidence: { title: topic.title, window_hours: RELEVANCE_WINDOW_HOURS },
        evaluated_at: evaluatedAt,
      });
    }
  }
  for (const clusterKey of clusterKeys) {
    const members = allGroups.get(clusterKey) || [];
    const hits = evalRelevance(
      members.map((topic) => topic.title || "").join("\n"),
      args.rules || [],
      args.entities || [],
      args.excludes || [],
    );
    for (const hit of hits) {
      rows.push({
        subject_type: "cluster",
        topic_id: null,
        cluster_key: clusterKey,
        ...hit,
        evidence: {
          cluster_label: members[0]?.cluster_label || clusterKey,
          member_count: members.length,
          sample_titles: members.slice(0, 5).map((topic) => topic.title),
          window_hours: RELEVANCE_WINDOW_HOURS,
        },
        evaluated_at: evaluatedAt,
      });
    }
  }
  return {
    rows,
    selectedTopicIds: selected.map((topic) => topic.id),
    clusterKeys,
    selected: selected.length,
    nextCursor: selected.length ? selected[selected.length - 1].id : cursor,
    hasMore: pending.length > selected.length,
    remaining: Math.max(0, pending.length - selected.length),
  };
}

export function planRelevancePersistence(
  existingRows: RelevanceRow[],
  computedRows: RelevanceRow[],
  selectedTopicIds: number[],
  clusterKeys: string[],
): PersistencePlan {
  const topicIds = new Set(selectedTopicIds.map(Number));
  const clusters = new Set(clusterKeys);
  const scopedExisting = (existingRows || []).filter((row) =>
    row.subject_type === "topic"
      ? topicIds.has(Number(row.topic_id))
      : clusters.has(String(row.cluster_key || ""))
  );
  const existingByKey = new Map(
    scopedExisting.map((row) => [rowKey(row), row]),
  );
  const computedKeys = new Set<string>();
  const updates: RelevanceRow[] = [];
  const inserts: RelevanceRow[] = [];
  for (const row of computedRows || []) {
    const key = rowKey(row);
    computedKeys.add(key);
    const old = existingByKey.get(key);
    if (old?.id != null) updates.push({ ...row, id: old.id });
    else inserts.push(row);
  }
  // An entirely empty calculation never triggers cleanup. This prevents a bad
  // rules/config response from erasing the last known-good relevance dataset.
  const staleIds = computedRows.length === 0
    ? []
    : scopedExisting.filter((row) =>
      row.id != null && !computedKeys.has(rowKey(row))
    ).map((row) => Number(row.id));
  return { updates, inserts, staleIds };
}

export async function persistRelevanceBatch(
  plan: PersistencePlan,
  adapter: PersistenceAdapter,
) {
  if (plan.updates.length) await adapter.upsertById(plan.updates);
  if (plan.inserts.length) await adapter.insert(plan.inserts);
  // Cleanup is deliberately last. A failed upsert/insert leaves old rows intact.
  if (plan.staleIds.length) await adapter.deleteByIds(plan.staleIds);
}
