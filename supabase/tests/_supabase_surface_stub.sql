-- Supabase surfaces a bare cluster lacks, plus the migration ledger this
-- lineage writes to. STUB ONLY: no PostgREST, no GoTrue, no Data API.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon')          then create role anon nologin;          end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role')  then create role service_role nologin;  end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now(),
  -- Real on Supabase (GoTrue owns it). Stubbed because 0004's list_people()
  -- returns it: without the column the roster function will not compile, and
  -- the boundary run would fail for a reason that has nothing to do with the
  -- boundary.
  banned_until timestamptz
);
-- Idempotent add, for a cluster left over from before 0004 introduced the need.
alter table auth.users add column if not exists banned_until timestamptz;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;

-- Supabase Storage owns these in production. Only the columns 0007 configures
-- or protects are needed here; the stub proves SQL compatibility and policy
-- creation, not the Storage API's object-serving behavior.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated, service_role;

-- The migration ledger. Real on Supabase; stubbed here so the migration file
-- runs verbatim rather than being edited for the test — an edited file is not
-- the file being proven.
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  name text,
  statements text[]
);
