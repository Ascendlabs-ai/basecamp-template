"use client";

import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { CatalogEntry } from "@/types/catalog";

import OpenAction from "./OpenAction";
import StatusChip from "./StatusChip";
import StretchedDetailButton from "./StretchedDetailButton";
import { showStatusChip } from "./entryMeta";

/**
 * A launchable entry — an elevated, tactile object you act on.
 *
 * Two focusable controls, never nested (a button in a button is invalid and
 * breaks keyboards): the title is a stretched detail button whose ::after
 * covers the whole tile (StretchedDetailButton), and Open is a sibling anchor
 * (OpenAction) painting above it. A pointer click anywhere on the tile opens
 * detail EXCEPT on Open, which launches. Tab order is title, then Open.
 */
export default function LaunchTile({
  entry,
  onOpenDetail,
}: {
  entry: CatalogEntry;
  onOpenDetail: (entry: CatalogEntry) => void;
}) {
  return (
    <Paper
      elevation={0}
      sx={(theme) => ({
        position: "relative",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        p: 2.5,
        border: 1,
        borderColor: "divider",
        backgroundColor: "background.paper",
        transition: theme.transitions.create(["border-color", "box-shadow"], { duration: 200 }),
        "&:hover": {
          borderColor: "primary.main",
          boxShadow: theme.shadows[4],
        },
        // Lift the ring to the tile so the whole object reads as focused when
        // either control is.
        "&:has(:focus-visible)": {
          borderColor: "primary.main",
          boxShadow: theme.shadows[4],
        },
      })}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start" sx={{ mb: 0.75 }}>
        <Typography
          variant="subtitle1"
          component="h3"
          sx={{ flex: 1, minWidth: 0, fontWeight: 600, lineHeight: 1.3 }}
        >
          <StretchedDetailButton name={entry.display_name} onOpen={() => onOpenDetail(entry)} />
        </Typography>

        {/* Under the stretched ::after, so the whole face — title, description,
            chip — opens detail. Only Open (z-index 1) sits above the hit area. */}
        {showStatusChip(entry.status) ? <StatusChip status={entry.status} /> : null}
      </Stack>

      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          lineHeight: 1.55,
          mb: 2.5,
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 1,
          overflow: "hidden",
        }}
      >
        {entry.description}
      </Typography>

      {/* Pinned to the bottom so Open lines up across a grid of uneven titles. */}
      <OpenAction
        name={entry.display_name}
        href={entry.launch_url as string}
        sx={{ mt: "auto", alignSelf: "flex-start" }}
      />
    </Paper>
  );
}
