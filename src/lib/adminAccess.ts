// Type-only import. It must STAY type-only: `npm test` runs these modules
// through node's --experimental-strip-types, which erases type imports but does
// NOT resolve tsconfig `paths`. A value import via "@/..." here compiles fine
// and then fails at test time with ERR_MODULE_NOT_FOUND.
import type {
  CellAccess,
  Grant,
  GrantCategory,
  Member,
  ToggleTarget,
  TypeGrant,
} from "@/types/admin";

/**
 * Access-screen logic. Lives in `src/lib/` — not `src/types/` — because it is
 * executable behaviour, and the repo convention is "run the tests after
 * touching anything under `src/lib/`". Behaviour parked in a module named
 * `types` sits outside the one trigger the convention names, and the test file
 * for it was already reaching out of `lib/` to import it.
 *
 * None of this DECIDES access — the RLS policies do, via `basecamp.has_grant`, and it is
 * enforced by the policies themselves — this template ships no database probe
 * suite, so that enforcement is unverified here. What lives here is the
 * UI's picture of that decision, which must agree with it.
 */

/**
 * Index key for a grant, keyed by SUBJECT and target.
 *
 * The subject is a user id for `access_grants` and a member-type id for
 * `type_grants` — two different maps, never merged, so one function serves
 * both. The `e:`/`c:` discriminator is what stops an entry id equal to a
 * category id from aliasing.
 */
export function grantKey(subjectId: string, target: ToggleTarget): string {
  return "entryId" in target
    ? `e:${subjectId}:${target.entryId}`
    : `c:${subjectId}:${target.categoryId}`;
}

/**
 * Key for the in-flight set. Shares `grantKey`'s `e:`/`c:` discriminator on
 * purpose: four call sites once hand-built `${userId}:${targetId}` without it,
 * so an entry and a category with colliding ids shared one pending slot.
 */
export function pendingKey(userId: string, target: ToggleTarget): string {
  return grantKey(userId, target);
}

/**
 * The rest of the pending-key namespace.
 *
 * `pendingKey` was extracted because four call sites hand-built
 * `${userId}:${targetId}` without it. The lesson was then only half applied:
 * the type-grant, member and delete-type keys stayed as string concatenation
 * hand-written in one file and re-derived by eye in another, and iteration 1 of
 * the review spent a correction note recording that it had verified one of them
 * "character-by-character" — a review step that only exists because the
 * contract was untyped text.
 *
 * `CREATE_TYPE_KEY` additionally lived in AccessAdmin.tsx and was imported by
 * TypesAdmin.tsx, which AccessAdmin renders: AccessAdmin -> TypesAdmin ->
 * AccessAdmin. `ToggleTarget` sits in types/admin.ts for exactly that reason,
 * documented there. Putting all five here means one import direction and one
 * definition each, so writer and reader cannot drift.
 */
export function typeGrantKey(typeId: string, target: ToggleTarget): string {
  return `type:${pendingKey(typeId, target)}`;
}

export function memberKey(userId: string): string {
  return `member:${userId}`;
}

export function deleteTypeKey(typeId: string): string {
  return `delete-type:${typeId}`;
}

/**
 * A constant, not `create-type:${name}`. The create handler clears the name
 * field synchronously after dispatching, so a name-derived key made the reader
 * look up `create-type:` while the writer had claimed `create-type:Contractor`
 * — the spinner never appeared and the double-submit guard never fired. Only
 * one type can be created at a time, so a constant is also simply correct.
 */
export const CREATE_TYPE_KEY = "create-type";

/**
 * Index grants by (user, target) for O(1) lookup while rendering a matrix that
 * is people x entries. A linear scan per cell would be O(people x entries x
 * grants) — with dozens of people and entries that is thousands of scans per
 * render.
 */
export function indexGrants(grants: Grant[]): Map<string, Grant> {
  const map = new Map<string, Grant>();
  for (const g of grants) {
    // A row with neither id set cannot exist — the CHECK constraint rejects it
    // — so it is skipped rather than coerced into a `c:user:` key that would
    // silently alias every other malformed row onto one slot.
    if (g.entry_id) map.set(grantKey(g.user_id, { entryId: g.entry_id }), g);
    else if (g.category_id) map.set(grantKey(g.user_id, { categoryId: g.category_id }), g);
  }
  return map;
}

/**
 * Is this failure evidence the DATABASE refused, or evidence of nothing?
 *
 * postgrest-js initialises `code` to `""` on a fetch failure, so a dropped
 * connection carries no SQLSTATE — and neither does the "no error, no row"
 * outcome, which is the most ambiguous result an insert can produce. In both
 * cases the write may have committed, so the caller must resync rather than
 * report a clean failure. A real `23505` or `42501` IS evidence and needs none.
 *
 * Extracted so the transport-vs-database decision is one testable predicate
 * instead of a string comparison against a human-facing message.
 */
export function isTransportFailure(error: { code?: string } | null): boolean {
  return !error || !error.code;
}

/**
 * Human-facing tail for a failed PostgREST call.
 *
 * postgrest-js initialises `code` to `""` (not undefined) on a fetch failure,
 * so `error.code ?? "unknown"` never fires and a dropped connection renders as
 * an empty parenthetical — "Could not grant access ()." That bug was fixed in
 * one call site and immediately rewritten in another, which is why the logic
 * is shared rather than inlined.
 */
export function describeError(error: { code?: string; message?: string } | null): string {
  if (!error) return "unknown error";
  if (error.code) return error.code;
  return "network error";
}

/**
 * Initials from an email local-part. `jordanmiller@…` -> "JO",
 * `first.last@…` -> "FL". Falls back to "?" rather than throwing on an empty
 * or punctuation-only local part.
 *
 * There is no profiles table on this Supabase project and `list_people()` returns
 * only id and email, so the email IS the whole identity this app has.
 */
export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  const letters = local.replace(/[^a-z0-9]/gi, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  if (letters.length === 1) return letters.toUpperCase();
  return "?";
}

// ---------------------------------------------------------------------------
// Type-aware access resolution
// ---------------------------------------------------------------------------

/**
 * Index type grants by (type, target), same discriminated-key scheme as
 * `indexGrants`, and deliberately the SAME key format — the safety here is that
 * the two Maps are never merged, NOT that the strings differ. A type id and a
 * user id are both uuids, so `grantKey` cannot tell them apart and does not
 * try; `resolveAccess` looks up user subjects only in `grantIndex` and type
 * subjects only in `typeGrantIndex`. (The PENDING keys are a different matter
 * — those DO share one Set, which is why `typeGrantKey` prefixes `type:`.)
 */
export function indexTypeGrants(grants: TypeGrant[]): Map<string, TypeGrant> {
  const map = new Map<string, TypeGrant>();
  for (const g of grants) {
    if (g.entry_id) map.set(grantKey(g.member_type_id, { entryId: g.entry_id }), g);
    else if (g.category_id)
      map.set(grantKey(g.member_type_id, { categoryId: g.category_id }), g);
  }
  return map;
}

/** `user_id` -> their member row, for O(1) lookup while rendering a matrix. */
export function indexMembers(members: Member[]): Map<string, Member> {
  return new Map(members.map((m) => [m.user_id, m]));
}

/**
 * How this person came to see this entry — the UI's mirror of
 * `basecamp.has_grant` — which is what the read policies actually run.
 * (`can_read_entry` states the same rule readably but is called by no policy;
 * nothing in this template holds the two to each other — keep them in step by
 * hand.)
 *
 * The SQL is `super_admin OR individual OR type`. This deliberately does NOT
 * model super_admin: the matrix answers "what has been granted", and a
 * super_admin who sees everything by role has been granted nothing. Painting
 * their whole row solid would hide the fact that removing the role would leave
 * them with no access at all.
 *
 * Individual wins the label when both apply, because the individual grant is
 * the row an admin can act on here; `alsoViaType` carries the rest of the truth
 * so the UI can say the toggle will not change what they see.
 */
export function resolveAccess(
  grantIndex: Map<string, Grant>,
  typeGrantIndex: Map<string, TypeGrant>,
  memberIndex: Map<string, Member>,
  userId: string,
  entryId: string,
  categoryId: string,
): CellAccess {
  // Kept apart on purpose. Collapsing these two into one boolean is exactly
  // what shipped a matrix that could not revoke a category grant: a caller
  // needs to know not just THAT the person has access, but whether the row
  // granting it is the one its toggle would delete.
  const directEntry = grantIndex.has(grantKey(userId, { entryId }));
  const directCategory = grantIndex.has(grantKey(userId, { categoryId }));

  const typeId = memberIndex.get(userId)?.member_type_id;
  const viaType = typeId
    ? typeGrantIndex.has(grantKey(typeId, { entryId })) ||
      typeGrantIndex.has(grantKey(typeId, { categoryId }))
    : false;

  if (directEntry || directCategory) {
    return {
      source: "individual",
      // Only when the category grant is the ONLY individual path. A redundant
      // entry grant alongside it is still a real row a per-entry toggle can
      // delete, so that case must stay live.
      viaCategory: directCategory && !directEntry,
      alsoViaType: viaType,
    };
  }
  if (viaType) return { source: "type", viaCategory: false, alsoViaType: true };
  return { source: "none", viaCategory: false, alsoViaType: false };
}

/**
 * Entries a person can see, counting both sources once. Used for the roster
 * figure, which must agree with what the by-person view totals.
 */
export function effectiveEntryCount(
  grantIndex: Map<string, Grant>,
  typeGrantIndex: Map<string, TypeGrant>,
  memberIndex: Map<string, Member>,
  userId: string,
  categories: GrantCategory[],
): number {
  let n = 0;
  for (const cat of categories) {
    for (const entry of cat.entries) {
      if (resolveAccess(grantIndex, typeGrantIndex, memberIndex, userId, entry.id, cat.id).source !== "none") {
        n += 1;
      }
    }
  }
  return n;
}
