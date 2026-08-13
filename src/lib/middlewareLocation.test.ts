import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

/**
 * Guards a defect that shipped and that three code reviews all missed, because
 * every one of them read `middleware.ts` and reasoned about its matcher instead
 * of asking whether Next was loading the file at all.
 *
 * This app uses the `src/` layout, so Next resolves middleware at
 * `src/middleware.ts`. A `middleware.ts` at the project root is silently
 * IGNORED — no warning at build, no warning at boot, and `next build` still
 * prints "Proxy (Middleware)" in the route table because it is describing the
 * config, not a running module.
 *
 * The symptom was invisible in a browser: the page-level `if (!user)
 * redirect("/login")` defence-in-depth check still bounced you to the login
 * screen, so the app looked correct. It was only visible to a request that
 * does not follow redirects — `GET /` answered 200 with a page shell, and an
 * unknown route answered 404 instead of redirecting.
 *
 * Verified after the fix: `/` -> 307 /login?next=%2F, `/some-protected-route`
 * -> 307 (deny-by-default holds), `/login` -> 200.
 */
test("middleware sits where Next will actually load it", () => {
  const root = new URL("../../middleware.ts", import.meta.url);
  const src = new URL("../middleware.ts", import.meta.url);

  assert.ok(
    existsSync(src),
    "src/middleware.ts is missing — with a src/ app directory Next loads middleware from src/, and auth is unenforced without it",
  );
  assert.ok(
    !existsSync(root),
    "middleware.ts at the project root is IGNORED in a src/ layout. If both exist the root one is dead code that looks live.",
  );
});
