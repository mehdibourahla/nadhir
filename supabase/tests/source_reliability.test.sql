begin;

set local search_path = public, extensions;

select no_plan();

select has_table('public', 'source_contracts', 'source contracts exist');
select has_table('public', 'source_checkpoints', 'source checkpoints exist');
select has_table('public', 'source_runs', 'source run ledger exists');
select has_view('public', 'source_health', 'derived source health exists');

select has_pk('public', 'source_contracts', 'source contracts have a primary key');
select has_pk('public', 'source_checkpoints', 'source checkpoints have a primary key');
select has_pk('public', 'source_runs', 'source runs have a primary key');
select has_index(
  'public',
  'source_runs',
  'source_runs_contract_started_idx',
  'source runs support latest-run lookup'
);
select has_index(
  'public',
  'source_runs',
  'source_runs_idempotency_idx',
  'source runs enforce idempotency'
);

select is(
  (
    select count(*)::integer
    from public.source_contracts
    where key = any(array[
      'firms',
      'fci',
      'onm',
      'persistent_screen',
      'fusion',
      'openmeteo_wind',
      'local_fwi',
      'effis',
      'alert_evaluation',
      'broadcast_publish',
      'broadcast_delivery',
      'geo'
    ])
  ),
  12,
  'every current external source and derived stage has a contract'
);

select is(
  (
    select warning_after_minutes
    from public.source_contracts
    where key = 'local_fwi'
  ),
  32 * 60,
  'current-day FWI stays healthy until the next 08:00 UTC publication deadline'
);
select is(
  (
    select stale_after_minutes
    from public.source_contracts
    where key = 'local_fwi'
  ),
  48 * 60,
  'an FWI product becomes stale before the publication cycle after next'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid = any(array[
      'public.source_contracts'::regclass,
      'public.source_checkpoints'::regclass,
      'public.source_runs'::regclass
    ])
  ),
  'RLS is enabled on every reliability table'
);

select ok(
  not has_table_privilege('anon', 'public.source_runs', 'select')
  and not has_table_privilege('authenticated', 'public.source_runs', 'select'),
  'raw source runs are private'
);
select ok(
  not has_table_privilege('anon', 'public.ingest_runs', 'select')
  and not has_table_privilege('authenticated', 'public.ingest_runs', 'select'),
  'legacy raw ingest errors are no longer public'
);
select ok(
  has_table_privilege('service_role', 'public.source_runs', 'select')
  and has_table_privilege('service_role', 'public.source_runs', 'insert')
  and not has_table_privilege('service_role', 'public.source_runs', 'update')
  and not has_table_privilege('service_role', 'public.source_runs', 'delete'),
  'the application role can append runs but cannot rewrite history'
);
select ok(
  has_table_privilege('anon', 'public.source_health', 'select')
  and has_table_privilege('authenticated', 'public.source_health', 'select'),
  'the sanitized health view is public'
);
select ok(
  not has_column_privilege(
    'anon',
    'public.source_checkpoints',
    'replay_cursor',
    'select'
  )
  and not has_column_privilege(
    'anon',
    'public.source_checkpoints',
    'schema_fingerprint',
    'select'
  ),
  'checkpoint internals are not directly public'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'source_health'
      and column_name = any(array[
        'private_diagnostic',
        'replay_cursor',
        'schema_fingerprint'
      ])
  ),
  0,
  'the public view cannot project private diagnostics'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.record_source_run(text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,jsonb,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.record_source_run(text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,jsonb,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.record_source_run(text,text,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,text,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,timestamp with time zone,integer,integer,integer,integer,integer,text,jsonb,text,text)',
    'execute'
  ),
  'only the service role can report runs'
);

update public.source_checkpoints
set
  last_scheduled_for = null,
  last_attempt_at = null,
  last_success_at = null,
  upstream_published_at = null,
  data_from = null,
  data_through = null,
  validated_at = null,
  published_at = null,
  consecutive_failures = 0,
  records_accepted = 0,
  records_expected = null,
  coverage_status = 'unknown',
  last_public_reason_code = null
where contract_key in ('firms', 'fci', 'fusion');

select isnt(
  public.record_source_run(
    _contract_key => 'firms',
    _trigger_kind => 'manual',
    _idempotency_key => 'pgtap:firms:success',
    _scheduled_for => '2026-08-31 10:00:00+00',
    _started_at => '2026-08-31 10:00:01+00',
    _finished_at => '2026-08-31 10:00:02+00',
    _outcome => 'succeeded',
    _upstream_published_at => null,
    _data_from => '2026-08-31 09:50:00+00',
    _data_through => '2026-08-31 10:00:00+00',
    _validated_at => '2026-08-31 10:00:02+00',
    _published_at => '2026-08-31 10:00:02+00',
    _records_seen => 3,
    _records_inserted => 3,
    _records_updated => 0,
    _records_rejected => 0,
    _records_expected => 3,
    _coverage_status => 'complete',
    _quality_checks => '{"feeds_answered": 3}'::jsonb,
    _public_reason_code => null,
    _private_diagnostic => null
  ),
  null::uuid,
  'a successful report creates a run'
);
select is(
  (
    select count(*)::integer
    from public.source_runs
    where idempotency_key = 'pgtap:firms:success'
  ),
  1,
  'the successful report is appended once'
);
select is(
  (
    select data_through
    from public.source_checkpoints
    where contract_key = 'firms'
  ),
  '2026-08-31 10:00:00+00'::timestamptz,
  'success advances the valid data watermark'
);
select is(
  (
    select consecutive_failures
    from public.source_checkpoints
    where contract_key = 'firms'
  ),
  0,
  'success resets the failure streak'
);

select isnt(
  public.record_source_run(
    _contract_key => 'firms',
    _trigger_kind => 'manual',
    _idempotency_key => 'pgtap:firms:success',
    _scheduled_for => '2026-08-31 10:00:00+00',
    _started_at => '2026-08-31 10:00:01+00',
    _finished_at => '2026-08-31 10:00:03+00',
    _outcome => 'failed',
    _upstream_published_at => null,
    _data_from => null,
    _data_through => '2026-08-31 11:00:00+00',
    _validated_at => null,
    _published_at => null,
    _records_seen => 0,
    _records_inserted => 0,
    _records_updated => 0,
    _records_rejected => 0,
    _records_expected => 3,
    _coverage_status => 'unknown',
    _quality_checks => '{}'::jsonb,
    _public_reason_code => 'upstream_unreachable',
    _private_diagnostic => 'must not replace the successful run'
  ),
  null::uuid,
  'an idempotent retry returns the existing run'
);
select is(
  (
    select count(*)::integer
    from public.source_runs
    where idempotency_key = 'pgtap:firms:success'
  ),
  1,
  'an idempotent retry does not append a duplicate'
);
select is(
  (
    select consecutive_failures
    from public.source_checkpoints
    where contract_key = 'firms'
  ),
  0,
  'an idempotent retry does not mutate the checkpoint twice'
);

select isnt(
  public.record_source_run(
    _contract_key => 'firms',
    _trigger_kind => 'manual',
    _idempotency_key => 'pgtap:firms:failed',
    _scheduled_for => '2026-08-31 11:00:00+00',
    _started_at => '2026-08-31 11:00:01+00',
    _finished_at => '2026-08-31 11:00:02+00',
    _outcome => 'failed',
    _upstream_published_at => null,
    _data_from => null,
    _data_through => '2026-08-31 11:00:00+00',
    _validated_at => null,
    _published_at => null,
    _records_seen => 0,
    _records_inserted => 0,
    _records_updated => 0,
    _records_rejected => 0,
    _records_expected => 3,
    _coverage_status => 'unknown',
    _quality_checks => '{}'::jsonb,
    _public_reason_code => 'upstream_unreachable',
    _private_diagnostic => 'provider URL and raw response stay private'
  ),
  null::uuid,
  'a failed attempt is still audited'
);
select is(
  (
    select consecutive_failures
    from public.source_checkpoints
    where contract_key = 'firms'
  ),
  1,
  'failure increments the streak'
);
select is(
  (
    select data_through
    from public.source_checkpoints
    where contract_key = 'firms'
  ),
  '2026-08-31 10:00:00+00'::timestamptz,
  'failure cannot advance the last valid watermark'
);

select public.record_source_run(
  _contract_key => 'fusion',
  _trigger_kind => 'manual',
  _idempotency_key => 'pgtap:fusion:newer-success',
  _scheduled_for => '2026-08-31 13:00:00+00',
  _started_at => '2026-08-31 13:00:01+00',
  _finished_at => '2026-08-31 13:00:02+00',
  _outcome => 'succeeded',
  _upstream_published_at => null,
  _data_from => '2026-08-31 12:50:00+00',
  _data_through => '2026-08-31 13:00:00+00',
  _validated_at => '2026-08-31 13:00:02+00',
  _published_at => '2026-08-31 13:00:02+00',
  _records_seen => 4,
  _records_inserted => 2,
  _records_updated => 2,
  _records_rejected => 0,
  _records_expected => 4,
  _coverage_status => 'complete',
  _quality_checks => '{}'::jsonb,
  _public_reason_code => null,
  _private_diagnostic => null
);
select public.record_source_run(
  _contract_key => 'fusion',
  _trigger_kind => 'manual',
  _idempotency_key => 'pgtap:fusion:older-failure',
  _scheduled_for => '2026-08-31 12:00:00+00',
  _started_at => '2026-08-31 12:00:01+00',
  _finished_at => '2026-08-31 13:05:00+00',
  _outcome => 'failed',
  _upstream_published_at => null,
  _data_from => null,
  _data_through => null,
  _validated_at => null,
  _published_at => null,
  _records_seen => 0,
  _records_inserted => 0,
  _records_updated => 0,
  _records_rejected => 0,
  _records_expected => 4,
  _coverage_status => 'unknown',
  _quality_checks => '{}'::jsonb,
  _public_reason_code => 'dependency_failed',
  _private_diagnostic => 'older work finished after the current interval'
);
select results_eq(
  $$
    select
      last_attempt_at,
      data_through,
      consecutive_failures,
      records_accepted,
      coverage_status
    from public.source_checkpoints
    where contract_key = 'fusion'
  $$,
  $$
    values (
      '2026-08-31 13:00:02+00'::timestamptz,
      '2026-08-31 13:00:00+00'::timestamptz,
      0,
      4,
      'complete'::text
    )
  $$,
  'an older run cannot overwrite a newer checkpoint'
);

select public.record_source_run(
  _contract_key => 'fci',
  _trigger_kind => 'manual',
  _idempotency_key => 'pgtap:fci:with-slot',
  _scheduled_for => '2026-08-31 12:00:00+00',
  _started_at => '2026-08-31 12:00:01+00',
  _finished_at => '2026-08-31 12:00:02+00',
  _outcome => 'succeeded',
  _upstream_published_at => '2026-08-31 11:50:00+00',
  _data_from => null,
  _data_through => '2026-08-31 11:50:00+00',
  _validated_at => '2026-08-31 12:00:02+00',
  _published_at => '2026-08-31 12:00:02+00',
  _records_seen => 1,
  _records_inserted => 1,
  _records_updated => 0,
  _records_rejected => 0,
  _records_expected => null,
  _coverage_status => 'complete',
  _quality_checks => '{}'::jsonb,
  _public_reason_code => null,
  _private_diagnostic => null
);
select public.record_source_run(
  _contract_key => 'fci',
  _trigger_kind => 'manual',
  _idempotency_key => 'pgtap:fci:quiet-poll',
  _scheduled_for => '2026-08-31 12:10:00+00',
  _started_at => '2026-08-31 12:10:01+00',
  _finished_at => '2026-08-31 12:10:02+00',
  _outcome => 'succeeded',
  _upstream_published_at => null,
  _data_from => null,
  _data_through => null,
  _validated_at => '2026-08-31 12:10:02+00',
  _published_at => '2026-08-31 12:10:02+00',
  _records_seen => 0,
  _records_inserted => 0,
  _records_updated => 0,
  _records_rejected => 0,
  _records_expected => null,
  _coverage_status => 'complete',
  _quality_checks => '{}'::jsonb,
  _public_reason_code => null,
  _private_diagnostic => null
);
select is(
  (
    select upstream_published_at
    from public.source_checkpoints
    where contract_key = 'fci'
  ),
  '2026-08-31 11:50:00+00'::timestamptz,
  'a successful empty poll preserves the latest upstream watermark'
);

insert into public.source_contracts (
  key,
  version,
  label,
  family,
  criticality,
  freshness_basis,
  cadence_minutes,
  warning_after_minutes,
  stale_after_minutes,
  expected_coverage,
  parser_version,
  licence,
  attribution,
  owner,
  enabled
)
select
  'pgtap_health_' || state,
  1,
  'pgTAP ' || state,
  'reference_enrichment',
  'optional',
  'last_success_at',
  10,
  30,
  60,
  '{}'::jsonb,
  'test-v1',
  'test-only',
  'test-only',
  'test',
  state <> 'paused'
from unnest(array[
  'paused',
  'paused_run',
  'unavailable',
  'stale',
  'delayed',
  'degraded',
  'healthy'
]) as state;

insert into public.source_checkpoints (
  contract_key,
  last_attempt_at,
  last_success_at,
  validated_at,
  published_at,
  consecutive_failures,
  records_accepted,
  coverage_status
)
values
  (
    'pgtap_health_paused_run',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    0,
    1,
    'unknown'
  ),
  (
    'pgtap_health_stale',
    now() - interval '61 minutes',
    now() - interval '61 minutes',
    now() - interval '61 minutes',
    now() - interval '61 minutes',
    0,
    1,
    'complete'
  ),
  (
    'pgtap_health_delayed',
    now() - interval '31 minutes',
    now() - interval '31 minutes',
    now() - interval '31 minutes',
    now() - interval '31 minutes',
    0,
    1,
    'complete'
  ),
  (
    'pgtap_health_degraded',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    1,
    1,
    'partial'
  ),
  (
    'pgtap_health_healthy',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    now() - interval '10 minutes',
    0,
    1,
    'complete'
  );

select is(
  (select state from public.source_health where key = 'pgtap_health_paused'),
  'paused',
  'disabled contracts are paused'
);
update public.source_checkpoints
set last_public_reason_code = 'disabled'
where contract_key = 'pgtap_health_paused_run';
select is(
  (select state from public.source_health where key = 'pgtap_health_paused_run'),
  'paused',
  'an operator-disabled run pauses its source capability'
);
select is(
  (select state from public.source_health where key = 'pgtap_health_unavailable'),
  'unavailable',
  'a never-valid contract is unavailable'
);
select is(
  (select state from public.source_health where key = 'pgtap_health_stale'),
  'stale',
  'a contract past its hard deadline is stale'
);
select is(
  (select state from public.source_health where key = 'pgtap_health_delayed'),
  'delayed',
  'a contract past its warning deadline is delayed'
);
select is(
  (select state from public.source_health where key = 'pgtap_health_degraded'),
  'degraded',
  'current partial coverage is degraded'
);
select is(
  (select state from public.source_health where key = 'pgtap_health_healthy'),
  'healthy',
  'current complete coverage is healthy'
);

insert into public.source_contracts (
  key,
  version,
  label,
  family,
  criticality,
  freshness_basis,
  cadence_minutes,
  warning_after_minutes,
  stale_after_minutes,
  expected_coverage,
  parser_version,
  licence,
  attribution,
  owner,
  enabled,
  is_reference
)
select
  'pgtap_reference_' || state,
  1,
  'pgTAP reference ' || state,
  'reference_enrichment',
  'critical',
  'published_at',
  43200,
  44640,
  86400,
  '{}'::jsonb,
  'test-v1',
  'test-only',
  'test-only',
  'test',
  true,
  true
from unnest(array['old', 'unpublished']) as state;

insert into public.source_checkpoints (
  contract_key,
  last_attempt_at,
  last_success_at,
  validated_at,
  published_at,
  consecutive_failures,
  records_accepted,
  coverage_status
)
values (
  'pgtap_reference_old',
  now() - interval '400 days',
  now() - interval '400 days',
  now() - interval '400 days',
  now() - interval '400 days',
  0,
  1,
  'complete'
);

select is(
  (select is_reference from public.source_contracts where key = 'geo'),
  true,
  'geo is reference data'
);
select is(
  (select state from public.source_health where key = 'pgtap_reference_old'),
  'healthy',
  'reference data does not age once published with complete coverage'
);
select is(
  (select state from public.source_health where key = 'pgtap_reference_unpublished'),
  'unavailable',
  'reference data that was never published is unavailable'
);

select * from finish();

rollback;
