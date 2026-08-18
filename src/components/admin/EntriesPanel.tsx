"use client";

import { useRef, useState } from "react";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ArrowDownwardRoundedIcon from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRoundedIcon from "@mui/icons-material/ArrowUpwardRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  CREATE_ENTRY_KEY,
  ENTRY_DEFAULTS,
  entryKey,
  inRenderOrder,
  nextSortOrder,
  reorderEntriesKey,
  type EntryDraft,
} from "@/lib/catalogAdmin";
import type { AdminCategory, AdminEntry } from "@/types/admin";

import EntryDialog from "./EntryDialog";

/**
 * Admin · Catalog · Entries — the catalog itself.
 *
 * TWO WAYS IN, on purpose. The row at the top takes a name, a URL and a
 * category, and is what the guided walkthrough's "add your first app" step
 * describes: three fields, and the seven other NOT NULL columns filled from
 * `ENTRY_DEFAULTS`. "All fields" opens the same write with nothing defaulted,
 * for an entry that is not a launchable app or that needs an owner recorded.
 *
 * Entries are listed under their category and reordered within it, because that
 * is how the home page groups them — an arrow that moved an entry past a
 * category boundary would be moving it to a different category, which is what
 * the edit form's category select is for.
 */
export default function EntriesPanel({
  categories,
  entries,
  entriesByCategory,
  currentUserEmail,
  pending,
  isResyncing,
  onCreate,
  onUpdate,
  onMove,
  onRequestDelete,
  onGoToCategories,
}: {
  categories: AdminCategory[];
  entries: AdminEntry[];
  entriesByCategory: Map<string, AdminEntry[]>;
  currentUserEmail: string;
  pending: Set<string>;
  /** True while a resync is in flight, so reorder controls stay unavailable. */
  isResyncing: boolean;
  onCreate: (draft: EntryDraft) => Promise<boolean>;
  /** `"stale"` means nothing was written and the form must not stay open. */
  onUpdate: (id: string, draft: EntryDraft) => Promise<"saved" | "stale" | "failed">;
  onMove: (id: string, direction: "up" | "down") => void;
  onRequestDelete: (id: string, label: string) => void;
  onGoToCategories: () => void;
}) {
  const orderedCategories = inRenderOrder(categories);

  const [quickName, setQuickName] = useState("");
  const [quickUrl, setQuickUrl] = useState("");
  const [quickCategory, setQuickCategory] = useState(orderedCategories[0]?.id ?? "");
  // A DISCRIMINATED UNION, so `id` is a string exactly when the mode is "edit".
  // The previous shape (`id: string | null` for both modes) forced a non-null
  // assertion at the submit call — safe by construction, but only because one
  // call site happened to set them together. This makes it true by type.
  const [dialog, setDialog] = useState<
    | { mode: "create"; draft: EntryDraft }
    | { mode: "edit"; id: string; draft: EntryDraft }
    | null
  >(null);
  /** Focus returns here after a successful quick add, ready for the next one. */
  const nameField = useRef<HTMLInputElement>(null);

  const createPending = pending.has(CREATE_ENTRY_KEY);

  /**
   * The category the quick-add row is pointing at, clamped at render.
   *
   * `quickCategory` is initialised once, and the hook runs before the
   * empty-state early return below — so a client who lands with no categories,
   * then has four arrive through a resync, holds `""` and sees a blank select
   * whose Add always fails. The same state can point at a category another
   * administrator has since deleted, which would send a dead `category_id` to a
   * foreign key. Falling back at render keeps it valid without an effect.
   */
  const selectedCategory = orderedCategories.some((c) => c.id === quickCategory)
    ? quickCategory
    : orderedCategories[0]?.id ?? "";

  const quickAddBlocked = quickName.trim() === "" || quickUrl.trim() === "" || createPending;

  /** A blank draft: the defaults, plus whatever the quick row already holds. */
  function blankDraft(categoryId: string): EntryDraft {
    return {
      category_id: categoryId,
      display_name: quickName,
      slug: "",
      description: "",
      entry_type: ENTRY_DEFAULTS.entry_type,
      status: ENTRY_DEFAULTS.status,
      host: ENTRY_DEFAULTS.host,
      auth_boundary: ENTRY_DEFAULTS.auth_boundary,
      trigger_type: ENTRY_DEFAULTS.trigger_type,
      owner: "",
      launch_url: quickUrl,
      repo_url: "",
      runbook_url: "",
      technical_name: "",
      source_of_truth_note: "",
      nav_group: "",
      sort_order: nextSortOrder(entriesByCategory.get(categoryId) ?? []),
      fallbackOwner: currentUserEmail,
      // No row to be stale against on the create path.
      updated_at: "",
    };
  }

  /** An existing row as the form sees it: nulls become the empty string. */
  function draftFrom(entry: AdminEntry): EntryDraft {
    return {
      category_id: entry.category_id,
      display_name: entry.display_name,
      // Carried through untouched. The slug is the row's stable identity and no
      // field on the form edits it.
      slug: entry.slug,
      description: entry.description,
      entry_type: entry.entry_type,
      status: entry.status,
      host: entry.host,
      auth_boundary: entry.auth_boundary,
      trigger_type: entry.trigger_type,
      owner: entry.owner,
      launch_url: entry.launch_url ?? "",
      repo_url: entry.repo_url ?? "",
      runbook_url: entry.runbook_url ?? "",
      technical_name: entry.technical_name ?? "",
      source_of_truth_note: entry.source_of_truth_note ?? "",
      nav_group: entry.nav_group ?? "",
      sort_order: entry.sort_order,
      fallbackOwner: currentUserEmail,
      updated_at: entry.updated_at,
    };
  }

  // Nothing can be added until something can hold it: `entries.category_id` is
  // NOT NULL. Rather than offer a form whose every submission would fail, the
  // panel sends the client one click away to make a category first.
  if (categories.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{ maxWidth: 520, mx: "auto", mt: { xs: 2, md: 6 }, p: { xs: 3, sm: 4 }, textAlign: "center", border: 1, borderColor: "divider" }}
      >
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
          Make a category first
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7, mb: 2.5 }}>
          Every entry lives in a category, so there has to be one before you can
          add anything. If you provisioned the database with the starter seed you
          would already have four — this app has none, so make one now.
        </Typography>
        <Button variant="contained" onClick={onGoToCategories} sx={{ cursor: "pointer" }}>
          Go to Categories
        </Button>
      </Paper>
    );
  }

  return (
    <>
      <Paper elevation={0} sx={{ border: 1, borderColor: "divider", p: { xs: 1.5, sm: 2 }, mb: 2 }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, mb: 0.25 }}>
          Add an app
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1.5 }}>
          A name, its address, and where it belongs. Everything else gets a
          sensible default you can change later.
        </Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} alignItems={{ md: "flex-start" }}>
          <TextField
            size="small"
            label="Name"
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
            placeholder="e.g. Notion"
            inputRef={nameField}
            sx={{ flex: 1, minWidth: 0 }}
          />
          {/* REQUIRED, and marked as such. `ENTRY_DEFAULTS.entry_type` is
              `launchable`, which drags in
              `basecamp_entries_launchable_requires_launch_url` — so gating Add
              on the name alone put a guaranteed refusal one click away, on the
              first write a new client ever attempts. Either the field is
              required or the default is not launchable; this is the cheaper
              half, and a URL is what "add an app" means. */}
          <TextField
            size="small"
            label="URL"
            required
            value={quickUrl}
            onChange={(e) => setQuickUrl(e.target.value)}
            placeholder="https://…"
            helperText="Needed to open it from the catalog."
            sx={{ flex: 1.4, minWidth: 0 }}
          />
          <TextField
            select
            size="small"
            label="Category"
            value={selectedCategory}
            onChange={(e) => setQuickCategory(e.target.value)}
            sx={{ flex: 1, minWidth: 0 }}
          >
            {orderedCategories.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
            {/* `aria-disabled`, NOT `disabled` — this button becomes
                unavailable AS A RESULT OF SUCCEEDING (the handler clears the
                name), and a real `disabled` would drop keyboard focus to
                <body> after every add. The repo's own rule, stated in
                AccessMatrix.tsx. */}
            <Button
              variant="contained"
              size="small"
              startIcon={createPending ? <CircularProgress size={14} color="inherit" /> : <AddRoundedIcon />}
              aria-disabled={quickAddBlocked}
              onClick={() => {
                if (quickAddBlocked) return;
                void onCreate(blankDraft(selectedCategory)).then((created) => {
                  // Cleared on SUCCESS only, so a refusal leaves the typed
                  // values in place to be corrected.
                  if (created) {
                    setQuickName("");
                    setQuickUrl("");
                    nameField.current?.focus();
                  }
                });
              }}
              sx={{
                cursor: quickAddBlocked ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                ...(quickAddBlocked
                  ? { backgroundColor: "action.disabledBackground", color: "action.disabled", "&:hover": { backgroundColor: "action.disabledBackground" } }
                  : {}),
              }}
            >
              Add
            </Button>
            <Button
              size="small"
              onClick={() => setDialog({ mode: "create", draft: blankDraft(selectedCategory) })}
              sx={{ cursor: "pointer", whiteSpace: "nowrap" }}
            >
              All fields…
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Stack spacing={2}>
        {orderedCategories.map((category) => {
          const inCategory = inRenderOrder(entriesByCategory.get(category.id) ?? []);
          // Every arrow in THIS category — a reorder renumbers the whole list,
          // so until the resync lands the positions on screen are not the
          // positions in the database.
          const reordering = pending.has(reorderEntriesKey(category.id)) || isResyncing;
          return (
            <Paper
              key={category.id}
              elevation={0}
              component="section"
              aria-labelledby={`cat-${category.slug}`}
              sx={{ border: 1, borderColor: "divider", p: { xs: 1.5, sm: 2 } }}
            >
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: inCategory.length ? 1.5 : 0 }}>
                <Typography
                  id={`cat-${category.slug}`}
                  component="h2"
                  sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "text.secondary", flex: 1 }}
                >
                  {category.name}
                </Typography>
                <Typography sx={{ fontSize: 11, color: "text.secondary" }}>
                  {inCategory.length} {inCategory.length === 1 ? "entry" : "entries"}
                </Typography>
              </Stack>

              {inCategory.length === 0 ? (
                <Typography sx={{ fontSize: 12.5, color: "text.secondary", py: 1 }}>
                  Nothing in here yet.
                </Typography>
              ) : (
                <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
                  {inCategory.map((entry, index) => {
                    const busy = pending.has(entryKey(entry.id));
                    const first = index === 0;
                    const last = index === inCategory.length - 1;
                    return (
                      <Box
                        component="li"
                        key={entry.id}
                        sx={{
                          border: 1,
                          borderColor: "divider",
                          borderRadius: 2.5,
                          px: { xs: 1.5, sm: 2 },
                          py: 1.25,
                          mb: 1,
                          "&:last-of-type": { mb: 0 },
                        }}
                      >
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ maxWidth: "100%" }}>
                              <Typography
                                sx={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                              >
                                {entry.display_name}
                              </Typography>
                              {/* The two facts that decide where an entry
                                  appears at all: whether it is launchable, and
                                  whether it has a sidebar group. Both are
                                  invisible on the home page, and both are the
                                  answer to "why can I not see it". */}
                              {entry.entry_type !== "launchable" ? (
                                <Chip
                                  size="small"
                                  label={entry.entry_type === "reference_only" ? "Reference" : "Catalog only"}
                                  sx={{ flexShrink: 0, fontSize: 10, backgroundColor: "background.default", border: 1, borderColor: "divider" }}
                                />
                              ) : entry.nav_group === null ? (
                                <Chip
                                  size="small"
                                  label="Not in sidebar"
                                  sx={{ flexShrink: 0, fontSize: 10, backgroundColor: "background.default", border: 1, borderColor: "divider" }}
                                />
                              ) : null}
                              {entry.status !== "active" ? (
                                <Chip
                                  size="small"
                                  label={entry.status.replace(/_/g, " ")}
                                  sx={{ flexShrink: 0, fontSize: 10, backgroundColor: "background.default", border: 1, borderColor: "divider" }}
                                />
                              ) : null}
                            </Stack>
                            <Typography
                              sx={{ fontSize: 11.5, color: "text.secondary", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            >
                              {entry.launch_url ?? entry.description}
                            </Typography>
                          </Box>

                          <Box sx={{ width: 18, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                            {busy ? <CircularProgress size={14} aria-label="Saving" /> : null}
                          </Box>

                          <IconButton
                            size="small"
                            aria-label={`Move ${entry.display_name} up`}
                            aria-disabled={first || reordering}
                            onClick={() => {
                              if (!first && !reordering) onMove(entry.id, "up");
                            }}
                            sx={{
                              cursor: first || reordering ? "not-allowed" : "pointer",
                              color: first || reordering ? "text.disabled" : "text.secondary",
                            }}
                          >
                            <ArrowUpwardRoundedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                          <IconButton
                            size="small"
                            aria-label={`Move ${entry.display_name} down`}
                            aria-disabled={last || reordering}
                            onClick={() => {
                              if (!last && !reordering) onMove(entry.id, "down");
                            }}
                            sx={{
                              cursor: last || reordering ? "not-allowed" : "pointer",
                              color: last || reordering ? "text.disabled" : "text.secondary",
                            }}
                          >
                            <ArrowDownwardRoundedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                          <IconButton
                            size="small"
                            aria-label={`Edit ${entry.display_name}`}
                            onClick={() => setDialog({ mode: "edit", id: entry.id, draft: draftFrom(entry) })}
                            sx={{ cursor: "pointer", color: "text.secondary" }}
                          >
                            <EditOutlinedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                          <IconButton
                            size="small"
                            aria-label={`Delete ${entry.display_name}`}
                            aria-disabled={busy}
                            onClick={() => {
                              if (!busy) onRequestDelete(entry.id, entry.display_name);
                            }}
                            sx={{ cursor: "pointer", color: "text.secondary" }}
                          >
                            <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Paper>
          );
        })}
      </Stack>

      {entries.length === 0 ? (
        <Typography sx={{ fontSize: 12.5, color: "text.secondary", textAlign: "center", mt: 3 }}>
          The catalog is empty. Add the first app above — it appears on the home
          page as soon as you do.
        </Typography>
      ) : null}

      {/* MOUNTED ONLY WHILE OPEN. Rendering it always meant passing a freshly
          allocated `blankDraft(...)` as the fallback on every parent render, so
          `EntryDialog`'s identity-guarded reseed fired on every keystroke in the
          quick-add row — and on close, the form visibly reset and the title
          flipped from "Edit entry" to "Add an entry" mid-fade. Unmounting costs
          the exit transition, which is the right trade for a form that must not
          show the wrong row's values. */}
      {dialog !== null ? (
        <EntryDialog
          open
          mode={dialog.mode}
          initial={dialog.draft}
          categories={orderedCategories}
          nextSortOrderFor={(categoryId) => nextSortOrder(entriesByCategory.get(categoryId) ?? [])}
          busy={dialog.mode === "edit" ? pending.has(entryKey(dialog.id)) : createPending}
          onCancel={() => setDialog(null)}
          onSubmit={async (draft) => {
            if (dialog.mode === "create") {
              const created = await onCreate(draft);
              if (created) {
                setDialog(null);
                setQuickName("");
                setQuickUrl("");
              }
              return created;
            }
            const result = await onUpdate(dialog.id, draft);
            // CLOSED ON "stale" AS WELL AS ON "saved". The draft's `updated_at`
            // is spent either way, so keeping the form open would leave a
            // control whose every future Save fails identically — and the
            // message it just showed says the form has closed.
            if (result === "saved" || result === "stale") setDialog(null);
            return result === "saved";
          }}
        />
      ) : null}
    </>
  );
}
