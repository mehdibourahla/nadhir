begin;

set local search_path = public, extensions;

select plan(36);

-- Seed two isolated test users inside rolled-back transaction
insert into auth.users (id, email)
values
  ('f0480000-0000-4000-8000-000000000001', 'm4c-a@example.com'),
  ('f0480000-0000-4000-8000-000000000002', 'm4c-b@example.com');

-- 1. Schema, function privilege, and bucket verification
select has_table('public', 'privacy_consents', 'privacy_consents table exists');

select ok(
  not has_function_privilege('public', 'public.touch_privacy_consents_updated_at()', 'EXECUTE'),
  'public cannot execute touch_privacy_consents_updated_at'
);

select ok(
  not has_function_privilege('anon', 'public.touch_privacy_consents_updated_at()', 'EXECUTE'),
  'anon cannot execute touch_privacy_consents_updated_at'
);

select ok(
  not has_function_privilege('authenticated', 'public.touch_privacy_consents_updated_at()', 'EXECUTE'),
  'authenticated cannot execute touch_privacy_consents_updated_at'
);

select ok(
  has_function_privilege('service_role', 'public.touch_privacy_consents_updated_at()', 'EXECUTE'),
  'service_role retains execute on touch_privacy_consents_updated_at'
);

select is(
  (select allowed_mime_types from storage.buckets where id = 'report-photos'),
  array['image/jpeg', 'image/png', 'image/webp']::text[],
  'report-photos bucket allows JPEG, PNG, and WebP'
);

select is(
  (select public from storage.buckets where id = 'report-photos'),
  false,
  'report-photos bucket remains private'
);

-- 2. privacy_consents CHECK constraints & unique (user_id, consent_type)
select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at)
    values ('f0480000-0000-4000-8000-000000000001', 'invalid_type', '2026-11-25', 'granted', now())$$,
  '23514', null,
  'privacy_consents rejects unknown consent_type'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', 'v1', 'granted', now())$$,
  '23514', null,
  'privacy_consents rejects malformed policy_version'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at, withdrawn_at)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'granted', now(), now())$$,
  '23514', null,
  'privacy_consents rejects granted status with withdrawn_at populated'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at, withdrawn_at)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'withdrawn', now(), null)$$,
  '23514', null,
  'privacy_consents rejects withdrawn status without withdrawn_at'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at, locale)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'granted', now(), 'de')$$,
  '23514', null,
  'privacy_consents rejects unsupported locale'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at, source_surface)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'granted', now(), 'cli')$$,
  '23514', null,
  'privacy_consents rejects unsupported source_surface'
);

-- 3. anon denied on privacy_consents
set local role anon;
select throws_ok(
  $$select * from public.privacy_consents$$,
  '42501', null,
  'anon cannot read privacy_consents'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'granted', now())$$,
  '42501', null,
  'anon cannot insert into privacy_consents'
);

-- 4. authenticated user A own-row CRUD and RLS isolation
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0480000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at, locale, source_surface)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'granted', now(), 'ar', 'settings')$$,
  'authenticated user A can insert own consent'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at)
    values ('f0480000-0000-4000-8000-000000000001', 'privacy_policy', '2026-11-25', 'granted', now())$$,
  '23505', null,
  'duplicate (user_id, consent_type) violates unique constraint'
);

select throws_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at)
    values ('f0480000-0000-4000-8000-000000000002', 'privacy_policy', '2026-11-25', 'granted', now())$$,
  '42501', null,
  'user A cannot insert consent for user B'
);

select lives_ok(
  $$update public.privacy_consents
    set status = 'withdrawn', withdrawn_at = now()
    where user_id = 'f0480000-0000-4000-8000-000000000001' and consent_type = 'privacy_policy'$$,
  'authenticated user A can withdraw own consent via UPDATE'
);

select throws_ok(
  $$delete from public.privacy_consents
    where user_id = 'f0480000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated user A cannot DELETE directly from privacy_consents'
);

-- Switch to user B: cannot read or update user A's row
select set_config('request.jwt.claim.sub', 'f0480000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::int from public.privacy_consents where user_id = 'f0480000-0000-4000-8000-000000000001'),
  0,
  'user B sees zero rows belonging to user A'
);

update public.privacy_consents
   set status = 'granted', withdrawn_at = null, granted_at = now()
 where user_id = 'f0480000-0000-4000-8000-000000000001';

-- Verify via service_role that user A's row remained withdrawn and service_role has full CRUD
reset role;
set local role service_role;

select is(
  (select status from public.privacy_consents
    where user_id = 'f0480000-0000-4000-8000-000000000001' and consent_type = 'privacy_policy'),
  'withdrawn',
  'user B UPDATE did not mutate user A consent'
);

select lives_ok(
  $$insert into public.privacy_consents (user_id, consent_type, policy_version, status, granted_at, locale, source_surface)
    values ('f0480000-0000-4000-8000-000000000002', 'email_digest', '2026-11-25', 'granted', now(), 'fr', 'api')$$,
  'service_role can insert consent for user B'
);

-- 5. Storage report-photos lockdown & WebP support
reset role;
set local role anon;

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('report-photos', 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000001.webp', null)$$,
  '42501', null,
  'anon INSERT into report-photos storage bucket is rejected'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0480000-0000-4000-8000-000000000001', true);

select throws_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'report-photos',
      'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000001.webp',
      'f0480000-0000-4000-8000-000000000001'
    )$$,
  '42501', null,
  'authenticated direct INSERT into report-photos even in own prefix is rejected'
);

-- Service role inserts stripped .webp photo with owner = NULL (matching Supabase server upload)
reset role;
set local role service_role;

select lives_ok(
  $$insert into storage.objects (bucket_id, name, owner)
    values (
      'report-photos',
      'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp',
      null
    )$$,
  'service_role can insert stripped WebP photo into report-photos with owner NULL'
);

-- Owner can SELECT their server-uploaded object, cannot UPDATE (overwrite or rename)
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'f0480000-0000-4000-8000-000000000001', true);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'report-photos'
      and name = 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'),
  1,
  'owner can SELECT server-uploaded report-photos object with owner NULL'
);

select throws_ok(
  $$update storage.objects
    set metadata = '{"tampered":true}'::jsonb
    where bucket_id = 'report-photos'
      and name = 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'$$,
  '42501', null,
  'owner cannot overwrite own report-photos object directly'
);

select throws_ok(
  $$update storage.objects
    set name = 'f0480000-0000-4000-8000-000000000002/f0481000-0000-4000-8000-000000000002.webp'
    where bucket_id = 'report-photos'
      and name = 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'$$,
  '42501', null,
  'owner cannot rename own report-photos object across folder prefix'
);

-- Non-owner (user B) sees 0 rows and deletes 0 rows
select set_config('request.jwt.claim.sub', 'f0480000-0000-4000-8000-000000000002', true);

select is(
  (select count(*)::int from storage.objects
    where bucket_id = 'report-photos'
      and name = 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'),
  0,
  'non-owner sees zero rows for another user report photo'
);

-- Enable Storage API transaction-local delete flag to exercise storage.objects RLS DELETE policies
select set_config('storage.allow_delete_query', 'true', true);

with deleted as (
  delete from storage.objects
   where bucket_id = 'report-photos'
     and name = 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'
  returning id
)
select is(
  (select count(*)::int from deleted),
  0,
  'non-owner cannot delete another user report photo'
);

-- Owner can DELETE their own server-uploaded object
select set_config('request.jwt.claim.sub', 'f0480000-0000-4000-8000-000000000001', true);

-- Enable Storage API transaction-local delete flag to exercise storage.objects RLS DELETE policies
select set_config('storage.allow_delete_query', 'true', true);

with deleted as (
  delete from storage.objects
   where bucket_id = 'report-photos'
     and name = 'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'
  returning id
)
select is(
  (select count(*)::int from deleted),
  1,
  'owner can DELETE their own server-uploaded report photo'
);

-- 6. citizen_reports photo_url accepts .webp and rejects .gif / .svg
reset role;

select lives_ok(
  $$insert into public.citizen_reports (id, user_id, kind, lat, lon, photo_url)
    values (
      'f0482000-0000-4000-8000-000000000001',
      'f0480000-0000-4000-8000-000000000001',
      'sighting',
      36.75,
      3.05,
      'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000002.webp'
    )$$,
  'citizen_reports accepts canonical .webp photo key'
);

select throws_ok(
  $$insert into public.citizen_reports (id, user_id, kind, lat, lon, photo_url)
    values (
      'f0482000-0000-4000-8000-000000000002',
      'f0480000-0000-4000-8000-000000000001',
      'sighting',
      36.75,
      3.05,
      'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000003.gif'
    )$$,
  '23514', null,
  'citizen_reports rejects .gif photo key'
);

select throws_ok(
  $$insert into public.citizen_reports (id, user_id, kind, lat, lon, photo_url)
    values (
      'f0482000-0000-4000-8000-000000000003',
      'f0480000-0000-4000-8000-000000000001',
      'sighting',
      36.75,
      3.05,
      'f0480000-0000-4000-8000-000000000001/f0481000-0000-4000-8000-000000000004.svg'
    )$$,
  '23514', null,
  'citizen_reports rejects .svg photo key'
);

-- 7. ON DELETE CASCADE when auth.users account is deleted
delete from auth.users where id = 'f0480000-0000-4000-8000-000000000001';

select is(
  (select count(*)::int from public.privacy_consents where user_id = 'f0480000-0000-4000-8000-000000000001'),
  0,
  'deleting auth.users cascades to privacy_consents'
);

select * from finish();

rollback;
