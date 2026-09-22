create table public.topic_signal_events (
  id bigint generated always as identity primary key,
  topic_id bigint not null references public.trend_topics(id) on delete restrict,
  observed_at timestamptz not null default now(),
  event_type text not null check (event_type in (
    'baseline',
    'early_enter',
    'early_level_change',
    'early_exit',
    'now_enter',
    'now_exit',
    'source_change',
    'evidence_change'
  )),
  event_types text[] not null,
  previous_event_id bigint not null default 0,
  event_fingerprint text not null,
  cluster_key text,
  cluster_label text,
  cluster_method text,
  trend_score numeric not null,
  early_signal_score numeric not null,
  early_signal_level text not null,
  velocity_1h numeric not null,
  propagation_path text,
  is_now boolean not null,
  google_score numeric not null,
  news_score numeric not null,
  youtube_score numeric not null,
  source_count integer not null,
  evidence_score numeric,
  evidence_level text,
  evidence_source_count integer,
  google_count integer,
  news_count integer,
  youtube_count integer,
  cluster_snapshot_id bigint references public.trend_cluster_snapshots(id) on delete set null,
  created_at timestamptz not null default now(),
  check (cardinality(event_types) > 0),
  check (event_type = any(event_types)),
  check (event_types <@ array[
    'baseline',
    'early_enter',
    'early_level_change',
    'early_exit',
    'now_enter',
    'now_exit',
    'source_change',
    'evidence_change'
  ]::text[]),
  constraint topic_signal_events_state_unique
    unique (topic_id, previous_event_id, event_fingerprint)
);

create table public.topic_cluster_assignment_events (
  id bigint generated always as identity primary key,
  topic_id bigint not null references public.trend_topics(id) on delete restrict,
  changed_at timestamptz not null default now(),
  change_type text not null check (change_type in ('reclassify', 'split', 'merge')),
  change_set_id uuid not null default gen_random_uuid(),
  before_cluster_key text,
  before_cluster_label text,
  before_cluster_method text,
  before_cluster_confidence numeric,
  before_parent_cluster_key text,
  after_cluster_key text,
  after_cluster_label text,
  after_cluster_method text,
  after_cluster_confidence numeric,
  after_parent_cluster_key text,
  change_reason text,
  created_at timestamptz not null default now(),
  check (
    before_cluster_key is distinct from after_cluster_key
    or before_cluster_label is distinct from after_cluster_label
    or before_cluster_method is distinct from after_cluster_method
    or before_cluster_confidence is distinct from after_cluster_confidence
    or before_parent_cluster_key is distinct from after_parent_cluster_key
  )
);

create index topic_signal_events_topic_time_idx
  on public.topic_signal_events (topic_id, observed_at desc);

create index topic_signal_events_cluster_time_idx
  on public.topic_signal_events (cluster_key, observed_at desc)
  where cluster_key is not null;

create index topic_signal_events_type_time_idx
  on public.topic_signal_events (event_type, observed_at desc);

create index topic_cluster_assignment_events_topic_time_idx
  on public.topic_cluster_assignment_events (topic_id, changed_at desc);

create index topic_cluster_assignment_events_change_set_idx
  on public.topic_cluster_assignment_events (change_set_id);

create index topic_cluster_assignment_events_before_key_idx
  on public.topic_cluster_assignment_events (before_cluster_key, changed_at desc)
  where before_cluster_key is not null;

create index topic_cluster_assignment_events_after_key_idx
  on public.topic_cluster_assignment_events (after_cluster_key, changed_at desc)
  where after_cluster_key is not null;

create function public.set_topic_signal_event_fingerprint()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.event_fingerprint := md5(jsonb_build_object(
    'event_type', new.event_type,
    'event_types', new.event_types,
    'cluster_key', new.cluster_key,
    'cluster_label', new.cluster_label,
    'cluster_method', new.cluster_method,
    'trend_score', new.trend_score,
    'early_signal_score', new.early_signal_score,
    'early_signal_level', new.early_signal_level,
    'velocity_1h', new.velocity_1h,
    'propagation_path', new.propagation_path,
    'is_now', new.is_now,
    'google_score', new.google_score,
    'news_score', new.news_score,
    'youtube_score', new.youtube_score,
    'source_count', new.source_count,
    'evidence_score', new.evidence_score,
    'evidence_level', new.evidence_level,
    'evidence_source_count', new.evidence_source_count,
    'google_count', new.google_count,
    'news_count', new.news_count,
    'youtube_count', new.youtube_count
  )::text);
  return new;
end;
$$;

create trigger topic_signal_events_set_fingerprint
before insert on public.topic_signal_events
for each row execute function public.set_topic_signal_event_fingerprint();

create function public.capture_topic_cluster_assignment_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.topic_cluster_assignment_events (
    topic_id,
    change_type,
    before_cluster_key,
    before_cluster_label,
    before_cluster_method,
    before_cluster_confidence,
    before_parent_cluster_key,
    after_cluster_key,
    after_cluster_label,
    after_cluster_method,
    after_cluster_confidence,
    after_parent_cluster_key,
    change_reason
  ) values (
    new.id,
    'reclassify',
    old.cluster_key,
    old.cluster_label,
    old.cluster_method,
    old.cluster_confidence,
    old.metadata ->> 'parent_key',
    new.cluster_key,
    new.cluster_label,
    new.cluster_method,
    new.cluster_confidence,
    new.metadata ->> 'parent_key',
    'trend_topics assignment update'
  );
  return new;
end;
$$;

create trigger trend_topics_capture_cluster_assignment_change
after update of cluster_key, cluster_label, cluster_method, cluster_confidence, metadata
on public.trend_topics
for each row
when (
  old.cluster_key is distinct from new.cluster_key
  or old.cluster_label is distinct from new.cluster_label
  or old.cluster_method is distinct from new.cluster_method
  or old.cluster_confidence is distinct from new.cluster_confidence
  or (old.metadata ->> 'parent_key') is distinct from (new.metadata ->> 'parent_key')
)
execute function public.capture_topic_cluster_assignment_change();

alter table public.topic_signal_events enable row level security;
alter table public.topic_cluster_assignment_events enable row level security;

revoke all on table public.topic_signal_events from anon, authenticated;
revoke all on table public.topic_cluster_assignment_events from anon, authenticated;
grant all on table public.topic_signal_events to service_role;
grant all on table public.topic_cluster_assignment_events to service_role;
grant usage, select on sequence public.topic_signal_events_id_seq to service_role;
grant usage, select on sequence public.topic_cluster_assignment_events_id_seq to service_role;
revoke all on function public.set_topic_signal_event_fingerprint() from public, anon, authenticated;
revoke all on function public.capture_topic_cluster_assignment_change() from public, anon, authenticated;
grant execute on function public.set_topic_signal_event_fingerprint() to service_role;
grant execute on function public.capture_topic_cluster_assignment_change() to service_role;

comment on table public.topic_signal_events is
  'Material Trend Radar signal transitions only. One row may contain multiple simultaneous event types.';
comment on column public.topic_signal_events.event_types is
  'All transitions captured in this row. event_type is the primary transition for filtering.';
comment on table public.topic_cluster_assignment_events is
  'Append-only before/after history for actual topic cluster assignment changes. Initial assignments are not stored.';

-- Seed only the current observable state. Historical EARLY states are intentionally not inferred.
insert into public.topic_signal_events (
  topic_id,
  observed_at,
  event_type,
  event_types,
  cluster_key,
  cluster_label,
  cluster_method,
  trend_score,
  early_signal_score,
  early_signal_level,
  velocity_1h,
  propagation_path,
  is_now,
  google_score,
  news_score,
  youtube_score,
  source_count,
  evidence_score,
  evidence_level,
  evidence_source_count,
  google_count,
  news_count,
  youtube_count
)
select
  t.id,
  now(),
  'baseline',
  array['baseline']::text[],
  t.cluster_key,
  t.cluster_label,
  t.cluster_method,
  coalesce(t.cluster_trend_score, 0),
  coalesce(t.early_signal_score, 0),
  coalesce(t.early_signal_level, 'none'),
  coalesce(t.velocity_1h, 0),
  t.propagation_path,
  coalesce(t.cluster_trend_score, 0) >= 60,
  coalesce(t.cluster_google_score, 0),
  coalesce(t.cluster_news_score, 0),
  coalesce(t.cluster_youtube_score, 0),
  coalesce(t.cluster_source_count, 0),
  e.evidence_score,
  e.evidence_level,
  e.source_count,
  e.google_count,
  e.news_count,
  e.youtube_count
from public.trend_topics t
left join public.topic_evidence e on e.topic_id = t.id
where t.early_signal_level <> 'none'
   or t.cluster_trend_score >= 60;
