import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * `src/components/Logo.tsx` and `src/lib/brand.ts` are the only two files that
 * should know what this product is called or what it looks like. A client
 * rebrands by editing those; these guards are what stop the brand leaking back
 * out into components and pages.
 *
 * In the app this template was extracted from, the header and the sign-in page
 * had each inlined their own <Image> with a hardcoded light-mode asset path,
 * which left Logo.tsx dead and pinned both surfaces to light mode. That is the
 * class of regression guarded here.
 */
/**
 * `.ts` as well as `.tsx`. Scanning components only was a guard that read as
 * coverage while missing half of `src/` — every type module, `catalog.ts`,
 * `adminAccess.ts` and `entryMeta.ts` were invisible to it, and the README
 * claims the check covers "any file under src/".
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(full) ? [full] : [];
  });
}

const SRC = path.join(process.cwd(), "src");
const LOGO_COMPONENT = path.join("components", "Logo.tsx");

test("only Logo.tsx references brand image assets", () => {
  const offenders = walk(SRC).filter((file) => {
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

/**
 * The product name must come from `APP_NAME`, everywhere a user can read it.
 *
 * THIS GUARD WAS REWRITTEN AFTER FAILING ITS OWN MUTATION TEST. The first
 * version required the name to sit immediately between quotes or angle brackets
 * (`["'`>]\s*NAME\s*["'`<]`) and swept `src/components/` only. Both choices were
 * wrong, and provably so: restoring the literal original hardcode — `Sign in to
 * Basecamp` in `src/app/login/LoginForm.tsx` — passed cleanly. It missed the
 * exact regression it exists to catch, in the exact file the regression
 * historically occurred in, while the README advertised it as coverage.
 *
 * So: a word-boundary match over BOTH `src/components/` and `src/app/`, with the
 * name escaped before it reaches the regex (an APP_NAME containing `.` or `(`
 * would otherwise silently change the pattern's meaning, or throw).
 *
 * `export const metadata` blocks are excluded by line, not by file: page
 * metadata legitimately composes the name via template literal, and those lines
 * already reference APP_NAME rather than a literal.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("the product name comes from brand.ts, not hardcoded in components or pages", () => {
  const brand = readFileSync(path.join(SRC, "lib", "brand.ts"), "utf8");
  const appName = /export const APP_NAME = "([^"]+)"/.exec(brand)?.[1];
  assert.ok(appName, "APP_NAME is not exported from src/lib/brand.ts");

  const pattern = new RegExp(`\\b${escapeRegExp(appName)}\\b`);
  const offenders: string[] = [];

  for (const file of walk(SRC)) {
    if (file.endsWith(LOGO_COMPONENT)) continue;
    // Test files are not a user-visible surface, and this guard's own prose has
    // to quote the historical hardcode in order to explain itself. Widening the
    // sweep to `.ts` made it match its own doc comment — a self-inflicted
    // failure, not a leak. `brand.ts` needs no exemption: its export line
    // contains APP_NAME and is skipped below.
    if (/\.test\.tsx?$/.test(file)) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // Skip lines that already do the right thing.
      if (line.includes("APP_NAME")) return;
      if (!pattern.test(line)) return;
      offenders.push(`${path.relative(process.cwd(), file)}:${i + 1}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    `these lines hardcode "${appName}" instead of importing APP_NAME from @/lib/brand`,
  );
});
