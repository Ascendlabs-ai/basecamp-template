import { redirect } from "next/navigation";

import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import AccessAdmin from "@/components/admin/AccessAdmin";
import TopBar from "@/components/shell/TopBar";
import { describeError } from "@/lib/adminAccess";
import { getBranding } from "@/lib/brandingServer";
import { createClient } from "@/lib/supabase/server";
import type {
  AuditRow,
  Grant,
  GrantCategory,
  Member,
  MemberType,
  Person,
  TypeGrant,
} from "@/types/admin";

export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const branding = await getBranding();
  return { title: `Access · Admin · ${branding.displayName}` };
}

/**
 * Admin · Access.
 *
 * **The gate is the database, not this file.** There is no `if (role ===
 * 'super_admin')` anywhere here. Every read below is independently
 * super_admin-only in Postgres:
 *
 *   - `list_people()` returns zero rows unless `basecamp.is_super_admin()`
 *   - `access_grants` and `type_grants` SELECT are policy-gated to super_admin
 *   - `members` SELECT is super_admin or your own row
 *   - every write the client issues is policy-gated the same way
 *
 * So a non-super_admin who types this URL gets an empty roster and a write path
 * the database refuses. The locked panel below is what that empty result *looks
 * like* — a consequence of the policy answer, not a second gate reimplemented
 * in TypeScript. If someone later loosens a policy, this screen starts working,
 * which is the honest outcome; it cannot be "fixed" by editing app code.
 *
 * `member_types` is read under the same rule: a
 * non-super_admin sees only the one type they hold, so the app can label their
 * own identity block and nothing more. It was briefly `using (true)`, which
 * handed the type list to every customer of every other app on the project.
 */

/**
 * Truncation is detected by COUNT, not by row-length.
 *
 * PostgREST caps every response at its `max-rows` setting and says nothing when
 * it does — you get a short array that looks exactly like a complete one. On
 * THIS screen a silently short `access_grants` read renders granted switches as
 * off and undercounts every roster number: a wrong permissions picture
 * presented as fact, which is the same failure the error panel below refuses
 * to show.
 *
 * The first attempt at this compared `data.length` against the app's own
 * `.limit()`. That cannot work, and measuring it proved it: this project's
 * `max_rows` is **1000**, while the ceilings were set to 2000–20000 "well above
 * any plausible real count". PostgREST caps at 1000 first, `1000 >= 20000` is
 * false, and the guard stays silent through exactly the scenario it was written
 * for. A ceiling above the platform cap is inert by construction.
 *
 * `{ count: "exact" }` asks the database how many rows MATCH, independent of
 * how many were returned. `count !== data.length` catches the app limit, the
 * server cap, and any future proxy, in one comparison that cannot go stale.
 */
type Counted = { data: unknown[] | null; error: unknown; count: number | null };

function truncation(label: string, res: Counted): string | null {
  const returned = res.data?.length ?? 0;
  // A missing count FAILS CLOSED. Returning "not truncated" here would be the
  // same inert-by-construction guard the comment above condemns — strip the
  // header at a proxy, or hit a PostgREST that declines the count, and the
  // screen renders a possibly-short permissions picture as fact. This screen
  // already refuses to render on any read problem, so failing closed is free.
  if (res.count === null) {
    console.error(`[basecamp] admin ${label} returned no row count`);
    return `${label} (no row count returned — truncation cannot be ruled out)`;
  }
  if (res.count <= returned) return null;
  console.error(`[basecamp] admin ${label} truncated: ${returned} of ${res.count} rows`);
  return `${label} (${returned} of ${res.count} rows returned — the read was truncated)`;
}

export default async function AccessAdminPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [peopleRes, catRes, grantRes, typeRes, memberRes, typeGrantRes, auditRes, entryCountRes] =
    await Promise.all([
    supabase.rpc("list_people", {}, { count: "exact" }),
    supabase
      .from("categories")
      // `parent_id` so the grant screens can say which parent a subcategory
      // belongs to. Only `slug` is unique — `uniqueSlug` dedupes slugs, not
      // names — so two subcategories called "Reports" under different parents
      // would otherwise be indistinguishable on the one screen that decides who
      // sees what.
      .select("id, slug, name, parent_id, entries(id, display_name, entry_type, sort_order)", {
        count: "exact",
      })
      .order("sort_order", { ascending: true })
      .order("slug", { ascending: true })
      .order("sort_order", { ascending: true, referencedTable: "entries" })
      .order("slug", { ascending: true, referencedTable: "entries" }),
    supabase.from("access_grants").select("id, user_id, entry_id, category_id", { count: "exact" }),
    supabase
      .from("member_types")
      .select("id, slug, name, description, is_admin, is_system, sort_order", { count: "exact" })
      .order("sort_order", { ascending: true }),
    supabase.from("members").select("id, user_id, member_type_id, department", { count: "exact" }),
    supabase
      .from("type_grants")
      .select("id, member_type_id, entry_id, category_id", { count: "exact" }),
    // The audit log. Bounded deliberately: this table only grows, and the screen
    // shows recent history rather than the whole of it. The bound is a real
    // limit, not a truncation guard, so it is NOT compared against `count` —
    // doing so would report every install with more than 200 changes as broken.
    supabase
      .from("access_audit")
      .select("id, occurred_at, actor_email, action, source_table, subject_label, object_kind, object_label")
      // `id desc` is not decoration. A member type change emits TWO rows in one
      // transaction, and `occurred_at` defaults to now() — the TRANSACTION
      // timestamp — so the revoke and the grant carry an identical value.
      // Ordering on occurred_at alone leaves the pair in plan-dependent order,
      // and it was observed rendering the revoke ABOVE the grant in a
      // newest-first log. The identity column is the only monotonic tiebreak.
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(200),
    // Seventh element, not a serial follow-up: it has no data dependency on the
    // batch, and the sibling layout carries a comment about exactly this serial
    // latency being what made the loading skeleton visible.
    supabase.from("entries").select("id", { count: "exact", head: true }),
  ]);

  const failures: string[] = [];
  for (const [label, res] of [
    ["list_people", peopleRes],
    ["categories", catRes],
    ["access_grants", grantRes],
    ["member_types", typeRes],
    ["members", memberRes],
    ["type_grants", typeGrantRes],
  ] as const) {
    if (res.error) {
      console.error(`[basecamp] admin ${label} failed:`, res.error.code, res.error.message);
      failures.push(`${label} (${describeError(res.error)})`);
      continue;
    }
    const short = truncation(label, res as Counted);
    if (short) failures.push(short);
  }

  // The audit read is checked for FAILURE but not for truncation: it carries an
  // intentional .limit(), so a short result is the design rather than a fault.
  // A failed read still refuses to render, for the same reason the others do —
  // an empty audit log and an unreadable one look identical on screen, and one
  // of them is a lie about what happened.
  // NOT pushed into `failures`, deliberately, and this is the one read on the
  // page that is treated differently. The refusal-to-render rule exists because
  // a failed GRANTS read renders every switch off — a fabricated permissions
  // picture presented as fact. An unreadable audit log misleads nobody: it is
  // history, no access decision consults it, and the tab can say so itself.
  // Making it fatal would mean a stale schema cache or a missing GRANT takes
  // down the only surface that can fix either.
  const auditError = auditRes.error
    ? (console.error("[basecamp] admin access_audit failed:", auditRes.error.code, auditRes.error.message),
       describeError(auditRes.error))
    : null;

  // The nested `entries` read has no count of its own — PostgREST reports one
  // count for the top-level relation. Compare each category's embedded rows
  // against an independent count of the same rows instead, so a capped
  // embedding is caught rather than assumed away.
  const nestedTotal = (catRes.data ?? []).reduce((n, c) => n + (c.entries?.length ?? 0), 0);
  if (entryCountRes.error) {
    failures.push(`entries count (${describeError(entryCountRes.error)})`);
  } else if (entryCountRes.count === null) {
    failures.push("entries count (no row count returned — truncation cannot be ruled out)");
  } else if (entryCountRes.count > nestedTotal) {
    console.error(
      `[basecamp] admin nested entries truncated: ${nestedTotal} of ${entryCountRes.count}`,
    );
    failures.push(
      `entries (${nestedTotal} of ${entryCountRes.count} rows embedded — the read was truncated)`,
    );
  }

  // A FAILED read is not an empty result, and this screen must never conflate
  // them. A failed grants read once rendered every switch off and every count
  // zero — a fabricated permissions picture presented as fact, on the screen
  // whose whole job is reporting access truthfully. Any read failure refuses to
  // render the tool at all.
  if (failures.length > 0) {
    return (
      <>
        <TopBar parent="Admin" current="Access" />
        <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
          <Alert severity="error" icon={<ErrorOutlineRoundedIcon />} sx={{ maxWidth: 720 }}>
            <AlertTitle>Access administration could not be loaded</AlertTitle>
            <Typography variant="body2" sx={{ mb: 1 }}>
              Nothing is shown rather than showing a picture that might be wrong.
            </Typography>
            <Typography variant="body2" sx={{ fontFamily: "ui-monospace, monospace" }}>
              Failed: {failures.join(", ")}
            </Typography>
          </Alert>
        </Box>
      </>
    );
  }

  const people = ((peopleRes.data ?? []) as Person[])
    .slice()
    .sort((a, b) => a.email.localeCompare(b.email));

  // An empty roster IS the authorization answer — reachable only when the RPC
  // succeeded and returned nothing, which is exactly "you are not super_admin".
  if (people.length === 0) {
    return (
      <>
        <TopBar parent="Admin" current="Access" />
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
              Access administration is not available to this account
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
              Granting and revoking catalog access is restricted at the database
              level. If you believe you should have it, contact the person who
              asked you to sign in.
            </Typography>
          </Paper>
        </Box>
      </>
    );
  }

  const rawCats = (catRes.data ?? []) as Array<{
    id: string;
    slug: string;
    name: string;
    parent_id: string | null;
    entries: Array<{ id: string; display_name: string; entry_type: string }> | null;
  }>;

  // Two shapes from one read, because the two views need different sets and a
  // second round-trip for the same rows would be waste.
  //
  //   categories  — everything grantable. The by-person view has to be able to
  //                 grant a reference or catalog-only entry, which is most of
  //                 the catalog.
  //   launchable  — the matrix's columns. The design's matrix is apps, and 41
  //                 columns of mostly-unlaunchable rows is the grid nobody
  //                 could operate that this rebuild exists to replace.
  /**
   * Every category by id, BEFORE the entries filter below.
   *
   * The grant screens label a subcategory with its parent, and a container
   * parent has no entries of its own — so building this from the filtered list
   * left exactly the arrangement nesting exists for without a breadcrumb, on
   * the one screen where two same-named "Reports" grant different people
   * different things.
   */
  const categoryNames = new Map(rawCats.map((c) => [c.id, { name: c.name }]));

  const categories = rawCats
    .map<GrantCategory>((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parent_id: c.parent_id,
      entries: (c.entries ?? []).map((e) => ({ id: e.id, display_name: e.display_name })),
    }))
    .filter((c) => c.entries.length > 0);

  const launchableCategories = rawCats
    .map<GrantCategory>((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      parent_id: c.parent_id,
      entries: (c.entries ?? [])
        .filter((e) => e.entry_type === "launchable")
        .map((e) => ({ id: e.id, display_name: e.display_name })),
    }))
    .filter((c) => c.entries.length > 0);

  return (
    <AccessAdmin
      people={people}
      categories={categories}
      categoryNames={categoryNames}
      launchableCategories={launchableCategories}
      initialGrants={(grantRes.data ?? []) as Grant[]}
      memberTypes={(typeRes.data ?? []) as MemberType[]}
      initialMembers={(memberRes.data ?? []) as Member[]}
      initialTypeGrants={(typeGrantRes.data ?? []) as TypeGrant[]}
      initialAudit={(auditRes.data ?? []) as AuditRow[]}
      auditError={auditError}
      currentUserId={user.id}
    />
  );
}
