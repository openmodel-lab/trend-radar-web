export const SIGNAL_EVENT_TYPES = [
  "baseline",
  "early_enter",
  "early_level_change",
  "early_exit",
  "now_enter",
  "now_exit",
  "source_change",
  "evidence_change",
] as const;

export type SignalEventType = typeof SIGNAL_EVENT_TYPES[number];

export type SignalState = {
  topic_id: number;
  cluster_key: string | null;
  cluster_label: string | null;
  cluster_method: string | null;
  trend_score: number;
  early_signal_score: number;
  early_signal_level: string;
  velocity_1h: number;
  propagation_path: string | null;
  is_now: boolean;
  google_score: number;
  news_score: number;
  youtube_score: number;
  source_count: number;
  evidence_score: number | null;
  evidence_level: string | null;
  evidence_source_count: number | null;
  google_count: number | null;
  news_count: number | null;
  youtube_count: number | null;
  cluster_snapshot_id?: number | null;
};

export type ClusterAssignmentState = {
  cluster_key?: string | null;
  cluster_label?: string | null;
  cluster_method?: string | null;
  cluster_confidence?: number | null;
  parent_cluster_key?: string | null;
};

const earlyActive = (state: SignalState) => state.early_signal_level !== "none";
const signalActive = (state: SignalState) => earlyActive(state) || state.is_now;
const n = (value: number | null | undefined) => Number(value ?? 0);

function sourceSignature(state: SignalState) {
  return [n(state.google_score) > 0, n(state.news_score) > 0, n(state.youtube_score) > 0, n(state.source_count)].join("|");
}

function evidenceSignature(state: SignalState) {
  return [
    state.evidence_level ?? "",
    n(state.evidence_source_count),
    n(state.google_count),
    n(state.news_count),
    n(state.youtube_count),
  ].join("|");
}

export function signalEventTypes(previous: SignalState | null, current: SignalState): SignalEventType[] {
  if (!previous) {
    const initial: SignalEventType[] = [];
    if (earlyActive(current)) initial.push("early_enter");
    if (current.is_now) initial.push("now_enter");
    return initial;
  }

  const events: SignalEventType[] = [];
  const wasEarly = earlyActive(previous);
  const isEarly = earlyActive(current);
  if (!wasEarly && isEarly) events.push("early_enter");
  else if (wasEarly && !isEarly) events.push("early_exit");
  else if (wasEarly && isEarly && previous.early_signal_level !== current.early_signal_level) events.push("early_level_change");

  if (!previous.is_now && current.is_now) events.push("now_enter");
  else if (previous.is_now && !current.is_now) events.push("now_exit");

  if (signalActive(previous) && signalActive(current)) {
    if (sourceSignature(previous) !== sourceSignature(current)) events.push("source_change");
    if (evidenceSignature(previous) !== evidenceSignature(current)) events.push("evidence_change");
  }
  return events;
}

export function signalEventRow(
  current: SignalState,
  eventTypes: SignalEventType[],
  observedAt = new Date().toISOString(),
  previousEventId = 0,
) {
  if (!eventTypes.length) return null;
  return {
    ...current,
    observed_at: observedAt,
    event_type: eventTypes[0],
    event_types: eventTypes,
    previous_event_id: previousEventId,
  };
}

const normalizedAssignment = (state: ClusterAssignmentState) => ({
  cluster_key: state.cluster_key ?? null,
  cluster_label: state.cluster_label ?? null,
  cluster_method: state.cluster_method ?? null,
  cluster_confidence: state.cluster_confidence == null ? null : Number(state.cluster_confidence),
  parent_cluster_key: state.parent_cluster_key ?? null,
});

export function clusterAssignmentChanged(before: ClusterAssignmentState | null, after: ClusterAssignmentState) {
  if (!before) return false;
  return JSON.stringify(normalizedAssignment(before)) !== JSON.stringify(normalizedAssignment(after));
}

export function clusterAssignmentEventRow(
  topicId: number,
  before: ClusterAssignmentState | null,
  after: ClusterAssignmentState,
  options: {
    changeType?: "reclassify" | "split" | "merge";
    changeSetId?: string;
    changeReason?: string | null;
    changedAt?: string;
  } = {},
) {
  if (!before || !clusterAssignmentChanged(before, after)) return null;
  const oldState = normalizedAssignment(before);
  const newState = normalizedAssignment(after);
  return {
    topic_id: topicId,
    changed_at: options.changedAt ?? new Date().toISOString(),
    change_type: options.changeType ?? "reclassify",
    change_set_id: options.changeSetId ?? crypto.randomUUID(),
    before_cluster_key: oldState.cluster_key,
    before_cluster_label: oldState.cluster_label,
    before_cluster_method: oldState.cluster_method,
    before_cluster_confidence: oldState.cluster_confidence,
    before_parent_cluster_key: oldState.parent_cluster_key,
    after_cluster_key: newState.cluster_key,
    after_cluster_label: newState.cluster_label,
    after_cluster_method: newState.cluster_method,
    after_cluster_confidence: newState.cluster_confidence,
    after_parent_cluster_key: newState.parent_cluster_key,
    change_reason: options.changeReason ?? null,
  };
}
