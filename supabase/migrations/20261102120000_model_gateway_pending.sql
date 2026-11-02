-- A paused plan, a rate limit or an unreachable model gateway says nothing about the item
-- being read: it goes back to pending without spending an attempt, due again after the
-- gateway's retry_after instead of at once.
drop function public.release_ita_extraction(uuid,integer,uuid);
create function public.release_ita_extraction(_job uuid, _attempt integer, _id uuid, _delay_seconds integer default 0)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.assert_ita_source_lease(_job,_attempt);
  update public.ita_reports set extraction_attempts=extraction_attempts-1,
    next_extraction_at=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(_delay_seconds,0),0),86400))
    where id=_id and extraction is null and extraction_attempts>0;
  if not found then
    raise exception using errcode='55000',message='ita_extraction_not_pending';
  end if;
end;
$$;
revoke all on function public.release_ita_extraction(uuid,integer,uuid,integer) from public, anon, authenticated;
grant execute on function public.release_ita_extraction(uuid,integer,uuid,integer) to service_role;

create function public.release_civil_investigation(_job uuid, _attempt integer, _id uuid, _investigation_attempt integer, _delay_seconds integer default 0)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.civil_investigations;
begin
  perform public.assert_ita_source_lease(_job,_attempt);
  select * into w from public.civil_investigations where id=_id for update;
  if not found or w.state<>'processing' or w.job_id is distinct from _job or w.job_attempt is distinct from _attempt or w.attempts is distinct from _investigation_attempt then
    raise exception using errcode='55000',message='civil_investigation_claim_lost';
  end if;
  update public.civil_investigations set state='pending',attempts=greatest(attempts-1,0),
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(greatest(coalesce(_delay_seconds,0),0),86400)),
    updated_at=clock_timestamp()
    where id=_id;
end;
$$;
revoke all on function public.release_civil_investigation(uuid,integer,uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.release_civil_investigation(uuid,integer,uuid,integer,integer) to service_role;

-- Rollback: deploy callers that pass no delay first; then restore the three-argument release and drop the civil release.
