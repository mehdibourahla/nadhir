-- Open-Meteo answered 503 to every attempt in the minutes after 00/06/12 UTC; run off the hour and spread retries past the peak
update public.source_contracts set
  schedule_offset_minutes = 20,
  retry_base_seconds = 300,
  max_attempts = 5,
  retry_window_minutes = 120
where key = 'openmeteo_weather';
