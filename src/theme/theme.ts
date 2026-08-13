"use client";

import { createTheme } from "@mui/material/styles";

/**
 * Shell surface tokens — the dark sidebar the app shell sits in.
 *
 * The sidebar is a fixed dark surface in BOTH themes (it is brand furniture,
 * not a mode-dependent panel), so these are defined once and shared. They exist
 * as tokens rather than inline rgba() so no component carries a raw colour.
 *
 * The design handoff specifies rgba(255,255,255,α) at α = .68 body / .55 dimmed
 * / .45 meta / .32 group-label. Alpha-composited on #1D1D20 and measured (not
 * estimated — an earlier version of this comment carried figures that were
 * understated by 15–22%, which is exactly the kind of number a later edit
 * trusts): .68 = 8.39:1, .55 = 5.91:1, .45 = 4.44:1, .32 = 2.89:1.
 *
 * The last two fail WCAG AA for text, so meta and label are raised to .62
 * (7.16:1). Deliberate deviation from the handoff — layout and hierarchy come
 * from the design, contrast floors do not.
 *
 * Verified against `bg` only. The two hover pairs also hold: meta on `surface`
 * is 6.29:1 and text on `surfaceHover` is 6.37:1.
 */
const shellTokens = {
  bg: "#1D1D20",
  // 8.39:1 on bg
  text: "rgba(255, 255, 255, 0.68)",
  // 5.91:1 on bg — for de-emphasised nav on admin screens
  textDim: "rgba(255, 255, 255, 0.55)",
  // Raised from the handoff's .45/.32 — both failed AA. 7.16:1 on bg.
  meta: "rgba(255, 255, 255, 0.62)",
  label: "rgba(255, 255, 255, 0.62)",
  // Hover/active ink. A token rather than a literal so no component carries a
  // raw hex — 16.8:1 on bg.
  textStrong: "#FFFFFF",
  // Non-text surfaces and rules; contrast floors do not apply.
  surface: "rgba(255, 255, 255, 0.07)",
  surfaceHover: "rgba(255, 255, 255, 0.12)",
  border: "rgba(255, 255, 255, 0.14)",
};

declare module "@mui/material/styles" {
  interface Palette {
    celestial: Palette["primary"];
    shell: typeof shellTokens;
    status: {
      green: string;
      yellow: string;
      red: string;
      greenBg: string;
      yellowBg: string;
      redBg: string;
      // Text-safe variants. The three above are FILL colours: used as text on
      // their own tint they measure 2.07:1 (yellow), 2.41:1 (green) and
      // 3.44:1 (red) — all under WCAG AA's 4.5:1. Never use them for text.
      greenText: string;
      yellowText: string;
      redText: string;
    };
    source: {
      slackBg: string;
      slackText: string;
      transcriptBg: string;
      transcriptText: string;
      emailBg: string;
      emailText: string;
    };
  }
  interface PaletteOptions {
    celestial?: PaletteOptions["primary"];
    // Required, not optional — same reasoning as the status text tokens below.
    // An optional shell would let a theme omit it and hand components
    // `backgroundColor: undefined`, silently rendering the sidebar transparent.
    shell: typeof shellTokens;
    status?: {
      green: string;
      yellow: string;
      red: string;
      // Required, not optional. With `?` a theme that omits them still type
      // checks, and statusColors would hand the Chip `color: undefined` —
      // silently inheriting text colour back to the 2.07-3.44:1 ratios the
      // text tokens exist to fix. No type error, no runtime error.
      greenText: string;
      yellowText: string;
      redText: string;
      greenBg: string;
      yellowBg: string;
      redBg: string;
    };
    source?: {
      slackBg: string;
      slackText: string;
      transcriptBg: string;
      transcriptText: string;
      emailBg: string;
      emailText: string;
    };
  }
}

const sharedTypography = {
  fontFamily: "var(--font-montserrat), Montserrat, sans-serif",
  fontWeightLight: 300,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,
};

const sharedComponents = {
  MuiButton: {
    defaultProps: { disableElevation: true as const },
    styleOverrides: {
      root: {
        textTransform: "none" as const,
        fontWeight: 600,
        borderRadius: 8,
        // Restores a visible focus indicator. MUI's ButtonBase sets
        // `outline: 0`, and the ONLY thing it substitutes for a contained
        // Button is `boxShadow: shadows[6]` on `.Mui-focusVisible` — which
        // `disableElevation` above (required by STYLE-GUIDE) sets to 'none'.
        // Between them, no button in this app had any visible focus state.
        // WCAG 2.4.7 / 2.4.11.
        //
        // Written as a plain object, not an ({ theme }) => ({}) callback:
        // `sharedComponents` is spread into two createTheme() calls, and a
        // callback here resolves against whichever theme is being built, which
        // is fine — but the literal keeps this file free of theme plumbing and
        // the outline colour is the same brand blue in both modes.
        "&.Mui-focusVisible": {
          outline: "3px solid #3498DC",
          outlineOffset: 2,
        },
      },
      // Hover feedback for contained primary is elevation, NOT a darker fill.
      // primary.contrastText is now the dark token (see palette below), and
      // MUI's default hover darkens primary.main toward primary.dark — which
      // drops dark-text contrast from 5.34:1 to 3.91:1, under AA. Keeping the
      // fill and lifting a shadow preserves 5.34:1 in every state while still
      // reading as a pressable object. Callback because it needs theme.shadows.
      containedPrimary: ({ theme }: { theme: import("@mui/material/styles").Theme }) => ({
        "&:hover": {
          backgroundColor: theme.palette.primary.main,
          boxShadow: theme.shadows[3],
        },
      }),
    },
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        "&.Mui-focusVisible": {
          outline: "3px solid #3498DC",
          outlineOffset: 2,
        },
      },
    },
  },
  // Switch defines NO .Mui-focusVisible style of its own, and the SwitchBase it
  // renders is a ButtonBase, which sets `outline: 0`. Between them a focused
  // Switch showed nothing but a faint centered ripple at action.hoverOpacity
  // inside a 24px box — invisible on a white card. These are the primary
  // controls of the admin access screen, so a keyboard user had no idea which
  // grant they were about to flip. WCAG 2.4.7.
  //
  // The ring goes on the ROOT, not on switchBase. A ring drawn around the thumb
  // is brand blue on a brand-blue thumb when the switch is CHECKED — 1:1 at the
  // inner edge and 1.83:1 against the checked track, both under WCAG 1.4.11's
  // 3:1 — so on exactly the rows that carry a grant, focus read as "the thumb
  // got slightly fatter". Around the root it is a pill outside the control
  // entirely, so it reads identically checked or unchecked. An element's own
  // overflow:hidden does not clip its outline, only its descendants.
  MuiSwitch: {
    styleOverrides: {
      root: {
        // primary.DARK (#2980B9), not primary.main. Granted rows are filled
        // celestial.light (#E3F2FD) by the by-person view, where #3498DC is
        // 2.76:1 — under 1.4.11 on exactly the rows a focus ring matters most.
        // #2980B9 is 3.77:1 there and 4.30:1 on plain paper.
        "&:has(.Mui-focusVisible)": {
          borderRadius: 50,
          outline: "3px solid #2980B9",
          outlineOffset: 2,
        },
      },
    },
  },
  MuiCard: {
    styleOverrides: {
      root: { borderRadius: 12 },
    },
  },
  MuiTextField: {
    defaultProps: { size: "small" as const },
  },
  MuiChip: {
    styleOverrides: {
      root: {
        fontWeight: 500,
        // `:focus-visible`, NOT `.Mui-focusVisible`.
        // Chip only renders as a ButtonBase when `clickable` or `onDelete` is
        // set (Chip.js: `clickable || onDelete ? ButtonBase : 'div'`), and
        // `focusVisibleClassName` is passed only in that branch. The status
        // chip is neither, so it is a plain <div> — the Mui-focusVisible class
        // never lands on it. Chip's own root slot also sets `outline: 0`,
        // killing the browser default. Giving it tabIndex={0} for the status
        // hint therefore created a tab stop with no visible focus at all.
        "&:focus-visible": { outline: "3px solid #3498DC", outlineOffset: 2 },
      },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { borderRadius: 12 },
    },
  },
  MuiPaper: {
    styleOverrides: {
      rounded: { borderRadius: 12 },
    },
  },
};

export const lightTheme = createTheme({
  palette: {
    mode: "light",
    // contrastText is the Dark Black brand token (#1D1D20 = text.primary),
    // NOT white. White on Celestial Blue is 3.15:1 and fails WCAG AA; Dark
    // Black on the same blue is 5.34:1. Not a new hex — the token already lives
    // in this file. Applies to every contained primary button app-wide.
    primary: { main: "#3498DC", contrastText: "#1D1D20" },
    secondary: { main: "#E3F2FD", contrastText: "#1D1D20" },
    error: { main: "#EF4444" },
    warning: { main: "#F59E0B" },
    success: { main: "#10B981" },
    background: { default: "#F8FAFB", paper: "#FFFFFF" },
    text: { primary: "#1D1D20", secondary: "#6B7280" },
    divider: "#E5E7EB",
    celestial: { main: "#3498DC", light: "#E3F2FD", dark: "#2980B9", contrastText: "#FFFFFF" },
    shell: shellTokens,
    status: {
      green: "#10B981",
      yellow: "#F59E0B",
      red: "#EF4444",
      greenBg: "#ECFDF5",
      yellowBg: "#FFFBEB",
      redBg: "#FEF2F2",
      greenText: "#047857",  // 5.21:1 on #ECFDF5
      yellowText: "#B45309", // 4.84:1 on #FFFBEB
      redText: "#B91C1C",    // 5.91:1 on #FEF2F2
    },
    source: {
      slackBg: "#E8D5F5",
      slackText: "#7C3AED",
      transcriptBg: "#DBEAFE",
      transcriptText: "#2563EB",
      emailBg: "#FEF3C7",
      emailText: "#D97706",
    },
  },
  typography: sharedTypography,
  shape: { borderRadius: 12 },
  components: {
    ...sharedComponents,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#F8FAFB",
          color: "#1D1D20",
        },
      },
    },
  },
});

export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    // contrastText is the Dark Black brand token (#1D1D20 = text.primary),
    // NOT white. White on Celestial Blue is 3.15:1 and fails WCAG AA; Dark
    // Black on the same blue is 5.34:1. Not a new hex — the token already lives
    // in this file. Applies to every contained primary button app-wide.
    primary: { main: "#3498DC", contrastText: "#1D1D20" },
    secondary: { main: "#242429", contrastText: "#F0F0F2" },
    error: { main: "#EF4444" },
    warning: { main: "#F59E0B" },
    success: { main: "#10B981" },
    background: { default: "#0F0F12", paper: "#1A1A1F" },
    text: { primary: "#F0F0F2", secondary: "#9CA3AF" },
    divider: "#2D2D33",
    celestial: { main: "#3498DC", light: "#1A2A3A", dark: "#2980B9", contrastText: "#FFFFFF" },
    // Same dark surface in both modes — the sidebar is brand furniture.
    shell: shellTokens,
    status: {
      green: "#10B981",
      yellow: "#F59E0B",
      red: "#EF4444",
      greenBg: "rgba(16, 185, 129, 0.15)",
      yellowBg: "rgba(245, 158, 11, 0.15)",
      redBg: "rgba(239, 68, 68, 0.15)",
      greenText: "#10B981",  // 5.39:1 on the composited tint — passes as-is
      yellowText: "#F59E0B", // 6.14:1 — passes as-is
      redText: "#FCA5A5",    // #EF4444 is only 3.95:1 here; this is 7.83:1
    },
    source: {
      slackBg: "rgba(124, 58, 237, 0.2)",
      slackText: "#A78BFA",
      transcriptBg: "rgba(37, 99, 235, 0.2)",
      transcriptText: "#93C5FD",
      emailBg: "rgba(217, 119, 6, 0.2)",
      emailText: "#FCD34D",
    },
  },
  typography: sharedTypography,
  shape: { borderRadius: 12 },
  components: {
    ...sharedComponents,
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#0F0F12",
          color: "#F0F0F2",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 12, border: "1px solid #2D2D33" },
      },
    },
  },
});
