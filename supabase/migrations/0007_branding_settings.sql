-- Administrator-configurable Basecamp identity and a public, tightly scoped
-- logo bucket. Apply after 0006_product_contract.sql.

begin;

create table basecamp.branding_settings (
  singleton boolean primary key default true check (singleton),
  display_name text not null
    check (length(btrim(display_name)) between 1 and 100),
  logo_path text
    check (logo_path is null or logo_path ~ '^logos/[0-9a-f-]{36}\.(png|jpg|webp)$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table basecamp.branding_settings is
  'The one public Basecamp identity row. Its display name and public logo object path contain no secrets; only a Basecamp super administrator can change them.';

insert into basecamp.branding_settings (singleton, display_name, logo_path)
values (true, 'Basecamp', null);

create table basecamp.branding_audit (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_value jsonb,
  new_value jsonb
);

comment on table basecamp.branding_audit is
  'Append-only record of Basecamp display-name and public-logo-path changes. Written by a trigger, never directly by a client.';

create or replace function basecamp.audit_branding_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into basecamp.branding_audit
    (actor_id, action, old_value, new_value)
  values
    (auth.uid(), lower(tg_op),
     case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
     case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function basecamp.refuse_branding_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  raise exception 'branding audit is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger basecamp_branding_settings_set_updated_at
before update on basecamp.branding_settings
for each row execute function basecamp.set_updated_at();

create trigger basecamp_branding_settings_audit
after insert or update or delete on basecamp.branding_settings
for each row execute function basecamp.audit_branding_change();

create trigger basecamp_branding_audit_no_mutation
before update or delete on basecamp.branding_audit
for each row execute function basecamp.refuse_branding_audit_mutation();

create trigger basecamp_branding_audit_no_truncate
before truncate on basecamp.branding_audit
for each statement execute function basecamp.refuse_branding_audit_mutation();

alter table basecamp.branding_settings enable row level security;
alter table basecamp.branding_audit enable row level security;

create policy basecamp_branding_settings_select_authenticated on basecamp.branding_settings
  for select to authenticated using (true);
create policy basecamp_branding_settings_insert_admin on basecamp.branding_settings
  for insert to authenticated with check ((select basecamp.is_super_admin()));
create policy basecamp_branding_settings_update_admin on basecamp.branding_settings
  for update to authenticated
  using ((select basecamp.is_super_admin())) with check ((select basecamp.is_super_admin()));
create policy basecamp_branding_audit_select_admin on basecamp.branding_audit
  for select to authenticated using ((select basecamp.is_super_admin()));

revoke all on basecamp.branding_settings, basecamp.branding_audit from anon;
grant select on basecamp.branding_settings to authenticated;
grant insert, update on basecamp.branding_settings to authenticated;
grant select on basecamp.branding_audit to authenticated;
revoke delete, truncate on basecamp.branding_settings from anon, authenticated, service_role;
revoke insert, update, delete, truncate on basecamp.branding_audit from anon, authenticated, service_role;

revoke all on function basecamp.audit_branding_change() from public, anon, authenticated, service_role;
revoke all on function basecamp.refuse_branding_audit_mutation() from public, anon, authenticated, service_role;

-- Signed-out screens need exactly two non-secret values, while 0002's security
-- boundary deliberately denies anon USAGE on the entire basecamp schema. This
-- namespaced public-schema RPC is the narrow bridge: its fixed projection
-- cannot expose another Basecamp table or column, and no privileged key is
-- needed by the application.
create or replace function public.basecamp_public_branding()
returns table(display_name text, logo_path text)
language sql
stable
security definer
set search_path to ''
as $$
  select b.display_name, b.logo_path
    from basecamp.branding_settings b
   where b.singleton;
$$;

revoke all on function public.basecamp_public_branding() from public, service_role;
grant execute on function public.basecamp_public_branding() to anon, authenticated;

create or replace function basecamp.configure_branding(
  p_display_name text,
  p_logo_path text
) returns void
language plpgsql
set search_path to ''
as $$
begin
  if not basecamp.is_super_admin() then
    raise exception 'only a Basecamp administrator can configure branding'
      using errcode = 'insufficient_privilege';
  end if;

  insert into basecamp.branding_settings (singleton, display_name, logo_path)
  values (true, btrim(p_display_name), p_logo_path)
  on conflict (singleton) do update
    set display_name = excluded.display_name,
        logo_path = excluded.logo_path;
end;
$$;

revoke all on function basecamp.configure_branding(text, text) from public, anon;
grant execute on function basecamp.configure_branding(text, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'basecamp-branding',
  'basecamp-branding',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy basecamp_branding_objects_insert_admin on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'basecamp-branding'
    and (select basecamp.is_super_admin())
    and name ~ '^logos/[0-9a-f-]{36}\.(png|jpg|webp)$'
  );

create policy basecamp_branding_objects_delete_admin on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'basecamp-branding'
    and (select basecamp.is_super_admin())
    and name ~ '^logos/[0-9a-f-]{36}\.(png|jpg|webp)$'
  );

do $$
declare
  v_table text;
begin
  foreach v_table in array array['branding_settings', 'branding_audit'] loop
    if not (select c.relrowsecurity
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'basecamp' and c.relname = v_table) then
      raise exception 'basecamp.% must have RLS enabled', v_table;
    end if;
  end loop;

  if has_table_privilege('anon', 'basecamp.branding_settings', 'select')
     or has_table_privilege('anon', 'basecamp.branding_settings', 'insert')
     or has_table_privilege('anon', 'basecamp.branding_settings', 'update')
     or has_table_privilege('anon', 'basecamp.branding_settings', 'delete') then
    raise exception 'anonymous clients must reach branding only through the fixed public projection';
  end if;

  if not has_function_privilege('anon', 'public.basecamp_public_branding()', 'execute')
     or has_function_privilege('service_role', 'public.basecamp_public_branding()', 'execute') then
    raise exception 'the public branding projection has the wrong execution boundary';
  end if;

  if has_table_privilege('authenticated', 'basecamp.branding_audit', 'insert')
     or has_table_privilege('authenticated', 'basecamp.branding_audit', 'update')
     or has_table_privilege('authenticated', 'basecamp.branding_audit', 'delete')
     or has_table_privilege('authenticated', 'basecamp.branding_audit', 'truncate') then
    raise exception 'branding audit must remain append-only to clients';
  end if;

  if not exists (
    select 1 from storage.buckets
     where id = 'basecamp-branding'
       and public
       and file_size_limit = 2097152
       and allowed_mime_types @> array['image/png', 'image/jpeg', 'image/webp']::text[]
  ) then
    raise exception 'branding bucket must be public and limited to 2 MB PNG, JPEG, or WebP files';
  end if;
end $$;

commit;
