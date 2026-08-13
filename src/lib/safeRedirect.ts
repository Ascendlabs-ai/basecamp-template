/**
 * Reduce an untrusted `?next=` value to a same-origin path, or "/".
 *
 * Parsed with the URL constructor rather than checked with string prefixes,
 * because the browser normalizes before it navigates and a prefix check does
 * not. The obvious guard — `startsWith("/") && !startsWith("//")` — was the
 * first version of this and it let three real payloads through:
 *
 *   "/\\evil.com"     browsers fold "\" to "/", so this becomes "//evil.com",
 *                     which is protocol-relative and leaves the origin
 *   "/\t/evil.com"    tabs and newlines are stripped from URLs before parsing
 * (An earlier version of this comment also listed "/%2f%2fevil.com". That was
 * wrong — it stays a literal same-origin path under both the old guard and this
 * one, and it is correctly absent from the test file.)
 *
 * Feeding the value through `new URL(next, origin)` applies exactly the same
 * normalization the browser will, so whatever origin comes back is the origin
 * the user would actually land on. Comparing that is the whole check.
 *
 * Returns only `pathname + search + hash` — never a full URL — so the caller
 * cannot be handed something that navigates off-origin even by mistake.
 */
export function sameOriginPath(
  next: string | null | undefined,
  origin: string = typeof window !== "undefined" ? window.location.origin : "http://localhost",
): string {
  if (!next) return "/";

  try {
    const url = new URL(next, origin);
    if (url.origin !== new URL(origin).origin) return "/";

    // The origin check alone is NOT enough, and assuming it was is how the
    // second version of this function shipped broken too. `url.pathname` can
    // itself begin with "//" while the origin compares equal, because the
    // parser resolves the path but does not flatten leading slashes:
    //
    //   "/..//evil.com"          -> pathname "//evil.com"   (no host needed!)
    //   "<origin>//evil.com"     -> pathname "//evil.com"
    //   "<origin>/\/evil.com"    -> pathname "///evil.com"
    //
    // Handing any of those to router.replace() resolves protocol-relative
    // against the current scheme and leaves the origin. So collapse leading
    // slashes to exactly one, then refuse anything still protocol-relative.
    const path = `/${url.pathname.replace(/^\/+/, "")}${url.search}${url.hash}`;
    return path.startsWith("//") ? "/" : path;
  } catch {
    // Unparseable input is not a path we should follow.
    return "/";
  }
}
