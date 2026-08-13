"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useIsHydrated } from "@/lib/useIsHydrated";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Box from "@mui/material/Box";
import InputBase from "@mui/material/InputBase";
import Typography from "@mui/material/Typography";

/**
 * "Search across apps" — the sidebar field from the design.
 *
 * The handoff specifies this opens a ⌘K cross-app command palette, and then
 * lists that palette under "not designed". Rendering the field as a decorative
 * box that opens nothing would be an inert control — it reads as interactive
 * and does nothing. So it is wired to the one search this app can actually
 * perform today: a filter over the catalog the viewer can see. ⌘K focuses it.
 *
 * State lives in the URL (`?q=`) rather than in React, which makes a filtered
 * view linkable and survives the server round-trip the catalog page does. The
 * input keeps its own draft state so typing stays responsive, and pushes on a
 * short debounce; a `q` arriving from elsewhere (back button, cleared filter)
 * syncs back into the draft.
 */
export default function SidebarSearch({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  const [draft, setDraft] = useState(urlQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  // The last value THIS component pushed. Without it, the sync effect below
  // cannot tell "the URL changed because I typed" from "the URL changed because
  // the user hit back", and would clobber in-flight keystrokes on every push.
  const pushedRef = useRef(urlQuery);

  useEffect(() => {
    if (urlQuery !== pushedRef.current) {
      pushedRef.current = urlQuery;
      setDraft(urlQuery);
    }
  }, [urlQuery]);

  const onCatalog = pathname === "/";

  // Debounced navigation. Searching is a navigation here, so an un-debounced
  // push would queue a server render per keystroke.
  useEffect(() => {
    if (draft === urlQuery) return;
    const id = setTimeout(() => {
      // Params are built FRESH, not cloned from the current URL. Cloning
      // carried `view=matrix` off /admin/access and onto `/`, where it means
      // nothing — the shell-level search had picked up one page's private
      // parameter contract.
      const next = new URLSearchParams();
      if (draft) next.set("q", draft);
      pushedRef.current = draft;
      const url = `/${next.toString() ? `?${next.toString()}` : ""}`;

      if (onCatalog) {
        // Same route: replace, so typing does not fill history with keystrokes.
        router.replace(url, { scroll: false });
      } else {
        // Leaving Admin for the catalog is a CHANGE OF CONTEXT, so it must be
        // pushed. With replace() the admin screen was overwritten in history
        // and the back button could not return to it — one keystroke silently
        // destroyed the view and its selected person with no way back.
        router.push(url);
        // Close the mobile drawer only on the cross-route jump: otherwise the
        // results render behind an overlay the user has to dismiss by hand.
        onNavigate?.();
      }
    }, 250);
    return () => clearTimeout(id);
  }, [draft, urlQuery, router, onCatalog, onNavigate]);

  // ⌘K / Ctrl+K focuses the field. The design promises the shortcut; honouring
  // it as "focus the real search" is the honest subset of that promise.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "k" || !(e.metaKey || e.ctrlKey)) return;
      // Two copies of this component are mounted below `lg`: the desktop
      // sidebar is hidden with `display: none` (not unmounted, so it stays in
      // the SSR markup) and the drawer holds the other. Without this guard both
      // listeners fired, the hidden one called preventDefault and then focused
      // an unfocusable input — so the shortcut did nothing at all on mobile
      // AND swallowed the browser's own ⌘K. `offsetParent` is null exactly when
      // an ancestor is display:none.
      if (!inputRef.current || inputRef.current.offsetParent === null) return;
      e.preventDefault();
      inputRef.current.focus();
      inputRef.current.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Platform-correct hint. The handler accepts metaKey OR ctrlKey, so showing
  // the Cmd glyph to a Windows user names a key they do not have. Read after
  // hydration — reading navigator during render would mismatch SSR.
  const hydrated = useIsHydrated();
  const isApple =
    hydrated && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  const clearOnEscape = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setDraft("");
      inputRef.current?.blur();
    }
  }, []);

  return (
    <Box
      sx={(theme) => ({
        display: "flex",
        alignItems: "center",
        gap: 1,
        mx: 0.25,
        mb: 2,
        px: 1.5,
        py: 1,
        borderRadius: 2,
        backgroundColor: theme.palette.shell.surface,
        border: 1,
        borderColor: theme.palette.shell.border,
        transition: theme.transitions.create(["background-color", "border-color"], {
          duration: 200,
        }),
        "&:hover": { backgroundColor: theme.palette.shell.surfaceHover },
        // `:has(:focus-visible)`, not `:focus-within` — the latter also fires
        // on a mouse click, so it painted a loud 3px keyboard ring at every
        // click. 3px matches every other control in the app.
        "&:has(:focus-visible)": {
          backgroundColor: theme.palette.shell.surfaceHover,
          outline: `3px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      <SearchRoundedIcon
        aria-hidden
        sx={{ fontSize: 16, color: "shell.meta", flexShrink: 0 }}
      />
      <InputBase
        inputRef={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={clearOnEscape}
        placeholder="Search across apps"
        inputProps={{ "aria-label": "Search across apps" }}
        sx={{
          flex: 1,
          minWidth: 0,
          color: "shell.text",
          fontSize: 13,
          "& input::placeholder": { color: "shell.meta", opacity: 1 },
        }}
      />
      {/* Hidden from a11y tree: it is a hint about a shortcut, not content, and
          screen-reader users get the shortcut from the input's own label. */}
      <Typography
        aria-hidden
        component="span"
        sx={{
          flexShrink: 0,
          fontFamily: "ui-monospace, SFMono-Regular, monospace",
          fontSize: 10,
          fontWeight: 600,
          color: "shell.meta",
        }}
      >
        {isApple ? "⌘K" : "Ctrl K"}
      </Typography>
    </Box>
  );
}
