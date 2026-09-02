import type { AuditRow } from "@/types/admin";

/**
 * The words the Audit tab puts on the screen.
 *
 * These live in `src/lib` rather than beside the component for the reason
 * `adminAccess.ts` states: the test suite globs `src/**` but only this layer
 * carries tests, so logic left inside a component is structurally untestable.
 *
 * And this is logic, not formatting. `describeAuditRow` decides what every row
 * in an audit surface CLAIMS HAPPENED — a wrong branch here does not look like a
 * rendering bug, it looks like a different event. That is the last thing in the
 * app that should be verified by reading it.
 */

/**
 * Stable, locale-independent, readable at a glance.
 *
 * Explicit locale AND timeZone. `undefined` means "the runtime's" — Node on the
 * server, the browser on the client — so the two produce different strings and
 * React discards the subtree as a hydration mismatch. The audit log is
 * server-rendered and hydrated, so this is a live hazard rather than a
 * precaution: a timestamp near midnight would differ by a day between the two
 * passes.
 */
export function formatAuditTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

/** What the row is about, in one phrase. */
export function describeAuditRow(row: AuditRow): string {
  // `members` is the one source whose object is a TYPE, not an app. Without its
  // own branch it falls through and renders "granted Client to someone", which
  // is indistinguishable from granting an entry that happens to be called
  // Client — the two most different events on this screen reading identically.
  if (row.source_table === "members") {
    const who = row.subject_label ?? "someone";
    const type = row.object_label ?? "a type that no longer exists";
    return row.action === "grant"
      ? `put ${who} on the ${type} type`
      : `removed ${who} from the ${type} type`;
  }
  // Account lifecycle, from the admin API routes rather than a table trigger.
  // These MUST branch before the generic tail below: that tail assumes
  // grant/revoke and would render "granted something that no longer exists to
  // someone" for every one of them — a sentence about access for an event that
  // is not about access at all.
  if (row.source_table === "auth_admin") {
    const who = row.subject_label ?? "someone";
    switch (row.action) {
      case "invite":
        return `added ${who} and issued a sign-in link`;
      case "reissue_link":
        return `issued ${who} a new sign-in link`;
      case "ban":
        return `suspended ${who}'s sign-in`;
      case "unban":
        return `restored ${who}'s sign-in`;
      case "adopt":
        // Deliberately does NOT say "issued a link", because that path issues
        // none. An auditor asking which of these actually minted a credential
        // must be able to tell from the row alone.
        return `gave ${who}, who already had an account, access to this app`;
      default:
        // The database CHECK permits only the five above from this source, so
        // this is unreachable by any write the app can make. Named rather than
        // silently falling through, because reaching it means the constraint
        // and this switch have drifted apart.
        return `made an unrecognized account change for ${who}`;
    }
  }
  // 'unknown' means a trigger is attached to a table this app does not model.
  // The database CHECK permits it precisely so that case is recorded rather than
  // rejected, so it must not render as an ordinary grant.
  if (row.source_table === "unknown") {
    return "made a change on an unrecognized table — check the audit triggers";
  }
  if (row.source_table === "super_admins") {
    return row.action === "grant"
      ? `made ${row.subject_label ?? "someone"} an administrator`
      : `removed ${row.subject_label ?? "someone"} as an administrator`;
  }
  const verb = row.action === "grant" ? "granted" : "revoked";
  const object = row.object_label ?? "something that no longer exists";
  const kind = row.object_kind === "category" ? "the whole category" : "";
  const who =
    row.source_table === "type_grants"
      ? `the ${row.subject_label ?? "unknown"} type`
      : (row.subject_label ?? "someone");
  // The collapse is load-bearing: `kind` is empty for an entry grant, which
  // would otherwise leave a double space mid-sentence.
  return `${verb} ${kind} ${object} ${row.action === "grant" ? "to" : "from"} ${who}`.replace(
    /\s+/g,
    " ",
  );
}

/**
 * Who did it. A null actor is a real, distinct outcome — a change made outside
 * the app, in the SQL Editor or by a migration — so it gets a name rather than a
 * blank, which would read as missing data.
 */
export function describeAuditActor(actorEmail: string | null): string {
  return actorEmail ?? "System";
}
