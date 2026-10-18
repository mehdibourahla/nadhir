-- Reference data (geo) is published by hand and has no schedule, so its age is not a freshness signal.
alter table public.source_contracts
  add column is_reference boolean not null default false;

update public.source_contracts
set is_reference = true
where key = 'geo';

grant select (is_reference) on public.source_contracts to anon, authenticated;

create or replace view public.source_health
with (security_invoker = true)
as
with facts as (
  select
    contract.key,
    contract.label,
    contract.family,
    contract.criticality,
    contract.enabled,
    contract.freshness_basis,
    contract.warning_after_minutes,
    contract.stale_after_minutes,
    contract.is_reference,
    checkpoint.last_attempt_at,
    checkpoint.last_success_at,
    checkpoint.published_at,
    checkpoint.coverage_status,
    checkpoint.records_accepted,
    checkpoint.records_expected,
    checkpoint.fallback_contract_key,
    checkpoint.last_public_reason_code as public_reason_code,
    checkpoint.consecutive_failures,
    public.source_contract_is_backfilling(contract.key) as is_backfilling,
    case contract.freshness_basis
      when 'last_success_at' then checkpoint.last_success_at
      when 'upstream_published_at' then checkpoint.upstream_published_at
      when 'data_through' then checkpoint.data_through
      when 'published_at' then checkpoint.published_at
    end as valid_at
  from public.source_contracts as contract
  left join public.source_checkpoints as checkpoint
    on checkpoint.contract_key = contract.key
), aged as (
  select
    facts.*,
    case
      when valid_at is null then null
      else greatest(floor(extract(epoch from (now() - valid_at)) / 60), 0)::integer
    end as age_minutes
  from facts
)
select
  key,
  label,
  family,
  criticality,
  case
    when not enabled or public_reason_code = 'disabled' then 'paused'
    when valid_at is null then 'unavailable'
    when age_minutes > stale_after_minutes and not is_reference then 'stale'
    when is_backfilling then 'backfilling'
    when age_minutes > warning_after_minutes and not is_reference then 'delayed'
    when consecutive_failures > 0
      or coverage_status = 'partial'
      or fallback_contract_key is not null then 'degraded'
    else 'healthy'
  end as state,
  freshness_basis,
  valid_at,
  last_attempt_at,
  last_success_at,
  published_at,
  age_minutes,
  warning_after_minutes,
  stale_after_minutes,
  coverage_status,
  records_accepted,
  records_expected,
  fallback_contract_key,
  public_reason_code
from aged;
