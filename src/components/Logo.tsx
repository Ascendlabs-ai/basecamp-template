"use client";

import { useTheme } from "@mui/material/styles";

import { APP_NAME } from "@/lib/brand";

/**
 * PLACEHOLDER BRAND MARK — replace this with your own.
 *
 * The original app rendered real brand PNGs from `/public/logos`. Those are not
 * shipped in the template, because a template that carries someone else's logo
 * is a template that ships their identity. What is here instead is a neutral
 * geometric mark plus the product name from `src/lib/brand.ts`, drawn as inline
 * SVG so there is no image asset to fetch, no aspect-ratio table to keep in step,
 * and nothing to look broken before you have artwork.
 *
 * TO REBRAND, either:
 *   - swap the <svg> below for your own mark and keep the wordmark, or
 *   - drop your files in /public/logos and render <Image> here instead.
 *
 * Either way this component stays the ONLY place that knows what the brand looks
 * like. `src/lib/logoUsage.test.ts` enforces that: any other file reaching for a
 * logo asset fails the suite. That guard is why the header and the sign-in page
 * could not drift into hardcoding a light-mode-only image, which is what
 * happened before it existed.
 */
type LogoProps = {
  /** `secondary` for height-constrained chrome (nav, header); `primary` for spacious surfaces. */
  variant?: "secondary" | "primary";
  height?: number;
  /**
   * Which surface the logo sits ON, not which theme is active.
   *
   * Defaults to `auto`, which follows the theme mode and is right for anything
   * painted on `background.*`. The app shell's sidebar is a fixed dark surface
   * in BOTH modes, so it passes `dark` explicitly — under `auto` the mark would
   * flip to dark ink on a near-black panel and disappear.
   */
  on?: "auto" | "light" | "dark";
};

export default function Logo({ variant = "secondary", height = 32, on = "auto" }: LogoProps) {
  const theme = useTheme();
  const surfaceIsDark = on === "auto" ? theme.palette.mode === "dark" : on === "dark";

  const ink = surfaceIsDark ? "#FFFFFF" : "#1D1D20";
  const accent = theme.palette.primary.main;
  const stacked = variant === "primary";

  // The mark is a simple ascending chevron pair — deliberately generic.
  const markSize = stacked ? height * 0.55 : height;
  const fontSize = stacked ? height * 0.26 : height * 0.42;

  return (
    <span
      aria-label={APP_NAME}
      role="img"
      style={{
        display: "inline-flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: stacked ? height * 0.1 : height * 0.28,
        height,
        lineHeight: 1,
      }}
    >
      <svg
        width={markSize}
        height={markSize}
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden
        focusable="false"
      >
        <path d="M6 20.5 16 9l10 11.5" stroke={accent} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 26.5 16 15l10 11.5" stroke={ink} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
      </svg>
      <span
        style={{
          color: ink,
          fontSize,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          whiteSpace: "nowrap",
        }}
      >
        {APP_NAME}
      </span>
    </span>
  );
}
