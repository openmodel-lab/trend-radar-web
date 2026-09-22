import {
  activeLeaseOwner,
  buildRelevanceBatch,
  createCursor,
  decodeCursor,
  encodeCursor,
  expiredRelevanceIds,
  parseCursorInput,
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

Deno.test("omitted cursor starts the initial batch", () => {
  const parsed = parseCursorInput(undefined);
  assert(parsed.valid && parsed.cursor === null, "omitted cursor was not accepted");
});

Deno.test("null cursor starts the initial batch", () => {
  const parsed = parseCursorInput(null);
  assert(parsed.valid && parsed.cursor === null, "null cursor was not accepted");
});

Deno.test("zero cursor starts the initial batch", () => {
  const parsed = parseCursorInput(0);
  assert(parsed.valid && parsed.cursor === null, "zero cursor was not accepted");
});

Deno.test("opaque cursor continues a run and invalid opaque cursor is rejected", () => {
  const cursor = {
    version: 1 as const,
    cutoff: "2026-09-21T00:00:00.000Z",
    maxId: 50,
    lastId: 25,
  };
  const parsed = parseCursorInput(encodeCursor(cursor));
  assert(parsed.valid, "valid opaque cursor was rejected");
  assert(parsed.cursor?.lastId === 25, "opaque cursor did not preserve continuation state");
  assert(!parseCursorInput("not-an-opaque-cursor").valid, "invalid opaque cursor was accepted");
});

Deno.test("cursor validation remains before lease acquisition", async () => {
  const source = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
  const validation = source.indexOf("const parsedCursor = parseCursorInput(body.cursor)");
  const lease = source.indexOf("runId = await acquireLease");
  assert(validation >= 0, "cursor validation is missing");
  assert(lease > validation, "lease is acquired before cursor validation");
});

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

Deno.test("opaque cursor preserves the run cutoff and high-water mark", () => {
  const topics = Array.from({ length: 60 }, (_, index) => ({
    id: index + 1,
    title: `topic ${index + 1}`,
    cluster_key: null,
    cluster_label: null,
  }));
  const cursor = createCursor("2026-09-21T00:00:00.000Z", topics);
  const first = buildRelevanceBatch({ topics, rules: [], entities: [], excludes: [], limit: 50 });
  const token = encodeCursor({ ...cursor, lastId: first.nextCursor });
  const decoded = decodeCursor(token)!;
  assert(decoded.cutoff === cursor.cutoff, "cutoff changed across cursor pages");
  assert(decoded.maxId === 60 && decoded.lastId === 50, "cursor bounds are incorrect");
  const second = buildRelevanceBatch({
    topics: [...topics, { id: 61, title: "late", cluster_key: null, cluster_label: null }]
      .filter((topic) => topic.id <= decoded.maxId),
    rules: [], entities: [], excludes: [], limit: 50, cursor: decoded.lastId,
  });
  assert(second.selectedTopicIds.join(",") === "51,52,53,54,55,56,57,58,59,60", "cursor skipped or included a late topic");
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

Deno.test("successfully evaluated zero-result subject cleans only its own rows", async () => {
  const plan = planRelevancePersistence([row({ id: 9 })], [], [1], []);
  assert(plan.staleIds.join(",") === "9", "zero-result subject was not cleaned");
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
  assert(calls.join("|") === "delete", "zero-result cleanup was not isolated");
});

Deno.test("subject cleanup never touches another batch or failed subject", () => {
  const plan = planRelevancePersistence(
    [row({ id: 9, topic_id: 1 }), row({ id: 10, topic_id: 2 })],
    [],
    [1],
    [],
  );
  assert(plan.staleIds.join(",") === "9", "cleanup escaped the completed subject scope");
});

Deno.test("same batch replay updates existing rows without duplicate insert", () => {
  const computed = [row({ topic_id: 1 })];
  const first = planRelevancePersistence([], computed, [1], []);
  assert(first.inserts.length === 1, "first execution should insert");
  const saved = [{ ...computed[0], id: 44 }];
  const replay = planRelevancePersistence(saved, computed, [1], []);
  assert(replay.updates.length === 1 && replay.inserts.length === 0, "replay is not idempotent");
});

Deno.test("active lease elects one owner and ignores expired runs", () => {
  const now = Date.parse("2026-09-22T00:00:00.000Z");
  const owner = activeLeaseOwner([
    { id: 8, metadata: { lease_expires_at: "2026-09-21T23:59:00.000Z" } },
    { id: 10, metadata: { lease_expires_at: "2026-09-22T00:03:00.000Z" } },
    { id: 11, metadata: { lease_expires_at: "2026-09-22T00:03:00.000Z" } },
  ], now);
  assert(owner === 10, "overlapping batches did not elect the oldest active lease");
});

Deno.test("final sweep removes only subjects outside the active 24 hour set", () => {
  const expired = expiredRelevanceIds([
    row({ id: 1, topic_id: 10 }),
    row({ id: 2, topic_id: 11 }),
    row({ id: 3, subject_type: "cluster", topic_id: null, cluster_key: "active" }),
    row({ id: 4, subject_type: "cluster", topic_id: null, cluster_key: "expired" }),
  ], [10], ["active"]);
  assert(expired.join(",") === "2,4", `unexpected expired cleanup: ${expired.join(",")}`);
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
