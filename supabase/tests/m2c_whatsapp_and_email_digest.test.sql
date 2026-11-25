begin;

set local search_path = public, extensions;

select no_plan();

-- Ensure baseline broadcast & pipeline settings active inside transaction
update public.broadcast_settings set enabled = true where id = true;
update public.delivery_pipeline_settings
   set enabled = true, paused = false, pause_reason = null
 where pipeline in ('whatsapp_channel', 'email_digest');

-- ============================================================================
-- 0. Fixtures: admin units, users/profiles, zones, alerts, ONM, official, broadcasts
-- ============================================================================
insert into public.admin_units (id, code, level, name_ar, name_fr, name_en, name_kab, lat, lon)
values
  ('c2c00000-0000-4000-8000-000000000001', '97', 'wilaya', 'ولاية م2ج', 'Wilaya M2C', 'Wilaya M2C', 'Wilaya M2C', 36.75, 3.05),
  ('c2c00000-0000-4000-8000-000000000002', '9701', 'commune', 'بلدية م2ج', 'Commune M2C', 'Commune M2C', 'Commune M2C', 36.75, 3.05)
on conflict (id) do nothing;

update public.admin_units
   set parent_id = 'c2c00000-0000-4000-8000-000000000001'
 where id = 'c2c00000-0000-4000-8000-000000000002';

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  -- User 1: confirmed, opted in (daily)
  (
    '00000000-0000-0000-0000-000000000000',
    'c2c10000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'm2c-opted-in@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  -- User 2: confirmed, default frequency ('off') — must NOT be listed
  (
    '00000000-0000-4000-8000-000000000002',
    'c2c10000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'm2c-default-off@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  -- User 3: unconfirmed email, frequency='immediate' — must NOT be listed
  (
    '00000000-0000-0000-0000-000000000000',
    'c2c10000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'm2c-unconfirmed@example.invalid', '', null,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  ),
  -- User 4: confirmed, opted in (hourly), will test hard bounce & cascade delete
  (
    '00000000-0000-4000-8000-000000000000',
    'c2c10000-0000-4000-8000-000000000004',
    'authenticated', 'authenticated', 'm2c-bounce@example.invalid', '', now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now()
  );

-- ============================================================================
-- 1. Profiles additive columns, defaults, CHECK constraints & RLS self-update
-- ============================================================================
select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_email_digest_frequency_valid'
       and contype = 'c'
  ),
  'profiles has named constraint profiles_email_digest_frequency_valid'
);

select ok(
  exists (
    select 1 from pg_constraint
     where conrelid = 'public.profiles'::regclass
       and conname = 'profiles_email_digest_hour_algiers_valid'
       and contype = 'c'
  ),
  'profiles has named constraint profiles_email_digest_hour_algiers_valid'
);

select is(
  (select email_digest_frequency from public.profiles where id = 'c2c10000-0000-4000-8000-000000000002'),
  'off',
  'new profiles default email_digest_frequency to off (Law 18-07 explicit opt-in)'
);

select is(
  (select email_digest_hour_algiers from public.profiles where id = 'c2c10000-0000-4000-8000-000000000002'),
  7::smallint,
  'new profiles default email_digest_hour_algiers to 7'
);

select has_index(
  'public', 'alerts', 'idx_alerts_email_undelivered',
  'alerts has partial index idx_alerts_email_undelivered'
);

-- Citizen self-update allowed & validated; other user's profile isolated
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c2c10000-0000-4000-8000-000000000001', true);

select lives_ok(
  $$update public.profiles
       set alert_email = true,
           email_digest_frequency = 'daily',
           email_digest_hour_algiers = 8
     where id = 'c2c10000-0000-4000-8000-000000000001'$$,
  'citizen can update own email_digest_frequency and email_digest_hour_algiers'
);

select throws_ok(
  $$update public.profiles
       set email_digest_frequency = 'weekly'
     where id = 'c2c10000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'invalid email_digest_frequency is rejected by CHECK constraint'
);

select throws_ok(
  $$update public.profiles
       set email_digest_hour_algiers = 24
     where id = 'c2c10000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'invalid email_digest_hour_algiers = 24 is rejected by CHECK constraint'
);

select throws_ok(
  $$update public.profiles
       set email_digest_hour_algiers = -1
     where id = 'c2c10000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'invalid email_digest_hour_algiers = -1 is rejected by CHECK constraint'
);

-- Attempt to modify another user's profile affects 0 rows under RLS
update public.profiles
   set email_digest_frequency = 'immediate'
 where id = 'c2c10000-0000-4000-8000-000000000002';

reset role;

select is(
  (select email_digest_frequency from public.profiles where id = 'c2c10000-0000-4000-8000-000000000002'),
  'off',
  'RLS isolates other user profile from citizen update'
);

-- Configure user 3 (unconfirmed) and user 4 (hourly)
update public.profiles
   set alert_email = true, email_digest_frequency = 'immediate'
 where id = 'c2c10000-0000-4000-8000-000000000003';
update public.profiles
   set alert_email = true, email_digest_frequency = 'hourly', locale = 'fr'
 where id = 'c2c10000-0000-4000-8000-000000000004';

-- ============================================================================
-- 2. WhatsApp Channel deliveries: enqueue idempotency, kill switches, lease-fencing,
--    backoff vs permanent fail, CAP Cancel & official cleared triggers, and 2-row
--    broadcast_delivery_queue invariance
-- ============================================================================
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id
)
values (
  'c2c20000-0000-4000-8000-000000000001',
  'urn:oid:m2c.onm.1',
  'Rain Severe warning for Wilaya M2C',
  'Rain', 'Severe', 'Expected', 'Likely',
  now() - interval '10 minutes', now() + interval '6 hours', now() - interval '15 minutes',
  'Wilaya M2C', 'c2c00000-0000-4000-8000-000000000001'
);

insert into public.official_incidents (
  id, wilaya_id, commune_id, kind, status, precision, authority_tier,
  first_reported_at, last_reported_at, as_of, evidence, place_text
)
values (
  'c2c20000-0000-4000-8000-000000000002',
  'c2c00000-0000-4000-8000-000000000001',
  'c2c00000-0000-4000-8000-000000000002',
  'flood', 'ongoing', 'commune', 'national',
  now() - interval '30 minutes', now() - interval '10 minutes', now() - interval '10 minutes',
  'تدخل متواصل لامتصاص المياه في بلدية م2ج',
  'حي م2ج'
);

insert into public.broadcasts (
  id, kind, phase, onm_vigilance_id, severity, hazard, source_key, commune_codes, push_codes
)
values (
  'c2c30000-0000-4000-8000-000000000001',
  'onm', 'initial', 'c2c20000-0000-4000-8000-000000000001',
  'Severe', 'rain', 'onm', array['9701'], array['9701']
);

insert into public.broadcasts (
  id, kind, phase, official_incident_id, severity, hazard, source_key, commune_codes, push_codes
)
values (
  'c2c30000-0000-4000-8000-000000000002',
  'official', 'initial', 'c2c20000-0000-4000-8000-000000000002',
  'Severe', 'flood', 'dgpc_telegram', array['9701'], array['9701']
);

-- Verify zero interference with broadcast_delivery_queue 2-channel invariant
select is(
  (select count(*) from public.broadcast_delivery_queue where broadcast_id = 'c2c30000-0000-4000-8000-000000000001'),
  2::bigint,
  'broadcast_delivery_queue still enqueues exact 2 rows (fcm, telegram) with zero WhatsApp interference'
);

-- Verify list_pending_whatsapp_broadcasts hydrates pending broadcasts and honors kill switches
select ok(
  exists (
    select 1
    from public.list_pending_whatsapp_broadcasts('channel-dz-ar', 'ar', 20) r
    where r.id = 'c2c30000-0000-4000-8000-000000000001'
      and r.kind = 'onm'
      and r.onm_event = 'Rain'
      and r.onm_area_desc = 'Wilaya M2C'
  ) and exists (
    select 1
    from public.list_pending_whatsapp_broadcasts('channel-dz-ar', 'ar', 20) r
    where r.id = 'c2c30000-0000-4000-8000-000000000002'
      and r.kind = 'official'
      and r.incident_status = 'ongoing'
      and r.incident_authority_tier = 'national'
  ),
  'list_pending_whatsapp_broadcasts returns un-enqueued ONM and official broadcasts with hydrated metadata'
);

update public.broadcast_settings set enabled = false where id = true;
select is(
  (select count(*)::int from public.list_pending_whatsapp_broadcasts('channel-dz-ar', 'ar', 20)),
  0,
  'list_pending_whatsapp_broadcasts returns empty when broadcast_settings.enabled = false'
);
update public.broadcast_settings set enabled = true where id = true;

-- Enqueue WhatsApp broadcast idempotently
select ok(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000001',
    'channel-dz-ar',
    'ar',
    'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-ar:ar',
    '{"text":"ONM Rain Severe"}'::jsonb,
    now() + interval '6 hours'
  ) is not null,
  'enqueue_whatsapp_broadcast inserts pending WhatsApp delivery row'
);

-- Enqueued broadcast is now excluded from list_pending_whatsapp_broadcasts for same target+locale
select is(
  (select count(*)::int
     from public.list_pending_whatsapp_broadcasts('channel-dz-ar', 'ar', 20)
    where id = 'c2c30000-0000-4000-8000-000000000001'),
  0,
  'list_pending_whatsapp_broadcasts excludes already-enqueued broadcast for target+locale'
);

-- Re-enqueue with same dedupe_key or same (broadcast_id, channel_target, locale) returns NULL, 0 duplicates
select is(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000001',
    'channel-dz-ar',
    'ar',
    'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-ar:ar',
    '{"text":"duplicate"}'::jsonb
  ),
  null::uuid,
  'enqueue_whatsapp_broadcast returns null on duplicate conflict'
);

select is(
  (select count(*)::int from public.whatsapp_channel_deliveries where broadcast_id = 'c2c30000-0000-4000-8000-000000000001'),
  1,
  'duplicate enqueue creates zero extra rows'
);

-- Kill switch 1: global broadcast_settings.enabled = false blocks claim
update public.broadcast_settings set enabled = false where id = true;
select is(
  (select count(*)::int from public.claim_whatsapp_deliveries(10)),
  0,
  'claim_whatsapp_deliveries returns empty when global broadcast_settings.enabled = false'
);
update public.broadcast_settings set enabled = true where id = true;

-- Kill switch 2: delivery_pipeline_settings paused or disabled blocks claim
select is(
  public.set_delivery_pipeline_state('whatsapp_channel', null, true, 'maintenance'),
  true,
  'set_delivery_pipeline_state pauses whatsapp_channel'
);
select is(
  (select count(*)::int from public.claim_whatsapp_deliveries(10)),
  0,
  'claim_whatsapp_deliveries returns empty when whatsapp_channel is paused'
);
select is(
  public.set_delivery_pipeline_state('whatsapp_channel', false, false, null),
  true,
  'set_delivery_pipeline_state disables whatsapp_channel'
);
select is(
  (select count(*)::int from public.claim_whatsapp_deliveries(10)),
  0,
  'claim_whatsapp_deliveries returns empty when whatsapp_channel is disabled'
);
select is(
  public.set_delivery_pipeline_state('whatsapp_channel', true, false, null),
  true,
  'set_delivery_pipeline_state re-enables whatsapp_channel'
);

-- Claim, wrong lease token rejected, transient backoff, then permanent failure on another row
do $$
declare
  _row public.whatsapp_channel_deliveries%rowtype;
  _ok boolean;
begin
  select * into _row from public.claim_whatsapp_deliveries(10) limit 1;
  if _row.id is null or _row.state <> 'leased' or _row.attempts <> 1 or _row.lease_token is null then
    raise exception 'expected leased row with attempts=1';
  end if;

  -- Wrong lease token must fail
  select public.finish_whatsapp_delivery(_row.id, gen_random_uuid(), true, 'wamid.wrong', null, false, null)
    into _ok;
  if _ok then
    raise exception 'wrong lease token must be rejected';
  end if;

  -- Transient 429 failure with Retry-After=120 schedules backoff >= 120s
  select public.finish_whatsapp_delivery(_row.id, _row.lease_token, false, null, 'http_429', false, 120)
    into _ok;
  if not _ok then
    raise exception 'transient finish should succeed';
  end if;
end;
$$;
select pass('claim_whatsapp_deliveries leases row, rejects wrong lease token, and schedules transient backoff');

select ok(
  (select state = 'pending' and next_attempt_at >= now() + interval '115 seconds' and last_error = 'http_429' and lease_token is null
     from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-ar:ar'),
  'transient failure returns row to pending with Retry-After bounded backoff and cleared lease'
);

-- Force row due, re-claim, and deliver
update public.whatsapp_channel_deliveries
   set next_attempt_at = now() - interval '1 second'
 where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-ar:ar';

do $$
declare
  _row public.whatsapp_channel_deliveries%rowtype;
  _ok boolean;
begin
  select * into _row from public.claim_whatsapp_deliveries(10) limit 1;
  if _row.attempts <> 2 then
    raise exception 'expected attempts=2 on retry, got %', _row.attempts;
  end if;
  select public.finish_whatsapp_delivery(_row.id, _row.lease_token, true, 'wamid.ok.1', null, false, null)
    into _ok;
  if not _ok then
    raise exception 'delivered finish should succeed';
  end if;
end;
$$;
select pass('retry claim increments attempts and finish marks delivered');

select ok(
  (select state = 'delivered' and provider_message_id = 'wamid.ok.1' and delivered_at is not null and last_error is null
     from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-ar:ar'),
  'delivered WhatsApp row stores provider_message_id and delivered_at'
);

-- Permanent 4xx failure immediately marks failed with no retry
select ok(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000001',
    'channel-dz-fr',
    'fr',
    'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-fr:fr',
    '{"text":"ONM FR"}'::jsonb,
    now() + interval '6 hours'
  ) is not null,
  'enqueue second WhatsApp locale row for permanent failure test'
);

do $$
declare
  _row public.whatsapp_channel_deliveries%rowtype;
  _ok boolean;
begin
  select * into _row from public.claim_whatsapp_deliveries(10) limit 1;
  select public.finish_whatsapp_delivery(_row.id, _row.lease_token, false, null, 'http_403_forbidden', true, null)
    into _ok;
  if not _ok then
    raise exception 'permanent finish should return true';
  end if;
end;
$$;
select is(
  (select state from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-fr:fr'),
  'failed',
  'permanent 4xx failure immediately transitions WhatsApp row to failed without retry'
);

-- ONM CAP Cancel invalidation trigger (both pending and mid-flight leased)
select ok(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000001',
    'channel-dz-en',
    'en',
    'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-en:en',
    '{"text":"ONM EN pending"}'::jsonb,
    now() + interval '6 hours'
  ) is not null,
  'enqueue pending EN row before CAP Cancel'
);
select ok(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000001',
    'channel-dz-kab',
    'kab',
    'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-kab:kab',
    '{"text":"ONM KAB leased"}'::jsonb,
    now() + interval '6 hours'
  ) is not null,
  'enqueue KAB row to be leased mid-flight before CAP Cancel'
);

-- Claim only the KAB row by bumping EN next_attempt_at slightly
update public.whatsapp_channel_deliveries
   set next_attempt_at = now() + interval '5 minutes'
 where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-en:en';

do $$
declare
  _leased public.whatsapp_channel_deliveries%rowtype;
  _ok boolean;
begin
  select * into _leased from public.claim_whatsapp_deliveries(1) limit 1;
  if _leased.locale <> 'kab' then
    raise exception 'expected to lease kab row, got %', _leased.locale;
  end if;

  -- Fire CAP Cancel trigger on onm_vigilance
  update public.onm_vigilance
     set cancelled_at = now()
   where id = 'c2c20000-0000-4000-8000-000000000001';

  -- Mid-flight race: even finish(..., _delivered => true) must return false and preserve cancelled/cap_cancelled
  select public.finish_whatsapp_delivery(_leased.id, _leased.lease_token, true, 'wamid.race.onm', null, false, null)
    into _ok;
  if _ok then
    raise exception 'finish_whatsapp_delivery(_delivered => true) after mid-flight CAP Cancel must return false';
  end if;
end;
$$;
select pass('ONM CAP Cancel trigger executes cleanly and mid-flight finish(_delivered=>true) returns false without overwriting state');

select ok(
  (select state = 'cancelled' and last_error = 'cap_cancelled' and lease_token is null and lease_until is null
     from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-en:en'),
  'pending WhatsApp row is cancelled with last_error=cap_cancelled on ONM CAP Cancel'
);

select ok(
  (select state = 'cancelled' and last_error = 'cap_cancelled' and lease_token is null and lease_until is null and provider_message_id is null
     from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-kab:kab'),
  'mid-flight leased WhatsApp row preserves cancelled/cap_cancelled even when finish_whatsapp_delivery receives _delivered=true'
);

select is(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000001',
    'channel-dz-late',
    'ar',
    'wa:c2c30000-0000-4000-8000-000000000001:channel-dz-late:ar',
    '{"text":"late"}'::jsonb
  ),
  null::uuid,
  'enqueue_whatsapp_broadcast fails closed (returns null) for cancelled ONM broadcast'
);

-- Official incident cleared invalidation trigger (pending + mid-flight leased)
select ok(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000002',
    'channel-dz-ar',
    'ar',
    'wa:c2c30000-0000-4000-8000-000000000002:channel-dz-ar:ar',
    '{"text":"DGPC flood pending"}'::jsonb,
    now() + interval '6 hours'
  ) is not null,
  'enqueue pending official flood row'
);
select ok(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000002',
    'channel-dz-fr',
    'fr',
    'wa:c2c30000-0000-4000-8000-000000000002:channel-dz-fr:fr',
    '{"text":"DGPC flood leased"}'::jsonb,
    now() + interval '6 hours'
  ) is not null,
  'enqueue official flood row to be leased'
);

update public.whatsapp_channel_deliveries
   set next_attempt_at = now() + interval '5 minutes'
 where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000002:channel-dz-ar:ar';

do $$
declare
  _leased public.whatsapp_channel_deliveries%rowtype;
  _ok boolean;
begin
  select * into _leased from public.claim_whatsapp_deliveries(1) limit 1;
  update public.official_incidents
     set status = 'cleared'
   where id = 'c2c20000-0000-4000-8000-000000000002';
  -- Mid-flight race: even finish(..., _delivered => true) must return false and preserve cancelled/official_cleared
  select public.finish_whatsapp_delivery(_leased.id, _leased.lease_token, true, 'wamid.race.official', null, false, null)
    into _ok;
  if _ok then
    raise exception 'finish_whatsapp_delivery(_delivered => true) after mid-flight official cleared must return false';
  end if;
end;
$$;
select ok(
  (select state = 'cancelled' and last_error = 'official_cleared' and lease_token is null and lease_until is null
     from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000002:channel-dz-ar:ar')
  and (select state = 'cancelled' and last_error = 'official_cleared' and lease_token is null and lease_until is null and provider_message_id is null
     from public.whatsapp_channel_deliveries
    where dedupe_key = 'wa:c2c30000-0000-4000-8000-000000000002:channel-dz-fr:fr'),
  'official incident cleared trigger invalidates both pending and mid-flight leased WhatsApp rows even when finish receives _delivered=true'
);

select is(
  public.enqueue_whatsapp_broadcast(
    'c2c30000-0000-4000-8000-000000000002',
    'channel-dz-late',
    'en',
    'wa:c2c30000-0000-4000-8000-000000000002:channel-dz-late:en',
    '{"text":"late"}'::jsonb
  ),
  null::uuid,
  'enqueue_whatsapp_broadcast fails closed for cleared initial official incident'
);

-- Head-of-line starvation regression: 20 older cleared official broadcasts + cancelled-phase
-- + extinguished fire must NOT starve a newer active Extreme ONM broadcast in limit=20 window
do $$
declare
  _i integer;
  _inc_id uuid;
  _b_id uuid;
begin
  for _i in 1..20 loop
    _inc_id := ('c2c90000-0000-4000-8000-' || lpad(_i::text, 12, '0'))::uuid;
    _b_id   := ('c2c91000-0000-4000-8000-' || lpad(_i::text, 12, '0'))::uuid;

    insert into public.official_incidents (
      id, wilaya_id, commune_id, kind, status, precision, authority_tier,
      first_reported_at, last_reported_at, as_of, evidence, place_text
    )
    values (
      _inc_id,
      'c2c00000-0000-4000-8000-000000000001',
      'c2c00000-0000-4000-8000-000000000002',
      'flood', 'cleared', 'commune', 'national',
      now() - interval '6 hours', now() - interval '5 hours', now() - interval '5 hours',
      'Cleared intervention #' || _i,
      'Commune M2C'
    );

    insert into public.broadcasts (
      id, kind, phase, official_incident_id, severity, hazard, source_key,
      commune_codes, push_codes, created_at
    )
    values (
      _b_id, 'official', 'initial', _inc_id, 'Severe', 'flood', 'dgpc_telegram',
      array['9701'], array['9701'], now() - interval '6 hours' + (_i || ' minutes')::interval
    );
  end loop;
end;
$$;

-- Older cancelled-phase broadcast
insert into public.broadcasts (
  id, kind, phase, official_incident_id, severity, hazard, source_key,
  commune_codes, push_codes, created_at
)
values (
  'c2c92000-0000-4000-8000-000000000001',
  'official', 'cancel', 'c2c90000-0000-4000-8000-000000000001',
  'Severe', 'flood', 'dgpc_telegram',
  array['9701'], array['9701'], now() - interval '5 hours'
);

-- Older extinguished fire cluster + broadcast
insert into public.fire_clusters (
  id, short_id, state, first_detected_at, last_detected_at, lat, lon, wilaya_id
)
values (
  'c2c93000-0000-4000-8000-000000000001',
  'm2c-ext-1',
  'extinguished',
  now() - interval '5 hours',
  now() - interval '4 hours',
  36.75, 3.05,
  'c2c00000-0000-4000-8000-000000000001'
);

insert into public.broadcasts (
  id, kind, phase, cluster_id, severity, hazard, source_key,
  commune_codes, push_codes, created_at
)
values (
  'c2c94000-0000-4000-8000-000000000001',
  'fire', 'end', 'c2c93000-0000-4000-8000-000000000001',
  'Severe', 'fire', 'firms',
  array['9701'], array['9701'], now() - interval '4 hours'
);

-- Newer active Extreme ONM warning inserted AFTER the 22 ineligible broadcasts
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id
)
values (
  'c2c95000-0000-4000-8000-000000000001',
  'urn:oid:m2c.onm.starve.extreme',
  'Rain Extreme warning for Wilaya M2C',
  'Rain', 'Extreme', 'Immediate', 'Observed',
  now() - interval '5 minutes', now() + interval '6 hours', now() - interval '2 minutes',
  'Wilaya M2C', 'c2c00000-0000-4000-8000-000000000001'
);

insert into public.broadcasts (
  id, kind, phase, onm_vigilance_id, severity, hazard, source_key,
  commune_codes, push_codes, created_at
)
values (
  'c2c96000-0000-4000-8000-000000000001',
  'onm', 'initial', 'c2c95000-0000-4000-8000-000000000001',
  'Extreme', 'rain', 'onm',
  array['9701'], array['9701'], now() - interval '1 minute'
);

select ok(
  exists (
    select 1
      from public.list_pending_whatsapp_broadcasts('channel-starve-test', 'ar', 20) r
     where r.id = 'c2c96000-0000-4000-8000-000000000001'
       and r.kind = 'onm'
       and r.severity = 'Extreme'
  ),
  'list_pending_whatsapp_broadcasts returns newer Extreme ONM broadcast without 20-row starvation'
);

select is(
  (select count(*)::int
     from public.list_pending_whatsapp_broadcasts('channel-starve-test', 'ar', 20) r
    where r.id::text like 'c2c91000-%'
       or r.id in (
         'c2c92000-0000-4000-8000-000000000001',
         'c2c94000-0000-4000-8000-000000000001'
       )),
  0,
  'list_pending_whatsapp_broadcasts excludes cleared official, cancelled-phase, and extinguished fire rows'
);

-- ============================================================================
-- 3. Email Digest deliveries & suppressions: opt-in, confirmed email, dedup,
--    atomic alerts.delivered_email=true, retry vs permanent fail, hard bounce
--    suppression, and ON DELETE CASCADE
-- ============================================================================
insert into public.zones (id, user_id, name, lat, lon, radius_km)
values
  ('c2c40000-0000-4000-8000-000000000001', 'c2c10000-0000-4000-8000-000000000001', 'Alger Centre', 36.75, 3.05, 10),
  ('c2c40000-0000-4000-8000-000000000002', 'c2c10000-0000-4000-8000-000000000002', 'Default Off Zone', 36.75, 3.05, 10),
  ('c2c40000-0000-4000-8000-000000000003', 'c2c10000-0000-4000-8000-000000000003', 'Unconfirmed Zone', 36.75, 3.05, 10),
  ('c2c40000-0000-4000-8000-000000000004', 'c2c10000-0000-4000-8000-000000000004', 'Bounce Zone', 36.75, 3.05, 10);

insert into public.alerts (id, user_id, zone_id, kind, severity, dedupe_key, title, body, delivered_email)
values
  ('c2c50000-0000-4000-8000-000000000001', 'c2c10000-0000-4000-8000-000000000001', 'c2c40000-0000-4000-8000-000000000001', 'weather', 4, 'm2c:a1', 'ONM Rain Severe', 'Body 1', false),
  ('c2c50000-0000-4000-8000-000000000002', 'c2c10000-0000-4000-8000-000000000001', 'c2c40000-0000-4000-8000-000000000001', 'earthquake', 4, 'm2c:a2', 'M4.5 Quake', 'Body 2', false),
  ('c2c50000-0000-4000-8000-000000000003', 'c2c10000-0000-4000-8000-000000000002', 'c2c40000-0000-4000-8000-000000000002', 'weather', 4, 'm2c:a3', 'Off User Alert', 'Body 3', false),
  ('c2c50000-0000-4000-8000-000000000004', 'c2c10000-0000-4000-8000-000000000003', 'c2c40000-0000-4000-8000-000000000003', 'weather', 4, 'm2c:a4', 'Unconfirmed User Alert', 'Body 4', false),
  ('c2c50000-0000-4000-8000-000000000005', 'c2c10000-0000-4000-8000-000000000004', 'c2c40000-0000-4000-8000-000000000004', 'official', 4, 'm2c:a5', 'DGPC Flood', 'Body 5', false);

-- Only user 1 and user 4 qualify (user 2 is frequency='off'; user 3 is unconfirmed)
select is(
  (select array_agg(user_id order by user_id)
     from public.list_pending_email_digest_users(100)
    where user_id in (
      'c2c10000-0000-4000-8000-000000000001',
      'c2c10000-0000-4000-8000-000000000002',
      'c2c10000-0000-4000-8000-000000000003',
      'c2c10000-0000-4000-8000-000000000004'
    )),
  array[
    'c2c10000-0000-4000-8000-000000000001'::uuid,
    'c2c10000-0000-4000-8000-000000000004'::uuid
  ],
  'list_pending_email_digest_users returns only opted-in users with confirmed emails and undelivered alerts'
);

-- Cursor pagination: passing user 1 as _after_user_id advances directly to user 4
select is(
  (select array_agg(user_id order by user_id)
     from public.list_pending_email_digest_users(100, 'c2c10000-0000-4000-8000-000000000001'::uuid)
    where user_id in (
      'c2c10000-0000-4000-8000-000000000001',
      'c2c10000-0000-4000-8000-000000000004'
    )),
  array['c2c10000-0000-4000-8000-000000000004'::uuid],
  'list_pending_email_digest_users cursor _after_user_id paginates past lower-UUID users'
);

-- Urgent 'immediate' sent email for a 'daily' user must NOT pollute daily last_sent_at
do $$
declare
  _claim record;
  _ok boolean;
begin
  select * into _claim from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'immediate',
    'immediate:urgent-bypass-0200',
    'email:u1:immediate:urgent-bypass-0200',
    'ar',
    array['c2c50000-0000-4000-8000-000000000001'::uuid],
    true,
    '[Urgent] Night alert'
  );
  select public.finish_email_digest_delivery(_claim.id, _claim.lease_token, true, 're_urgent_0200', null, false, false, null)
    into _ok;
  if not _ok then
    raise exception 'urgent immediate finish should succeed';
  end if;
end;
$$;

select is(
  (select last_sent_at
     from public.list_pending_email_digest_users(100)
    where user_id = 'c2c10000-0000-4000-8000-000000000001'),
  null::timestamptz,
  'same-day immediate urgent bypass does NOT pollute last_sent_at for a daily digest subscriber'
);

-- Reset alert 1 back to delivered_email = false for the daily digest lifecycle tests below
update public.alerts
   set delivered_email = false
 where id = 'c2c50000-0000-4000-8000-000000000001';

-- Pause email_digest pipeline -> list & claim return empty
select is(
  public.set_delivery_pipeline_state('email_digest', null, true, 'incident_hold'),
  true,
  'set_delivery_pipeline_state pauses email_digest'
);
select is(
  (select count(*)::int from public.list_pending_email_digest_users(100)),
  0,
  'list_pending_email_digest_users returns empty when email_digest pipeline is paused'
);
select is(
  (select count(*)::int from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001', 'daily', 'daily:2026-11-25',
    'email:u1:daily:2026-11-25', 'ar',
    array['c2c50000-0000-4000-8000-000000000001'::uuid], false, 'Paused test'
  )),
  0,
  'claim_email_digest_delivery returns empty when email_digest pipeline is paused'
);
select is(
  public.set_delivery_pipeline_state('email_digest', true, false, null),
  true,
  'set_delivery_pipeline_state unpauses email_digest'
);

-- Claim, verify concurrent dedup, transient retry, then sent + atomic alerts.delivered_email=true
do $$
declare
  _claim record;
  _dup_count integer;
  _ok boolean;
begin
  select * into _claim from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'daily',
    'daily:2026-11-25',
    'email:u1:daily:2026-11-25',
    'ar',
    array[
      'c2c50000-0000-4000-8000-000000000001'::uuid,
      'c2c50000-0000-4000-8000-000000000002'::uuid
    ],
    false,
    'Nadhir: 2 zone alerts'
  );
  if _claim.id is null or _claim.attempts <> 1 then
    raise exception 'expected initial claim with attempts=1';
  end if;

  -- Concurrent claim for same dedupe_key/window_key must return 0 rows
  select count(*) into _dup_count from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'daily',
    'daily:2026-11-25',
    'email:u1:daily:2026-11-25',
    'ar',
    array['c2c50000-0000-4000-8000-000000000001'::uuid],
    false,
    'Duplicate'
  );
  if _dup_count <> 0 then
    raise exception 'concurrent claim must be deduplicated';
  end if;

  -- Transient failure -> pending with backoff; alerts must still be delivered_email = false
  select public.finish_email_digest_delivery(_claim.id, _claim.lease_token, false, null, 'http_503', false, false, 60)
    into _ok;
  if not _ok then
    raise exception 'transient finish should succeed';
  end if;
end;
$$;
select pass('claim_email_digest_delivery deduplicates active lease and transient failure schedules retry');

select is(
  (select count(*)::int from public.alerts
    where user_id = 'c2c10000-0000-4000-8000-000000000001' and delivered_email = false),
  2,
  'transient failure does NOT mark alerts.delivered_email = true'
);

-- Make pending retry due, re-claim, and finish sent -> atomically marks alerts delivered_email = true
update public.email_digest_deliveries
   set next_attempt_at = now() - interval '1 second'
 where dedupe_key = 'email:u1:daily:2026-11-25';

do $$
declare
  _claim record;
  _post_sent_dup integer;
  _ok boolean;
begin
  select * into _claim from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'daily',
    'daily:2026-11-25',
    'email:u1:daily:2026-11-25',
    'ar',
    array[
      'c2c50000-0000-4000-8000-000000000001'::uuid,
      'c2c50000-0000-4000-8000-000000000002'::uuid
    ],
    false,
    'Nadhir: 2 zone alerts'
  );
  if _claim.attempts <> 2 then
    raise exception 'expected attempts=2 on retry claim, got %', _claim.attempts;
  end if;

  select public.finish_email_digest_delivery(_claim.id, _claim.lease_token, true, 're_msg_123', null, false, false, null)
    into _ok;
  if not _ok then
    raise exception 'sent finish should succeed';
  end if;

  -- Re-claiming an already sent window must return 0 rows
  select count(*) into _post_sent_dup from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'daily',
    'daily:2026-11-25',
    'email:u1:daily:2026-11-25',
    'ar',
    array['c2c50000-0000-4000-8000-000000000001'::uuid],
    false,
    'Duplicate after sent'
  );
  if _post_sent_dup <> 0 then
    raise exception 'already-sent digest window must not be re-claimed';
  end if;
end;
$$;
select pass('finish_email_digest_delivery sent prevents re-claim and commits state=sent');

select is(
  (select count(*)::int from public.alerts
    where user_id = 'c2c10000-0000-4000-8000-000000000001' and delivered_email = true),
  2,
  'finish_email_digest_delivery atomically updates alerts.delivered_email = true on sent'
);

-- Hard bounce on user 4 -> marks state='bounced', records suppression, blocks future list & claim
do $$
declare
  _claim record;
  _ok boolean;
begin
  select * into _claim from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000004',
    'hourly',
    'hourly:2026-11-25T08',
    'email:u4:hourly:2026-11-25T08',
    'fr',
    array['c2c50000-0000-4000-8000-000000000005'::uuid],
    false,
    'Nadhir: DGPC Flood'
  );
  select public.finish_email_digest_delivery(_claim.id, _claim.lease_token, false, null, '550 5.1.1 user unknown', true, true, null)
    into _ok;
  if not _ok then
    raise exception 'bounced finish should succeed';
  end if;
end;
$$;

select ok(
  (select state = 'bounced' and bounced_at is not null
     from public.email_digest_deliveries
    where dedupe_key = 'email:u4:hourly:2026-11-25T08'),
  'hard bounce marks email_digest_deliveries row state=bounced'
);

select ok(
  exists (
    select 1 from public.email_digest_suppressions
     where user_id = 'c2c10000-0000-4000-8000-000000000004'
       and reason = 'hard_bounce'
  ),
  'hard bounce upserts email_digest_suppressions row'
);

select is(
  (select count(*)::int from public.list_pending_email_digest_users(100)
    where user_id = 'c2c10000-0000-4000-8000-000000000004'),
  0,
  'suppressed user is excluded from list_pending_email_digest_users'
);

select is(
  (select count(*)::int from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000004',
    'hourly',
    'hourly:2026-11-25T09',
    'email:u4:hourly:2026-11-25T09',
    'fr',
    array['c2c50000-0000-4000-8000-000000000005'::uuid],
    false,
    'Blocked retry'
  )),
  0,
  'suppressed user cannot claim future email_digest_deliveries'
);

-- Permanent non-bounce failure marks failed immediately (no suppression)
insert into public.alerts (id, user_id, zone_id, kind, severity, dedupe_key, title, body, delivered_email)
values (
  'c2c50000-0000-4000-8000-000000000006',
  'c2c10000-0000-4000-8000-000000000001',
  'c2c40000-0000-4000-8000-000000000001',
  'fire', 5, 'm2c:a6', 'Urgent Fire', 'Body 6', false
);

do $$
declare
  _claim record;
  _ok boolean;
begin
  select * into _claim from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'immediate',
    'immediate:perm-test',
    'email:u1:immediate:perm-test',
    'ar',
    array['c2c50000-0000-4000-8000-000000000006'::uuid],
    true,
    '[Urgent] Fire'
  );
  select public.finish_email_digest_delivery(_claim.id, _claim.lease_token, false, null, 'http_401_unauthorized', true, false, null)
    into _ok;
  if not _ok then
    raise exception 'permanent failure finish should succeed';
  end if;
end;
$$;

select is(
  (select state from public.email_digest_deliveries where dedupe_key = 'email:u1:immediate:perm-test'),
  'failed',
  'permanent non-bounce 4xx immediately transitions email digest row to failed'
);

-- Expired attempt-5 stale lease is swept to failed by claim_email_digest_delivery
insert into public.email_digest_deliveries (
  user_id, digest_kind, window_key, dedupe_key, locale, alert_ids, alert_count,
  urgent_bypass, state, attempts, lease_token, lease_until, subject
)
values (
  'c2c10000-0000-4000-8000-000000000001',
  'immediate',
  'immediate:stale-attempt-5',
  'email:u1:immediate:stale-attempt-5',
  'ar',
  array['c2c50000-0000-4000-8000-000000000006'::uuid],
  1,
  false,
  'leased',
  5,
  gen_random_uuid(),
  now() - interval '10 seconds',
  'Stale attempt 5'
);

select is(
  (select count(*)::int from public.claim_email_digest_delivery(
    'c2c10000-0000-4000-8000-000000000001',
    'immediate',
    'immediate:stale-attempt-5',
    'email:u1:immediate:stale-attempt-5',
    'ar',
    array['c2c50000-0000-4000-8000-000000000006'::uuid],
    false,
    'Stale attempt 5'
  )),
  0,
  'claim_email_digest_delivery does not re-claim expired attempt-5 row'
);

select ok(
  (select state = 'failed' and lease_token is null and lease_until is null and last_error = 'max_attempts_exceeded'
     from public.email_digest_deliveries
    where dedupe_key = 'email:u1:immediate:stale-attempt-5'),
  'claim_email_digest_delivery sweeps expired attempt-5 stale lease to state=failed'
);

-- ON DELETE CASCADE on auth.users deletes email_digest_deliveries & email_digest_suppressions cleanly
delete from auth.users where id = 'c2c10000-0000-4000-8000-000000000004';
select is(
  (select count(*)::int from public.email_digest_deliveries where user_id = 'c2c10000-0000-4000-8000-000000000004')
  + (select count(*)::int from public.email_digest_suppressions where user_id = 'c2c10000-0000-4000-8000-000000000004'),
  0,
  'deleting auth.users cascades cleanly to email_digest_deliveries and email_digest_suppressions'
);

-- ============================================================================
-- 4. Full 5-Role Privilege Matrix, RLS Enabled & search_path = '' Verification
-- ============================================================================
do $$
declare
  _tbl text;
  _role text;
  _priv text;
  _fn text;
  _tables text[] := array[
    'public.delivery_pipeline_settings',
    'public.whatsapp_channel_deliveries',
    'public.email_digest_deliveries',
    'public.email_digest_suppressions'
  ];
  _rpcs text[] := array[
    'public.list_pending_whatsapp_broadcasts(text, text, integer)',
    'public.enqueue_whatsapp_broadcast(uuid, text, text, text, jsonb, timestamptz)',
    'public.claim_whatsapp_deliveries(integer)',
    'public.finish_whatsapp_delivery(uuid, uuid, boolean, text, text, boolean, integer)',
    'public.list_pending_email_digest_users(integer, uuid)',
    'public.claim_email_digest_delivery(uuid, text, text, text, text, uuid[], boolean, text)',
    'public.finish_email_digest_delivery(uuid, uuid, boolean, text, text, boolean, boolean, integer)',
    'public.set_delivery_pipeline_state(text, boolean, boolean, text)'
  ];
  _triggers text[] := array[
    'public.invalidate_cancelled_onm_whatsapp_deliveries()',
    'public.invalidate_cleared_official_whatsapp_deliveries()'
  ];
  _all_fns text[];
  _proconfig text[];
begin
  -- Verify RLS is enabled on all 4 new tables
  foreach _tbl in array _tables loop
    if not (select c.relrowsecurity from pg_class c where c.oid = _tbl::regclass) then
      raise exception 'RLS not enabled on %', _tbl;
    end if;

    -- public, anon, authenticated, cold_reader must have ZERO privileges on all 4 tables
    foreach _role in array array['public', 'anon', 'authenticated', 'cold_reader'] loop
      foreach _priv in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
        if has_table_privilege(_role, _tbl, _priv) then
          raise exception 'unexpected % privilege for % on %', _priv, _role, _tbl;
        end if;
      end loop;
    end loop;

    -- service_role must have SELECT on all 4 tables
    if not has_table_privilege('service_role', _tbl, 'SELECT') then
      raise exception 'missing service_role SELECT on %', _tbl;
    end if;
  end loop;

  -- Verify all 8 RPCs: execute ONLY for service_role
  foreach _fn in array _rpcs loop
    foreach _role in array array['public', 'anon', 'authenticated', 'cold_reader'] loop
      if has_function_privilege(_role, _fn, 'execute') then
        raise exception 'unexpected execute privilege for % on %', _role, _fn;
      end if;
    end loop;
    if not has_function_privilege('service_role', _fn, 'execute') then
      raise exception 'missing service_role execute privilege on %', _fn;
    end if;
  end loop;

  -- Verify both trigger functions: ZERO execute grants for all 5 roles
  foreach _fn in array _triggers loop
    foreach _role in array array['public', 'anon', 'authenticated', 'service_role', 'cold_reader'] loop
      if has_function_privilege(_role, _fn, 'execute') then
        raise exception 'unexpected execute privilege on trigger % for %', _fn, _role;
      end if;
    end loop;
  end loop;

  -- Verify search_path = '' on all 10 new functions
  _all_fns := _rpcs || _triggers;
  foreach _fn in array _all_fns loop
    select p.proconfig into _proconfig
      from pg_proc p
     where p.oid = _fn::regprocedure;
    if _proconfig is null or not ('search_path=""' = any(_proconfig) or 'search_path=' = any(_proconfig)) then
      raise exception 'missing search_path = '''' on % (proconfig=%)', _fn, _proconfig;
    end if;
  end loop;
end;
$$;
select pass('5-role privilege matrix, RLS enablement, and search_path = '''' verified across all 4 tables and 10 functions');

-- Runtime role checks: anon, authenticated, cold_reader rejected on tables & RPCs
set local role anon;
select throws_ok($$select * from public.delivery_pipeline_settings$$, '42501', null, 'anon cannot read delivery_pipeline_settings');
select throws_ok($$select * from public.whatsapp_channel_deliveries$$, '42501', null, 'anon cannot read whatsapp_channel_deliveries');
select throws_ok($$select * from public.email_digest_deliveries$$, '42501', null, 'anon cannot read email_digest_deliveries');
select throws_ok($$select * from public.email_digest_suppressions$$, '42501', null, 'anon cannot read email_digest_suppressions');
select throws_ok($$select * from public.list_pending_email_digest_users(10)$$, '42501', null, 'anon cannot execute list_pending_email_digest_users');
select throws_ok($$select * from public.list_pending_whatsapp_broadcasts('channel-dz', 'ar', 10)$$, '42501', null, 'anon cannot execute list_pending_whatsapp_broadcasts');
reset role;

set local role authenticated;
select throws_ok($$select * from public.delivery_pipeline_settings$$, '42501', null, 'authenticated cannot read delivery_pipeline_settings');
select throws_ok($$select * from public.whatsapp_channel_deliveries$$, '42501', null, 'authenticated cannot read whatsapp_channel_deliveries');
select throws_ok($$select * from public.email_digest_deliveries$$, '42501', null, 'authenticated cannot read email_digest_deliveries');
select throws_ok($$select * from public.email_digest_suppressions$$, '42501', null, 'authenticated cannot read email_digest_suppressions');
select throws_ok($$select * from public.claim_whatsapp_deliveries(10)$$, '42501', null, 'authenticated cannot execute claim_whatsapp_deliveries');
select throws_ok($$select * from public.list_pending_whatsapp_broadcasts('channel-dz', 'ar', 10)$$, '42501', null, 'authenticated cannot execute list_pending_whatsapp_broadcasts');
select throws_ok($$select public.set_delivery_pipeline_state('email_digest', false, null, null)$$, '42501', null, 'authenticated cannot execute set_delivery_pipeline_state');
reset role;

-- cold_reader privilege assertions (explicit catalog checks — postgres cannot SET ROLE cold_reader on Supabase)
select is(has_table_privilege('cold_reader', 'public.delivery_pipeline_settings', 'SELECT'), false, 'cold_reader has no SELECT on delivery_pipeline_settings');
select is(has_table_privilege('cold_reader', 'public.whatsapp_channel_deliveries', 'SELECT'), false, 'cold_reader has no SELECT on whatsapp_channel_deliveries');
select is(has_table_privilege('cold_reader', 'public.email_digest_deliveries', 'SELECT'), false, 'cold_reader has no SELECT on email_digest_deliveries');
select is(has_table_privilege('cold_reader', 'public.email_digest_suppressions', 'SELECT'), false, 'cold_reader has no SELECT on email_digest_suppressions');

select * from finish();

rollback;
