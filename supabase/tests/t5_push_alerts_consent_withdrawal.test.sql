begin;
set local search_path = public, extensions;

select plan(17);

-- Seed 3 users:
--   u1: granted push_alerts (eligible)
--   u2: withdrawn push_alerts (must NOT be claimed)
--   u3: withdrawn email_digest only (still eligible for push_alerts)
insert into auth.users (id, email) values
  ('5c010000-0000-4000-8000-000000000001', 't5-push-granted@example.invalid'),
  ('5c010000-0000-4000-8000-000000000002', 't5-push-withdrawn@example.invalid'),
  ('5c010000-0000-4000-8000-000000000003', 't5-email-only-withdrawn@example.invalid');

insert into public.privacy_consents (
  user_id, consent_type, policy_version, status, granted_at, withdrawn_at, locale, source_surface
) values
  (
    '5c010000-0000-4000-8000-000000000001',
    'push_alerts',
    '2026-11-25',
    'granted',
    now() - interval '1 hour',
    null,
    'ar',
    'settings'
  ),
  (
    '5c010000-0000-4000-8000-000000000002',
    'push_alerts',
    '2026-11-25',
    'withdrawn',
    now() - interval '2 hours',
    now() - interval '5 minutes',
    'ar',
    'settings'
  ),
  (
    '5c010000-0000-4000-8000-000000000003',
    'email_digest',
    '2026-11-25',
    'withdrawn',
    now() - interval '2 hours',
    now() - interval '5 minutes',
    'fr',
    'privacy'
  );

insert into public.alerts (id, user_id, kind, severity, dedupe_key, title, body, created_at) values
  (
    '5c010000-0000-4000-8000-000000000101',
    '5c010000-0000-4000-8000-000000000001',
    'weather', 3, 't5:push:u1', 'ONM', 'Rain warning', now() - interval '2 minutes'
  ),
  (
    '5c010000-0000-4000-8000-000000000102',
    '5c010000-0000-4000-8000-000000000002',
    'weather', 3, 't5:push:u2', 'ONM', 'Rain warning', now() - interval '1 minute'
  ),
  (
    '5c010000-0000-4000-8000-000000000103',
    '5c010000-0000-4000-8000-000000000003',
    'weather', 3, 't5:push:u3', 'ONM', 'Rain warning', now()
  );

-- 1. claim_alert_pushes excludes u2 (push_alerts withdrawn) while claiming u1 and u3
select is(
  (select array_agg(id order by id) from public.claim_alert_pushes(50)
    where id in (
      '5c010000-0000-4000-8000-000000000101'::uuid,
      '5c010000-0000-4000-8000-000000000102'::uuid,
      '5c010000-0000-4000-8000-000000000103'::uuid
    )),
  array[
    '5c010000-0000-4000-8000-000000000101'::uuid,
    '5c010000-0000-4000-8000-000000000103'::uuid
  ],
  'claim_alert_pushes excludes users with withdrawn push_alerts consent while claiming granted and email-only-withdrawn users'
);

-- 2-4. Withdrawn user alert remains unclaimed with 0 attempts burned
select is(
  (select push_state from public.alerts where id = '5c010000-0000-4000-8000-000000000102'),
  'pending',
  'withdrawn user alert remains pending while excluded'
);

select is(
  (select push_attempts::int from public.alerts where id = '5c010000-0000-4000-8000-000000000102'),
  0,
  'withdrawn user alert does not burn push_attempts'
);

select is(
  (select push_claimed_at is null from public.alerts where id = '5c010000-0000-4000-8000-000000000102'),
  true,
  'withdrawn user alert has null push_claimed_at'
);

-- 5. Second call still excludes u2
select is(
  (select count(*)::int from public.claim_alert_pushes(50)
    where id = '5c010000-0000-4000-8000-000000000102'),
  0,
  'subsequent claim_alert_pushes continues to exclude withdrawn push_alerts user'
);

-- 6. Re-granting push_alerts restores eligibility
update public.privacy_consents
   set status = 'granted',
       granted_at = now(),
       withdrawn_at = null
 where user_id = '5c010000-0000-4000-8000-000000000002'
   and consent_type = 'push_alerts';

select is(
  (select array_agg(id) from public.claim_alert_pushes(50)
    where id = '5c010000-0000-4000-8000-000000000102'),
  array['5c010000-0000-4000-8000-000000000102'::uuid],
  're-granting push_alerts consent restores claim_alert_pushes eligibility'
);

-- 7. Marking a claimed row push_state = skipped terminates re-claim loop
update public.alerts
   set push_state = 'skipped',
       push_claimed_at = now() - interval '10 minutes'
 where id = '5c010000-0000-4000-8000-000000000102';

select is(
  (select count(*)::int from public.claim_alert_pushes(50)
    where id = '5c010000-0000-4000-8000-000000000102'),
  0,
  'skipped alert is never re-claimed even after claim timeout'
);

-- 8-14. 5-role privilege matrix + SECURITY DEFINER + search_path = ''
select is(
  has_function_privilege('public', 'public.claim_alert_pushes(integer)', 'execute'),
  false,
  'public cannot execute claim_alert_pushes'
);

select is(
  has_function_privilege('anon', 'public.claim_alert_pushes(integer)', 'execute'),
  false,
  'anon cannot execute claim_alert_pushes'
);

select is(
  has_function_privilege('authenticated', 'public.claim_alert_pushes(integer)', 'execute'),
  false,
  'authenticated cannot execute claim_alert_pushes'
);

select is(
  has_function_privilege('cold_reader', 'public.claim_alert_pushes(integer)', 'execute'),
  false,
  'cold_reader cannot execute claim_alert_pushes'
);

select is(
  has_function_privilege('service_role', 'public.claim_alert_pushes(integer)', 'execute'),
  true,
  'service_role can execute claim_alert_pushes'
);

select ok(
  (select p.prosecdef
     from pg_proc p
    where p.oid = 'public.claim_alert_pushes(integer)'::regprocedure),
  'claim_alert_pushes is SECURITY DEFINER'
);

select ok(
  (select p.proconfig is not null
      and ('search_path=""' = any(p.proconfig) or 'search_path=' = any(p.proconfig))
     from pg_proc p
    where p.oid = 'public.claim_alert_pushes(integer)'::regprocedure),
  'claim_alert_pushes pins search_path = '''''
);

-- 15-17. Runtime role enforcement
set local role anon;
select throws_ok(
  $$select * from public.claim_alert_pushes(10)$$,
  '42501',
  null,
  'anon runtime call to claim_alert_pushes raises 42501'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '5c010000-0000-4000-8000-000000000001', true);
select throws_ok(
  $$select * from public.claim_alert_pushes(10)$$,
  '42501',
  null,
  'authenticated runtime call to claim_alert_pushes raises 42501'
);
reset role;

set local role service_role;
select lives_ok(
  $$select * from public.claim_alert_pushes(10)$$,
  'service_role runtime call to claim_alert_pushes succeeds'
);
reset role;

select * from finish();
rollback;
