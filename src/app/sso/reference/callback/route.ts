import { NextRequest, NextResponse } from "next/server";
import { SUPABASE_URL } from "@/lib/supabase/env";

export async function GET(request: NextRequest) {
  const success = new URL("/sso/reference?result=success", request.nextUrl.origin);
  const failed = new URL("/sso/reference?result=failed", request.nextUrl.origin);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const expectedState = request.cookies.get("basecamp_oauth_state")?.value;
  const verifier = request.cookies.get("basecamp_oauth_verifier")?.value;
  const clientId = process.env.BASECAMP_REFERENCE_OAUTH_CLIENT_ID;
  let ok = Boolean(state && code && expectedState && verifier && clientId && state === expectedState);
  if (ok) {
    const callback = new URL("/sso/reference/callback", request.nextUrl.origin).toString();
    const tokenResponse = await fetch(new URL("/auth/v1/oauth/token", SUPABASE_URL), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", code: code!, code_verifier: verifier!, client_id: clientId!, redirect_uri: callback }), cache: "no-store" });
    if (!tokenResponse.ok) ok = false;
    else {
      const token = await tokenResponse.json() as { access_token?: unknown; id_token?: unknown };
      ok = typeof token.access_token === "string" && typeof token.id_token === "string";
    }
  }
  const response = NextResponse.redirect(ok ? success : failed);
  response.cookies.delete("basecamp_oauth_state");
  response.cookies.delete("basecamp_oauth_verifier");
  return response;
}
