import {
  canonicalTopicPayload,
  INPUT_SCHEMA_VERSION,
  inputHash,
  normalizeTopicInput,
  RESPONSE_JSON_SCHEMA,
  sanitizeTitles,
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
