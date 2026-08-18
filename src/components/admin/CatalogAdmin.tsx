"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Snackbar from "@mui/material/Snackbar";

import TopBar from "@/components/shell/TopBar";
import {
  CREATE_CATEGORY_KEY,
  CREATE_ENTRY_KEY,
  REORDER_CATEGORIES_KEY,
  categoryKey,
  entryKey,
  explainWriteError,
  nextSortOrder,
  reorder,
  reorderEntriesKey,
  unsluggable,
  uniqueSlug,
  validateCategory,
  validateEntry,
  type CategoryDraft,
  type EntryDraft,
} from "@/lib/catalogAdmin";
import { createClient } from "@/lib/supabase/client";
import type { AdminCategory, AdminEntry } from "@/types/admin";

import CategoriesPanel from "./CategoriesPanel";
import EntriesPanel from "./EntriesPanel";
import ViewSwitch from "./ViewSwitch";
import { failedWrite, useAdminWrite } from "./useAdminWrite";

/**
 * How many position writes to have in flight at once.
 *
 * `reorder()` returns only the rows that MOVED, which is normally two — but the
 * case the function exists to repair is the fresh install where every
 * `sort_order` is 0, and there the first arrow click renumbers the entire list.
 * A bare `Promise.all` over 200 entries opens 200 requests at once, past the
 * browser's per-origin connection limit and past anything a client's project
 * should be asked to absorb from one click. Chunking bounds it without making
 * the common two-row case any slower.
 */
const REORDER_CONCURRENCY = 6;

type SortUpdate = { id: string; sort_order: number };

/** What a delete confirmation is about. */
type DeleteTarget = { kind: "category" | "entry"; id: string; label: string };

/**
 * Write the new positions.
 *
 * Returns `null` on success, the string `"refused"` when a row came back empty
 * (RLS filtered it, or somebody else deleted it), or the PostgREST error.
 *
 * STILL NOT ATOMIC, and still deliberately so: PostgREST cannot set a different
 * value on each of several rows in one request, so this is one UPDATE per moved
 * row. A failure part-way leaves the list renumbered in part — a cosmetically
 * wrong order rather than a wrong access decision, with every position still a
 * valid one, and the caller re-reads so the screen shows whatever actually
 * landed. Building a rollback that could itself fail halfway would be trading a
 * visible imperfect state for an invisible one.
 */
async function writeSortOrders(
  table: "categories" | "entries",
  updates: SortUpdate[],
): Promise<null | "refused" | { code?: string }> {
  const supabase = createClient();
  for (let i = 0; i < updates.length; i += REORDER_CONCURRENCY) {
    const chunk = updates.slice(i, i + REORDER_CONCURRENCY);
    const results = await Promise.all(
      chunk.map((u) =>
        supabase.from(table).update({ sort_order: u.sort_order }).eq("id", u.id).select("id"),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) return failed.error;
    // Zero rows back from an UPDATE is RLS filtering, not an error — the same
    // trap every other write path on this screen guards against.
    if (results.some((r) => !r.data || r.data.length === 0)) return "refused";
  }
  return null;
}


/**
 * Admin · Catalog — create, edit, reorder and delete the things the catalog is
 * made of.
 *
 * WRITES. Every mutation below goes through the anon key carrying the signed-in
 * administrator's JWT, so the RLS policies on `basecamp.categories` and
 * `basecamp.entries` decide. There is no service_role path and there must never
 * be one: service_role bypasses RLS, which would let this screen write rows the
 * database itself would refuse. Same posture as `/admin/access`, for the same
 * reason.
 *
 * NO OPTIMISTIC UPDATES HERE, and that is a deliberate difference from the
 * access screen. There, a grant toggle is a high-frequency single-boolean write
 * where a round trip per click would be felt, so it carries an optimistic-write
 * machine with a snapshot resync. Here every operation is a considered one — you
 * create an entry, you rename a category — and the rows are wide, so the same
 * machinery would buy imperceptible latency in exchange for reconciling
 * fifteen-column local state against the server's. Each handler writes, then
 * calls `router.refresh()` and lets the server component re-read. The screen is
 * therefore never showing a row the database does not have.
 *
 * A REFUSED WRITE MUST NOT LOOK LIKE A SUCCESSFUL ONE. This is the half that
 * matters for a screen a non-administrator can reach. RLS does not raise on
 * UPDATE or DELETE — the policy FILTERS the row out, so PostgREST answers 204
 * and supabase-js yields `{ error: null }`. Without asking for the affected rows
 * back, a refused delete renders as a completed one. Every update and delete
 * below therefore ends in `.select("id")` and treats zero rows as "that did not
 * apply", exactly as the access screen learned to.
 */
export default function CatalogAdmin({
  initialCategories,
  initialEntries,
  currentUserEmail,
}: {
  initialCategories: AdminCategory[];
  initialEntries: AdminEntry[];
  currentUserEmail: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "categories" ? "categories" : "entries";

  const { run, pending, error, notice, setError, setNotice, resync, isResyncing } = useAdminWrite();

  // `resync` and `isResyncing` come from the hook, which owns the transition so
  // that ITS refresh paths — a throw, a timeout, a transport failure inside
  // `failedWrite` — raise the same flag. `router.refresh()` is fire-and-forget,
  // and a reorder that re-enabled its arrows before the new props landed
  // recomputed from a stale list and silently discarded the next click.

  // Server-owned. These are props rather than state precisely because every
  // handler refreshes the route on success — there is no local edit to preserve
  // across a re-read, so the adjust-state-on-prop-change dance the access screen
  // needs has nothing to do here.
  const categories = initialCategories;
  const entries = initialEntries;

  const [confirming, setConfirming] = useState<DeleteTarget | null>(null);

  const entriesByCategory = useMemo(() => {
    const map = new Map<string, AdminEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.category_id);
      if (list) list.push(entry);
      else map.set(entry.category_id, [entry]);
    }
    return map;
  }, [entries]);

  const setView = useCallback(
    (next: "entries" | "categories") => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "entries") params.delete("view");
      else params.set("view", next);
      // View state in the URL, so a view is linkable — same decision as the
      // access screen, and it is what lets a walkthrough step point a client
      // straight at the categories list.
      router.replace(`/admin/catalog${params.toString() ? `?${params}` : ""}`, { scroll: false });
    },
    [router, searchParams],
  );

  /**
   * Zero rows back from an UPDATE or DELETE.
   *
   * Two causes the client cannot tell apart: RLS refused (the row is still
   * there) or somebody else already removed it (it is not). Both are resolved
   * the same way — ask the server what is true now — and neither may be reported
   * as success.
   */
  const didNotApply = useCallback(() => {
    // Through `resync`, not a bare refresh. On the reorder path a refusal can
    // leave the list PARTLY renumbered, and a bare refresh does not raise
    // `isResyncing` — so every arrow re-enabled instantly against stale props,
    // which is precisely the shape the transition was added to close.
    resync();
    return "That change did not apply. Reloading the current catalog.";
  }, [resync]);

  // ---- Categories --------------------------------------------------------

  const createCategory = useCallback(
    (draft: CategoryDraft) =>
      run(CREATE_CATEGORY_KEY, async () => {
        const fields = validateCategory(draft);
        if (!fields.ok) return fields.message;

        // Generated, never typed. The client is asked for a name; the kebab-case
        // identifier the format CHECK demands is derived from it, and
        // de-duplicated against the slugs already in hand so a second "Sales"
        // becomes `sales-2` rather than a 23505 the client has to interpret.
        const slug = uniqueSlug(fields.row.name, categories.map((c) => c.slug));
        if (!slug) return unsluggable(fields.row.name);

        const supabase = createClient();
        const { error: insError } = await supabase.from("categories").insert({
          slug,
          name: fields.row.name,
          description: fields.row.description,
          sort_order: nextSortOrder(categories),
        });
        if (insError) {
          return (
            explainWriteError("create-category", insError, { slug }) ??
            failedWrite("Could not create the category", insError, resync)
          );
        }
        resync();
        setNotice(`Category "${fields.row.name}" created.`);
        return null;
      }),
    [categories, resync, run, setNotice],
  );

  const updateCategory = useCallback(
    (id: string, draft: CategoryDraft) =>
      run(categoryKey(id), async () => {
        const fields = validateCategory(draft);
        if (!fields.ok) return fields.message;

        const supabase = createClient();
        // `slug` is NOT updated. It is the stable identity — see
        // `validateCategory` — so a rename changes only what people read.
        const { data, error: updError } = await supabase
          .from("categories")
          .update({ name: fields.row.name, description: fields.row.description })
          .eq("id", id)
          .select("id");
        if (updError) {
          return (
            explainWriteError("update-category", updError) ??
            failedWrite("Could not rename the category", updError, resync)
          );
        }
        if (!data || data.length === 0) return didNotApply();
        resync();
        // Renaming was the one write with no confirmation. Because the resync is
        // not awaited, edit mode closes and the row re-renders the OLD name from
        // props for a beat — so with no notice the only feedback a rename got
        // was a brief apparent revert.
        setNotice(`Category renamed to "${fields.row.name}".`);
        return null;
      }),
    [didNotApply, resync, run, setNotice],
  );

  const moveCategory = useCallback(
    (id: string, direction: "up" | "down") =>
      // A LIST-SCOPED KEY, not `categoryKey(id)`. `reorder()` renumbers every
      // row that moved, so this write is not row-local and a per-row claim left
      // every other row's arrows live — see REORDER_CATEGORIES_KEY.
      run(REORDER_CATEGORIES_KEY, async () => {
        const updates = reorder(categories, id, direction);
        // Already at the end. The buttons render unavailable there, so this is
        // the belt to that braces rather than a path anyone reaches.
        if (updates.length === 0) return null;

        const failure = await writeSortOrders("categories", updates);
        if (failure) return failure === "refused" ? didNotApply() : failedWrite("Could not reorder the categories", failure, resync);
        resync();
        return null;
      }),
    [categories, didNotApply, resync, run],
  );

  const deleteCategory = useCallback(
    (id: string) =>
      run(categoryKey(id), async () => {
        const supabase = createClient();
        const { data, error: delError } = await supabase
          .from("categories")
          .delete()
          .eq("id", id)
          .select("id");
        if (delError) {
          return (
            explainWriteError("delete-category", delError) ??
            failedWrite("Could not delete the category", delError, resync)
          );
        }
        if (!data || data.length === 0) return didNotApply();
        resync();
        setNotice("Category deleted.");
        return null;
      }),
    [didNotApply, resync, run, setNotice],
  );

  // ---- Entries -----------------------------------------------------------

  const createEntry = useCallback(
    (draft: EntryDraft) =>
      run(CREATE_ENTRY_KEY, async () => {
        const slug = uniqueSlug(draft.display_name, entries.map((e) => e.slug));
        if (!slug) return unsluggable(draft.display_name);

        const row = validateEntry({ ...draft, slug });
        if (!row.ok) return row.message;

        const supabase = createClient();
        // `row.row.sort_order` is used VERBATIM. It used to be overwritten with
        // `nextSortOrder(...)` unconditionally, which meant the full dialog's
        // "Position" field was honoured on edit and silently discarded on
        // create — a form control that did nothing. The callers are what supply
        // a sensible default now: the quick-add row seeds the draft with
        // `nextSortOrder` for its category, and the dialog recomputes it when
        // the category changes.
        const { error: insError } = await supabase.from("entries").insert(row.row);
        if (insError) {
          return (
            explainWriteError("create-entry", insError, { slug }) ??
            failedWrite("Could not add the entry", insError, resync)
          );
        }
        resync();
        setNotice(`"${row.row.display_name}" added to the catalog.`);
        return null;
      }),
    [entries, resync, run, setNotice],
  );

  /**
   * Resolves `"stale"` distinctly from `"failed"`, and the caller closes the form
   * on either kind of success-or-give-up.
   *
   * This return type exists because a boolean was not enough and the gap was a
   * trap: a stale save left the dialog open holding the SAME spent
   * `updated_at`, so every retry hit the same zero-row branch forever and the
   * only way out was Cancel — which discards what the user typed. The message
   * even promised a reopen that no code performed.
   */
  const updateEntry = useCallback(
    async (id: string, draft: EntryDraft): Promise<"saved" | "stale" | "failed"> => {
      let stale = false;
      const saved = await run(entryKey(id), async () => {
        const row = validateEntry(draft);
        if (!row.ok) return row.message;

        const supabase = createClient();
        // `slug` is in the payload but is the row's EXISTING slug: the edit form
        // carries it through untouched, for the same stable-identity reason
        // categories do not re-slug on rename.
        //
        // THE `updated_at` MATCH IS A LOST-UPDATE GUARD, not decoration. This
        // writes all seventeen columns from a draft frozen when the dialog
        // opened, and that draft survives every resync behind it. Without this
        // clause, saving a name change would silently overwrite a colleague's
        // edit — and, because `sort_order` is in the payload too, would quietly
        // undo any reorder performed while the dialog sat open.
        //
        // A stale match writes nothing and returns zero rows, which falls into
        // the existing `didNotApply()` path for free: the user is told the
        // change did not apply and the screen re-reads. `basecamp.entries` has
        // an `updated_at` column maintained by the `set_updated_at` trigger, so
        // this costs no schema change.
        const { data, error: updError } = await supabase
          .from("entries")
          .update(row.row)
          .eq("id", id)
          .eq("updated_at", draft.updated_at)
          .select("id");
        if (updError) {
          return (
            explainWriteError("update-entry", updError) ??
            failedWrite("Could not save the entry", updError, resync)
          );
        }
        if (!data || data.length === 0) {
          stale = true;
          resync();
          // BOTH causes named, because this branch genuinely cannot tell them
          // apart: the row's `updated_at` moved under the dialog, or RLS
          // filtered the update because the caller is not an administrator.
          // Asserting the first would send a non-admin hunting for a
          // concurrency problem they do not have. What IS certain is that
          // nothing was written, and the caller closes the form — so the
          // sentence describes only what actually happens.
          return "Nothing was saved: the entry changed since you opened it, or the database refused the change. The form has closed — open it again to see the current values.";
        }
        resync();
        setNotice("Entry saved.");
        return null;
      });
      return saved ? "saved" : stale ? "stale" : "failed";
    },
    // No `didNotApply` here: the zero-rows branch above returns its own message
    // for the reason given at it.
    [resync, run, setNotice],
  );

  const moveEntry = useCallback((id: string, direction: "up" | "down") => {
    const entry = entries.find((e) => e.id === id);
    // Unknown id: nothing to claim and nothing to write. Resync so the screen
    // stops showing a row the server does not have.
    if (!entry) {
      resync();
      return Promise.resolve(false);
    }
    // ONE KEY PER CATEGORY. Entries are reordered within their category, so two
    // categories genuinely cannot renumber each other — but two arrows inside
    // one category absolutely can, which is what this serialises.
    return run(reorderEntriesKey(entry.category_id), async () => {
      // Within its own category: that is the list a person is looking at when
      // they click the arrow, and the home page renders entries grouped the
      // same way.
      const siblings = entriesByCategory.get(entry.category_id) ?? [];
      const updates = reorder(siblings, id, direction);
      if (updates.length === 0) return null;

      const failure = await writeSortOrders("entries", updates);
      if (failure) return failure === "refused" ? didNotApply() : failedWrite("Could not reorder the entries", failure, resync);
      resync();
      return null;
    });
  },
    [didNotApply, entries, entriesByCategory, resync, run],
  );

  const deleteEntry = useCallback(
    (id: string) =>
      run(entryKey(id), async () => {
        const supabase = createClient();
        const { data, error: delError } = await supabase
          .from("entries")
          .delete()
          .eq("id", id)
          .select("id");
        if (delError) {
          return (
            explainWriteError("delete-entry", delError) ??
            failedWrite("Could not delete the entry", delError, resync)
          );
        }
        if (!data || data.length === 0) return didNotApply();
        resync();
        setNotice("Entry deleted.");
        return null;
      }),
    [didNotApply, resync, run, setNotice],
  );

  const confirmDelete = useCallback(() => {
    if (!confirming) return;
    const { kind, id } = confirming;
    setConfirming(null);
    if (kind === "category") void deleteCategory(id);
    else void deleteEntry(id);
  }, [confirming, deleteCategory, deleteEntry]);

  return (
    <>
      <TopBar parent="Admin" current="Catalog">
        <ViewSwitch
          value={view}
          label="Catalog view"
          onChange={setView}
          options={[
            // Entries lead, because adding one is what a client comes here to
            // do — categories are the container they pick on the way.
            { value: "entries", label: "Entries" },
            { value: "categories", label: "Categories" },
          ]}
        />
      </TopBar>

      <Box
        component="main"
        id="main-content"
        tabIndex={-1}
        sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}
      >
        {view === "categories" ? (
          <CategoriesPanel
            categories={categories}
            entriesByCategory={entriesByCategory}
            pending={pending}
            isResyncing={isResyncing}
            onCreate={createCategory}
            onUpdate={updateCategory}
            onMove={moveCategory}
            onRequestDelete={(id, label) => setConfirming({ kind: "category", id, label })}
          />
        ) : (
          <EntriesPanel
            categories={categories}
            entries={entries}
            entriesByCategory={entriesByCategory}
            currentUserEmail={currentUserEmail}
            pending={pending}
            isResyncing={isResyncing}
            onCreate={createEntry}
            onUpdate={updateEntry}
            onMove={moveEntry}
            onRequestDelete={(id, label) => setConfirming({ kind: "entry", id, label })}
            onGoToCategories={() => setView("categories")}
          />
        )}
      </Box>

      <DeleteConfirm
        target={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={confirmDelete}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={5000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>

      <Snackbar
        open={error !== null}
        autoHideDuration={9000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" variant="filled" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}

/**
 * Deletion is confirmed, unlike every other write on this screen.
 *
 * The rest are reversible by doing the opposite: a rename can be renamed back, a
 * reorder reordered. A delete is not — `basecamp.entries` has no soft-delete and
 * no undo, and the bin icon sits inches from the arrows people click repeatedly
 * while reordering. Naming the thing in the dialog is the point: "Delete
 * Notion?" is a question somebody can answer correctly at a glance, where "Are
 * you sure?" is one they answer reflexively.
 */
function DeleteConfirm({
  target,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // The last non-null target, kept so the dialog does not rewrite itself while
  // it fades out. `target` goes null the instant Delete or Cancel is pressed and
  // MUI's transition runs on for ~195ms after that — long enough to watch the
  // heading flip from "Delete category?" to "Delete entry?" and the name vanish.
  const [shown, setShown] = useState<DeleteTarget | null>(target);
  if (target !== null && target !== shown) setShown(target);

  return (
    <Dialog open={target !== null} onClose={onCancel} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        Delete {shown?.kind === "category" ? "category" : "entry"}?
      </DialogTitle>
      <DialogContent>
        <DialogContentText>
          <Box component="span" sx={{ fontWeight: 700 }}>
            {shown?.label}
          </Box>{" "}
          will be removed from the catalog. This cannot be undone.
          {shown?.kind === "category"
            ? " A category that still holds entries cannot be deleted — the database refuses it. Any grant that names the category itself goes with it, and each removal is recorded in the access audit log."
            : " Any grant that names it — individual or through a user type — goes with it (the foreign keys cascade), and each removal is recorded in the access audit log."}
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onCancel} sx={{ cursor: "pointer" }}>
          Cancel
        </Button>
        <Button onClick={onConfirm} color="error" variant="contained" sx={{ cursor: "pointer" }}>
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
