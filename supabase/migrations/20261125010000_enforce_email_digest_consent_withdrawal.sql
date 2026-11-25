-- M6.3 Category A (F13 x F22): Enforce Law 18-07 / Law 25-11 email_digest consent
-- withdrawal in both list_pending_email_digest_users and claim_email_digest_delivery.
-- Preserves exact RPC signatures, SECURITY DEFINER, search_path = '', and strict
-- orthogonality with public.email_digest_suppressions (re-granting consent NEVER
-- clears a hard_bounce or complaint suppression).

create or replace function public.list_pending_email_digest_users(
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
    and not exists (
      select 1
        from public.privacy_consents pc
       where pc.user_id = p.id
         and pc.consent_type = 'email_digest'
         and pc.status = 'withdrawn'
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

create or replace function public.claim_email_digest_delivery(
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

  if exists (
    select 1
      from public.privacy_consents pc
     where pc.user_id = _user_id
       and pc.consent_type = 'email_digest'
       and pc.status = 'withdrawn'
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

-- Explicit least-privilege function grants (5-role matrix)
revoke all on function public.list_pending_email_digest_users(integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.list_pending_email_digest_users(integer, uuid)
  to service_role;

revoke all on function public.claim_email_digest_delivery(uuid, text, text, text, text, uuid[], boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_digest_delivery(uuid, text, text, text, text, uuid[], boolean, text)
  to service_role;
