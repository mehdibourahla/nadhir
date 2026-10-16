create function public.release_ita_extraction(_job uuid, _attempt integer, _id uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public.assert_ita_source_lease(_job,_attempt);
  update public.ita_reports set extraction_attempts=extraction_attempts-1,next_extraction_at=clock_timestamp()
    where id=_id and extraction is null and extraction_attempts>0;
  if not found then
    raise exception using errcode='55000',message='ita_extraction_not_pending';
  end if;
end;
$$;
revoke all on function public.release_ita_extraction(uuid,integer,uuid) from public, anon, authenticated;
grant execute on function public.release_ita_extraction(uuid,integer,uuid) to service_role;

-- one recovery cycle for the reports quarantined by the 2026-10-10..13 credit outage
update public.source_contracts set parser_version='ita-extract-v5' where key='ita_website';
