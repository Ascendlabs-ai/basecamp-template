"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import { categoryLabel, grantKey, pendingKey, resolveAccess } from "@/lib/adminAccess";
import type {
  AccessSource,
  Grant,
  GrantCategory,
  Member,
  MemberType,
  Person,
  ToggleTarget,
  TypeGrant,
} from "@/types/admin";

import PersonAvatar from "./PersonAvatar";

const PERSON_COL = 230;
const CELL_COL = 44;

/**
 * The org-wide read: people down, **launchable apps** across.
 *
 * Columns are launchable entries only. The previous version put all 44 catalog
 * rows across the top — 28 people × 44 columns is 1,232 cells and the grid
 * nobody could operate that this rebuild exists to replace. The design's matrix
 * is apps, and an app is something you can open.
 *
 * FOUR CELL STATES. Access has two sources and individual grants have two
 * shapes, and a cell must not offer to revoke a row it cannot delete:
 *   solid dot    individual ENTRY grant — the only revocable state here
 *   ringed disc  individual CATEGORY grant — has access, but a per-entry toggle
 *                would insert a redundant row and leave access intact
 *   dashed ring  granted by the person's TYPE — the row belongs to the type
 *   thin ring    no access
 * Shape carries the distinction, not just color, and every cell states its
 * source in its accessible name and tooltip.
 *
 * The ringed-disc state exists because this component shipped without it: it
 * rendered category grants as a live "Revoke", the click inserted an entry
 * grant, the dot stayed solid, and no error fired — a screen whose job is
 * reporting access truthfully reporting a revoke that never happened.
 */
/**
 * `repeat(0, …)` is invalid CSS — the whole `grid-template-columns`
 * declaration is dropped and the grid silently collapses to one implicit
 * column. Reachable whenever entries exist but none are launchable, because
 * the matrix's columns are launchable-only while the screen's empty-state
 * guard counts categories.
 */
const columnTemplate = (n: number) =>
  n > 0 ? `${PERSON_COL}px repeat(${n}, ${CELL_COL}px)` : `${PERSON_COL}px`;

export default function AccessMatrix({
  people,
  categories,
  categoryNames,
  grantIndex,
  typeGrantIndex,
  memberIndex,
  typeById,
  pending,
  onToggle,
}: {
  people: Person[];
  categories: GrantCategory[];
  /**
   * Every category by id, including container parents absent from `categories`.
   * Labels only — it never decides access.
   */
  categoryNames: Map<string, { name: string }>;
  grantIndex: Map<string, Grant>;
  typeGrantIndex: Map<string, TypeGrant>;
  memberIndex: Map<string, Member>;
  typeById: Map<string, MemberType>;
  pending: Set<string>;
  onToggle: (userId: string, target: ToggleTarget) => void;
}) {
  const [categoryId, setCategoryId] = useState<string>("all");

  const shownCategories = useMemo(
    () => (categoryId === "all" ? categories : categories.filter((c) => c.id === categoryId)),
    [categories, categoryId],
  );

  const columns = useMemo(
    () =>
      shownCategories.flatMap((c) =>
        c.entries.map((e) => ({
          entry: e,
          categoryId: c.id,
          categoryName: categoryLabel(c, categoryNames),
        })),
      ),
    [shownCategories, categoryNames],
  );

  // Roving tabindex. role="grid" with one tab stop and arrow-key movement
  // inside it — the APG pattern. Without it every cell is a sequential tab stop.
  const [active, setActive] = useState<{ row: number; col: number }>({ row: 0, col: 0 });
  const gridRef = useRef<HTMLDivElement>(null);

  // Clamp, do not store. Narrowing the column filter can leave `active.col`
  // past the end, and then NO cell has tabIndex 0 — the grid becomes
  // keyboard-unreachable and arrow keys cannot recover it, because focus sits
  // outside the grid and the handler never sees them.
  const cursor = {
    row: Math.min(active.row, Math.max(people.length - 1, 0)),
    col: Math.min(active.col, Math.max(columns.length - 1, 0)),
  };

  const onGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (columns.length === 0 || people.length === 0) return;
      const moves: Record<string, [number, number]> = {
        ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
      };
      let next: { row: number; col: number } | null = null;
      if (e.key in moves) {
        const [dr, dc] = moves[e.key];
        next = {
          row: Math.min(Math.max(cursor.row + dr, 0), people.length - 1),
          col: Math.min(Math.max(cursor.col + dc, 0), columns.length - 1),
        };
      } else if (e.key === "Home") next = { row: cursor.row, col: 0 };
      else if (e.key === "End") next = { row: cursor.row, col: columns.length - 1 };
      if (!next) return;
      // preventDefault or the arrow keys scroll the page out from under the
      // cell we are about to focus.
      e.preventDefault();
      setActive(next);
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-cell="${next.row}-${next.col}"]`)
        ?.focus();
    },
    [cursor.row, cursor.col, people.length, columns.length],
  );

  if (columns.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{ p: { xs: 3, sm: 4 }, border: 1, borderColor: "divider", textAlign: "center" }}
      >
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
          The matrix shows launchable apps only, and none are in the catalog yet. Grants on
          reference entries and whole categories are still available under <strong>By person</strong>.
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper elevation={0} sx={{ border: 1, borderColor: "divider", overflow: "hidden" }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={2}
        sx={{ p: 2, flexWrap: "wrap", gap: 1.5 }}
      >
        <Box>
          <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700 }}>
            Everyone, every app
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.25 }}>
            {people.length} people × {columns.length} launchable{" "}
            {columns.length === 1 ? "app" : "apps"}. Click a cell to grant or revoke
            individually; type access is changed under Types.
          </Typography>
        </Box>
        {/* GRANTS DO NOT INHERIT, and the label is a breadcrumb, which is the
            rendering that most implies they do. So the rule is stated in words
            rather than left to the punctuation. */}
        <TextField
          select
          size="small"
          label="Columns"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          helperText="A category grant covers only its own entries — subcategories are granted separately."
          sx={{ minWidth: 220 }}
        >
          <MenuItem value="all">
            All categories ({categories.reduce((n, c) => n + c.entries.length, 0)})
          </MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {categoryLabel(c, categoryNames)} ({c.entries.length})
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Box
        tabIndex={0}
        role="region"
        aria-label="Access matrix, horizontally scrollable"
        sx={{
          overflowX: "auto",
          pb: 1,
          "&:focus-visible": { outline: "3px solid", outlineColor: "primary.main", outlineOffset: -3 },
        }}
      >
        <Box
          ref={gridRef}
          role="grid"
          onKeyDown={onGridKeyDown}
          aria-label="Access matrix: people by launchable app"
          aria-rowcount={people.length + 1}
          aria-colcount={columns.length + 1}
          // Run-out as WIDTH, not padding: as padding it sat inside the table
          // box, so row borders and hover stopped short of the scroll extent.
          sx={{ width: PERSON_COL + columns.length * CELL_COL + 96, minWidth: "100%" }}
        >
          <Box
            role="row"
            aria-rowindex={1}
            sx={{
              display: "grid",
              gridTemplateColumns: columnTemplate(columns.length),
              borderBottom: 1,
              borderColor: "divider",
              alignItems: "end",
            }}
          >
            <Box
              role="columnheader"
              aria-colindex={1}
              sx={{
                position: "sticky", left: 0, zIndex: 2,
                backgroundColor: "background.paper",
                px: 2, py: 1.25, fontSize: 10.5, fontWeight: 600,
                textTransform: "uppercase", letterSpacing: "0.5px", color: "text.secondary",
              }}
            >
              Person
            </Box>
            {columns.map((col, ci) => (
              <Box
                key={col.entry.id}
                role="columnheader"
                aria-colindex={ci + 2}
                // overflow VISIBLE — the label is rotated out of a 44px cell,
                // so `hidden` clipped every header with no ellipsis to show it.
                sx={{ height: 150, position: "relative", overflow: "visible" }}
              >
                <Tooltip title={`${col.entry.display_name} · ${col.categoryName}`}>
                  <Typography
                    tabIndex={-1}
                    // Focusable for the tooltip, but -1: N headers each taking
                    // a tab stop would undo the roving grid below. The same
                    // name is on every cell's aria-label anyway.
                    sx={{
                      position: "absolute", bottom: 10, left: "50%",
                      // DEVIATION from the handoff, which specifies a
                      // horizontal 10.5px uppercase header row. At CELL_COL
                      // (44px) a horizontal header is either clipped to a few
                      // characters or forces columns wide enough that the
                      // matrix stops fitting on screen — which defeats the
                      // reason columns are limited to launchable entries in the
                      // first place. Rotating keeps the whole name readable at
                      // that width. A deliberate design choice, kept as an
                      // open deviation.
                      transformOrigin: "left bottom", transform: "rotate(-60deg)",
                      whiteSpace: "nowrap", fontSize: 11, fontWeight: 600,
                      color: "text.secondary", maxWidth: 160,
                      overflow: "hidden", textOverflow: "ellipsis",
                      "&:focus-visible": {
                        outline: "3px solid", outlineColor: "primary.main", outlineOffset: 2,
                      },
                    }}
                  >
                    {col.entry.display_name}
                  </Typography>
                </Tooltip>
              </Box>
            ))}
          </Box>

          {people.map((p, ri) => {
            const member = memberIndex.get(p.id);
            const typeName = member ? (typeById.get(member.member_type_id)?.name ?? "Unknown type") : null;
            const subLabel = typeName
              ? [typeName, member?.department].filter(Boolean).join(" · ")
              : "No type";
            return (
              <Box
                key={p.id}
                role="row"
                aria-rowindex={ri + 2}
                sx={(theme) => ({
                  display: "grid",
                  gridTemplateColumns: columnTemplate(columns.length),
                  borderBottom: 1,
                  borderColor: "divider",
                  alignItems: "center",
                  // The sticky person cell must be OPAQUE so scrolled cells pass
                  // under it, which meant it painted over the row hover. The
                  // variable lets it composite the same tint over paper instead.
                  "--row-bg": "transparent",
                  "&:hover": {
                    backgroundColor: theme.palette.action.hover,
                    "--row-bg": theme.palette.action.hover,
                  },
                })}
              >
                <Stack
                  role="rowheader"
                  aria-colindex={1}
                  direction="row"
                  spacing={1.25}
                  alignItems="center"
                  sx={(theme) => ({
                    position: "sticky", left: 0, zIndex: 1,
                    backgroundColor: theme.palette.background.paper,
                    backgroundImage: "linear-gradient(var(--row-bg), var(--row-bg))",
                    px: 2, py: 1.25, minWidth: 0,
                  })}
                >
                  <PersonAvatar email={p.email} size={28} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      title={p.email}
                      sx={{
                        fontSize: 12.5, fontWeight: 600,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {p.email}
                    </Typography>
                    {/* The design's type · department line under the name. */}
                    <Typography
                      sx={{
                        fontSize: 10.5,
                        color: member ? "text.secondary" : "text.disabled",
                        fontStyle: member ? "normal" : "italic",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                    >
                      {subLabel}
                    </Typography>
                  </Box>
                </Stack>

                {columns.map((col, ci) => {
                  const access = resolveAccess(
                    grantIndex, typeGrantIndex, memberIndex, p.id, col.entry.id, col.categoryId,
                  );
                  const isPending = pending.has(pendingKey(p.id, { entryId: col.entry.id }));
                  // INERT when the grant is not a per-entry row this cell could
                  // delete: a type grant (owned by the type) or a whole-category
                  // grant (owned by the category). Offering "revoke" on either
                  // inserts a redundant row and leaves access intact — the
                  // defect this guard exists to prevent.
                  const viaTypeOnly = access.source === "type";
                  const inert = viaTypeOnly || access.viaCategory;
                  const label = viaTypeOnly
                    ? `${p.email} has ${col.entry.display_name} through the ${typeName} type — change it under Types`
                    : access.viaCategory
                      ? `${p.email} has ${col.entry.display_name} through a grant on the whole ${col.categoryName} category — change it under By person`
                      : access.source === "individual"
                        ? access.alsoViaType
                          ? `Revoke the individual grant on ${col.entry.display_name} for ${p.email}. Their ${typeName} type also grants it, so they keep access.`
                          : // A direct entry grant can also sit INSIDE a granted
                            // category. The toggle deletes the entry row and the
                            // category grant still covers it — honest after the
                            // click, so the label has to be honest before it.
                            grantIndex.has(grantKey(p.id, { categoryId: col.categoryId }))
                            ? `Revoke the individual grant on ${col.entry.display_name} for ${p.email}. The grant on the whole ${col.categoryName} category also covers it, so they keep access.`
                            : `Revoke ${col.entry.display_name} from ${p.email}`
                        : `Grant ${col.entry.display_name} to ${p.email}`;

                  return (
                    <Box
                      key={col.entry.id}
                      role="gridcell"
                      aria-colindex={ci + 2}
                      sx={{ display: "flex", justifyContent: "center" }}
                    >
                      <Tooltip title={label}>
                        <Box component="span" sx={{ display: "inline-flex" }}>
                          <Box
                            component="button"
                            type="button"
                            data-cell={`${ri}-${ci}`}
                            tabIndex={cursor.row === ri && cursor.col === ci ? 0 : -1}
                            onFocus={() => setActive({ row: ri, col: ci })}
                            // aria-disabled, NOT `disabled`: disabling the
                            // focused element drops focus to <body>, which in a
                            // grid this size loses the user's place entirely.
                            aria-disabled={inert || isPending}
                            aria-busy={isPending}
                            aria-label={label}
                            aria-pressed={access.source !== "none"}
                            onClick={() => {
                              if (!inert && !isPending) {
                                onToggle(p.id, { entryId: col.entry.id });
                              }
                            }}
                            sx={(theme) => ({
                              width: 36, height: 36,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              border: 0, borderRadius: "50%", background: "none", padding: 0,
                              cursor: inert ? "not-allowed" : "pointer",
                              transition: theme.transitions.create(["background-color"], { duration: 150 }),
                              "&:hover:not([aria-disabled='true'])": {
                                backgroundColor: theme.palette.action.selected,
                              },
                              "&:focus-visible": {
                                outline: `3px solid ${theme.palette.primary.main}`,
                                outlineOffset: -2,
                              },
                            })}
                          >
                            {isPending ? (
                              <CircularProgress size={14} aria-hidden />
                            ) : (
                              <AccessDot source={access.source} viaCategory={access.viaCategory} />
                            )}
                          </Box>
                        </Box>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>

      <Stack direction="row" spacing={2.5} alignItems="center" sx={{ px: 2, py: 1.75, flexWrap: "wrap", gap: 1.5 }}>
        <Legend source="individual" label="Granted individually" />
        <Legend source="individual" viaCategory label="Via a whole category" />
        <Legend source="type" label="Granted by their type" />
        <Legend source="none" label="No access" />
        <Typography sx={{ ml: "auto", fontSize: 11.5, color: "text.secondary" }}>
          Only individual entry grants are editable here.
        </Typography>
      </Stack>
    </Paper>
  );
}

/**
 * Four states as four SHAPES, not four colors: solid disc (individual entry
 * grant), ringed disc (individual CATEGORY grant), dashed ring (type grant),
 * thin ring (none). Color reinforces; shape carries it, so the distinction
 * survives grayscale and the common color-vision deficiencies.
 *
 * The two filled states are deliberately both filled — the person HAS access in
 * both — but visibly different, because only one of them is revocable here.
 */
function AccessDot({ source, viaCategory }: { source: AccessSource; viaCategory?: boolean }) {
  const filledByCategory = source === "individual" && viaCategory;
  return (
    <Box
      aria-hidden
      sx={(theme) => ({
        width: 14,
        height: 14,
        borderRadius: "50%",
        backgroundColor: source === "individual" ? theme.palette.primary.main : "transparent",
        border:
          source === "individual"
            ? "none"
            : source === "type"
              ? `2px dashed ${theme.palette.primary.main}`
              : `1.5px solid ${theme.palette.text.secondary}`,
        // The ringed state was originally a primary.dark border inside a
        // primary.main fill. Measured, that is #2980B9 on #3498DC = 1.37:1,
        // under WCAG 1.4.11's 3:1 floor for meaningful graphics and invisible
        // in grayscale — so the comment above promised a distinction the pixels
        // did not deliver. A paper-colored GAP separates the two rings
        // instead: a real difference in form, at page-background contrast, that
        // survives grayscale and every color-vision deficiency.
        ...(filledByCategory && {
          backgroundColor: "transparent",
          boxShadow: `inset 0 0 0 3px ${theme.palette.primary.main},
                      inset 0 0 0 5px ${theme.palette.background.paper},
                      inset 0 0 0 7px ${theme.palette.primary.main}`,
        }),
        boxSizing: "border-box",
      })}
    />
  );
}

function Legend({
  source,
  viaCategory,
  label,
}: {
  source: AccessSource;
  viaCategory?: boolean;
  label: string;
}) {
  return (
    <Stack direction="row" spacing={0.875} alignItems="center">
      <AccessDot source={source} viaCategory={viaCategory} />
      <Typography sx={{ fontSize: 11.5, color: "text.secondary" }}>{label}</Typography>
    </Stack>
  );
}
