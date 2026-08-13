/**
 * Env access in one place, validated at module load.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` at build time, so these must be
 * referenced by their full literal names — destructuring `process.env` or
 * building the key dynamically yields `undefined` in the browser bundle.
 *
 * Throwing here rather than passing `undefined!` into createClient is
 * deliberate: an unset key otherwise surfaces as an opaque "Invalid API key"
 * from PostgREST at request time, far from the actual cause.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.local.example to .env.local and fill it in — see README.md → Setup.`,
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  "NEXT_PUBLIC_SUPABASE_URL",
  process.env.NEXT_PUBLIC_SUPABASE_URL,
);

export const SUPABASE_ANON_KEY = required(
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);
