begin;

set local search_path = public, extensions;

select no_plan();

-- Ensure broadcast delivery is enabled and channels are unpaused in this test transaction
update public.broadcast_settings set enabled = true where id = true;
update public.delivery_channel_settings set paused = false where channel in ('fcm', 'telegram');

-- Ensure fixtures: a wilaya + commune + official_incident + earthquake
insert into public.admin_units (id, code, level, name_ar, name_fr, name_en, name_kab, lat, lon)
values
  ('a2a00000-0000-4000-8000-000000000001', '98', 'wilaya', 'ولاية اختبار', 'Wilaya M2A', 'Wilaya M2A', 'Wilaya M2A', 36.75, 3.05),
  ('a2a00000-0000-4000-8000-000000000002', '9801', 'commune', 'بلدية اختبار', 'Commune M2A', 'Commune M2A', 'Commune M2A', 36.75, 3.05)
on conflict (id) do nothing;

update public.admin_units
   set parent_id = 'a2a00000-0000-4000-8000-000000000001'
 where id = 'a2a00000-0000-4000-8000-000000000002';

insert into public.earthquakes (id, occurred_at, lat, lon, depth_km, magnitude, magnitude_type, region, network, commune_id, offshore, updated_at)
values
  ('m2a-eq-42', now() - interval '10 minutes', 36.75, 3.05, 10.0, 4.2, 'ML', 'NORTHERN ALGERIA', 'EMSC', 'a2a00000-0000-4000-8000-000000000002', false, now())
on conflict (id) do nothing;

insert into public.official_incidents (
  id, wilaya_id, commune_id, kind, status, precision, authority_tier,
  first_reported_at, last_reported_at, as_of, evidence, place_text
)
values
  (
    'a2a10000-0000-4000-8000-000000000001',
    'a2a00000-0000-4000-8000-000000000001',
    'a2a00000-0000-4000-8000-000000000002',
    'flood', 'ongoing', 'commune', 'national',
    now() - interval '1 hour', now() - interval '30 minutes', now() - interval '30 minutes',
    'تدخل متواصل لامتصاص مياه الأمطار في بلدية اختبار',
    'حي الاختبار'
  ),
  (
    'a2a10000-0000-4000-8000-000000000002',
    'a2a00000-0000-4000-8000-000000000001',
    'a2a00000-0000-4000-8000-000000000002',
    'road', 'cleared', 'commune', 'national',
    now() - interval '2 hours', now() - interval '20 minutes', now() - interval '20 minutes',
    'فتح الطريق الوطني بعد إزالة الأوحال في بلدية اختبار',
    'الطريق الوطني 5'
  );

-- ============================================================================
-- 1. Schema defaults, CHECK constraints & index invariants
-- ============================================================================
select has_index(
  'public', 'broadcasts', 'idx_broadcasts_onm_once',
  'idx_broadcasts_onm_once stays intact'
);
select has_index(
  'public', 'broadcasts', 'idx_broadcasts_official_phase_once',
  'idx_broadcasts_official_phase_once enforces per-phase official idempotency'
);
select has_index(
  'public', 'broadcasts', 'idx_broadcasts_earthquake_once',
  'idx_broadcasts_earthquake_once enforces push-once-per-earthquake'
);

insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id
)
values (
  'a2a20000-0000-4000-8000-000000000001',
  'urn:oid:m2a.alert.1',
  'Rain Severe warning for the wilaya: Wilaya M2A',
  'Rain', 'Severe', 'Expected', 'Likely',
  now() - interval '10 minutes', now() + interval '6 hours', now() - interval '20 minutes',
  'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001'
);

select is(
  (select msg_type from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000001'),
  'Alert',
  'default onm_vigilance msg_type is Alert'
);
select is(
  (select referenced_cap_ids from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000001'),
  '{}'::text[],
  'default referenced_cap_ids is empty array'
);
select is(
  (select geocodes from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000001'),
  '{}'::text[],
  'default geocodes is empty array'
);

select throws_ok(
  $$insert into public.onm_vigilance (
      cap_id, title, event, severity, urgency, certainty, sent, area_desc, msg_type
    ) values (
      'urn:oid:m2a.invalid.msgtype', 'T', 'Rain', 'Severe', 'Expected', 'Likely', now(), 'Wilaya M2A', 'Ack'
    )$$,
  '23514', null,
  'invalid CAP msg_type Ack is rejected by CHECK constraint'
);

select throws_ok(
  $$update public.onm_vigilance
       set superseded_by = id
     where id = 'a2a20000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'self-reference in superseded_by is rejected'
);

select throws_ok(
  $$update public.onm_vigilance
       set cancelled_by = id
     where id = 'a2a20000-0000-4000-8000-000000000001'$$,
  '23514', null,
  'self-reference in cancelled_by is rejected'
);

-- store_onm_detail backwards-compatible 4-arg call + 8-arg call + validation
select lives_ok(
  $$select public.store_onm_detail(
      'a2a20000-0000-4000-8000-000000000001'::uuid,
      'Alerte Pluie',
      'Restez vigilants',
      null::jsonb
    )$$,
  '4-arg store_onm_detail call remains valid'
);

select lives_ok(
  $$select public.store_onm_detail(
      'a2a20000-0000-4000-8000-000000000001'::uuid,
      'Alerte Pluie',
      'Restez vigilants',
      null::jsonb,
      'Alert',
      null,
      '{}'::text[],
      array['9801', '9802']
    )$$,
  '8-arg store_onm_detail populates geocodes cleanly'
);

select is(
  (select geocodes from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000001'),
  array['9801', '9802']::text[],
  'store_onm_detail persists geocodes'
);

select throws_ok(
  $$select public.store_onm_detail(
      'a2a20000-0000-4000-8000-000000000001'::uuid,
      null, null, null, 'Error'
    )$$,
  '22023', null,
  'store_onm_detail rejects invalid _msg_type'
);

-- ============================================================================
-- 2. Broadcasts: earthquake kind & official multi-phase idempotency
-- ============================================================================
select throws_ok(
  $$insert into public.broadcasts (kind, phase, severity, commune_codes, push_codes)
    values ('earthquake', 'initial', 'Severe', array['9801'], array['9801'])$$,
  '23514', null,
  'earthquake broadcast without earthquake_id is rejected by broadcasts_check'
);

insert into public.broadcasts (
  id, kind, phase, earthquake_id, severity, commune_codes, push_codes, hazard, source_key, metadata
)
values (
  'a2a30000-0000-4000-8000-000000000001',
  'earthquake', 'initial', 'm2a-eq-42', 'Severe',
  array['9801'], array['9801'], 'earthquake', 'emsc',
  '{"magnitude": 4.2}'::jsonb
);

select throws_ok(
  $$insert into public.broadcasts (kind, phase, earthquake_id, severity, commune_codes, push_codes)
    values ('earthquake', 'initial', 'm2a-eq-42', 'Extreme', array['9801'], array['9801'])$$,
  '23505', null,
  'duplicate earthquake broadcast is rejected by idx_broadcasts_earthquake_once'
);

-- Official incident allows initial + end, rejects duplicate initial or duplicate end
insert into public.broadcasts (
  id, kind, phase, official_incident_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000002',
  'official', 'initial', 'a2a10000-0000-4000-8000-000000000001', 'Severe',
  array['9801'], array['9801'], 'flood', 'dgpc_telegram'
);

select throws_ok(
  $$insert into public.broadcasts (kind, phase, official_incident_id, severity, commune_codes, push_codes)
    values ('official', 'initial', 'a2a10000-0000-4000-8000-000000000001', 'Severe', array['9801'], array['9801'])$$,
  '23505', null,
  'duplicate official initial broadcast is rejected'
);

insert into public.broadcasts (
  id, kind, phase, official_incident_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000003',
  'official', 'end', 'a2a10000-0000-4000-8000-000000000001', 'Severe',
  array['9801'], array['9801'], 'flood', 'dgpc_telegram'
);

select throws_ok(
  $$insert into public.broadcasts (kind, phase, official_incident_id, severity, commune_codes, push_codes)
    values ('official', 'end', 'a2a10000-0000-4000-8000-000000000001', 'Severe', array['9801'], array['9801'])$$,
  '23505', null,
  'duplicate official end broadcast is rejected'
);

-- ============================================================================
-- 3. Official incident cleared invalidates pending & leased initial deliveries (not end!)
-- ============================================================================
-- Lease the telegram row of the initial flood broadcast while leaving its fcm row pending
update public.broadcast_delivery_queue
   set state = 'leased',
       attempts = 1,
       lease_token = 'a2a90000-0000-4000-8000-000000000001'::uuid,
       lease_until = now() + interval '90 seconds'
 where broadcast_id = 'a2a30000-0000-4000-8000-000000000002'
   and channel = 'telegram';

-- Mark incident cleared -> triggers invalidate_cleared_official_deliveries
update public.official_incidents
   set status = 'cleared'
 where id = 'a2a10000-0000-4000-8000-000000000001';

select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000002' and channel = 'fcm'),
  'cancelled',
  'pending initial official delivery transitions immediately to cancelled on cleared'
);
select is(
  (select last_error from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000002' and channel = 'fcm'),
  'official_cleared',
  'pending initial official delivery records official_cleared reason'
);
select is(
  public.renew_broadcast_delivery(
    'a2a30000-0000-4000-8000-000000000002'::uuid,
    'telegram',
    'a2a90000-0000-4000-8000-000000000001'::uuid
  ),
  false,
  'leased initial official delivery cannot renew after incident clears'
);
select is(
  public.finish_broadcast_delivery(
    'a2a30000-0000-4000-8000-000000000002'::uuid,
    'telegram',
    'a2a90000-0000-4000-8000-000000000001'::uuid,
    null,
    'telegram delivery lease lost'
  ),
  true,
  'finish_broadcast_delivery closes leased cleared official delivery cleanly'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000002' and channel = 'telegram'),
  'cancelled',
  'leased cleared official delivery finalizes to cancelled, never expired'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000003' and channel = 'fcm'),
  'pending',
  'phase=end official closure delivery stays pending when incident is cleared'
);

-- Inserting an initial broadcast for an already-cleared incident clamps immediately to cancelled
insert into public.broadcasts (
  id, kind, phase, official_incident_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000004',
  'official', 'initial', 'a2a10000-0000-4000-8000-000000000002', 'Severe',
  array['9801'], array['9801'], 'road', 'dgpc_telegram'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000004' and channel = 'fcm'),
  'cancelled',
  'clamp_cleared_official_delivery cancels initial queue row for already-cleared incident'
);

-- ============================================================================
-- 4. ONM CAP Alert -> Update -> Cancel transitive chain + delivery invalidation
-- ============================================================================
-- Queue a broadcast for Alert 1 (a2a2...0001): keep fcm pending, lease telegram, and add a receipt
insert into public.broadcasts (
  id, kind, phase, onm_vigilance_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000010',
  'onm', 'initial', 'a2a20000-0000-4000-8000-000000000001', 'Severe',
  array['9801'], array['9801'], 'weather', 'onm'
);
insert into public.broadcast_delivery_receipts (broadcast_id, channel, destination)
values ('a2a30000-0000-4000-8000-000000000010', 'fcm', 'v1.commune.9801.ar');

-- Update 2 referencing Alert 1
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id,
  msg_type, cap_references, referenced_cap_ids
)
values (
  'a2a20000-0000-4000-8000-000000000002',
  'urn:oid:m2a.update.2',
  'Rain Extreme warning for the wilaya: Wilaya M2A',
  'Rain', 'Extreme', 'Immediate', 'Observed',
  now() - interval '10 minutes', now() + interval '8 hours', now() - interval '10 minutes',
  'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001',
  'Update', 'onm@meteo.dz,urn:oid:m2a.alert.1,2026-11-24T10:00:00Z', array['urn:oid:m2a.alert.1']
);

select is(
  (public.apply_onm_cap_chain(array['urn:oid:m2a.update.2'])->>'linked_updates')::integer,
  1,
  'forward Update links to referenced Alert'
);
select is(
  (select superseded_by from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000001'),
  'a2a20000-0000-4000-8000-000000000002'::uuid,
  'Alert 1 superseded_by points to Update 2'
);

-- Queue a broadcast for Update 2 and lease its fcm row; mark Alert 1 telegram delivered
insert into public.broadcasts (
  id, kind, phase, onm_vigilance_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000011',
  'onm', 'update', 'a2a20000-0000-4000-8000-000000000002', 'Extreme',
  array['9801'], array['9801'], 'weather', 'onm'
);
update public.broadcast_delivery_queue
   set state = 'leased',
       attempts = 2,
       lease_token = 'a2a90000-0000-4000-8000-000000000002'::uuid,
       lease_until = now() + interval '90 seconds'
 where broadcast_id = 'a2a30000-0000-4000-8000-000000000011'
   and channel = 'fcm';
update public.broadcast_delivery_queue
   set state = 'delivered'
 where broadcast_id = 'a2a30000-0000-4000-8000-000000000010'
   and channel = 'telegram';

-- Cancel 3 referencing Update 2 -> should transitively cancel BOTH Update 2 and Alert 1!
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id,
  msg_type, cap_references, referenced_cap_ids
)
values (
  'a2a20000-0000-4000-8000-000000000003',
  'urn:oid:m2a.cancel.3',
  'Rain Cancel for the wilaya: Wilaya M2A',
  'Rain', 'Severe', 'Past', 'Observed',
  now() - interval '10 minutes', now() + interval '8 hours', now() - interval '5 minutes',
  'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001',
  'Cancel', 'onm@meteo.dz,urn:oid:m2a.update.2,2026-11-24T10:10:00Z', array['urn:oid:m2a.update.2']
);

with res as (
  select public.apply_onm_cap_chain(array['urn:oid:m2a.cancel.3']) as payload
)
select ok(
  (payload->>'cancelled_warnings')::integer = 2
  and (payload->>'invalidated_deliveries')::integer >= 3,
  'Cancel transitively cancels both Update 2 and Alert 1 and counts invalidated deliveries'
) from res;

select is(
  (select cancelled_by from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000001'),
  'a2a20000-0000-4000-8000-000000000003'::uuid,
  'Alert 1 cancelled_by is Cancel 3 transitively'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000010' and channel = 'fcm'),
  'cancelled',
  'pending ONM delivery transitions immediately to cancelled on CAP Cancel'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000010' and channel = 'telegram'),
  'delivered',
  'already-delivered ONM row is preserved untouched on CAP Cancel'
);
select is(
  (select count(*)::integer from public.broadcast_delivery_receipts
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000010'),
  1,
  'existing delivery receipts remain intact after CAP Cancel'
);
select is(
  public.renew_broadcast_delivery(
    'a2a30000-0000-4000-8000-000000000011'::uuid,
    'fcm',
    'a2a90000-0000-4000-8000-000000000002'::uuid
  ),
  false,
  'leased ONM delivery cannot renew after CAP Cancel'
);
select is(
  public.finish_broadcast_delivery(
    'a2a30000-0000-4000-8000-000000000011'::uuid,
    'fcm',
    'a2a90000-0000-4000-8000-000000000002'::uuid,
    null,
    'fcm delivery lease lost'
  ),
  true,
  'finish_broadcast_delivery closes cancelled-while-leased ONM row'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000011' and channel = 'fcm'),
  'cancelled',
  'cancelled-while-leased ONM row finalizes to cancelled (not expired) with attempts preserved'
);
select is(
  (select attempts from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000011' and channel = 'fcm'),
  2,
  'attempts count is preserved after CAP Cancel'
);
select is(
  (select count(*)::integer from public.source_watchdog
    where issue_code = 'delivery_expired'
      and contract_key = 'broadcast_delivery.fcm'),
  0,
  'cancelled ONM deliveries do not raise spurious delivery_expired watchdog alerts'
);
select is(
  (select count(*)::integer from public.onm_warning_history
    where id = 'a2a20000-0000-4000-8000-000000000003'),
  0,
  'onm_warning_history excludes CAP Cancel control records'
);

-- ============================================================================
-- 5. Out-of-order Cancel, missing parent, clamp on already-cancelled, & supersede_onm_absent
-- ============================================================================
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  sent, area_desc, wilaya_id, msg_type, cap_references, referenced_cap_ids
)
values (
  'a2a20000-0000-4000-8000-000000000004',
  'urn:oid:m2a.cancel.early',
  'Wind Cancel for Wilaya M2A',
  'Wind', 'Severe', 'Past', 'Observed',
  now() - interval '2 minutes', 'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001',
  'Cancel', 'onm@meteo.dz,urn:oid:m2a.alert.late,2026-11-24T09:00:00Z',
  array['urn:oid:m2a.alert.late', 'urn:oid:m2a.nonexistent.parent']
);

-- Missing parent reference succeeds with 0 cancelled and no error
select is(
  (public.apply_onm_cap_chain(array['urn:oid:m2a.cancel.early'])->>'cancelled_warnings')::integer,
  0,
  'missing parent reference succeeds cleanly with 0 cancelled'
);

-- Late-arriving parent Alert arrives after Cancel
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id
)
values (
  'a2a20000-0000-4000-8000-000000000005',
  'urn:oid:m2a.alert.late',
  'Wind Severe warning for Wilaya M2A',
  'Wind', 'Severe', 'Expected', 'Likely',
  now() - interval '15 minutes', now() + interval '4 hours', now() - interval '15 minutes',
  'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001'
);

select is(
  (public.apply_onm_cap_chain(array['urn:oid:m2a.alert.late'])->>'cancelled_warnings')::integer,
  1,
  'out-of-order late parent Alert is cancelled immediately by earlier-stored Cancel'
);

-- Inserting a broadcast for the already-cancelled late Alert clamps immediately to cancelled
insert into public.broadcasts (
  id, kind, phase, onm_vigilance_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000012',
  'onm', 'initial', 'a2a20000-0000-4000-8000-000000000005', 'Severe',
  array['9801'], array['9801'], 'weather', 'onm'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000012' and channel = 'fcm'),
  'cancelled',
  'clamp_cancelled_onm_delivery immediately cancels queue row for already-cancelled ONM warning'
);

-- Feed-absence supersede_onm_absent never stamps Cancel records or revives cancelled rows
insert into public.onm_vigilance (
  id, cap_id, title, event, severity, urgency, certainty,
  onset, expires, sent, area_desc, wilaya_id
)
values (
  'a2a20000-0000-4000-8000-000000000006',
  'urn:oid:m2a.alert.absent',
  'Heat Severe warning for Wilaya M2A',
  'Heat', 'Severe', 'Expected', 'Likely',
  now() - interval '30 minutes', now() + interval '6 hours', now() - interval '30 minutes',
  'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001'
);
insert into public.broadcasts (
  id, kind, phase, onm_vigilance_id, severity, commune_codes, push_codes, hazard, source_key
)
values (
  'a2a30000-0000-4000-8000-000000000013',
  'onm', 'initial', 'a2a20000-0000-4000-8000-000000000006', 'Severe',
  array['9801'], array['9801'], 'weather', 'onm'
);

select lives_ok(
  $$select public.supersede_onm_absent(
      array['urn:oid:m2a.alert.1', 'urn:oid:m2a.fresh.feed'],
      now() + interval '1 minute'
    )$$,
  'supersede_onm_absent runs cleanly'
);
select ok(
  (select superseded_at is not null and cancelled_at is null
     from public.onm_vigilance where id = 'a2a20000-0000-4000-8000-000000000006'),
  'feed-absence supersession sets only superseded_at, never cancelled_at'
);
select is(
  (select state from public.broadcast_delivery_queue
    where broadcast_id = 'a2a30000-0000-4000-8000-000000000013' and channel = 'fcm'),
  'pending',
  'feed-absence supersession never cancels deliveries on silence'
);
select ok(
  (select superseded_at is null from public.onm_vigilance
    where id = 'a2a20000-0000-4000-8000-000000000003'),
  'supersede_onm_absent never stamps Cancel control rows'
);
select ok(
  (select cancelled_at is not null from public.onm_vigilance
    where id = 'a2a20000-0000-4000-8000-000000000001'),
  'supersede_onm_absent never revives explicitly cancelled warnings'
);

-- ============================================================================
-- 6. 5-Role Privilege & RLS Matrix (public, anon, authenticated, service_role, cold_reader)
-- ============================================================================
do $$
declare
  _role text;
  _fn text;
  _rpcs text[] := array[
    'public.onm_episode_of(public.onm_vigilance)',
    'public.supersede_onm_absent(text[], timestamptz)',
    'public.store_onm_detail(uuid, text, text, jsonb, text, text, text[], text[])',
    'public.apply_onm_cap_chain(text[])',
    'public.claim_broadcast_delivery(text, integer)',
    'public.finish_broadcast_delivery(uuid, text, uuid, integer, text)'
  ];
  _triggers text[] := array[
    'public.clamp_cancelled_onm_delivery()',
    'public.invalidate_cancelled_onm_deliveries()',
    'public.clamp_cleared_official_delivery()',
    'public.invalidate_cleared_official_deliveries()'
  ];
begin
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

  foreach _fn in array _triggers loop
    foreach _role in array array['public', 'anon', 'authenticated', 'service_role', 'cold_reader'] loop
      if has_function_privilege(_role, _fn, 'execute') then
        raise exception 'unexpected execute privilege on trigger % for %', _fn, _role;
      end if;
    end loop;
  end loop;
end;
$$;
select pass('5-role least-privilege execute matrix passes for all 10 new/altered M2A functions');

-- Verify service_role can insert into onm_vigilance (exercises assign_onm_episode -> onm_episode_of)
set local role service_role;
select lives_ok(
  $$insert into public.onm_vigilance (
      cap_id, title, event, severity, urgency, certainty, sent, area_desc, wilaya_id
    ) values (
      'urn:oid:m2a.service.insert', 'Rain Severe for Wilaya M2A', 'Rain',
      'Severe', 'Expected', 'Likely', now(), 'Wilaya M2A', 'a2a00000-0000-4000-8000-000000000001'
    )$$,
  'service_role can insert into onm_vigilance with episode trigger active'
);
reset role;

-- Verify anon & authenticated can SELECT new columns (including earthquake broadcasts) but cannot mutate or call RPCs
set local role anon;
select lives_ok(
  $$select msg_type, cap_references, referenced_cap_ids, geocodes, superseded_by, cancelled_at
      from public.onm_vigilance
     where id = 'a2a20000-0000-4000-8000-000000000001'$$,
  'anon can read new CAP chain columns on onm_vigilance'
);
select lives_ok(
  $$select id, kind, earthquake_id, hazard, source_key, metadata
      from public.broadcasts
     where id = 'a2a30000-0000-4000-8000-000000000001'$$,
  'anon can read earthquake broadcasts and metadata columns'
);
select throws_ok(
  $$select public.apply_onm_cap_chain(array['urn:oid:m2a.alert.1'])$$,
  '42501', null,
  'anon cannot execute apply_onm_cap_chain'
);
select throws_ok(
  $$insert into public.broadcasts (kind, phase, earthquake_id, severity, commune_codes, push_codes)
    values ('earthquake', 'initial', 'm2a-eq-42', 'Severe', array['9801'], array['9801'])$$,
  '42501', null,
  'anon cannot insert earthquake broadcasts'
);
reset role;

set local role authenticated;
select lives_ok(
  $$select id, earthquake_id, hazard, source_key, metadata
      from public.broadcasts
     where id = 'a2a30000-0000-4000-8000-000000000001'$$,
  'authenticated can read earthquake broadcasts and metadata columns'
);
select throws_ok(
  $$select public.apply_onm_cap_chain(array['urn:oid:m2a.alert.1'])$$,
  '42501', null,
  'authenticated cannot execute apply_onm_cap_chain'
);
select throws_ok(
  $$update public.onm_vigilance set cancelled_at = now() where id = 'a2a20000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'authenticated cannot mutate onm_vigilance'
);
reset role;

select * from finish();

rollback;
