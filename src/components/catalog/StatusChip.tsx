"use client";

import Chip from "@mui/material/Chip";

import type { EntryStatus } from "@/types/catalog";

import { STATUS_HINT, humanise, statusColors } from "./entryMeta";

/**
 * The status pill, in one place. fg is the text-safe token and the fill token is
 * demoted to a 1px ring (the fills measure 2.07-3.44:1 as text — under AA). The
 * word is always present, so colour is never the only carrier (WCAG 1.4.1), and
 * the two non-obvious statuses carry a hint into the accessible name.
 *
 * Extracted because this exact block was copied into four call sites and had
 * already started to drift.
 */
export default function StatusChip({ status }: { status: EntryStatus }) {
  const hint = STATUS_HINT[status];
  return (
    <Chip
      label={humanise(status)}
      size="small"
      aria-label={hint ? `Status: ${humanise(status)}. ${hint}` : undefined}
      sx={(theme) => {
        const c = statusColors(theme, status);
        return {
          color: c.fg,
          backgroundColor: c.bg,
          fontWeight: 600,
          textTransform: "capitalize",
          border: 1,
          borderColor: c.ring,
        };
      }}
    />
  );
}
