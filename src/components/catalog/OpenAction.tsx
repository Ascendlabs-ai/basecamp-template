"use client";

import NorthEastRoundedIcon from "@mui/icons-material/NorthEastRounded";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

/**
 * The primary "Open" launch control, shared by LaunchTile and FeatureEntry.
 *
 * One home for the a11y- and contrast-critical bits: a real `<a href target>`
 * (keyboard-reachable, opens a new tab), a ≥44px target, the dark-token label on
 * Celestial Blue (5.34:1 — white would be 3.15:1), elevation-not-darken hover
 * (darkening the fill would drop the dark text under AA), a `zIndex:1` so it
 * paints above a stretched detail hit area, and a 3px focus ring. Callers pass
 * `sx` only for placement (a column tile pins it bottom-left; a row feature
 * pins it right).
 */
export default function OpenAction({
  name,
  href,
  sx,
}: {
  name: string;
  href: string;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Open ${name} in a new tab`}
      sx={[
        (theme) => ({
          position: "relative",
          zIndex: 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 0.75,
          minHeight: 44,
          px: 1.75,
          py: 1,
          borderRadius: 2,
          fontWeight: 600,
          fontSize: "0.9375rem",
          cursor: "pointer",
          color: "primary.contrastText",
          backgroundColor: "primary.main",
          textDecoration: "none",
          transition: theme.transitions.create(["box-shadow"], { duration: 150 }),
          "&:hover": { boxShadow: theme.shadows[3] },
          "&:focus-visible": { outline: `3px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      Open
      <NorthEastRoundedIcon aria-hidden sx={{ fontSize: 18 }} />
    </Box>
  );
}
