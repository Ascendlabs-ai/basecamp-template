"use client";

import { useCallback, useMemo, useState } from "react";

import { categoryTree } from "@/lib/catalogAdmin";
import type { CatalogCategory, CatalogEntry } from "@/types/catalog";

import CategoryBlock from "./CategoryBlock";
import EntryDetailPanel from "./EntryDetailPanel";

/**
 * Owns the client state on this surface — which entry the detail panel shows,
 * and whether the panel is open — and renders every category plus a single
 * shared panel.
 *
 * `open` and `entry` are separate on purpose. Closing sets `open` false but
 * leaves `entry` in place, so the panel keeps its content through the slide-out
 * instead of blanking a frame; `onExited` clears `entry` once the transition
 * has finished. That keeps the whole thing effect-free and ref-free (the strict
 * react-hooks rules reject both a setState-in-effect and a ref read at render).
 *
 * One panel, not one per card: the whole catalog costs one Drawer, not one hidden per entry.
 * The catalog arrives fully shaped from the Server Component; this never fetches
 * and never filters by role — visibility was already decided by RLS upstream.
 */
export default function CatalogView({ categories }: { categories: CatalogCategory[] }) {
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [open, setOpen] = useState(false);

  const openDetail = useCallback((e: CatalogEntry) => {
    setEntry(e);
    setOpen(true);
  }, []);
  const closeDetail = useCallback(() => setOpen(false), []);
  const clearAfterExit = useCallback(() => setEntry(null), []);

  /**
   * Flattened parent-then-children, with each row's DEPTH decided here.
   *
   * `nested` must come from the grouping, not from `category.parent_id`. Those
   * two disagree whenever a parent is filtered out while a child survives —
   * which `visibleCategories` still allows: it keeps a container parent only if
   * one of ITS OWN children is visible, so a child whose parent the viewer
   * cannot see at all arrives here with a `parent_id` naming a row that is not
   * in the list. Reading `parent_id` would call that row "nested" and render an
   * indented `<h3>` under the `<h2>` of an unrelated category: a broken document
   * outline, in the component whose comments claim to protect it. `categoryTree`
   * promotes such a child to top level, which is the honest shape.
   *
   * (An earlier version of this note said a pure container "does not reach this
   * component at all". That stopped being true when `0005` added
   * `category_or_child_has_grant` and `keepContainerParents` mirrored it
   * client-side — container parents now DO arrive, deliberately, so that the
   * grouping an administrator built stays visible. The rule above is unchanged;
   * only the reason it matters is.)
   *
   * One decision, one place.
   *
   * `useMemo` here is NOT for the sidebar search — that state lives in the URL,
   * so a keystroke is a server round trip and `filterCatalog` hands back a
   * freshly-mapped array whose identity changes anyway. It is for the local
   * re-renders this component does on its own: opening and closing the detail
   * panel. (React Compiler is enabled and would cover it; the explicit memo is
   * kept because the dependency is the thing worth stating.)
   */
  const ordered = useMemo(
    () =>
      categoryTree(categories).flatMap(({ category, children }) => [
        { category, nested: false },
        ...children.map((child) => ({ category: child, nested: true })),
      ]),
    [categories],
  );

  // The first block with entries of its own — see `lead` below. Computed over
  // the same ordered list the blocks render from, so the two cannot disagree.
  const leadId = useMemo(
    () => ordered.find(({ category }) => (category.entries?.length ?? 0) > 0)?.category.id ?? null,
    [ordered],
  );

  return (
    <>
      {/* A SUBCATEGORY RENDERS AFTER ITS PARENT, not wherever sort_order puts
          it. `categories` arrives flat and ordered by (sort_order, slug), which
          for a nested row is an order relative to its SIBLINGS — read as a flat
          list it would drop a subcategory somewhere unrelated to its parent.
          The order within each group is untouched; only the grouping is added.

          `lead` keys to the first block that HAS entries, not to the first block
          on the page — since container parents now reach this list, those are not
          always the same block. See the note at the prop. */}
      {ordered.map(({ category, nested }) => (
        <CategoryBlock
          key={category.id}
          category={category}
          // The first category the viewer can see that actually HAS tiles leads
          // and gets the feature treatment.
          //
          // Not `index === 0`. Since container parents reach this list, the first
          // block can be a pure grouping with an empty `entries` array — and the
          // feature treatment over nothing renders a heading, a "0 entries" chip
          // and blank space where the most prominent thing on the page should be,
          // pushing the first real tiles into the ordinary treatment below it.
          // `lead` is about featuring ENTRIES, so it is keyed to the first block
          // that has some rather than to position alone.
          lead={category.id === leadId}
          nested={nested}
          onOpenDetail={openDetail}
        />
      ))}
      <EntryDetailPanel
        entry={entry}
        open={open}
        onClose={closeDetail}
        onExited={clearAfterExit}
      />
    </>
  );
}
