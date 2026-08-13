"use client";

import { useSyncExternalStore } from "react";

/** Never fires — the value flips once, when React swaps snapshots at hydration. */
const subscribe = () => () => {};
const getSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` on the server and during the hydration render, `true` afterwards.
 *
 * Exists for one job: letting a component render markup that is IDENTICAL on
 * both sides, then opt into client-only behaviour on the next commit.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect` because this
 * repo's react-hooks config rejects set-state-in-effect (see CatalogView, which
 * hit the same rule from the other direction). This is also the pattern React
 * documents for exactly this question, and it cannot tear: the server snapshot
 * and the first client snapshot are both consulted by React itself.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
