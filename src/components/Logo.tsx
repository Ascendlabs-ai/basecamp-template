"use client";

import Image from "next/image";
import type { ImageLoader } from "next/image";
import { useTheme } from "@mui/material/styles";

import { FALLBACK_BRANDING, type Branding } from "@/lib/branding";

type LogoProps = {
  /** `secondary` for height-constrained chrome; `primary` for spacious surfaces. */
  variant?: "secondary" | "primary";
  height?: number;
  /** Which surface the logo sits on, not which theme is active. */
  on?: "auto" | "light" | "dark";
  branding?: Branding;
};

const publicLogoLoader: ImageLoader = ({ src }) => src;

/**
 * The one logo renderer for the application.
 *
 * A newly launched template uses the neutral inline mark below, so it never
 * inherits another client's identity. Once an administrator uploads a logo,
 * that public storage object replaces only the mark while the saved Basecamp
 * display name remains readable beside it.
 */
export default function Logo({
  variant = "secondary",
  height = 32,
  on = "auto",
  branding = FALLBACK_BRANDING,
}: LogoProps) {
  const theme = useTheme();
  const surfaceIsDark = on === "auto" ? theme.palette.mode === "dark" : on === "dark";
  const ink = surfaceIsDark ? "#FFFFFF" : "#1D1D20";
  const accent = theme.palette.primary.main;
  const stacked = variant === "primary";
  const customLogo = Boolean(branding.logoUrl);
  const markHeight = stacked ? height * 0.55 : height;
  const markWidth = customLogo ? Math.round(markHeight * 2.5) : markHeight;
  const fontSize = stacked ? height * 0.26 : height * 0.42;

  return (
    <span
      aria-label={branding.displayName}
      role="img"
      style={{
        display: "inline-flex",
        flexDirection: stacked ? "column" : "row",
        alignItems: "center",
        justifyContent: "center",
        gap: stacked ? height * 0.1 : height * 0.28,
        minHeight: height,
        lineHeight: 1,
      }}
    >
      {branding.logoUrl ? (
        <Image
          src={branding.logoUrl}
          alt=""
          width={markWidth}
          height={markHeight}
          priority={stacked}
          loader={publicLogoLoader}
          unoptimized
          style={{ width: markWidth, height: markHeight, objectFit: "contain" }}
        />
      ) : (
        <svg
          width={markHeight}
          height={markHeight}
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden
          focusable="false"
        >
          <path d="M6 20.5 16 9l10 11.5" stroke={accent} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
          <path d="M6 26.5 16 15l10 11.5" stroke={ink} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" opacity={0.55} />
        </svg>
      )}
      <span
        style={{
          color: ink,
          fontSize,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          whiteSpace: "nowrap",
        }}
      >
        {branding.displayName}
      </span>
    </span>
  );
}
