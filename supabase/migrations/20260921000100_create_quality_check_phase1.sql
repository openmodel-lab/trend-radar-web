create table public.quality_check_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  window_start timestamptz not null,
  window_end timestamptz not null,
  model text not null,
  prompt_version text not null,
  input_schema_version text not null,
  batch_size integer not null default 20 check (batch_size between 1 and 30),
  topic_count integer not null default 0 check (topic_count >= 0),
  processed_count integer not null default 0 check (processed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  reused_count integer not null default 0 check (reused_count >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_summary text,
  created_at timestamptz not null default now(),
  check (window_end > window_start)
);

create table public.quality_check_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.quality_check_runs(id) on delete restrict,
  batch_id uuid not null,
  topic_id bigint references public.trend_topics(id) on delete set null,
  topic_name text not null,
  cluster_key text,
  cluster_label text,
  quality text check (quality in ('正常', 'ノイズ', '曖昧', '表示名補正', '重複候補', '判定不能')),
  reason text,
  suggested_name text,
  hide_candidate boolean,
  confidence numeric(4,3) check (confidence between 0 and 1),
  status text not null check (status in ('succeeded', 'reused', 'failed')),
  model text not null,
  prompt_version text not null,
  input_schema_version text not null,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  source_snapshot jsonb not null,
  reused_from_id uuid references public.quality_check_results(id) on delete set null,
  error_code text,
  error_message text,
  checked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (run_id, topic_id),
  check (
    (status in ('succeeded', 'reused') and quality is not null and reason is not null and hide_candidate is not null and confidence is not null)
    or
    (status = 'failed' and error_code is not null)
  )
);

create index quality_check_results_cache_lookup_idx
  on public.quality_check_results (
    topic_id,
    model,
    prompt_version,
    input_schema_version,
    input_hash,
    checked_at desc
  )
  where status in ('succeeded', 'reused');

create index quality_check_results_run_batch_idx
  on public.quality_check_results (run_id, batch_id);

create index quality_check_results_reused_from_idx
  on public.quality_check_results (reused_from_id)
  where reused_from_id is not null;

alter table public.quality_check_runs enable row level security;
alter table public.quality_check_results enable row level security;

revoke all on table public.quality_check_runs from anon, authenticated;
revoke all on table public.quality_check_results from anon, authenticated;
grant all on table public.quality_check_runs to service_role;
grant all on table public.quality_check_results to service_role;

comment on table public.quality_check_runs is
  'Shadow-mode Gemini quality-check executions. Does not change Trend Radar topics, clusters, scores, or visibility.';
comment on table public.quality_check_results is
  'Shadow-mode Gemini quality-check results. Advisory only; no automatic application to Trend Radar.';
comment on column public.quality_check_results.input_hash is
  'SHA-256 of the normalized topic input and input_schema_version only. Daily window bounds are intentionally excluded.';
