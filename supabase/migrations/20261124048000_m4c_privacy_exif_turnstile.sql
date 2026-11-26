-- M4C: Law 18-07 / Law 25-11 (ANPDP) Privacy Consent Ledger + Storage report-photos Lockdown & WebP Support
-- Reserved M4 migration window: 20261124048000

-- 1. Law 18-07 / Law 25-11 (ANPDP) consent ledger
create table if not exists public.privacy_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  consent_type text not null check (
    consent_type in (
      'privacy_policy',
      'citizen_reports',
      'zone_alerts',
      'email_digest',
      'push_alerts',
      'on_device_commune'
    )
  ),
  policy_version text not null check (
    policy_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(\.[a-z0-9-]+)?$'
  ),
  status text not null check (status in ('granted', 'withdrawn')),
  granted_at timestamptz,
  withdrawn_at timestamptz,
  locale text not null default 'ar' check (locale in ('ar', 'fr', 'en', 'kab')),
  source_surface text not null default 'web' check (
    source_surface in ('web', 'android', 'ios', 'api', 'settings', 'privacy', 'signup')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, consent_type),
  check (
    (status = 'granted' and granted_at is not null and withdrawn_at is null)
    or (status = 'withdrawn' and withdrawn_at is not null)
  )
);

create index if not exists privacy_consents_user_updated_idx
  on public.privacy_consents (user_id, updated_at desc);

create or replace function public.touch_privacy_consents_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.touch_privacy_consents_updated_at() from public, anon, authenticated;

drop trigger if exists privacy_consents_touch_updated_at on public.privacy_consents;
create trigger privacy_consents_touch_updated_at
  before update on public.privacy_consents
  for each row execute function public.touch_privacy_consents_updated_at();

alter table public.privacy_consents enable row level security;

revoke all on table public.privacy_consents from public, anon, authenticated;
grant select, insert, update on table public.privacy_consents to authenticated;
grant select, insert, update, delete on table public.privacy_consents to service_role;

drop policy if exists "own privacy consents select" on public.privacy_consents;
create policy "own privacy consents select"
  on public.privacy_consents
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "own privacy consents insert" on public.privacy_consents;
create policy "own privacy consents insert"
  on public.privacy_consents
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "own privacy consents update" on public.privacy_consents;
create policy "own privacy consents update"
  on public.privacy_consents
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- 2. Storage report-photos lockdown + WebP support
-- Every photo upload must flow through /api/private/report-photo (service_role)
-- after server-side magic-byte validation and EXIF/GPS/XMP stripping.
update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'],
       file_size_limit = 8388608,
       public = false
 where id = 'report-photos';

alter table public.citizen_reports
  drop constraint if exists citizen_reports_photo_key_valid;

alter table public.citizen_reports
  add constraint citizen_reports_photo_key_valid
  check (
    photo_url is null
    or photo_url ~ (
      '^' || user_id::text
      || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|png|webp)$'
    )
  ) not valid;

alter table public.citizen_reports
  validate constraint citizen_reports_photo_key_valid;

-- Remove direct client INSERT policy so authenticated/anon callers cannot bypass server EXIF stripping.
drop policy if exists "report photos owner insert" on storage.objects;

-- Keep UPDATE policy matching owner/folder in USING while forcing WITH CHECK (false) so any
-- direct client overwrite or cross-folder rename raises 42501 (preserving default_privilege_grants.test.sql).
alter policy "report photos owner update"
  on storage.objects
  using (
    bucket_id = 'report-photos'
    and (
      owner = auth.uid()
      or (owner is null and (storage.foldername(name))[1] = auth.uid()::text)
    )
  )
  with check (false);

-- Allow owners to read and delete their own server-uploaded objects (where storage.objects.owner is NULL).
alter policy "report photos owner read"
  on storage.objects
  using (
    bucket_id = 'report-photos'
    and (
      owner = auth.uid()
      or (owner is null and (storage.foldername(name))[1] = auth.uid()::text)
    )
  );

alter policy "report photos owner delete"
  on storage.objects
  using (
    bucket_id = 'report-photos'
    and (
      owner = auth.uid()
      or (owner is null and (storage.foldername(name))[1] = auth.uid()::text)
    )
  );
