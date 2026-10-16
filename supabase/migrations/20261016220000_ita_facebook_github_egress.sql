-- Facebook login-walls Cloudflare's shared egress; each GitHub runner brings a fresh IP
update public.source_contracts set
  execution_target = 'github',
  cadence_minutes = 2,
  warning_after_minutes = 6,
  stale_after_minutes = 20,
  lease_seconds = 120
where key = 'ita_facebook';
