"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { createClient } from "@/lib/supabase/client";
import { PASSWORD_HINT, checkPassword } from "@/lib/passwordPolicy";

/**
 * Choose a password, using the session /auth/confirm just established.
 *
 * WHY THIS IS A SEPARATE PAGE FROM /auth/confirm. The token is consumed by the
 * click on that page. If the password form lived there too, every re-render,
 * back-navigation or refresh would sit on a URL whose token is already spent —
 * and a person who mistypes their confirmation and reloads would find the page
 * dead. Splitting them means the token is spent exactly once, and everything
 * after it runs on an ordinary session that survives a reload.
 *
 * NO TOKEN IS IN THIS URL, which is why it is safe to land on, bookmark, or
 * reload.
 *
 * THIS PAGE DOES NOT REAUTHENTICATE, and cannot meaningfully. Any live session
 * can already call `updateUser({ password })` from a browser console, so a
 * check here would be a lock on a door with no wall. The real control is the
 * project's **Secure password change** setting, which makes GoTrue itself
 * require a recent login — listed under Pending manual steps in issues.md.
 */
export default function AcceptInviteForm() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Confirm there IS a session before showing a form that needs one. Landing
  // here directly — a bookmark, a reload after signing out, a link shared by
  // mistake — is an ordinary thing to do and deserves an explanation rather
  // than an "Auth session missing" error from updateUser.
  useEffect(() => {
    let alive = true;
    createClient()
      .auth.getUser()
      .then(
        ({ data }) => {
          if (!alive) return;
          setEmail(data.user?.email ?? null);
          setChecking(false);
        },
        // A REJECTION HANDLER, not an omission. getUser() rethrows anything that
        // is not an AuthError, and without this `checking` stays true forever —
        // a permanent spinner on the one page whose whole purpose is setting a
        // password, reached by a link that has ALREADY been spent. The person
        // cannot retry and cannot go back. Falling through to the "nothing to
        // set up here" branch at least tells them what to ask for.
        (cause) => {
          if (!alive) return;
          console.error("[basecamp] getUser failed on /accept-invite:", cause);
          setEmail(null);
          setChecking(false);
        },
      );
    return () => {
      alive = false;
    };
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const rejected = checkPassword(password, confirm);
    if (rejected) {
      setError(rejected);
      return;
    }

    setPending(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    if (updateError) {
      setPending(false);
      setError(updateError.message);
      return;
    }

    // Straight into the app. The session from /auth/confirm is already the
    // app's real cookie session, so there is nothing to re-establish: the whole
    // flow runs on one session store, rather than setting a password against a
    // throwaway in-memory session and then signing in with it.
    router.refresh();
    router.push("/");
  }

  if (checking) {
    return (
      <Stack spacing={2} alignItems="center" sx={{ py: 3 }}>
        <CircularProgress size={22} />
      </Stack>
    );
  }

  if (!email) {
    return (
      <Stack spacing={2}>
        <Typography variant="h6" component="h1">
          Nothing to set up here
        </Typography>
        <Alert severity="info">
          This page needs a valid sign-in link. Open the link you were sent, or ask whoever sent it
          for a new one.
        </Alert>
        <Button variant="text" onClick={() => router.push("/login")}>
          Go to sign in
        </Button>
      </Stack>
    );
  }

  return (
    <Stack component="form" onSubmit={submit} spacing={2.5}>
      <Typography variant="h6" component="h1">
        Choose a password
      </Typography>
      {/* Whose account this is, always shown. A password form that does not say
          whose password it changes is one misread link away from changing the
          wrong one — the same reasoning as ResetPasswordForm. */}
      <Typography variant="body2" color="text.secondary">
        For {email}
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <TextField
        label="New password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        helperText={PASSWORD_HINT}
        fullWidth
        required
      />
      <TextField
        label="Confirm password"
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        fullWidth
        required
      />

      <Button
        type="submit"
        variant="contained"
        size="large"
        disabled={pending}
        startIcon={pending ? <CircularProgress size={16} color="inherit" /> : null}
      >
        {pending ? "Saving…" : "Save and continue"}
      </Button>
    </Stack>
  );
}
