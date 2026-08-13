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
    // The design handoff is committed as SOURCE MATERIAL, not as code — see
    // Design/README-HANDOFF.md. `support.js` is the prototype's own runtime
    // (React 17-era ReactDOM.render, `module` assignment) and the .dc.html is a
    // non-functional mockup. Neither is built, imported, or shipped; linting
    // them reports on a third-party artifact we must not edit, because its
    // value is being a faithful copy of what was handed over.
    "Design/**",
  ]),
]);

export default eslintConfig;
