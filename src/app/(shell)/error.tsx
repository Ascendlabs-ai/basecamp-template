"use client";

import { useEffect } from "react";

import ErrorOutlineRoundedIcon from "@mui/icons-material/ErrorOutlineRounded";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import TopBar from "@/components/shell/TopBar";

/**
 * Error boundary for everything INSIDE the shell.
 *
 * Without it the nearest boundary was `src/app/error.tsx`, above the shell
 * layout — so a throw in the catalog or the admin screen unmounted the sidebar
 * too, dumping the user onto a bare page with no navigation to leave by. Here
 * the failure stays inside the canvas and the shell keeps working.
 *
 * `digest` is the only identifier shown. If this Supabase project is shared
 * with client-facing apps, any of their customers can hold a session that
 * reaches this branch; the message itself goes to the server log, not the page.
 */
export default function ShellError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[basecamp] shell route error:", error.digest, error.message);
  }, [error]);

  return (
    <>
    <TopBar current="Something went wrong" />
    <Box component="main" id="main-content" tabIndex={-1} sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
      <Alert severity="error" icon={<ErrorOutlineRoundedIcon />} sx={{ maxWidth: 640 }}>
        <AlertTitle>Something went wrong on this page</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1.5 }}>
          The rest of Basecamp still works — use the sidebar to go elsewhere, or
          try again.
        </Typography>
        {error.digest ? (
          <Typography
            variant="body2"
            sx={{ fontFamily: "ui-monospace, monospace", mb: 1.5 }}
          >
            Reference {error.digest}
          </Typography>
        ) : null}
        <Button size="small" variant="outlined" onClick={reset} sx={{ cursor: "pointer" }}>
          Try again
        </Button>
      </Alert>
    </Box>
    </>
  );
}
