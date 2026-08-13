"use client";

import { useCallback, useState } from "react";

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
 * One panel, not one per card: 44 entries cost one Drawer, not 44 hidden ones.
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

  return (
    <>
      {categories.map((category, index) => (
        <CategoryBlock
          key={category.id}
          category={category}
          // The first category the viewer can see (highest sort_order —
          // Priority, for anyone granted it) leads and gets the feature
          // treatment. Keyed to POSITION, not to per-user entry count — which is
          // the honest available signal; see CategoryBlock.
          lead={index === 0}
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
