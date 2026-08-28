-- Example catalog — SAFE TO RUN, SAFE TO DELETE.
--
-- WHAT THIS IS FOR, now that there IS an entry-creation UI. Admin -> Catalog can
-- create, rename, reorder, nest and delete everything below, and for building
-- your real catalog it is the better tool — it derives slugs, validates against
-- every CHECK before it writes, and cannot offer you something the database
-- would refuse. This file exists for the other job: showing what a FULL row
-- looks like, all at once, with the non-obvious constraints written out. Run it
-- to get a catalog you can click around while you learn the shape, then delete
-- the rows and build your own on the screen.
--
-- Run in the SQL Editor AFTER 0001 and 0002 — and after 0005 if you want the
-- subcategory rows below to apply, since `parent_id` does not exist before it.
-- It connects as postgres, so RLS does not apply and no grant is needed.
-- Re-running it is a no-op.
--
-- Constraints worth knowing before writing your own rows:
--   * slug is kebab-case and unique:  ^[a-z0-9]+(-[a-z0-9]+)*$
--   * display_name, description and owner are NOT NULL and non-blank
--   * entry_type = 'launchable' REQUIRES a well-formed http(s) launch_url
--   * nav_group may only be set on a launchable entry, and only the sidebar
--     reads it — it grants nothing
--   * host / auth_boundary / trigger_type are enums; extend with
--     ALTER TYPE ... ADD VALUE if no shipped label fits
--
-- Nobody can SEE any of this until they are granted it (or are a super_admin).
-- An empty catalog after seeding is the access model working, not a bug.

begin;

insert into basecamp.categories (slug, name, description, sort_order) values
  ('priority', 'Priority', 'The current focus. Held to a small number of entries on purpose.', 10)
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order, nav_group)
select c.id, 'analytics', 'Analytics Dashboard', 'analytics-dashboard', 'Traffic, funnels and revenue in one place.', 'launchable'::basecamp.entry_type, 'active'::basecamp.entry_status, 'vercel'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'user'::basecamp.entry_trigger_type, 'Data team', 'https://analytics.example.com', 'https://github.com/example-org/analytics-dashboard', null, 'Provenance: confirmed against the deployment on the date shown.', 10, 'operations'::basecamp.nav_group
  from basecamp.categories c where c.slug = 'priority'
on conflict (slug) do nothing;

insert into basecamp.categories (slug, name, description, sort_order) values
  ('core-internal', 'Core internal', 'The tools the team uses every day.', 20)
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order, nav_group)
select c.id, 'crm', 'Account Book', 'account-book', 'Accounts, contacts and renewal dates.', 'launchable'::basecamp.entry_type, 'active'::basecamp.entry_status, 'vercel'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'user'::basecamp.entry_trigger_type, 'Operations', 'https://crm.example.com', 'https://github.com/example-org/account-book', null, 'Provenance: recorded from the owning team, not independently checked.', 10, 'sales'::basecamp.nav_group
  from basecamp.categories c where c.slug = 'core-internal'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order, nav_group)
select c.id, 'docs', 'Team Handbook', 'handbook', 'How we work: policies, runbooks and onboarding.', 'launchable'::basecamp.entry_type, 'active'::basecamp.entry_status, 'vercel'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'user'::basecamp.entry_trigger_type, 'Operations', 'https://handbook.example.com', null, null, 'Provenance: inherited from the previous inventory; re-verify before relying on it.', 20, 'operations'::basecamp.nav_group
  from basecamp.categories c where c.slug = 'core-internal'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order, nav_group)
select c.id, 'outbound', 'Outbound Engine', 'sales-engine', 'Sequenced outreach with an approval step.', 'launchable'::basecamp.entry_type, 'coming_soon'::basecamp.entry_status, 'vercel'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'user'::basecamp.entry_trigger_type, 'Sales', 'https://outbound.example.com', 'https://github.com/example-org/outbound-engine', null, 'Launch pencilled for next quarter.', 30, 'operations'::basecamp.nav_group
  from basecamp.categories c where c.slug = 'core-internal'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order, nav_group)
select c.id, 'status-board', 'Status Board', 'status-board', 'Uptime and incident status for the services the team runs.', 'launchable'::basecamp.entry_type, 'active'::basecamp.entry_status, 'vercel'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'cron'::basecamp.entry_trigger_type, 'Platform', 'https://status.example.com', null, 'https://handbook.example.com/runbooks/status', 'Provenance: unconfirmed since the last reorg.', 40, 'operations'::basecamp.nav_group
  from basecamp.categories c where c.slug = 'core-internal'
on conflict (slug) do nothing;

insert into basecamp.categories (slug, name, description, sort_order) values
  ('automations', 'Automations', 'Scheduled and event-driven jobs. Nothing here has a screen.', 30)
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'nightly-sync', 'Nightly CRM Sync', 'crm-sync', 'Pushes closed deals into the warehouse each night.', 'catalog_only'::basecamp.entry_type, 'active'::basecamp.entry_status, 'supabase_edge'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'cron'::basecamp.entry_trigger_type, 'Data team', null, 'https://github.com/example-org/crm-sync', null, 'Provenance: confirmed against the deployment on the date shown.', 10
  from basecamp.categories c where c.slug = 'automations'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'invoice-mailer', 'Invoice Mailer', 'invoice-mailer', 'Emails invoices when a deal moves to Won.', 'catalog_only'::basecamp.entry_type, 'active'::basecamp.entry_status, 'supabase_edge'::basecamp.entry_host, 'platform_auth'::basecamp.entry_auth_boundary, 'webhook'::basecamp.entry_trigger_type, 'Finance', null, null, null, 'Provenance: recorded from the owning team, not independently checked.', 20
  from basecamp.categories c where c.slug = 'automations'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'lead-router', 'Lead Router', 'lead-router', 'Assigns inbound leads round-robin.', 'catalog_only'::basecamp.entry_type, 'unverified'::basecamp.entry_status, 'n8n'::basecamp.entry_host, 'unknown'::basecamp.entry_auth_boundary, 'webhook'::basecamp.entry_trigger_type, 'Sales', null, null, null, 'Owner unconfirmed since the last reorg.', 30
  from basecamp.categories c where c.slug = 'automations'
on conflict (slug) do nothing;

insert into basecamp.categories (slug, name, description, sort_order) values
  ('reference', 'Reference', 'Documentation and knowledge. Nothing to launch.', 40)
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'brand-kit', 'Brand Kit', 'brand-kit', 'Logos, colour tokens and type scale.', 'reference_only'::basecamp.entry_type, 'active'::basecamp.entry_status, 'none'::basecamp.entry_host, 'none'::basecamp.entry_auth_boundary, 'manual'::basecamp.entry_trigger_type, 'Design', null, null, null, 'Provenance: inherited from the previous inventory; re-verify before relying on it.', 10
  from basecamp.categories c where c.slug = 'reference'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'security-policy', 'Security Policy', 'security-policy', 'Access rules, retention and incident response.', 'reference_only'::basecamp.entry_type, 'active'::basecamp.entry_status, 'none'::basecamp.entry_host, 'none'::basecamp.entry_auth_boundary, 'manual'::basecamp.entry_trigger_type, 'Operations', null, null, null, 'Provenance: unconfirmed since the last reorg.', 20
  from basecamp.categories c where c.slug = 'reference'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'legacy-portal', 'Legacy Portal', 'legacy-portal', 'The old intranet. Read-only, kept for archive access.', 'reference_only'::basecamp.entry_type, 'retiring'::basecamp.entry_status, 'wordpress'::basecamp.entry_host, 'external_auth'::basecamp.entry_auth_boundary, 'user'::basecamp.entry_trigger_type, 'Operations', 'https://legacy.example.com', null, null, 'Scheduled for shutdown once the handbook migration completes.', 30
  from basecamp.categories c where c.slug = 'reference'
on conflict (slug) do nothing;

insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
select c.id, 'vendor-list', 'Vendor List', 'vendor-list', 'Who we pay, for what, and when it renews.', 'reference_only'::basecamp.entry_type, 'orphaned'::basecamp.entry_status, 'none'::basecamp.entry_host, 'unknown'::basecamp.entry_auth_boundary, 'manual'::basecamp.entry_trigger_type, 'Unassigned', null, null, null, 'No owner since the last reorg.', 40
  from basecamp.categories c where c.slug = 'reference'
on conflict (slug) do nothing;

-- ONE SUBCATEGORY, so the example covers nesting as well as entries.
--
-- `parent_id` arrives in 0005. This block is guarded so the file still applies
-- cleanly on a database that has not had 0005 yet — it skips, rather than
-- aborting the whole transaction on `42703 column does not exist` and taking
-- every other row with it. (It would: this file is one transaction.)
--
-- Nesting is capped at ONE level by a trigger, in both directions: this row can
-- hold entries but cannot hold another category, and `reference` cannot be given
-- a parent while this row hangs off it.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'basecamp' and table_name = 'categories'
                and column_name = 'parent_id') then
    execute $q$
      insert into basecamp.categories (slug, name, description, sort_order, parent_id)
      select 'runbooks', 'Runbooks', 'Step-by-step procedures. Sits under Reference.', 10, c.id
        from basecamp.categories c where c.slug = 'reference'
      on conflict (slug) do nothing;
    $q$;
    execute $q$
      insert into basecamp.entries (category_id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, sort_order)
      select c.id, 'oncall-runbook', 'On-call Runbook', 'oncall-runbook', 'What to do when the pager goes off, in order.', 'reference_only'::basecamp.entry_type, 'active'::basecamp.entry_status, 'none'::basecamp.entry_host, 'none'::basecamp.entry_auth_boundary, 'manual'::basecamp.entry_trigger_type, 'Operations', null, null, null, 'Provenance: reviewed at the last incident review.', 10
        from basecamp.categories c where c.slug = 'runbooks'
      on conflict (slug) do nothing;
    $q$;
  else
    raise notice 'skipping the subcategory example: basecamp.categories.parent_id does not exist, so 0005 has not been applied';
  end if;
end $$;

commit;

-- To remove everything this file inserted. ORDER MATTERS on the categories:
-- `categories.parent_id` is ON DELETE RESTRICT, and RESTRICT is checked per row
-- immediately, so deleting a parent and its subcategory in ONE statement is
-- refused (23503) even though that statement would have removed both.
--   delete from basecamp.entries;
--   delete from basecamp.categories where parent_id is not null;
--   delete from basecamp.categories;
