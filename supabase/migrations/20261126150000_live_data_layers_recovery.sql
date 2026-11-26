-- Live data layers operational recovery:
-- 1. Clear dead ONM preprod CAP detail URLs and backfill missing wilaya links for
--    ONM romanisation variants ('El Meghaier', 'Tamenghasset').
-- 2. Move Facebook-scraped national sources (ita_facebook, tariki_facebook) back
--    to GitHub Actions runners (fresh IP per run avoids Facebook datacenter 302 walls)
--    and restore pg_cron nadhir-github-dispatch for execution_target = 'github' only.
-- 3. Remove legacy em dashes from source_contracts labels.
-- 4. Pause clms_ndvi_swi schedule until Copernicus Data Space OAuth credentials are set,
--    and widen imerg_rainfall freshness thresholds for NASA GIBS Early tile latency.

update public.onm_vigilance
set cap_url = null
where cap_url ilike '%ametvigilance-pprod%';

update public.onm_vigilance as v
set wilaya_id = w.id
from public.admin_units as w
where v.wilaya_id is null
  and w.level = 'wilaya'
  and (
    (v.area_desc = 'El Meghaier' and w.code = '57')
    or (v.area_desc = 'Tamenghasset' and w.code = '11')
  );

update public.source_contracts
set label = 'Info Trafic Algérie (Facebook)', updated_at = now()
where key = 'ita_facebook';

update public.source_contracts
set label = 'Info Trafic Algérie (website)', updated_at = now()
where key = 'ita_website';

update public.source_contracts
set execution_target = 'github', updated_at = now()
where key in ('ita_facebook', 'tariki_facebook');

update public.source_jobs
set execution_target = 'github', updated_at = now()
where contract_key in ('ita_facebook', 'tariki_facebook')
  and execution_target = 'worker'
  and state in ('queued', 'retry_wait');

select cron.unschedule(jobname)
from cron.job
where jobname = 'nadhir-github-dispatch';

select cron.schedule(
  'nadhir-github-dispatch',
  '* * * * *',
  $$select private.dispatch_github_source_jobs(now())$$
);

update public.source_contracts
set schedule_enabled = false, updated_at = now()
where key = 'clms_ndvi_swi';

delete from public.source_jobs
where contract_key = 'clms_ndvi_swi'
  and state in ('queued', 'retry_wait');

update public.source_contracts
set warning_after_minutes = 480,
    stale_after_minutes = 720,
    updated_at = now()
where key = 'imerg_rainfall';
