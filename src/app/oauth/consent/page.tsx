import { redirect } from "next/navigation";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import AuthCard from "@/components/AuthCard";
import { getBranding } from "@/lib/brandingServer";
import { createClient } from "@/lib/supabase/server";
import type { Branding } from "@/lib/branding";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return { title: `Connect an app · ${branding.displayName}` };
}

export default async function OAuthConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const [branding, params] = await Promise.all([getBranding(), searchParams]);
  const authorizationId = params.authorization_id;
  if (!authorizationId) return <ConsentError branding={branding} message="This authorization request is missing its identifier." />;

  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !auth) return <ConsentError branding={branding} message="This authorization request is invalid or has expired." />;

  // Supabase may return a redirect immediately for consent already on file.
  // Token issuance is still fail-closed by basecamp.custom_access_token_hook.
  if ("redirect_url" in auth) redirect(auth.redirect_url);

  const { data: mapping, error: mappingError } = await supabase
    .from("oauth_clients")
    .select("entry_id, client_id, redirect_uris, enabled")
    .eq("client_id", auth.client.id)
    .eq("enabled", true)
    .contains("redirect_uris", [auth.redirect_uri])
    .maybeSingle();
  const allowed = !mappingError && mapping !== null;

  return (
    <AuthCard branding={branding}>
      <Stack spacing={2.25}>
        <Box>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 750 }}>Connect {auth.client.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            {allowed
              ? `${auth.client.name} is asking to use your ${branding.displayName} identity.`
              : "Basecamp cannot approve this app for your account."}
          </Typography>
        </Box>

        {allowed ? (
          <>
            <Alert severity="info">Only continue if you recognize this app and intended to open it.</Alert>
            <Box>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary", mb: 0.75 }}>Requested access</Typography>
              <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
                {auth.scope.split(" ").filter(Boolean).map((scope) => <Chip key={scope} label={scope} size="small" />)}
              </Stack>
            </Box>
            <Typography variant="body2" color="text.secondary">Signed in as {auth.user.email}</Typography>
          </>
        ) : (
          <Alert severity="error">The app is not registered for this exact callback address, is disabled, or you no longer have access to {branding.displayName}.</Alert>
        )}

        <Stack component="form" method="post" action="/api/oauth/decision" direction={{ xs: "column-reverse", sm: "row" }} spacing={1} justifyContent="flex-end">
          <input type="hidden" name="authorization_id" value={auth.authorization_id} />
          <Button type="submit" name="decision" value="deny">Cancel</Button>
          {allowed ? <Button type="submit" name="decision" value="approve" variant="contained">Continue to {auth.client.name}</Button> : null}
        </Stack>
      </Stack>
    </AuthCard>
  );
}

function ConsentError({ message, branding }: { message: string; branding: Branding }) {
  return <AuthCard branding={branding}><Alert severity="error"><Typography component="h1" sx={{ fontWeight: 700, mb: 0.5 }}>Connection unavailable</Typography>{message}</Alert></AuthCard>;
}
