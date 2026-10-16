-- read the public page directly; it renders only its newest post, so a one-minute poll is what keeps bursts
update public.source_contracts set
  cadence_minutes = 1,
  warning_after_minutes = 5,
  stale_after_minutes = 15,
  schedule_offset_minutes = 0,
  lease_seconds = 60,
  retry_base_seconds = 30,
  retry_window_minutes = 5,
  overlap_minutes = 0,
  parser_version = 'facebook-page-v1'
where key = 'ita_facebook';
