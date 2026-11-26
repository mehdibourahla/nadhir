begin;

set local search_path = public, extensions;

select no_plan();

-- 1. Four heavy/egress contracts target the standalone EU worker (ita_facebook stays on github for IP rotation).
select is(
  (
    select array_agg(key order by key)
    from public.source_contracts
    where execution_target = 'worker'
      and key in ('dgpc_telegram', 'effis', 'ita_facebook', 'ita_website', 'local_fwi')
  ),
  array['dgpc_telegram', 'effis', 'ita_website', 'local_fwi'],
  'four heavy/egress contracts run on execution_target worker'
);

-- 2. CHECK constraints accept worker/cloudflare/github and reject invalid targets.
select throws_ok(
  $$
  update public.source_contracts
  set execution_target = 'invalid'
  where key = 'ita_facebook'
  $$,
  '23514',
  null,
  'source_contracts rejects invalid execution_target'
);

select throws_ok(
  $$
  insert into public.source_jobs (
    contract_key, contract_version, trigger_kind, idempotency_key,
    scheduled_for, data_from, data_through, execution_target, enqueued_by,
    available_at, max_attempts, retry_base_seconds, retry_until
  ) values (
    'ita_facebook', 1, 'manual', 'test:invalid-target',
    now(), now() - interval '2 minutes', now(), 'invalid', array['worker'],
    now(), 3, 30, now() + interval '10 minutes'
  )
  $$,
  '23514',
  null,
  'source_jobs rejects invalid execution_target'
);

-- 3. enqueue_due_source_jobs accepts 'worker' scheduler and rejects unknown schedulers.
select throws_ok(
  $$select public.enqueue_due_source_jobs(now(), 'unknown')$$,
  'P0001',
  'unsupported scheduler: unknown',
  'enqueue_due_source_jobs rejects unsupported scheduler'
);

delete from public.source_job_leases;
delete from public.source_jobs where state in ('queued', 'retry_wait', 'running');

select ok(
  public.enqueue_due_source_jobs('2026-11-24T12:00:00Z'::timestamptz, 'worker') >= 5,
  'enqueue_due_source_jobs accepts worker scheduler'
);

select ok(
  exists(
    select 1
    from public.source_jobs
    where contract_key = 'craag_earthquakes'
      and execution_target = 'worker'
      and 'worker' = any(enqueued_by)
  ),
  'craag_earthquakes scheduled job records execution_target worker and enqueued_by worker'
);

-- 4. claim_source_job validates execution target and claims only matching target.
select throws_ok(
  $$select * from public.claim_source_job('eu-worker-1', 'invalid')$$,
  'P0001',
  'invalid execution target',
  'claim_source_job rejects invalid execution target'
);

select is(
  (select count(*)::integer from public.claim_source_job('eu-worker-1', 'worker', 'firms', '2026-11-24T12:00:05Z')),
  0,
  'worker target does not claim cloudflare jobs'
);

select
  set_config('eu.job', id::text, true),
  set_config('eu.attempt', attempt_count::text, true)
from public.claim_source_job('eu-worker-1', 'worker', 'craag_earthquakes', '2026-11-24T12:00:05Z');

select ok(
  current_setting('eu.job', true) is not null,
  'worker target claims craag_earthquakes job'
);

select set_config(
  'eu.initial_expiry',
  (select lease_expires_at::text from public.source_job_leases where job_id = current_setting('eu.job')::uuid),
  true
);

-- 5. renew_source_job_lease enforces fencing, duration bounds, and extends lease.
select ok(
  public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    current_setting('eu.attempt')::integer,
    240,
    '2026-11-24T12:00:30Z'::timestamptz
  ) > current_setting('eu.initial_expiry')::timestamptz,
  'renew_source_job_lease extends active lease for matching worker and attempt'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'other-worker',
    current_setting('eu.attempt')::integer,
    300,
    '2026-11-24T12:00:40Z'::timestamptz
  )
  $$,
  'P0001',
  'source job lease does not match renewal',
  'renew_source_job_lease rejects mismatched worker_id'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    current_setting('eu.attempt')::integer + 1,
    300,
    '2026-11-24T12:00:40Z'::timestamptz
  )
  $$,
  'P0001',
  'source job lease does not match renewal',
  'renew_source_job_lease rejects mismatched attempt'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    null::integer,
    300,
    '2026-11-24T12:00:40Z'::timestamptz
  )
  $$,
  'P0001',
  'source job lease does not match renewal',
  'renew_source_job_lease rejects NULL attempt'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    current_setting('eu.attempt')::integer,
    300,
    null::timestamptz
  )
  $$,
  'P0001',
  'source job lease does not match renewal',
  'renew_source_job_lease rejects NULL now timestamp'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    current_setting('eu.attempt')::integer,
    10,
    '2026-11-24T12:00:40Z'::timestamptz
  )
  $$,
  'P0001',
  'invalid lease duration',
  'renew_source_job_lease rejects duration below 30 seconds'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    current_setting('eu.attempt')::integer,
    3601,
    '2026-11-24T12:00:40Z'::timestamptz
  )
  $$,
  'P0001',
  'invalid lease duration',
  'renew_source_job_lease rejects duration above 3600 seconds'
);

select throws_ok(
  $$
  select public.renew_source_job_lease(
    current_setting('eu.job')::uuid,
    'eu-worker-1',
    current_setting('eu.attempt')::integer,
    120,
    '2026-11-24T12:20:00Z'::timestamptz
  )
  $$,
  'P0001',
  'source job lease does not match renewal',
  'renew_source_job_lease rejects already-expired lease'
);

-- Verify lock ordering invariant in renew_source_job_lease (leases locked before jobs).
select ok(
  position('from public.source_job_leases' in pg_get_functiondef('public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)'::regprocedure))
    < position('from public.source_jobs' in pg_get_functiondef('public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)'::regprocedure)),
  'renew_source_job_lease locks source_job_leases before source_jobs'
);

-- 6. public.requeue_expired_source_jobs recovers expired worker lease into retry_wait.
select is(
  public.requeue_expired_source_jobs('2026-11-24T12:04:40Z'::timestamptz),
  1,
  'requeue_expired_source_jobs recovers expired worker lease'
);

select is(
  (select state from public.source_jobs where id = current_setting('eu.job')::uuid),
  'retry_wait',
  'recovered job transitions to retry_wait'
);

select is(
  (select count(*)::integer from public.source_job_leases where job_id = current_setting('eu.job')::uuid),
  0,
  'expired lease row is removed after recovery'
);

-- 7. Explicit REVOKE / GRANT security audit on all 4 RPCs.
select ok(
  not has_function_privilege('public', 'public.enqueue_due_source_jobs(timestamptz, text)', 'execute')
    and not has_function_privilege('anon', 'public.enqueue_due_source_jobs(timestamptz, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.enqueue_due_source_jobs(timestamptz, text)', 'execute')
    and has_function_privilege('service_role', 'public.enqueue_due_source_jobs(timestamptz, text)', 'execute'),
  'enqueue_due_source_jobs is restricted to service_role only'
);

select ok(
  not has_function_privilege('public', 'public.claim_source_job(text, text, text, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.claim_source_job(text, text, text, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_source_job(text, text, text, timestamptz)', 'execute')
    and has_function_privilege('service_role', 'public.claim_source_job(text, text, text, timestamptz)', 'execute'),
  'claim_source_job is restricted to service_role only'
);

select ok(
  not has_function_privilege('public', 'public.requeue_expired_source_jobs(timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.requeue_expired_source_jobs(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.requeue_expired_source_jobs(timestamptz)', 'execute')
    and has_function_privilege('service_role', 'public.requeue_expired_source_jobs(timestamptz)', 'execute'),
  'requeue_expired_source_jobs is restricted to service_role only'
);

select ok(
  not has_function_privilege('public', 'public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)', 'execute')
    and has_function_privilege('service_role', 'public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)', 'execute'),
  'renew_source_job_lease is restricted to service_role only'
);

select * from finish();

rollback;
