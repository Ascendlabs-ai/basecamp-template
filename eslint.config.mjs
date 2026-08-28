import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    /**
     * DOM globals that shadow ordinary local names, banned as bare identifiers.
     *
     * This exists because of a real bug, not a style preference. A refactor moved
     * a `const parent` into a helper's closure and left `parent` referenced in the
     * caller's success message. `lib.dom` declares `var parent: WindowProxy`, so
     * the name still resolved — `tsc --noEmit` passed, `eslint` passed, and every
     * category created on `/admin/catalog` announced
     * `Subcategory "X" created under ""`, because `window.name` is the empty
     * string. Nothing failed; it just said something untrue, which is the hardest
     * kind of defect to notice in a screen you are not watching.
     *
     * These are the names that are BOTH plausible locals and DOM globals of a
     * wrong type. `window.parent`, `window.name`, `window.status`, `window.length`
     * and `window.origin` are all reachable deliberately as properties of an
     * explicit `window.` — the rule bans only the bare identifier, so nothing
     * legitimate is blocked.
     */
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "parent",
          message:
            "`parent` is `window.parent`. You almost certainly meant a local — declare one, or write `window.parent` if you really want the frame.",
        },
        {
          name: "name",
          message:
            "`name` is `window.name` (a string, usually empty). Declare a local, or write `window.name` explicitly.",
        },
        {
          name: "status",
          message:
            "`status` is `window.status` (a legacy string). Declare a local, or write `window.status` explicitly.",
        },
        {
          name: "length",
          message:
            "`length` is `window.length` (the frame count). You almost certainly meant `something.length`.",
        },
        {
          name: "origin",
          message:
            "`origin` is `window.origin`. Declare a local, or write `window.origin` explicitly.",
        },
        {
          name: "closed",
          message: "`closed` is `window.closed`. Declare a local explicitly.",
        },
        {
          name: "top",
          message: "`top` is `window.top`. Declare a local, or write `window.top` explicitly.",
        },
        {
          name: "self",
          message: "`self` is `window.self`. Declare a local, or write `window.self` explicitly.",
        },
        {
          name: "event",
          message:
            "`event` is the deprecated `window.event`. Take the event as a handler parameter instead.",
        },
      ],
    },
  },
]);

export default eslintConfig;
