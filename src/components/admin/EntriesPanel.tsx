"use client";

import { useState } from "react";

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
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import {
  CREATE_ENTRY_KEY,
  ENTRY_DEFAULTS,
  entryKey,
  inRenderOrder,
  nextSortOrder,
  reorderEntriesKey,
  type EntryDraft,
  categoryTree,
} from "@/lib/catalogAdmin";
import { categoryLabel } from "@/lib/adminAccess";
import { authModeLabel, ssoReadiness } from "@/lib/appConfig";
import type { AdminCategory, AdminEntry, Person } from "@/types/admin";

import EntryDialog from "./EntryDialog";

/**
 * Admin · Catalog · Entries — the catalog itself.
 *
 * There is one creation path: Add an app opens the complete configuration
 * dialog. A new record cannot bypass its descriptive, ownership, access,
 * activity, and authentication decisions through a smaller quick-add write.
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
  people,
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
  people: Person[];
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
  // PARENT-THEN-CHILDREN, not flat. `sort_order` is renumbered WITHIN sibling
  // groups, so a flat sort puts a subcategory with sort_order 10 ahead of a
  // top-level category with 20 — sections scattering through the list unrelated
  // to their parents. Same grouping the home page and the entry dialog use.
  const orderedCategories = categoryTree(categories).flatMap(({ category, children }) => [
    { category, nested: false },
    ...children.map((child) => ({ category: child, nested: true })),
  ]);
  /** Parents by id, so a subcategory section can name the one it sits under. */
  const categoryById = new Map(categories.map((c) => [c.id, { name: c.name }]));

  // A DISCRIMINATED UNION, so `id` is a string exactly when the mode is "edit".
  // The previous shape (`id: string | null` for both modes) forced a non-null
  // assertion at the submit call — safe by construction, but only because one
  // call site happened to set them together. This makes it true by type.
  const [dialog, setDialog] = useState<
    | { mode: "create"; draft: EntryDraft }
    | { mode: "edit"; id: string; draft: EntryDraft }
    | null
  >(null);
  const createPending = pending.has(CREATE_ENTRY_KEY);

  /** A safe blank draft whose defaults are all visible in the full form. */
  function blankDraft(categoryId: string): EntryDraft {
    return {
      category_id: categoryId,
      display_name: "",
      slug: "",
      description: "",
      entry_type: ENTRY_DEFAULTS.entry_type,
      status: ENTRY_DEFAULTS.status,
      host: ENTRY_DEFAULTS.host,
      auth_boundary: ENTRY_DEFAULTS.auth_boundary,
      trigger_type: ENTRY_DEFAULTS.trigger_type,
      owner: "",
      launch_url: "",
      repo_url: "",
      runbook_url: "",
      technical_name: "",
      source_of_truth_note: "",
      nav_group: "",
      sort_order: nextSortOrder(entriesByCategory.get(categoryId) ?? []),
      // No row to be stale against on the create path.
      updated_at: "",
      access_mode: "selected",
      auth_mode: "link_only",
      is_active: false,
      selected_user_ids: [],
      oauth_client_id: "",
      oauth_redirect_uris: "",
      oauth_enabled: true,
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
      updated_at: entry.updated_at,
      access_mode: entry.app_settings?.access_mode ?? "selected",
      auth_mode: entry.app_settings?.auth_mode ?? "link_only",
      is_active: entry.app_settings?.is_active ?? false,
      selected_user_ids: entry.access_grants
        .filter((grant) => grant.entry_id === entry.id)
        .map((grant) => grant.user_id),
      oauth_client_id: entry.oauth_clients[0]?.client_id ?? "",
      oauth_redirect_uris: entry.oauth_clients[0]?.redirect_uris.join("\n") ?? "",
      oauth_enabled: entry.oauth_clients[0]?.enabled ?? true,
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
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
          <Box sx={{ flex: 1 }}>
            <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, mb: 0.25 }}>
              Add an app
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>
              Review the catalog details, owner, access, availability, and authentication before saving.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={createPending ? <CircularProgress size={14} color="inherit" /> : <AddRoundedIcon />}
            disabled={createPending}
            onClick={() => setDialog({ mode: "create", draft: blankDraft(orderedCategories[0].category.id) })}
            sx={{ flexShrink: 0 }}
          >
            Add an app
          </Button>
        </Stack>
      </Paper>

      <Stack spacing={2}>
        {orderedCategories.map(({ category, nested }) => {
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
              sx={{
                border: 1,
                borderColor: "divider",
                p: { xs: 1.5, sm: 2 },
                // Indented and rule-marked, matching the categories panel, so a
                // subcategory section reads as sitting under the one above it.
                ml: nested ? { xs: 0, sm: 3 } : 0,
                borderLeftWidth: nested ? 3 : 1,
              }}
            >
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: inCategory.length ? 1.5 : 0 }}>
                <Typography
                  id={`cat-${category.slug}`}
                  component="h2"
                  sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "text.secondary", flex: 1 }}
                >
                  {nested ? categoryLabel(category, categoryById) : category.name}
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
                              {!entry.app_settings?.is_active ? (
                                <Chip
                                  size="small"
                                  label="Inactive"
                                  sx={{ flexShrink: 0, fontSize: 10, backgroundColor: "background.default", border: 1, borderColor: "divider" }}
                                />
                              ) : null}
                              <Chip size="small" label={entry.app_settings?.access_mode === "everyone" ? "Everyone" : "Selected people"} sx={{ flexShrink: 0, fontSize: 10 }} />
                              <Chip
                                size="small"
                                label={authModeLabel(entry.app_settings?.auth_mode ?? "link_only")}
                                color={ssoReadiness(entry.app_settings?.auth_mode ?? "link_only", entry.oauth_clients[0] ?? null) === "failing" ? "warning" : "default"}
                                sx={{ flexShrink: 0, fontSize: 10 }}
                              />
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
          `EntryDialog`'s identity-guarded reseed fired on every parent render —
          and on close, the form visibly reset and the title
          flipped from "Edit entry" to "Add an entry" mid-fade. Unmounting costs
          the exit transition, which is the right trade for a form that must not
          show the wrong row's values. */}
      {dialog !== null ? (
        <EntryDialog
          open
          mode={dialog.mode}
          initial={dialog.draft}
          categories={categories}
          people={people}
          nextSortOrderFor={(categoryId) => nextSortOrder(entriesByCategory.get(categoryId) ?? [])}
          busy={dialog.mode === "edit" ? pending.has(entryKey(dialog.id)) : createPending}
          onCancel={() => setDialog(null)}
          onSubmit={async (draft) => {
            if (dialog.mode === "create") {
              const created = await onCreate(draft);
              if (created) setDialog(null);
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
