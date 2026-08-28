"use client";

import { useState } from "react";

import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  AUTH_BOUNDARIES,
  ENTRY_HOSTS,
  ENTRY_STATUSES,
  ENTRY_TYPES,
  TRIGGER_TYPES,
  enumLabel,
  withCurrent,
  type EntryDraft,
  categoryTree,
} from "@/lib/catalogAdmin";
import { categoryLabel } from "@/lib/adminAccess";
import { NAV_GROUP_LABEL, NAV_GROUP_ORDER, type AdminCategory } from "@/types/admin";

/**
 * The full entry form — every column a person can set, in one dialog.
 *
 * It serves BOTH create and edit. The simple "add an app" row on the panel
 * behind it collects three fields and defaults the rest; this is the same write
 * with nothing hidden, for the entry that needs a status, an owner or a sidebar
 * group. Keeping them one component means the two paths cannot disagree about
 * what a valid entry is.
 *
 * NOTHING HERE VALIDATES. The dialog collects strings and hands them to
 * `validateEntry`, which is the single place that knows what the database will
 * accept and is tested against those rules without a browser. A second opinion
 * living in this file is exactly how a form starts refusing rows Postgres would
 * have taken, or accepting ones it will not.
 *
 * `last_verified_at` is deliberately absent: it means "when this row was last
 * confirmed against reality", and a free date field invites someone to type a
 * date on which nobody checked anything. It stays settable from SQL until there
 * is a "verify this entry" action that can set it truthfully.
 */
export default function EntryDialog({
  open,
  mode,
  initial,
  categories,
  nextSortOrderFor,
  busy,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "edit";
  /** The starting values. The dialog copies them into local state when opened. */
  initial: EntryDraft;
  categories: AdminCategory[];
  /**
   * Where a new entry would land in a given category. Called when the category
   * changes, so the position stays meaningful for the list it is joining — the
   * caller no longer overrides `sort_order` on save, so this is what keeps a
   * created entry at the end of its category rather than at an arbitrary spot.
   */
  nextSortOrderFor: (categoryId: string) => number;
  busy: boolean;
  onCancel: () => void;
  /**
   * Resolves true when the write LANDED. The dialog does not act on the value —
   * the caller owns closing, and it also closes when a save was refused as stale,
   * where this resolves false. Kept for callers that want to know.
   */
  onSubmit: (draft: EntryDraft) => Promise<boolean>;
}) {
  // Every category by id. The admin screen holds them all — unlike the grant
  // screens, where a container parent is filtered out — so this needs no prop.
  const categoryNames = new Map(categories.map((c) => [c.id, { name: c.name }]));

  const [draft, setDraft] = useState<EntryDraft>(initial);
  // Re-seed when the dialog is opened on a different row. React's documented
  // adjust-state-on-prop-change pattern — a render-phase update guarded by
  // identity, not an effect (this repo's hooks config rejects set-state-in-
  // effect, and an effect would paint the previous entry's values for a frame).
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setDraft(initial);
  }

  function set<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  const launchable = draft.entry_type === "launchable";

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>
        {mode === "create" ? "Add an entry" : "Edit entry"}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ pt: 0.5 }}>
          <TextField
            size="small"
            label="Name"
            value={draft.display_name}
            onChange={(e) => set("display_name", e.target.value)}
            required
            fullWidth
            helperText={
              mode === "create"
                ? "The identifier is derived from this and does not change afterwards."
                : "Renaming is safe — the identifier stays as it is."
            }
          />

          <TextField
            select
            size="small"
            label="Category"
            value={draft.category_id}
            onChange={(e) => {
              const next = e.target.value;
              setDraft((d) => ({
                ...d,
                category_id: next,
                // Only on create. Recomputing on edit would silently move an
                // existing entry to the end of its new category, discarding a
                // position somebody chose.
                sort_order: mode === "create" ? nextSortOrderFor(next) : d.sort_order,
              }));
            }}
            required
            fullWidth
          >
            {/* Flattened through `categoryTree` rather than listed raw, so a
                subcategory appears under its own parent and indented. A tile
                can live in either — `entries.category_id` points at any
                category row — but a flat alphabetical list would give no hint
                which of two similarly-named options is the nested one. */}
            {categoryTree(categories).flatMap(({ category, children }) => [
              <MenuItem key={category.id} value={category.id}>
                {category.name}
              </MenuItem>,
              // Indent AND breadcrumb. The indent alone leaves two subcategories
              // both called "Reports" indistinguishable, and this is the primary
              // path for deciding where a tile lives.
              ...children.map((child) => (
                <MenuItem key={child.id} value={child.id} sx={{ pl: 4 }}>
                  {categoryLabel(child, categoryNames)}
                </MenuItem>
              )),
            ])}
          </TextField>

          <TextField
            size="small"
            label="Description"
            value={draft.description}
            onChange={(e) => set("description", e.target.value)}
            multiline
            minRows={2}
            fullWidth
            helperText="Optional — a placeholder is stored if you leave it blank."
          />

          <TextField
            size="small"
            label="Launch URL"
            value={draft.launch_url}
            onChange={(e) => set("launch_url", e.target.value)}
            fullWidth
            placeholder="https://…"
            // The constraint stated as a consequence rather than as a rule: the
            // person picked "launchable" a field below, and this says what that
            // choice now requires of them.
            helperText={
              launchable
                ? "Required, because this entry is launchable. It is what the tile opens."
                : "Optional for this type."
            }
          />

          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            {/* Changing away from `launchable` CLEARS the sidebar group in the
                same update. The field is hidden for non-launchable types, so
                leaving a stale value behind produced a save that
                `validateEntry` refused by naming a control no longer on screen
                — a dead end with no way out but guessing. The database's
                `nav_group_launchable_only` CHECK is the rule; this keeps the
                form on the right side of it by construction rather than by
                complaining afterwards. */}
            <TextField
              select
              size="small"
              label="Type"
              value={draft.entry_type}
              onChange={(e) => {
                const next = e.target.value as EntryDraft["entry_type"];
                setDraft((d) => ({
                  ...d,
                  entry_type: next,
                  nav_group: next === "launchable" ? d.nav_group : "",
                }));
              }}
              fullWidth
            >
              {withCurrent(ENTRY_TYPES, draft.entry_type).map((t) => (
                <MenuItem key={t} value={t}>
                  {enumLabel(t)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              label="Status"
              value={draft.status}
              onChange={(e) => set("status", e.target.value as EntryDraft["status"])}
              fullWidth
            >
              {withCurrent(ENTRY_STATUSES, draft.status).map((s) => (
                <MenuItem key={s} value={s}>
                  {enumLabel(s)}
                </MenuItem>
              ))}
            </TextField>
          </Stack>

          <TextField
            size="small"
            label="Owner"
            value={draft.owner}
            onChange={(e) => set("owner", e.target.value)}
            fullWidth
            helperText={`Optional — defaults to ${draft.fallbackOwner || "the signed-in account"}. Free text: a person or a team.`}
          />

          {/* Sidebar placement, and the one control on this form whose absence
              is a real gap rather than a detail: an entry with no nav_group
              never appears in the sidebar however launchable it is, and that is
              the first thing to check when something is "missing". Hidden for
              non-launchable types because the database refuses that combination
              outright (`nav_group_launchable_only`). */}
          {launchable ? (
            <TextField
              select
              size="small"
              label="Sidebar group"
              value={draft.nav_group}
              onChange={(e) => set("nav_group", e.target.value as EntryDraft["nav_group"])}
              fullWidth
              helperText="Optional. Without one, the entry shows on the home page but not in the sidebar."
            >
              <MenuItem value="">
                <em>Not in the sidebar</em>
              </MenuItem>
              {/* `withCurrent`, like every other select here. This was the one
                  that skipped it, and it is the one where skipping it shows a
                  FALSEHOOD rather than merely a gap: an entry holding a group
                  added by a later `ALTER TYPE` would render with a blank
                  control, telling the administrator it is "not in the sidebar"
                  while it sits in the sidebar. `NAV_GROUP_LABEL` has no entry
                  for such a member either, hence the `enumLabel` fallback. */}
              {(draft.nav_group === ""
                ? [...NAV_GROUP_ORDER]
                : withCurrent(NAV_GROUP_ORDER, draft.nav_group)
              ).map((g) => (
                <MenuItem key={g} value={g}>
                  {NAV_GROUP_LABEL[g] ?? enumLabel(g)}
                </MenuItem>
              ))}
            </TextField>
          ) : null}

          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "text.secondary", mb: 1.5 }}>
              Where it runs
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                select
                size="small"
                label="Host"
                value={draft.host}
                onChange={(e) => set("host", e.target.value)}
                fullWidth
              >
                {withCurrent(ENTRY_HOSTS, draft.host).map((h) => (
                  <MenuItem key={h} value={h}>
                    {enumLabel(h)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Auth boundary"
                value={draft.auth_boundary}
                onChange={(e) => set("auth_boundary", e.target.value)}
                fullWidth
              >
                {withCurrent(AUTH_BOUNDARIES, draft.auth_boundary).map((a) => (
                  <MenuItem key={a} value={a}>
                    {enumLabel(a)}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                size="small"
                label="Triggered by"
                value={draft.trigger_type}
                onChange={(e) => set("trigger_type", e.target.value)}
                fullWidth
              >
                {withCurrent(TRIGGER_TYPES, draft.trigger_type).map((t) => (
                  <MenuItem key={t} value={t}>
                    {enumLabel(t)}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "text.secondary", mb: 1.5 }}>
              Optional detail
            </Typography>
            <Stack spacing={2}>
              <TextField
                size="small"
                label="Technical name"
                value={draft.technical_name}
                onChange={(e) => set("technical_name", e.target.value)}
                fullWidth
                helperText="What it is called in code or in a dashboard, if that differs."
              />
              <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                <TextField
                  size="small"
                  label="Repository URL"
                  value={draft.repo_url}
                  onChange={(e) => set("repo_url", e.target.value)}
                  fullWidth
                  placeholder="https://…"
                />
                <TextField
                  size="small"
                  label="Runbook URL"
                  value={draft.runbook_url}
                  onChange={(e) => set("runbook_url", e.target.value)}
                  fullWidth
                  placeholder="https://…"
                />
              </Stack>
              <TextField
                size="small"
                label="Source of truth note"
                value={draft.source_of_truth_note}
                onChange={(e) => set("source_of_truth_note", e.target.value)}
                multiline
                minRows={2}
                fullWidth
                helperText="Where the real data for this lives, if it is somewhere else."
              />
              {/* `Number("") === 0`, so clearing this field used to silently
                  send the entry to the top of its category — and
                  `validateEntry`'s `Number.isFinite` guard cannot catch it,
                  because 0 is finite. An empty field means "leave it alone". */}
              <TextField
                size="small"
                type="number"
                label="Position"
                value={draft.sort_order}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    // An empty field means "leave it alone" — but `initial` was
                    // computed for the category the dialog OPENED on, so after
                    // a category change that value belongs to a different
                    // list's tail. Recompute for the category actually selected.
                    sort_order:
                      e.target.value === ""
                        ? mode === "create"
                          ? nextSortOrderFor(d.category_id)
                          : initial.sort_order
                        : Number(e.target.value),
                  }))
                }
                sx={{ maxWidth: 160 }}
                helperText="Lower sorts first."
              />
            </Stack>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel} sx={{ cursor: "pointer" }}>
          Cancel
        </Button>
        {/* `aria-disabled`, matching the create buttons: this goes unavailable
            ON DISPATCH, so a keyboard user who presses Save loses focus the
            moment they use it. Inside a modal the focus trap limits the damage,
            but a refused save — the case the snackbar exists for — would still
            strand them. */}
        <Button
          variant="contained"
          aria-disabled={busy || draft.display_name.trim() === ""}
          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
          onClick={() => {
            if (busy || draft.display_name.trim() === "") return;
            // The dialog closes on SUCCESS only. A refusal — a duplicate name, a
            // malformed URL, an RLS "no" — leaves every typed value where it is,
            // so the fix is to correct one field rather than to fill the form in
            // again from an empty state.
            void onSubmit(draft);
          }}
          sx={
            busy || draft.display_name.trim() === ""
              ? {
                  cursor: "not-allowed",
                  backgroundColor: "action.disabledBackground",
                  color: "action.disabled",
                  "&:hover": { backgroundColor: "action.disabledBackground" },
                }
              : { cursor: "pointer" }
          }
        >
          {mode === "create" ? "Add entry" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
