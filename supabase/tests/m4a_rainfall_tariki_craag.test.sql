begin;
set local search_path = public, extensions;
select plan(36);

-- 1. Four new M4A source_contracts registered on execution_target = 'worker' with zero em dashes
select is(
  (select count(*)::integer from source_contracts
   where key in ('imerg_rainfall', 'hsaf_rainfall', 'tariki_facebook', 'craag_earthquakes')
     and execution_target = 'worker'
     and enabled = true),
  4,
  'all 4 M4A source contracts exist on execution_target = worker'
);

select is(
  (select count(*)::integer from source_contracts
   where key in ('imerg_rainfall', 'hsaf_rainfall', 'tariki_facebook', 'craag_earthquakes')
     and (label like '%' || chr(8212) || '%' or attribution like '%' || chr(8212) || '%')),
  0,
  'M4A source contract labels and attributions contain zero em dashes'
);

select ok(
  (select execution_target = 'cloudflare' and family = 'hazard_observation' and enabled
   from source_contracts where key = 'emsc'),
  'existing emsc contract remains on execution_target = cloudflare'
);

select is(
  (select count(*)::integer from source_checkpoints
   where contract_key in ('imerg_rainfall', 'hsaf_rainfall', 'tariki_facebook', 'craag_earthquakes')),
  4,
  'all 4 M4A source checkpoints exist'
);

select ok(
  (select family = 'hazard_observation' and freshness_basis = 'upstream_published_at'
     and cadence_minutes = 30 and replay_capability = 'interval' and replay_window_minutes = 360
   from source_contracts where key = 'imerg_rainfall'),
  'imerg_rainfall contract has M6-1 metadata and 360m interval replay'
);

select ok(
  (select family = 'hazard_observation' and freshness_basis = 'upstream_published_at'
     and cadence_minutes = 30 and replay_capability = 'interval' and replay_window_minutes = 360
   from source_contracts where key = 'hsaf_rainfall'),
  'hsaf_rainfall contract has M6-1 metadata and 360m interval replay'
);

-- 2. F18: public.rainfall_observations schema, CHECK constraints (23514), idempotency (23505), and RLS (42501)
insert into rainfall_observations (
  source_key, valid_time, published_time, grid_cell_key, lat, lon,
  wilaya_code, commune_code, rate_mm_h, accum_mm_30m, attribution
)
values (
  'imerg_rainfall',
  '2026-11-24T12:00:00Z',
  '2026-11-24T15:52:00Z',
  'imerg:36.75:3.05',
  36.75,
  3.05,
  '16',
  '1601',
  24.6,
  12.3,
  'NASA GPM IMERG Early (satellite observed rainfall)'
);

select throws_ok(
  $$insert into rainfall_observations (
    source_key, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'imerg_rainfall', '2026-11-24T12:00:00Z', '2026-11-24T15:52:00Z',
    'imerg:36.75:3.05', 36.75, 3.05, 10.0, 5.0, 'NASA'
  )$$,
  '23505',
  null,
  'rainfall_observations enforces unique (source_key, valid_time, grid_cell_key)'
);

select throws_ok(
  $$insert into rainfall_observations (
    source_key, is_model, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'imerg_rainfall', true, '2026-11-24T12:30:00Z', '2026-11-24T16:22:00Z',
    'imerg:36.75:3.05', 36.75, 3.05, 10.0, 5.0, 'NASA'
  )$$,
  '23514',
  null,
  'rainfall_observations rejects is_model = true (23514)'
);

select throws_ok(
  $$insert into rainfall_observations (
    source_key, observation_kind, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'hsaf_rainfall', 'model_forecast', '2026-11-24T12:30:00Z', '2026-11-24T12:48:00Z',
    'hsaf:36.75:3.05', 36.75, 3.05, 10.0, 5.0, 'H-SAF'
  )$$,
  '23514',
  null,
  'rainfall_observations rejects non-satellite observation_kind (23514)'
);

select throws_ok(
  $$insert into rainfall_observations (
    source_key, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'hsaf_rainfall', '2026-11-24T12:30:00Z', '2026-11-24T12:48:00Z',
    'hsaf:36.75:3.05', 36.75, 3.05, 650.0, 50.0, 'H-SAF'
  )$$,
  '23514',
  null,
  'rainfall_observations rejects unphysical rate_mm_h > 500 (23514)'
);

select throws_ok(
  $$insert into rainfall_observations (
    source_key, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'hsaf_rainfall', '2026-11-24T12:30:00Z', '2026-11-24T12:48:00Z',
    'hsaf:50.00:3.05', 50.0, 3.05, 10.0, 5.0, 'H-SAF'
  )$$,
  '23514',
  null,
  'rainfall_observations rejects out-of-Algeria lat > 38.5 (23514)'
);

set local role anon;
select is(
  (select rate_mm_h from rainfall_observations where grid_cell_key = 'imerg:36.75:3.05'),
  24.6::double precision,
  'anon can read rainfall_observations'
);
select throws_ok(
  $$insert into rainfall_observations (
    source_key, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'imerg_rainfall', '2026-11-24T13:00:00Z', '2026-11-24T16:52:00Z',
    'imerg:36.00:3.00', 36.0, 3.0, 1.0, 0.5, 'forged'
  )$$,
  '42501',
  null,
  'anon cannot insert into rainfall_observations'
);
reset role;

set local role authenticated;
select is(
  (select accum_mm_30m from rainfall_observations where grid_cell_key = 'imerg:36.75:3.05'),
  12.3::double precision,
  'authenticated can read rainfall_observations'
);
select throws_ok(
  $$update rainfall_observations set rate_mm_h = 0 where grid_cell_key = 'imerg:36.75:3.05'$$,
  '42501',
  null,
  'authenticated cannot update rainfall_observations'
);
reset role;

set local role service_role;
select lives_ok(
  $$insert into rainfall_observations (
    source_key, valid_time, published_time, grid_cell_key, lat, lon,
    rate_mm_h, accum_mm_30m, attribution
  ) values (
    'hsaf_rainfall', '2026-11-24T12:00:00Z', '2026-11-24T12:18:00Z',
    'hsaf:36.75:3.05', 36.75, 3.05, 28.4, 14.2, 'EUMETSAT H-SAF (satellite observed rainfall)'
  ) on conflict (source_key, valid_time, grid_cell_key) do update set rate_mm_h = excluded.rate_mm_h$$,
  'service_role can idempotently upsert into rainfall_observations'
);
reset role;

-- 3. F19: tariki_facebook text_sources registration & write_text_source fire confirmation block
select ok(
  (select kind = 'facebook' and authority_tier = 'national' and template is null
     and label = 'Gendarmerie Nationale (Tariki)' and enabled
   from text_sources where key = 'tariki_facebook'),
  'tariki_facebook is registered in text_sources with kind = facebook and national tier'
);

select throws_ok(
  $$select public.write_text_source('tariki_facebook', 'confirm', '[]'::jsonb)$$,
  'P0001',
  'confirmation_source_not_allowed',
  'write_text_source rejects confirm operation for tariki_facebook'
);

select is(
  has_function_privilege('public', 'public.write_text_source(text, text, jsonb, uuid, integer)', 'execute'),
  false,
  'public cannot execute write_text_source'
);
select is(
  has_function_privilege('anon', 'public.write_text_source(text, text, jsonb, uuid, integer)', 'execute'),
  false,
  'anon cannot execute write_text_source'
);
select is(
  has_function_privilege('authenticated', 'public.write_text_source(text, text, jsonb, uuid, integer)', 'execute'),
  false,
  'authenticated cannot execute write_text_source'
);
select is(
  has_function_privilege('service_role', 'public.write_text_source(text, text, jsonb, uuid, integer)', 'execute'),
  true,
  'service_role can execute write_text_source'
);

-- 4. F20: CRAAG official attribution RPC preserves EMSC fields, survives EMSC re-upsert, and supports standalone idempotency
insert into earthquakes (id, occurred_at, lat, lon, depth_km, magnitude, magnitude_type, region, network, updated_at)
values (
  'emsc_m4a_test_1',
  '2026-11-24T10:00:00Z',
  36.19,
  5.41,
  12.0,
  4.7,
  'mw',
  'NORTHERN ALGERIA',
  'EMSC',
  '2026-11-24T10:05:00Z'
);

select is(
  (public.apply_craag_earthquake_attribution(
    _bulletin_id => 'craag-m4a-1',
    _matched_earthquake_id => 'emsc_m4a_test_1',
    _observed_at => '2026-11-24T10:00:10Z',
    _lat => 36.21,
    _lon => 5.44,
    _depth_km => 10.0,
    _magnitude => 4.6,
    _magnitude_type => 'Ml',
    _place => '12 km NE Setif',
    _source_url => 'https://www.craag.dz/sismologie/bulletin.php?id=craag-m4a-1'
  ))->>'mode',
  'matched',
  'apply_craag_earthquake_attribution attaches CRAAG attribution to matched EMSC row'
);

select ok(
  (select occurred_at = '2026-11-24T10:00:00Z'::timestamptz
     and lat = 36.19 and lon = 5.41 and depth_km = 12.0
     and magnitude = 4.7::numeric and magnitude_type = 'mw'
     and region = 'NORTHERN ALGERIA' and network = 'EMSC'
     and craag_bulletin_id = 'craag-m4a-1'
     and craag_magnitude = 4.6::numeric
     and craag_place = '12 km NE Setif'
     and craag_matched_at is not null
   from earthquakes where id = 'emsc_m4a_test_1'),
  'CRAAG attribution preserves all EMSC instrumental columns untouched'
);

-- Subsequent EMSC revision upsert omitting craag_* columns preserves CRAAG attribution
insert into earthquakes (id, occurred_at, lat, lon, depth_km, magnitude, magnitude_type, region, network, updated_at)
values (
  'emsc_m4a_test_1',
  '2026-11-24T10:00:00Z',
  36.19,
  5.41,
  11.5,
  4.8,
  'mw',
  'NORTHERN ALGERIA',
  'EMSC',
  '2026-11-24T10:15:00Z'
)
on conflict (id) do update set
  depth_km = excluded.depth_km,
  magnitude = excluded.magnitude,
  updated_at = excluded.updated_at;

select ok(
  (select magnitude = 4.8::numeric and craag_bulletin_id = 'craag-m4a-1' and craag_magnitude = 4.6::numeric
   from earthquakes where id = 'emsc_m4a_test_1'),
  'subsequent EMSC upsert omitting craag_* columns preserves CRAAG attribution'
);

-- Standalone CRAAG bulletin upsert + idempotent replay
select is(
  (public.apply_craag_earthquake_attribution(
    _bulletin_id => 'craag-standalone-1',
    _matched_earthquake_id => null,
    _observed_at => '2026-11-24T11:00:00Z',
    _lat => 36.75,
    _lon => 3.06,
    _depth_km => 8.0,
    _magnitude => 3.4,
    _magnitude_type => 'Ml',
    _place => '6 km SE Alger',
    _source_url => 'https://www.craag.dz/sismologie/bulletin.php?id=craag-standalone-1'
  ))->>'earthquake_id',
  'craag:craag-standalone-1',
  'unmatched CRAAG bulletin inserts standalone craag:<id> row'
);

select lives_ok(
  $$select public.apply_craag_earthquake_attribution(
    _bulletin_id => 'craag-standalone-1',
    _matched_earthquake_id => null,
    _observed_at => '2026-11-24T11:00:00Z',
    _lat => 36.75,
    _lon => 3.06,
    _depth_km => 8.0,
    _magnitude => 3.5,
    _magnitude_type => 'Ml',
    _place => '6 km SE Alger',
    _source_url => 'https://www.craag.dz/sismologie/bulletin.php?id=craag-standalone-1'
  )$$,
  'standalone CRAAG bulletin replay is idempotent'
);

select is(
  (select count(*)::integer from earthquakes where craag_bulletin_id = 'craag-standalone-1'),
  1,
  'standalone CRAAG bulletin replay produces exactly one row'
);

select is(
  (select craag_magnitude from earthquakes where id = 'craag:craag-standalone-1'),
  3.5::numeric,
  'standalone CRAAG bulletin replay updates revised magnitude'
);

-- Partial unique index prevents attaching duplicate craag_bulletin_id directly
select throws_ok(
  $$insert into earthquakes (id, occurred_at, lat, lon, magnitude, updated_at, craag_bulletin_id)
    values ('emsc_dup_test', '2026-11-24T10:00:00Z', 36.2, 5.4, 4.7, '2026-11-24T10:05:00Z', 'craag-m4a-1')$$,
  '23505',
  null,
  'earthquakes_craag_bulletin_id_idx rejects duplicate craag_bulletin_id'
);

-- REVOKE ALL verification for apply_craag_earthquake_attribution across all 4 roles
select is(
  has_function_privilege(
    'public',
    'public.apply_craag_earthquake_attribution(text, text, timestamptz, double precision, double precision, double precision, numeric, text, text, text, text, uuid, boolean)',
    'execute'
  ),
  false,
  'public cannot execute apply_craag_earthquake_attribution'
);
select is(
  has_function_privilege(
    'anon',
    'public.apply_craag_earthquake_attribution(text, text, timestamptz, double precision, double precision, double precision, numeric, text, text, text, text, uuid, boolean)',
    'execute'
  ),
  false,
  'anon cannot execute apply_craag_earthquake_attribution'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.apply_craag_earthquake_attribution(text, text, timestamptz, double precision, double precision, double precision, numeric, text, text, text, text, uuid, boolean)',
    'execute'
  ),
  false,
  'authenticated cannot execute apply_craag_earthquake_attribution'
);
select is(
  has_function_privilege(
    'service_role',
    'public.apply_craag_earthquake_attribution(text, text, timestamptz, double precision, double precision, double precision, numeric, text, text, text, text, uuid, boolean)',
    'execute'
  ),
  true,
  'service_role can execute apply_craag_earthquake_attribution'
);

set local role anon;
select throws_ok(
  $$select public.apply_craag_earthquake_attribution('forged-1', 'emsc_m4a_test_1')$$,
  '42501',
  null,
  'anon invocation of apply_craag_earthquake_attribution raises 42501'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select public.apply_craag_earthquake_attribution('forged-2', 'emsc_m4a_test_1')$$,
  '42501',
  null,
  'authenticated invocation of apply_craag_earthquake_attribution raises 42501'
);
reset role;

select * from finish();
rollback;
