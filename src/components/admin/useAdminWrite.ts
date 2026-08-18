"use client";

import { useCallback, useRef, useState, useTransition } from "react";

import { useRouter } from "next/navigation";

import { describeError, isTransportFailure } from "@/lib/adminAccess";

/**
 * The admin screens' shared write machinery: claim a key, run the work, release,
 * and surface anything that goes wrong.
 *
 * EXTRACTED, NOT WRITTEN. Every line here came from AccessAdmin.tsx, where it
 * was arrived at the hard way — a ref-based claim because a setState updater is
 * not synchronous, a notification deadline that deliberately does NOT release
 * the claim, a throw path that reloads because it promised the user it would.
 * The comments explaining each are kept at the piece they explain; read them
 * before simplifying any of it.
 *
 * It lives here because a SECOND admin screen now writes to RLS-governed tables
 * (Admin → Catalog). The alternative was a second copy of this file's races,
 * which is the shape that drifts: the next person to fix a claim bug fixes it in
 * one screen. This module is the one definition, and both screens are its
 * callers.
 *
 * It is a hook rather than a component because `pending` has to re-render the
 * caller — the spinners are per-key — and because `useRouter` belongs to the
 * component tree.
 */

/**
 * How long before the user is TOLD a write has not landed.
 *
 * Deliberately not a claim release. An earlier version released the key when
 * this fired, which re-opened the target while the request was still running:
 * a second click took the delete branch and sent `.eq("id", "optimistic:e:…")`
 * against a uuid column, surfacing as "Could not revoke access (22P02)". So the
 * NOTIFICATION is bounded and the claim is not — a request that never settles
 * leaves that one cell spinning until a reload, which is what the timeout
 * message tells the user to do. That is the accepted trade, recorded here
 * because the two are easy to confuse.
 */
const WRITE_TIMEOUT_MS = 15_000;

/**
 * "the current state", not "the current access state". The wording widened when
 * this moved out of the access screen and a catalog screen started sharing it;
 * saying "access" on a screen that edits entries would name the wrong thing.
 */
const TIMEOUT_MESSAGE = "That change timed out. Reload to see the current state.";

/** A losing race must not leave a 15-minute-a-day drip of dangling timers. */
function deadline(ms: number): { promise: Promise<string>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout>;
  const promise = new Promise<string>((resolve) => {
    handle = setTimeout(() => resolve(TIMEOUT_MESSAGE), ms);
  });
  return { promise, cancel: () => clearTimeout(handle) };
}

/**
 * Message for a failed WRITE — and a resync when the failure is ambiguous.
 *
 * Zero rows back cannot distinguish "RLS refused" from "someone else did it",
 * so those paths already refresh. A TRANSPORT failure is ambiguous for the same
 * reason — the request may have reached Postgres and committed before the
 * connection died — and every write path needs the same treatment. Inserts got
 * it first and the deletes were missed, which was backwards: the access screen
 * argues that a stale "granted" is a lie about access while a stale "not
 * granted" is only a lost write, and the deletes are the ones that go
 * stale-granted. The catalog screen inherits the same rule for the same reason:
 * a deleted entry still on screen is a claim that something exists.
 *
 * A returned SQLSTATE is real evidence the database refused — 23505, 42501 —
 * and needs no refresh. `describeError` yields "network error" precisely when
 * there is no code, which is the case that does.
 */
export function failedWrite(
  prefix: string,
  error: { code?: string } | null,
  resync: () => void,
): string {
  // `!error` reaches here when the insert returned neither an error nor a row —
  // the MOST ambiguous outcome there is, and an earlier version routed exactly
  // that case to the no-refresh branch. Both it and a transport failure get a
  // resync; only a real SQLSTATE is evidence the database refused.
  if (isTransportFailure(error)) {
    // THROUGH THE CALLER'S `resync`, not a bare refresh. A screen that gates
    // controls on "a resync is in flight" needs every refresh to raise that
    // flag — a reorder that hits a transport failure would otherwise re-enable
    // its arrows against a list the server may have partly renumbered.
    resync();
    return `${prefix} — it is unclear whether it applied. Reloading the current state.`;
  }
  return `${prefix} (${describeError(error)}).`;
}

export type AdminWrite = {
  /**
   * Resolves TRUE only when the work completed with no message — callers that
   * need to know (a create form clears its fields on success only) can await it.
   * A skipped duplicate claim resolves false, which is correct: this call did
   * nothing.
   */
  run: (key: string, work: () => Promise<string | null>) => Promise<boolean>;
  /** Render mirror of the in-flight set. Read-only to callers. */
  pending: Set<string>;
  error: string | null;
  notice: string | null;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  /**
   * Re-read the server component tree, and keep `isResyncing` true until the new
   * props actually land.
   *
   * `router.refresh()` alone returns immediately, so a caller that re-enables a
   * control when the write settles re-enables it while the screen still shows
   * pre-write data. Every refresh in this module goes through here for that
   * reason, including the throw and timeout paths.
   */
  resync: () => void;
  isResyncing: boolean;
};

export function useAdminWrite(): AdminWrite {
  const router = useRouter();
  const [isResyncing, startResync] = useTransition();
  const resync = useCallback(() => {
    startResync(() => router.refresh());
  }, [router]);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Separate from `error` so a success confirmation is not styled as a failure.
  const [notice, setNotice] = useState<string | null>(null);

  /**
   * The authoritative in-flight set. `pending` (state) is a MIRROR for
   * rendering only.
   *
   * The claim must be synchronous and a setState updater is not: React runs an
   * updater eagerly only while the fiber has no pending lanes, so after the
   * first toggle of a session it is deferred to render. A previous version read
   * a flag set inside the updater — every toggle after the first read stale,
   * returned without writing, and still stranded its key. The feature was dead
   * after one click.
   */
  const inFlight = useRef<Set<string>>(new Set());

  const run = useCallback(
    async (key: string, work: () => Promise<string | null>): Promise<boolean> => {
      if (inFlight.current.has(key)) return false;
      inFlight.current.add(key);
      setPending(new Set(inFlight.current));

      // The CLAIM is released when the request actually settles, not when the
      // deadline fires. Releasing at the deadline while the request was still
      // running re-opened the target: a second click re-entered the handler,
      // found the optimistic row still present, took the DELETE branch and sent
      // `.eq("id", "optimistic:e:…")` against a uuid column — surfacing as
      // "Could not revoke access (22P02)".
      const release = () => {
        inFlight.current.delete(key);
        setPending(new Set(inFlight.current));
      };

      const settled = work()
        .then(
          (message) => ({ message, timedOut: false, threw: false }),
          (cause) => {
            console.error("[basecamp] admin mutation threw:", cause);
            return {
              message: "Could not save the change. Reloading the current state.",
              timedOut: false,
              // Distinguished from an ordinary refusal: a returned message is a
              // deliberate "no" from a path that has already put the screen
              // right, whereas a THROW means local state may be mid-flight.
              threw: true,
            };
          },
        )
        .finally(release);

      const timer = deadline(WRITE_TIMEOUT_MS);
      const outcome = await Promise.race([
        settled,
        timer.promise.then((message) => ({ message, timedOut: true, threw: false })),
      ]);
      timer.cancel();

      if (outcome.message) setError(outcome.message);
      if (outcome.threw) {
        // The message says "Reloading the current state", so reload. Without
        // this it was a promise the code did not keep: a throw landing after an
        // optimistic insert left the fabricated row on screen indefinitely
        // while the user read that a reload was under way — a stale row, which
        // is the more dangerous direction to be wrong in.
        resync();
        return false;
      }
      if (outcome.timedOut) {
        // The request is still in flight and its own handlers may still mutate
        // state. Reload rather than let the screen move under a user who was
        // just told the change did not land.
        void settled.then(() => resync());
        return false;
      }
      // NO blanket refresh here. Adding one made `isTransportFailure`
      // decorative: every deliberate refusal round-tripped the page anyway —
      // a duplicate slug, a system-type delete, an FK-in-use, and even a purely
      // client-side validation message that never touches the database. Each
      // path that genuinely needs a resync already calls router.refresh()
      // itself.
      return outcome.message === null;
    },
    [resync],
  );

  return { run, pending, error, notice, setError, setNotice, resync, isResyncing };
}
