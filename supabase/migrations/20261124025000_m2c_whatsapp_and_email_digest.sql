-- M2C: Automated WhatsApp Channel + Resend Zone Email Digest Pipelines (F13)
-- 100% additive migration; preserves broadcast_delivery_queue 2-channel invariant (fcm, telegram),
-- broadcast_settings grants, alerts grants, and private.cold_tables 6-table invariant.

-- ============================================================================
-- 1. User email digest preference columns on public.profiles (explicit opt-in)
-- ============================================================================
alter table public.profiles
  add column email_digest_frequency text not null default 'off',
  add column email_digest_hour_algiers smallint not null default 7;

alter table public.profiles
  add constraint profiles_email_digest_frequency_valid
    check (email_digest_frequency in ('off', 'immediate', 'hourly', 'daily')),
  add constraint profiles_email_digest_hour_algiers_valid
    check (email_digest_hour_algiers between 0 and 23);

-- ============================================================================
-- 2. Partial index on public.alerts for undelivered zone email alerts
-- ============================================================================
create index idx_alerts_email_undelivered
  on public.alerts (user_id, created_at desc)
  where delivered_email = false;

-- ============================================================================
-- 3. Independent pipeline kill-switch table (service_role-only)
-- ============================================================================
create table public.delivery_pipeline_settings (
  pipeline text primary key
    check (pipeline in ('whatsapp_channel', 'email_digest')),
  enabled boolean not null default true,
  paused boolean not null default false,
  pause_reason text,
  updated_at timestamptz not null default now()
);

insert into public.delivery_pipeline_settings (pipeline)
values ('whatsapp_channel'), ('email_digest');

alter table public.delivery_pipeline_settings enable row level security;

revoke all on table public.delivery_pipeline_settings
  from public, anon, authenticated, service_role;
grant select, update on table public.delivery_pipeline_settings
  to service_role;

-- ============================================================================
-- 4. Dedicated WhatsApp Channel delivery queue & receipts (service_role-only)
-- ============================================================================
create table public.whatsapp_channel_deliveries (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.broadcasts(id) on delete cascade,
  channel_target text not null check (length(btrim(channel_target)) > 0),
  locale text not null default 'ar' check (locale in ('ar', 'fr', 'en', 'kab')),
  dedupe_key text not null unique,
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'delivered', 'failed', 'expired', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 8),
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  lease_token uuid,
  lease_until timestamptz,
  provider_message_id text,
  payload jsonb not null default '{}'::jsonb,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (broadcast_id, channel_target, locale),
  check ((state = 'leased') = (lease_token is not null and lease_until is not null))
);

create index idx_whatsapp_deliveries_due
  on public.whatsapp_channel_deliveries (next_attempt_at, created_at)
  where state in ('pending', 'leased');

create index idx_whatsapp_deliveries_broadcast
  on public.whatsapp_channel_deliveries (broadcast_id);

alter table public.whatsapp_channel_deliveries enable row level security;

revoke all on table public.whatsapp_channel_deliveries
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.whatsapp_channel_deliveries
  to service_role;

-- Additive CAP Cancel invalidation trigger for WhatsApp Channel deliveries
create function public.invalidate_cancelled_onm_whatsapp_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cancelled_at is null or old.cancelled_at is not null then
    return new;
  end if;

  update public.whatsapp_channel_deliveries q
     set state = 'cancelled',
         expires_at = least(q.expires_at, '-infinity'::timestamptz),
         lease_token = null,
         lease_until = null,
         last_error = 'cap_cancelled',
         updated_at = now()
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'onm'
     and b.onm_vigilance_id = new.id
     and q.state = 'pending';

  update public.whatsapp_channel_deliveries q
     set expires_at = least(q.expires_at, '-infinity'::timestamptz),
         last_error = 'cap_cancelled',
         updated_at = now()
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'onm'
     and b.onm_vigilance_id = new.id
     and q.state = 'leased';

  return new;
end;
$$;

create trigger invalidate_cancelled_onm_whatsapp_deliveries
  after update of cancelled_at on public.onm_vigilance
  for each row execute function public.invalidate_cancelled_onm_whatsapp_deliveries();

-- Additive official incident cleared/unlisted invalidation trigger for WhatsApp Channel deliveries
create function public.invalidate_cleared_official_whatsapp_deliveries()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (new.status in ('cleared', 'extinguished') or new.unlisted_at is not null) then
    return new;
  end if;

  update public.whatsapp_channel_deliveries q
     set state = 'cancelled',
         expires_at = least(q.expires_at, '-infinity'::timestamptz),
         lease_token = null,
         lease_until = null,
         last_error = 'official_cleared',
         updated_at = now()
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'official'
     and b.official_incident_id = new.id
     and (new.unlisted_at is not null or b.phase <> 'end')
     and q.state = 'pending';

  update public.whatsapp_channel_deliveries q
     set expires_at = least(q.expires_at, '-infinity'::timestamptz),
         last_error = 'official_cleared',
         updated_at = now()
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'official'
     and b.official_incident_id = new.id
     and (new.unlisted_at is not null or b.phase <> 'end')
     and q.state = 'leased';

  return new;
end;
$$;

create trigger invalidate_cleared_official_whatsapp_deliveries
  after update of status, unlisted_at on public.official_incidents
  for each row execute function public.invalidate_cleared_official_whatsapp_deliveries();

-- ============================================================================
-- 5. Resend Zone Email Digest delivery log & bounce suppressions (service_role-only)
--    Zero raw recipient email stored here (Law 18-07 data minimization).
-- ============================================================================
create table public.email_digest_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  digest_kind text not null check (digest_kind in ('immediate', 'hourly', 'daily')),
  window_key text not null check (length(btrim(window_key)) > 0),
  dedupe_key text not null unique,
  locale text not null check (locale in ('ar', 'fr', 'en', 'kab')),
  alert_ids uuid[] not null default '{}',
  alert_count integer not null default 0 check (alert_count >= 0),
  urgent_bypass boolean not null default false,
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'sent', 'failed', 'bounced', 'suppressed', 'skipped')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  provider text not null default 'resend',
  provider_message_id text,
  subject text,
  last_error text,
  sent_at timestamptz,
  bounced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, digest_kind, window_key),
  check ((state = 'leased') = (lease_token is not null and lease_until is not null))
);

create index idx_email_digest_deliveries_due
  on public.email_digest_deliveries (next_attempt_at, created_at)
  where state in ('pending', 'leased');

create index idx_email_digest_deliveries_user
  on public.email_digest_deliveries (user_id, created_at desc);

alter table public.email_digest_deliveries enable row level security;

revoke all on table public.email_digest_deliveries
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.email_digest_deliveries
  to service_role;

create table public.email_digest_suppressions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  reason text not null check (reason in ('hard_bounce', 'complaint', 'unsubscribed', 'manual')),
  provider_error text,
  suppressed_at timestamptz not null default now()
);

alter table public.email_digest_suppressions enable row level security;

revoke all on table public.email_digest_suppressions
  from public, anon, authenticated, service_role;
grant select, insert, update, delete on table public.email_digest_suppressions
  to service_role;

-- ============================================================================
-- 6. service_role-only RPCs (all with set search_path = '' and strict REVOKE/GRANT)
-- ============================================================================

-- 6.0 list_pending_whatsapp_broadcasts
create function public.list_pending_whatsapp_broadcasts(
  _channel_target text,
  _locale text default 'ar',
  _limit integer default 20
)
returns table (
  id uuid,
  kind text,
  phase text,
  severity text,
  hazard text,
  source_key text,
  metadata jsonb,
  commune_codes text[],
  created_at timestamptz,
  onm_vigilance_id uuid,
  official_incident_id uuid,
  earthquake_id text,
  cluster_id uuid,
  onm_msg_type text,
  onm_cancelled_at timestamptz,
  onm_superseded_by uuid,
  onm_onset timestamptz,
  onm_expires timestamptz,
  onm_sent timestamptz,
  onm_area_desc text,
  onm_title text,
  onm_headline_fr text,
  onm_event text,
  incident_status text,
  incident_unlisted_at timestamptz,
  incident_kind text,
  incident_source_key text,
  incident_source_label text,
  incident_authority_tier text,
  incident_evidence text,
  incident_place_text text,
  incident_as_of timestamptz,
  incident_area_label text,
  quake_magnitude double precision,
  quake_occurred_at timestamptz,
  quake_region text,
  quake_network text,
  fire_short_id text,
  fire_state text,
  fire_confirmed_at timestamptz,
  fire_detection_count integer,
  fire_sources text[],
  fire_suspected_persistent boolean,
  fire_last_detected_at timestamptz,
  fire_area_label text,
  cap_headline text,
  cap_description text,
  cap_area_desc text,
  cap_sent timestamptz,
  cap_expires text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clean_target text := btrim(coalesce(_channel_target, ''));
  _clean_locale text := coalesce(nullif(btrim(_locale), ''), 'ar');
begin
  if _limit < 1 or _limit > 100 then
    raise exception 'invalid_delivery_limit';
  end if;

  if length(_clean_target) = 0 then
    return;
  end if;

  if not exists (
    select 1 from public.broadcast_settings bs where bs.id = true and bs.enabled = true
  ) or not exists (
    select 1 from public.delivery_pipeline_settings dps
     where dps.pipeline = 'whatsapp_channel' and dps.enabled = true and dps.paused = false
  ) then
    return;
  end if;

  return query
  select
    b.id,
    b.kind,
    b.phase,
    b.severity,
    b.hazard,
    b.source_key,
    b.metadata,
    b.commune_codes,
    b.created_at,
    b.onm_vigilance_id,
    b.official_incident_id,
    b.earthquake_id,
    b.cluster_id,
    v.msg_type as onm_msg_type,
    v.cancelled_at as onm_cancelled_at,
    v.superseded_by as onm_superseded_by,
    v.onset as onm_onset,
    v.expires as onm_expires,
    v.sent as onm_sent,
    v.area_desc as onm_area_desc,
    v.title as onm_title,
    v.headline_fr as onm_headline_fr,
    v.event as onm_event,
    o.status as incident_status,
    o.unlisted_at as incident_unlisted_at,
    o.kind as incident_kind,
    ts.key as incident_source_key,
    ts.label as incident_source_label,
    o.authority_tier as incident_authority_tier,
    o.evidence as incident_evidence,
    o.place_text as incident_place_text,
    o.as_of as incident_as_of,
    coalesce(
      nullif(o.place_text, ''),
      case _clean_locale
        when 'ar' then o_au.name_ar
        when 'en' then o_au.name_en
        when 'kab' then coalesce(o_au.name_kab, o_au.name_fr)
        else o_au.name_fr
      end
    ) as incident_area_label,
    e.magnitude::double precision as quake_magnitude,
    e.occurred_at as quake_occurred_at,
    e.region as quake_region,
    e.network as quake_network,
    fc.short_id as fire_short_id,
    fc.state as fire_state,
    fc.confirmed_at as fire_confirmed_at,
    fc.detection_count as fire_detection_count,
    fc.sources as fire_sources,
    fc.suspected_persistent_source as fire_suspected_persistent,
    fc.last_detected_at as fire_last_detected_at,
    case _clean_locale
      when 'ar' then fc_au.name_ar
      when 'en' then fc_au.name_en
      when 'kab' then coalesce(fc_au.name_kab, fc_au.name_fr)
      else fc_au.name_fr
    end as fire_area_label,
    case when pg_catalog.jsonb_typeof(ca.info) = 'array' then
      coalesce(
        (
          select elem->>'headline'
          from pg_catalog.jsonb_array_elements(ca.info) elem
          where elem->>'language' = _clean_locale
          limit 1
        ),
        ca.info->0->>'headline'
      )
    else null end as cap_headline,
    case when pg_catalog.jsonb_typeof(ca.info) = 'array' then
      coalesce(
        (
          select elem->>'description'
          from pg_catalog.jsonb_array_elements(ca.info) elem
          where elem->>'language' = _clean_locale
          limit 1
        ),
        ca.info->0->>'description'
      )
    else null end as cap_description,
    case when pg_catalog.jsonb_typeof(ca.info) = 'array' then
      coalesce(
        (
          select elem->'area'->0->>'areaDesc'
          from pg_catalog.jsonb_array_elements(ca.info) elem
          where elem->>'language' = _clean_locale
          limit 1
        ),
        ca.info->0->'area'->0->>'areaDesc'
      )
    else null end as cap_area_desc,
    ca.sent as cap_sent,
    case when pg_catalog.jsonb_typeof(ca.info) = 'array' then
      coalesce(
        (
          select elem->>'expires'
          from pg_catalog.jsonb_array_elements(ca.info) elem
          where elem->>'language' = _clean_locale
          limit 1
        ),
        ca.info->0->>'expires'
      )
    else null end as cap_expires
  from public.broadcasts b
  left join public.onm_vigilance v on v.id = b.onm_vigilance_id
  left join public.official_incidents o on o.id = b.official_incident_id
  left join public.incident_mentions im on im.id = o.latest_mention_id
  left join public.text_sources ts on ts.id = im.text_source_id
  left join public.admin_units o_au on o_au.id = coalesce(o.commune_id, o.wilaya_id)
  left join public.earthquakes e on e.id = b.earthquake_id
  left join public.fire_clusters fc on fc.id = b.cluster_id
  left join public.admin_units fc_au on fc_au.id = coalesce(fc.commune_id, fc.wilaya_id)
  left join public.cap_alerts ca on ca.id = b.cap_alert_id
  where b.created_at >= now() - interval '24 hours'
    and b.kind in ('onm', 'official', 'earthquake', 'fire')
    and b.phase <> 'cancel'
    and b.severity in ('Severe', 'Extreme')
    and coalesce(b.source_key, '') !~* '(^|[_\-.])ita($|[_\-.])|^ita'
    and replace(replace(lower(coalesce(b.source_key, '')), '-', '_'), ' ', '_')
        not in ('open_meteo', 'openmeteo', 'openmeteo_weather', 'openmeteo_wind', 'local_fwi', 'effis')
    and (
      b.kind <> 'onm'
      or v.id is null
      or (
        v.cancelled_at is null
        and v.superseded_by is null
        and lower(coalesce(v.msg_type, '')) <> 'cancel'
        and (v.expires is null or v.expires > now())
      )
    )
    and (
      b.kind <> 'official'
      or (
        o.id is not null
        and o.unlisted_at is null
        and coalesce(lower(o.authority_tier), 'national') <> 'media'
        and coalesce(lower(ts.key), '') !~* '(^|[_\-.])ita($|[_\-.])|^ita'
        and coalesce(lower(ts.key), lower(b.source_key), '') = 'dgpc_telegram'
        and (b.source_key is null or lower(b.source_key) = 'dgpc_telegram')
        and (b.phase = 'end' or coalesce(lower(o.status), '') not in ('cleared', 'extinguished'))
      )
    )
    and (
      b.kind <> 'earthquake'
      or (e.id is not null and e.magnitude >= 4.0)
    )
    and (
      b.kind <> 'fire'
      or (
        fc.id is not null
        and coalesce(fc.suspected_persistent_source, false) = false
        and coalesce(lower(fc.state), '') not in ('false_positive', 'extinguished')
        and (fc.confirmed_at is not null or lower(fc.state) = 'active')
      )
    )
    and not exists (
      select 1
      from public.whatsapp_channel_deliveries d
      where d.broadcast_id = b.id
        and d.channel_target = _clean_target
        and d.locale = _clean_locale
    )
  order by b.created_at asc, b.id asc
  limit _limit;
end;
$$;

-- 6.1 enqueue_whatsapp_broadcast
create function public.enqueue_whatsapp_broadcast(
  _broadcast_id uuid,
  _channel_target text,
  _locale text,
  _dedupe_key text,
  _payload jsonb default '{}'::jsonb,
  _expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _broadcast record;
  _invalidated boolean := false;
  _id uuid;
begin
  select b.id, b.kind, b.phase, b.onm_vigilance_id, b.official_incident_id
    into _broadcast
  from public.broadcasts b
  where b.id = _broadcast_id;

  if not found then
    return null;
  end if;

  if _broadcast.kind = 'onm' and _broadcast.onm_vigilance_id is not null then
    select (v.cancelled_at is not null or v.msg_type = 'Cancel' or v.superseded_by is not null)
      into _invalidated
    from public.onm_vigilance v
    where v.id = _broadcast.onm_vigilance_id;
    if coalesce(_invalidated, false) then
      return null;
    end if;
  end if;

  if _broadcast.kind = 'official'
     and _broadcast.official_incident_id is not null then
    select (
      o.unlisted_at is not null
      or (_broadcast.phase <> 'end' and o.status in ('cleared', 'extinguished'))
    )
      into _invalidated
    from public.official_incidents o
    where o.id = _broadcast.official_incident_id;
    if coalesce(_invalidated, false) then
      return null;
    end if;
  end if;

  insert into public.whatsapp_channel_deliveries (
    broadcast_id,
    channel_target,
    locale,
    dedupe_key,
    payload,
    expires_at
  )
  values (
    _broadcast_id,
    btrim(_channel_target),
    _locale,
    btrim(_dedupe_key),
    coalesce(_payload, '{}'::jsonb),
    coalesce(_expires_at, now() + interval '24 hours')
  )
  on conflict do nothing
  returning id into _id;

  return _id;
end;
$$;

-- 6.2 claim_whatsapp_deliveries
create function public.claim_whatsapp_deliveries(_limit integer default 20)
returns setof public.whatsapp_channel_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _limit < 1 or _limit > 100 then
    raise exception 'invalid_delivery_limit';
  end if;

  if not exists (
    select 1 from public.broadcast_settings bs where bs.id = true and bs.enabled = true
  ) or not exists (
    select 1 from public.delivery_pipeline_settings dps
     where dps.pipeline = 'whatsapp_channel' and dps.enabled = true and dps.paused = false
  ) then
    return;
  end if;

  update public.whatsapp_channel_deliveries
     set state = case
           when last_error in ('cap_cancelled', 'official_cleared') then 'cancelled'
           when expires_at <= now() then 'expired'
           else 'failed'
         end,
         lease_token = null,
         lease_until = null,
         last_error = coalesce(
           last_error,
           case when expires_at <= now() then 'delivery_expired' else 'max_attempts_exhausted' end
         ),
         updated_at = now()
   where state in ('pending', 'leased')
     and (expires_at <= now() or attempts >= 8)
     and (lease_until is null or lease_until <= now());

  return query
  with due as (
    select q.id
    from public.whatsapp_channel_deliveries q
    where q.expires_at > now()
      and q.attempts < 8
      and (
        (q.state = 'pending' and q.next_attempt_at <= now())
        or (q.state = 'leased' and q.lease_until <= now())
      )
    order by q.next_attempt_at, q.created_at, q.id
    for update skip locked
    limit _limit
  )
  update public.whatsapp_channel_deliveries q
     set state = 'leased',
         attempts = q.attempts + 1,
         lease_token = gen_random_uuid(),
         lease_until = now() + interval '90 seconds',
         updated_at = now()
    from due
   where q.id = due.id
  returning q.*;
end;
$$;

-- 6.3 finish_whatsapp_delivery
create function public.finish_whatsapp_delivery(
  _id uuid,
  _lease_token uuid,
  _delivered boolean,
  _provider_message_id text default null,
  _error text default null,
  _permanent boolean default false,
  _retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.whatsapp_channel_deliveries%rowtype;
  _backoff_seconds integer;
begin
  select q.*
    into _row
  from public.whatsapp_channel_deliveries q
  where q.id = _id
    and q.lease_token = _lease_token
    and q.state = 'leased'
    and q.lease_until > now()
  for update;

  if not found then
    return false;
  end if;

  -- Unconditional mid-flight CAP Cancel / official cleared guard (NEVER overwrite to delivered)
  if _row.state = 'cancelled'
     or _row.last_error in ('cap_cancelled', 'official_cleared') then
    update public.whatsapp_channel_deliveries
       set state = 'cancelled',
           lease_token = null,
           lease_until = null,
           last_error = case
             when _row.last_error in ('cap_cancelled', 'official_cleared') then _row.last_error
             when _error in ('cap_cancelled', 'official_cleared') then _error
             else 'cap_cancelled'
           end,
           updated_at = now()
     where id = _row.id;
    return false;
  end if;

  if not _delivered and _error in ('cap_cancelled', 'official_cleared') then
    update public.whatsapp_channel_deliveries
       set state = 'cancelled',
           lease_token = null,
           lease_until = null,
           last_error = _error,
           updated_at = now()
     where id = _row.id;
    return true;
  end if;

  if _delivered then
    update public.whatsapp_channel_deliveries
       set state = 'delivered',
           provider_message_id = _provider_message_id,
           delivered_at = now(),
           last_error = null,
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;
    return true;
  end if;

  if _permanent then
    update public.whatsapp_channel_deliveries
       set state = 'failed',
           last_error = left(coalesce(_error, 'permanent_failure'), 1000),
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;
    return true;
  end if;

  if _row.expires_at <= now() then
    update public.whatsapp_channel_deliveries
       set state = 'expired',
           last_error = left(coalesce(_error, 'delivery_expired'), 1000),
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;
    return true;
  end if;

  if _row.attempts >= 8 then
    update public.whatsapp_channel_deliveries
       set state = 'failed',
           last_error = left(coalesce(_error, 'max_attempts_exhausted'), 1000),
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;
    return true;
  end if;

  _backoff_seconds := least(
    900,
    greatest(
      coalesce(_retry_after_seconds, 0),
      (30 * power(2, least(greatest(_row.attempts - 1, 0), 6)))::integer
    )
  );

  update public.whatsapp_channel_deliveries
     set state = 'pending',
         next_attempt_at = now() + make_interval(secs => _backoff_seconds),
         last_error = left(coalesce(_error, 'transient_failure'), 1000),
         lease_token = null,
         lease_until = null,
         updated_at = now()
   where id = _row.id;

  return true;
end;
$$;

-- 6.4 list_pending_email_digest_users
create function public.list_pending_email_digest_users(
  _limit integer default 100,
  _after_user_id uuid default null
)
returns table (
  user_id uuid,
  email text,
  display_name text,
  locale text,
  email_digest_frequency text,
  email_digest_hour_algiers smallint,
  quiet_hours_start smallint,
  quiet_hours_end smallint,
  last_sent_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _limit < 1 or _limit > 500 then
    raise exception 'invalid_digest_limit';
  end if;

  if not exists (
    select 1 from public.delivery_pipeline_settings
     where pipeline = 'email_digest' and enabled = true and paused = false
  ) then
    return;
  end if;

  return query
  select
    p.id as user_id,
    u.email::text as email,
    p.display_name,
    p.locale,
    p.email_digest_frequency,
    p.email_digest_hour_algiers,
    p.quiet_hours_start,
    p.quiet_hours_end,
    (
      select max(d.sent_at)
      from public.email_digest_deliveries d
      where d.user_id = p.id
        and d.state = 'sent'
        and d.digest_kind = p.email_digest_frequency
    ) as last_sent_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where u.email is not null
    and length(btrim(u.email::text)) > 0
    and u.email_confirmed_at is not null
    and p.alert_email = true
    and p.email_digest_frequency <> 'off'
    and (_after_user_id is null or p.id > _after_user_id)
    and not exists (
      select 1 from public.email_digest_suppressions s where s.user_id = p.id
    )
    and exists (
      select 1 from public.alerts a
       where a.user_id = p.id
         and a.delivered_email = false
    )
  order by p.id asc
  limit greatest(1, least(coalesce(_limit, 100), 500));
end;
$$;

-- 6.5 claim_email_digest_delivery
create function public.claim_email_digest_delivery(
  _user_id uuid,
  _digest_kind text,
  _window_key text,
  _dedupe_key text,
  _locale text,
  _alert_ids uuid[],
  _urgent_bypass boolean,
  _subject text
)
returns table (
  id uuid,
  lease_token uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  _clean_window text := btrim(_window_key);
  _clean_dedupe text := btrim(_dedupe_key);
  _count integer := coalesce(cardinality(_alert_ids), 0);
  _inserted_id uuid;
  _inserted_lease uuid;
  _inserted_attempts integer;
begin
  if _count = 0 then
    return;
  end if;

  if not exists (
    select 1 from public.delivery_pipeline_settings
     where pipeline = 'email_digest' and enabled = true and paused = false
  ) then
    return;
  end if;

  if exists (
    select 1 from public.email_digest_suppressions s where s.user_id = _user_id
  ) then
    return;
  end if;

  insert into public.email_digest_deliveries (
    user_id,
    digest_kind,
    window_key,
    dedupe_key,
    locale,
    alert_ids,
    alert_count,
    urgent_bypass,
    state,
    attempts,
    lease_token,
    lease_until,
    subject
  )
  values (
    _user_id,
    _digest_kind,
    _clean_window,
    _clean_dedupe,
    _locale,
    _alert_ids,
    _count,
    coalesce(_urgent_bypass, false),
    'leased',
    1,
    gen_random_uuid(),
    now() + interval '90 seconds',
    _subject
  )
  on conflict do nothing
  returning
    email_digest_deliveries.id,
    email_digest_deliveries.lease_token,
    email_digest_deliveries.attempts
  into _inserted_id, _inserted_lease, _inserted_attempts;

  if _inserted_id is not null then
    id := _inserted_id;
    lease_token := _inserted_lease;
    attempts := _inserted_attempts;
    return next;
    return;
  end if;

  -- Sweep expired attempt-5 leases to terminal failed before attempting claim
  update public.email_digest_deliveries d
     set state = 'failed',
         lease_token = null,
         lease_until = null,
         last_error = coalesce(d.last_error, 'max_attempts_exceeded'),
         updated_at = now()
   where d.state = 'leased'
     and d.lease_until <= now()
     and d.attempts >= 5;

  return query
  with candidate as (
    select d.id
    from public.email_digest_deliveries d
    where (
      d.dedupe_key = _clean_dedupe
      or (
        d.user_id = _user_id
        and d.digest_kind = _digest_kind
        and d.window_key = _clean_window
      )
    )
      and d.attempts < 5
      and (
        (d.state = 'pending' and d.next_attempt_at <= now())
        or (d.state = 'leased' and d.lease_until <= now())
      )
    for update skip locked
    limit 1
  )
  update public.email_digest_deliveries d
     set state = 'leased',
         attempts = d.attempts + 1,
         lease_token = gen_random_uuid(),
         lease_until = now() + interval '90 seconds',
         locale = _locale,
         alert_ids = _alert_ids,
         alert_count = _count,
         urgent_bypass = coalesce(_urgent_bypass, false),
         subject = _subject,
         updated_at = now()
    from candidate c
   where d.id = c.id
  returning d.id, d.lease_token, d.attempts;
end;
$$;

-- 6.6 finish_email_digest_delivery
create function public.finish_email_digest_delivery(
  _id uuid,
  _lease_token uuid,
  _sent boolean,
  _provider_message_id text default null,
  _error text default null,
  _permanent boolean default false,
  _bounced boolean default false,
  _retry_after_seconds integer default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _row public.email_digest_deliveries%rowtype;
  _backoff_seconds integer;
begin
  select d.*
    into _row
  from public.email_digest_deliveries d
  where d.id = _id
    and d.lease_token = _lease_token
    and d.state = 'leased'
    and d.lease_until > now()
  for update;

  if not found then
    return false;
  end if;

  if _sent then
    update public.email_digest_deliveries
       set state = 'sent',
           sent_at = now(),
           provider_message_id = _provider_message_id,
           last_error = null,
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;

    update public.alerts
       set delivered_email = true
     where user_id = _row.user_id
       and id = any(_row.alert_ids);

    return true;
  end if;

  if _bounced then
    update public.email_digest_deliveries
       set state = 'bounced',
           bounced_at = now(),
           last_error = left(coalesce(_error, 'hard_bounce'), 1000),
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;

    insert into public.email_digest_suppressions (
      user_id, reason, provider_error, suppressed_at
    )
    values (
      _row.user_id,
      'hard_bounce',
      left(coalesce(_error, 'hard_bounce'), 1000),
      now()
    )
    on conflict (user_id) do update
      set reason = 'hard_bounce',
          provider_error = excluded.provider_error,
          suppressed_at = now();

    return true;
  end if;

  if _permanent or _row.attempts >= 5 then
    update public.email_digest_deliveries
       set state = 'failed',
           last_error = left(
             coalesce(
               _error,
               case when _permanent then 'permanent_failure' else 'max_attempts_exhausted' end
             ),
             1000
           ),
           lease_token = null,
           lease_until = null,
           updated_at = now()
     where id = _row.id;
    return true;
  end if;

  _backoff_seconds := least(
    900,
    greatest(
      coalesce(_retry_after_seconds, 0),
      (30 * power(2, least(greatest(_row.attempts - 1, 0), 6)))::integer
    )
  );

  update public.email_digest_deliveries
     set state = 'pending',
         next_attempt_at = now() + make_interval(secs => _backoff_seconds),
         last_error = left(coalesce(_error, 'transient_failure'), 1000),
         lease_token = null,
         lease_until = null,
         updated_at = now()
   where id = _row.id;

  return true;
end;
$$;

-- 6.7 set_delivery_pipeline_state
create function public.set_delivery_pipeline_state(
  _pipeline text,
  _enabled boolean default null,
  _paused boolean default null,
  _pause_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.delivery_pipeline_settings
     set enabled = coalesce(_enabled, enabled),
         paused = coalesce(_paused, paused),
         pause_reason = case
           when coalesce(_paused, paused) = false then null
           else coalesce(_pause_reason, pause_reason)
         end,
         updated_at = now()
   where pipeline = _pipeline;

  return found;
end;
$$;

-- ============================================================================
-- 7. Explicit least-privilege function grants (5-role matrix)
-- ============================================================================

-- Trigger functions: ZERO execute grants to any role
revoke all on function public.invalidate_cancelled_onm_whatsapp_deliveries()
  from public, anon, authenticated, service_role;
revoke all on function public.invalidate_cleared_official_whatsapp_deliveries()
  from public, anon, authenticated, service_role;

-- service_role-only RPCs
revoke all on function public.list_pending_whatsapp_broadcasts(text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pending_whatsapp_broadcasts(text, text, integer)
  to service_role;

revoke all on function public.enqueue_whatsapp_broadcast(uuid, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_whatsapp_broadcast(uuid, text, text, text, jsonb, timestamptz)
  to service_role;

revoke all on function public.claim_whatsapp_deliveries(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_whatsapp_deliveries(integer)
  to service_role;

revoke all on function public.finish_whatsapp_delivery(uuid, uuid, boolean, text, text, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_whatsapp_delivery(uuid, uuid, boolean, text, text, boolean, integer)
  to service_role;

revoke all on function public.list_pending_email_digest_users(integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pending_email_digest_users(integer, uuid)
  to service_role;

revoke all on function public.claim_email_digest_delivery(uuid, text, text, text, text, uuid[], boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_digest_delivery(uuid, text, text, text, text, uuid[], boolean, text)
  to service_role;

revoke all on function public.finish_email_digest_delivery(uuid, uuid, boolean, text, text, boolean, boolean, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.finish_email_digest_delivery(uuid, uuid, boolean, text, text, boolean, boolean, integer)
  to service_role;

revoke all on function public.set_delivery_pipeline_state(text, boolean, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.set_delivery_pipeline_state(text, boolean, boolean, text)
  to service_role;
