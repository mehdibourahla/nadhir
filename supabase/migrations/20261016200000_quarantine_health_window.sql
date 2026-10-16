-- an unread document older than the map's 72-hour official window no longer changes what anyone sees
create or replace function public.source_processing_health()
returns table(key text,collection_at timestamptz,pending bigint,quarantined bigint)
language sql stable security definer set search_path='' as $$
  select c.key,
    (select max(a.fetched_at) from public.source_captures a where a.source_key=c.key
      and a.http_status in(200,304) and a.status in('captured','not_modified')),
    case when c.key='ita_website' then (select count(*) from public.ita_reports where extraction is null and extraction_attempts<5)
      else (select count(*) from public.document_extractions e join public.source_documents d on d.id=e.document_id
        join public.text_sources s on s.id=d.text_source_id where s.key=c.key and e.attempts<4) end,
    case when c.key='ita_website' then (select count(*) from public.ita_reports where extraction is null and extraction_attempts>=5
        and fetched_at>now()-interval '72 hours')
      else (select count(*) from public.document_extractions e join public.source_documents d on d.id=e.document_id
        join public.text_sources s on s.id=d.text_source_id where s.key=c.key and e.attempts>=4
        and d.fetched_at>now()-interval '72 hours') end
  from public.source_contracts c where c.enabled
    and (c.key='ita_website' or exists(select 1 from public.text_sources s where s.key=c.key and s.enabled));
$$;
