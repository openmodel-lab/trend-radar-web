import {
  buildRelevanceBatch,
  type PersistenceAdapter,
  persistRelevanceBatch,
  planRelevancePersistence,
  type RelevanceRow,
} from "./relevance.ts";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function row(overrides: Partial<RelevanceRow> = {}): RelevanceRow {
  return {
    subject_type: "topic",
    topic_id: 1,
    cluster_key: null,
    relevance_domain: "industry",
    category_key: "mobility",
    relevance_score: 40,
    relevance_level: "low",
    matched_rule_ids: [1],
    matched_terms: ["車"],
    matched_entity_ids: [],
    evidence: {},
    evaluated_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("collect-trends does not execute relevance synchronously", async () => {
  const source = await Deno.readTextFile(
    new URL("../collect-trends/index.ts", import.meta.url),
  );
  const relevanceSource = await Deno.readTextFile(
    new URL("./index.ts", import.meta.url),
  );
  assert(
    !source.includes("await relevance()"),
    "collect-trends still awaits relevance",
  );
  assert(
    source.includes('status:"deferred"'),
    "collect-trends response should mark relevance deferred",
  );
  assert(
    !source.includes("relevance_results?id=gt.0"),
    "collect-trends still contains global relevance deletion",
  );
  assert(
    !relevanceSource.includes("relevance_results?id=gt.0"),
    "update-relevance contains global relevance deletion",
  );
});

Deno.test("relevance processing advances in bounded topic batches", () => {
  const topics = Array.from(
    { length: 120 },
    (_, index) => ({
      id: index + 1,
      title: `topic ${index + 1}`,
      cluster_key: `cluster-${index + 1}`,
      cluster_label: null,
    }),
  );
  const first = buildRelevanceBatch({
    topics,
    rules: [],
    entities: [],
    excludes: [],
    limit: 50,
  });
  assert(first.selected === 50, "first batch should select 50 topics");
  assert(
    first.nextCursor === 50 && first.hasMore && first.remaining === 70,
    "first batch cursor is incorrect",
  );
  const second = buildRelevanceBatch({
    topics,
    rules: [],
    entities: [],
    excludes: [],
    limit: 50,
    cursor: first.nextCursor,
  });
  assert(
    second.selectedTopicIds[0] === 51 && second.selectedTopicIds.at(-1) === 100,
    "second batch did not advance",
  );
});

Deno.test("write failure never reaches stale cleanup", async () => {
  const plan = planRelevancePersistence(
    [row({ id: 9, category_key: "old" })],
    [row({ category_key: "new" })],
    [1],
    [],
  );
  let deletes = 0;
  const adapter: PersistenceAdapter = {
    async upsertById() {},
    async insert() {
      throw new Error("simulated insert failure");
    },
    async deleteByIds() {
      deletes++;
    },
  };
  let failed = false;
  try {
    await persistRelevanceBatch(plan, adapter);
  } catch {
    failed = true;
  }
  assert(failed, "simulated failure should propagate");
  assert(deletes === 0, "cleanup ran after a failed write");
});

Deno.test("empty calculation preserves existing relevance rows", async () => {
  const plan = planRelevancePersistence([row({ id: 9 })], [], [1], []);
  assert(
    plan.staleIds.length === 0,
    "empty calculation planned destructive cleanup",
  );
  const calls: string[] = [];
  await persistRelevanceBatch(plan, {
    async upsertById() {
      calls.push("upsert");
    },
    async insert() {
      calls.push("insert");
    },
    async deleteByIds() {
      calls.push("delete");
    },
  });
  assert(calls.length === 0, "empty calculation should not write or delete");
});

Deno.test("successful writes finish before scoped stale cleanup", async () => {
  const plan = planRelevancePersistence(
    [row({ id: 8, category_key: "kept" }), row({ id: 9, category_key: "old" })],
    [row({ category_key: "kept" }), row({ category_key: "new" })],
    [1],
    [],
  );
  const calls: string[] = [];
  await persistRelevanceBatch(plan, {
    async upsertById() {
      calls.push("upsert");
    },
    async insert() {
      calls.push("insert");
    },
    async deleteByIds(ids) {
      calls.push(`delete:${ids.join(",")}`);
    },
  });
  assert(
    calls.join("|") === "upsert|insert|delete:9",
    `unexpected persistence order: ${calls.join("|")}`,
  );
});
