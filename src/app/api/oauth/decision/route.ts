import { NextRequest, NextResponse } from "next/server";

import { APP_NAME } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const authorizationId = String(form.get("authorization_id") ?? "");
  const decision = String(form.get("decision") ?? "");
  if (!authorizationId || (decision !== "approve" && decision !== "deny")) {
    return NextResponse.json({ error: "Invalid authorization decision." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth, error: detailError } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (detailError || !auth) return NextResponse.json({ error: "Authorization request expired." }, { status: 400 });
  if ("redirect_url" in auth) return NextResponse.redirect(auth.redirect_url, 303);

  if (decision === "approve") {
    const { data: mapping, error: mappingError } = await supabase
      .from("oauth_clients")
      .select("entry_id")
      .eq("client_id", auth.client.id)
      .eq("enabled", true)
      .contains("redirect_uris", [auth.redirect_uri])
      .maybeSingle();
    if (mappingError || !mapping) {
      return NextResponse.json({ error: `This app is not authorized for your ${APP_NAME} account.` }, { status: 403 });
    }
  }

  const result = decision === "approve"
    ? await supabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
    : await supabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
  if (result.error || !result.data?.redirect_url) {
    return NextResponse.json({ error: "The authorization decision could not be completed." }, { status: 400 });
  }
  return NextResponse.redirect(result.data.redirect_url, 303);
}
