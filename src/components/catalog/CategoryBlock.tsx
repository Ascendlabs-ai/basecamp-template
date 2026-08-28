"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { motion, useReducedMotion } from "framer-motion";

import type { CatalogCategory, CatalogEntry } from "@/types/catalog";

import EntryRow from "./EntryRow";
import FeatureEntry from "./FeatureEntry";
import LaunchTile from "./LaunchTile";

import { useIsHydrated } from "@/lib/useIsHydrated";

const MotionBox = motion.create(Box);

function isLaunchable(e: CatalogEntry): boolean {
  return e.entry_type === "launchable" && Boolean(e.launch_url);
}

/** Quiet orientation label shown only when a section holds both kinds. */
function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      sx={{
        display: "block",
        color: "text.secondary",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 700,
        mb: 1,
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * One category. Rhythm comes from two things:
 *
 *   1. The LEAD category (page's first, by sort_order — Priority today) renders
 *      its entries as full-width accented features, so it reads as the page's
 *      focus rather than a lone item in a grid. `lead` is passed in; it is NOT
 *      derived from entry count. Keying emphasis off `entries.length === 1`
 *      would be wrong under this app's per-user RLS: a viewer whose grants
 *      expose a single entry inside an otherwise large category would then see
 *      that one entry wrongly promoted to a hero. Emphasis belongs to the
 *      category's position — the top of what a given viewer can see — not to
 *      how many rows a grant happens to reveal. Position is a far weaker and
 *      more defensible per-user dependency than count: it never promotes an
 *      arbitrary single entry, it only ever emphasises the lead of the list.
 *
 *   2. Every other category leads with a tile grid of its launchables (if any)
 *      over a dense row list of its reference/catalog entries (if any). A
 *      launchable-rich category and an all-reference category therefore have
 *      structurally different shapes, not the same grid at two lengths.
 */
export default function CategoryBlock({
  category,
  lead = false,
  nested = false,
  onOpenDetail,
}: {
  category: CatalogCategory;
  lead?: boolean;
  /**
   * Renders as a subcategory of the block above it: indented, with a smaller
   * heading and less space beneath.
   *
   * A PRESENTATION FLAG, not a structural one. The caller flattens the tree and
   * decides the order; this only says how the block should look in it. That
   * keeps the section landmark and its `aria-labelledby` identical at both
   * depths, so a screen-reader user gets one predictable list of sections
   * rather than a nested one they must navigate differently.
   */
  nested?: boolean;
  onOpenDetail: (entry: CatalogEntry) => void;
}) {
  const reduceMotion = useReducedMotion();
  // Framer serialises the `initial` variant into the SSR markup, but on the
  // client its first render does NOT apply it for a whileInView element — the
  // intersection observer has not run yet. React therefore hydrated a node
  // carrying `transform: translateY(10px)` against a client render without it,
  // and logged "some attributes ... didn't match. This won't be patched up" for
  // every entry on the page. Invisible until 2026-07-29 because no session had
  // ever gotten past /login to read the console.
  //
  // Gating `initial` on mount makes both sides agree: the server and the first
  // client render both emit no transform, and the entrance animation arms one
  // tick later, which is before any of these elements can scroll into view.
  const armed = useIsHydrated();

  const launchables = category.entries.filter(isLaunchable);
  const rest = category.entries.filter((e) => !isLaunchable(e));
  const bothKinds = launchables.length > 0 && rest.length > 0;

  const container = {
    hidden: {},
    show: { transition: { staggerChildren: reduceMotion ? 0 : 0.035, delayChildren: 0.02 } },
  };
  // y only, never opacity — hidden state is serialised into SSR, and a fade
  // that never resolves (JS blocked / hydration error) would leave the catalog
  // invisible; a translate that never resolves leaves it readable.
  const item = {
    hidden: reduceMotion ? {} : { y: 10 },
    show: { y: 0, transition: { duration: reduceMotion ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] as const } },
  };

  return (
    <Box
      component="section"
      sx={{
        mb: nested ? { xs: 3, md: 4 } : { xs: 4.5, md: 6 },
        ml: nested ? { xs: 0, md: 3 } : 0,
        // A rule rather than an indent on small screens, where horizontal space
        // is the scarce thing and 24px of it would squeeze the tiles.
        pl: nested ? { xs: 1.5, md: 2 } : 0,
        borderLeft: nested ? 2 : 0,
        borderColor: "divider",
      }}
      aria-labelledby={`cat-${category.slug}`}
    >
      <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ mb: 0.5, flexWrap: "wrap" }}>
        {/* `h3` when nested — the heading level follows the document outline,
            because a screen-reader user navigating by heading is how the nesting
            is actually perceived. `variant` follows separately: it is the visual
            size and must not be what decides the outline. */}
        <Typography
          id={`cat-${category.slug}`}
          variant={nested ? "h6" : "h5"}
          component={nested ? "h3" : "h2"}
          sx={{ fontWeight: 700 }}
        >
          {category.name}
        </Typography>
        <Chip
          size="small"
          label={`${category.entries.length} ${category.entries.length === 1 ? "entry" : "entries"}`}
          // text.primary on celestial.light = 14.72:1. `primary.dark` (the prior
          // value) is MUI-derived #2A7AB0 and measures 4.08:1 on this tint —
          // under AA. Dark ink on the pale-blue pill keeps the filled shape and
          // uses only brand tokens.
          sx={{ fontWeight: 600, backgroundColor: "celestial.light", color: "text.primary" }}
        />
      </Stack>

      {category.description ? (
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 2.5, maxWidth: "72ch" }}>
          {category.description}
        </Typography>
      ) : (
        <Box sx={{ mb: 2.5 }} />
      )}

      {lead ? (
        <MotionBox
          variants={container}
          initial={armed ? "hidden" : false}
          whileInView="show"
          viewport={{ once: true, amount: 0.08 }}
          sx={{ display: "grid", gap: 2 }}
        >
          {category.entries.map((entry) => (
            <motion.div key={entry.id} variants={item}>
              <FeatureEntry entry={entry} onOpenDetail={onOpenDetail} />
            </motion.div>
          ))}
        </MotionBox>
      ) : (
        <MotionBox
          variants={container}
          initial={armed ? "hidden" : false}
          whileInView="show"
          viewport={{ once: true, amount: 0.08 }}
        >
          {launchables.length > 0 ? (
            <Box sx={{ mb: rest.length > 0 ? 3 : 0 }}>
              {bothKinds ? <GroupLabel>Launch</GroupLabel> : null}
              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "1fr",
                    sm: "repeat(2, minmax(0, 1fr))",
                    lg: "repeat(3, minmax(0, 1fr))",
                  },
                }}
              >
                {launchables.map((entry) => (
                  <motion.div key={entry.id} variants={item} style={{ display: "flex" }}>
                    <Box sx={{ width: "100%" }}>
                      <LaunchTile entry={entry} onOpenDetail={onOpenDetail} />
                    </Box>
                  </motion.div>
                ))}
              </Box>
            </Box>
          ) : null}

          {rest.length > 0 ? (
            <Box>
              {bothKinds ? <GroupLabel>Catalogued</GroupLabel> : null}
              <Paper
                elevation={0}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  overflow: "hidden",
                  "& > *:not(:last-child)": { borderBottom: 1, borderColor: "divider" },
                }}
              >
                {rest.map((entry) => (
                  <motion.div key={entry.id} variants={item}>
                    <EntryRow entry={entry} onOpenDetail={onOpenDetail} />
                  </motion.div>
                ))}
              </Paper>
            </Box>
          ) : null}
        </MotionBox>
      )}
    </Box>
  );
}
