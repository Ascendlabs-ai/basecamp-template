/**
 * Shapes mirroring schema `basecamp` on a shared Supabase project.
 *
 * Enum members mirror the types created in supabase/migrations/0001_baseline.sql.
 *
 * `entry_type` and `status` are hard unions: the UI branches on them, so a new
 * member genuinely needs code here and a type error is the right way to find
 * out. `host`, `auth_boundary` and `trigger_type` are widened to `string`,
 * because the UI only ever prints them — a value added by migration should
 * render as its raw text, not crash. (An earlier version of this header claimed
 * ALL of them were widened, which was never true of the first two.)
 */

export type EntryType = "launchable" | "reference_only" | "catalog_only";

export type EntryStatus =
  | "active"
  | "coming_soon"
  | "unverified"
  | "retiring"
  | "orphaned"
  | "wind_down";

export interface CatalogEntry {
  id: string;
  slug: string;
  display_name: string;
  technical_name: string | null;
  description: string;
  entry_type: EntryType;
  status: EntryStatus;
  host: string;
  auth_boundary: string;
  trigger_type: string;
  owner: string;
  launch_url: string | null;
  repo_url: string | null;
  runbook_url: string | null;
  source_of_truth_note: string | null;
  last_verified_at: string | null;
  sort_order: number;
}

export interface CatalogCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  entries: CatalogEntry[];
}

/** Columns the home page reads. Kept beside the type so they cannot drift. */
export const ENTRY_COLUMNS =
  "id, slug, display_name, technical_name, description, entry_type, status, host, auth_boundary, trigger_type, owner, launch_url, repo_url, runbook_url, source_of_truth_note, last_verified_at, sort_order";
// Every column here IS rendered — the detail panel (EntryDetailPanel) shows all
// of them. Keep this list and the panel in step: a column fetched but never
// shown is dead weight on every request.
