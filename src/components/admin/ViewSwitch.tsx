"use client";

import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";

/**
 * The design's pill segmented control, extended: By person | Matrix | Types.
 *
 * MUI's ToggleButtonGroup rather than two styled Boxes, because it already
 * carries the roles, arrow-key roving focus and pressed state this pattern
 * needs — reimplementing those on divs is how segmented controls end up
 * keyboard-inaccessible.
 *
 * The active segment uses `text.primary` fill with `background.paper` ink
 * (design: #1D1D20 / #fff), which is the same near-black the sidebar uses.
 */
/** The design's two segments, plus Types and the append-only access Audit. */
export type AdminView = "person" | "matrix" | "types" | "audit";

export default function ViewSwitch({
  value,
  onChange,
}: {
  value: AdminView;
  onChange: (next: AdminView) => void;
}) {
  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={value}
      aria-label="Access view"
      onChange={(_, next) => {
        // null when the active segment is clicked again — a segmented control
        // has no "off", so ignore it rather than dropping to an unset view.
        if (next === "person" || next === "matrix" || next === "types" || next === "audit") {
          onChange(next);
        }
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
      <ToggleButton value="person">By person</ToggleButton>
      <ToggleButton value="matrix">Matrix</ToggleButton>
      {/* Third segment, beyond the design's two. The handoff predates user
          types; with types, "what can this TYPE see" is a question neither
          person-shaped view can answer, and putting it anywhere else would
          split access administration across two places. */}
      <ToggleButton value="types">Types</ToggleButton>
      {/* Fourth segment. The audit log answers "who changed what, and when",
          which is a question about the other three views rather than a fourth
          way of editing access — it is read-only by construction. */}
      <ToggleButton value="audit">Audit</ToggleButton>
    </ToggleButtonGroup>
  );
}
