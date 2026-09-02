import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import TopBar from "@/components/shell/TopBar";
import { getBranding } from "@/lib/brandingServer";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return { title: `SSO reference · ${branding.displayName}` };
}

export default async function ReferenceClientPage({ searchParams }: { searchParams: Promise<{ result?: string }> }) {
  const [params, branding] = await Promise.all([searchParams, getBranding()]);
  const result = params.result;
  const configured = Boolean(process.env.BASECAMP_REFERENCE_OAUTH_CLIENT_ID);
  return <><TopBar parent="Admin" current="SSO reference" /><Stack component="main" id="main-content" tabIndex={-1} spacing={2} sx={{ p: { xs: 2, md: 4 }, maxWidth: 680 }}><Paper elevation={0} sx={{ p: { xs: 2.5, md: 4 }, border: 1, borderColor: "divider" }}><Typography component="h1" variant="h5" sx={{ fontWeight: 750 }}>{branding.displayName} SSO reference client</Typography><Typography color="text.secondary" sx={{ mt: 1, mb: 2.5 }}>This client proves the Authorization Code + PKCE flow without storing or displaying OAuth tokens. Client apps can copy the same protocol contract.</Typography>{result === "success" ? <Alert severity="success" sx={{ mb: 2 }}>SSO completed and the issued token was validated.</Alert> : null}{result === "failed" ? <Alert severity="error" sx={{ mb: 2 }}>SSO did not complete. Check the registered callback and OAuth server configuration.</Alert> : null}{!configured ? <Alert severity="warning" sx={{ mb: 2 }}>Register this reference client in Supabase and set its public client ID before testing.</Alert> : null}<Button href="/sso/reference/start" variant="contained" disabled={!configured}>Test {branding.displayName} SSO</Button></Paper></Stack></>;
}
