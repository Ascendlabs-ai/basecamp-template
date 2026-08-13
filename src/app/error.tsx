"use client";

import { useEffect } from "react";

import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Button from "@mui/material/Button";
import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

/**
 * `page.tsx` handles the PostgREST error object it is RETURNED. This catches
 * what is THROWN — a missing env var surfacing from env.ts at module load, a
 * cookies() failure, a render-time throw in any client component. Without it
 * those escape to Next's default error screen: unstyled, off-brand, and in
 * development it prints a stack.
 *
 * Deliberately shows no error text. This route is reachable by anyone holding
 * an `authenticated` JWT on a Supabase project shared with client-facing apps, and a raw
 * throw message can carry table names, connection strings or worse. The detail
 * goes to the server log.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[basecamp] unhandled error:", error.digest ?? "", error.message);
  }, [error]);

  return (
    <Container component="main" maxWidth="sm" sx={{ py: { xs: 6, md: 10 } }}>
      <Alert severity="error">
        <AlertTitle>Something went wrong</AlertTitle>
        <Typography variant="body2" sx={{ mb: 2 }}>
          The page could not be displayed. This has been logged.
        </Typography>
        {/* The digest is a hash, not content — safe to show, and it is what
            lets an operator find the matching server-side log line. */}
        {error.digest ? (
          <Typography
            variant="caption"
            sx={{ display: "block", mb: 2, color: "text.secondary", fontFamily: "ui-monospace, monospace" }}
          >
            Reference: {error.digest}
          </Typography>
        ) : null}
        <Button variant="contained" size="small" onClick={reset} sx={{ cursor: "pointer" }}>
          Try again
        </Button>
      </Alert>
    </Container>
  );
}
