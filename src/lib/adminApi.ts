/**
 * Talking to the admin API routes, and reading what they say back.
 *
 * IN `src/lib` BECAUSE IT DECIDES WORDING. `readAdminResponse` chooses what an
 * administrator is told when a request does not succeed, and one of those
 * branches — the 401 — is the difference between "your session expired, sign in
 * again" and a parse error about an unexpected `<`. That is the same class of
 * judgement as `explainReadError` and `failedWrite`, both of which live in this
 * layer and carry tests. Left inside AccessAdmin it was untestable, and the
 * second screen to call an admin route would have copied it.
 */

/** What every admin route returns on refusal. Mirrors `denied()` on the server. */
type ErrorBody = { error?: unknown };

export type AdminResult<T> = { data: T } | { message: string };

/**
 * Read one admin-route response.
 *
 * THE HTML CASE IS REAL, not defensive padding. A crashed route, a proxy error
 * page, or a middleware redirect followed by `fetch` all deliver HTML with a
 * non-JSON body, and `res.json()` throws on it. Reporting "Unexpected token <"
 * tells the administrator nothing about what actually happened, so the status
 * code is used to say something true instead.
 */
export async function readAdminResponse<T>(res: Response): Promise<AdminResult<T>> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return {
      message:
        res.status === 401
          ? "Your session has expired. Reload the page and sign in again."
          : `The server returned an unexpected response (${res.status}).`,
    };
  }

  if (!res.ok) {
    // The route's own sentence when it sent one — those are written for the
    // person reading them and are always better than a status code.
    const message =
      typeof body === "object" && body !== null && typeof (body as ErrorBody).error === "string"
        ? ((body as { error: string }).error)
        : `That did not work (${res.status}).`;
    return { message };
  }

  return { data: body as T };
}

/**
 * POST JSON to an admin route and read the reply.
 *
 * Folds in the request so a caller's whole exchange is one line. Three call
 * sites were repeating the same `Content-Type` header and `JSON.stringify`
 * pair; a fourth would have repeated it again.
 *
 * `body` is optional because one route (`/ban`'s sibling, `/link`) takes none.
 */
export async function postAdmin<T>(url: string, body?: unknown): Promise<AdminResult<T>> {
  const res = await fetch(
    url,
    body === undefined
      ? { method: "POST" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  return readAdminResponse<T>(res);
}
