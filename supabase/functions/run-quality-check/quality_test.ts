import {
  canonicalTopicPayload,
  INPUT_SCHEMA_VERSION,
  inputHash,
  normalizeTopicInput,
  RESPONSE_JSON_SCHEMA,
  sanitizeTitles,
  selectQualityWork,
  summarizeWorkProgress,
  type TopicInput,
  validateGeminiResults,
} from "./quality.ts";

const topic: TopicInput = {
  topic_id: "123",
  topic_name: " テスト ",
  cluster_key: "test",
  cluster_label: "テスト",
  source_count: 2,
  trend_score: 42,
  early_score: 18,
  first_seen_at: "2026-09-20T00:00:00Z",
  last_seen_at: "2026-09-20T03:00:00Z",
  source_titles: {
    google: ["テスト", "テスト"],
    news: ["関連ニュース"],
    youtube: [],
  },
};

Deno.test("input hash uses only normalized topic payload and schema version", async () => {
  const normalized = normalizeTopicInput(topic);
  const first = await inputHash(normalized);
  const second = await inputHash(normalized);
  if (first !== second || !/^[0-9a-f]{64}$/.test(first)) {
    throw new Error("hash is not stable SHA-256");
  }
  const payload = canonicalTopicPayload(normalized);
  if (payload.input_schema_version !== INPUT_SCHEMA_VERSION) {
    throw new Error("schema version missing from hash payload");
  }
  if (
    "window_start" in payload || "window_end" in payload || "window" in payload
  ) throw new Error("daily window leaked into hash payload");
});

Deno.test("work selection skips reusable inputs and advances to unseen topics", () => {
  const candidates = [
    { topic_id: "1", input_hash: "same", last_seen_at: "2026-09-20T01:00:00Z" },
    {
      topic_id: "2",
      input_hash: "new-2",
      last_seen_at: "2026-09-20T04:00:00Z",
    },
    {
      topic_id: "3",
      input_hash: "new-3",
      last_seen_at: "2026-09-20T03:00:00Z",
    },
    {
      topic_id: "4",
      input_hash: "changed",
      last_seen_at: "2026-09-20T05:00:00Z",
    },
  ];
  const selection = selectQualityWork(
    candidates,
    new Set(["1:same", "4:old"]),
    new Set(["1", "4"]),
    new Set(["1:same", "4:old"]),
    new Map([["1", "2026-09-19T00:00:00Z"], ["4", "2026-09-19T01:00:00Z"]]),
    2,
  );
  if (selection.reusable !== 1 || selection.remaining !== 1) {
    throw new Error("selection counts are incorrect");
  }
  if (selection.selected.map((item) => item.topic_id).join(",") !== "2,3") {
    throw new Error("unseen topics were not prioritized by recency");
  }

  const next = selectQualityWork(
    candidates,
    new Set(["1:same", "2:new-2", "3:new-3", "4:old"]),
    new Set(["1", "2", "3", "4"]),
    new Set(["1:same", "2:new-2", "3:new-3", "4:old"]),
    new Map([
      ["1", "2026-09-19T00:00:00Z"],
      ["2", "2026-09-19T01:00:00Z"],
      ["3", "2026-09-19T02:00:00Z"],
      ["4", "2026-09-19T03:00:00Z"],
    ]),
    2,
  );
  if (next.selected.length !== 1 || next.selected[0].topic_id !== "4") {
    throw new Error(
      "changed input was not selected after unseen work completed",
    );
  }
});

Deno.test("failed current inputs do not starve never-attempted work", () => {
  const candidates = [
    {
      topic_id: "10",
      input_hash: "failed",
      last_seen_at: "2026-09-20T06:00:00Z",
    },
    {
      topic_id: "11",
      input_hash: "unseen",
      last_seen_at: "2026-09-20T05:00:00Z",
    },
  ];
  const selection = selectQualityWork(
    candidates,
    new Set(),
    new Set(),
    new Set(["10:failed"]),
    new Map(),
    1,
  );
  if (selection.selected[0]?.topic_id !== "11") {
    throw new Error("failed retry starved unseen work");
  }
});

Deno.test("changed inputs rotate by oldest successful check", () => {
  const candidates = [
    {
      topic_id: "20",
      input_hash: "new-20",
      last_seen_at: "2026-09-20T06:00:00Z",
    },
    {
      topic_id: "21",
      input_hash: "new-21",
      last_seen_at: "2026-09-20T05:00:00Z",
    },
  ];
  const selection = selectQualityWork(
    candidates,
    new Set(["20:old-20", "21:old-21"]),
    new Set(["20", "21"]),
    new Set(["20:old-20", "21:old-21"]),
    new Map([
      ["20", "2026-09-20T04:00:00Z"],
      ["21", "2026-09-20T01:00:00Z"],
    ]),
    1,
  );
  if (selection.selected[0]?.topic_id !== "21") {
    throw new Error("oldest changed topic was not selected first");
  }
});

Deno.test("large backlog is limited to one batch and reports remaining work", () => {
  const candidates = Array.from({ length: 603 }, (_, index) => ({
    topic_id: String(index + 1),
    input_hash: `hash-${index + 1}`,
    last_seen_at: new Date(Date.UTC(2026, 8, 20, 0, 0, index)).toISOString(),
  }));
  const selection = selectQualityWork(
    candidates,
    new Set(),
    new Set(),
    new Set(),
    new Map(),
    20,
  );
  if (selection.selected.length !== 20 || selection.remaining !== 583) {
    throw new Error("large backlog was not limited correctly");
  }
});

Deno.test("25 unseen topics advance from 20 to the remaining 5", () => {
  const candidates = Array.from({ length: 25 }, (_, index) => ({
    topic_id: String(index + 1),
    input_hash: `hash-${index + 1}`,
    last_seen_at: new Date(Date.UTC(2026, 8, 20, 0, 0, index)).toISOString(),
  }));
  const first = selectQualityWork(
    candidates,
    new Set(),
    new Set(),
    new Set(),
    new Map(),
    20,
  );
  const completedKeys = new Set(
    first.selected.map((item) => `${item.topic_id}:${item.input_hash}`),
  );
  const completedTopicIds = new Set(
    first.selected.map((item) => item.topic_id),
  );
  const second = selectQualityWork(
    candidates,
    completedKeys,
    completedTopicIds,
    completedKeys,
    new Map(
      first.selected.map((item) => [item.topic_id, "2026-09-20T01:00:00Z"]),
    ),
    20,
  );
  if (
    first.selected.length !== 20 || first.remaining !== 5 ||
    second.selected.length !== 5 || second.remaining !== 0 ||
    second.selected.some((item) => completedTopicIds.has(item.topic_id))
  ) {
    throw new Error("successive runs did not advance through the backlog");
  }
});

Deno.test("same input hash is reused while changed input is selected", async () => {
  const original = normalizeTopicInput(topic);
  const originalHash = await inputHash(original);
  const changed = normalizeTopicInput({ ...topic, topic_name: "変更後テスト" });
  const changedHash = await inputHash(changed);
  if (originalHash === changedHash) {
    throw new Error("input change was not hashed");
  }

  const candidates = [
    {
      topic_id: original.topic_id,
      input_hash: originalHash,
      last_seen_at: original.last_seen_at,
    },
    {
      topic_id: "456",
      input_hash: changedHash,
      last_seen_at: changed.last_seen_at,
    },
  ];
  const selection = selectQualityWork(
    candidates,
    new Set([`${original.topic_id}:${originalHash}`, "456:old-hash"]),
    new Set([original.topic_id, "456"]),
    new Set([`${original.topic_id}:${originalHash}`, "456:old-hash"]),
    new Map([
      [original.topic_id, "2026-09-20T00:00:00Z"],
      ["456", "2026-09-20T00:00:00Z"],
    ]),
    20,
  );
  if (
    selection.reusable !== 1 || selection.selected.length !== 1 ||
    selection.selected[0].topic_id !== "456"
  ) {
    throw new Error("reuse or changed-input selection was incorrect");
  }
});

Deno.test("work progress includes queued, deferred, unstarted, and failed work", () => {
  const progress = summarizeWorkProgress(5, 2, 1, 1);
  if (progress.remaining !== 9 || !progress.has_more) {
    throw new Error("remaining work was summarized incorrectly");
  }
  const complete = summarizeWorkProgress(0, 0, 0, 0);
  if (complete.remaining !== 0 || complete.has_more) {
    throw new Error("completed work incorrectly reported remaining items");
  }
});

Deno.test("titles are normalized, deduplicated, limited, and secrets are redacted", () => {
  const titles = sanitizeTitles([
    "ＡＢＣ",
    "ABC",
    "api_key=secret-value-123456789",
    ...Array.from({ length: 20 }, (_, index) => `title-${index}`),
  ]);
  if (titles.length > 8) throw new Error("title limit was not applied");
  if (titles.filter((value) => value.toLowerCase() === "abc").length !== 1) {
    throw new Error("NFKC dedupe failed");
  }
  if (titles.some((value) => value.includes("secret-value"))) {
    throw new Error("secret pattern was not redacted");
  }
});

Deno.test("structured output requires topic_id and validates by topic_id", () => {
  const item = RESPONSE_JSON_SCHEMA.properties.results.items;
  if (!item.required.includes("topic_id")) {
    throw new Error("topic_id is not required");
  }
  const validation = validateGeminiResults({
    results: [{
      topic_id: "123",
      topic_name: "テスト",
      quality: "正常",
      reason: "問題なし",
      suggested_name: "",
      hide_candidate: false,
      confidence: 0.9,
    }],
  }, [normalizeTopicInput(topic)]);
  if (
    validation.valid.length !== 1 || validation.invalidTopicIds.length !== 0
  ) throw new Error("valid result rejected");

  const mismatch = validateGeminiResults({
    results: [{
      topic_id: "999",
      topic_name: "テスト",
      quality: "正常",
      reason: "問題なし",
      suggested_name: "",
      hide_candidate: false,
      confidence: 0.9,
    }],
  }, [normalizeTopicInput(topic)]);
  if (mismatch.valid.length !== 0 || mismatch.invalidTopicIds[0] !== "123") {
    throw new Error("topic_id mismatch was not rejected");
  }
});
