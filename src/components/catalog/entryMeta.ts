import type { Theme } from "@mui/material/styles";

import type { EntryStatus } from "@/types/catalog";

/**
 * Status -> color. fg is the TEXT token, ring the FILL token; they differ on
 * purpose, because the fill tokens measure 2.07-3.44:1 as text on their own
 * tint (under WCAG AA), so the readable text uses the *Text tokens and the fill
 * is demoted to a 1px ring. Color is never the only carrier — the chip always
 * shows the status word as text (WCAG 1.4.1).
 */
export function statusColors(theme: Theme, status: EntryStatus) {
  const { status: s } = theme.palette;
  const map: Record<EntryStatus, { fg: string; bg: string; ring: string }> = {
    active: { fg: s.greenText, bg: s.greenBg, ring: s.green },
    coming_soon: { fg: s.yellowText, bg: s.yellowBg, ring: s.yellow },
    unverified: { fg: s.yellowText, bg: s.yellowBg, ring: s.yellow },
    retiring: { fg: s.redText, bg: s.redBg, ring: s.red },
    wind_down: { fg: s.redText, bg: s.redBg, ring: s.red },
    orphaned: { fg: s.redText, bg: s.redBg, ring: s.red },
  };
  return (
    map[status] ?? {
      fg: theme.palette.text.primary,
      bg: theme.palette.action.hover,
      ring: theme.palette.divider,
    }
  );
}

/** Enum member -> human label. Falls through to the raw value on a new member. */
export function humanise(value: string): string {
  if (!value) return "—";
  return value.replace(/_/g, " ");
}

/**
 * The browse surface carries a status chip ONLY when the status is not `active`.
 * An active thing is the unremarkable default and does not earn a badge; a chip
 * on every card would be noise and would flatten the signal the exceptions
 * carry. `active` is the single value this returns false for.
 */
export function showStatusChip(status: EntryStatus): boolean {
  return status !== "active";
}

/**
 * Two statuses are not lifecycle stages and cannot be inferred from the word
 * alone, so they carry a hint into the chip's accessible name.
 */
export const STATUS_HINT: Partial<Record<EntryStatus, string>> = {
  unverified: "Catalogued, but its details have not been confirmed against a live source",
  orphaned: "Still running, no clear owner",
  coming_soon: "Not built yet",
  retiring: "Being wound down",
  wind_down: "Its platform is being wound down",
};
