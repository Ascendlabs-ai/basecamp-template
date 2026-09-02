"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Snackbar from "@mui/material/Snackbar";
import Typography from "@mui/material/Typography";

import TopBar from "@/components/shell/TopBar";
import {
  ADD_PERSON_KEY,
  CREATE_TYPE_KEY,
  adminRoleKey,
  banKey,
  deleteTypeKey,
  describeError,
  describeTrustRootRefusal,
  effectiveEntryCount,
  indexGrants,
  indexMembers,
  indexTypeGrants,
  memberKey,
  pendingKey,
  signInLinkKey,
  typeGrantKey,
} from "@/lib/adminAccess";
import { createClient } from "@/lib/supabase/client";
import { postAdmin } from "@/lib/adminApi";
import type {
  AdminView,
  AuditRow,
  Grant,
  GrantCategory,
  Member,
  MemberType,
  Person,
  ToggleTarget,
  TypeGrant,
} from "@/types/admin";

import AccessMatrix from "./AccessMatrix";
import AddPersonDialog from "./AddPersonDialog";
import AuditLog from "./AuditLog";
import LinkRevealDialog from "./LinkRevealDialog";
import GrantsByPerson from "./GrantsByPerson";
import PersonList from "./PersonList";
import TypesAdmin from "./TypesAdmin";
import ViewSwitch from "./ViewSwitch";
import { failedWrite, useAdminWrite } from "./useAdminWrite";

/**
 * Admin · Access — three views over one access model.
 *
 * ACCESS MODEL. Effective access is the UNION of two independent sources:
 *   type grants   what the person's member_type is granted (the reusable half)
 *   access_grants what that person is granted personally (the exception half)
 * Neither overrides the other and neither can subtract. That is what lets a
 * matrix cell name its source honestly instead of showing a boolean whose
 * provenance you have to go and look up.
 *
 * WRITES. Every mutation goes through the anon key on the signed-in
 * super_admin's session, so the RLS policies decide. There is no service_role
 * path and there must never be one: service_role bypasses RLS, which would let
 * this screen write grants the database itself would refuse.
 *
 * The optimistic-write machinery here (ref-based claim, try/finally,
 * snapshot resync) is load-bearing and was arrived at the hard way — see the
 * comments at each piece before simplifying any of it.
 */
export default function AccessAdmin({
  people,
  categories,
  categoryNames,
  launchableCategories,
  initialGrants,
  memberTypes,
  initialMembers,
  initialTypeGrants,
  initialAudit,
  auditError,
  currentUserId,
}: {
  people: Person[];
  categories: GrantCategory[];
  /**
   * Every category by id, INCLUDING container parents that hold no entries of
   * their own and are therefore absent from `categories`. Used only to label a
   * subcategory with its parent — never to decide access.
   */
  categoryNames: Map<string, { name: string }>;
  launchableCategories: GrantCategory[];
  initialGrants: Grant[];
  memberTypes: MemberType[];
  initialMembers: Member[];
  initialTypeGrants: TypeGrant[];
  initialAudit: AuditRow[];
  auditError: string | null;
  currentUserId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams.get("view");
  const view: AdminView =
    viewParam === "matrix"
      ? "matrix"
      : viewParam === "types"
        ? "types"
        : viewParam === "audit"
          ? "audit"
          : "person";

  // The add dialog, and the one link it (or a re-issue) produces. `link` holds
  // a credential, so it lives in state for as long as the dialog is open and
  // nowhere else — never in a notice, an error, a log line or an audit row.
  const [addOpen, setAddOpen] = useState(false);
  const [link, setLink] = useState<{ link: string; email: string; created: boolean } | null>(null);

  const [grants, setGrants] = useState<Grant[]>(initialGrants);
  const [members, setMembers] = useState<Member[]>(initialMembers);
  const [typeGrants, setTypeGrants] = useState<TypeGrant[]>(initialTypeGrants);
  const [selectedId, setSelectedId] = useState<string>(people[0]?.id ?? "");

  // The claim/timeout/resync machinery, shared with Admin -> Catalog. It used to
  // be defined in this file; the comments explaining why each piece is shaped
  // the way it is moved with it. See ./useAdminWrite.
  const { run, pending, error, notice, setError, setNotice, resync } = useAdminWrite();

  /**
   * Re-sync when the server sends a new snapshot. `useState` ignores later prop
   * changes, so without this `router.refresh()` re-ran the server component and
   * the UI kept showing the stale rows. React's documented adjust-state-on-prop-
   * change pattern: a render-phase update guarded by identity, not an effect
   * (this repo's hooks config rejects set-state-in-effect, and an effect would
   * paint the stale list for a frame first).
   */
  // Server-owned, like `grants`: the rows are written by database triggers, so
  // there is no optimistic local version to keep.
  //
  // It does NOT follow that the list stays current on its own. The grant paths
  // deliberately do not refresh the route on success, so this state is re-read
  // explicitly when the Audit tab is entered — see `setView`.
  const [audit, setAudit] = useState<AuditRow[]>(initialAudit);

  const [snapshot, setSnapshot] = useState(initialGrants);
  if (snapshot !== initialGrants) {
    setSnapshot(initialGrants);
    setGrants(initialGrants);
    setMembers(initialMembers);
    setTypeGrants(initialTypeGrants);
    setAudit(initialAudit);
    // `pending` is deliberately NOT touched here. An earlier version blanked
    // it, which made the render mirror disagree with `inFlight`: the cell
    // stopped spinning, the user clicked, and `run` returned at the
    // duplicate-claim guard — no spinner, no error, no write. The fix is simply
    // to leave it alone. `run` is the only writer and it always sets `pending`
    // to the contents of `inFlight`, so the two cannot drift; a second mirror
    // state was tried here and was provably a no-op.
  }

  const grantIndex = useMemo(() => indexGrants(grants), [grants]);
  const typeGrantIndex = useMemo(() => indexTypeGrants(typeGrants), [typeGrants]);
  const memberIndex = useMemo(() => indexMembers(members), [members]);
  const typeById = useMemo(() => new Map(memberTypes.map((t) => [t.id, t])), [memberTypes]);

  // Entries each person can actually see, counting both sources once. Derived,
  // never stored — and computed with the same function the by-person header
  // uses, so the two numbers on screen cannot disagree.
  const countsByPerson = useMemo(() => {
    const counts = new Map<string, number>();
    for (const person of people) {
      counts.set(
        person.id,
        effectiveEntryCount(grantIndex, typeGrantIndex, memberIndex, person.id, categories),
      );
    }
    return counts;
  }, [people, categories, grantIndex, typeGrantIndex, memberIndex]);

  const setView = useCallback(
    (next: AdminView) => {
      const params = new URLSearchParams(searchParams.toString());
      if (next === "person") params.delete("view");
      else params.set("view", next);
      // Same route, view state in the URL, so a view is linkable — the design
      // asks for exactly this.
      router.replace(`/admin/access${params.toString() ? `?${params}` : ""}`, { scroll: false });

      // Re-read the audit log on entry to the Audit tab.
      //
      // This is NOT belt-and-braces. `audit` arrives from the server component
      // and the grant paths deliberately do NOT call router.refresh() on
      // success (see the "NO blanket refresh here" note in `run`) — so without
      // this, you grant someone access, switch to Audit, and the change you
      // just made is absent. The log is written by database triggers, so the
      // row certainly exists; only this screen was showing a stale copy, which
      // is the worst possible failure for an audit surface: it reads as
      // "nothing was recorded".
      //
      // Fetching here rather than refreshing the route keeps the existing
      // decision intact and costs one query on a tab the user just asked for.
      if (next !== "audit") return;
      // Same per-callback pattern as the mutation handlers below;
      // `createBrowserClient` memoizes, so this is not a new client.
      const supabase = createClient();
      void supabase
        .from("access_audit")
        .select(
          "id, occurred_at, actor_email, action, source_table, subject_label, object_kind, object_label",
        )
        // Same ordering as the server component, and `id` is not decoration: a
        // member type change emits two rows in one transaction and occurred_at
        // defaults to the TRANSACTION timestamp, so the pair ties.
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200)
        .then(({ data, error: auditFetchError }) => {
          // A failed refresh leaves the rows already on screen rather than
          // blanking them. Stale-but-labeled beats empty-and-wrong here, and
          // the server-rendered error slot already covers a load-time failure.
          if (auditFetchError) {
            console.error("[basecamp] audit refresh failed:", auditFetchError.message);
            return;
          }
          if (data) setAudit(data as AuditRow[]);
        });
    },
    [router, searchParams],
  );

  /** Grant or revoke an INDIVIDUAL entry/category for one person. */
  const toggleGrant = useCallback(
    (userId: string, target: ToggleTarget) =>
      run(pendingKey(userId, target), async () => {
        const supabase = createClient();
        const existing = grants.find(
          (g) =>
            g.user_id === userId &&
            ("entryId" in target ? g.entry_id === target.entryId : g.category_id === target.categoryId),
        );

        if (existing) {
          // An optimistic row has no database id yet. Deleting by it would send
          // "optimistic:e:…" to a uuid column (22P02). Unreachable while the
          // claim is held, but this is the guard that makes that invariant
          // belt-and-braces rather than the only thing in the way.
          if (existing.id.startsWith("optimistic:")) return "That change is still saving.";
          setGrants((gs) => gs.filter((g) => g.id !== existing.id));
          // `.select()` is load-bearing: a DELETE that RLS refuses does not
          // error — the policy FILTERS the row out — so PostgREST returns 204
          // and supabase-js yields { error: null }. Without asking for the
          // deleted rows back, a refused revoke rendered as a successful one.
          const { data, error: delError } = await supabase
            .from("access_grants").delete().eq("id", existing.id).select("id");
          if (delError) {
            setGrants((gs) => [...gs, existing]);
            // Routed through failedWrite for the same reason the inserts are: a
            // dropped connection may have DELETED the row before it died, and
            // restoring it locally would leave the matrix asserting access that
            // no longer exists — the direction this file calls the more serious
            // one. Only a real SQLSTATE is evidence the database refused.
            return failedWrite("Could not revoke access", delError, resync);
          }
          if (!data || data.length === 0) {
            // Zero rows has two causes the client cannot tell apart: RLS
            // refused (row still exists) or someone else deleted it (it does
            // not). Restore first so a refused revoke never reads as success,
            // then ask the server which it was.
            setGrants((gs) => [...gs, existing]);
            router.refresh();
            return "That change did not apply. Reloading the current access state.";
          }
          // RE-ASSERT the removal. The optimistic filter above is not enough:
          // a resync landing between it and this response restores the row from
          // the pre-delete server snapshot, and nothing would ever remove it
          // again — leaving the matrix reporting access the database has
          // already revoked. Symmetric with the append-if-missing on insert,
          // and the more important half: a stale "granted" is a lie about
          // access, a stale "not granted" is only a lost write.
          setGrants((gs) => gs.filter((g) => g.id !== existing.id));
          return null;
        }

        const tempId = `optimistic:${pendingKey(userId, target)}`;
        const optimistic: Grant = {
          id: tempId,
          user_id: userId,
          entry_id: "entryId" in target ? target.entryId : null,
          category_id: "categoryId" in target ? target.categoryId : null,
        };
        setGrants((gs) => [...gs, optimistic]);
        const { data, error: insError } = await supabase
          .from("access_grants")
          .insert({
            user_id: userId,
            entry_id: optimistic.entry_id,
            category_id: optimistic.category_id,
            granted_by: currentUserId,
          })
          .select("id, user_id, entry_id, category_id")
          .single();
        if (insError || !data) {
          setGrants((gs) => gs.filter((g) => g.id !== tempId));
          return failedWrite("Could not grant access", insError, resync);
        }
        // Append-if-missing, not a bare map. A resync landing between the
        // insert and its response discards the optimistic row by identity, and
        // a pure map would then find no tempId and silently drop a grant that
        // the database actually created.
        setGrants((gs) =>
          gs.some((g) => g.id === tempId)
            ? gs.map((g) => (g.id === tempId ? (data as Grant) : g))
            : [...gs, data as Grant],
        );
        return null;
      }),
    [grants, currentUserId, resync, router, run],
  );

  /** Grant or revoke an entry/category for a whole TYPE. */
  const toggleTypeGrant = useCallback(
    (typeId: string, target: ToggleTarget) =>
      run(typeGrantKey(typeId, target), async () => {
        const supabase = createClient();
        const existing = typeGrants.find(
          (g) =>
            g.member_type_id === typeId &&
            ("entryId" in target ? g.entry_id === target.entryId : g.category_id === target.categoryId),
        );

        if (existing) {
          if (existing.id.startsWith("optimistic:")) return "That change is still saving.";
          setTypeGrants((gs) => gs.filter((g) => g.id !== existing.id));
          const { data, error: delError } = await supabase
            .from("type_grants").delete().eq("id", existing.id).select("id");
          if (delError || !data || data.length === 0) {
            setTypeGrants((gs) => [...gs, existing]);
            if (delError) return failedWrite("Could not remove the type grant", delError, resync);
            router.refresh();
            return "That change did not apply. Reloading the current access state.";
          }
          setTypeGrants((gs) => gs.filter((g) => g.id !== existing.id));  // see toggleGrant
          return null;
        }

        const tempId = `optimistic:type:${typeId}:${"entryId" in target ? target.entryId : target.categoryId}`;
        const optimistic: TypeGrant = {
          id: tempId,
          member_type_id: typeId,
          entry_id: "entryId" in target ? target.entryId : null,
          category_id: "categoryId" in target ? target.categoryId : null,
        };
        setTypeGrants((gs) => [...gs, optimistic]);
        const { data, error: insError } = await supabase
          .from("type_grants")
          .insert({
            member_type_id: typeId,
            entry_id: optimistic.entry_id,
            category_id: optimistic.category_id,
          })
          .select("id, member_type_id, entry_id, category_id")
          .single();
        if (insError || !data) {
          setTypeGrants((gs) => gs.filter((g) => g.id !== tempId));
          return failedWrite("Could not add the type grant", insError, resync);
        }
        setTypeGrants((gs) =>
          gs.some((g) => g.id === tempId)
            ? gs.map((g) => (g.id === tempId ? (data as TypeGrant) : g))
            : [...gs, data as TypeGrant],
        );
        return null;
      }),
    [typeGrants, resync, router, run],
  );

  /** Set or clear a person's type and department. `typeId === null` removes it. */
  const assignMember = useCallback(
    (userId: string, typeId: string | null, department: string | null) =>
      run(memberKey(userId), async () => {
        const supabase = createClient();
        const existing = members.find((m) => m.user_id === userId);

        if (typeId === null) {
          if (!existing) return null;
          setMembers((ms) => ms.filter((m) => m.id !== existing.id));
          const { data, error: delError } = await supabase
            .from("members").delete().eq("id", existing.id).select("id");
          if (delError || !data || data.length === 0) {
            setMembers((ms) => [...ms, existing]);
            if (delError) return failedWrite("Could not remove the type", delError, resync);
            router.refresh();
            return "That change did not apply. Reloading the current state.";
          }
          setMembers((ms) => ms.filter((m) => m.id !== existing.id));  // see toggleGrant
          return null;
        }

        if (existing) {
          const previous = existing;
          const next = { ...existing, member_type_id: typeId, department };
          setMembers((ms) => ms.map((m) => (m.id === existing.id ? next : m)));
          const { data, error: updError } = await supabase
            .from("members")
            .update({ member_type_id: typeId, department })
            .eq("id", existing.id)
            .select("id, user_id, member_type_id, department");
          if (updError || !data || data.length === 0) {
            setMembers((ms) => ms.map((m) => (m.id === previous.id ? previous : m)));
            if (updError) return failedWrite("Could not change the type", updError, resync);
            router.refresh();
            return "That change did not apply. Reloading the current state.";
          }
          // Append-if-missing, same reasoning as the grant paths: a resync
          // landing mid-update drops the row by identity, and a bare map would
          // then discard the server's own updated copy.
          setMembers((ms) =>
            ms.some((m) => m.id === existing.id)
              ? ms.map((m) => (m.id === existing.id ? (data[0] as Member) : m))
              : [...ms, data[0] as Member],
          );
          return null;
        }

        const { data, error: insError } = await supabase
          .from("members")
          .insert({ user_id: userId, member_type_id: typeId, department })
          .select("id, user_id, member_type_id, department")
          .single();
        if (insError || !data) return failedWrite("Could not assign the type", insError, resync);
        // Not a bare append: if a resync landed after the insert committed, the
        // snapshot already holds this row and appending would duplicate it —
        // and TypesAdmin counts the raw array, so one holder would render as
        // "2 people".
        setMembers((ms) =>
          ms.some((m) => m.id === (data as Member).id) ? ms : [...ms, data as Member],
        );
        return null;
      }),
    [members, resync, router, run],
  );

  /**
   * Issue a fresh sign-in link for someone who already exists.
   *
   * REPLACES an older `resetPasswordForEmail` call. That one asked Supabase to
   * EMAIL the person, which meant it depended on the project's mail transport —
   * and on the built-in service that reaches only the Supabase organization's
   * own members, at roughly two messages an hour. It reported "sent" in every
   * case, including the ones where nothing would ever arrive, because the
   * endpoint answers 200 for a real and an unknown address alike. An
   * administrator had no way to tell a delivered link from a silently dropped
   * one.
   *
   * This sends nothing. The route mints the token and returns the URL, and the
   * administrator hands it over themselves — so "it worked" and "they have it"
   * are the same event rather than two, the second of which was never
   * observable.
   */
  const reissueLink = useCallback(
    (person: Person) =>
      run(signInLinkKey(person.id), async () => {
        // BEFORE the request. An earlier version checked after, by which point
        // the route had already minted a recovery token — which overwrites the
        // one on screen, so the administrator was told to close a link that was
        // now dead while the working replacement was discarded unread.
        if (link) {
          return "Close the sign-in link you already have open before issuing another.";
        }
        const result = await postAdmin<{ link: string; email: string }>(
          `/api/admin/people/${person.id}/link`,
        );
        if ("message" in result) return result.message;
        // Straight into the reveal dialog. The link is never put in a notice or
        // a log line — see LinkRevealDialog for why it is treated as a
        // credential rather than a message.
        setLink({ link: result.data.link, email: result.data.email, created: false });
        return null;
      }),
    [link, run],
  );

  /**
   * Add someone: create the account, give them a type, reveal one link.
   *
   * Returns whether it worked, so the dialog knows whether to clear its fields.
   */
  const addPerson = useCallback(
    async (email: string, memberTypeId: string) =>
      run(ADD_PERSON_KEY, async () => {
        if (link) {
          return "Close the sign-in link you already have open before adding someone else.";
        }
        const result = await postAdmin<{
          link: string | null;
          email: string;
          created: boolean;
        }>(
          "/api/admin/people",
          { email, member_type_id: memberTypeId },
        );
        if ("message" in result) return result.message;

        setAddOpen(false);
        if (result.data.link === null) {
          // An account that already existed elsewhere on this Supabase project
          // and was not a member here. It has been given a type and recorded,
          // but no credential is handed over on a click that was meant to add
          // somebody — issuing one is a separate, deliberate act.
          setNotice(
            `${result.data.email} already had an account on this project and is now a member. ` +
              "They can sign in with their existing password — or use Issue a sign-in link if they cannot.",
          );
        } else {
          setLink({
            link: result.data.link,
            email: result.data.email,
            created: result.data.created,
          });
        }
        // The roster, the member rows and the audit log all changed server-side.
        // Nothing here is written optimistically: an account either exists or it
        // does not, and a fabricated row for one that failed to be created is a
        // worse lie than a moment's delay.
        resync();
        return null;
      }),
    [link, resync, run, setNotice],
  );

  /**
   * Promote or demote an administrator.
   *
   * STRAIGHT FROM THE BROWSER on the administrator's own token, like every
   * other write on this screen and unlike the three account-lifecycle actions.
   * There is no route because there is nothing for a route to add: since 0004
   * granted the privileges, this is an ordinary RLS-decided write, and the
   * INSERT policy's WITH CHECK gates on the CALLER — so the database refuses a
   * non-administrator regardless of what any TypeScript believes. Adding a
   * server hop would add a role check in application code, which CLAUDE.md is
   * explicit is not a second lock.
   *
   * The two refusals that matter are both the database's: RLS for someone who
   * is not an administrator, and the last-row trigger for the demotion that
   * would leave nobody. `describeTrustRootRefusal` turns those into sentences.
   */
  const setAdmin = useCallback(
    (person: Person, makeAdmin: boolean) =>
      run(adminRoleKey(person.id), async () => {
        const supabase = createClient();
        // `.select()` ON THE DELETE, and this is not cosmetic. A DELETE that RLS
        // refuses does NOT error — the policy FILTERS the row out and PostgREST
        // answers 204 — so without asking for the deleted rows back a refused
        // demotion renders as a successful one, and the trust root is untouched
        // while the screen says otherwise. This file already learned that for
        // grant revocation (see toggleGrant); the trust root is the last place
        // to forget it. The last-admin trigger does not save us either: it is a
        // BEFORE DELETE row trigger, and a row RLS filtered away never reaches
        // it. Reachable whenever the acting administrator was demoted in
        // another session.
        const { data: rows, error: writeError } = makeAdmin
          ? await supabase.from("super_admins").insert({ user_id: person.id }).select("user_id")
          : await supabase.from("super_admins").delete().eq("user_id", person.id).select("user_id");

        if (!writeError && (!rows || rows.length === 0)) {
          resync();
          return makeAdmin
            ? "That change did not apply — you may no longer be an administrator. Reloading."
            : "That change did not apply — they may already have been removed, or you may no longer be an administrator. Reloading.";
        }

        if (writeError) {
          const explained = describeTrustRootRefusal(writeError);
          if (explained) {
            // A deliberate refusal, already explained. Resync anyway: the most
            // common cause of the last-admin refusal is that the roster on
            // screen is out of date about who else is an administrator.
            resync();
            return explained;
          }
          return failedWrite(
            makeAdmin ? "Could not make them an administrator" : "Could not remove them as an administrator",
            writeError,
            resync,
          );
        }

        setNotice(
          makeAdmin
            ? `${person.email} is now an administrator.`
            : `${person.email} is no longer an administrator.`,
        );
        resync();
        return null;
      }),
    [resync, run, setNotice],
  );

  /**
   * Suspend or restore someone's sign-in.
   *
   * TOUCHES NO GRANTS, which is what makes it reversible — see the route for
   * the full reasoning. The caveat about an already-issued token staying valid
   * until it expires is repeated in the success message, because this is where
   * somebody decides whether a suspension is enough for the situation they are
   * actually in.
   */
  const setBanned = useCallback(
    (person: Person, banned: boolean) =>
      run(banKey(person.id), async () => {
        const result = await postAdmin<{ banned: boolean }>(
          `/api/admin/people/${person.id}/ban`,
          { banned },
        );
        if ("message" in result) return result.message;

        setNotice(
          banned
            ? `${person.email} can no longer sign in. A session they already have open stays valid for up to an hour — revoke their grants as well if this is urgent.`
            : `${person.email} can sign in again, with the access they had before.`,
        );
        resync();
        return null;
      }),
    [resync, run, setNotice],
  );

  /** Create a custom (non-system) type. */
  const createType = useCallback(
    (name: string, description: string | null) =>
      run(CREATE_TYPE_KEY, async () => {
        const supabase = createClient();
        const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        if (!slug) return "That name has no letters or digits to build a slug from.";
        const maxSort = memberTypes.reduce((n, t) => Math.max(n, t.sort_order), 0);
        const { error: insError } = await supabase.from("member_types").insert({
          slug,
          name: name.trim(),
          description,
          is_admin: false,
          // Never is_system: that flag marks the three starter types 0004 seeds,
          // which the database refuses to delete so that Add person always has
          // a type to offer. A type someone creates here must stay deletable.
          is_system: false,
          sort_order: maxSort + 10,
        });
        if (insError) {
          return insError.code === "23505"
            ? `A type with the slug "${slug}" already exists.`
            : `Could not create the type (${describeError(insError)}).`;
        }
        // Types are read on the server (they drive the person list too), so the
        // new row arrives through a refresh rather than being spliced in here.
        router.refresh();
        return null;
      }),
    [memberTypes, router, run],
  );

  /** Delete a custom type. System types are refused by the database. */
  const deleteType = useCallback(
    (typeId: string) =>
      run(deleteTypeKey(typeId), async () => {
        const supabase = createClient();
        const { data, error: delError } = await supabase
          .from("member_types").delete().eq("id", typeId).select("id");
        if (delError) {
          // 23001 restrict_violation is the system-type trigger; 23503 is the
          // FK from members. Both are the database refusing on purpose, so say
          // which rather than printing a code.
          if (delError.code === "23001") return "That is a system type and cannot be deleted.";
          if (delError.code === "23503") {
            return "People still hold that type. Reassign them first, then delete it.";
          }
          return `Could not delete the type (${describeError(delError)}).`;
        }
        if (!data || data.length === 0) {
          router.refresh();
          return "That change did not apply. Reloading the current state.";
        }
        router.refresh();
        return null;
      }),
    [router, run],
  );

  const selected = people.find((p) => p.id === selectedId) ?? people[0];

  if (categories.length === 0 || people.length === 0) {
    return (
      <>
        <TopBar parent="Admin" current="Access" />
        <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
          <Paper
            elevation={0}
            sx={{
              maxWidth: 520, mx: "auto", mt: { xs: 4, md: 10 }, p: { xs: 3, sm: 5 },
              textAlign: "center", border: 1, borderColor: "divider",
            }}
          >
            <Typography variant="h6" component="h1" sx={{ fontWeight: 700, mb: 1 }}>
              Nothing to grant yet
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
              {categories.length === 0
                ? "The catalog has no entries, so there is no access to assign. Add catalog entries first."
                : "There are no accounts to grant access to."}
            </Typography>
          </Paper>
        </Box>
      </>
    );
  }

  return (
    <>
      <TopBar parent="Admin" current="Access">
        <ViewSwitch
          value={view}
          label="Access view"
          onChange={setView}
          options={[
            { value: "person", label: "By person" },
            { value: "matrix", label: "Matrix" },
            // Third segment, beyond the design's two. The handoff predates user
            // types; with types, "what can this TYPE see" is a question neither
            // person-shaped view can answer, and putting it anywhere else would
            // split access administration across two places.
            { value: "types", label: "Types" },
            // Fourth segment. The audit log answers "who changed what, and
            // when", which is a question about the other three views rather
            // than a fourth way of editing access — read-only by construction.
            { value: "audit", label: "Audit" },
          ]}
        />
        <Button
          variant="contained"
          size="small"
          onClick={() => setAddOpen(true)}
          disabled={pending.has(ADD_PERSON_KEY)}
          sx={{ borderRadius: 50, px: 2.25 }}
        >
          Add person
        </Button>
      </TopBar>

      <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 2.5, md: 3 }, flex: 1, minWidth: 0 }}>
        {view === "person" ? (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "292px minmax(0, 1fr)" },
              gap: 2,
              alignItems: "start",
            }}
          >
            <PersonList
              people={people}
              selectedId={selected?.id ?? ""}
              counts={countsByPerson}
              members={memberIndex}
              typeById={typeById}
              currentUserId={currentUserId}
              pending={pending}
              onSelect={setSelectedId}
              onReissueLink={reissueLink}
              onSetAdmin={setAdmin}
              onSetBanned={setBanned}
            />
            {selected ? (
              <GrantsByPerson
                person={selected}
                categories={categories}
                grantIndex={grantIndex}
                typeGrantIndex={typeGrantIndex}
                memberIndex={memberIndex}
                memberTypes={memberTypes}
                pending={pending}
                onToggle={toggleGrant}
                onAssign={assignMember}
                onIssueSignInLink={reissueLink}
                linkPending={pending.has(signInLinkKey(selected.id))}
              />
            ) : null}
          </Box>
        ) : view === "matrix" ? (
          <AccessMatrix
            people={people}
            categories={launchableCategories}
            categoryNames={categoryNames}
            grantIndex={grantIndex}
            typeGrantIndex={typeGrantIndex}
            memberIndex={memberIndex}
            typeById={typeById}
            pending={pending}
            onToggle={toggleGrant}
          />
        ) : view === "audit" ? (
          <AuditLog rows={audit} error={auditError} />
        ) : (
          <TypesAdmin
            memberTypes={memberTypes}
            categories={categories}
            typeGrants={typeGrants}
            members={members}
            pending={pending}
            onToggleTypeGrant={toggleTypeGrant}
            onCreateType={createType}
            onDeleteType={deleteType}
          />
        )}
      </Box>

      <AddPersonDialog
        open={addOpen}
        memberTypes={memberTypes}
        pending={pending.has(ADD_PERSON_KEY)}
        onClose={() => setAddOpen(false)}
        onSubmit={addPerson}
      />

      <LinkRevealDialog
        open={link !== null}
        link={link?.link ?? null}
        email={link?.email ?? null}
        created={link?.created ?? false}
        // Dropping the link from state is what makes "not shown again" true
        // rather than merely a claim in the copy.
        onClose={() => setLink(null)}
      />

      <Snackbar
        open={notice !== null}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="success" variant="filled" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      </Snackbar>

      <Snackbar
        open={error !== null}
        autoHideDuration={6000}
        onClose={() => setError(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" variant="filled" onClose={() => setError(null)}>
          {error}
        </Alert>
      </Snackbar>
    </>
  );
}
