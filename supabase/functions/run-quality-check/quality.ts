export const MODEL = "gemini-3.5-flash-lite";
export const PROMPT_VERSION = "quality-v1";
export const INPUT_SCHEMA_VERSION = "quality-input-v1";
export const BATCH_SIZE = 20;
export const TITLE_LIMIT_PER_SOURCE = 8;
export const TITLE_MAX_LENGTH = 180;

export const QUALITY_VALUES = [
  "正常",
  "ノイズ",
  "曖昧",
  "表示名補正",
  "重複候補",
  "判定不能",
] as const;

export type QualityValue = (typeof QUALITY_VALUES)[number];
export type SourceName = "google" | "news" | "youtube";

export type TopicInput = {
  topic_id: string;
  topic_name: string;
  cluster_key: string | null;
  cluster_label: string | null;
  source_count: number;
  trend_score: number;
  early_score: number;
  first_seen_at: string;
  last_seen_at: string;
  source_titles: Record<SourceName, string[]>;
};

export type GeminiResult = {
  topic_id: string;
  topic_name: string;
  quality: QualityValue;
  reason: string;
  suggested_name: string;
  hide_candidate: boolean;
  confidence: number;
};

export type WorkCandidate = {
  topic_id: string;
  input_hash: string;
  last_seen_at: string;
};

export type WorkSelection<T extends WorkCandidate> = {
  selected: T[];
  remaining: number;
  reusable: number;
};

export type WorkProgress = {
  remaining: number;
  has_more: boolean;
};

const secretPatterns = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  /\b(?:api[_-]?key|secret|token|password|credential)\s*[:=]\s*\S+/gi,
  /\b(?:sk|AIza|ya29\.)[A-Za-z0-9._-]{16,}\b/g,
];

export function sanitizeText(value: unknown, maxLength: number): string {
  let text = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, "[REDACTED]");
  }
  return text.slice(0, maxLength);
}

export function sanitizeTitles(values: unknown[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const title = sanitizeText(value, TITLE_MAX_LENGTH);
    if (!title) continue;
    const key = title.toLocaleLowerCase("ja-JP");
    if (!unique.has(key)) unique.set(key, title);
  }
  return [...unique.values()]
    .sort((a, b) => a.localeCompare(b, "ja-JP"))
    .slice(0, TITLE_LIMIT_PER_SOURCE);
}

export function normalizeTopicInput(input: TopicInput): TopicInput {
  return {
    topic_id: String(input.topic_id),
    topic_name: sanitizeText(input.topic_name, 160),
    cluster_key: input.cluster_key
      ? sanitizeText(input.cluster_key, 200)
      : null,
    cluster_label: input.cluster_label
      ? sanitizeText(input.cluster_label, 160)
      : null,
    source_count: Math.max(0, Math.trunc(Number(input.source_count) || 0)),
    trend_score: finiteNumber(input.trend_score),
    early_score: finiteNumber(input.early_score),
    first_seen_at: new Date(input.first_seen_at).toISOString(),
    last_seen_at: new Date(input.last_seen_at).toISOString(),
    source_titles: {
      google: sanitizeTitles(input.source_titles.google),
      news: sanitizeTitles(input.source_titles.news),
      youtube: sanitizeTitles(input.source_titles.youtube),
    },
  };
}

function finiteNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

export function canonicalTopicPayload(
  topic: TopicInput,
): Record<string, unknown> {
  return {
    input_schema_version: INPUT_SCHEMA_VERSION,
    topic: normalizeTopicInput(topic),
  };
}

export async function inputHash(topic: TopicInput): Promise<string> {
  const encoded = new TextEncoder().encode(
    JSON.stringify(canonicalTopicPayload(topic)),
  );
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function selectQualityWork<T extends WorkCandidate>(
  candidates: T[],
  successfulKeys: ReadonlySet<string>,
  successfulTopicIds: ReadonlySet<string>,
  attemptedKeys: ReadonlySet<string>,
  lastSuccessfulAtByTopic: ReadonlyMap<string, string>,
  limit: number,
): WorkSelection<T> {
  const reusable =
    candidates.filter((candidate) =>
      successfulKeys.has(workKey(candidate.topic_id, candidate.input_hash))
    ).length;
  const pending = candidates.filter((candidate) =>
    !successfulKeys.has(workKey(candidate.topic_id, candidate.input_hash))
  );

  pending.sort((left, right) => {
    const priority = candidatePriority(left) - candidatePriority(right);
    if (priority !== 0) return priority;
    if (candidatePriority(left) === 1) {
      const oldestSuccess = Date.parse(
        lastSuccessfulAtByTopic.get(left.topic_id) ?? "1970-01-01T00:00:00Z",
      ) - Date.parse(
        lastSuccessfulAtByTopic.get(right.topic_id) ?? "1970-01-01T00:00:00Z",
      );
      if (oldestSuccess !== 0) return oldestSuccess;
    }
    const recency = Date.parse(right.last_seen_at) -
      Date.parse(left.last_seen_at);
    if (recency !== 0) return recency;
    return left.topic_id.localeCompare(right.topic_id, "en", { numeric: true });
  });

  const selected = pending.slice(0, Math.max(0, Math.trunc(limit)));
  return { selected, remaining: pending.length - selected.length, reusable };

  function candidatePriority(candidate: T): number {
    const key = workKey(candidate.topic_id, candidate.input_hash);
    if (
      !successfulTopicIds.has(candidate.topic_id) && !attemptedKeys.has(key)
    ) {
      return 0;
    }
    if (successfulTopicIds.has(candidate.topic_id)) return 1;
    return 2;
  }
}

export function summarizeWorkProgress(
  queuedRemaining: number,
  deferredByDeadline: number,
  unstarted: number,
  failed: number,
): WorkProgress {
  const remaining = Math.max(
    0,
    Math.trunc(queuedRemaining) + Math.trunc(deferredByDeadline) +
      Math.trunc(unstarted) + Math.trunc(failed),
  );
  return { remaining, has_more: remaining > 0 };
}

function workKey(topicId: string, inputHash: string): string {
  return `${topicId}:${inputHash}`;
}

export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "topic_id",
          "topic_name",
          "quality",
          "reason",
          "suggested_name",
          "hide_candidate",
          "confidence",
        ],
        properties: {
          topic_id: { type: "string" },
          topic_name: { type: "string" },
          quality: { type: "string", enum: [...QUALITY_VALUES] },
          reason: { type: "string" },
          suggested_name: { type: "string" },
          hide_candidate: { type: "boolean" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
  },
} as const;

export function validateGeminiResults(value: unknown, topics: TopicInput[]): {
  valid: GeminiResult[];
  invalidTopicIds: string[];
} {
  const expected = new Map(topics.map((topic) => [topic.topic_id, topic]));
  const valid = new Map<string, GeminiResult>();
  const rawResults = isRecord(value) && Array.isArray(value.results)
    ? value.results
    : [];

  for (const item of rawResults) {
    if (!isRecord(item)) continue;
    const topicId = String(item.topic_id ?? "");
    if (!expected.has(topicId) || valid.has(topicId)) continue;
    if (!QUALITY_VALUES.includes(item.quality as QualityValue)) continue;
    if (
      typeof item.topic_name !== "string" || typeof item.reason !== "string"
    ) continue;
    if (
      typeof item.suggested_name !== "string" ||
      typeof item.hide_candidate !== "boolean"
    ) continue;
    const confidence = Number(item.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      continue;
    }
    valid.set(topicId, {
      topic_id: topicId,
      topic_name: sanitizeText(item.topic_name, 160),
      quality: item.quality as QualityValue,
      reason: sanitizeText(item.reason, 1000),
      suggested_name: sanitizeText(item.suggested_name, 160),
      hide_candidate: item.hide_candidate,
      confidence,
    });
  }

  return {
    valid: [...valid.values()],
    invalidTopicIds: [...expected.keys()].filter((topicId) =>
      !valid.has(topicId)
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
