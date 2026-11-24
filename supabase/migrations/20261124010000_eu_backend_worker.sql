-- Standalone always-on EU backend worker execution target ('worker'),
-- service_role lease renewal & stale-lease recovery RPCs, migration of the
-- 5 heavy/egress contracts from 'github' to 'worker', and retirement of the
-- automatic pg_cron GitHub Actions dispatch schedule.

alter table public.source_contracts
  drop constraint if exists source_contracts_execution_target_check,
  add constraint source_contracts_execution_target_check
    check (execution_target in ('cloudflare', 'github', 'worker'));

alter table public.source_jobs
  drop constraint if exists source_jobs_execution_target_check,
  add constraint source_jobs_execution_target_check
    check (execution_target in ('cloudflare', 'github', 'worker'));

create or replace function public.enqueue_due_source_jobs(
  _observed_at timestamptz,
  _enqueued_by text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  _contract public.source_contracts%rowtype;
  _observed_minute timestamptz;
  _epoch_minute bigint;
  _slot_minute bigint;
  _scheduled_for timestamptz;
  _inserted integer := 0;
  _affected integer;
begin
  if _enqueued_by not in ('database', 'cloudflare', 'worker') then
    raise exception 'unsupported scheduler: %', _enqueued_by;
  end if;

  _observed_minute := date_trunc('minute', _observed_at);
  _epoch_minute := floor(extract(epoch from _observed_minute) / 60)::bigint;

  for _contract in
    select *
    from public.source_contracts
    where enabled and schedule_enabled
    order by key
  loop
    _slot_minute := (
      (_epoch_minute - _contract.schedule_offset_minutes)
      / _contract.cadence_minutes
    ) * _contract.cadence_minutes + _contract.schedule_offset_minutes;
    _scheduled_for := to_timestamp(_slot_minute * 60);

    insert into public.source_jobs (
      contract_key,
      contract_version,
      trigger_kind,
      idempotency_key,
      scheduled_for,
      data_from,
      data_through,
      execution_target,
      enqueued_by,
      available_at,
      max_attempts,
      retry_base_seconds,
      retry_until
    )
    values (
      _contract.key,
      _contract.version,
      'scheduled',
      'scheduled:' || _contract.key || ':' || to_char(
        _scheduled_for at time zone 'utc',
        'YYYY-MM-DD"T"HH24:MI:SS"Z"'
      ),
      _scheduled_for,
      _scheduled_for - make_interval(
        mins => _contract.cadence_minutes + _contract.overlap_minutes
      ),
      _scheduled_for,
      _contract.execution_target,
      array[_enqueued_by],
      _observed_minute,
      _contract.max_attempts,
      _contract.retry_base_seconds,
      _scheduled_for + make_interval(mins => _contract.retry_window_minutes)
    )
    on conflict (contract_key, scheduled_for)
      where trigger_kind = 'scheduled'
    do nothing;

    get diagnostics _affected = row_count;
    _inserted := _inserted + _affected;

    if _affected = 0 then
      update public.source_jobs
      set
        enqueued_by = (
          select array_agg(distinct scheduler order by scheduler)
          from unnest(
            public.source_jobs.enqueued_by || array[_enqueued_by]
          ) scheduler
        ),
        updated_at = _observed_minute
      where contract_key = _contract.key
        and scheduled_for = _scheduled_for
        and trigger_kind = 'scheduled';
    end if;
  end loop;

  return _inserted;
end;
$$;

revoke all on function public.enqueue_due_source_jobs(timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_due_source_jobs(timestamptz, text)
  to service_role;

create or replace function public.claim_source_job(
  _worker_id text,
  _execution_target text,
  _contract_key text default null,
  _now timestamptz default now()
)
returns setof public.source_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  _candidate record;
  _expired public.source_jobs%rowtype;
  _expired_attempt integer;
  _expired_gap_id uuid;
  _expired_gap_state text;
  _expired_reason text;
  _maintenance_remaining integer := 25;
  _obsolete public.source_jobs%rowtype;
  _obsolete_attempt integer;
  _obsolete_gap_id uuid;
  _affected integer;
begin
  if length(coalesce(_worker_id, '')) not between 1 and 200 then
    raise exception 'invalid worker id';
  end if;
  if _execution_target not in ('cloudflare', 'github', 'worker') then
    raise exception 'invalid execution target';
  end if;

  -- Retry windows describe whether the interval is still useful, not merely
  -- when another attempt may begin. Once the window closes, audit the missed
  -- attempt and preserve a replayable or explicitly unrecoverable gap.
  for _expired in
    select job.*
    from public.source_jobs as job
    where job.execution_target = _execution_target
      and (_contract_key is null or job.contract_key = _contract_key)
      and job.state in ('queued', 'retry_wait')
      and job.retry_until <= _now
    order by job.contract_key, job.scheduled_for, job.id
    limit _maintenance_remaining
    for update of job skip locked
  loop
    _maintenance_remaining := _maintenance_remaining - 1;
    _expired_attempt := least(
      _expired.attempt_count + 1,
      _expired.max_attempts
    );
    _expired_reason := coalesce(
      _expired.last_public_reason_code,
      'data_delayed'
    );

    update public.source_jobs
    set
      state = 'failed',
      attempt_count = _expired_attempt,
      started_at = coalesce(started_at, _now),
      finished_at = _now,
      last_error_at = _now,
      last_public_reason_code = _expired_reason,
      updated_at = _now
    where id = _expired.id;

    perform private.record_source_run(
      _contract_key => _expired.contract_key,
      _trigger_kind => _expired.trigger_kind,
      _idempotency_key => 'job:' || _expired.id::text
        || ':attempt:' || _expired_attempt::text,
      _scheduled_for => _expired.scheduled_for,
      _started_at => _now,
      _finished_at => _now,
      _outcome => 'failed',
      _upstream_published_at => null,
      _data_from => null,
      _data_through => null,
      _validated_at => null,
      _published_at => null,
      _records_seen => 0,
      _records_inserted => 0,
      _records_updated => 0,
      _records_rejected => 0,
      _records_expected => null,
      _coverage_status => 'unknown',
      _quality_checks => '{"usefulness_window_expired":true}'::jsonb,
      _public_reason_code => _expired_reason,
      _private_diagnostic => 'source job usefulness window expired',
      _job_id => _expired.id,
      _attempt => _expired_attempt
    );

    select case
      when contract.replay_capability = 'interval'
        and contract.replay_window_minutes is not null
        and _expired.data_from >= _now - make_interval(
          mins => contract.replay_window_minutes
        ) then 'open'
      else 'unrecoverable'
    end
    into _expired_gap_state
    from public.source_contracts as contract
    where contract.key = _expired.contract_key;

    insert into public.source_gaps (
      contract_key,
      data_from,
      data_through,
      state,
      public_reason_code,
      detected_at,
      updated_at
    )
    values (
      _expired.contract_key,
      _expired.data_from,
      _expired.data_through,
      _expired_gap_state,
      _expired_reason,
      _now,
      _now
    )
    on conflict (contract_key, data_from, data_through) do update
    set
      state = case
        when public.source_gaps.state = 'resolved' then 'resolved'
        else excluded.state
      end,
      public_reason_code = excluded.public_reason_code,
      updated_at = excluded.updated_at
    returning id into _expired_gap_id;

    update public.source_jobs
    set gap_id = coalesce(gap_id, _expired_gap_id)
    where id = _expired.id;
  end loop;

  -- A current-only adapter must never run today's payload while claiming an
  -- older interval. Audit every superseded slot, preserve its gap, then claim
  -- only the newest useful scheduled job for that contract.
  for _obsolete in
    select job.*
    from public.source_jobs as job
    join public.source_contracts as contract
      on contract.key = job.contract_key
    where job.execution_target = _execution_target
      and (_contract_key is null or job.contract_key = _contract_key)
      and contract.replay_capability = 'none'
      and job.trigger_kind = 'scheduled'
      and job.state in ('queued', 'retry_wait')
      and job.attempt_count < job.max_attempts
      and exists (
        select 1
        from public.source_jobs as newer
        where newer.contract_key = job.contract_key
          and newer.trigger_kind = 'scheduled'
          and newer.scheduled_for > job.scheduled_for
          and newer.available_at <= _now
      )
    order by job.contract_key, job.scheduled_for, job.id
    limit _maintenance_remaining
    for update of job skip locked
  loop
    _maintenance_remaining := _maintenance_remaining - 1;
    _obsolete_attempt := _obsolete.attempt_count + 1;

    update public.source_jobs
    set
      state = 'failed',
      attempt_count = _obsolete_attempt,
      started_at = coalesce(started_at, _now),
      finished_at = _now,
      last_error_at = _now,
      last_public_reason_code = 'data_delayed',
      updated_at = _now
    where id = _obsolete.id;

    perform private.record_source_run(
      _contract_key => _obsolete.contract_key,
      _trigger_kind => _obsolete.trigger_kind,
      _idempotency_key => 'job:' || _obsolete.id::text
        || ':attempt:' || _obsolete_attempt::text,
      _scheduled_for => _obsolete.scheduled_for,
      _started_at => _now,
      _finished_at => _now,
      _outcome => 'failed',
      _upstream_published_at => null,
      _data_from => null,
      _data_through => null,
      _validated_at => null,
      _published_at => null,
      _records_seen => 0,
      _records_inserted => 0,
      _records_updated => 0,
      _records_rejected => 0,
      _records_expected => null,
      _coverage_status => 'unknown',
      _quality_checks => '{"obsolete_slot":true}'::jsonb,
      _public_reason_code => 'data_delayed',
      _private_diagnostic => 'superseded by a newer current-only scheduled slot',
      _job_id => _obsolete.id,
      _attempt => _obsolete_attempt
    );

    insert into public.source_gaps (
      contract_key,
      data_from,
      data_through,
      state,
      public_reason_code,
      detected_at,
      updated_at
    )
    values (
      _obsolete.contract_key,
      _obsolete.data_from,
      _obsolete.data_through,
      'unrecoverable',
      'data_delayed',
      _now,
      _now
    )
    on conflict (contract_key, data_from, data_through) do update
    set
      state = case
        when public.source_gaps.state = 'resolved' then 'resolved'
        else 'unrecoverable'
      end,
      public_reason_code = excluded.public_reason_code,
      updated_at = excluded.updated_at
    returning id into _obsolete_gap_id;

    update public.source_jobs
    set gap_id = coalesce(gap_id, _obsolete_gap_id)
    where id = _obsolete.id;
  end loop;

  for _candidate in
    select
      job.id,
      job.contract_key,
      contract.lease_seconds
    from public.source_jobs as job
    join public.source_contracts as contract
      on contract.key = job.contract_key
    where job.execution_target = _execution_target
      and (_contract_key is null or job.contract_key = _contract_key)
      and job.state in ('queued', 'retry_wait')
      and job.available_at <= _now
      and job.retry_until > _now
      and job.attempt_count < job.max_attempts
      and contract.enabled
      and not (
        contract.replay_capability = 'none'
        and job.trigger_kind = 'scheduled'
        and exists (
          select 1
          from public.source_jobs as newer
          where newer.contract_key = job.contract_key
            and newer.trigger_kind = 'scheduled'
            and newer.scheduled_for > job.scheduled_for
            and newer.available_at <= _now
        )
      )
      and not exists (
        select 1
        from public.source_job_leases as lease
        where lease.contract_key = job.contract_key
      )
      and not exists (
        select 1
        from unnest(contract.dependency_keys) as dependency_key
        join public.source_contracts as dependency
          on dependency.key = dependency_key
        left join public.source_checkpoints as checkpoint
          on checkpoint.contract_key = dependency.key
        where case
          when dependency.schedule_enabled then coalesce((
            select dependency_job.state
            from public.source_jobs as dependency_job
            where dependency_job.contract_key = dependency.key
              and dependency_job.scheduled_for <= job.scheduled_for
              and dependency_job.scheduled_for
                > job.scheduled_for - make_interval(mins => dependency.cadence_minutes)
            order by dependency_job.scheduled_for desc, dependency_job.created_at desc
            limit 1
          ), 'missing') not in ('succeeded', 'failed')
          else coalesce(
            checkpoint.published_at,
            checkpoint.validated_at,
            checkpoint.last_success_at
          ) is null
        end
      )
    order by
      job.scheduled_for,
      case contract.criticality
        when 'critical' then 0
        when 'supporting' then 1
        else 2
      end,
      job.created_at,
      job.id
    for update of job skip locked
  loop
    insert into public.source_job_leases (
      contract_key,
      job_id,
      worker_id,
      attempt,
      leased_at,
      lease_expires_at
    )
    values (
      _candidate.contract_key,
      _candidate.id,
      _worker_id,
      (
        select attempt_count + 1
        from public.source_jobs
        where id = _candidate.id
      ),
      _now,
      _now + make_interval(secs => _candidate.lease_seconds)
    )
    on conflict do nothing;

    get diagnostics _affected = row_count;
    if _affected = 0 then
      continue;
    end if;

    update public.source_jobs
    set
      state = 'running',
      attempt_count = attempt_count + 1,
      started_at = _now,
      finished_at = null,
      updated_at = _now
    where id = _candidate.id;

    return query
      select * from public.source_jobs where id = _candidate.id;
    return;
  end loop;
end;
$$;

revoke all on function public.claim_source_job(text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_source_job(text, text, text, timestamptz)
  to service_role;

create or replace function public.requeue_expired_source_jobs(
  _now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.requeue_expired_source_jobs(_now);
end;
$$;

revoke all on function public.requeue_expired_source_jobs(timestamptz)
  from public, anon, authenticated;
grant execute on function public.requeue_expired_source_jobs(timestamptz)
  to service_role;

create or replace function public.renew_source_job_lease(
  _job_id uuid,
  _worker_id text,
  _attempt integer,
  _lease_seconds integer default null,
  _now timestamptz default now()
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  _lease public.source_job_leases%rowtype;
  _job public.source_jobs%rowtype;
  _contract_lease_seconds integer;
  _effective_seconds integer;
  _new_expires_at timestamptz;
begin
  if length(coalesce(_worker_id, '')) not between 1 and 200 then
    raise exception 'invalid worker id';
  end if;

  -- Lock source_job_leases before source_jobs to preserve the global lock ordering invariant.
  select *
  into _lease
  from public.source_job_leases
  where job_id = _job_id
  for update;

  select *
  into _job
  from public.source_jobs
  where id = _job_id
  for share;

  if _lease.job_id is null
    or _job.id is null
    or _attempt is null
    or _now is null
    or _lease.worker_id is distinct from _worker_id
    or _lease.attempt is distinct from _attempt
    or _lease.lease_expires_at <= _now
    or _job.state is distinct from 'running'
    or _job.attempt_count is distinct from _attempt
  then
    raise exception 'source job lease does not match renewal';
  end if;

  select lease_seconds
  into _contract_lease_seconds
  from public.source_contracts
  where key = _job.contract_key;

  _effective_seconds := coalesce(_lease_seconds, _contract_lease_seconds);
  if _effective_seconds is null or _effective_seconds not between 30 and 3600 then
    raise exception 'invalid lease duration';
  end if;

  update public.source_job_leases
  set lease_expires_at = greatest(
    lease_expires_at,
    _now + make_interval(secs => _effective_seconds)
  )
  where job_id = _job_id
  returning lease_expires_at into _new_expires_at;

  return _new_expires_at;
end;
$$;

revoke all on function public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.renew_source_job_lease(uuid, text, integer, integer, timestamptz)
  to service_role;

-- Migrate the 5 heavy / egress contracts from GitHub Actions to the standalone EU backend worker.
update public.source_contracts
set execution_target = 'worker', updated_at = now()
where key in ('ita_facebook', 'ita_website', 'dgpc_telegram', 'local_fwi', 'effis');

update public.source_jobs
set execution_target = 'worker', updated_at = now()
where contract_key in ('ita_facebook', 'ita_website', 'dgpc_telegram', 'local_fwi', 'effis')
  and execution_target = 'github'
  and state in ('queued', 'retry_wait');

-- Retire automatic pg_cron GitHub Actions dispatch (keep private.dispatch_github_source_jobs for rollback/tests).
select cron.unschedule(jobname)
from cron.job
where jobname = 'nadhir-github-dispatch';
