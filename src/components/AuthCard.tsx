import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";

import Logo from "./Logo";
import type { Branding } from "@/lib/branding";

/**
 * The centered, logo-topped card every signed-out screen sits in.
 *
 * The signed-out pages each had a byte-identical copy of this — `/auth/confirm`
 * and `/accept-invite`, and a third before it was removed — down to the `100dvh`
 * grid, the `maxWidth: 400` bordered `Paper` and the `mb: 2.5` logo box. Each
 * page now keeps only its `metadata` and its form, which is the part that
 * actually differs between them.
 *
 * Deliberately NOT a layout. These routes sit outside the `(shell)` group on
 * purpose — the visitor is not meaningfully signed in, and drawing the app
 * chrome around a password form would claim they are — but a route group layout
 * would also capture `/login`, which has its own wider composition. A component
 * each page opts into keeps that choice explicit.
 */
export default function AuthCard({ children, branding }: { children: React.ReactNode; branding: Branding }) {
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        px: 2,
        backgroundColor: "background.default",
      }}
    >
      <Paper
        elevation={0}
        sx={{
          width: "100%",
          maxWidth: 400,
          p: { xs: 3, sm: 4 },
          border: 1,
          borderColor: "divider",
        }}
      >
        <Box sx={{ mb: 2.5 }}>
          <Logo variant="primary" height={44} branding={branding} />
        </Box>
        {children}
      </Paper>
    </Box>
  );
}
