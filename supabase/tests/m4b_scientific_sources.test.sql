begin;
set local search_path = public, extensions;
select plan(58);

-- 1. Five M4B source_contracts registered on execution_target = 'worker' with zero em dashes
select is(
  (select count(*)::integer from source_contracts
   where key in ('mtg_fci_push', 'mtg_lightning', 'gwis_burned_areas', 'clms_ndvi_swi', 'ghsl_population')
     and execution_target = 'worker'
     and runbook_url = 'docs/m6-new-source-gate.md'
     and owner = 'Nadhir maintainers'
     and enabled = true),
  5,
  'all 5 M4B source contracts exist on execution_target = worker with M6 runbook'
);

select is(
  (select count(*)::integer from source_contracts
   where key in ('mtg_fci_push', 'mtg_lightning', 'gwis_burned_areas', 'clms_ndvi_swi', 'ghsl_population')
     and (label like '%' || chr(8212) || '%' or attribution like '%' || chr(8212) || '%' or licence like '%' || chr(8212) || '%')),
  0,
  'M4B source contract labels, licences, and attributions contain zero em dashes'
);

select ok(
  (select execution_target = 'cloudflare' and enabled from source_contracts where key = 'fci'),
  'existing fci WFS contract remains untouched on execution_target = cloudflare'
);

select ok(
  (select execution_target = 'cloudflare' and enabled from source_contracts where key = 'emsc'),
  'existing emsc contract remains untouched on execution_target = cloudflare'
);

select is(
  (select count(*)::integer from source_checkpoints
   where contract_key in ('mtg_fci_push', 'mtg_lightning', 'gwis_burned_areas', 'clms_ndvi_swi', 'ghsl_population')),
  5,
  'all 5 M4B source checkpoints exist'
);

select is(
  (select fallback_contract_key from source_checkpoints where contract_key = 'mtg_fci_push'),
  'fci',
  'mtg_fci_push checkpoint declares fci as fallback_contract_key'
);

select ok(
  (select family = 'fire_detection' and criticality = 'supporting' and freshness_basis = 'upstream_published_at'
     and cadence_minutes = 5 and warning_after_minutes = 15 and stale_after_minutes = 30
     and max_fallback_age_minutes = 60 and replay_capability = 'interval' and replay_window_minutes = 1440
     and schedule_enabled = true and is_reference = false
   from source_contracts where key = 'mtg_fci_push'),
  'mtg_fci_push contract matches M6-1 cadence and replay metadata'
);

select ok(
  (select family = 'reference_enrichment' and criticality = 'optional' and freshness_basis = 'published_at'
     and cadence_minutes = 43200 and warning_after_minutes = 86400 and stale_after_minutes = 129600
     and max_fallback_age_minutes is null and replay_capability = 'none' and replay_window_minutes is null
     and schedule_enabled = false and is_reference = true
   from source_contracts where key = 'ghsl_population'),
  'ghsl_population contract is marked is_reference = true and schedule_enabled = false'
);

-- 2. Detections push provenance columns & detections_source_check preservation
select lives_ok(
  $$insert into detections (
    source, sensor, detected_at, lat, lon, confidence_raw, frp_mw, daynight,
    natural_key, intake_channel, push_product_id, push_received_at
  ) values (
    'fci', 'FCI', '2026-11-24T12:00:00Z', 36.71234, 4.05123, 0.88, 42.5, 'D',
    'fci:FCI:36.71234:4.05123:2026-11-24T12:00:00Z', 'push',
    'EO:EUM:DAT:0662:MTG-I1-FCI-L2P-FRP-202611241200', '2026-11-24T12:03:10Z'
  )$$,
  'detections accepts push provenance columns under source = fci'
);

select throws_ok(
  $$insert into detections (
    source, sensor, detected_at, lat, lon, confidence_raw, natural_key, intake_channel
  ) values (
    'eumetsat_fci', 'FCI', '2026-11-24T12:10:00Z', 36.71, 4.05, 0.8,
    'eumetsat_fci:test:1', 'push'
  )$$,
  '23514',
  null,
  'detections continues to reject PR #31 source = eumetsat_fci (23514)'
);

select throws_ok(
  $$insert into detections (
    source, sensor, detected_at, lat, lon, confidence_raw, natural_key, intake_channel
  ) values (
    'fci', 'FCI', '2026-11-24T12:10:00Z', 36.71, 4.05, 0.8,
    'fci:FCI:36.71000:4.05000:2026-11-24T12:10:00Z', 'unknown_channel'
  )$$,
  '23514',
  null,
  'detections rejects invalid intake_channel (23514)'
);

-- 3. mtg_fci_push_deliveries audit table & record_mtg_fci_push_delivery RPC security
select is(
  (public.record_mtg_fci_push_delivery(
    _product_id => 'EO:EUM:DAT:0662:202611241200',
    _slot_time => '2026-11-24T12:00:00Z',
    _published_at => '2026-11-24T12:02:40Z',
    _received_at => '2026-11-24T12:03:10Z',
    _latency_seconds => 190,
    _pixels_seen => 5,
    _pixels_stored => 2,
    _pixels_filtered => 3
  ))->>'product_id',
  'EO:EUM:DAT:0662:202611241200',
  'record_mtg_fci_push_delivery inserts push audit row'
);

select lives_ok(
  $$select public.record_mtg_fci_push_delivery(
    _product_id => 'EO:EUM:DAT:0662:202611241200',
    _slot_time => '2026-11-24T12:00:00Z',
    _published_at => '2026-11-24T12:02:40Z',
    _received_at => '2026-11-24T12:03:15Z',
    _latency_seconds => 195,
    _pixels_seen => 5,
    _pixels_stored => 2,
    _pixels_filtered => 3
  )$$,
  'record_mtg_fci_push_delivery is idempotent on duplicate product_id'
);

select is(
  (select count(*)::integer from mtg_fci_push_deliveries where product_id = 'EO:EUM:DAT:0662:202611241200'),
  1,
  'idempotent replay of record_mtg_fci_push_delivery leaves exactly one row'
);

select throws_ok(
  $$select public.record_mtg_fci_push_delivery(
    _product_id => 'EO:EUM:DAT:0665:L1c',
    _slot_time => '2026-11-24T12:00:00Z',
    _published_at => '2026-11-24T12:02:40Z',
    _received_at => '2026-11-24T12:03:10Z',
    _latency_seconds => 190
  )$$,
  'P0001',
  'mtg_fci_push_l1c_product_rejected',
  'record_mtg_fci_push_delivery rejects PR #31 L1c EO:EUM:DAT:0665 product'
);

select throws_ok(
  $$insert into mtg_fci_push_deliveries (
    product_id, slot_time, published_at, received_at, latency_seconds, attribution
  ) values (
    'EO:EUM:DAT:0662:neg', '2026-11-24T12:00:00Z', '2026-11-24T12:02:40Z',
    '2026-11-24T12:03:10Z', -5, 'EUMETSAT'
  )$$,
  '23514',
  null,
  'mtg_fci_push_deliveries rejects negative latency_seconds (23514)'
);

set local role service_role;
select throws_ok(
  $$insert into mtg_fci_push_deliveries (
    product_id, slot_time, published_at, received_at, latency_seconds, attribution
  ) values (
    'EO:EUM:DAT:0665:direct', '2026-11-24T12:00:00Z', '2026-11-24T12:02:40Z',
    '2026-11-24T12:03:10Z', 100, 'EUMETSAT'
  )$$,
  '23514',
  null,
  'mtg_fci_push_deliveries table CHECK rejects direct service_role insert of EO:EUM:DAT:0665 (23514)'
);

select throws_ok(
  $$insert into mtg_fci_push_deliveries (
    product_id, slot_time, published_at, received_at, latency_seconds, attribution
  ) values (
    'MTG-I1-FCI-L1C-DIRECT', '2026-11-24T12:00:00Z', '2026-11-24T12:02:40Z',
    '2026-11-24T12:03:10Z', 100, 'EUMETSAT'
  )$$,
  '23514',
  null,
  'mtg_fci_push_deliveries table CHECK rejects direct service_role insert of L1C product (23514)'
);
reset role;

select ok(
  (select prosecdef and ('search_path=""' = any(proconfig) or 'search_path=' = any(proconfig))
   from pg_proc
   where pronamespace = 'public'::regnamespace
     and proname = 'record_mtg_fci_push_delivery'),
  'record_mtg_fci_push_delivery is SECURITY DEFINER with search_path = empty'
);

select is(
  has_function_privilege(
    'public',
    'public.record_mtg_fci_push_delivery(text, timestamptz, timestamptz, timestamptz, integer, integer, integer, integer, text, text, text)',
    'execute'
  ),
  false,
  'public cannot execute record_mtg_fci_push_delivery'
);
select is(
  has_function_privilege(
    'anon',
    'public.record_mtg_fci_push_delivery(text, timestamptz, timestamptz, timestamptz, integer, integer, integer, integer, text, text, text)',
    'execute'
  ),
  false,
  'anon cannot execute record_mtg_fci_push_delivery'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.record_mtg_fci_push_delivery(text, timestamptz, timestamptz, timestamptz, integer, integer, integer, integer, text, text, text)',
    'execute'
  ),
  false,
  'authenticated cannot execute record_mtg_fci_push_delivery'
);
select is(
  has_function_privilege(
    'service_role',
    'public.record_mtg_fci_push_delivery(text, timestamptz, timestamptz, timestamptz, integer, integer, integer, integer, text, text, text)',
    'execute'
  ),
  true,
  'service_role can execute record_mtg_fci_push_delivery'
);

set local role anon;
select throws_ok(
  $$select count(*) from mtg_fci_push_deliveries$$,
  '42501',
  null,
  'anon cannot read mtg_fci_push_deliveries (service_role only)'
);
select throws_ok(
  $$insert into mtg_fci_push_deliveries (
    product_id, slot_time, published_at, received_at, latency_seconds, attribution
  ) values ('forged', now(), now(), now(), 10, 'forged')$$,
  '42501',
  null,
  'anon cannot write mtg_fci_push_deliveries'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select count(*) from mtg_fci_push_deliveries$$,
  '42501',
  null,
  'authenticated cannot read mtg_fci_push_deliveries (service_role only)'
);
select throws_ok(
  $$select public.record_mtg_fci_push_delivery('forged', now(), now(), now(), 10)$$,
  '42501',
  null,
  'authenticated cannot execute record_mtg_fci_push_delivery'
);
reset role;

-- 4. lightning_observations constraints, idempotency, and RLS
insert into lightning_observations (
  product_type, flash_id, observed_at, published_at, lat, lon,
  wilaya_code, commune_code, radiance_uj_m2, duration_ms, group_count, attribution
) values (
  'L2-LFL', 'li-flash-001', '2026-11-24T14:02:11Z', '2026-11-24T14:04:00Z',
  36.45, 4.12, '15', '1501', 124.5, 42, 3,
  'EUMETSAT MTG Lightning Imager L2 (lightning observation)'
);

select throws_ok(
  $$insert into lightning_observations (
    product_type, flash_id, observed_at, published_at, lat, lon, attribution
  ) values (
    'L2-LFL', 'li-flash-001', '2026-11-24T14:02:11Z', '2026-11-24T14:04:00Z',
    36.45, 4.12, 'EUMETSAT'
  )$$,
  '23505',
  null,
  'lightning_observations enforces unique (source_key, observed_at, flash_id)'
);

select throws_ok(
  $$insert into lightning_observations (
    is_wildfire, product_type, flash_id, observed_at, published_at, lat, lon, attribution
  ) values (
    true, 'L2-LFL', 'li-flash-002', '2026-11-24T14:03:00Z', '2026-11-24T14:04:00Z',
    36.45, 4.12, 'EUMETSAT'
  )$$,
  '23514',
  null,
  'lightning_observations rejects is_wildfire = true (23514)'
);

select throws_ok(
  $$insert into lightning_observations (
    observation_kind, product_type, flash_id, observed_at, published_at, lat, lon, attribution
  ) values (
    'wildfire_ignition', 'L2-LFL', 'li-flash-003', '2026-11-24T14:03:00Z', '2026-11-24T14:04:00Z',
    36.45, 4.12, 'EUMETSAT'
  )$$,
  '23514',
  null,
  'lightning_observations rejects non-lightning observation_kind (23514)'
);

select throws_ok(
  $$insert into lightning_observations (
    product_type, flash_id, observed_at, published_at, lat, lon, attribution
  ) values (
    'L2-LFL', 'li-flash-004', '2026-11-24T14:03:00Z', '2026-11-24T14:04:00Z',
    45.0, 4.12, 'EUMETSAT'
  )$$,
  '23514',
  null,
  'lightning_observations rejects out-of-Algeria latitude (23514)'
);

set local role anon;
select is(
  (select flash_id from lightning_observations where flash_id = 'li-flash-001'),
  'li-flash-001',
  'anon can read lightning_observations'
);
select throws_ok(
  $$insert into lightning_observations (
    product_type, flash_id, observed_at, published_at, lat, lon, attribution
  ) values ('L2-LFL', 'forged', now(), now(), 36.0, 3.0, 'forged')$$,
  '42501',
  null,
  'anon cannot insert into lightning_observations'
);
reset role;

set local role authenticated;
select throws_ok(
  $$delete from lightning_observations where flash_id = 'li-flash-001'$$,
  '42501',
  null,
  'authenticated cannot delete from lightning_observations'
);
reset role;

-- 5. gwis_burned_areas constraints, idempotency, and RLS
insert into gwis_burned_areas (
  event_id, product_layer, burn_start_at, burn_end_at, published_at,
  area_ha, lat, lon, perimeter_geojson, wilaya_code, commune_code, attribution
) values (
  'gwis-2026-001', 'nrt.ba', '2026-08-14', '2026-08-16', '2026-08-16T18:00:00Z',
  148.5, 36.68, 4.72,
  '{"type":"Polygon","coordinates":[[[4.70,36.67],[4.74,36.67],[4.74,36.69],[4.70,36.69],[4.70,36.67]]]}'::jsonb,
  '06', '0601',
  'Copernicus EMS GWIS / JRC (FIRMS-derived burned area estimate, CC BY 4.0)'
);

select throws_ok(
  $$insert into gwis_burned_areas (
    event_id, product_layer, burn_start_at, burn_end_at, published_at,
    area_ha, lat, lon, perimeter_geojson, attribution
  ) values (
    'gwis-2026-001', 'nrt.ba', '2026-08-14', '2026-08-16', '2026-08-16T18:00:00Z',
    148.5, 36.68, 4.72,
    '{"type":"Polygon","coordinates":[[[4.70,36.67],[4.74,36.67],[4.74,36.69],[4.70,36.69],[4.70,36.67]]]}'::jsonb,
    'GWIS'
  )$$,
  '23505',
  null,
  'gwis_burned_areas enforces unique (source_key, event_id, burn_end_at)'
);

select throws_ok(
  $$insert into gwis_burned_areas (
    event_id, is_official_confirmation, burn_start_at, burn_end_at, published_at,
    area_ha, lat, lon, perimeter_geojson, attribution
  ) values (
    'gwis-2026-002', true, '2026-08-14', '2026-08-16', '2026-08-16T18:00:00Z',
    10.0, 36.68, 4.72,
    '{"type":"Polygon","coordinates":[[[4.70,36.67],[4.74,36.67],[4.74,36.69],[4.70,36.67]]]}'::jsonb,
    'GWIS'
  )$$,
  '23514',
  null,
  'gwis_burned_areas rejects is_official_confirmation = true (23514)'
);

select throws_ok(
  $$insert into gwis_burned_areas (
    event_id, is_optical_scar, burn_start_at, burn_end_at, published_at,
    area_ha, lat, lon, perimeter_geojson, attribution
  ) values (
    'gwis-2026-003', true, '2026-08-14', '2026-08-16', '2026-08-16T18:00:00Z',
    10.0, 36.68, 4.72,
    '{"type":"Polygon","coordinates":[[[4.70,36.67],[4.74,36.67],[4.74,36.69],[4.70,36.67]]]}'::jsonb,
    'GWIS'
  )$$,
  '23514',
  null,
  'gwis_burned_areas rejects is_optical_scar = true (23514)'
);

select throws_ok(
  $$insert into gwis_burned_areas (
    event_id, burn_start_at, burn_end_at, published_at,
    area_ha, lat, lon, perimeter_geojson, attribution
  ) values (
    'gwis-2026-004', '2026-08-14', '2026-08-16', '2026-08-16T18:00:00Z',
    10.0, 36.68, 4.72,
    '{"type":"Point","coordinates":[4.72,36.68]}'::jsonb,
    'GWIS'
  )$$,
  '23514',
  null,
  'gwis_burned_areas rejects Point burn-circle geometry (23514)'
);

select throws_ok(
  $$insert into gwis_burned_areas (
    event_id, burn_start_at, burn_end_at, published_at,
    area_ha, lat, lon, perimeter_geojson, attribution
  ) values (
    'gwis-2026-005', '2026-08-17', '2026-08-16', '2026-08-16T18:00:00Z',
    10.0, 36.68, 4.72,
    '{"type":"Polygon","coordinates":[[[4.70,36.67],[4.74,36.67],[4.74,36.69],[4.70,36.67]]]}'::jsonb,
    'GWIS'
  )$$,
  '23514',
  null,
  'gwis_burned_areas rejects burn_end_at < burn_start_at (23514)'
);

set local role anon;
select is(
  (select event_id from gwis_burned_areas where event_id = 'gwis-2026-001'),
  'gwis-2026-001',
  'anon can read gwis_burned_areas'
);
select throws_ok(
  $$update gwis_burned_areas set area_ha = 1 where event_id = 'gwis-2026-001'$$,
  '42501',
  null,
  'anon cannot update gwis_burned_areas'
);
reset role;

-- 6. clms_land_indices constraints, idempotency, and RLS
insert into clms_land_indices (
  product_version, observed_at, published_at, commune_code, wilaya_code,
  lat, lon, ndvi_value, swi_value, qa_pixel_fraction, attribution
) values (
  'ndvi_v3_300m', '2026-11-11', '2026-11-14T06:00:00Z', '1501', '15',
  36.71, 4.05, 0.42, null, 0.94,
  'Copernicus Land Monitoring Service (Global NDVI v3 / SWI v4)'
);

select throws_ok(
  $$insert into clms_land_indices (
    product_version, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, ndvi_value, attribution
  ) values (
    'ndvi_v3_300m', '2026-11-11', '2026-11-14T06:00:00Z', '1501', '15',
    36.71, 4.05, 0.50, 'CLMS'
  )$$,
  '23505',
  null,
  'clms_land_indices enforces unique (source_key, product_version, observed_at, commune_code)'
);

select throws_ok(
  $$insert into clms_land_indices (
    product_version, is_calibrated_fuel, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, ndvi_value, attribution
  ) values (
    'ndvi_v3_300m', true, '2026-11-21', '2026-11-24T06:00:00Z', '1501', '15',
    36.71, 4.05, 0.42, 'CLMS'
  )$$,
  '23514',
  null,
  'clms_land_indices rejects is_calibrated_fuel = true (23514)'
);

select throws_ok(
  $$insert into clms_land_indices (
    product_version, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, ndvi_value, swi_value, attribution
  ) values (
    'ndvi_v3_300m', '2026-11-21', '2026-11-24T06:00:00Z', '1501', '15',
    36.71, 4.05, null, null, 'CLMS'
  )$$,
  '23514',
  null,
  'clms_land_indices requires at least one of ndvi_value or swi_value (23514)'
);

select throws_ok(
  $$insert into clms_land_indices (
    product_version, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, ndvi_value, attribution
  ) values (
    'ndvi_v3_300m', '2026-11-21', '2026-11-24T06:00:00Z', '1501', '15',
    36.71, 4.05, 1.45, 'CLMS'
  )$$,
  '23514',
  null,
  'clms_land_indices rejects ndvi_value > 1.0 (23514)'
);

select throws_ok(
  $$insert into clms_land_indices (
    product_version, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, swi_value, attribution
  ) values (
    'swi_v4_1km', '2026-11-21', '2026-11-24T06:00:00Z', '1501', '15',
    36.71, 4.05, 115.0, 'CLMS'
  )$$,
  '23514',
  null,
  'clms_land_indices rejects swi_value > 100.0 (23514)'
);

set local role authenticated;
select is(
  (select ndvi_value from clms_land_indices where commune_code = '1501' and observed_at = '2026-11-11'),
  0.42::double precision,
  'authenticated can read clms_land_indices'
);
select throws_ok(
  $$insert into clms_land_indices (
    product_version, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, swi_value, attribution
  ) values ('swi_v4_1km', '2026-11-21', now(), '1601', '16', 36.75, 3.05, 45.0, 'forged')$$,
  '42501',
  null,
  'authenticated cannot insert into clms_land_indices'
);
reset role;

-- 7. ghsl_exposure constraints, conservation check, idempotency, and RLS
insert into ghsl_exposure (
  epoch_year, dataset_release, crs_code, resolution_m, commune_code, wilaya_code,
  lat, lon, modeled_residents, source_cell_sum, source_cell_count, conservation_delta,
  published_at, attribution
) values (
  2025, 'GHS-POP-R2023A', 'EPSG:4326', 100, '1601', '16',
  36.75, 3.05, 125400.0, 125400.0, 420, 0.0,
  '2025-01-15T00:00:00Z',
  'European Commission JRC GHSL GHS-POP R2023A (modeled residents)'
);

select throws_ok(
  $$insert into ghsl_exposure (
    epoch_year, crs_code, resolution_m, commune_code, wilaya_code,
    lat, lon, modeled_residents, source_cell_sum, source_cell_count, conservation_delta,
    published_at, attribution
  ) values (
    2025, 'EPSG:4326', 100, '1601', '16',
    36.75, 3.05, 125400.0, 125400.0, 420, 0.0, '2025-01-15T00:00:00Z', 'GHSL'
  )$$,
  '23505',
  null,
  'ghsl_exposure enforces unique (source_key, epoch_year, resolution_m, commune_code)'
);

select throws_ok(
  $$insert into ghsl_exposure (
    epoch_year, crs_code, resolution_m, exposure_label, commune_code, wilaya_code,
    lat, lon, modeled_residents, source_cell_sum, source_cell_count, conservation_delta,
    published_at, attribution
  ) values (
    2025, 'EPSG:4326', 100, 'people_threatened', '1602', '16',
    36.75, 3.05, 1000.0, 1000.0, 10, 0.0, '2025-01-15T00:00:00Z', 'GHSL'
  )$$,
  '23514',
  null,
  'ghsl_exposure rejects banned exposure_label people_threatened (23514)'
);

select throws_ok(
  $$insert into ghsl_exposure (
    epoch_year, crs_code, resolution_m, commune_code, wilaya_code,
    lat, lon, modeled_residents, source_cell_sum, source_cell_count, conservation_delta,
    published_at, attribution
  ) values (
    2025, 'EPSG:4326', 100, '1603', '16',
    36.75, 3.05, 12000.0, 10000.0, 50, 2000.0, '2025-01-15T00:00:00Z', 'GHSL'
  )$$,
  '23514',
  null,
  'ghsl_exposure rejects population conservation_delta exceeding tolerance (23514)'
);

select throws_ok(
  $$insert into ghsl_exposure (
    epoch_year, crs_code, resolution_m, commune_code, wilaya_code,
    lat, lon, modeled_residents, source_cell_sum, source_cell_count, conservation_delta,
    published_at, attribution
  ) values (
    2025, 'EPSG:4326', 100, '1604', '16',
    36.75, 3.05, 999999.0, 100.0, 10, 0.0, '2025-01-15T00:00:00Z', 'GHSL'
  )$$,
  '23514',
  null,
  'ghsl_exposure rejects modeled_residents=999999 vs source_cell_sum=100 even when conservation_delta=0 (23514)'
);

set local role anon;
select is(
  (select modeled_residents from ghsl_exposure where commune_code = '1601' and epoch_year = 2025),
  125400.0::double precision,
  'anon can read ghsl_exposure'
);
select throws_ok(
  $$delete from ghsl_exposure where commune_code = '1601'$$,
  '42501',
  null,
  'anon cannot delete from ghsl_exposure'
);
reset role;

-- 8. service_role idempotent upserts across all 4 public-read tables
set local role service_role;
select lives_ok(
  $$insert into lightning_observations (
    product_type, flash_id, observed_at, published_at, lat, lon, attribution
  ) values (
    'L2-LFL', 'li-flash-001', '2026-11-24T14:02:11Z', '2026-11-24T14:04:00Z',
    36.45, 4.12, 'EUMETSAT MTG Lightning Imager L2 (lightning observation)'
  ) on conflict (source_key, observed_at, flash_id) do update set quality_state = excluded.quality_state$$,
  'service_role can idempotently upsert lightning_observations'
);
select lives_ok(
  $$insert into gwis_burned_areas (
    event_id, product_layer, burn_start_at, burn_end_at, published_at,
    area_ha, lat, lon, perimeter_geojson, attribution
  ) values (
    'gwis-2026-001', 'nrt.ba', '2026-08-14', '2026-08-16', '2026-08-16T18:00:00Z',
    152.0, 36.68, 4.72,
    '{"type":"Polygon","coordinates":[[[4.70,36.67],[4.74,36.67],[4.74,36.69],[4.70,36.69],[4.70,36.67]]]}'::jsonb,
    'Copernicus EMS GWIS / JRC (FIRMS-derived burned area estimate, CC BY 4.0)'
  ) on conflict (source_key, event_id, burn_end_at) do update set area_ha = excluded.area_ha$$,
  'service_role can idempotently upsert gwis_burned_areas'
);
select lives_ok(
  $$insert into clms_land_indices (
    product_version, observed_at, published_at, commune_code, wilaya_code,
    lat, lon, ndvi_value, attribution
  ) values (
    'ndvi_v3_300m', '2026-11-11', '2026-11-14T06:00:00Z', '1501', '15',
    36.71, 4.05, 0.44, 'Copernicus Land Monitoring Service (Global NDVI v3 / SWI v4)'
  ) on conflict (source_key, product_version, observed_at, commune_code) do update set ndvi_value = excluded.ndvi_value$$,
  'service_role can idempotently upsert clms_land_indices'
);
select lives_ok(
  $$insert into ghsl_exposure (
    epoch_year, crs_code, resolution_m, commune_code, wilaya_code,
    lat, lon, modeled_residents, source_cell_sum, source_cell_count, conservation_delta,
    published_at, attribution
  ) values (
    2025, 'EPSG:4326', 100, '1601', '16',
    36.75, 3.05, 125400.0, 125400.0, 420, 0.0, '2025-01-15T00:00:00Z',
    'European Commission JRC GHSL GHS-POP R2023A (modeled residents)'
  ) on conflict (source_key, epoch_year, resolution_m, commune_code) do update set modeled_residents = excluded.modeled_residents$$,
  'service_role can idempotently upsert ghsl_exposure'
);
reset role;

select * from finish();
rollback;
