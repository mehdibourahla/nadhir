-- M4A: Observed 30-min satellite rainfall (IMERG/H-SAF), hardened Gendarmerie Tariki,
-- and CRAAG official earthquake attribution alongside EMSC M2+ (ADR-0001, ADR-0002, M6 Gate).

-- 1. Register 4 versioned worker source contracts (zero em dashes in labels/attributions)
-- Note: existing `emsc` contract remains on `execution_target = 'cloudflare'`.
insert into public.source_contracts (
  key,
  version,
  label,
  family,
  criticality,
  freshness_basis,
  cadence_minutes,
  warning_after_minutes,
  stale_after_minutes,
  max_fallback_age_minutes,
  expected_coverage,
  parser_version,
  dependency_keys,
  licence,
  attribution,
  owner,
  runbook_url,
  enabled,
  schedule_enabled,
  schedule_offset_minutes,
  execution_target,
  lease_seconds,
  max_attempts,
  retry_base_seconds,
  retry_window_minutes,
  overlap_minutes,
  replay_capability,
  replay_window_minutes,
  is_reference
)
values
  (
    'imerg_rainfall',
    1,
    'NASA GPM IMERG Early 30-min rainfall',
    'hazard_observation',
    'supporting',
    'upstream_published_at',
    30,
    300,
    480,
    720,
    '{"bbox":{"south":18.9,"north":37.6,"west":-8.7,"east":12.0},"window_minutes":30,"observation_kind":"satellite_observed"}'::jsonb,
    'imerg-early-v1',
    '{}',
    'NASA Earthdata / GPM IMERG Early (public scientific, attributed)',
    'NASA GPM IMERG Early (satellite observed rainfall)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    7,
    'worker',
    300,
    3,
    60,
    30,
    30,
    'interval',
    360,
    false
  ),
  (
    'hsaf_rainfall',
    1,
    'EUMETSAT H-SAF 30-min satellite rainfall',
    'hazard_observation',
    'supporting',
    'upstream_published_at',
    30,
    120,
    240,
    720,
    '{"bbox":{"south":18.9,"north":37.6,"west":-8.7,"east":12.0},"window_minutes":30,"observation_kind":"satellite_observed"}'::jsonb,
    'hsaf-precip-v1',
    '{}',
    'EUMETSAT H-SAF (public scientific, attributed)',
    'EUMETSAT H-SAF (satellite observed rainfall)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    17,
    'worker',
    300,
    3,
    60,
    30,
    30,
    'interval',
    360,
    false
  ),
  (
    'tariki_facebook',
    1,
    'Gendarmerie Nationale (Tariki)',
    'official_text',
    'supporting',
    'last_success_at',
    60,
    180,
    360,
    720,
    '{"scope":"national","authority_tier":"national","hazards":["road","flood","structure","storm","other"]}'::jsonb,
    'tariki-facebook-v1',
    '{}',
    'Public official channel, attributed',
    'Gendarmerie Nationale (Tariki)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    11,
    'worker',
    300,
    3,
    60,
    30,
    10,
    'none',
    null,
    false
  ),
  (
    'craag_earthquakes',
    1,
    'CRAAG official earthquake bulletins',
    'hazard_observation',
    'supporting',
    'last_success_at',
    15,
    90,
    360,
    1440,
    '{"scope":"national","role":"official_attribution_matcher","min_magnitude":2.0}'::jsonb,
    'craag-html-v1',
    '{}',
    'Official public bulletins, attributed',
    'CRAAG (Centre de Recherche en Astronomie, Astrophysique et Geophysique)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    4,
    'worker',
    180,
    3,
    60,
    30,
    0,
    'none',
    null,
    false
  )
on conflict (key) do update set
  version = excluded.version,
  label = excluded.label,
  family = excluded.family,
  criticality = excluded.criticality,
  freshness_basis = excluded.freshness_basis,
  cadence_minutes = excluded.cadence_minutes,
  warning_after_minutes = excluded.warning_after_minutes,
  stale_after_minutes = excluded.stale_after_minutes,
  max_fallback_age_minutes = excluded.max_fallback_age_minutes,
  expected_coverage = excluded.expected_coverage,
  parser_version = excluded.parser_version,
  dependency_keys = excluded.dependency_keys,
  licence = excluded.licence,
  attribution = excluded.attribution,
  owner = excluded.owner,
  runbook_url = excluded.runbook_url,
  enabled = excluded.enabled,
  schedule_enabled = excluded.schedule_enabled,
  schedule_offset_minutes = excluded.schedule_offset_minutes,
  execution_target = excluded.execution_target,
  lease_seconds = excluded.lease_seconds,
  max_attempts = excluded.max_attempts,
  retry_base_seconds = excluded.retry_base_seconds,
  retry_window_minutes = excluded.retry_window_minutes,
  overlap_minutes = excluded.overlap_minutes,
  replay_capability = excluded.replay_capability,
  replay_window_minutes = excluded.replay_window_minutes,
  is_reference = excluded.is_reference,
  updated_at = now();

insert into public.source_checkpoints (contract_key)
values
  ('imerg_rainfall'),
  ('hsaf_rainfall'),
  ('tariki_facebook'),
  ('craag_earthquakes')
on conflict (contract_key) do nothing;

-- 2. F18: Observed 30-min satellite rainfall table (ADR-0001 plain lat/lon, zero PostGIS,
-- strictly separate from Open-Meteo model weather_snapshots)
create table if not exists public.rainfall_observations (
  id uuid primary key default gen_random_uuid(),
  source_key text not null references public.source_contracts(key)
    check (source_key in ('imerg_rainfall', 'hsaf_rainfall')),
  observation_kind text not null default 'satellite_observed'
    check (observation_kind = 'satellite_observed'),
  is_model boolean not null default false
    check (is_model = false),
  valid_time timestamptz not null,
  published_time timestamptz not null,
  window_minutes integer not null default 30
    check (window_minutes = 30),
  grid_cell_key text not null,
  lat double precision not null check (lat between 18.0 and 38.5),
  lon double precision not null check (lon between -9.5 and 13.0),
  commune_id uuid references public.admin_units(id),
  wilaya_code text,
  commune_code text,
  rate_mm_h double precision not null check (rate_mm_h >= 0 and rate_mm_h <= 500),
  accum_mm_30m double precision not null check (accum_mm_30m >= 0 and accum_mm_30m <= 250),
  snapshot_id text,
  quality_state text not null default 'valid'
    check (quality_state in ('valid', 'degraded', 'flagged')),
  attribution text not null,
  ingested_at timestamptz not null default now(),
  unique (source_key, valid_time, grid_cell_key)
);

create index if not exists rainfall_observations_source_valid_idx
  on public.rainfall_observations (source_key, valid_time desc);

create index if not exists rainfall_observations_wilaya_valid_idx
  on public.rainfall_observations (wilaya_code, valid_time desc);

alter table public.rainfall_observations enable row level security;

revoke all on table public.rainfall_observations from public, anon, authenticated;
grant select on table public.rainfall_observations to anon, authenticated;
grant select, insert, update on table public.rainfall_observations to service_role;

drop policy if exists "public read rainfall observations" on public.rainfall_observations;
create policy "public read rainfall observations"
  on public.rainfall_observations
  for select
  using (true);

-- 3. F19: Extend public.text_sources.kind and register national tariki_facebook source
alter table public.text_sources
  drop constraint if exists text_sources_kind_check;

alter table public.text_sources
  add constraint text_sources_kind_check check (kind in ('telegram_public', 'facebook'));

insert into public.text_sources (
  key,
  label,
  kind,
  url,
  authority_tier,
  language,
  wilaya_id,
  template,
  enabled
)
values (
  'tariki_facebook',
  'Gendarmerie Nationale (Tariki)',
  'facebook',
  'https://www.facebook.com/tariki.GN',
  'national',
  'ar',
  null,
  null,
  true
)
on conflict (key) do update set
  label = excluded.label,
  kind = excluded.kind,
  url = excluded.url,
  authority_tier = excluded.authority_tier,
  language = excluded.language,
  wilaya_id = excluded.wilaya_id,
  template = excluded.template,
  enabled = excluded.enabled;

-- Defense-in-depth: Tariki can NEVER confirm fires even under direct RPC invocation.
create or replace function public.write_text_source(
  _key text,
  _operation text,
  _payload jsonb,
  _job uuid default null,
  _attempt integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _source uuid; _inserted boolean; _item jsonb; _result jsonb:='[]'; _doc public.source_documents;
  _mention public.incident_mentions; _existing public.incident_mentions;
  _incident public.official_incidents; _id uuid; _n integer; _total integer:=0; _asof timestamptz;
begin
  select id into strict _source from public.text_sources where key=_key and enabled;
  perform pg_advisory_xact_lock(hashtextextended(_key,531));
  if _job is not null then
    perform 1 from public.source_job_leases where contract_key=_key and job_id=_job and attempt=_attempt
      and lease_expires_at>clock_timestamp() for update;
    if not found then raise exception using errcode='55000',message='text_source_lease_lost'; end if;
  elsif _attempt is not null or exists(select 1 from public.source_job_leases where contract_key=_key and lease_expires_at>clock_timestamp()) then
    raise exception using errcode='55000',message='text_source_lease_required';
  end if;
  if _operation='documents' then
    for _item in select value from jsonb_array_elements(_payload) loop
      _doc:=jsonb_populate_record(null::public.source_documents,_item);
      if _doc.text_source_id is distinct from _source then raise exception 'text_source_mismatch'; end if;
      insert into public.source_documents(text_source_id,external_id,url,published_at,content_hash,body)
      values(_source,_doc.external_id,_doc.url,_doc.published_at,_doc.content_hash,_doc.body)
      on conflict(text_source_id,external_id) do nothing returning * into _doc;
      if found then _result:=_result||jsonb_build_array(to_jsonb(_doc)); end if;
    end loop;
  elsif _operation='mentions' then
    for _item in select value from jsonb_array_elements(_payload) loop
      _mention:=jsonb_populate_record(null::public.incident_mentions,_item);
      perform 1 from public.source_documents where id=_mention.document_id and text_source_id=_source for update;
      if not found or _mention.text_source_id is distinct from _source then raise exception 'text_source_mismatch'; end if;
      select * into _existing from public.incident_mentions where document_id=_mention.document_id
        and commune_id is not distinct from _mention.commune_id and wilaya_id=_mention.wilaya_id and kind=_mention.kind
        and (kind in ('vegetation','agricultural','urban','unknown') or place_text is not distinct from _mention.place_text) order by created_at,id limit 1;
      _inserted:=not found;
      if _inserted then
        insert into public.incident_mentions(document_id,text_source_id,wilaya_id,commune_id,place_text,kind,status,fire_count,as_of,precision,evidence,extractor)
        values(_mention.document_id,_source,_mention.wilaya_id,_mention.commune_id,_mention.place_text,_mention.kind,_mention.status,_mention.fire_count,_mention.as_of,_mention.precision,_mention.evidence,_mention.extractor)
        returning * into _existing;
      end if;
      _result:=_result||jsonb_build_array(to_jsonb(_existing)||jsonb_build_object('inserted',_inserted));
    end loop;
  elsif _operation='apply_mention' then
    select * into strict _mention from public.incident_mentions where id=(_payload->>'mentionId')::uuid and text_source_id=_source for update;
    if _mention.incident_id is not null then return jsonb_build_object('id',_mention.incident_id,'applied',false); end if;
    if _payload ? 'incidentId' then
      _id:=(_payload->>'incidentId')::uuid;
      select * into strict _incident from public.official_incidents where id=_id for update;
      if coalesce(_incident.commune_id,_incident.wilaya_id)<>coalesce(_mention.commune_id,_mention.wilaya_id) or _incident.kind<>_mention.kind then
        raise exception 'incident_area_mismatch';
      end if;
      if _mention.as_of<_incident.as_of then
        perform public.bump_official_incident(_id,jsonb_build_object(
          'first_reported_at',least(_incident.first_reported_at,_mention.as_of),
          'last_reported_at',greatest(_incident.last_reported_at,_mention.as_of)));
      else
        perform public.bump_official_incident(_id,_payload->'update');
      end if;
      update public.official_incidents set unlisted_at=null where id=_id and _mention.as_of>=unlisted_at;
    else
      _incident:=jsonb_populate_record(null::public.official_incidents,_payload->'insert');
      if _incident.latest_mention_id is distinct from _mention.id then raise exception 'incident_mention_mismatch'; end if;
      insert into public.official_incidents(wilaya_id,commune_id,kind,status,precision,authority_tier,place_text,first_reported_at,last_reported_at,as_of,latest_mention_id,evidence)
      values(_incident.wilaya_id,_incident.commune_id,_incident.kind,_incident.status,_incident.precision,_incident.authority_tier,_incident.place_text,_incident.first_reported_at,_incident.last_reported_at,_incident.as_of,_mention.id,_incident.evidence)
      returning id into _id;
    end if;
    update public.incident_mentions set incident_id=_id where id=_mention.id;
    return jsonb_build_object('id',_id,'applied',true);
  elsif _operation='failure' then
    perform 1 from public.source_documents where id=(_payload->>'documentId')::uuid and text_source_id=_source;
    if not found then raise exception 'text_source_mismatch'; end if;
    insert into public.document_extractions(document_id,attempts,last_error)
    values((_payload->>'documentId')::uuid,1,left(_payload->>'message',500))
    on conflict(document_id) do update set attempts=document_extractions.attempts+1,last_error=excluded.last_error,updated_at=clock_timestamp();
  elsif _operation='complete' then
    delete from public.document_extractions e using public.source_documents d
    where e.document_id=d.id and d.id=(_payload->>'documentId')::uuid and d.text_source_id=_source;
  elsif _operation='confirm' then
    if _key = 'tariki_facebook' then
      raise exception 'confirmation_source_not_allowed';
    end if;
    for _item in select value from jsonb_array_elements(_payload) loop
      select * into strict _mention from public.incident_mentions where id=(_item->>'mentionId')::uuid and text_source_id=_source;
      if _mention.commune_id is null or _mention.commune_id is distinct from (_item->>'communeId')::uuid then raise exception 'confirmation_area_mismatch'; end if;
      if _mention.kind not in ('vegetation','agricultural','urban','unknown') then raise exception 'confirmation_kind_mismatch'; end if;
      _asof:=(_item->>'asOf')::timestamptz;
      update public.fire_clusters set confirmed_at=_asof,confirmed_mention_id=_mention.id
      where commune_id=_mention.commune_id and confirmed_at is null and state<>'false_positive'
        and first_detected_at<=_asof+interval '24 hours' and last_detected_at>=_asof-interval '24 hours';
      get diagnostics _n=row_count; _total:=_total+_n;
    end loop;
    return to_jsonb(_total);
  elsif _operation='unlist' then
    update public.official_incidents set unlisted_at=(_payload->>'asOf')::timestamptz
    where id in(select value::uuid from jsonb_array_elements_text(_payload->'ids'))
      and last_reported_at<(_payload->>'asOf')::timestamptz and unlisted_at is null and kind in ('vegetation','agricultural','urban','unknown');
  elsif _operation='advice' then
    perform 1 from public.source_documents where id=(_payload->>'documentId')::uuid and text_source_id=_source;
    if not found then raise exception 'text_source_mismatch'; end if;
    insert into public.official_weather_advice(document_id,advice,wilaya_ids,valid_from,valid_to)
    values((_payload->>'documentId')::uuid,_payload->>'advice',
      array(select value::uuid from jsonb_array_elements_text(_payload->'wilayaIds')),
      (_payload->>'validFrom')::timestamptz,(_payload->>'validTo')::timestamptz)
    on conflict(document_id) do nothing;
  else raise exception 'unknown_text_source_operation';
  end if;
  return _result;
end;
$$;

revoke all on function public.write_text_source(text, text, jsonb, uuid, integer) from public, anon, authenticated;
grant execute on function public.write_text_source(text, text, jsonb, uuid, integer) to service_role;

-- 4. F20: Additive CRAAG official attribution columns & atomic RPC on public.earthquakes
alter table public.earthquakes
  add column if not exists craag_bulletin_id text,
  add column if not exists craag_magnitude numeric(3,1),
  add column if not exists craag_magnitude_type text,
  add column if not exists craag_depth_km double precision,
  add column if not exists craag_place text,
  add column if not exists craag_observed_at timestamptz,
  add column if not exists craag_source_url text,
  add column if not exists craag_matched_at timestamptz,
  add column if not exists craag_attribution text;

create unique index if not exists earthquakes_craag_bulletin_id_idx
  on public.earthquakes (craag_bulletin_id)
  where craag_bulletin_id is not null;

create or replace function public.apply_craag_earthquake_attribution(
  _bulletin_id text,
  _matched_earthquake_id text default null,
  _observed_at timestamptz default null,
  _lat double precision default null,
  _lon double precision default null,
  _depth_km double precision default null,
  _magnitude numeric(3,1) default null,
  _magnitude_type text default null,
  _place text default null,
  _source_url text default null,
  _attribution text default 'CRAAG (Centre de Recherche en Astronomie, Astrophysique et Geophysique)',
  _commune_id uuid default null,
  _offshore boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _existing_id text;
  _target_id text;
  _now timestamptz := clock_timestamp();
begin
  if _bulletin_id is null or btrim(_bulletin_id) = '' then
    raise exception 'craag_bulletin_id_required';
  end if;

  if _matched_earthquake_id is not null then
    perform 1 from public.earthquakes where id = _matched_earthquake_id for update;
    if not found then
      raise exception 'matched_earthquake_not_found';
    end if;

    select id into _existing_id
    from public.earthquakes
    where craag_bulletin_id = _bulletin_id
      and id <> _matched_earthquake_id
    for update;

    if _existing_id is not null then
      if _existing_id = 'craag:' || _bulletin_id then
        delete from public.earthquakes where id = _existing_id;
      else
        -- Bulletin is already attached to another EMSC event; update CRAAG metadata only on that row.
        update public.earthquakes
        set
          craag_magnitude = coalesce(_magnitude, craag_magnitude),
          craag_magnitude_type = coalesce(_magnitude_type, craag_magnitude_type),
          craag_depth_km = coalesce(_depth_km, craag_depth_km),
          craag_place = coalesce(_place, craag_place),
          craag_observed_at = coalesce(_observed_at, craag_observed_at),
          craag_source_url = coalesce(_source_url, craag_source_url),
          craag_attribution = coalesce(_attribution, craag_attribution),
          craag_matched_at = coalesce(craag_matched_at, _now)
        where id = _existing_id;

        return jsonb_build_object(
          'mode', 'matched',
          'earthquake_id', _existing_id,
          'bulletin_id', _bulletin_id
        );
      end if;
    end if;

    -- Attach CRAAG official attribution WITHOUT overwriting any EMSC instrumental columns.
    update public.earthquakes
    set
      craag_bulletin_id = _bulletin_id,
      craag_magnitude = _magnitude,
      craag_magnitude_type = _magnitude_type,
      craag_depth_km = _depth_km,
      craag_place = _place,
      craag_observed_at = _observed_at,
      craag_source_url = _source_url,
      craag_attribution = _attribution,
      craag_matched_at = coalesce(craag_matched_at, _now)
    where id = _matched_earthquake_id;

    return jsonb_build_object(
      'mode', 'matched',
      'earthquake_id', _matched_earthquake_id,
      'bulletin_id', _bulletin_id
    );
  end if;

  -- Unmatched CRAAG bulletin: if already attached to an EMSC row, keep that attachment intact.
  select id into _existing_id
  from public.earthquakes
  where craag_bulletin_id = _bulletin_id
  for update;

  if _existing_id is not null and _existing_id <> 'craag:' || _bulletin_id then
    update public.earthquakes
    set
      craag_magnitude = coalesce(_magnitude, craag_magnitude),
      craag_magnitude_type = coalesce(_magnitude_type, craag_magnitude_type),
      craag_depth_km = coalesce(_depth_km, craag_depth_km),
      craag_place = coalesce(_place, craag_place),
      craag_observed_at = coalesce(_observed_at, craag_observed_at),
      craag_source_url = coalesce(_source_url, craag_source_url),
      craag_attribution = coalesce(_attribution, craag_attribution),
      craag_matched_at = coalesce(craag_matched_at, _now)
    where id = _existing_id;

    return jsonb_build_object(
      'mode', 'matched',
      'earthquake_id', _existing_id,
      'bulletin_id', _bulletin_id
    );
  end if;

  if _observed_at is null or _lat is null or _lon is null or _magnitude is null then
    raise exception 'standalone_craag_fields_required';
  end if;

  _target_id := 'craag:' || _bulletin_id;

  insert into public.earthquakes (
    id,
    occurred_at,
    lat,
    lon,
    depth_km,
    magnitude,
    magnitude_type,
    region,
    network,
    commune_id,
    offshore,
    updated_at,
    fetched_at,
    craag_bulletin_id,
    craag_magnitude,
    craag_magnitude_type,
    craag_depth_km,
    craag_place,
    craag_observed_at,
    craag_source_url,
    craag_matched_at,
    craag_attribution
  )
  values (
    _target_id,
    _observed_at,
    _lat,
    _lon,
    _depth_km,
    _magnitude,
    _magnitude_type,
    _place,
    'CRAAG',
    _commune_id,
    coalesce(_offshore, false),
    _now,
    _now,
    _bulletin_id,
    _magnitude,
    _magnitude_type,
    _depth_km,
    _place,
    _observed_at,
    _source_url,
    _now,
    _attribution
  )
  on conflict (id) do update set
    occurred_at = excluded.occurred_at,
    lat = excluded.lat,
    lon = excluded.lon,
    depth_km = excluded.depth_km,
    magnitude = excluded.magnitude,
    magnitude_type = excluded.magnitude_type,
    region = excluded.region,
    commune_id = coalesce(excluded.commune_id, public.earthquakes.commune_id),
    offshore = excluded.offshore,
    updated_at = excluded.updated_at,
    craag_magnitude = excluded.craag_magnitude,
    craag_magnitude_type = excluded.craag_magnitude_type,
    craag_depth_km = excluded.craag_depth_km,
    craag_place = excluded.craag_place,
    craag_observed_at = excluded.craag_observed_at,
    craag_source_url = excluded.craag_source_url,
    craag_attribution = excluded.craag_attribution,
    craag_matched_at = coalesce(public.earthquakes.craag_matched_at, excluded.craag_matched_at);

  return jsonb_build_object(
    'mode', 'standalone',
    'earthquake_id', _target_id,
    'bulletin_id', _bulletin_id
  );
end;
$$;

revoke all on function public.apply_craag_earthquake_attribution(
  text, text, timestamptz, double precision, double precision, double precision,
  numeric, text, text, text, text, uuid, boolean
) from public, anon, authenticated;

grant execute on function public.apply_craag_earthquake_attribution(
  text, text, timestamptz, double precision, double precision, double precision,
  numeric, text, text, text, text, uuid, boolean
) to service_role;
