-- M4B: Post-worker scientific sources (MTG FCI Push, MTG Lightning L2, GWIS Burned Areas,
-- CLMS NDVI v3 / SWI v4, GHSL GHS-POP R2023A) and M6 New-Source Gate compliance
-- (ADR-0001 plain lat/lon + GeoJSON jsonb, ZERO PostGIS; ADR-0002 honesty & attribution).

-- 1. Register 5 versioned worker source contracts (zero em dashes in labels/attributions)
-- Note: existing `fci` and `emsc` contracts remain untouched on `execution_target = 'cloudflare'`.
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
    'mtg_fci_push',
    1,
    'EUMETSAT MTG FCI L2P FRP (push)',
    'fire_detection',
    'supporting',
    'upstream_published_at',
    5,
    15,
    30,
    60,
    '{"bbox":{"south":18.9,"north":37.6,"west":-8.7,"east":12.0},"product_level":"L2P_FRP","fallback_contract":"fci","target_latency_minutes":5}'::jsonb,
    'mtg-fci-push-v1',
    '{}',
    'EUMETSAT Data Policy (MTG FCI L2P FRP, attributed)',
    'EUMETSAT MTG FCI L2P FRP (push)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    1,
    'worker',
    180,
    3,
    30,
    30,
    10,
    'interval',
    1440,
    false
  ),
  (
    'mtg_lightning',
    1,
    'EUMETSAT MTG Lightning Imager L2',
    'hazard_observation',
    'supporting',
    'upstream_published_at',
    5,
    20,
    60,
    180,
    '{"bbox":{"south":18.0,"north":38.5,"west":-9.5,"east":13.0},"observation_kind":"lightning_observation","is_wildfire":false}'::jsonb,
    'mtg-li-l2-v1',
    '{}',
    'EUMETSAT Data Policy (MTG LI L2, Africa coverage, attributed)',
    'EUMETSAT MTG Lightning Imager L2 (lightning observation)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    2,
    'worker',
    180,
    3,
    30,
    30,
    10,
    'interval',
    360,
    false
  ),
  (
    'gwis_burned_areas',
    1,
    'Copernicus GWIS Burned Areas (NRT estimate)',
    'reference_enrichment',
    'optional',
    'upstream_published_at',
    360,
    720,
    1440,
    4320,
    '{"bbox":{"south":18.0,"north":38.5,"west":-9.5,"east":13.0},"estimation_basis":"firms_derived_estimate","is_official_confirmation":false,"is_optical_scar":false}'::jsonb,
    'gwis-ba-v1',
    '{}',
    'CC BY 4.0',
    'Copernicus EMS GWIS / JRC (FIRMS-derived burned area estimate, CC BY 4.0)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    25,
    'worker',
    300,
    3,
    60,
    120,
    60,
    'interval',
    10080,
    false
  ),
  (
    'clms_ndvi_swi',
    1,
    'Copernicus Land Monitoring NDVI v3 / SWI v4',
    'reference_enrichment',
    'optional',
    'upstream_published_at',
    1440,
    17280,
    28800,
    43200,
    '{"bbox":{"south":18.0,"north":38.5,"west":-9.5,"east":13.0},"products":["ndvi_v3_300m","swi_v4_1km"],"is_calibrated_fuel":false}'::jsonb,
    'clms-ndvi-swi-v1',
    '{}',
    'Copernicus Land Monitoring Service open licence (attributed)',
    'Copernicus Land Monitoring Service (Global NDVI v3 / SWI v4)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    true,
    45,
    'worker',
    600,
    3,
    120,
    240,
    0,
    'interval',
    43200,
    false
  ),
  (
    'ghsl_population',
    1,
    'European Commission JRC GHSL GHS-POP R2023A',
    'reference_enrichment',
    'optional',
    'published_at',
    43200,
    86400,
    129600,
    null,
    '{"bbox":{"south":18.0,"north":38.5,"west":-9.5,"east":13.0},"epochs":[2020,2025,2030],"exposure_label":"modeled_residents","population_conserving":true}'::jsonb,
    'ghsl-pop-r2023a-v1',
    '{}',
    'CC BY 4.0 (European Commission JRC GHSL, attributed)',
    'European Commission JRC GHSL GHS-POP R2023A (modeled residents)',
    'Nadhir maintainers',
    'docs/m6-new-source-gate.md',
    true,
    false,
    0,
    'worker',
    600,
    3,
    120,
    240,
    0,
    'none',
    null,
    true
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

insert into public.source_checkpoints (contract_key, fallback_contract_key)
values ('mtg_fci_push', 'fci')
on conflict (contract_key) do update set
  fallback_contract_key = excluded.fallback_contract_key,
  updated_at = now();

insert into public.source_checkpoints (contract_key)
values
  ('mtg_lightning'),
  ('gwis_burned_areas'),
  ('clms_ndvi_swi'),
  ('ghsl_population')
on conflict (contract_key) do nothing;

-- 2. Additive MTG FCI Push provenance on public.detections (detections_source_check untouched:
-- only 'firms', 'fci', 's3' remain valid; 'eumetsat_fci' stays rejected)
alter table public.detections
  add column if not exists intake_channel text
    check (intake_channel is null or intake_channel in ('wfs', 'push', 'api')),
  add column if not exists push_product_id text,
  add column if not exists push_received_at timestamptz;

-- Strictly service-role-only delivery audit table for MTG FCI push intake latency & fallback diagnostics
create table if not exists public.mtg_fci_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  source_key text not null default 'mtg_fci_push'
    references public.source_contracts(key)
    check (source_key = 'mtg_fci_push'),
  product_id text not null unique
    check (
      btrim(product_id) <> ''
      and position('0665' in product_id) = 0
      and upper(product_id) not like '%L1C%'
    ),
  slot_time timestamptz not null,
  published_at timestamptz not null,
  received_at timestamptz not null,
  latency_seconds integer not null check (latency_seconds >= 0),
  pixels_seen integer not null default 0 check (pixels_seen >= 0),
  pixels_stored integer not null default 0 check (pixels_stored >= 0),
  pixels_filtered integer not null default 0 check (pixels_filtered >= 0),
  fallback_contract_key text not null default 'fci'
    references public.source_contracts(key),
  quality_state text not null default 'valid'
    check (quality_state in ('valid', 'degraded', 'flagged')),
  attribution text not null,
  ingested_at timestamptz not null default now()
);

create index if not exists mtg_fci_push_deliveries_slot_idx
  on public.mtg_fci_push_deliveries (slot_time desc);

create index if not exists mtg_fci_push_deliveries_published_idx
  on public.mtg_fci_push_deliveries (published_at desc);

alter table public.mtg_fci_push_deliveries enable row level security;

revoke all on table public.mtg_fci_push_deliveries from public, anon, authenticated;
grant select, insert, update on table public.mtg_fci_push_deliveries to service_role;

create or replace function public.record_mtg_fci_push_delivery(
  _product_id text,
  _slot_time timestamptz,
  _published_at timestamptz,
  _received_at timestamptz,
  _latency_seconds integer,
  _pixels_seen integer default 0,
  _pixels_stored integer default 0,
  _pixels_filtered integer default 0,
  _fallback_contract_key text default 'fci',
  _quality_state text default 'valid',
  _attribution text default 'EUMETSAT MTG FCI L2P FRP (push)'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
begin
  if _product_id is null or btrim(_product_id) = '' then
    raise exception 'mtg_fci_push_product_id_required';
  end if;

  if position('0665' in _product_id) > 0 or upper(_product_id) like '%L1C%' then
    raise exception 'mtg_fci_push_l1c_product_rejected';
  end if;

  insert into public.mtg_fci_push_deliveries (
    source_key,
    product_id,
    slot_time,
    published_at,
    received_at,
    latency_seconds,
    pixels_seen,
    pixels_stored,
    pixels_filtered,
    fallback_contract_key,
    quality_state,
    attribution,
    ingested_at
  )
  values (
    'mtg_fci_push',
    btrim(_product_id),
    _slot_time,
    _published_at,
    _received_at,
    _latency_seconds,
    coalesce(_pixels_seen, 0),
    coalesce(_pixels_stored, 0),
    coalesce(_pixels_filtered, 0),
    coalesce(_fallback_contract_key, 'fci'),
    coalesce(_quality_state, 'valid'),
    coalesce(_attribution, 'EUMETSAT MTG FCI L2P FRP (push)'),
    clock_timestamp()
  )
  on conflict (product_id) do update set
    slot_time = excluded.slot_time,
    published_at = excluded.published_at,
    received_at = excluded.received_at,
    latency_seconds = excluded.latency_seconds,
    pixels_seen = excluded.pixels_seen,
    pixels_stored = excluded.pixels_stored,
    pixels_filtered = excluded.pixels_filtered,
    fallback_contract_key = excluded.fallback_contract_key,
    quality_state = excluded.quality_state,
    attribution = excluded.attribution,
    ingested_at = excluded.ingested_at
  returning id into _id;

  return jsonb_build_object(
    'id', _id,
    'product_id', btrim(_product_id),
    'slot_time', _slot_time,
    'latency_seconds', _latency_seconds
  );
end;
$$;

revoke all on function public.record_mtg_fci_push_delivery(
  text, timestamptz, timestamptz, timestamptz, integer, integer, integer, integer, text, text, text
) from public, anon, authenticated;

grant execute on function public.record_mtg_fci_push_delivery(
  text, timestamptz, timestamptz, timestamptz, integer, integer, integer, integer, text, text, text
) to service_role;

-- 3. Public-read scientific table 1: MTG Lightning Imager L2 observations
create table if not exists public.lightning_observations (
  id uuid primary key default gen_random_uuid(),
  source_key text not null default 'mtg_lightning'
    references public.source_contracts(key)
    check (source_key = 'mtg_lightning'),
  observation_kind text not null default 'lightning_observation'
    check (observation_kind = 'lightning_observation'),
  is_wildfire boolean not null default false
    check (is_wildfire = false),
  product_type text not null
    check (product_type in ('L2-LFL', 'L2-LGR', 'L2-AF')),
  flash_id text not null,
  observed_at timestamptz not null,
  published_at timestamptz not null,
  lat double precision not null check (lat between 18.0 and 38.5),
  lon double precision not null check (lon between -9.5 and 13.0),
  commune_id uuid references public.admin_units(id),
  wilaya_code text,
  commune_code text,
  radiance_uj_m2 double precision check (radiance_uj_m2 is null or radiance_uj_m2 >= 0),
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  group_count integer check (group_count is null or group_count >= 0),
  quality_state text not null default 'valid'
    check (quality_state in ('valid', 'degraded', 'flagged')),
  attribution text not null,
  ingested_at timestamptz not null default now(),
  unique (source_key, observed_at, flash_id)
);

create index if not exists lightning_observations_observed_idx
  on public.lightning_observations (observed_at desc);

create index if not exists lightning_observations_wilaya_observed_idx
  on public.lightning_observations (wilaya_code, observed_at desc);

alter table public.lightning_observations enable row level security;

revoke all on table public.lightning_observations from public, anon, authenticated;
grant select on table public.lightning_observations to anon, authenticated;
grant select, insert, update on table public.lightning_observations to service_role;

drop policy if exists "public read lightning observations" on public.lightning_observations;
create policy "public read lightning observations"
  on public.lightning_observations
  for select
  using (true);

-- 4. Public-read scientific table 2: GWIS Burned Areas (FIRMS-derived estimates, plain lat/lon + GeoJSON)
create table if not exists public.gwis_burned_areas (
  id uuid primary key default gen_random_uuid(),
  source_key text not null default 'gwis_burned_areas'
    references public.source_contracts(key)
    check (source_key = 'gwis_burned_areas'),
  event_id text not null,
  product_layer text not null default 'nrt.ba'
    check (product_layer in ('nrt.ba', 'globfire', 'mcd64a1')),
  estimation_basis text not null default 'firms_derived_estimate'
    check (estimation_basis = 'firms_derived_estimate'),
  is_official_confirmation boolean not null default false
    check (is_official_confirmation = false),
  is_optical_scar boolean not null default false
    check (is_optical_scar = false),
  licence text not null default 'CC BY 4.0'
    check (licence = 'CC BY 4.0'),
  burn_start_at date not null,
  burn_end_at date not null,
  check (burn_end_at >= burn_start_at),
  published_at timestamptz not null,
  area_ha double precision not null check (area_ha > 0 and area_ha <= 1000000),
  lat double precision not null check (lat between 18.0 and 38.5),
  lon double precision not null check (lon between -9.5 and 13.0),
  perimeter_geojson jsonb not null
    check (
      jsonb_typeof(perimeter_geojson) = 'object'
      and perimeter_geojson->>'type' in ('Polygon', 'MultiPolygon')
      and jsonb_typeof(perimeter_geojson->'coordinates') = 'array'
    ),
  commune_id uuid references public.admin_units(id),
  wilaya_code text,
  commune_code text,
  attribution text not null,
  ingested_at timestamptz not null default now(),
  unique (source_key, event_id, burn_end_at)
);

create index if not exists gwis_burned_areas_burn_end_idx
  on public.gwis_burned_areas (burn_end_at desc);

create index if not exists gwis_burned_areas_wilaya_burn_end_idx
  on public.gwis_burned_areas (wilaya_code, burn_end_at desc);

alter table public.gwis_burned_areas enable row level security;

revoke all on table public.gwis_burned_areas from public, anon, authenticated;
grant select on table public.gwis_burned_areas to anon, authenticated;
grant select, insert, update on table public.gwis_burned_areas to service_role;

drop policy if exists "public read gwis burned areas" on public.gwis_burned_areas;
create policy "public read gwis burned areas"
  on public.gwis_burned_areas
  for select
  using (true);

-- 5. Public-read scientific table 3: CLMS Global NDVI v3 / SWI v4 land indices
create table if not exists public.clms_land_indices (
  id uuid primary key default gen_random_uuid(),
  source_key text not null default 'clms_ndvi_swi'
    references public.source_contracts(key)
    check (source_key = 'clms_ndvi_swi'),
  product_version text not null
    check (product_version in ('ndvi_v3_300m', 'swi_v4_1km')),
  is_calibrated_fuel boolean not null default false
    check (is_calibrated_fuel = false),
  observed_at date not null,
  published_at timestamptz not null,
  commune_id uuid references public.admin_units(id),
  commune_code text not null,
  wilaya_code text not null,
  lat double precision not null check (lat between 18.0 and 38.5),
  lon double precision not null check (lon between -9.5 and 13.0),
  ndvi_value double precision check (ndvi_value is null or (ndvi_value >= -1.0 and ndvi_value <= 1.0)),
  swi_value double precision check (swi_value is null or (swi_value >= 0.0 and swi_value <= 100.0)),
  check (ndvi_value is not null or swi_value is not null),
  quality_state text not null default 'valid'
    check (quality_state in ('valid', 'degraded', 'flagged')),
  qa_pixel_fraction double precision check (qa_pixel_fraction is null or (qa_pixel_fraction >= 0.0 and qa_pixel_fraction <= 1.0)),
  attribution text not null,
  ingested_at timestamptz not null default now(),
  unique (source_key, product_version, observed_at, commune_code)
);

create index if not exists clms_land_indices_product_observed_idx
  on public.clms_land_indices (product_version, observed_at desc);

create index if not exists clms_land_indices_wilaya_observed_idx
  on public.clms_land_indices (wilaya_code, observed_at desc);

alter table public.clms_land_indices enable row level security;

revoke all on table public.clms_land_indices from public, anon, authenticated;
grant select on table public.clms_land_indices to anon, authenticated;
grant select, insert, update on table public.clms_land_indices to service_role;

drop policy if exists "public read clms land indices" on public.clms_land_indices;
create policy "public read clms land indices"
  on public.clms_land_indices
  for select
  using (true);

-- 6. Public-read scientific table 4: GHSL GHS-POP R2023A population-conserving modeled exposure
create table if not exists public.ghsl_exposure (
  id uuid primary key default gen_random_uuid(),
  source_key text not null default 'ghsl_population'
    references public.source_contracts(key)
    check (source_key = 'ghsl_population'),
  epoch_year integer not null check (epoch_year in (2020, 2025, 2030)),
  dataset_release text not null default 'GHS-POP-R2023A',
  crs_code text not null check (crs_code in ('EPSG:4326', 'ESRI:54009')),
  resolution_m integer not null check (resolution_m in (100, 1000)),
  exposure_label text not null default 'modeled_residents'
    check (exposure_label = 'modeled_residents'),
  commune_id uuid references public.admin_units(id),
  commune_code text not null,
  wilaya_code text not null,
  lat double precision not null check (lat between 18.0 and 38.5),
  lon double precision not null check (lon between -9.5 and 13.0),
  modeled_residents double precision not null check (modeled_residents >= 0),
  source_cell_sum double precision not null check (source_cell_sum >= 0),
  source_cell_count integer not null check (source_cell_count >= 0),
  conservation_delta double precision not null
    check (
      abs(conservation_delta) <= greatest(1.0, source_cell_sum * 0.005)
      and abs(modeled_residents - source_cell_sum) <= greatest(1.0, source_cell_sum * 0.005)
      and abs(conservation_delta - (modeled_residents - source_cell_sum)) <= 0.02
    ),
  published_at timestamptz not null,
  attribution text not null,
  ingested_at timestamptz not null default now(),
  unique (source_key, epoch_year, resolution_m, commune_code)
);

create index if not exists ghsl_exposure_wilaya_epoch_idx
  on public.ghsl_exposure (wilaya_code, epoch_year desc);

create index if not exists ghsl_exposure_commune_epoch_idx
  on public.ghsl_exposure (commune_code, epoch_year desc);

alter table public.ghsl_exposure enable row level security;

revoke all on table public.ghsl_exposure from public, anon, authenticated;
grant select on table public.ghsl_exposure to anon, authenticated;
grant select, insert, update on table public.ghsl_exposure to service_role;

drop policy if exists "public read ghsl exposure" on public.ghsl_exposure;
create policy "public read ghsl exposure"
  on public.ghsl_exposure
  for select
  using (true);
