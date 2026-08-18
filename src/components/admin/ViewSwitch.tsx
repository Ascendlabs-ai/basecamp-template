"use client";

import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

/**
 * The design's pill segmented control.
 *
 * MUI's ToggleButtonGroup rather than two styled Boxes, because it already
 * carries the roles, arrow-key roving focus and pressed state this pattern
 * needs — reimplementing those on divs is how segmented controls end up
 * keyboard-inaccessible.
 *
 * The active segment uses `text.primary` fill with `background.paper` ink
 * (design: #1D1D20 / #fff), which is the same near-black the sidebar uses.
 *
 * GENERIC OVER ITS SEGMENTS, because a second admin screen (Catalog) now needs
 * the same control over a different set. The alternative was a second copy of
 * the `sx` block below, which is the shape that drifts: the next person to fix
 * the focus ring or the AA contrast on the active segment fixes it on one
 * screen. The segment list and the accessible name are the only things the two
 * callers disagree about, so they are the only things passed in.
 */
export default function ViewSwitch<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T;
  /** Rendered left to right, in this order. */
  options: ReadonlyArray<{ value: T; label: string }>;
  /** The group's accessible name, e.g. "Access view". */
  label: string;
  onChange: (next: T) => void;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      aria-label={label}
      onChange={(_, next) => {
        // null when the active segment is clicked again — a segmented control
        // has no "off", so ignore it rather than dropping to an unset view.
        // Checked against the OPTIONS rather than a hardcoded union, so this
        // stays correct for any caller's segment set.
        if (options.some((o) => o.value === next)) onChange(next as T);
      }}
      sx={(theme) => ({
        backgroundColor: theme.palette.action.hover,
        borderRadius: 50,
        p: "3px",
        gap: "3px",
        "& .MuiToggleButtonGroup-grouped": {
          border: 0,
          borderRadius: "50px !important",
          textTransform: "none",
          fontSize: 12,
          fontWeight: 500,
          lineHeight: 1.4,
          px: 2,
          py: 0.625,
          color: theme.palette.text.secondary,
          cursor: "pointer",
          transition: theme.transitions.create(["background-color", "color"], { duration: 150 }),
          "&:hover": { backgroundColor: theme.palette.action.selected },
          "&.Mui-selected": {
            backgroundColor: theme.palette.text.primary,
            color: theme.palette.background.paper,
            fontWeight: 600,
            "&:hover": { backgroundColor: theme.palette.text.primary },
          },
          "&.Mui-focusVisible": {
            outline: `3px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        },
      })}
    >
      {options.map((option) => (
        <ToggleButton key={option.value} value={option.value}>
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
