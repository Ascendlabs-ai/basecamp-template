import type { Metadata } from "next";
import { redirect } from "next/navigation";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import BrandingAdmin from "@/components/admin/BrandingAdmin";
import TopBar from "@/components/shell/TopBar";
import { resolveBranding, type BrandingRow } from "@/lib/branding";
import { getBranding } from "@/lib/brandingServer";
import { isSuperAdmin } from "@/lib/isSuperAdmin";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return { title: `Branding · Admin · ${branding.displayName}` };
}

export default async function BrandingPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const [role, settings] = await Promise.all([
    isSuperAdmin(),
    supabase
      .from("branding_settings")
      .select("display_name, logo_path")
      .eq("singleton", true)
      .maybeSingle(),
  ]);

  return (
    <>
      <TopBar parent="Admin" current="Branding" />
      <Box component="main" id="main-content" tabIndex={-1} sx={{ p: { xs: 2, md: 4 }, maxWidth: 760 }}>
        <Typography component="h1" variant="h4" sx={{ fontWeight: 700, mb: 0.75 }}>
          Branding
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          Set the name and public logo people see throughout this Basecamp.
        </Typography>

        {!role.value ? (
          <Paper elevation={0} sx={{ p: 3, border: 1, borderColor: "divider" }}>
            <Alert severity="warning">
              <AlertTitle>Administrator access required</AlertTitle>
              Only a Basecamp super administrator can change branding.
            </Alert>
          </Paper>
        ) : settings.error ? (
          <Alert severity="error">
            <AlertTitle>Branding settings could not be loaded</AlertTitle>
            The branding migration may not be released yet. No changes can be saved until this read succeeds.
          </Alert>
        ) : (
          <BrandingAdmin initial={resolveBranding(settings.data as BrandingRow | null, SUPABASE_URL)} />
        )}
      </Box>
    </>
  );
}
