import {
  clusterAssignmentEventRow,
  signalEventRow,
  signalEventTypes,
  type SignalState,
} from "./history.ts";

const migrationSql = await Deno.readTextFile(new URL("../../migrations/20260922123620_add_topic_signal_and_cluster_history.sql", import.meta.url));
const collectorSource = await Deno.readTextFile(new URL("./index.ts", import.meta.url));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function state(overrides: Partial<SignalState> = {}): SignalState {
  return {
    topic_id: 1,
    cluster_key: "topic",
    cluster_label: "Topic",
    cluster_method: "heuristic_v05",
    trend_score: 20,
    early_signal_score: 0,
    early_signal_level: "none",
    velocity_1h: 0,
    propagation_path: null,
    is_now: false,
    google_score: 40,
    news_score: 0,
    youtube_score: 0,
    source_count: 1,
    evidence_score: 10,
    evidence_level: "light",
    evidence_source_count: 1,
    google_count: 1,
    news_count: 0,
    youtube_count: 0,
    ...overrides,
  };
}

Deno.test("signal history detects EARLY entry and level changes", () => {
  assert(signalEventTypes(state(), state({ early_signal_level: "watch", early_signal_score: 20 })).includes("early_enter"), "none -> watch missing");
  assert(signalEventTypes(state({ early_signal_level: "watch" }), state({ early_signal_level: "rising" })).includes("early_level_change"), "watch -> rising missing");
  assert(signalEventTypes(state({ early_signal_level: "rising" }), state({ early_signal_level: "hot" })).includes("early_level_change"), "rising -> hot missing");
});

Deno.test("signal history detects EARLY exit", () => {
  const events = signalEventTypes(state({ early_signal_level: "rising" }), state());
  assert(events.includes("early_exit"), "EARLY exit missing");
});

Deno.test("signal history detects NOW entry and exit", () => {
  assert(signalEventTypes(state(), state({ is_now: true, trend_score: 60 })).includes("now_enter"), "NOW entry missing");
  assert(signalEventTypes(state({ is_now: true, trend_score: 70 }), state()).includes("now_exit"), "NOW exit missing");
});

Deno.test("signal history combines source and evidence changes into one event row", () => {
  const previous = state({ early_signal_level: "watch" });
  const current = state({
    early_signal_level: "watch",
    news_score: 50,
    source_count: 2,
    evidence_score: 50,
    evidence_level: "good",
    evidence_source_count: 2,
    news_count: 2,
  });
  const events = signalEventTypes(previous, current);
  assert(events.includes("source_change"), "source change missing");
  assert(events.includes("evidence_change"), "evidence change missing");
  const row = signalEventRow(current, events, "2026-09-22T00:00:00.000Z");
  assert(row !== null && row.event_types.length === 2, "simultaneous changes should share one row");
  assert(row.event_type === "source_change", "primary event type is not deterministic");
  assert(row.previous_event_id === 0, "initial predecessor should use the zero sentinel");
});

Deno.test("signal history idempotency distinguishes later valid transitions", () => {
  const current = state({ early_signal_level: "watch" });
  const first = signalEventRow(current, ["early_enter"], "2026-09-22T00:00:00.000Z", 10);
  const later = signalEventRow(current, ["early_enter"], "2026-09-23T00:00:00.000Z", 20);
  assert(first?.previous_event_id === 10 && later?.previous_event_id === 20, "predecessor identity was not preserved");
  assert(migrationSql.includes("unique (topic_id, previous_event_id, event_fingerprint)"), "database idempotency constraint is missing");
  assert(migrationSql.includes("before insert on public.topic_signal_events"), "database fingerprint trigger is missing");
});

Deno.test("signal history does not save an unchanged state", () => {
  const previous = state({ early_signal_level: "watch" });
  const current = state({ early_signal_level: "watch", early_signal_score: 21, trend_score: 22 });
  assert(signalEventTypes(previous, current).length === 0, "score-only change created an event");
});

Deno.test("assignment history saves only an actual change", () => {
  const before = { cluster_key: "a", cluster_label: "A", cluster_method: "heuristic_v05", cluster_confidence: 1, parent_cluster_key: null };
  assert(clusterAssignmentEventRow(1, before, { ...before }, { changeSetId: "00000000-0000-0000-0000-000000000001" }) === null, "unchanged assignment was saved");
  const event = clusterAssignmentEventRow(1, before, {
    cluster_key: "b",
    cluster_label: "B",
    cluster_method: "semantic_key_v01",
    cluster_confidence: 0.95,
    parent_cluster_key: "entity:b",
  }, {
    changeSetId: "00000000-0000-0000-0000-000000000001",
    changeType: "split",
    changeReason: "reviewed split",
    changedAt: "2026-09-22T00:00:00.000Z",
  });
  assert(event !== null, "changed assignment was not saved");
  assert(event.before_cluster_key === "a" && event.after_cluster_key === "b", "before/after keys are wrong");
  assert(event.before_cluster_method === "heuristic_v05" && event.after_cluster_method === "semantic_key_v01", "before/after methods are wrong");
  assert(event.change_type === "split" && event.change_set_id.endsWith("0001"), "change grouping fields are wrong");
});

Deno.test("new topic initial assignment is not history", () => {
  const event = clusterAssignmentEventRow(1, null, { cluster_key: "new", cluster_method: "heuristic_v05" });
  assert(event === null, "initial assignment created a history row");
});

Deno.test("baseline and assignment history migration keeps safety invariants", () => {
  for (const expression of [
    "coalesce(t.cluster_trend_score, 0)",
    "coalesce(t.early_signal_score, 0)",
    "coalesce(t.early_signal_level, 'none')",
    "coalesce(t.velocity_1h, 0)",
    "coalesce(t.cluster_google_score, 0)",
    "coalesce(t.cluster_news_score, 0)",
    "coalesce(t.cluster_youtube_score, 0)",
    "coalesce(t.cluster_source_count, 0)",
  ]) assert(migrationSql.includes(expression), `baseline NULL guard missing: ${expression}`);
  assert(migrationSql.includes("after update of cluster_key, cluster_label, cluster_method, cluster_confidence, metadata"), "atomic assignment trigger is missing");
  assert(migrationSql.includes("insert into public.topic_cluster_assignment_events"), "assignment trigger does not write history");
  assert(!collectorSource.includes('rest("topic_cluster_assignment_events"'), "collector still performs a non-atomic history request");
});

Deno.test("cluster snapshots keep minimal response payload", () => {
  const snapshotInsert = collectorSource.match(/rest\("trend_cluster_snapshots"[^\n]+/g)?.join("\n") ?? "";
  assert(snapshotInsert.includes('Prefer:"return=minimal"'), "snapshot insert no longer uses return=minimal");
  assert(!snapshotInsert.includes("return=representation"), "snapshot insert requests unnecessary representation");
});
