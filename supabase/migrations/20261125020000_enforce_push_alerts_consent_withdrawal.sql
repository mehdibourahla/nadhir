-- Tier 5 (T5-01): Enforce Law 18-07 / Law 25-11 push_alerts consent withdrawal
-- in public.claim_alert_pushes. Preserves exact RPC signature, return type,
-- SECURITY DEFINER, search_path = '', and least-privilege 5-role grants.

create or replace function public.claim_alert_pushes(_limit integer default 50)
returns setof public.alerts
language sql
security definer
set search_path = ''
as $$
  update public.alerts a
     set push_claimed_at = now(), push_attempts = a.push_attempts + 1
   where a.id in (
     select al.id
       from public.alerts al
      where al.push_state = 'pending'
        and al.created_at > now() - interval '6 hours'
        and al.push_attempts < 5
        and (
          al.push_claimed_at is null
          or al.push_claimed_at < now() - interval '5 minutes'
        )
        and not exists (
          select 1
            from public.privacy_consents pc
           where pc.user_id = al.user_id
             and pc.consent_type = 'push_alerts'
             and pc.status = 'withdrawn'
        )
      order by al.created_at
      limit _limit
      for update skip locked)
  returning a.*
$$;

-- Explicit least-privilege function grants (5-role matrix: only service_role executes)
revoke all on function public.claim_alert_pushes(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_alert_pushes(integer)
  to service_role;
