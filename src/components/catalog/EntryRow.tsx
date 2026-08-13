"use client";

import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { CatalogEntry } from "@/types/catalog";

import StatusChip from "./StatusChip";
import { showStatusChip } from "./entryMeta";

/**
 * A non-launchable entry (reference_only / catalog_only) — a quiet ledger row
 * you consult, not a thing you launch. The whole row is one button that opens
 * detail; there is deliberately no launch affordance, because there is nothing
 * to launch, and its flat single-line form is what distinguishes it from a tile
 * at a glance (see LaunchTile). A chevron signals "opens detail", not "opens
 * app".
 */
export default function EntryRow({
  entry,
  onOpenDetail,
}: {
  entry: CatalogEntry;
  onOpenDetail: (entry: CatalogEntry) => void;
}) {
  return (
    <Box
      component="button"
      type="button"
      onClick={() => onOpenDetail(entry)}
      aria-label={`Details for ${entry.display_name}`}
      sx={(theme) => ({
        width: "100%",
        textAlign: "left",
        border: 0,
        background: "none",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: 1.5,
        px: 1.5,
        py: 1.5,
        minHeight: 44,
        borderRadius: 2,
        color: "inherit",
        font: "inherit",
        transition: theme.transitions.create(["background-color"], { duration: 150 }),
        "&:hover": { backgroundColor: "action.hover" },
        "&:focus-visible": {
          outline: `3px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      })}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
          {/* The name is the field most likely to run long, so IT gets the
              ellipsis (capped at 60% on xs / 55% up, so the description still
              shows), not the description. Without this the nowrap name overran
              the chip and chevron at 375px. */}
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: "text.primary",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: { xs: "60%", sm: "55%" },
              flexShrink: 0,
            }}
          >
            {entry.display_name}
          </Typography>
          {/* One line, ellipsised — the row never wraps, which is what keeps the
              list scannable and dense. Full description is in the panel. */}
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {entry.description}
          </Typography>
        </Stack>
      </Box>

      {showStatusChip(entry.status) ? (
        <Box sx={{ flexShrink: 0 }}>
          <StatusChip status={entry.status} />
        </Box>
      ) : null}

      <ChevronRightRoundedIcon aria-hidden sx={{ color: "text.secondary", fontSize: 20, flexShrink: 0 }} />
    </Box>
  );
}
