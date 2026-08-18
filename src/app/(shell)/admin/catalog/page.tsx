import { redirect } from "next/navigation";

import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import CatalogAdmin from "@/components/admin/CatalogAdmin";
import TopBar from "@/components/shell/TopBar";
import { describeError } from "@/lib/adminAccess";
import { APP_NAME } from "@/lib/brand";
import { explainReadError } from "@/lib/postgrestMessage";
import { isSuperAdmin } from "@/lib/isSuperAdmin";
import { createClient } from "@/lib/supabase/server";
import type { AdminCategory, AdminEntry } from "@/types/admin";
import { ENTRY_COLUMNS } from "@/types/catalog";

export const dynamic = "force-dynamic";

export const metadata = {
  title: `Catalog · Admin · ${APP_NAME}`,
};

/**
 * Admin · Catalog — where the catalog actually gets filled in.
 *
 * Until this screen existed the app had no way to create a category or an entry
 * at all: `/admin/access` could grant access to entries that could not be
 * created, and a freshly stamped app was permanently empty. That is what this
 * page is for.
 *
 * **The gate is the database, not this file.** Every write this screen issues is
 * governed by policies that already existed in `0001_baseline.sql` —
 * `basecamp_categories_insert_super_admin`, `..._update_super_admin`,
 * `..._delete_super_admin`, and the three matching policies on `entries`. All
 * six are `to authenticated ... using (is_super_admin())`. Nothing here adds a
 * privilege; this is a form over policies that shipped a long time ago.
 *
 * THE ROLE READ BELOW IS PRESENTATION, AND THE DISTINCTION IS LOAD-BEARING.
 * `is_super_admin()` decides whether to render the tool or the locked panel. It
 * is NOT the access control, and it must never be mistaken for it: a
 * non-super_admin who edits their own browser state into rendering this screen
 * gets a form whose every write the database refuses. The reason this page needs
 * the RPC at all — where `/admin/access` could infer the answer from an empty
 * `list_people()` — is that a non-admin's catalog read is NOT empty. They can
 * legitimately read whatever they have been granted, so "no rows" here means
 * "nothing granted", never "not an administrator". Inferring the role from the
 * data would show the locked panel to an administrator with an empty catalog,
 * which is precisely the confusion this run was asked to remove from the home
 * page.
 *
 * The read-failure discipline is copied from `/admin/access` deliberately: a
 * failed read and an empty result must never look alike. An admin who cannot
 * read `entries` because of a stale schema cache would otherwise be shown an
 * empty catalog and invited to create a second copy of everything.
 */

type Counted = { data: unknown[] | null; error: unknown; count: number | null };

/**
 * Truncation is detected by COUNT, not by row length.
 *
 * PostgREST caps every response at its `max-rows` setting (1000 on a default
 * Supabase project) and says nothing when it does — a short array looks exactly
 * like a complete one. On this screen a silently short read is worse than on the
 * home page: the reorder arithmetic and the slug-deduplication both reason over
 * "every row that exists", so a truncated list would renumber a subset and
 * propose a slug that is already taken by a row it never saw.
 */
function truncation(label: string, res: Counted): string | null {
  const returned = res.data?.length ?? 0;
  // A missing count FAILS CLOSED, same as the access screen: a guard that
  // returns "not truncated" when it cannot tell is inert by construction.
  if (res.count === null) {
    console.error(`[basecamp] catalog admin ${label} returned no row count`);
    return `${label} (no row count returned — truncation cannot be ruled out)`;
  }
  if (res.count <= returned) return null;
  console.error(`[basecamp] catalog admin ${label} truncated: ${returned} of ${res.count} rows`);
  return `${label} (${returned} of ${res.count} rows returned — the read was truncated)`;
}

export default async function CatalogAdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // One round trip. None of the three reads depends on another, and the sibling
  // screens already record what serial awaits cost on this shell.
  const [role, catRes, entryRes] = await Promise.all([
    isSuperAdmin(),
    supabase
      .from("categories")
      .select("id, slug, name, description, sort_order", { count: "exact" })
      // (sort_order, slug) — sort_order is not unique and defaults to 0, so it
      // is not a total order on its own. The same pair the home page orders by,
      // and the same pair `inRenderOrder` reproduces on the client.
      .order("sort_order", { ascending: true })
      .order("slug", { ascending: true }),
    supabase
      .from("entries")
      // `nav_group` is not in ENTRY_COLUMNS — the home page does not render it
      // — but this screen is the only place it can be set. See AdminEntry.
      .select(`${ENTRY_COLUMNS}, category_id, nav_group, updated_at`, { count: "exact" })
      .order("sort_order", { ascending: true })
      .order("slug", { ascending: true }),
  ]);

  const failures: string[] = [];
  // A Set: three reads failing for one reason produce one sentence.
  const explanations = new Set<string>();
  for (const [label, res] of [
    ["categories", catRes],
    ["entries", entryRes],
  ] as const) {
    if (res.error) {
      console.error(`[basecamp] catalog admin ${label} failed:`, res.error.code, res.error.message);
      // The bare code goes in the per-read list; the plain-language remedy is
      // collected separately and printed ONCE below. Interpolating it here put
      // the same ~250-character paragraph in the list three times, in a
      // monospace face, on the very first load of an unexposed schema — which
      // is precisely when a client is least able to read past it.
      failures.push(`${label} (${describeError(res.error)})`);
      const explained = explainReadError(res.error);
      if (explained) explanations.add(explained);
      continue;
    }
    const short = truncation(label, res as Counted);
    if (short) failures.push(short);
  }

  // The role read is checked separately: it decides which of two screens to
  // render, so an unreadable answer must not be silently treated as `false`.
  // Failing closed *silently* here would hide the Catalog tool from an
  // administrator with no explanation at all.
  if (role.error) {
    failures.push(`is_super_admin (${describeError(role.error)})`);
    const explained = explainReadError(role.error);
    if (explained) explanations.add(explained);
  }

  if (failures.length > 0) {
    return (
      <>
        <TopBar parent="Admin" current="Catalog" />
        <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
          <Alert severity="error" icon={<ErrorOutlineRoundedIcon />} sx={{ maxWidth: 720 }}>
            <AlertTitle>Catalog administration could not be loaded</AlertTitle>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Nothing is shown rather than showing a catalog that might be incomplete.
            </Typography>
            {[...explanations].map((sentence) => (
              <Typography key={sentence} variant="body2" sx={{ mb: 1, lineHeight: 1.7 }}>
                {sentence}
              </Typography>
            ))}
            <Typography variant="body2" sx={{ fontFamily: "ui-monospace, monospace" }}>
              Failed: {failures.join(", ")}
            </Typography>
          </Alert>
        </Box>
      </>
    );
  }

  if (!role.value) {
    return (
      <>
        <TopBar parent="Admin" current="Catalog" />
        <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
          <Paper
            elevation={0}
            sx={{
              maxWidth: 520,
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
              <LockOutlinedIcon sx={{ fontSize: 28 }} />
            </Box>
            <Typography variant="h6" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
              Catalog administration is not available to this account
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
              Adding and editing catalog entries is restricted at the database
              level. If you believe you should have it, contact the person who
              asked you to sign in.
            </Typography>
          </Paper>
        </Box>
      </>
    );
  }

  return (
    <CatalogAdmin
      initialCategories={(catRes.data ?? []) as AdminCategory[]}
      initialEntries={(entryRes.data ?? []) as AdminEntry[]}
      // The signed-in administrator's email, used as the `owner` default on the
      // simple add path. An account with no email would otherwise produce a
      // blank `owner`, which the not-blank CHECK refuses — `validateEntry`
      // catches that and says so rather than letting it reach Postgres.
      currentUserEmail={user.email ?? ""}
    />
  );
}
