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
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  categoryKey,
  CREATE_CATEGORY_KEY,
  REORDER_CATEGORIES_KEY,
  categoryTree,
} from "@/lib/catalogAdmin";
import type { AdminCategory, AdminEntry } from "@/types/admin";
import type { CategoryDraft } from "@/lib/catalogAdmin";

/**
 * Admin · Catalog · Categories — the groupings entries live in.
 *
 * Four operations, which is the whole of what a category is: create, rename,
 * reorder, delete. There is no slug field anywhere on this screen, deliberately
 * — the identifier is derived from the name on creation and then never changes,
 * so a rename cannot break anything keyed to it.
 *
 * The entry count beside each category is not decoration. `entries.category_id`
 * is `ON DELETE RESTRICT`, so a category holding entries cannot be deleted, and
 * showing the count means that refusal is visible BEFORE the click rather than
 * only after it. The delete is still attempted and still handled if the count is
 * stale — this is the courtesy, not the guard.
 */
export default function CategoriesPanel({
  categories,
  entriesByCategory,
  pending,
  isResyncing,
  onCreate,
  onUpdate,
  onMove,
  onRequestDelete,
}: {
  categories: AdminCategory[];
  entriesByCategory: Map<string, AdminEntry[]>;
  pending: Set<string>;
  /** True while a resync is in flight, so reorder controls stay unavailable. */
  isResyncing: boolean;
  onCreate: (draft: CategoryDraft, parentId: string | null) => Promise<boolean>;
  /** `parentId` omitted leaves the parent alone; `null` makes it top level. */
  onUpdate: (
    id: string,
    draft: CategoryDraft,
    parentId?: string | null,
  ) => Promise<boolean>;
  onMove: (id: string, direction: "up" | "down") => void;
  onRequestDelete: (id: string, label: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  /** "" means top level. A uuid means "nest under this one". */
  const [newParentId, setNewParentId] = useState("");
  /** The same, for the row being edited — this is what makes a MOVE possible. */
  const [editParentId, setEditParentId] = useState("");

  /**
   * The tree, flattened back into rows the existing markup can render.
   *
   * ONE ROW SHAPE, not two. A separate nested `<ul>` would have meant a second
   * copy of the rename form, the reorder arrows and the delete guard — four
   * things that have each been got wrong once already in this file. `depth` is
   * the only difference, and it only moves the row and changes its heading.
   *
   * `first`/`last` are computed WITHIN each sibling group, because that is the
   * range the arrows move a row through: a subcategory cannot be moved past its
   * own parent. `childCount` comes from the tree rather than from a per-row
   * scan of `categories`, which was O(n²) and re-derived what the tree already
   * knew.
   */
  const tree = categoryTree(categories);
  const ordered = tree.flatMap(({ category, children }, i) => [
    {
      category,
      depth: 0,
      first: i === 0,
      last: i === tree.length - 1,
      childCount: children.length,
    },
    ...children.map((child, j) => ({
      category: child,
      depth: 1,
      first: j === 0,
      last: j === children.length - 1,
      childCount: 0,
    })),
  ]);

  /**
   * What the "Sits under" picker offers.
   *
   * `tree` already holds exactly the rows with no resolvable parent, so no
   * further filter is needed — and filtering by `canHoldChildren` here would
   * have been worse than redundant: the only row it could drop is one whose
   * parent is real but invisible to this viewer, which `categoryTree`'s own
   * contract says must be SHOWN rather than hidden.
   */
  const parentOptions = tree.map((t) => t.category);
  const createPending = pending.has(CREATE_CATEGORY_KEY);

  /**
   * Every arrow in the list, not just the moved row's.
   *
   * A reorder renumbers the whole list, so while one is in flight or its resync
   * is still landing, the positions on screen are not the positions in the
   * database. Leaving other rows clickable let a second click compute a move
   * from a stale list — which either wrote the same values again (a silent
   * no-op) or interleaved with the first write and landed an order nobody asked
   * for.
   */
  const reordering = pending.has(REORDER_CATEGORIES_KEY) || isResyncing;

  /**
   * Where focus goes when inline edit mode closes.
   *
   * Save and Cancel both unmount the control that has focus, which drops it to
   * `<body>` — a keyboard user loses their place in the list every time they
   * rename anything. The row's own Rename button is where they were.
   */
  const renameButtons = useRef(new Map<string, HTMLButtonElement | null>());
  /** Focus lands back here after a successful create, ready for the next one. */
  const nameField = useRef<HTMLInputElement>(null);
  function closeEdit(id: string) {
    setEditingId(null);
    // After the row re-renders in its read-only shape.
    requestAnimationFrame(() => renameButtons.current.get(id)?.focus());
  }

  function startEdit(category: AdminCategory) {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description);
    setEditParentId(category.parent_id ?? "");
  }

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 320px" }, gap: 2, alignItems: "start" }}>
      <Paper elevation={0} sx={{ border: 1, borderColor: "divider", p: { xs: 1.5, sm: 2 } }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, mb: 0.25 }}>
          Categories · {categories.length}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 2 }}>
          The order here is the order the catalog renders in. A category that
          holds entries cannot be deleted until they are moved or removed.
        </Typography>

        {ordered.length === 0 ? (
          <Typography sx={{ fontSize: 13, color: "text.secondary", py: 3, textAlign: "center" }}>
            No categories yet. Create the first one on the right.
          </Typography>
        ) : (
          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {ordered.map(({ category, depth, first, last, childCount }) => {
              const count = entriesByCategory.get(category.id)?.length ?? 0;
              const busy = pending.has(categoryKey(category.id));
              const isEditing = editingId === category.id;
              // A category cannot be deleted while it holds ANYTHING. Entries
              // and subcategories both count, because the database refuses both
              // and a button that looks available and then fails is worse than
              // one that says why up front.
              const holds = count + childCount;
              // A container with tiles only in its children still renders on
              // the home page — `category_or_child_has_grant` (0005) and
              // `visibleCategories` both keep a parent whose children are
              // visible. What it does NOT get is entries of its own, and an
              // administrator who expected tiles here should be told rather
              // than left to compare two screens.
              const isEmptyContainer = depth === 0 && count === 0 && childCount > 0;

              return (
                <Box
                  component="li"
                  key={category.id}
                  sx={{
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 2.5,
                    px: { xs: 1.5, sm: 2 },
                    py: 1.5,
                    mb: 1,
                    "&:last-of-type": { mb: 0 },
                    // Indent, and a lighter border, so the nesting is legible
                    // without a second list. `ml` rather than a wrapper keeps
                    // the row markup identical at both depths.
                    ml: depth === 1 ? { xs: 2, sm: 4 } : 0,
                    borderStyle: depth === 1 ? "dashed" : "solid",
                  }}
                >
                  {isEditing ? (
                    <Stack spacing={1.5}>
                      <TextField
                        size="small"
                        label="Name"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                        fullWidth
                      />
                      <TextField
                        size="small"
                        label="Description"
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                        multiline
                        minRows={2}
                        fullWidth
                        helperText="Shown under the category heading on the home page."
                      />
                      {/* MOVE. The database already guards this in both
                          directions and passes its own refusal back as a
                          sentence, so the only reason not to offer it was that
                          nothing called the statement. A category with
                          subcategories of its own cannot be moved under
                          another — the trigger says so, and its options are
                          filtered out here to say it first. */}
                      <TextField
                        select
                        size="small"
                        label="Sits under"
                        value={editParentId}
                        onChange={(e) => setEditParentId(e.target.value)}
                        fullWidth
                        helperText={
                          childCount > 0
                            ? "This category has subcategories of its own, so it cannot be moved under another."
                            : "Categories go one level deep."
                        }
                        disabled={childCount > 0}
                      >
                        <MenuItem value="">Nothing — top-level category</MenuItem>
                        {parentOptions
                          .filter((p) => p.id !== category.id)
                          .map((p) => (
                            <MenuItem key={p.id} value={p.id}>
                              {p.name}
                            </MenuItem>
                          ))}
                      </TextField>
                      <Stack direction="row" spacing={1}>
                        {/* `aria-disabled` for the same reason as the create
                            button: it goes unavailable ON DISPATCH, so pressing
                            Save drops focus to <body>. On success `closeEdit`
                            rescues it — but on a REFUSED save, which is exactly
                            when the snackbar matters, nothing would. */}
                        <Button
                          size="small"
                          variant="contained"
                          aria-disabled={editName.trim() === "" || busy}
                          startIcon={busy ? <CircularProgress size={14} color="inherit" /> : null}
                          sx={
                            editName.trim() === "" || busy
                              ? {
                                  cursor: "not-allowed",
                                  backgroundColor: "action.disabledBackground",
                                  color: "action.disabled",
                                  "&:hover": { backgroundColor: "action.disabledBackground" },
                                }
                              : { cursor: "pointer" }
                          }
                          onClick={() => {
                            if (editName.trim() === "" || busy) return;
                            // Leave edit mode on SUCCESS only. Closing the row
                            // straight after dispatch would put a refusal in the
                            // snackbar with the typed text already gone, so the
                            // fix for a duplicate name is to retype it.
                            void onUpdate(
                              category.id,
                              { name: editName, description: editDescription },
                              editParentId === "" ? null : editParentId,
                            ).then((saved) => {
                              if (saved) closeEdit(category.id);
                            });
                          }}
                        >
                          Save
                        </Button>
                        <Button size="small" onClick={() => closeEdit(category.id)} sx={{ cursor: "pointer" }}>
                          Cancel
                        </Button>
                      </Stack>
                    </Stack>
                  ) : (
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ maxWidth: "100%" }}>
                          <Typography
                            sx={{
                              fontSize: 13.5,
                              fontWeight: 600,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {category.name}
                          </Typography>
                          <Chip
                            size="small"
                            label={`${count} ${count === 1 ? "entry" : "entries"}`}
                            sx={{
                              flexShrink: 0,
                              fontSize: 10.5,
                              backgroundColor: "background.default",
                              border: 1,
                              borderColor: "divider",
                            }}
                          />
                          {childCount > 0 ? (
                            <Chip
                              size="small"
                              label={`${childCount} ${childCount === 1 ? "subcategory" : "subcategories"}`}
                              sx={{
                                flexShrink: 0,
                                fontSize: 10.5,
                                backgroundColor: "background.default",
                                border: 1,
                                borderColor: "divider",
                              }}
                            />
                          ) : null}
                        </Stack>
                        {/* Said WHERE THE STATE IS CREATED. A container with no
                            tiles of its own is a perfectly good arrangement —
                            it renders, because the read path was widened for
                            exactly this — but an administrator who expected to
                            see tiles here should learn it on this screen rather
                            than by comparing it against the home page. */}
                        {isEmptyContainer ? (
                          <Typography
                            sx={{ fontSize: 11, color: "text.secondary", mt: 0.5, fontStyle: "italic" }}
                          >
                            No entries of its own — this is a grouping. Its subcategories hold the
                            tiles.
                          </Typography>
                        ) : null}
                        <Typography
                          sx={{
                            fontSize: 11.5,
                            color: "text.secondary",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {category.description}
                        </Typography>
                      </Box>

                      <Box sx={{ width: 18, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                        {busy ? <CircularProgress size={14} aria-label="Saving" /> : null}
                      </Box>

                      <IconButton
                        size="small"
                        aria-label={`Move ${category.name} up`}
                        aria-disabled={first || reordering}
                        onClick={() => {
                          if (!first && !reordering) onMove(category.id, "up");
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
                        aria-label={`Move ${category.name} down`}
                        aria-disabled={last || reordering}
                        onClick={() => {
                          if (!last && !reordering) onMove(category.id, "down");
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
                        aria-label={`Rename ${category.name}`}
                        ref={(node) => {
                          renameButtons.current.set(category.id, node);
                          // React 19 ref cleanup. Without it unmount leaves an
                          // `id -> null` entry behind and the map only grows.
                          return () => {
                            renameButtons.current.delete(category.id);
                          };
                        }}
                        onClick={() => startEdit(category)}
                        sx={{ cursor: "pointer", color: "text.secondary" }}
                      >
                        <EditOutlinedIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                      {/* The Tooltip wraps the BUTTON, with no span in between.
                          A wrapper is only needed for a genuinely `disabled`
                          child, which cannot take listeners — this button uses
                          `aria-disabled`, so it can. With the span, MUI put
                          `aria-describedby` on the span and a screen-reader user
                          heard "Delete Sales, unavailable" with no reason. */}
                      <Tooltip
                        title={
                          // The reason names WHAT is in the way, because
                          // "cannot delete" without it sends people looking in
                          // the wrong place — a category can now be blocked by
                          // subcategories, by entries, or by both.
                          holds === 0
                            ? `Delete ${category.name}`
                            : [
                                count > 0
                                  ? `${count} ${count === 1 ? "entry" : "entries"}`
                                  : null,
                                childCount > 0
                                  ? `${childCount} ${childCount === 1 ? "subcategory" : "subcategories"}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(" and ") + " still in this category — move or delete them first"
                        }
                      >
                        <IconButton
                          size="small"
                          aria-label={`Delete ${category.name}`}
                          aria-disabled={holds > 0 || busy}
                          onClick={() => {
                            if (holds === 0 && !busy) onRequestDelete(category.id, category.name);
                          }}
                          sx={{
                            cursor: holds > 0 ? "not-allowed" : "pointer",
                            color: holds > 0 ? "text.disabled" : "text.secondary",
                          }}
                        >
                          <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>

      <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: "divider", position: { md: "sticky" }, top: { md: 16 } }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, mb: 0.25 }}>
          New category
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1.5 }}>
          The identifier is derived from the name, so renaming later is safe.
        </Typography>
        <Stack spacing={1.5}>
          <TextField
            size="small"
            label="Name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Finance"
            inputRef={nameField}
          />
          {/* Only top-level categories are offered. A subcategory cannot take
              children — the database refuses it in both directions — so listing
              one here would be offering a choice that fails on submit. */}
          <TextField
            select
            size="small"
            label="Sits under"
            value={newParentId}
            onChange={(e) => setNewParentId(e.target.value)}
            helperText={
              parentOptions.length === 0
                ? "Create a top-level category first to be able to nest under it."
                : "Categories go one level deep."
            }
            disabled={parentOptions.length === 0}
          >
            <MenuItem value="">Nothing — this is a top-level category</MenuItem>
            {parentOptions.map((c) => (
              <MenuItem key={c.id} value={c.id}>
                {c.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Description"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="What belongs in here"
            multiline
            minRows={2}
            helperText="Optional — a placeholder is stored if you leave it blank."
          />
          {/* `aria-disabled`, NOT `disabled` — the repo's rule, and this is the
              case it exists for: the button becomes unavailable AS A RESULT OF
              SUCCEEDING (the handler clears the name), so a real `disabled`
              would drop focus to <body> after every single create, on the screen
              whose whole purpose is adding rows in a run. Focus returns to the
              Name field instead, ready for the next one. */}
          <Button
            variant="contained"
            size="small"
            startIcon={createPending ? <CircularProgress size={14} color="inherit" /> : <AddRoundedIcon />}
            aria-disabled={newName.trim() === "" || createPending}
            onClick={() => {
              if (newName.trim() === "" || createPending) return;
              void onCreate(
                { name: newName, description: newDescription },
                newParentId === "" ? null : newParentId,
              ).then((created) => {
                if (created) {
                  setNewName("");
                  setNewDescription("");
                  // The parent is DELIBERATELY kept. Adding several
                  // subcategories under the same parent is the common run, and
                  // resetting it would make every one after the first silently
                  // land at top level.
                  nameField.current?.focus();
                }
              });
            }}
            sx={{
              cursor: newName.trim() === "" || createPending ? "not-allowed" : "pointer",
              alignSelf: "flex-start",
              // aria-disabled carries the semantics; this carries the look MUI's
              // `disabled` would have given it.
              ...(newName.trim() === "" || createPending
                ? { backgroundColor: "action.disabledBackground", color: "action.disabled", "&:hover": { backgroundColor: "action.disabledBackground" } }
                : {}),
            }}
          >
            Create category
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}
