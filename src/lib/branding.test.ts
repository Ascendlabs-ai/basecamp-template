import assert from "node:assert/strict";
import test from "node:test";

import {
  FALLBACK_BRANDING,
  MAX_LOGO_BYTES,
  displayNameProblem,
  logoFileProblem,
  logoObjectPath,
  publicLogoUrl,
  resolveBranding,
} from "./branding.ts";

test("branding falls back when the settings row is absent or invalid", () => {
  assert.deepEqual(resolveBranding(null, "https://example.supabase.co"), FALLBACK_BRANDING);
  assert.deepEqual(
    resolveBranding({ display_name: "   ", logo_path: null }, "https://example.supabase.co"),
    FALLBACK_BRANDING,
  );
});

test("branding trims the saved display name and resolves only a safe public object path", () => {
  const resolved = resolveBranding(
    {
      display_name: "  Community Hub  ",
      logo_path: "logos/11111111-1111-4111-8111-111111111111.webp",
    },
    "https://example.supabase.co/",
  );
  assert.equal(resolved.displayName, "Community Hub");
  assert.equal(
    resolved.logoUrl,
    "https://example.supabase.co/storage/v1/object/public/basecamp-branding/logos/11111111-1111-4111-8111-111111111111.webp",
  );
  assert.equal(publicLogoUrl("https://example.supabase.co", "../private/logo.png"), null);
});

test("logo validation accepts only the storage bucket allowlist and size limit", () => {
  assert.equal(logoFileProblem({ type: "image/png", size: MAX_LOGO_BYTES }), null);
  assert.match(logoFileProblem({ type: "image/svg+xml", size: 100 }) ?? "", /PNG, JPEG, or WebP/);
  assert.match(logoFileProblem({ type: "image/webp", size: MAX_LOGO_BYTES + 1 }) ?? "", /2 MB/);
  assert.match(logoFileProblem({ type: "image/jpeg", size: 0 }) ?? "", /empty/);
});

test("logo object names derive their extension from MIME type, not the uploaded filename", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  assert.equal(logoObjectPath("image/jpeg", id), `logos/${id}.jpg`);
  assert.equal(logoObjectPath("image/svg+xml", id), null);
});

test("display names are required and bounded", () => {
  assert.match(displayNameProblem("  ") ?? "", /display name/);
  assert.match(displayNameProblem("x".repeat(101)) ?? "", /100/);
  assert.equal(displayNameProblem("Community Basecamp"), null);
});
