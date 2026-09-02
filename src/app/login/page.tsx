import { Suspense } from "react";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Skeleton from "@mui/material/Skeleton";

import DotGridSurface from "@/components/DotGridSurface";
import Logo from "@/components/Logo";
import { getBranding } from "@/lib/brandingServer";
import type { Metadata } from "next";

import LoginForm from "./LoginForm";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return { title: `Sign in · ${branding.displayName}` };
}

export default async function LoginPage() {
  const branding = await getBranding();
  return (
    <DotGridSurface>
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 420,
          p: { xs: 3, sm: 4 },
          border: 1,
          borderColor: "divider",
          backgroundColor: "background.paper",
        }}
      >
        <Box sx={{ mb: 3 }}>
          {/* Primary (stacked) lockup — STYLE-GUIDE's specified variant for
              splash surfaces. Via <Logo>, not a hardcoded <Image>: Logo owns
              the light/dark ink swap and the cropped aspect ratios, so a second
              inline copy here would silently stay light-mode-only when dark
              mode is wired. */}
          <Logo variant="primary" height={56} branding={branding} />
        </Box>

        {/* useSearchParams() needs a Suspense boundary or the whole route
            opts out of static rendering and `next build` warns. */}
        <Suspense fallback={<Skeleton variant="rounded" height={320} />}>
          <LoginForm branding={branding} />
        </Suspense>
      </Paper>
    </DotGridSurface>
  );
}
