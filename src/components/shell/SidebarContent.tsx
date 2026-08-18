"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";

import HomeRoundedIcon from "@mui/icons-material/HomeRounded";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import LogoutRoundedIcon from "@mui/icons-material/LogoutRounded";
import SettingsRoundedIcon from "@mui/icons-material/SettingsRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { visuallyHidden } from "@mui/utils";
import type { SvgIconComponent } from "@mui/icons-material";

import Logo from "@/components/Logo";
import { NAV_GROUP_LABEL, NAV_GROUP_ORDER } from "@/types/admin";
import type { ShellIdentity, ShellNavItem } from "@/types/shell";

import SidebarSearch from "./SidebarSearch";
import { entryIcon } from "./entryIcon";

/**
 * One nav row. Renders as a Next link for in-app routes and a plain anchor for
 * apps, which live on their own origins.
 *
 * `dimmed` is the design's third state: on the Admin screens the app nav stays
 * present but de-emphasised, so Admin reads as the active context without the
 * app links vanishing.
 */
function NavItem({
  href,
  icon: Icon,
  label,
  active = false,
  dimmed = false,
  external = false,
  onNavigate,
}: {
  href: string;
  icon: SvgIconComponent;
  label: string;
  active?: boolean;
  dimmed?: boolean;
  external?: boolean;
  onNavigate?: () => void;
}) {
  const linkProps = external
    ? { component: "a" as const, href, target: "_blank", rel: "noopener noreferrer" }
    : { component: NextLink, href };

  return (
    <Box
      {...linkProps}
      // The drawer closes from the LINK, not from the sidebar container. A
      // handler on the container caught every bubbled click in the subtree —
      // including clicks into the search field, which closed the drawer before
      // a keystroke could land.
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.5,
        py: 1,
        minHeight: 38,
        borderRadius: 2,
        textDecoration: "none",
        fontSize: 13,
        cursor: "pointer",
        // Active fill is brand blue with the DARK ink token, not the design's
        // white. White on #3498DC is 3.15:1 and fails AA; primary.contrastText
        // is #1D1D20 at 5.34:1.
        backgroundColor: active ? theme.palette.primary.main : "transparent",
        color: active
          ? theme.palette.primary.contrastText
          : dimmed
            ? theme.palette.shell.textDim
            : theme.palette.shell.text,
        fontWeight: active ? 600 : 400,
        transition: theme.transitions.create(["background-color", "color"], { duration: 150 }),
        "&:hover": {
          backgroundColor: active ? theme.palette.primary.main : theme.palette.shell.surface,
          color: active ? theme.palette.primary.contrastText : theme.palette.shell.textStrong,
        },
        "&:focus-visible": {
          outline: `3px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <Icon aria-hidden sx={{ fontSize: 16, flexShrink: 0 }} />
      <Box
        component="span"
        sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {label}
      </Box>
      {external ? (
        <>
          {/*
            The design's external-link marker, plus the announcement it implies.
            The icon is aria-hidden — an earlier comment justified that by
            claiming the anchor's accessible name already carried "opens in a
            new tab", which was simply untrue: the name is the label alone. So
            every app link opened a new tab with no warning to a screen-reader
            user (WCAG 3.2.5). The visually hidden span is the actual carrier.
          */}
          <LaunchRoundedIcon aria-hidden sx={{ fontSize: 12, flexShrink: 0, opacity: 0.55 }} />
          <Box component="span" sx={visuallyHidden}>
            {" "}
            (opens in a new tab)
          </Box>
        </>
      ) : null}
    </Box>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="div"
      sx={{
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "1.5px",
        textTransform: "uppercase",
        color: "shell.label",
        mx: 1.5,
        mt: 2,
        mb: 0.75,
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * The persistent sidebar: wordmark, search, the app nav, and the signed-in
 * identity block.
 *
 * Nav is LAUNCHABLE APPS grouped by `nav_group`, in the design's order —
 * Marketing, Sales, Operations, External — with Home fixed at the top and Admin
 * fixed in the footer. Per the handoff, **a group renders only if the viewer
 * has at least one app in it**, so an empty group is absent rather than an
 * empty heading. That also means the sidebar is already per-viewer: the layout
 * hands down only rows RLS let through.
 *
 * `canAdmin` decides whether the Admin row renders. That is presentation, and
 * the design says as much ("the sidebar hiding an app is presentation, not
 * security"): the real gate is that `access_grants`, `type_grants`,
 * `member_types` writes and `list_people()` are all super_admin-only in the
 * database.
 */
export default function SidebarContent({
  navItems,
  identity,
  canAdmin,
  onNavigate,
}: {
  navItems: ShellNavItem[];
  identity: ShellIdentity;
  canAdmin: boolean;
  /** Closes the mobile drawer after a nav tap. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const onAdmin = pathname.startsWith("/admin");

  return (
    <Box
      sx={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "shell.bg",
        px: 1.75,
        pt: 2.75,
        pb: 2.25,
        overflowY: "auto",
      }}
    >
      <Box sx={{ alignSelf: "flex-start", mx: 1.25, mb: 2.5, display: "flex" }}>
        {/* `on="dark"` — the sidebar is dark in BOTH themes, so the ink must not
            follow theme mode or the reversed lockup vanishes in light mode.
            26px, not the handoff's 19px: that figure is for a wordmark-ONLY
            crop, and this asset is the mark+wordmark lockup. */}
        <Logo variant="secondary" height={26} on="dark" />
      </Box>

      <SidebarSearch onNavigate={onNavigate} />

      <Stack component="nav" aria-label="Apps" spacing={0.25}>
        <NavItem
          href="/"
          icon={HomeRoundedIcon}
          label="Home"
          active={!onAdmin}
          dimmed={onAdmin}
          onNavigate={onNavigate}
        />

        {NAV_GROUP_ORDER.map((group) => {
          const items = navItems.filter((n) => n.navGroup === group);
          // "A group renders only if the user has at least one granted app in
          // it" — handoff, Nav structure. An empty heading would also leak that
          // the group exists and this viewer has nothing in it.
          if (items.length === 0) return null;
          return (
            <Box key={group} component="div">
              <GroupLabel>{NAV_GROUP_LABEL[group]}</GroupLabel>
              {items.map((item) => (
                <NavItem
                  key={item.id}
                  href={item.href}
                  icon={entryIcon(item.slug)}
                  label={item.name}
                  dimmed={onAdmin}
                  external={item.external}
                  onNavigate={onNavigate}
                />
              ))}
            </Box>
          );
        })}
      </Stack>

      <Box
        sx={{
          mt: "auto",
          pt: 1.5,
          borderTop: 1,
          borderColor: "shell.border",
          display: "flex",
          flexDirection: "column",
          gap: 0.25,
        }}
      >
        {/* Its own landmark: the app <nav> closes above, so without this the
            only non-app route link sits in no landmark at all. */}
        {canAdmin ? (
          <Box component="nav" aria-label="Administration">
            {/*
        The handoff gives Admin a sub-nav — Access, App registry, Audit log.
        This was a single flat "Admin" row for as long as Access was the only
        screen that existed, on the stated grounds that a disclosure container
        wrapping one item is chrome around nothing, and that it would become a
        sub-nav "until a second admin screen lands".

        Catalog is that second screen, so this is now the sub-nav its own
        deviation note promised. Both rows are listed rather than one being
        reachable only from inside the other: an unlinked screen is a screen
        nobody finds, and the whole reason the catalog could never be filled in
        was that its route did not exist to be linked to.

        The Audit log is deliberately still absent — it is a TAB inside Access
        rather than a route of its own, so listing it here would be a link to
        somewhere that is not a page.
      */}
            <GroupLabel>Admin</GroupLabel>
            <NavItem
              href="/admin/catalog"
              icon={Inventory2OutlinedIcon}
              label="Catalog"
              // Per-route, not the shared "/admin" prefix: with two admin rows a
              // test on "/admin" alone would light both at once and the sidebar
              // would stop saying where you are.
              active={pathname.startsWith("/admin/catalog")}
              onNavigate={onNavigate}
            />
            <NavItem
              href="/admin/access"
              icon={SettingsRoundedIcon}
              label="Access"
              active={pathname.startsWith("/admin/access")}
              onNavigate={onNavigate}
            />
          </Box>
        ) : null}

        <Stack direction="row" spacing={1.25} alignItems="center" sx={{ px: 1.5, py: 1 }}>
          <Box
            aria-hidden
            sx={{
              width: 30,
              height: 30,
              flexShrink: 0,
              borderRadius: "50%",
              backgroundColor: "primary.main",
              color: "primary.contrastText",
              fontSize: 11,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {identity.initials}
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              title={identity.email}
              sx={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "shell.text",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {identity.email}
            </Typography>
            <Typography sx={{ fontSize: 10.5, color: "shell.meta" }}>
              {identity.roleLabel}
            </Typography>
          </Box>

          {/* The design puts a chevron here as a "menu affordance" and never
              designs the menu. Sign out is the only item it would hold today,
              so it is rendered directly. Plain form POST — no client JS. */}
          <Box component="form" action="/auth/signout" method="post" sx={{ display: "flex" }}>
            <Tooltip title="Sign out">
              <IconButton
                type="submit"
                size="small"
                aria-label="Sign out"
                sx={(t) => ({
                  cursor: "pointer",
                  color: t.palette.shell.meta,
                  "&:hover": {
                    color: t.palette.shell.textStrong,
                    backgroundColor: t.palette.shell.surface,
                  },
                })}
              >
                <LogoutRoundedIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
