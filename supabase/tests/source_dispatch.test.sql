begin;

set local search_path = public, extensions;

select no_plan();

select has_column('public', 'source_jobs', 'dispatched_at', 'github-target jobs record when they were dispatched');
select has_function('private', 'dispatch_github_source_jobs', array['timestamp with time zone'], 'dispatch function exists');
select has_table('public', 'operator_alert_state', 'operator alert state exists');

select is(
  (select count(*)::integer from cron.job where jobname = 'nadhir-github-dispatch'),
  1,
  'pg_cron github auto-dispatch schedule is active for Facebook egress sources'
);

delete from public.source_jobs
where execution_target = 'github' and state in ('queued', 'retry_wait');

insert into public.source_jobs (
  contract_key, contract_version, trigger_kind, idempotency_key,
  scheduled_for, data_from, data_through, execution_target, enqueued_by,
  available_at, max_attempts, retry_base_seconds, retry_until
)
values
  ('local_fwi', 1, 'manual', 'test:dispatch:github', '2026-09-02 06:00+00',
   '2026-09-01 06:00+00', '2026-09-02 06:00+00', 'github', '{test}',
   '2026-09-02 06:00+00', 3, 300, '2026-09-02 18:00+00'),
  ('local_fwi', 1, 'manual', 'test:dispatch:future', '2026-09-02 09:00+00',
   '2026-09-01 06:00+00', '2026-09-02 06:00+00', 'github', '{test}',
   '2026-09-02 09:00+00', 3, 300, '2026-09-02 18:00+00'),
  ('firms', 1, 'manual', 'test:dispatch:cloudflare', '2026-09-02 06:00+00',
   '2026-09-02 05:50+00', '2026-09-02 06:00+00', 'cloudflare', '{test}',
   '2026-09-02 06:00+00', 3, 300, '2026-09-02 06:30+00');

select is(
  private.dispatch_github_source_jobs('2026-09-02 06:01+00'),
  0,
  'without vault secrets nothing is dispatched'
);

select is(
  (select count(*)::integer from public.source_jobs where dispatched_at is not null),
  0,
  'without vault secrets no job is marked dispatched'
);

select vault.create_secret('ghp_test_token', 'github_dispatch_token');
select vault.create_secret('mehdibourahla/fire-watcher-pro', 'github_repo');

select is(
  private.dispatch_github_source_jobs('2026-09-02 06:01+00'),
  1,
  'one due github job is dispatched'
);

select is(
  (select dispatched_at from public.source_jobs where idempotency_key = 'test:dispatch:github'),
  '2026-09-02 06:01+00'::timestamptz,
  'the dispatched job records the dispatch time'
);

select is(
  (select dispatched_at from public.source_jobs where idempotency_key = 'test:dispatch:future'),
  null,
  'a job not yet available is not dispatched'
);

select is(
  (select dispatched_at from public.source_jobs where idempotency_key = 'test:dispatch:cloudflare'),
  null,
  'cloudflare-target jobs are never dispatched to github'
);

select is(
  private.dispatch_github_source_jobs('2026-09-02 06:10+00'),
  0,
  'a recently dispatched job is not re-dispatched'
);

select is(
  private.dispatch_github_source_jobs('2026-09-02 06:30+00'),
  1,
  'a job still queued 20 minutes after dispatch is dispatched again'
);

update public.source_jobs set state = 'running', dispatched_at = null
where idempotency_key = 'test:dispatch:github';

select is(
  private.dispatch_github_source_jobs('2026-09-02 07:00+00'),
  0,
  'a running job is not dispatched'
);

select * from finish();

rollback;
