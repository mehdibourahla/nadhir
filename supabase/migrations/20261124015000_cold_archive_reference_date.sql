-- Internal reference-date-injectable cold-archive helpers for reproducible
-- cutoff verification (e.g., simulating 2026-11-26 and 2026-11-27 UTC).
-- Public RPC signatures and security invariants are UNCHANGED: service_role
-- can only call public.cold_pending_days(text) and public.cold_archive_commit(7 args),
-- which unconditionally pass now().

create or replace function private.cold_pending_days_as_of(
  _table text,
  _as_of timestamptz default now()
) returns setof date
language plpgsql stable security definer set search_path = '' as $$
declare
  _config private.cold_tables;
  _first date;
begin
  if _as_of is null then
    raise exception 'cold_as_of_required' using errcode = '22004';
  end if;
  select * into _config from private.cold_tables where table_name = _table;
  if not found then
    raise exception 'cold_table_unknown' using errcode = '22023';
  end if;
  execute format('select (min(%I) at time zone ''UTC'')::date from public.%I', _config.day_column, _table)
    into _first;
  return query
    select d::date from generate_series(
      _first, (_as_of at time zone 'UTC')::date - _config.hot_days - 1, interval '1 day') d
    where not exists (
      select 1 from public.cold_exports e
      where e.table_name = _table and e.day = d::date
    )
    order by 1;
end;
$$;
revoke all on function private.cold_pending_days_as_of(text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function private.cold_archive_commit_as_of(
  _table text, _day date, _rows bigint,
  _key_digest text default null, _sha256 text default null,
  _bytes bigint default null, _path text default null,
  _as_of timestamptz default now()
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  _hot integer := (select hot_days from private.cold_tables where table_name = _table);
  _deleted bigint;
  _digest text;
begin
  if _as_of is null then
    raise exception 'cold_as_of_required' using errcode = '22004';
  end if;
  if _hot is null then
    raise exception 'cold_table_unknown' using errcode = '22023';
  end if;
  if _day >= (_as_of at time zone 'UTC')::date - _hot then
    raise exception 'cold_day_still_hot' using errcode = '22023';
  end if;
  if _rows > 0 and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'cold-archive' and o.name = _path
      and (o.metadata ->> 'size')::bigint = _bytes
  ) then
    raise exception 'cold_file_missing' using errcode = 'P0002';
  end if;
  if _table = 'source_runs' then perform pg_advisory_xact_lock(1800908); end if;

  insert into public.cold_exports (table_name, day, rows, key_digest, sha256, bytes, path)
  values (_table, _day, _rows, _key_digest, _sha256, _bytes, _path);

  if _table = 'source_runs' then
    insert into public.source_run_retired_keys (idempotency_key)
    select r.idempotency_key from public.source_runs r
    join private.cold_candidates(_table, _day) c on c.id = r.id
    where r.idempotency_key is not null
    on conflict do nothing;
  end if;

  execute format(
    'with gone as (delete from public.%I t using private.cold_candidates($1, $2) c where t.id = c.id returning t.id)
     select count(*), md5(string_agg(id::text, '','' order by id::text collate "C")) from gone', _table)
    into _deleted, _digest using _table, _day;

  if _deleted <> _rows or (_rows > 0 and _digest is distinct from _key_digest) then
    raise exception 'cold_export_mismatch' using
      detail = format('%s %s: file holds %s rows, database held %s', _table, _day, _rows, _deleted);
  end if;
  return _deleted;
end;
$$;
revoke all on function private.cold_archive_commit_as_of(text, date, bigint, text, text, bigint, text, timestamptz)
  from public, anon, authenticated, service_role;

create or replace function public.cold_pending_days(_table text) returns setof date
language sql stable security definer set search_path = '' as $$
  select private.cold_pending_days_as_of(_table, now());
$$;
revoke all on function public.cold_pending_days(text) from public, anon, authenticated;
grant execute on function public.cold_pending_days(text) to service_role;

create or replace function public.cold_archive_commit(
  _table text, _day date, _rows bigint,
  _key_digest text default null, _sha256 text default null,
  _bytes bigint default null, _path text default null
) returns bigint
language sql security definer set search_path = '' as $$
  select private.cold_archive_commit_as_of(_table, _day, _rows, _key_digest, _sha256, _bytes, _path, now());
$$;
revoke all on function public.cold_archive_commit(text, date, bigint, text, text, bigint, text)
  from public, anon, authenticated;
grant execute on function public.cold_archive_commit(text, date, bigint, text, text, bigint, text)
  to service_role;
