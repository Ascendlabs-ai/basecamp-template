"use client";

import { useCallback, useState } from "react";

import MenuRoundedIcon from "@mui/icons-material/MenuRounded";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";

import type { ShellIdentity, ShellNavItem } from "@/types/shell";
import type { Branding } from "@/lib/branding";

import SidebarContent from "./SidebarContent";

const SIDEBAR_WIDTH = 256;

/**
 * The persistent two-column frame: fixed sidebar, scrolling canvas.
 *
 * The design is drawn at 1280px and says to collapse below ~1100px. This uses
 * MUI's `lg` breakpoint (1200px) as the nearest system value rather than
 * inventing a one-off — below it the sidebar becomes an overlay drawer reached
 * from a menu button, above it the sidebar is permanent.
 *
 * **Responsive switching is CSS, not `useMediaQuery`.** An earlier version
 * branched on `useMediaQuery(up("lg"))`, which returns `false` during SSR — so
 * the server rendered the Drawer branch, and MUI's Drawer is a Portal that does
 * not server-render at all. The observable result: the production HTML for `/`
 * contained no sidebar, desktop users got a nav that popped in after hydration,
 * and without JS there was no navigation whatsoever. Caught by grepping the
 * server response, not by looking at the page. Two elements with breakpoint
 * `display` keep the desktop sidebar in the server HTML.
 *
 * The design's intermediate state (a 64px icon rail with tooltips) is not built:
 * an icon rail needs a distinct glyph per destination to be usable, and while
 * the app icons are mapped per the handoff, several would not be self-evident
 * without their labels. A drawer that shows the real labels is the
 * honest version of the same affordance.
 */
export default function AppShell({
  navItems,
  identity,
  canAdmin,
  branding,
  children,
}: {
  navItems: ShellNavItem[];
  identity: ShellIdentity;
  canAdmin: boolean;
  branding: Branding;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      {/* WCAG 2.4.1. Every page puts the wordmark, the search field, Home and
          the whole app nav ahead of the content; this is the bypass. Visible
          only on focus, and it targets the #main-content each page's <main>
          carries. */}
      <Link
        href="#main-content"
        sx={{
          position: "absolute",
          left: -9999,
          top: 8,
          zIndex: (t) => t.zIndex.tooltip + 1,
          px: 2,
          py: 1,
          borderRadius: 2,
          backgroundColor: "background.paper",
          color: "text.primary",
          fontSize: 13,
          fontWeight: 600,
          textDecoration: "none",
          boxShadow: 3,
          "&:focus": { left: 8 },
        }}
      >
        Skip to content
      </Link>
      {/* Desktop: real element, in the server HTML. */}
      <Box
        component="aside"
        sx={{
          display: { xs: "none", lg: "block" },
          width: SIDEBAR_WIDTH,
          flexShrink: 0,
          position: "sticky",
          top: 0,
          height: "100dvh",
        }}
      >
        <SidebarContent navItems={navItems} identity={identity} canAdmin={canAdmin} branding={branding} />
      </Box>

      {/* Below lg: overlay drawer. Portal-rendered, so it contributes nothing
          to SSR — which is fine, because the desktop sidebar above is the copy
          that has to be there on first paint. */}
      <Drawer
        open={open}
        onClose={close}
        sx={{
          display: { xs: "block", lg: "none" },
          "& .MuiDrawer-paper": {
            width: SIDEBAR_WIDTH,
            backgroundColor: "shell.bg",
            backgroundImage: "none",
            borderRight: 0,
          },
        }}
      >
        <SidebarContent
          navItems={navItems}
          identity={identity}
          canAdmin={canAdmin}
          branding={branding}
          onNavigate={close}
        />
      </Drawer>

      <Box
        component="div"
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          backgroundColor: "background.default",
        }}
      >
        <Box
          sx={{
            display: { xs: "flex", lg: "none" },
            alignItems: "center",
            height: 54,
            px: 1,
            flexShrink: 0,
            backgroundColor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <IconButton
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            sx={{ cursor: "pointer" }}
          >
            <MenuRoundedIcon />
          </IconButton>
        </Box>

        {children}
      </Box>
    </Box>
  );
}
