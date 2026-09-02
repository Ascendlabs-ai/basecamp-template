import "server-only";

import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./supabase/env";
import { FALLBACK_BRANDING, resolveBranding, type Branding, type BrandingRow } from "./branding";

/** Request-deduplicated public branding read. Missing/unreleased schema falls back safely. */
export const getBranding = cache(async (): Promise<Branding> => {
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "public" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase
    .rpc("basecamp_public_branding")
    .maybeSingle();

  if (error) {
    console.error("[basecamp] branding query failed:", error.code, error.message);
    return FALLBACK_BRANDING;
  }

  return resolveBranding(data as BrandingRow | null, SUPABASE_URL);
});
