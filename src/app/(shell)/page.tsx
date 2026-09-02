import { redirect } from "next/navigation";

import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import SearchOffRoundedIcon from "@mui/icons-material/SearchOffRounded";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import CatalogView from "@/components/catalog/CatalogView";
import TopBar from "@/components/shell/TopBar";
import { filterCatalog, visibleCategories } from "@/lib/catalog";
import { explainReadError } from "@/lib/postgrestMessage";
import { isSuperAdmin } from "@/lib/isSuperAdmin";
import { createClient } from "@/lib/supabase/server";
import { ENTRY_COLUMNS, type CatalogCategory } from "@/types/catalog";
import { getBranding } from "@/lib/brandingServer";
import type { Metadata } from "next";

// The catalog is per-user by RLS, so it must never be cached across requests.
export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return { title: branding.displayName };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already redirects unauthenticated requests. This is the
  // defense-in-depth copy: if the matcher is ever narrowed, this page must
  // still refuse to render rather than query as anon.
  if (!user) redirect("/login");

  // ONE query. Categories with their entries nested, both ordered by
  // sort_order. There is deliberately no role check anywhere in this file:
  // visibility is decided entirely by the RLS policies
  // (basecamp.has_grant / category_has_grant) against access_grants AND type_grants.
  // A user with no grant gets zero rows from the database, not a filtered list.
  // Both reads in ONE round trip. The entry head-count has no data dependency
  // on the catalog select, and this is the app's hottest page — the admin
  // screen already learned this lesson, and a fix written in the same commit
  // reintroduced the serial await here.
  const [{ data, error, count }, entryCountRes, role, branding] = await Promise.all([
    supabase
      .from("categories")
      .select(`id, slug, name, description, sort_order, parent_id, entries(${ENTRY_COLUMNS})`, {
        count: "exact",
      })
      // (sort_order, slug), not sort_order alone. sort_order is NOT unique and
      // defaults to 0, so ties order non-deterministically between renders —
      // sort_order is not a total order on its own. The tiebreaker also means
      // two app-created entries landing on 0 still render in a stable order.
      .order("sort_order", { ascending: true })
      .order("slug", { ascending: true })
      .order("sort_order", { ascending: true, referencedTable: "entries" })
      .order("slug", { ascending: true, referencedTable: "entries" }),
    supabase.from("entries").select("id", { count: "exact", head: true }),
    // For the EMPTY STATE only — never for what is shown. A super_admin's
    // catalog is already unfiltered by the SELECT policies, so this cannot
    // change which rows appear; it changes which of two sentences is printed
    // when there are none. Deduplicated against the layout's identical question,
    // so it costs no extra round trip.
    isSuperAdmin(),
    getBranding(),
  ]);

  // Truncation is silent in the response and detectable only by count.
  // Comparing against an app-side ceiling does not work: PostgREST caps at its
  // own `max-rows` (1000 here) first, so any ceiling above that never fires.
  //
  // BOTH relations, not just the outer one. `count` covers `categories`; the
  // rows this page actually renders are the nested `entries` embed, which has
  // no count of its own and had no check of any kind — a capped embed would
  // silently under-show a user's catalog. RLS makes a category visible only if
  // it holds a visible entry, so an independent head-count of readable entries
  // is over the same set as the embed and the two must agree.
  //
  // Logged, not fatal: unlike the admin screen, a short catalog is degraded
  // rather than an actively wrong access picture, and the page must still render.
  if (!error) {
    if (count !== null && count > (data?.length ?? 0)) {
      console.error(`[basecamp] catalog truncated: ${data?.length ?? 0} of ${count} categories`);
    }
    const embedded = (data ?? []).reduce((n, c) => n + (c.entries?.length ?? 0), 0);
    if (entryCountRes.error) {
      console.error(
        "[basecamp] catalog entry count failed:",
        entryCountRes.error.code,
        entryCountRes.error.message,
      );
    } else if (entryCountRes.count !== null && entryCountRes.count > embedded) {
      console.error(`[basecamp] catalog entries truncated: ${embedded} of ${entryCountRes.count}`);
    }
  }

  if (error) {
    // Full detail server-side only. This is the half of the fix that matters:
    // suppressing the message on the page is useless if it is nowhere at all.
    console.error("[basecamp] catalog query failed:", error.code, error.message, error.details);
    const explained = explainReadError(error);
    return (
      <>
        <TopBar current="Home" />
        <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 } }}>
          <Alert severity="error" icon={<ErrorOutlineRoundedIcon />}>
            <AlertTitle>The catalog could not be loaded</AlertTitle>
            {/* The full message goes to the server log, not the page. If this
                project is shared with client-facing apps, ANY of their
                customers holds credentials that reach this branch — they must
                not be handed schema internals. The bare code is kept because
                it is what lets an operator tell 42501 (grants) from PGRST106
                (not exposed) from PGRST301 (bad JWT) without a log dive. */}
            {/* One code — PGRST106 — is spelled out, because it is the one a
                brand-new install hits on its very first load and the one a bare
                code helps least with: the schema is simply not being served to
                the Data API yet. It is safe to name because it is not
                user-specific; when it fires, nobody can read anything, so the
                message discloses nothing about this viewer. Everything else
                keeps the bare code deliberately — see lib/postgrestMessage.ts. */}
            {explained ? (
              <Typography variant="body2" sx={{ lineHeight: 1.7 }}>
                {explained}
              </Typography>
            ) : (
              <Typography variant="body2" sx={{ fontFamily: "ui-monospace, monospace" }}>
                {error.code ? `Error ${error.code}` : "Unknown error"}
              </Typography>
            )}
          </Alert>
        </Box>
      </>
    );
  }

  const categories = (data ?? []) as CatalogCategory[];

  // Fails CLOSED: an unreadable role answer falls back to the no-grants message,
  // which discloses nothing. `isSuperAdmin` logs it, so it is not silent.
  const viewerIsSuperAdmin = role.value;

  // Shaping lives in lib/ so it can be tested against the real payload — see
  // src/lib/catalog.test.ts. A category with no visible entries must not render
  // a bare heading, or a grant on an empty category discloses its name.
  const { visible, categoryCount, entryCount } = visibleCategories(categories);
  const searched = filterCatalog(visible, q);
  const searchActive = Boolean(q?.trim());
  const shownEntries = searched.reduce((n, c) => n + c.entries.length, 0);

  return (
    <>
      <TopBar current="Home">
        {searchActive ? (
          <Typography sx={{ fontSize: 12, color: "text.secondary" }}>
            {shownEntries} {shownEntries === 1 ? "match" : "matches"} for “{q?.trim()}”
          </Typography>
        ) : null}
      </TopBar>

      <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
        {visible.length === 0 && viewerIsSuperAdmin ? (
          /*
            SUCCESS MUST NOT RENDER AS FAILURE.

            A brand-new administrator, having provisioned the database correctly
            and signed in for the first time, used to be told "You do not have
            access to anything here" — at the finish line of the guided setup,
            on an app that was working perfectly. Nothing was wrong: the catalog
            was simply empty, because until recently there was no screen that
            could fill it.

            The two states are genuinely different and only the viewer's role
            tells them apart. A super_admin reads every row of `categories` and
            `entries` by policy, so an empty result for them means the tables
            ARE empty and the fix is theirs to make — hence a route to it. For
            anyone else an empty result means "nothing has been granted to you",
            which is the message below and stays exactly as it was.
          */
          <Paper
            elevation={0}
            sx={{
              maxWidth: 560,
              mx: "auto",
              mt: { xs: 4, md: 10 },
              p: { xs: 3, sm: 5 },
              textAlign: "center",
              border: 1,
              borderColor: "divider",
            }}
          >
            <Box
              aria-hidden
              sx={{
                display: "inline-flex",
                p: 1.75,
                mb: 2,
                borderRadius: "50%",
                backgroundColor: "celestial.light",
                color: "primary.dark",
              }}
            >
              <Inventory2OutlinedIcon sx={{ fontSize: 30 }} />
            </Box>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
              Your catalog is empty
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7, mb: 3 }}>
              Everything is working — there is just nothing in it yet. Add your
              first app in Admin → Catalog and it appears here straight away.
            </Typography>
            {/*
              A plain `href`, NOT `component={NextLink}`. This file is a Server
              Component and MUI's Button is a Client Component, so passing the
              Link COMPONENT across that boundary is passing a function to the
              client — React refuses it at render time with "Functions cannot be
              passed directly to Client Components". It builds and typechecks
              cleanly and then throws on the running page, which is how it got
              here: only loading the route catches it.

              MUI renders an anchor when it is given an href, so this costs a
              full page load instead of a client-side transition — an acceptable
              price on a once-per-app empty state, and the alternative is
              extracting this panel into a client component for one button.
            */}
            <Button href="/admin/catalog" variant="contained" sx={{ cursor: "pointer" }}>
              Go to Admin → Catalog
            </Button>
          </Paper>
        ) : visible.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              maxWidth: 560,
              mx: "auto",
              mt: { xs: 4, md: 10 },
              p: { xs: 3, sm: 5 },
              textAlign: "center",
              border: 1,
              borderColor: "divider",
            }}
          >
            <Box
              aria-hidden
              sx={{
                display: "inline-flex",
                p: 1.75,
                mb: 2,
                borderRadius: "50%",
                backgroundColor: "celestial.light",
                color: "primary.dark",
              }}
            >
              <KeyOutlinedIcon sx={{ fontSize: 30 }} />
            </Box>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
              You do not have access to anything here
            </Typography>
            {/* Deliberately says almost nothing.
                `authenticated` is a PROJECT-GLOBAL label, so on a project shared
                with other apps any of their customers can sign in here
                with their own credentials and reach this branch. RLS holds and
                no catalog data leaks — but an earlier version of this state
                also described what this app is, explained that access is
                granted per entry or per category rather than by job title, and
                echoed the viewer's email back at them. That disclosed the
                existence, purpose and access model of an internal tool to
                arbitrary tenants.
                Until a schema-owned membership roster exists, the
                app cannot tell "a team member awaiting a grant" from
                "stranger holding a project JWT", so it must say the same minimal
                thing to both. */}
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
              If you believe this is a mistake, contact the person who asked you to
              sign in.
            </Typography>
          </Paper>
        ) : (
          <>
            <Stack sx={{ mb: { xs: 3, md: 4 } }} spacing={1}>
              <Typography
                variant="h4"
                component="h1"
                sx={{ fontWeight: 700, letterSpacing: "-0.5px" }}
              >
                {branding.displayName} apps
              </Typography>
              <Typography variant="body1" sx={{ color: "text.secondary", maxWidth: "70ch" }}>
                {entryCount} {entryCount === 1 ? "entry" : "entries"} across{" "}
                {categoryCount} {categoryCount === 1 ? "category" : "categories"}. Tiles
                launch; rows open a detail panel telling you what a thing is, who owns it,
                and where it runs.
              </Typography>
            </Stack>

            {searchActive && searched.length === 0 ? (
              <Paper
                elevation={0}
                sx={{
                  maxWidth: 520,
                  mx: "auto",
                  mt: { xs: 3, md: 6 },
                  p: { xs: 3, sm: 4 },
                  textAlign: "center",
                  border: 1,
                  borderColor: "divider",
                }}
              >
                <Box
                  aria-hidden
                  sx={{
                    display: "inline-flex",
                    p: 1.5,
                    mb: 1.5,
                    borderRadius: "50%",
                    backgroundColor: "celestial.light",
                    color: "primary.dark",
                  }}
                >
                  <SearchOffRoundedIcon sx={{ fontSize: 26 }} />
                </Box>
                <Typography variant="h6" component="p" sx={{ fontWeight: 700, mb: 0.5 }}>
                  Nothing matches “{q?.trim()}”
                </Typography>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Searches run over name, description, owner and slug across the{" "}
                  {entryCount} {entryCount === 1 ? "entry" : "entries"} you can see.
                </Typography>
              </Paper>
            ) : (
              <CatalogView categories={searched} />
            )}
          </>
        )}
      </Box>
    </>
  );
}
