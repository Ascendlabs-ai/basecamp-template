import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

/**
 * Guards a defect that shipped and that three code reviews all missed, because
 * every one of them read the request proxy and reasoned about its matcher instead
 * of asking whether Next was loading the file at all.
 *
 * This app uses the `src/` layout, so Next resolves the request proxy at
 * `src/proxy.ts`. A `proxy.ts` at the project root is silently
 * IGNORED — no warning at build, no warning at boot, and `next build` still
 * prints "Proxy (Middleware)" in the route table because it is describing the
 * config, not a running module.
 *
 * The symptom was invisible in a browser: the page-level `if (!user)
 * redirect("/login")` defense-in-depth check still bounced you to the login
 * screen, so the app looked correct. It was only visible to a request that
 * does not follow redirects — `GET /` answered 200 with a page shell, and an
 * unknown route answered 404 instead of redirecting.
 *
 * Verified after the fix: `/` -> 307 /login?next=%2F, `/some-protected-route`
 * -> 307 (deny-by-default holds), `/login` -> 200.
 */
test("the request proxy sits where Next will actually load it", () => {
  const root = new URL("../../proxy.ts", import.meta.url);
  const src = new URL("../proxy.ts", import.meta.url);
  const legacyMiddleware = new URL("../middleware.ts", import.meta.url);

  assert.ok(
    existsSync(src),
    "src/proxy.ts is missing — with a src/ app directory Next loads the request proxy from src/, and auth is unenforced without it",
  );
  assert.ok(
    !existsSync(root),
    "proxy.ts at the project root is IGNORED in a src/ layout. If both exist the root one is dead code that looks live.",
  );
  assert.ok(
    !existsSync(legacyMiddleware),
    "src/middleware.ts uses Next's deprecated convention; keep the authentication boundary in src/proxy.ts",
  );
});
