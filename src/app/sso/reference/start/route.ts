import { NextRequest, NextResponse } from "next/server";
import { pkceChallenge, randomUrlToken } from "@/lib/oauthReference";
import { SUPABASE_URL } from "@/lib/supabase/env";

export async function GET(request: NextRequest) {
  const clientId = process.env.BASECAMP_REFERENCE_OAUTH_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/sso/reference?result=failed", request.url));
  const state = randomUrlToken();
  const verifier = randomUrlToken(48);
  const callback = new URL("/sso/reference/callback", request.nextUrl.origin).toString();
  const authorize = new URL("/auth/v1/oauth/authorize", SUPABASE_URL);
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("redirect_uri", callback);
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", await pkceChallenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  const response = NextResponse.redirect(authorize);
  const options = { httpOnly: true, secure: request.nextUrl.protocol === "https:", sameSite: "lax" as const, path: "/sso/reference", maxAge: 600 };
  response.cookies.set("basecamp_oauth_state", state, options);
  response.cookies.set("basecamp_oauth_verifier", verifier, options);
  return response;
}
