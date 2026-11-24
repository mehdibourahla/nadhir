begin;
set local search_path = public, extensions;
select plan(83);

-- ---------------------------------------------------------------------------
-- 1. Seed realistic constraint-compliant fixtures across ALL 6 cold tables
--    covering 2026-11-26T03:17:00Z and 2026-11-27T03:17:00Z boundaries
-- ---------------------------------------------------------------------------
insert into public.source_contracts (
  key, version, label, family, criticality, freshness_basis, cadence_minutes,
  warning_after_minutes, stale_after_minutes, parser_version, licence, attribution,
  owner, execution_target
)
values (
  'test.cold.m1b', 1, 'Cold M1B 2026-11-26 fixture', 'reference_enrichment',
  'optional', 'last_success_at', 5, 10, 20, 'm1b-v1', 'test', 'test', 'test', 'worker'
);

create temp table m1b_ctx as
select
  (select id from public.admin_units where level = 'commune' order by id limit 1) as commune_id,
  jsonb_build_object(
    'source', 'open-meteo',
    'model', 'best_match',
    'hours', (
      select jsonb_agg(jsonb_build_object('h', g, 'temp_c', 28))
      from generate_series(0, 47) g
    )
  ) as weather_evidence;

-- Table 6: source_jobs (92d retention, execution_target = 'worker')
-- 2026-08-25: eligible at 2026-11-26T03:17:00Z (2026-11-26 - 92 = 2026-08-26 -> < 2026-08-26)
-- 2026-08-26: hot at 2026-11-26, eligible at 2026-11-27
-- 2026-08-27: hot at 2026-11-27
insert into public.source_jobs (
  id, contract_key, contract_version, trigger_kind, idempotency_key,
  scheduled_for, data_from, data_through, execution_target, state,
  enqueued_by, available_at, attempt_count, max_attempts, retry_base_seconds,
  retry_until, started_at, finished_at, created_at, updated_at
)
values
  -- 2026-08-25 eligible standalone succeeded + failed
  ('30000000-0000-4000-8000-000000000601', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-succeeded',
    '2026-08-25T05:00:00Z', '2026-08-25T04:00:00Z', '2026-08-25T05:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-25T05:00:00Z', 1, 3, 5, '2026-08-25T06:00:00Z',
    '2026-08-25T05:00:01Z', '2026-08-25T05:00:10Z', '2026-08-25T05:00:00Z', '2026-08-25T05:00:10Z'),
  ('30000000-0000-4000-8000-000000000602', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-failed',
    '2026-08-25T23:59:59Z', '2026-08-25T23:00:00Z', '2026-08-25T23:59:59Z', 'worker', 'failed',
    array['worker'], '2026-08-25T23:59:59Z', 3, 3, 5, '2026-08-26T00:30:00Z',
    '2026-08-25T23:59:59Z', '2026-08-26T00:00:05Z', '2026-08-25T23:59:59Z', '2026-08-26T00:00:05Z'),
  -- 2026-08-25 non-terminal states (MUST stay hot)
  ('30000000-0000-4000-8000-000000000603', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-queued',
    '2026-08-25T06:00:00Z', '2026-08-25T05:00:00Z', '2026-08-25T06:00:00Z', 'worker', 'queued',
    array['worker'], '2026-08-25T06:00:00Z', 0, 3, 5, '2026-08-25T07:00:00Z',
    null, null, '2026-08-25T06:00:00Z', '2026-08-25T06:00:00Z'),
  ('30000000-0000-4000-8000-000000000604', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-running',
    '2026-08-25T07:00:00Z', '2026-08-25T06:00:00Z', '2026-08-25T07:00:00Z', 'worker', 'running',
    array['worker'], '2026-08-25T07:00:00Z', 1, 3, 5, '2026-08-25T08:00:00Z',
    '2026-08-25T07:00:01Z', null, '2026-08-25T07:00:00Z', '2026-08-25T07:00:01Z'),
  ('30000000-0000-4000-8000-000000000605', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-retry',
    '2026-08-25T08:00:00Z', '2026-08-25T07:00:00Z', '2026-08-25T08:00:00Z', 'worker', 'retry_wait',
    array['worker'], '2026-08-25T08:05:00Z', 1, 3, 5, '2026-08-25T09:00:00Z',
    '2026-08-25T08:00:01Z', null, '2026-08-25T08:00:00Z', '2026-08-25T08:00:05Z'),
  -- 2026-08-25 cascading-unblock job (referenced by eligible 2026-08-27 source_runs row)
  ('30000000-0000-4000-8000-000000000606', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-cascade',
    '2026-08-25T09:00:00Z', '2026-08-25T08:00:00Z', '2026-08-25T09:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-25T09:00:00Z', 1, 3, 5, '2026-08-25T10:00:00Z',
    '2026-08-25T09:00:01Z', '2026-08-25T09:00:05Z', '2026-08-25T09:00:00Z', '2026-08-25T09:00:05Z'),
  -- 2026-08-25 FK-protected by surviving source_runs / weather_snapshots / civil_investigations
  ('30000000-0000-4000-8000-000000000607', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-fk-run',
    '2026-08-25T10:00:00Z', '2026-08-25T09:00:00Z', '2026-08-25T10:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-25T10:00:00Z', 1, 3, 5, '2026-08-25T11:00:00Z',
    '2026-08-25T10:00:01Z', '2026-08-25T10:00:05Z', '2026-08-25T10:00:00Z', '2026-08-25T10:00:05Z'),
  ('30000000-0000-4000-8000-000000000608', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-fk-weather',
    '2026-08-25T11:00:00Z', '2026-08-25T10:00:00Z', '2026-08-25T11:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-25T11:00:00Z', 1, 3, 5, '2026-08-25T12:00:00Z',
    '2026-08-25T11:00:01Z', '2026-08-25T11:00:05Z', '2026-08-25T11:00:00Z', '2026-08-25T11:00:05Z'),
  ('30000000-0000-4000-8000-000000000609', 'test.cold.m1b', 1, 'manual', 'm1b-job-0825-fk-civil',
    '2026-08-25T12:00:00Z', '2026-08-25T11:00:00Z', '2026-08-25T12:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-25T12:00:00Z', 1, 3, 5, '2026-08-25T13:00:00Z',
    '2026-08-25T12:00:01Z', '2026-08-25T12:00:05Z', '2026-08-25T12:00:00Z', '2026-08-25T12:00:05Z'),
  -- 2026-08-26: hot boundary at 2026-11-26, eligible at 2026-11-27
  ('30000000-0000-4000-8000-000000000610', 'test.cold.m1b', 1, 'manual', 'm1b-job-0826-boundary',
    '2026-08-26T00:00:00Z', '2026-08-25T23:00:00Z', '2026-08-26T00:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-26T00:00:00Z', 1, 3, 5, '2026-08-26T01:00:00Z',
    '2026-08-26T00:00:01Z', '2026-08-26T00:00:05Z', '2026-08-26T00:00:00Z', '2026-08-26T00:00:05Z'),
  -- 2026-08-27: hot boundary at 2026-11-27
  ('30000000-0000-4000-8000-000000000611', 'test.cold.m1b', 1, 'manual', 'm1b-job-0827-hot',
    '2026-08-27T00:00:00Z', '2026-08-26T23:00:00Z', '2026-08-27T00:00:00Z', 'worker', 'succeeded',
    array['worker'], '2026-08-27T00:00:00Z', 1, 3, 5, '2026-08-27T01:00:00Z',
    '2026-08-27T00:00:01Z', '2026-08-27T00:00:05Z', '2026-08-27T00:00:00Z', '2026-08-27T00:00:05Z');

-- Civil investigation referencing job ...0609
insert into public.ita_reports (
  id, source_post_id, source_page, source_url, published_at, content_hash, body, raw
)
values (
  '30000000-0000-4000-8000-000000000701',
  'm1b-ita-post-1',
  'm1b_test_page',
  'https://example.invalid/m1b-1',
  '2026-08-25T12:00:00Z',
  repeat('1', 64),
  'M1B fixture civil report',
  '{"fixture": true}'::jsonb
);
insert into public.civil_investigations (
  id, report_id, incident_index, state, job_id, job_attempt
)
values (
  '30000000-0000-4000-8000-000000000702',
  '30000000-0000-4000-8000-000000000701',
  0,
  'pending',
  '30000000-0000-4000-8000-000000000609',
  1
);

-- Table 1: weather_snapshots (90d retention, scheduled_at)
insert into public.weather_snapshots (id, commune_id, scheduled_at, fetched_at, job_id, evidence)
select v.id, ctx.commune_id, v.scheduled_at, v.scheduled_at + interval '1 minute', v.job_id, ctx.weather_evidence
from m1b_ctx ctx, (values
  ('30000000-0000-4000-8000-000000000101'::uuid, '2026-08-27T06:00:00Z'::timestamptz, null::uuid),
  ('30000000-0000-4000-8000-000000000102'::uuid, '2026-08-27T23:59:59Z'::timestamptz, null::uuid),
  ('30000000-0000-4000-8000-000000000103'::uuid, '2026-08-28T00:00:00Z'::timestamptz, null::uuid),
  ('30000000-0000-4000-8000-000000000104'::uuid, '2026-08-29T12:00:00Z'::timestamptz, '30000000-0000-4000-8000-000000000608'::uuid)
) v(id, scheduled_at, job_id);

-- Table 2: risk_forecasts (90d retention, created_at)
insert into public.risk_publications (snapshot_id, base_date, scheduled_for, published_at, row_count)
values
  ('30000000-0000-4000-8000-000000000251', '2026-08-27', '2026-08-27T04:00:00Z', '2026-08-27T04:05:00Z', 1),
  ('30000000-0000-4000-8000-000000000252', '2026-08-27', '2026-08-27T12:00:00Z', '2026-08-27T12:05:00Z', 1),
  ('30000000-0000-4000-8000-000000000253', '2026-08-28', '2026-08-28T00:00:00Z', '2026-08-28T00:05:00Z', 1),
  ('30000000-0000-4000-8000-000000000254', '2026-08-29', '2026-08-29T06:00:00Z', '2026-08-29T06:05:00Z', 1);

insert into public.risk_publication_checkpoint (key, snapshot_id, base_date, scheduled_for, published_at)
values ('local_fwi', '30000000-0000-4000-8000-000000000252', '2026-08-27', '2026-08-27T12:00:00Z', '2026-08-27T12:05:00Z')
on conflict (key) do update set
  snapshot_id = excluded.snapshot_id,
  base_date = excluded.base_date,
  scheduled_for = excluded.scheduled_for,
  published_at = excluded.published_at;

insert into public.risk_forecasts (
  id, snapshot_id, commune_id, forecast_date, horizon_days, source, fwi, danger_level, created_at
)
select v.id, v.snapshot_id, ctx.commune_id, v.forecast_date, v.horizon_days, 'local_fwi', 18.5, 3, v.created_at
from m1b_ctx ctx, (values
  ('30000000-0000-4000-8000-000000000201'::uuid, '30000000-0000-4000-8000-000000000251'::uuid, '2026-08-27'::date, 0, '2026-08-27T04:05:00Z'::timestamptz),
  ('30000000-0000-4000-8000-000000000202'::uuid, '30000000-0000-4000-8000-000000000252'::uuid, '2026-08-27'::date, 0, '2026-08-27T12:05:00Z'::timestamptz),
  ('30000000-0000-4000-8000-000000000203'::uuid, null::uuid,                                   '2026-08-27'::date, 1, '2026-08-27T23:59:59Z'::timestamptz),
  ('30000000-0000-4000-8000-000000000204'::uuid, '30000000-0000-4000-8000-000000000253'::uuid, '2026-08-28'::date, 0, '2026-08-28T00:00:00Z'::timestamptz),
  ('30000000-0000-4000-8000-000000000205'::uuid, '30000000-0000-4000-8000-000000000254'::uuid, '2026-08-29'::date, 0, '2026-08-29T06:05:00Z'::timestamptz)
) v(id, snapshot_id, forecast_date, horizon_days, created_at);

-- Table 3: broadcast_audit (90d retention, at)
insert into public.broadcast_audit (id, at, action, reason, actor_id)
values
  ('30000000-0000-4000-8000-000000000301', '2026-08-27T04:00:00Z', 'published', 'm1b_fixture', null),
  ('30000000-0000-4000-8000-000000000302', '2026-08-27T23:59:59Z', 'suppressed', 'm1b_fixture', null),
  ('30000000-0000-4000-8000-000000000303', '2026-08-28T00:00:00Z', 'suppressed', 'm1b_fixture', null),
  ('30000000-0000-4000-8000-000000000304', '2026-08-29T08:00:00Z', 'published', 'm1b_fixture', null);

-- Table 4: airport_observations (90d retention, observed_at)
insert into public.airport_observations (id, station, name, lat, lon, observed_at, raw)
values
  ('30000000-0000-4000-8000-000000000401', 'DAAG', 'Algiers', 36.691, 3.215, '2026-08-27T06:00:00Z', 'METAR DAAG 270600Z'),
  ('30000000-0000-4000-8000-000000000402', 'DAOO', 'Oran',    35.624, -0.621, '2026-08-27T23:59:59Z', 'METAR DAOO 272359Z'),
  ('30000000-0000-4000-8000-000000000403', 'DAAG', 'Algiers', 36.691, 3.215, '2026-08-28T00:00:00Z', 'METAR DAAG 280000Z'),
  ('30000000-0000-4000-8000-000000000404', 'DAOO', 'Oran',    35.624, -0.621, '2026-08-29T12:00:00Z', 'METAR DAOO 291200Z');

-- Table 5: source_runs (90d retention, started_at)
-- 2026-08-25 has 1 eligible run; 2026-08-26 has 0 rows (empty day!); 2026-08-27 has 1 eligible (linked to job ...0606) + 1 running + 1 gap-resolved
insert into public.source_runs (
  id, contract_key, contract_version, trigger_kind, idempotency_key,
  scheduled_for, started_at, finished_at, outcome, records_seen, job_id, attempt
)
values
  ('30000000-0000-4000-8000-000000000500', 'test.cold.m1b', 1, 'manual', 'm1b-retire-0825',
    '2026-08-25T10:00:00Z', '2026-08-25T10:00:00Z', '2026-08-25T10:01:00Z', 'succeeded', 1, null, null),
  ('30000000-0000-4000-8000-000000000501', 'test.cold.m1b', 1, 'manual', 'm1b-retire-0827',
    '2026-08-27T05:00:00Z', '2026-08-27T05:00:00Z', '2026-08-27T05:01:00Z', 'succeeded', 2, '30000000-0000-4000-8000-000000000606', 1),
  ('30000000-0000-4000-8000-000000000502', 'test.cold.m1b', 1, 'manual', 'm1b-running-0827',
    '2026-08-27T06:00:00Z', '2026-08-27T06:00:00Z', null, 'running', 0, null, null),
  ('30000000-0000-4000-8000-000000000503', 'test.cold.m1b', 1, 'manual', 'm1b-gap-0827',
    '2026-08-27T07:00:00Z', '2026-08-27T07:00:00Z', '2026-08-27T07:01:00Z', 'succeeded', 1, null, null),
  ('30000000-0000-4000-8000-000000000504', 'test.cold.m1b', 1, 'manual', 'm1b-retire-0828',
    '2026-08-28T00:00:00Z', '2026-08-28T00:00:00Z', '2026-08-28T00:01:00Z', 'succeeded', 1, null, null),
  ('30000000-0000-4000-8000-000000000505', 'test.cold.m1b', 1, 'manual', 'm1b-hot-0829',
    '2026-08-29T08:00:00Z', '2026-08-29T08:00:00Z', '2026-08-29T08:01:00Z', 'succeeded', 1, '30000000-0000-4000-8000-000000000607', 1);

insert into public.source_gaps (contract_key, data_from, data_through, state, resolved_by_run_id)
values ('test.cold.m1b', '2026-08-27T06:00:00Z', '2026-08-27T07:00:00Z', 'resolved', '30000000-0000-4000-8000-000000000503');

-- Helper function (temp) for computing C-locale digest
create function pg_temp.cand_digest(_table text, _day date) returns text
language sql as $$
  select md5(string_agg(id::text, ',' order by id::text collate "C"))
  from private.cold_candidates(_table, _day);
$$;

-- ---------------------------------------------------------------------------
-- 2. Exact 2026-11-26T03:17:00Z pending-days boundary across ALL 6 tables
--    (proves strict UTC < as_of - hot_days: 90d -> 2026-08-27 eligible / 2026-08-28 hot;
--     92d source_jobs -> 2026-08-25 eligible / 2026-08-26 hot)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('weather_snapshots', '2026-11-26T03:17:00Z') d),
  array['2026-08-27'::date],
  '2026-11-26: weather_snapshots pending is only 2026-08-27 (2026-08-28 stays hot)'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('risk_forecasts', '2026-11-26T03:17:00Z') d),
  array['2026-08-27'::date],
  '2026-11-26: risk_forecasts pending is only 2026-08-27'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('broadcast_audit', '2026-11-26T03:17:00Z') d),
  array['2026-08-27'::date],
  '2026-11-26: broadcast_audit pending is only 2026-08-27'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('airport_observations', '2026-11-26T03:17:00Z') d),
  array['2026-08-27'::date],
  '2026-11-26: airport_observations pending is only 2026-08-27'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('source_runs', '2026-11-26T03:17:00Z') d),
  array['2026-08-25'::date, '2026-08-26'::date, '2026-08-27'::date],
  '2026-11-26: source_runs pending includes 2026-08-25, empty 2026-08-26, and 2026-08-27 (not 2026-08-28)'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('source_jobs', '2026-11-26T03:17:00Z') d),
  array['2026-08-25'::date],
  '2026-11-26: source_jobs (92d) pending is only 2026-08-25 (2026-08-26 stays hot)'
);

-- Non-UTC offset handling on _as_of (proves UTC conversion before ::date cutoff)
select throws_ok(
  $$select private.cold_archive_commit_as_of('weather_snapshots', '2026-08-27', 0, null, null, null, null, '2026-11-26T00:30:00+01:00')$$,
  '22023', 'cold_day_still_hot',
  'non-UTC offset: 2026-11-26T00:30:00+01:00 (= 2026-11-25T23:30:00Z) treats 2026-08-27 as hot'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('weather_snapshots', '2026-11-26T01:00:00+01:00') d),
  array['2026-08-27'::date],
  'non-UTC offset: 2026-11-26T01:00:00+01:00 (= 2026-11-26T00:00:00Z) returns 2026-08-27 as pending'
);

-- Verify exact UTC midnight candidate assignment (23:59:59Z on 08-27 vs 00:00:00Z on 08-28)
select is(
  (select array_agg(id order by id::text collate "C") from private.cold_candidates('weather_snapshots', '2026-08-27')),
  array['30000000-0000-4000-8000-000000000101'::uuid, '30000000-0000-4000-8000-000000000102'::uuid],
  'UTC boundary: weather_snapshots 23:59:59Z belongs to 2026-08-27, not 2026-08-28'
);
select is(
  (select array_agg(id order by id::text collate "C") from private.cold_candidates('risk_forecasts', '2026-08-27')),
  array['30000000-0000-4000-8000-000000000201'::uuid, '30000000-0000-4000-8000-000000000203'::uuid],
  'risk_forecasts candidates include historical + legacy NULL snapshot and exclude active checkpoint'
);
select is(
  (select array_agg(id order by id::text collate "C") from private.cold_candidates('source_runs', '2026-08-27')),
  array['30000000-0000-4000-8000-000000000501'::uuid],
  'source_runs candidates exclude outcome=running and source_gaps.resolved_by_run_id'
);
-- Before source_runs 2026-08-27 is archived, job ...0606 is still blocked by run ...0501
select is(
  (select array_agg(id order by id::text collate "C") from private.cold_candidates('source_jobs', '2026-08-25')),
  array['30000000-0000-4000-8000-000000000601'::uuid, '30000000-0000-4000-8000-000000000602'::uuid],
  'source_jobs candidates exclude non-terminal states and all 3 FK-referenced jobs before run archival'
);

-- ---------------------------------------------------------------------------
-- 3. Unknown table, null _as_of, hot-boundary rejections & ALL rollback modes
-- ---------------------------------------------------------------------------
select throws_ok(
  $$select * from private.cold_pending_days_as_of('no_such_table', '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_table_unknown',
  'unknown table rejected on cold_pending_days_as_of'
);
select throws_ok(
  $$select * from private.cold_candidates('no_such_table', '2026-08-27')$$,
  '22023', 'cold_table_unknown',
  'unknown table rejected on cold_candidates'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('no_such_table', '2026-08-27', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_table_unknown',
  'unknown table rejected on cold_archive_commit_as_of'
);
select throws_ok(
  $$select * from private.cold_pending_days_as_of('broadcast_audit', null)$$,
  '22004', 'cold_as_of_required',
  'null _as_of rejected on cold_pending_days_as_of'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-27', 0, null, null, null, null, null)$$,
  '22004', 'cold_as_of_required',
  'null _as_of rejected on cold_archive_commit_as_of'
);

-- Hot boundary rejections at 2026-11-26T03:17:00Z across all 6 tables
select throws_ok(
  $$select private.cold_archive_commit_as_of('weather_snapshots', '2026-08-28', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-26: weather_snapshots 2026-08-28 rejected as hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('risk_forecasts', '2026-08-28', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-26: risk_forecasts 2026-08-28 rejected as hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-28', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-26: broadcast_audit 2026-08-28 rejected as hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('airport_observations', '2026-08-28', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-26: airport_observations 2026-08-28 rejected as hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('source_runs', '2026-08-28', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-26: source_runs 2026-08-28 rejected as hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('source_jobs', '2026-08-26', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-26: source_jobs 2026-08-26 rejected as hot (92d window)'
);

-- Absent Storage object test BEFORE inserting storage objects
select throws_ok(
  format(
    $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-27', 2, %L, %L, 128, 'cold/broadcast_audit/2026/08/27.parquet', '2026-11-26T03:17:00Z')$$,
    pg_temp.cand_digest('broadcast_audit', '2026-08-27'), repeat('a', 64)
  ),
  'P0002', 'cold_file_missing',
  'missing Storage object aborts commit with P0002'
);

-- Insert Storage objects for 2026-08-25..28 eligible commits + invalid path test object
insert into storage.objects (bucket_id, name, metadata)
values
  ('cold-archive', 'cold/weather_snapshots/2026/08/27.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/weather_snapshots/2026/08/28.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/risk_forecasts/2026/08/27.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/risk_forecasts/2026/08/28.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/broadcast_audit/2026/08/27.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/broadcast_audit/2026/08/28.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/airport_observations/2026/08/27.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/airport_observations/2026/08/28.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/source_runs/2026/08/25.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/source_runs/2026/08/27.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/source_runs/2026/08/28.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/source_jobs/2026/08/25.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/source_jobs/2026/08/26.parquet', '{"size": 128}'::jsonb),
  ('cold-archive', 'cold/invalid_path.parquet', '{"size": 128}'::jsonb);

-- Remaining rollback failure modes on broadcast_audit 2026-08-27
select throws_ok(
  format(
    $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-27', 2, %L, %L, 999, 'cold/broadcast_audit/2026/08/27.parquet', '2026-11-26T03:17:00Z')$$,
    pg_temp.cand_digest('broadcast_audit', '2026-08-27'), repeat('a', 64)
  ),
  'P0002', 'cold_file_missing',
  'wrong byte size aborts commit with P0002'
);
select throws_ok(
  format(
    $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-27', 3, %L, %L, 128, 'cold/broadcast_audit/2026/08/27.parquet', '2026-11-26T03:17:00Z')$$,
    pg_temp.cand_digest('broadcast_audit', '2026-08-27'), repeat('a', 64)
  ),
  'P0001', 'cold_export_mismatch',
  'wrong row count aborts commit with P0001'
);
select throws_ok(
  format(
    $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-27', 2, %L, %L, 128, 'cold/broadcast_audit/2026/08/27.parquet', '2026-11-26T03:17:00Z')$$,
    md5('wrong-digest'), repeat('a', 64)
  ),
  'P0001', 'cold_export_mismatch',
  'wrong key_digest aborts commit with P0001'
);
select throws_ok(
  format(
    $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-27', 2, %L, %L, 128, 'cold/invalid_path.parquet', '2026-11-26T03:17:00Z')$$,
    pg_temp.cand_digest('broadcast_audit', '2026-08-27'), repeat('a', 64)
  ),
  '23514', null,
  'invalid storage path aborts commit with 23514'
);

-- Verify rollback integrity: 0 rows deleted, 0 manifests, broadcast_audit still undeletable
select is(
  (select count(*) from public.broadcast_audit where reason = 'm1b_fixture'),
  4::bigint,
  'all rollback failures deleted zero broadcast_audit rows'
);
select is(
  (select count(*) from public.cold_exports where table_name = 'broadcast_audit' and day = '2026-08-27'),
  0::bigint,
  'all rollback failures created zero cold_exports manifests'
);
select throws_ok(
  $$delete from public.broadcast_audit where id = '30000000-0000-4000-8000-000000000301'$$,
  'P0001', 'broadcast_audit is append-only',
  'broadcast_audit remains undeletable after failed commits'
);

-- ---------------------------------------------------------------------------
-- 4. Commit ALL 6 tables at 2026-11-26T03:17:00Z (in canonical order: runs before jobs)
-- ---------------------------------------------------------------------------
select is(
  private.cold_archive_commit_as_of(
    'weather_snapshots', '2026-08-27', 2,
    pg_temp.cand_digest('weather_snapshots', '2026-08-27'), repeat('1', 64), 128,
    'cold/weather_snapshots/2026/08/27.parquet', '2026-11-26T03:17:00Z'
  ),
  2::bigint, '2026-11-26: weather_snapshots 2026-08-27 archives 2 rows'
);
select is(
  private.cold_archive_commit_as_of(
    'risk_forecasts', '2026-08-27', 2,
    pg_temp.cand_digest('risk_forecasts', '2026-08-27'), repeat('2', 64), 128,
    'cold/risk_forecasts/2026/08/27.parquet', '2026-11-26T03:17:00Z'
  ),
  2::bigint, '2026-11-26: risk_forecasts 2026-08-27 archives historical + legacy NULL rows (2 rows)'
);
select is(
  private.cold_archive_commit_as_of(
    'broadcast_audit', '2026-08-27', 2,
    pg_temp.cand_digest('broadcast_audit', '2026-08-27'), repeat('3', 64), 128,
    'cold/broadcast_audit/2026/08/27.parquet', '2026-11-26T03:17:00Z'
  ),
  2::bigint, '2026-11-26: broadcast_audit 2026-08-27 archives 2 rows'
);
select is(
  private.cold_archive_commit_as_of(
    'airport_observations', '2026-08-27', 2,
    pg_temp.cand_digest('airport_observations', '2026-08-27'), repeat('4', 64), 128,
    'cold/airport_observations/2026/08/27.parquet', '2026-11-26T03:17:00Z'
  ),
  2::bigint, '2026-11-26: airport_observations 2026-08-27 archives 2 rows'
);
-- source_runs: 2026-08-25 (1 row), 2026-08-26 (EMPTY 0-row day, no Storage object), 2026-08-27 (1 row -> unblocks job ...0606!)
select is(
  private.cold_archive_commit_as_of(
    'source_runs', '2026-08-25', 1,
    pg_temp.cand_digest('source_runs', '2026-08-25'), repeat('5', 64), 128,
    'cold/source_runs/2026/08/25.parquet', '2026-11-26T03:17:00Z'
  ),
  1::bigint, '2026-11-26: source_runs 2026-08-25 archives 1 row'
);
select is(
  private.cold_archive_commit_as_of(
    'source_runs', '2026-08-26', 0, null, null, null, null, '2026-11-26T03:17:00Z'
  ),
  0::bigint, '2026-11-26: empty day (0 rows, null metadata, no Storage object) commits cleanly'
);
select is(
  (select count(*) from public.cold_exports where table_name = 'source_runs' and day = '2026-08-26' and rows = 0 and path is null),
  1::bigint, 'empty-day manifest row persisted with null metadata'
);
select is(
  private.cold_archive_commit_as_of(
    'source_runs', '2026-08-27', 1,
    pg_temp.cand_digest('source_runs', '2026-08-27'), repeat('6', 64), 128,
    'cold/source_runs/2026/08/27.parquet', '2026-11-26T03:17:00Z'
  ),
  1::bigint, '2026-11-26: source_runs 2026-08-27 archives 1 row and retires key'
);

-- Cascading unblocking: job ...0606 is NOW a candidate for source_jobs 2026-08-25!
select is(
  (select array_agg(id order by id::text collate "C") from private.cold_candidates('source_jobs', '2026-08-25')),
  array[
    '30000000-0000-4000-8000-000000000601'::uuid,
    '30000000-0000-4000-8000-000000000602'::uuid,
    '30000000-0000-4000-8000-000000000606'::uuid
  ],
  'cascading unblock: archiving source_runs 2026-08-27 makes job ...0606 eligible on 2026-08-25'
);
select is(
  private.cold_archive_commit_as_of(
    'source_jobs', '2026-08-25', 3,
    pg_temp.cand_digest('source_jobs', '2026-08-25'), repeat('7', 64), 128,
    'cold/source_jobs/2026/08/25.parquet', '2026-11-26T03:17:00Z'
  ),
  3::bigint, '2026-11-26: source_jobs 2026-08-25 archives 3 rows (succeeded + failed + unblocked)'
);

-- ---------------------------------------------------------------------------
-- 5. Verify ALL FK/active protections, immutability, retired key guard & idempotency
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(id order by id::text collate "C") from public.risk_forecasts where id in (
    '30000000-0000-4000-8000-000000000201', '30000000-0000-4000-8000-000000000202',
    '30000000-0000-4000-8000-000000000203', '30000000-0000-4000-8000-000000000204',
    '30000000-0000-4000-8000-000000000205')),
  array[
    '30000000-0000-4000-8000-000000000202'::uuid,
    '30000000-0000-4000-8000-000000000204'::uuid,
    '30000000-0000-4000-8000-000000000205'::uuid
  ],
  'risk_forecasts: active checkpoint + hot rows survived; historical & legacy NULL left'
);
select throws_ok(
  $$delete from public.risk_forecasts where id = '30000000-0000-4000-8000-000000000202'$$,
  '55000', 'published_risk_forecast_is_immutable',
  'active checkpoint forecast stays undeletable on archived day'
);
select throws_ok(
  $$update public.risk_forecasts set fwi = 99 where id = '30000000-0000-4000-8000-000000000202'$$,
  '55000', 'published_risk_forecast_is_immutable',
  'UPDATE on published forecast on archived day still raises 55000'
);

select is(
  (select array_agg(idempotency_key order by idempotency_key) from public.source_runs where contract_key = 'test.cold.m1b'),
  array['m1b-gap-0827', 'm1b-hot-0829', 'm1b-retire-0828', 'm1b-running-0827'],
  'source_runs: running, gap-resolved, and hot rows survived'
);
select is(
  (select array_agg(idempotency_key order by idempotency_key) from public.source_run_retired_keys where idempotency_key like 'm1b-%'),
  array['m1b-retire-0825', 'm1b-retire-0827'],
  'source_run_retired_keys recorded archived idempotency keys'
);
select throws_ok(
  $$insert into public.source_runs (contract_key, contract_version, trigger_kind, idempotency_key, scheduled_for, started_at, outcome)
    values ('test.cold.m1b', 1, 'manual', 'm1b-retire-0827', now(), now(), 'succeeded')$$,
  '23514', 'retired_source_run_key',
  'guard_retired_run blocks re-insertion of retired idempotency_key'
);

select is(
  (select array_agg(id order by id::text collate "C") from public.source_jobs where contract_key = 'test.cold.m1b'),
  array[
    '30000000-0000-4000-8000-000000000603'::uuid,
    '30000000-0000-4000-8000-000000000604'::uuid,
    '30000000-0000-4000-8000-000000000605'::uuid,
    '30000000-0000-4000-8000-000000000607'::uuid,
    '30000000-0000-4000-8000-000000000608'::uuid,
    '30000000-0000-4000-8000-000000000609'::uuid,
    '30000000-0000-4000-8000-000000000610'::uuid,
    '30000000-0000-4000-8000-000000000611'::uuid
  ],
  'source_jobs: queued/running/retry_wait, all 3 FK-protected jobs, and hot boundary jobs survived'
);

-- Idempotency at 2026-11-26T03:17:00Z
select is(
  (select count(*) from private.cold_pending_days_as_of('source_runs', '2026-11-26T03:17:00Z')),
  0::bigint, 'archived days disappear from cold_pending_days_as_of (including empty day)'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('source_runs', '2026-08-26', 0, null, null, null, null, '2026-11-26T03:17:00Z')$$,
  '23505', null, 'duplicate commit raises 23505'
);

-- ---------------------------------------------------------------------------
-- 6. Exact 2026-11-27T03:17:00Z follow-on boundary (proves 2026-08-28 leaves for 90d,
--    2026-08-26 leaves for 92d source_jobs, while 2026-08-29 / 2026-08-27 stay hot)
-- ---------------------------------------------------------------------------
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('weather_snapshots', '2026-11-27T03:17:00Z') d),
  array['2026-08-28'::date], '2026-11-27: weather_snapshots pending advances to 2026-08-28'
);
select is(
  (select array_agg(d order by d) from private.cold_pending_days_as_of('source_jobs', '2026-11-27T03:17:00Z') d),
  array['2026-08-26'::date], '2026-11-27: source_jobs pending advances to 2026-08-26'
);

select is(
  private.cold_archive_commit_as_of(
    'weather_snapshots', '2026-08-28', 1,
    pg_temp.cand_digest('weather_snapshots', '2026-08-28'), repeat('a', 64), 128,
    'cold/weather_snapshots/2026/08/28.parquet', '2026-11-27T03:17:00Z'
  ),
  1::bigint, '2026-11-27: weather_snapshots 2026-08-28 archives cleanly'
);
select is(
  private.cold_archive_commit_as_of(
    'risk_forecasts', '2026-08-28', 1,
    pg_temp.cand_digest('risk_forecasts', '2026-08-28'), repeat('b', 64), 128,
    'cold/risk_forecasts/2026/08/28.parquet', '2026-11-27T03:17:00Z'
  ),
  1::bigint, '2026-11-27: risk_forecasts 2026-08-28 archives cleanly'
);
select is(
  private.cold_archive_commit_as_of(
    'broadcast_audit', '2026-08-28', 1,
    pg_temp.cand_digest('broadcast_audit', '2026-08-28'), repeat('c', 64), 128,
    'cold/broadcast_audit/2026/08/28.parquet', '2026-11-27T03:17:00Z'
  ),
  1::bigint, '2026-11-27: broadcast_audit 2026-08-28 archives cleanly'
);
select is(
  private.cold_archive_commit_as_of(
    'airport_observations', '2026-08-28', 1,
    pg_temp.cand_digest('airport_observations', '2026-08-28'), repeat('d', 64), 128,
    'cold/airport_observations/2026/08/28.parquet', '2026-11-27T03:17:00Z'
  ),
  1::bigint, '2026-11-27: airport_observations 2026-08-28 archives cleanly'
);
select is(
  private.cold_archive_commit_as_of(
    'source_runs', '2026-08-28', 1,
    pg_temp.cand_digest('source_runs', '2026-08-28'), repeat('e', 64), 128,
    'cold/source_runs/2026/08/28.parquet', '2026-11-27T03:17:00Z'
  ),
  1::bigint, '2026-11-27: source_runs 2026-08-28 archives cleanly'
);
select is(
  private.cold_archive_commit_as_of(
    'source_jobs', '2026-08-26', 1,
    pg_temp.cand_digest('source_jobs', '2026-08-26'), repeat('f', 64), 128,
    'cold/source_jobs/2026/08/26.parquet', '2026-11-27T03:17:00Z'
  ),
  1::bigint, '2026-11-27: source_jobs 2026-08-26 archives cleanly'
);

-- 2026-08-29 (90d) and 2026-08-27 (92d) stay hot at 2026-11-27T03:17:00Z
select throws_ok(
  $$select private.cold_archive_commit_as_of('weather_snapshots', '2026-08-29', 0, null, null, null, null, '2026-11-27T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-27: weather_snapshots 2026-08-29 stays hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('broadcast_audit', '2026-08-29', 0, null, null, null, null, '2026-11-27T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-27: broadcast_audit 2026-08-29 stays hot'
);
select throws_ok(
  $$select private.cold_archive_commit_as_of('source_jobs', '2026-08-27', 0, null, null, null, null, '2026-11-27T03:17:00Z')$$,
  '22023', 'cold_day_still_hot', '2026-11-27: source_jobs 2026-08-27 stays hot'
);

-- ---------------------------------------------------------------------------
-- 7. Complete Role & Privilege Matrix + RLS + Real Wall-Clock service_role Call
-- ---------------------------------------------------------------------------
-- PUBLIC / anon / authenticated / cold_reader CANNOT execute public.cold_pending_days or public.cold_archive_commit
select ok(
  not has_function_privilege('public', 'public.cold_pending_days(text)', 'execute')
  and not has_function_privilege('anon', 'public.cold_pending_days(text)', 'execute')
  and not has_function_privilege('authenticated', 'public.cold_pending_days(text)', 'execute')
  and not has_function_privilege('cold_reader', 'public.cold_pending_days(text)', 'execute'),
  'only service_role can execute public.cold_pending_days(text)'
);
select ok(
  not has_function_privilege('public', 'public.cold_archive_commit(text,date,bigint,text,text,bigint,text)', 'execute')
  and not has_function_privilege('anon', 'public.cold_archive_commit(text,date,bigint,text,text,bigint,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.cold_archive_commit(text,date,bigint,text,text,bigint,text)', 'execute')
  and not has_function_privilege('cold_reader', 'public.cold_archive_commit(text,date,bigint,text,text,bigint,text)', 'execute'),
  'only service_role can execute public.cold_archive_commit(7 args)'
);
select ok(
  has_function_privilege('service_role', 'public.cold_pending_days(text)', 'execute')
  and has_function_privilege('service_role', 'public.cold_archive_commit(text,date,bigint,text,text,bigint,text)', 'execute'),
  'service_role retains execute on public cold-archive RPCs'
);

-- PUBLIC / anon / authenticated / service_role / cold_reader CANNOT execute private.*_as_of or private.cold_archived
select ok(
  not has_function_privilege('public', 'private.cold_archived(text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.cold_archived(text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.cold_archived(text,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.cold_archived(text,timestamptz)', 'execute')
  and not has_function_privilege('cold_reader', 'private.cold_archived(text,timestamptz)', 'execute'),
  'no runtime role can execute private.cold_archived'
);
select ok(
  not has_function_privilege('public', 'private.cold_pending_days_as_of(text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.cold_pending_days_as_of(text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.cold_pending_days_as_of(text,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.cold_pending_days_as_of(text,timestamptz)', 'execute')
  and not has_function_privilege('cold_reader', 'private.cold_pending_days_as_of(text,timestamptz)', 'execute'),
  'no runtime role (including service_role) can execute private.cold_pending_days_as_of'
);
select ok(
  not has_function_privilege('public', 'private.cold_archive_commit_as_of(text,date,bigint,text,text,bigint,text,timestamptz)', 'execute')
  and not has_function_privilege('anon', 'private.cold_archive_commit_as_of(text,date,bigint,text,text,bigint,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.cold_archive_commit_as_of(text,date,bigint,text,text,bigint,text,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.cold_archive_commit_as_of(text,date,bigint,text,text,bigint,text,timestamptz)', 'execute')
  and not has_function_privilege('cold_reader', 'private.cold_archive_commit_as_of(text,date,bigint,text,text,bigint,text,timestamptz)', 'execute'),
  'no runtime role (including service_role) can execute private.cold_archive_commit_as_of'
);

-- private.cold_candidates: ONLY cold_reader among runtime roles
select ok(
  not has_function_privilege('public', 'private.cold_candidates(text,date)', 'execute')
  and not has_function_privilege('anon', 'private.cold_candidates(text,date)', 'execute')
  and not has_function_privilege('authenticated', 'private.cold_candidates(text,date)', 'execute')
  and not has_function_privilege('service_role', 'private.cold_candidates(text,date)', 'execute')
  and has_function_privilege('cold_reader', 'private.cold_candidates(text,date)', 'execute'),
  'only cold_reader among runtime roles can execute private.cold_candidates'
);

-- cold_reader SELECT on all 6 tables + read-only config
select ok(
  has_table_privilege('cold_reader', 'public.weather_snapshots', 'select')
  and has_table_privilege('cold_reader', 'public.risk_forecasts', 'select')
  and has_table_privilege('cold_reader', 'public.broadcast_audit', 'select')
  and has_table_privilege('cold_reader', 'public.airport_observations', 'select')
  and has_table_privilege('cold_reader', 'public.source_runs', 'select')
  and has_table_privilege('cold_reader', 'public.source_jobs', 'select'),
  'cold_reader can SELECT from all 6 cold tables'
);
select ok(
  exists (
    select 1 from pg_roles
    where rolname = 'cold_reader'
      and 'default_transaction_read_only=on' = any(rolconfig)
  ),
  'cold_reader has default_transaction_read_only=on configured'
);

-- Verify cold_reader can actually read surviving rows across all 6 tables under RLS
-- (In Postgres 16+, postgres holds ADMIN OPTION on cold_reader without SET OPTION;
--  granting within this rolled-back transaction enables SET LOCAL ROLE cold_reader.
--  cold_reader intentionally has no USAGE on extensions, so we capture results in GUCs
--  while acting as cold_reader and assert with pgTAP after reset role.)
grant cold_reader to postgres;
set local role cold_reader;
select set_config('m1b.cr_weather', (select count(*)::text from public.weather_snapshots where id = '30000000-0000-4000-8000-000000000104'), true);
select set_config('m1b.cr_risk', (select count(*)::text from public.risk_forecasts where id = '30000000-0000-4000-8000-000000000205'), true);
select set_config('m1b.cr_audit', (select count(*)::text from public.broadcast_audit where id = '30000000-0000-4000-8000-000000000304'), true);
select set_config('m1b.cr_airport', (select count(*)::text from public.airport_observations where id = '30000000-0000-4000-8000-000000000404'), true);
select set_config('m1b.cr_runs', (select count(*)::text from public.source_runs where id = '30000000-0000-4000-8000-000000000505'), true);
select set_config('m1b.cr_jobs', (select count(*)::text from public.source_jobs where id = '30000000-0000-4000-8000-000000000611'), true);
do $$
begin
  delete from public.airport_observations where id = '30000000-0000-4000-8000-000000000404';
  perform set_config('m1b.cr_del_err', 'NONE', true);
exception when insufficient_privilege then
  perform set_config('m1b.cr_del_err', sqlstate, true);
end;
$$;
reset role;

select is(current_setting('m1b.cr_weather'), '1', 'cold_reader reads weather_snapshots under RLS');
select is(current_setting('m1b.cr_risk'), '1', 'cold_reader reads risk_forecasts under RLS');
select is(current_setting('m1b.cr_audit'), '1', 'cold_reader reads broadcast_audit under RLS');
select is(current_setting('m1b.cr_airport'), '1', 'cold_reader reads airport_observations under RLS');
select is(current_setting('m1b.cr_runs'), '1', 'cold_reader reads source_runs under RLS');
select is(current_setting('m1b.cr_jobs'), '1', 'cold_reader reads source_jobs under RLS');
select is(current_setting('m1b.cr_del_err'), '42501', 'cold_reader cannot delete from cold tables');

-- cold_exports RLS & write lockdown
select ok(
  not has_table_privilege('service_role', 'public.cold_exports', 'insert')
  and not has_table_privilege('service_role', 'public.cold_exports', 'delete')
  and not has_table_privilege('authenticated', 'public.cold_exports', 'insert')
  and not has_table_privilege('authenticated', 'public.cold_exports', 'delete')
  and not has_table_privilege('anon', 'public.cold_exports', 'select')
  and not has_table_privilege('anon', 'public.cold_exports', 'insert')
  and not has_table_privilege('anon', 'public.cold_exports', 'delete'),
  'cold_exports write privileges revoked from anon, authenticated, and service_role'
);

select set_config('request.jwt.claim.sub', '30000000-0000-4000-8000-000000009999', true);
set local role authenticated;
select is(
  (select count(*) from public.cold_exports),
  0::bigint,
  'regular authenticated user sees 0 rows in public.cold_exports under RLS'
);
reset role;
select set_config('request.jwt.claim.sub', '', true);

-- Real service_role call to public.cold_archive_commit against wall-clock now()
select set_config('m1b.live_day', ((now() at time zone 'UTC')::date - 120)::text, true);
insert into public.airport_observations (id, station, name, lat, lon, observed_at, raw)
values (
  '30000000-0000-4000-8000-000000000499',
  'DAAG',
  'Algiers',
  36.691,
  3.215,
  current_setting('m1b.live_day')::timestamp at time zone 'UTC' + interval '3 hours',
  'METAR DAAG LIVE'
);
insert into storage.objects (bucket_id, name, metadata)
values (
  'cold-archive',
  'cold/airport_observations/' || to_char(current_setting('m1b.live_day')::date, 'YYYY/MM/DD') || '.parquet',
  '{"size": 64}'::jsonb
);
create temp table live_digest as
select md5(string_agg(id::text, ',' order by id::text collate "C")) as digest
from private.cold_candidates('airport_observations', current_setting('m1b.live_day')::date);
grant select on live_digest to service_role;

set local role service_role;
select throws_ok(
  $$select public.cold_archive_commit('airport_observations', (now() at time zone 'UTC')::date - 90, 0, null, null, null, null)$$,
  '22023', 'cold_day_still_hot',
  'wall-clock public.cold_archive_commit via service_role rejects now()-90d hot boundary'
);
select ok(
  current_setting('m1b.live_day')::date in (select public.cold_pending_days('airport_observations')),
  'wall-clock public.cold_pending_days via service_role lists eligible day'
);
select is(
  public.cold_archive_commit(
    'airport_observations',
    current_setting('m1b.live_day')::date,
    1,
    (select digest from live_digest),
    repeat('9', 64),
    64,
    'cold/airport_observations/' || to_char(current_setting('m1b.live_day')::date, 'YYYY/MM/DD') || '.parquet'
  ),
  1::bigint,
  'wall-clock public.cold_archive_commit via service_role commits eligible day cleanly'
);
select ok(
  current_setting('m1b.live_day')::date not in (select public.cold_pending_days('airport_observations')),
  'wall-clock archived day disappears from public.cold_pending_days'
);
reset role;

select * from finish();
rollback;
