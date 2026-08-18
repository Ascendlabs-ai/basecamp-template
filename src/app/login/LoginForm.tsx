"use client";

import { useState } from "react";

import { useRouter, useSearchParams } from "next/navigation";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { sameOriginPath } from "@/lib/safeRedirect";
import { classifySignInError } from "@/lib/signInError";
import { createClient } from "@/lib/supabase/client";
import { APP_NAME, CATALOG_TAGLINE } from "@/lib/brand";

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Deliberately not surfacing Supabase's raw message. It distinguishes
      // "user not found" from "wrong password", which turns this form into an
      // account-enumeration oracle on a Supabase project shared with client-facing apps.
      //
      // But it does NOT follow that every failure is the user's. An invalid or
      // missing anon key answers 401, and this form used to report that as the
      // email and password being wrong — sending the person to reset a password
      // that was always correct, then to delete and recreate accounts until the
      // project's email rate limit stopped them. `classifySignInError` splits
      // the two: what you can fix by typing something else, and what you
      // cannot. Both messages are the same for every caller, so neither
      // discloses whether an account exists.
      const failure = classifySignInError(signInError);
      // Server-side too. A configuration failure is invisible in the browser
      // console of the person it happens to, and it is the one an operator
      // needs to see.
      if (failure.kind === "configuration") {
        console.error(
          "[basecamp] sign-in configuration failure:",
          signInError.status,
          signInError.code,
          signInError.message,
        );
      }
      setError(failure.message);
      setPending(false);
      return;
    }

    const safeNext = sameOriginPath(searchParams.get("next"));

    // refresh() so the Server Component tree re-runs with the new session
    // cookie; push() alone can render the destination from a stale cache.
    router.replace(safeNext);
    router.refresh();
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 0.5 }}>
            Sign in to {APP_NAME}
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {CATALOG_TAGLINE}
          </Typography>
        </Box>

        {error ? (
          <Alert severity="error">
            {error}
          </Alert>
        ) : null}

        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          fullWidth
          disabled={pending}
        />

        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          fullWidth
          disabled={pending}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={pending || !email || !password}
          startIcon={
            pending ? <CircularProgress size={18} color="inherit" /> : null
          }
          sx={{ cursor: "pointer", py: 1.25 }}
        >
          {pending ? "Signing in…" : "Sign in"}
        </Button>

        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Accounts are issued by an administrator. There is no self sign-up.
        </Typography>
      </Stack>
    </Box>
  );
}
