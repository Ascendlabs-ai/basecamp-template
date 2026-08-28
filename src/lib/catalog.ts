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
/**
 * ONE RULE: keep a category that has something visible inside it.
 *
 * "Inside it" means its own entries, OR — since `0005` — a subcategory that has
 * some. A container parent has no entries of its own EVER, so the plain
 * `entries.length > 0` test drops it and leaves its children rendered as
 * unrelated top-level blocks, with the grouping the administrator built
 * invisible.
 *
 * THE INVARIANT THIS MUST NOT BREAK is the one both callers exist for: a
 * category with nothing visible inside it must not render, because its name and
 * description would be disclosed to somebody granted nothing in it. A parent
 * kept here always has a visible child, so there IS something inside it the
 * viewer can see. `category_or_child_has_grant` (0005) is the database half of
 * the same rule.
 *
 * WHY IT IS A FUNCTION. Both callers had their own copy, and the comment on the
 * second one said out loud what the risk was — "Two filters, one rule; taught to
 * only one of them is how they drift" — while being the second copy. The grant
 * filter and the search filter must agree, so they now read the same code
 * rather than the same paragraph.
 *
 * Takes rows whose `entries` have ALREADY been filtered down to what should
 * count: grants for `visibleCategories`, query matches for `filterCatalog`.
 */
function keepContainerParents<T extends { id: string; parent_id: string | null; entries?: unknown[] | null }>(
  rows: T[],
): T[] {
  const has = (c: T) => (c.entries?.length ?? 0) > 0;
  const parentsWithVisibleChildren = new Set(
    rows.filter((c) => has(c) && c.parent_id).map((c) => c.parent_id as string),
  );
  return rows.filter((c) => has(c) || parentsWithVisibleChildren.has(c.id));
}

export function visibleCategories(rows: CatalogCategory[] | null | undefined): {
  visible: CatalogCategory[];
  categoryCount: number;
  entryCount: number;
} {
  const visible = keepContainerParents(rows ?? []);
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

  const matched = categories.map((c) => ({
    ...c,
    entries: (c.entries ?? []).filter((e) =>
      [e.display_name, e.technical_name, e.description, e.slug, e.owner]
        .some((field) => field?.toLowerCase().includes(needle)),
    ),
  }));

  // A CONTAINER PARENT SURVIVES ITS CHILD'S MATCH — the same rule the grant
  // filter applies, now literally the same code. Without it the grouping was
  // present and then vanished on the first keystroke, with its subcategory
  // promoted to an un-nested heading.
  return keepContainerParents(matched);
}
