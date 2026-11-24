-- M2A: ONM CAP 1.2 Alert/Update/Cancel escalation chains, atomic cancellation
-- delivery invalidation (ONM Cancel & official incident cleared), and
-- multi-hazard (DGPC non-fire + M4+ earthquake) accountless commune broadcasts.

-- 1. Extend public.onm_vigilance with CAP 1.2 chain & cancellation columns
alter table public.onm_vigilance
  add column msg_type text not null default 'Alert',
  add column cap_references text,
  add column referenced_cap_ids text[] not null default '{}',
  add column geocodes text[] not null default '{}',
  add column superseded_by uuid references public.onm_vigilance(id) on delete set null,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.onm_vigilance(id) on delete set null;

alter table public.onm_vigilance
  add constraint onm_vigilance_msg_type_check
    check (msg_type in ('Alert', 'Update', 'Cancel')),
  add constraint onm_vigilance_no_self_supersede
    check (superseded_by is null or superseded_by <> id),
  add constraint onm_vigilance_no_self_cancel
    check (cancelled_by is null or cancelled_by <> id);

create index idx_onm_vigilance_msg_type
  on public.onm_vigilance (msg_type, sent desc);
create index idx_onm_vigilance_active_cap
  on public.onm_vigilance (wilaya_id, expires desc)
  where superseded_at is null
    and superseded_by is null
    and cancelled_at is null
    and msg_type <> 'Cancel';
create index idx_onm_vigilance_superseded_by
  on public.onm_vigilance (superseded_by)
  where superseded_by is not null;
create index idx_onm_vigilance_cancelled_by
  on public.onm_vigilance (cancelled_by)
  where cancelled_by is not null;
create index idx_onm_vigilance_ref_cap_ids
  on public.onm_vigilance using gin (referenced_cap_ids)
  where cardinality(referenced_cap_ids) > 0;

-- Exclude CAP Cancel control records from warning history counts & episode inheritance
create or replace view public.onm_warning_history
with (security_invoker = true)
as
with windows as (
  select
    id,
    wilaya_id,
    coalesce(wilaya_id::text, area_desc) as area,
    event,
    severity,
    coalesce(onset, sent) as starts_at,
    coalesce(expires, onset, sent) as ends_at,
    sent
  from public.onm_vigilance
  where msg_type <> 'Cancel'
),
marked as (
  select *,
    case when starts_at > coalesce(max(ends_at) over (
      partition by area, event, severity order by starts_at, sent
      rows between unbounded preceding and 1 preceding), '-infinity') then 1 else 0 end as opens
  from windows
),
episodes as (
  select *, sum(opens) over (partition by area, event, severity order by starts_at, sent) as episode
  from marked
)
select distinct on (area, event, severity, episode)
  id,
  wilaya_id,
  event,
  severity,
  starts_at,
  max(ends_at) over (partition by area, event, severity, episode) as expires
from episodes
order by area, event, severity, episode, starts_at, sent;

create or replace function public.onm_episode_of(_warning public.onm_vigilance)
returns table(episode_id uuid, episode_peak smallint)
language sql stable set search_path = '' as $$
  select coalesce(p.episode_id, _warning.id),
    greatest(coalesce(p.episode_peak, 0), public.onm_severity_rank(_warning.severity))::smallint
  from (select 1) one
  left join lateral (
    select v.episode_id, v.episode_peak
    from public.onm_vigilance v
    where v.id <> _warning.id
      and v.episode_id is not null
      and v.msg_type <> 'Cancel'
      and v.cancelled_at is null
      and coalesce(v.wilaya_id::text, v.area_desc) = coalesce(_warning.wilaya_id::text, _warning.area_desc)
      and v.event = _warning.event
      and coalesce(v.onset, v.sent) <= coalesce(_warning.expires, _warning.onset, _warning.sent)
      and coalesce(_warning.onset, _warning.sent) <= coalesce(v.expires, v.onset, v.sent)
    order by v.sent desc, v.episode_peak desc, v.id desc
    limit 1
  ) p on true
$$;

-- Never let feed-absence supersession revive explicitly cancelled/superseded rows or stamp Cancel records
create or replace function public.supersede_onm_absent(_feed_cap_ids text[], _feed_sent timestamptz)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  _stamped integer;
begin
  if coalesce(cardinality(_feed_cap_ids), 0) = 0 or _feed_sent is null then
    raise exception 'a supersession pass needs a non-empty feed' using errcode = '22023';
  end if;
  if _feed_sent < (select max(sent) from public.onm_vigilance) then
    return 0;
  end if;
  update public.onm_vigilance
     set superseded_at = null
   where superseded_at is not null
     and cancelled_at is null
     and superseded_by is null
     and msg_type <> 'Cancel'
     and cap_id = any(_feed_cap_ids);
  update public.onm_vigilance
     set superseded_at = clock_timestamp()
   where superseded_at is null
     and cancelled_at is null
     and msg_type <> 'Cancel'
     and sent < _feed_sent
     and (expires is null or expires > clock_timestamp())
     and cap_id <> all(_feed_cap_ids);
  get diagnostics _stamped = row_count;
  return _stamped;
end;
$$;

-- Extend store_onm_detail with optional trailing CAP chain/geocode params (backwards-compatible with 4-arg callers)
drop function public.store_onm_detail(uuid, text, text, jsonb);
create function public.store_onm_detail(
  _id uuid,
  _headline_fr text default null,
  _instruction_fr text default null,
  _polygon jsonb default null,
  _msg_type text default null,
  _cap_references text default null,
  _referenced_cap_ids text[] default null,
  _geocodes text[] default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  _area text := case when _polygon is null then null else md5(_polygon::text) end;
begin
  if _msg_type is not null and _msg_type not in ('Alert', 'Update', 'Cancel') then
    raise exception 'invalid_cap_msg_type' using errcode = '22023';
  end if;
  if _area is not null then
    insert into public.onm_areas (id, polygon) values (_area, _polygon) on conflict (id) do nothing;
  end if;
  update public.onm_vigilance
     set headline_fr = _headline_fr,
         instruction_fr = _instruction_fr,
         area_id = _area,
         msg_type = coalesce(_msg_type, msg_type),
         cap_references = coalesce(_cap_references, cap_references),
         referenced_cap_ids = case
           when _referenced_cap_ids is not null and cardinality(_referenced_cap_ids) > 0
             then _referenced_cap_ids
           else referenced_cap_ids
         end,
         geocodes = case
           when _geocodes is not null and cardinality(_geocodes) > 0
             then _geocodes
           else geocodes
         end,
         cap_detail_fetched_at = greatest(
           clock_timestamp(),
           coalesce(cap_detail_fetched_at + interval '1 microsecond', clock_timestamp())
         )
   where id = _id;
  if not found then raise exception 'onm_warning_not_found' using errcode = 'P0002'; end if;
end;
$$;

-- Prevent Atom feed re-poll upserts from clobbering CAP-detail-enriched fields
create function public.preserve_onm_cap_detail_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.cap_detail_fetched_at is not null
    and new.cap_detail_fetched_at is not distinct from old.cap_detail_fetched_at
  then
    if new.msg_type = 'Alert' and old.msg_type in ('Update', 'Cancel') then
      new.msg_type := old.msg_type;
    end if;
    if new.cap_references is null and old.cap_references is not null then
      new.cap_references := old.cap_references;
    end if;
    if coalesce(cardinality(new.referenced_cap_ids), 0) = 0
      and coalesce(cardinality(old.referenced_cap_ids), 0) > 0
    then
      new.referenced_cap_ids := old.referenced_cap_ids;
    end if;
    if coalesce(cardinality(new.geocodes), 0) = 0
      and coalesce(cardinality(old.geocodes), 0) > 0
    then
      new.geocodes := old.geocodes;
    end if;
  end if;
  return new;
end;
$$;

create trigger preserve_onm_cap_detail_fields
  before update on public.onm_vigilance
  for each row execute function public.preserve_onm_cap_detail_fields();

-- 2. Extend public.broadcasts for 'earthquake', F8 non-fire end phases, and M2A->M2B metadata
alter table public.broadcasts
  add column earthquake_id text references public.earthquakes(id) on delete set null,
  add column hazard text,
  add column source_key text,
  add column metadata jsonb not null default '{}'::jsonb;

alter table public.broadcasts drop constraint broadcasts_kind_check;
alter table public.broadcasts
  add constraint broadcasts_kind_check
    check (kind in ('fire', 'onm', 'authority', 'official', 'earthquake'));

alter table public.broadcasts drop constraint broadcasts_check;
alter table public.broadcasts
  add constraint broadcasts_check check (
    (kind = 'fire' and cluster_id is not null)
    or (kind = 'onm' and onm_vigilance_id is not null)
    or (kind = 'authority' and authority_warning_id is not null)
    or (kind = 'official' and official_incident_id is not null)
    or (kind = 'earthquake' and earthquake_id is not null)
  );

-- Allow official incidents to emit initial + end (on DGPC 'cleared'), while keeping each phase idempotent
drop index if exists public.idx_broadcasts_official_once;
create unique index idx_broadcasts_official_phase_once
  on public.broadcasts (official_incident_id, phase)
  where kind = 'official';

-- Push-once-per-earthquake idempotency (upward M4+ revision pushes once; never retracts downward)
create unique index idx_broadcasts_earthquake_once
  on public.broadcasts (earthquake_id)
  where kind = 'earthquake';

-- Keep idx_broadcasts_onm_once untouched (asserted by source_execution.test.sql:878)

-- 3. Explicit delivery invalidation on CAP Cancel AND official incident cleared/extinguished/unlisted
--    (separate from onm_delivery_validity triggers so onm_delivery_validity.test.sql stays green!)
alter table public.broadcast_delivery_queue
  drop constraint broadcast_delivery_queue_state_check,
  add constraint broadcast_delivery_queue_state_check
    check (state in ('pending', 'leased', 'delivered', 'expired', 'cancelled'));

create function public.clamp_cancelled_onm_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  _cancelled boolean;
begin
  if new.state not in ('pending', 'leased') then
    return new;
  end if;
  select (v.cancelled_at is not null or v.msg_type = 'Cancel')
    into _cancelled
  from public.broadcasts b
  join public.onm_vigilance v on v.id = b.onm_vigilance_id
  where b.id = new.broadcast_id and b.kind = 'onm';
  if coalesce(_cancelled, false) then
    new.expires_at := '-infinity'::timestamptz;
    new.last_error := 'cap_cancelled';
    if new.state = 'pending' then
      new.state := 'cancelled';
      new.lease_token := null;
      new.lease_until := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger clamp_cancelled_onm_delivery
  before insert or update on public.broadcast_delivery_queue
  for each row execute function public.clamp_cancelled_onm_delivery();

create function public.invalidate_cancelled_onm_deliveries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.cancelled_at is null or old.cancelled_at is not null then
    return new;
  end if;
  -- Pending rows transition immediately to 'cancelled' (never claimed, never trigger watchdog delivery_expired)
  update public.broadcast_delivery_queue q
     set state = 'cancelled',
         expires_at = least(q.expires_at, '-infinity'::timestamptz),
         lease_token = null,
         lease_until = null,
         last_error = 'cap_cancelled'
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'onm'
     and b.onm_vigilance_id = new.id
     and q.state = 'pending';
  -- Leased rows keep lease_token/lease_until for in-flight receipt preservation, while expires_at = -infinity
  -- forces the next renew_broadcast_delivery to return false and stop remaining unsent topics
  update public.broadcast_delivery_queue q
     set expires_at = least(q.expires_at, '-infinity'::timestamptz),
         last_error = 'cap_cancelled'
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'onm'
     and b.onm_vigilance_id = new.id
     and q.state = 'leased';
  return new;
end;
$$;

create trigger invalidate_cancelled_onm_deliveries
  after update of cancelled_at on public.onm_vigilance
  for each row execute function public.invalidate_cancelled_onm_deliveries();

create function public.clamp_cleared_official_delivery() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  _cleared boolean;
begin
  if new.state not in ('pending', 'leased') then
    return new;
  end if;
  select (o.status in ('cleared', 'extinguished') or o.unlisted_at is not null)
    into _cleared
  from public.broadcasts b
  join public.official_incidents o on o.id = b.official_incident_id
  where b.id = new.broadcast_id
    and b.kind = 'official'
    and b.phase = 'initial';
  if coalesce(_cleared, false) then
    new.expires_at := '-infinity'::timestamptz;
    new.last_error := 'official_cleared';
    if new.state = 'pending' then
      new.state := 'cancelled';
      new.lease_token := null;
      new.lease_until := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger clamp_cleared_official_delivery
  before insert or update on public.broadcast_delivery_queue
  for each row execute function public.clamp_cleared_official_delivery();

create function public.invalidate_cleared_official_deliveries() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not (new.status in ('cleared', 'extinguished') or new.unlisted_at is not null) then
    return new;
  end if;
  update public.broadcast_delivery_queue q
     set state = 'cancelled',
         expires_at = least(q.expires_at, '-infinity'::timestamptz),
         lease_token = null,
         lease_until = null,
         last_error = 'official_cleared'
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'official'
     and b.phase = 'initial'
     and b.official_incident_id = new.id
     and q.state = 'pending';
  update public.broadcast_delivery_queue q
     set expires_at = least(q.expires_at, '-infinity'::timestamptz),
         last_error = 'official_cleared'
    from public.broadcasts b
   where b.id = q.broadcast_id
     and b.kind = 'official'
     and b.phase = 'initial'
     and b.official_incident_id = new.id
     and q.state = 'leased';
  return new;
end;
$$;

create trigger invalidate_cleared_official_deliveries
  after update of status, unlisted_at on public.official_incidents
  for each row execute function public.invalidate_cleared_official_deliveries();

-- Update claim/finish so cancelled-while-leased rows finalize to 'cancelled' (never 'expired')
create or replace function public.claim_broadcast_delivery(_channel text, _limit integer default 20)
returns table(job jsonb) language plpgsql security definer set search_path = '' as $$
begin
  if _limit < 1 or _limit > 100 then raise exception 'invalid_delivery_limit'; end if;
  if not exists(select 1 from public.delivery_channel_settings where channel=_channel and not paused)
    or not exists(select 1 from public.broadcast_settings where id=true and enabled) then return; end if;
  update public.broadcast_delivery_queue
     set state = case
           when last_error in ('cap_cancelled', 'official_cleared') then 'cancelled'
           else 'expired'
         end,
         lease_token = null,
         lease_until = null,
         last_error = coalesce(last_error, 'delivery_expired')
   where channel=_channel and state in ('pending','leased') and (expires_at<=now() or attempts>=8)
     and (lease_until is null or lease_until<=now());
  return query
  with due as (
    select q.broadcast_id, q.channel from public.broadcast_delivery_queue q
    where q.channel=_channel and q.expires_at>now() and q.attempts<8
      and ((q.state='pending' and q.next_attempt_at<=now()) or (q.state='leased' and q.lease_until<=now()))
    order by q.created_at, q.broadcast_id for update skip locked limit _limit
  ), claimed as (
    update public.broadcast_delivery_queue q set state='leased', attempts=q.attempts+1,
      lease_token=gen_random_uuid(), lease_until=now()+interval '90 seconds'
    from due where q.broadcast_id=due.broadcast_id and q.channel=due.channel returning q.*
  )
  select to_jsonb(b)||jsonb_build_object('lease_token', c.lease_token)
  from claimed c join public.broadcasts b on b.id=c.broadcast_id;
end;
$$;

create or replace function public.finish_broadcast_delivery(
  _broadcast_id uuid, _channel text, _lease_token uuid, _count integer, _error text default null
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  _final_state text;
begin
  if _count < 0 then raise exception 'invalid_delivery_count'; end if;
  update public.broadcast_delivery_queue q set
    state = case
      when (q.last_error in ('cap_cancelled', 'official_cleared') and coalesce(_count, 0) = 0)
        or (_count is null and _error in ('cap_cancelled', 'official_cleared'))
        then 'cancelled'
      when _count is not null then 'delivered'
      when q.expires_at<=now() or (q.attempts>=8 and _error is distinct from 'budget_exhausted') then 'expired'
      else 'pending'
    end,
    attempts = case when _count is null and _error='budget_exhausted' then greatest(0,q.attempts-1) else q.attempts end,
    next_attempt_at = case when _error='budget_exhausted' then now() else now()+make_interval(secs=>least(900, 30*power(2, least(q.attempts-1, 5)))::integer) end,
    lease_token = null,
    lease_until = null,
    last_error = case
      when (q.last_error in ('cap_cancelled', 'official_cleared') and coalesce(_count, 0) = 0)
        or (_count is null and _error in ('cap_cancelled', 'official_cleared'))
        then case
          when q.last_error in ('cap_cancelled', 'official_cleared') then q.last_error
          else _error
        end
      when _count is null then left(_error,1000)
      else null
    end
  where q.broadcast_id=_broadcast_id and q.channel=_channel and q.lease_token=_lease_token
    and q.state='leased' and q.lease_until>now()
  returning q.state into _final_state;
  if not found then return false; end if;
  if _final_state = 'delivered' then
    if _channel='fcm' then
      update public.broadcasts set fcm_delivered_at=now(), fcm_topics=_count where id=_broadcast_id;
    else
      update public.broadcasts set telegram_delivered_at=now(), telegram_channels=_count where id=_broadcast_id;
    end if;
  end if;
  return true;
end;
$$;

-- 4. Atomic CAP Update/Cancel chain linker RPC (forward + reverse + cycle-safe transitive cancel)
create function public.apply_onm_cap_chain(_cap_ids text[])
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  _linked_updates integer := 0;
  _cancelled_warnings integer := 0;
  _invalidated_deliveries integer := 0;
  _cancelled_ids uuid[] := '{}';
  _n integer := 0;
begin
  if coalesce(cardinality(_cap_ids), 0) = 0 then
    return jsonb_build_object(
      'linked_updates', 0,
      'cancelled_warnings', 0,
      'invalidated_deliveries', 0
    );
  end if;

  -- A. Forward Update linkage: incoming Updates supersede referenced older warnings
  with latest_updater as (
    select distinct on (target.id)
      target.id as target_id,
      child.id as updater_id
    from public.onm_vigilance child
    join public.onm_vigilance target
      on target.cap_id = any(child.referenced_cap_ids)
     and target.id <> child.id
    where child.cap_id = any(_cap_ids)
      and child.msg_type = 'Update'
      and cardinality(child.referenced_cap_ids) > 0
      and target.cancelled_at is null
      and target.superseded_by is null
      and target.sent <= child.sent
    order by target.id, child.sent desc, child.id desc
  )
  update public.onm_vigilance t
     set superseded_by = u.updater_id
    from latest_updater u
   where t.id = u.target_id
     and t.superseded_by is null;
  get diagnostics _n = row_count;
  _linked_updates := _linked_updates + _n;

  -- B. Reverse Update linkage (out-of-order): incoming Alert/Update already referenced by an existing Update
  with existing_updater as (
    select distinct on (target.id)
      target.id as target_id,
      child.id as updater_id
    from public.onm_vigilance target
    join public.onm_vigilance child
      on child.referenced_cap_ids @> array[target.cap_id]
     and child.id <> target.id
    where target.cap_id = any(_cap_ids)
      and target.msg_type in ('Alert', 'Update')
      and target.cancelled_at is null
      and target.superseded_by is null
      and child.msg_type = 'Update'
      and target.sent <= child.sent
    order by target.id, child.sent desc, child.id desc
  )
  update public.onm_vigilance t
     set superseded_by = u.updater_id
    from existing_updater u
   where t.id = u.target_id
     and t.superseded_by is null;
  get diagnostics _n = row_count;
  _linked_updates := _linked_updates + _n;

  -- C. Forward + Reverse + Cycle-Protected Transitive Cancel linkage (depth <= 32)
  with recursive seed as (
    -- Forward: incoming Cancel rows -> their directly referenced warnings
    select target.id as target_id,
           canceller.id as canceller_id,
           coalesce(canceller.sent, now()) as cancel_ts,
           0 as depth,
           array[target.id] as visited
    from public.onm_vigilance canceller
    join public.onm_vigilance target
      on target.cap_id = any(canceller.referenced_cap_ids)
     and target.id <> canceller.id
    where canceller.cap_id = any(_cap_ids)
      and canceller.msg_type = 'Cancel'
      and cardinality(canceller.referenced_cap_ids) > 0
      and target.msg_type <> 'Cancel'
    union all
    -- Reverse: incoming Alert/Update rows already referenced by an earlier-stored Cancel
    select target.id as target_id,
           canceller.id as canceller_id,
           coalesce(canceller.sent, now()) as cancel_ts,
           0 as depth,
           array[target.id] as visited
    from public.onm_vigilance target
    join public.onm_vigilance canceller
      on canceller.referenced_cap_ids @> array[target.cap_id]
     and canceller.id <> target.id
    where target.cap_id = any(_cap_ids)
      and target.msg_type <> 'Cancel'
      and canceller.msg_type = 'Cancel'
    union all
    -- Out-of-order pre-cancel Update: incoming Update referencing an already-cancelled row
    -- sent at or before that parent's cancellation timestamp inherits the cancellation
    select target.id as target_id,
           coalesce(parent.cancelled_by, parent.id) as canceller_id,
           parent.cancelled_at as cancel_ts,
           0 as depth,
           array[target.id] as visited
    from public.onm_vigilance target
    join public.onm_vigilance parent
      on parent.cap_id = any(target.referenced_cap_ids)
     and parent.id <> target.id
    where target.cap_id = any(_cap_ids)
      and target.msg_type = 'Update'
      and cardinality(target.referenced_cap_ids) > 0
      and parent.cancelled_at is not null
      and target.sent <= parent.cancelled_at
  ), chain as (
    select target_id, canceller_id, cancel_ts, depth, visited from seed
    union all
    -- Bidirectional walk along superseded_by with cycle guard so visited nodes are never re-entered
    select rel.id,
           c.canceller_id,
           c.cancel_ts,
           c.depth + 1,
           c.visited || rel.id
    from chain c
    join public.onm_vigilance cur on cur.id = c.target_id
    join public.onm_vigilance rel
      on (rel.superseded_by = cur.id or cur.superseded_by = rel.id)
     and rel.id <> cur.id
     and rel.msg_type <> 'Cancel'
     and not (rel.id = any(c.visited))
    where c.depth < 32
  ), dedup as (
    select distinct on (target_id) target_id, canceller_id, cancel_ts
    from chain
    order by target_id, cancel_ts asc, canceller_id asc
  ), newly_cancelled as (
    update public.onm_vigilance t
       set cancelled_at = d.cancel_ts,
           cancelled_by = d.canceller_id
      from dedup d
     where t.id = d.target_id
       and t.cancelled_at is null
    returning t.id
  )
  select coalesce(array_agg(id), '{}'::uuid[])
    into _cancelled_ids
    from newly_cancelled;

  -- Separate statement so AFTER UPDATE trigger invalidate_cancelled_onm_deliveries has already committed its updates
  _cancelled_warnings := coalesce(cardinality(_cancelled_ids), 0);
  if _cancelled_warnings > 0 then
    select count(*)::integer
      into _invalidated_deliveries
      from public.broadcast_delivery_queue q
      join public.broadcasts b on b.id = q.broadcast_id
     where b.kind = 'onm'
       and b.onm_vigilance_id = any(_cancelled_ids)
       and q.last_error = 'cap_cancelled';
  end if;

  return jsonb_build_object(
    'linked_updates', _linked_updates,
    'cancelled_warnings', _cancelled_warnings,
    'invalidated_deliveries', _invalidated_deliveries
  );
end;
$$;

-- 5. Explicit least-privilege REVOKE / GRANT on EVERY new or altered function
revoke all on function public.onm_episode_of(public.onm_vigilance)
  from public, anon, authenticated, service_role;
grant execute on function public.onm_episode_of(public.onm_vigilance)
  to service_role;

revoke all on function public.supersede_onm_absent(text[], timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.supersede_onm_absent(text[], timestamptz)
  to service_role;

revoke all on function public.store_onm_detail(uuid, text, text, jsonb, text, text, text[], text[])
  from public, anon, authenticated, service_role;
grant execute on function public.store_onm_detail(uuid, text, text, jsonb, text, text, text[], text[])
  to service_role;

revoke all on function public.apply_onm_cap_chain(text[])
  from public, anon, authenticated, service_role;
grant execute on function public.apply_onm_cap_chain(text[])
  to service_role;

revoke all on function public.claim_broadcast_delivery(text, integer),
  public.finish_broadcast_delivery(uuid, text, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_broadcast_delivery(text, integer),
  public.finish_broadcast_delivery(uuid, text, uuid, integer, text)
  to service_role;

-- Trigger functions: ZERO execute grants to any non-owner role
revoke all on function public.preserve_onm_cap_detail_fields()
  from public, anon, authenticated, service_role;
revoke all on function public.clamp_cancelled_onm_delivery()
  from public, anon, authenticated, service_role;
revoke all on function public.invalidate_cancelled_onm_deliveries()
  from public, anon, authenticated, service_role;
revoke all on function public.clamp_cleared_official_delivery()
  from public, anon, authenticated, service_role;
revoke all on function public.invalidate_cleared_official_deliveries()
  from public, anon, authenticated, service_role;

-- Defense-in-depth: anon & authenticated are read-only on public.onm_vigilance
revoke insert, update, delete, truncate on public.onm_vigilance
  from anon, authenticated;
