import type { CatalogCategory } from "@/types/catalog";

/**
 * Decide what the catalog page actually renders, and the counts it announces.
 *
 * Extracted from the page component on purpose. This is the only pure,
 * security-relevant logic in that file: it decides whether a category the
 * viewer can see but whose entries they cannot renders as a bare heading —
 * i.e. whether a grant on an empty category discloses that category's name and
 * description. The database half of that invariant is asserted and
 * enforced by the read policies; welded inside an async Server Component
 * the app half could not be tested at all.
 *
 * Deliberately NOT the query. The query belongs in the page: `createClient()`
 * reads `cookies()`, so it is intrinsically request-scoped, and a standalone
 * `getCatalog()` in lib/ is an inviting place for a future session to wrap in
 * `use cache` or `unstable_cache` — which would serve one user's rows to
 * everyone, because visibility here comes from RLS and not from the query.
 */
export function visibleCategories(rows: CatalogCategory[] | null | undefined): {
  visible: CatalogCategory[];
  categoryCount: number;
  entryCount: number;
} {
  const visible = (rows ?? []).filter((c) => (c.entries?.length ?? 0) > 0);
  return {
    visible,
    categoryCount: visible.length,
    entryCount: visible.reduce((n, c) => n + (c.entries?.length ?? 0), 0),
  };
}

/**
 * The sidebar's "Search across apps", applied to the catalog.
 *
 * Filters ENTRIES and then drops categories left empty, so a search never
 * renders a bare category heading — the same invariant `visibleCategories`
 * protects for grants. A blank or whitespace-only query returns the input
 * untouched rather than an empty list.
 *
 * Matches on the fields a person would search by: display name, technical name,
 * description, slug and owner. Deliberately NOT on `source_of_truth_note` or
 * the URL columns — those are long, and matching them produces hits whose
 * reason is invisible on the card face.
 *
 * Case-insensitive substring, not fuzzy: this runs over a modest number of rows against a
 * string the user is still typing, and a fuzzy matcher's false positives would
 * cost more than its recall gains.
 */
export function filterCatalog(
  categories: CatalogCategory[],
  query: string | null | undefined,
): CatalogCategory[] {
  const needle = (query ?? "").trim().toLowerCase();
  if (!needle) return categories;

  return categories
    .map((c) => ({
      ...c,
      entries: (c.entries ?? []).filter((e) =>
        [e.display_name, e.technical_name, e.description, e.slug, e.owner]
          .some((field) => field?.toLowerCase().includes(needle)),
      ),
    }))
    .filter((c) => c.entries.length > 0);
}
