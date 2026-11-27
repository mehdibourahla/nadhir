-- gwis_burned_areas succeeds every 6h; measure freshness by last_success_at so
-- quiet winter periods with no new fires do not falsely flag as delayed.
update public.source_contracts
set freshness_basis = 'last_success_at',
    warning_after_minutes = 720,
    stale_after_minutes = 1440,
    updated_at = now()
where key = 'gwis_burned_areas';
