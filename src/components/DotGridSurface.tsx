"use client";

import { styled } from "@mui/material/styles";

/**
 * Full-height surface with a faint dot grid.
 *
 * `styled()` rather than an `sx` callback: the login page is a Server
 * Component, and a function passed in `sx` cannot be serialized across the
 * RSC boundary — it fails `next build` at prerender. Inside a styled()
 * definition the theme callback runs client-side and never crosses.
 *
 * A dot grid rather than a gradient wash — depth without the mesh-blob cliche,
 * and it reads as "technical inventory" rather than "marketing landing page".
 */
// styled("main"), not styled(Box): this element is always the page's <main>
// landmark, and baking the tag in keeps Box's polymorphic `component` prop
// (which styled() does not forward through its own types) out of the picture.
const DotGridSurface = styled("main")(({ theme }) => ({
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: theme.spacing(2),
  backgroundColor: theme.palette.background.default,
  backgroundImage: `radial-gradient(${theme.palette.divider} 1px, transparent 1px)`,
  backgroundSize: "22px 22px",
  [theme.breakpoints.up("sm")]: {
    padding: theme.spacing(3),
  },
}));

export default DotGridSurface;
