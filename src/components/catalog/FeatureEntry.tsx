"use client";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { CatalogEntry } from "@/types/catalog";

import OpenAction from "./OpenAction";
import StatusChip from "./StatusChip";
import StretchedDetailButton from "./StretchedDetailButton";
import { showStatusChip } from "./entryMeta";

/**
 * The emphasised, full-width treatment for the entries of the LEAD category.
 *
 * Emphasis is a property of the category's position, not of how many entries a
 * given viewer can see — see CategoryBlock for why that matters under per-user
 * RLS. Same face rule as everything else: name, one line, status chip only when
 * not active. Same shared primitives as LaunchTile (StretchedDetailButton +
 * OpenAction), so the accessibility pattern is maintained in one place.
 */
export default function FeatureEntry({
  entry,
  onOpenDetail,
}: {
  entry: CatalogEntry;
  onOpenDetail: (entry: CatalogEntry) => void;
}) {
  const launchable = entry.entry_type === "launchable" && Boolean(entry.launch_url);

  return (
    <Paper
      elevation={0}
      sx={(theme) => ({
        position: "relative",
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        alignItems: { sm: "center" },
        gap: 2,
        p: { xs: 2.5, sm: 3 },
        border: 1,
        borderColor: "divider",
        borderLeft: 4,
        // Blue accent ONLY when launchable — Celestial Blue is the app's launch
        // colour, so a blue rule on a reference entry would imply an action it
        // does not have. A non-launchable feature gets a neutral rule.
        borderLeftColor: launchable ? "primary.main" : "text.secondary",
        backgroundColor: "background.paper",
        transition: theme.transitions.create(["box-shadow"], { duration: 200 }),
        "&:hover": { boxShadow: theme.shadows[3] },
        "&:has(:focus-visible)": { boxShadow: theme.shadows[3] },
      })}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }} flexWrap="wrap" useFlexGap>
          <Typography variant="h6" component="h3" sx={{ fontWeight: 700 }}>
            <StretchedDetailButton name={entry.display_name} onOpen={() => onOpenDetail(entry)} />
          </Typography>
          {/* Under the stretched ::after, so the chip area opens detail too. */}
          {showStatusChip(entry.status) ? <StatusChip status={entry.status} /> : null}
        </Stack>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.55 }}>
          {entry.description}
        </Typography>
      </Box>

      {launchable ? (
        <OpenAction
          name={entry.display_name}
          href={entry.launch_url as string}
          sx={{ flexShrink: 0 }}
        />
      ) : null}
    </Paper>
  );
}
