"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { createClient } from "@/lib/supabase/client";
import { createRecoveryReceiver } from "@/lib/supabase/recovery";

/**
 * Set a new password after following a recovery link.
 *
 * THE TOKEN NEVER REACHES THE SERVER. The link carries it in the URL fragment
 * (`#access_token=…&type=recovery`), which browsers do not send to any server.
 * A dedicated IMPLICIT-flow client parses it and establishes a short-lived
 * recovery session — see lib/supabase/recovery.ts for why it cannot be the
 * app's normal client (that one is PKCE, and the code verifier would be in the
 * administrator's browser, not the recipient's).
 *
 * That recovery session is NOT the app's session: it is not persisted. Once the
 * password is set, we sign in through the ordinary cookie client with the
 * password the person just chose, so the server components see a session the
 * normal way and there is only ever one session store.
 *
 * WHY THE WAIT MATTERS. `updateUser` on a page with no session fails with a
 * confusing "Auth session missing" error. Landing here directly — a bookmarked
 * URL, an expired link, a second click on a used one — is a normal thing for a
 * person to do, so it gets an explanation rather than a stack trace.
 */
const MIN_LENGTH = 8;

export default function ResetPasswordForm() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Whose password this link is for. Shown, always: a form that changes a
  // password without saying whose is one misread link away from changing the
  // wrong one.
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // One client for the lifetime of the page, created LAZILY.
  //
  // `useRef(createRecoveryReceiver())` would have evaluated its argument on
  // every render — a fresh GoTrueClient per keystroke, each running _initialize()
  // and tripping auth-js's "Multiple GoTrueClient instances detected" warning on
  // the one page you least want looking broken. Only the first is retained, so
  // it was waste and noise rather than a bug, but the lazy form is the correct
  // one and costs nothing.
  const recovery = useRef<ReturnType<typeof createRecoveryReceiver> | null>(null);
  if (recovery.current === null) recovery.current = createRecoveryReceiver();

  useEffect(() => {
    const supabase = recovery.current!;

    // Two paths to "ready", because the ordering is not guaranteed: the SDK may
    // have already consumed the fragment before this effect runs (in which case
    // the event has fired and will not fire again), or it may still be in
    // flight. Checking for an existing session covers the first; the listener
    // covers the second.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") {
        setTarget(session?.user?.email ?? null);
        setReady(true);
        setChecking(false);
      }
    });

    // `.catch` is not optional: an unhandled rejection here leaves `checking`
    // true forever, and the page sits on "Checking your link…" with no error.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data.session) {
          setTarget(data.session.user?.email ?? null);
          setReady(true);
        }
      })
      .catch((cause) => {
        console.error("[basecamp] recovery getSession failed:", cause);
      })
      .finally(() => setChecking(false));

    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }

    setPending(true);
    const supabase = recovery.current!;
    const { data: updated, error: updateError } = await supabase.auth.updateUser({ password });

    if (updateError) {
      // Surfaced rather than swallowed: unlike sign-in, this message carries no
      // account-enumeration risk — the visitor already proved they hold the
      // mailbox — and the real reason (too short, too common, link expired) is
      // what tells them what to do next.
      setError(updateError.message);
      setPending(false);
      return;
    }

    // The recovery session was deliberately not persisted, so it is not the
    // app's session. Sign in properly with the password just chosen — that
    // writes the cookie the server components read. If it fails for any reason
    // the password change still stands, so send them to /login rather than
    // leaving them on a dead page.
    const email = updated.user?.email;
    if (email) {
      const app = createClient();
      const { error: signInError } = await app.auth.signInWithPassword({ email, password });
      if (!signInError) {
        setDone(true);
        setPending(false);
        router.replace("/");
        router.refresh();
        return;
      }
      console.error("[basecamp] post-reset sign-in failed:", signInError.message);
    }

    setDone(true);
    setPending(false);
    router.replace("/login");
  }

  if (checking) {
    return (
      <Stack spacing={1.5} alignItems="center" sx={{ py: 3 }}>
        <CircularProgress size={22} />
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Checking your link…
        </Typography>
      </Stack>
    );
  }

  if (!ready) {
    return (
      <Stack spacing={2}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700 }}>
          This link cannot be used
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
          Password links expire, and each one works only once. Ask an administrator
          to send you a new one, then open it from your email without editing the
          address.
        </Typography>
        <Button href="/login" variant="outlined" size="large" sx={{ alignSelf: "flex-start" }}>
          Back to sign in
        </Button>
      </Stack>
    );
  }

  if (done) {
    return (
      <Stack spacing={1.5}>
        <Typography variant="h6" component="h1" sx={{ fontWeight: 700 }}>
          Password set
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Signing you in…
        </Typography>
      </Stack>
    );
  }

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700, mb: 0.5 }}>
            Set your password
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {target ? (
              <>
                For <strong>{target}</strong>. Choose something only you know — nobody
                else can see it, including whoever sent you the link.
              </>
            ) : (
              "Choose something only you know. Nobody else can see it, including whoever sent you the link."
            )}
          </Typography>
        </Box>

        {error ? <Alert severity="error">{error}</Alert> : null}

        <TextField
          label="New password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          required
          fullWidth
          disabled={pending}
          helperText={`At least ${MIN_LENGTH} characters.`}
        />

        <TextField
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          autoComplete="new-password"
          required
          fullWidth
          disabled={pending}
        />

        <Button
          type="submit"
          variant="contained"
          size="large"
          disabled={pending || !password || !confirm}
          startIcon={pending ? <CircularProgress size={18} color="inherit" /> : null}
          sx={{ cursor: "pointer", py: 1.25 }}
        >
          {pending ? "Saving…" : "Set password"}
        </Button>
      </Stack>
    </Box>
  );
}
