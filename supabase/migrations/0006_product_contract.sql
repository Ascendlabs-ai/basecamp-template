-- Basecamp's client-facing contract: Admin/Team, explicit app settings,
-- standards-based OAuth client mappings, and token-time entitlement checks.
-- Apply after 0005_category_nesting.sql.

begin;

create table basecamp.app_settings (
  entry_id uuid primary key references basecamp.entries(id) on delete cascade,
  access_mode text not null default 'selected'
    check (access_mode in ('everyone', 'selected')),
  auth_mode text not null default 'link_only'
    check (auth_mode in ('basecamp_sso', 'external_sign_in', 'link_only')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table basecamp.app_settings is
  'The simple Basecamp product settings for an entry. Everyone means every active Basecamp member; selected means the existing individual/type grant union. Auth mode is a truthful launch label, not proof that a pasted URL supports SSO.';

insert into basecamp.app_settings (entry_id, access_mode, auth_mode, is_active)
select e.id,
       'selected',
       case e.auth_boundary::text
         when 'platform_auth' then 'basecamp_sso'
         when 'external_auth' then 'external_sign_in'
         else 'link_only'
       end,
       e.status::text = 'active'
  from basecamp.entries e
on conflict (entry_id) do nothing;

create table basecamp.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null unique references basecamp.entries(id) on delete cascade,
  client_id uuid not null unique,
  redirect_uris text[] not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(redirect_uris) > 0)
);

comment on table basecamp.oauth_clients is
  'Maps one Supabase OAuth client_id to exactly one Basecamp app. Contains identifiers and exact redirect URIs only; client secrets never belong in this table or browser-facing code.';

create table basecamp.app_configuration_audit (
  id bigint generated always as identity primary key,
  changed_at timestamptz not null default now(),
  actor_id uuid,
  table_name text not null check (table_name in ('app_settings', 'oauth_clients')),
  entry_id uuid,
  action text not null check (action in ('insert', 'update', 'delete')),
  old_value jsonb,
  new_value jsonb
);

comment on table basecamp.app_configuration_audit is
  'Append-only audit of app access/auth mode and OAuth client mapping changes. OAuth secrets and tokens are never accepted by the source tables, so they cannot enter this log.';

create or replace function basecamp.can_access_app_for_user(
  p_user_id uuid,
  p_entry_id uuid
) returns boolean
  language sql
  stable
  security definer
  set search_path to ''
as $$
  select p_user_id is not null
    and exists (
      select 1
        from basecamp.app_settings s
       where s.entry_id = p_entry_id
         and s.is_active
         and (
           exists (select 1 from basecamp.super_admins a where a.user_id = p_user_id)
           or (
             exists (select 1 from basecamp.members m where m.user_id = p_user_id)
             and (
               s.access_mode = 'everyone'
               or exists (
                 select 1
                   from basecamp.entries e
                  where e.id = p_entry_id
                    and (
                      exists (
                        select 1 from basecamp.access_grants g
                         where g.user_id = p_user_id
                           and (g.entry_id = e.id or g.category_id = e.category_id)
                      )
                      or exists (
                        select 1
                          from basecamp.members m
                          join basecamp.type_grants tg
                            on tg.member_type_id = m.member_type_id
                         where m.user_id = p_user_id
                           and (tg.entry_id = e.id or tg.category_id = e.category_id)
                      )
                    )
               )
             )
           )
         )
    );
$$;

create or replace function basecamp.can_read_basecamp_entry(
  p_entry_id uuid
) returns boolean
  language sql
  stable
  security definer
  set search_path to ''
as $$
  select basecamp.can_access_app_for_user(auth.uid(), p_entry_id);
$$;

create or replace function basecamp.can_read_basecamp_category(
  p_category_id uuid
) returns boolean
  language sql
  stable
  security definer
  set search_path to ''
as $$
  select exists (
    select 1
      from basecamp.entries e
     where (
       e.category_id = p_category_id
       or e.category_id in (
         select child.id from basecamp.categories child where child.parent_id = p_category_id
       )
     )
       and basecamp.can_access_app_for_user(auth.uid(), e.id)
  );
$$;

revoke all on function basecamp.can_access_app_for_user(uuid, uuid) from public, anon, authenticated;
revoke all on function basecamp.can_read_basecamp_entry(uuid) from public, anon;
revoke all on function basecamp.can_read_basecamp_category(uuid) from public, anon;
grant execute on function basecamp.can_read_basecamp_entry(uuid) to authenticated;
grant execute on function basecamp.can_read_basecamp_category(uuid) to authenticated;

drop policy if exists basecamp_entries_select_granted on basecamp.entries;
create policy basecamp_entries_select_granted on basecamp.entries
  for select to authenticated
  using ((select basecamp.is_super_admin()) or basecamp.can_read_basecamp_entry(id));

drop policy if exists basecamp_categories_select_granted on basecamp.categories;
create policy basecamp_categories_select_granted on basecamp.categories
  for select to authenticated
  using ((select basecamp.is_super_admin()) or basecamp.can_read_basecamp_category(id));

create or replace function basecamp.enforce_oauth_client_mapping()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_mode text;
  v_uri text;
begin
  select s.auth_mode into v_mode
    from basecamp.app_settings s
   where s.entry_id = new.entry_id;

  if v_mode is distinct from 'basecamp_sso' then
    raise exception 'an OAuth client can map only to an app whose authentication mode is Basecamp SSO'
      using errcode = 'check_violation';
  end if;

  foreach v_uri in array new.redirect_uris loop
    if length(v_uri) > 2048
       or v_uri !~ '^https://[^[:space:]#]+$'
       and v_uri !~ '^http://(localhost|127\\.0\\.0\\.1)(:[0-9]+)?/[^[:space:]#]*$' then
      raise exception 'OAuth redirect URIs require HTTPS, except localhost reference clients'
        using errcode = 'check_violation';
    end if;
  end loop;

  new.updated_at := now();
  return new;
end;
$$;

create trigger basecamp_oauth_clients_validate
before insert or update on basecamp.oauth_clients
for each row execute function basecamp.enforce_oauth_client_mapping();

create or replace function basecamp.audit_app_configuration()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_entry_id uuid;
begin
  v_entry_id := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  insert into basecamp.app_configuration_audit
    (actor_id, table_name, entry_id, action, old_value, new_value)
  values
    (auth.uid(), tg_table_name, v_entry_id, lower(tg_op),
     case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
     case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger basecamp_app_settings_set_updated_at
before update on basecamp.app_settings
for each row execute function basecamp.set_updated_at();
create trigger basecamp_app_settings_audit
after insert or update or delete on basecamp.app_settings
for each row execute function basecamp.audit_app_configuration();
create trigger basecamp_oauth_clients_audit
after insert or update or delete on basecamp.oauth_clients
for each row execute function basecamp.audit_app_configuration();

create or replace function basecamp.refuse_app_configuration_audit_mutation()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  raise exception 'app configuration audit is append-only' using errcode = 'insufficient_privilege';
end;
$$;

create trigger basecamp_app_configuration_audit_no_mutation
before update or delete on basecamp.app_configuration_audit
for each row execute function basecamp.refuse_app_configuration_audit_mutation();
create trigger basecamp_app_configuration_audit_no_truncate
before truncate on basecamp.app_configuration_audit
for each statement execute function basecamp.refuse_app_configuration_audit_mutation();

alter table basecamp.app_settings enable row level security;
alter table basecamp.oauth_clients enable row level security;
alter table basecamp.app_configuration_audit enable row level security;

create policy basecamp_app_settings_select_scoped on basecamp.app_settings
  for select to authenticated
  using ((select basecamp.is_super_admin()) or basecamp.can_read_basecamp_entry(entry_id));
create policy basecamp_app_settings_insert_admin on basecamp.app_settings
  for insert to authenticated with check ((select basecamp.is_super_admin()));
create policy basecamp_app_settings_update_admin on basecamp.app_settings
  for update to authenticated
  using ((select basecamp.is_super_admin())) with check ((select basecamp.is_super_admin()));
create policy basecamp_app_settings_delete_admin on basecamp.app_settings
  for delete to authenticated using ((select basecamp.is_super_admin()));

create policy basecamp_oauth_clients_select_scoped on basecamp.oauth_clients
  for select to authenticated
  using ((select basecamp.is_super_admin()) or basecamp.can_read_basecamp_entry(entry_id));
create policy basecamp_oauth_clients_insert_admin on basecamp.oauth_clients
  for insert to authenticated with check ((select basecamp.is_super_admin()));
create policy basecamp_oauth_clients_update_admin on basecamp.oauth_clients
  for update to authenticated
  using ((select basecamp.is_super_admin())) with check ((select basecamp.is_super_admin()));
create policy basecamp_oauth_clients_delete_admin on basecamp.oauth_clients
  for delete to authenticated using ((select basecamp.is_super_admin()));

create policy basecamp_app_configuration_audit_select_admin on basecamp.app_configuration_audit
  for select to authenticated using ((select basecamp.is_super_admin()));

grant select, insert, update, delete on basecamp.app_settings to authenticated;
grant select, insert, update, delete on basecamp.oauth_clients to authenticated;
grant select on basecamp.app_configuration_audit to authenticated;
revoke insert, update, delete, truncate on basecamp.app_configuration_audit from authenticated, service_role;

revoke all on function basecamp.enforce_oauth_client_mapping() from public, anon, authenticated, service_role;
revoke all on function basecamp.audit_app_configuration() from public, anon, authenticated, service_role;
revoke all on function basecamp.refuse_app_configuration_audit_mutation() from public, anon, authenticated, service_role;
+
create or replace function basecamp.configure_app(
  p_entry_id uuid,
  p_access_mode text,
  p_auth_mode text,
  p_is_active boolean,
  p_selected_user_ids uuid[],
  p_oauth_client_id uuid,
  p_redirect_uris text[],
  p_oauth_enabled boolean
) returns void
language plpgsql
set search_path to ''
as $$
begin
  if not basecamp.is_super_admin() then
    raise exception 'only a Basecamp administrator can configure apps'
      using errcode = 'insufficient_privilege';
  end if;

  if p_access_mode = 'selected' and exists (
    select 1
      from unnest(coalesce(p_selected_user_ids, array[]::uuid[])) selected(user_id)
     where not exists (select 1 from basecamp.members m where m.user_id = selected.user_id)
       and not exists (select 1 from basecamp.super_admins a where a.user_id = selected.user_id)
  ) then
    raise exception 'selected app access is limited to Basecamp members'
      using errcode = 'foreign_key_violation';
  end if;

  insert into basecamp.app_settings (entry_id, access_mode, auth_mode, is_active)
  values (
    p_entry_id,
    p_access_mode,
    p_auth_mode,
    case when p_auth_mode = 'basecamp_sso' then false else p_is_active end
  )
  on conflict (entry_id) do update
    set access_mode = excluded.access_mode,
        auth_mode = excluded.auth_mode,
        is_active = excluded.is_active;

  delete from basecamp.access_grants where entry_id = p_entry_id;
  if p_access_mode = 'selected' then
    insert into basecamp.access_grants (user_id, entry_id, category_id)
    select distinct selected.user_id, p_entry_id, null
      from unnest(coalesce(p_selected_user_ids, array[]::uuid[])) selected(user_id);
  end if;

  if p_auth_mode = 'basecamp_sso' then
    if p_oauth_client_id is null or cardinality(coalesce(p_redirect_uris, array[]::text[])) = 0 then
      raise exception 'Basecamp SSO requires an OAuth client and redirect URI'
        using errcode = 'check_violation';
    end if;
    insert into basecamp.oauth_clients (entry_id, client_id, redirect_uris, enabled)
    values (p_entry_id, p_oauth_client_id, p_redirect_uris, p_oauth_enabled)
    on conflict (entry_id) do update
      set client_id = excluded.client_id,
          redirect_uris = excluded.redirect_uris,
          enabled = excluded.enabled;
  else
    delete from basecamp.oauth_clients where entry_id = p_entry_id;
  end if;

  if p_auth_mode = 'basecamp_sso' and p_is_active then
    update basecamp.app_settings set is_active = true where entry_id = p_entry_id;
  end if;
end;
$$;

comment on function basecamp.configure_app(uuid, text, text, boolean, uuid[], uuid, text[], boolean) is
  'Atomically saves app settings, selected-person grants and the OAuth mapping on the signed-in administrator session. SSO stays inactive until its mapping validates; any failure rolls the whole configuration back.';

revoke all on function basecamp.configure_app(uuid, text, text, boolean, uuid[], uuid, text[], boolean) from public, anon;
grant execute on function basecamp.configure_app(uuid, text, text, boolean, uuid[], uuid, text[], boolean) to authenticated;


create or replace function basecamp.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_claims jsonb := event->'claims';
  v_client_id_text text := jsonb_extract_path_text(event, 'claims', 'client_id');
  v_user_id_text text := coalesce(event->>'user_id', jsonb_extract_path_text(event, 'claims', 'sub'));
  v_entry_id uuid;
begin
  if v_client_id_text is null then
    return jsonb_build_object('claims', v_claims);
  end if;

  if v_client_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or v_user_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'This OAuth client is not authorized for Basecamp.'
    ));
  end if;

  select c.entry_id into v_entry_id
    from basecamp.oauth_clients c
   where c.client_id = v_client_id_text::uuid
     and c.enabled
     and basecamp.can_access_app_for_user(v_user_id_text::uuid, c.entry_id);

  if v_entry_id is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'You do not have access to this Basecamp app.'
    ));
  end if;

  v_claims := jsonb_set(v_claims, '{basecamp_entry_id}', to_jsonb(v_entry_id::text), true);
  v_claims := jsonb_set(v_claims, '{basecamp_access}', '"granted"'::jsonb, true);
  return jsonb_build_object('claims', v_claims);
end;
$$;

revoke all on function basecamp.custom_access_token_hook(jsonb) from public, anon, authenticated, service_role;
grant usage on schema basecamp to supabase_auth_admin;
grant execute on function basecamp.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- Assertions: the new tables are locked, ordinary members cannot configure
-- apps, trigger functions are not callable, the token hook is Auth-only, and
-- inactive apps cannot issue tokens even to a Basecamp superadmin.
do $$
declare
  v_table text;
begin
  foreach v_table in array array['app_settings', 'oauth_clients', 'app_configuration_audit'] loop
    if not (select c.relrowsecurity
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'basecamp' and c.relname = v_table) then
      raise exception 'basecamp.% must have RLS enabled', v_table;
    end if;
  end loop;

  if has_function_privilege('authenticated', 'basecamp.custom_access_token_hook(jsonb)', 'execute')
     or has_function_privilege('anon', 'basecamp.custom_access_token_hook(jsonb)', 'execute')
     or not has_function_privilege('supabase_auth_admin', 'basecamp.custom_access_token_hook(jsonb)', 'execute') then
    raise exception 'custom_access_token_hook must be executable only by Supabase Auth';
  end if;

  if has_table_privilege('authenticated', 'basecamp.app_configuration_audit', 'insert')
     or has_table_privilege('authenticated', 'basecamp.app_configuration_audit', 'update')
     or has_table_privilege('authenticated', 'basecamp.app_configuration_audit', 'delete')
     or has_table_privilege('authenticated', 'basecamp.app_configuration_audit', 'truncate') then
    raise exception 'app configuration audit must remain append-only to clients';
  end if;
end $$;

commit;
