import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * `src/components/Logo.tsx` is the single surface that knows what the brand
 * looks like. It owns the light/dark ink swap and the mark itself, so a client
 * rebrands in one file.
 *
 * In the app this template was extracted from, the header and the sign-in page
 * had each inlined their own <Image> with a hardcoded light-mode asset path,
 * which left Logo.tsx dead and pinned both surfaces to light mode. This guards
 * the class rather than those two instances: any file that reaches for a brand
 * asset directly is a new copy of the same mistake.
 *
 * Both checks below still bite after rebranding — whether you keep the inline
 * SVG placeholder or drop real files into /public/logos.
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".tsx") ? [full] : [];
  });
}

const LOGO_COMPONENT = path.join("components", "Logo.tsx");

test("only Logo.tsx references brand image assets", () => {
  const srcDir = path.join(process.cwd(), "src");
  const offenders = walk(srcDir).filter((file) => {
    if (file.endsWith(LOGO_COMPONENT)) return false;
    // Matches any character up to the extension, deliberately: an earlier
    // version used [A-Za-z_]+, which did not match hyphens in the real asset
    // names — so the guard passed a mutation test with an inlined <img> right
    // there in the file. A guard that cannot fail is worse than no guard,
    // because it reads as coverage.
    return /\/logos\/[^"'`\s]+\.(png|jpe?g|svg|webp)/i.test(readFileSync(file, "utf8"));
  });

  assert.deepEqual(
    offenders.map((f) => path.relative(process.cwd(), f)),
    [],
    "these files inline a brand asset path instead of using <Logo>, which pins them to one theme",
  );
});

test("the product name comes from brand.ts, not hardcoded in components", () => {
  const srcDir = path.join(process.cwd(), "src");
  const brand = readFileSync(path.join(srcDir, "lib", "brand.ts"), "utf8");
  const appName = /export const APP_NAME = "([^"]+)"/.exec(brand)?.[1];
  assert.ok(appName, "APP_NAME is not exported from src/lib/brand.ts");

  // Components must not repeat the wordmark. Pages legitimately compose it into
  // <title> metadata, so only components/ is swept — that is where a duplicated
  // brand string would silently survive a rebrand.
  const componentsDir = path.join(srcDir, "components");
  const offenders = walk(componentsDir).filter((file) => {
    if (file.endsWith(LOGO_COMPONENT)) return false;
    return new RegExp(`["'\`>]\\s*${appName}\\s*["'\`<]`).test(readFileSync(file, "utf8"));
  });

  assert.deepEqual(
    offenders.map((f) => path.relative(process.cwd(), f)),
    [],
    `these components hardcode "${appName}" instead of importing APP_NAME from @/lib/brand`,
  );
});
