"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { createClient } from "@/lib/supabase/client";
import { parseSignInFragment } from "@/lib/adminLink";
import { useIsHydrated } from "@/lib/useIsHydrated";

/**
 * The deliberate click that consumes a one-time sign-in token.
 *
 * WHY A BUTTON AND NOT AN EFFECT. The token is single-use: verifying it burns
 * it. Anything that fetches the URL without a person deciding to — a chat app
 * unfurling a preview, a mail scanner, a corporate link-rewriter, a browser
 * prefetching a hovered link — would consume it, and the actual recipient would
 * then be told their brand-new link had expired. That failure is invisible from
 * both ends: the administrator sees a link they just issued, the recipient sees
 * a dead one, and nothing explains the gap.
 *
 * So this component has NO effect that runs on mount. `verifyOtp` fires from
 * `onClick` and nowhere else. The same reasoning is why the route it lives on
 * does its work here rather than in a server component or a GET handler.
 *
 * THE TOKEN IS IN THE FRAGMENT, and is read here rather than on the server.
 * A query string is transmitted on every request and would put a single-use
 * credential into the hosting platform's access logs each time the link was
 * opened; a fragment never leaves the browser. That is why this component reads
 * `window.location.hash` in an effect instead of receiving a prop, and why the
 * page around it is inert.
 *
 * `token_hash` + `verifyOtp` also carries no PKCE verifier, which is what lets
 * this work in a browser that never saw the administrator's session. That is
 * the whole reason this route replaced the emailed-recovery-link flow: under
 * PKCE the verifier lives in the SENDER's browser storage, so a link an
 * administrator mailed to somebody else could not be exchanged by the person
 * who received it, and read as expired the moment it arrived.
 */
export default function ConfirmForm() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A fragment exists only in the browser, so reading it during the hydration
  // render would tear. `useIsHydrated` is this repo's answer to exactly that
  // question — and using it rather than `useEffect` + `setState` is not a style
  // choice: the react-hooks config rejects set-state-in-effect outright.
  //
  // Rendering nothing until hydration also avoids flashing the broken-link
  // message at somebody whose link is perfectly good.
  const hydrated = useIsHydrated();
  const link = hydrated ? parseSignInFragment(window.location.hash) : null;

  if (!hydrated) return null;

  // A malformed or hand-edited URL, or one whose fragment was stripped by a
  // client that rewrites links. Say what to do about it — the person holding
  // this link cannot fix it themselves, and the useful action is to ask whoever
  // sent it for another one.
  if (!link) {
    return (
      <Stack spacing={2}>
        <Typography variant="h6" component="h1">
          This link is incomplete
        </Typography>
        <Alert severity="warning">
          Some of the link is missing — it may have been cut short when it was copied or pasted. Ask
          whoever sent it to issue you a new one.
        </Alert>
      </Stack>
    );
  }

  const target = link;

  async function confirm() {
    setPending(true);
    setError(null);

    // Every failure mode reads the same to the person — expired, already used,
    // or wrong — and none is their fault or fixable by them. One honest message
    // with one useful next step beats guessing which.
    const unusable =
      "This link is no longer valid. It may have expired or already been used. Ask whoever sent it for a new one.";

    let verifyFailed: boolean;
    try {
      const { error: verifyError } = await createClient().auth.verifyOtp({
        token_hash: target.token,
        type: target.kind,
      });
      verifyFailed = Boolean(verifyError);
    } catch (cause) {
      // A THROW, not a returned error — a network failure or a GoTrue fault.
      // Without this the button stays disabled with nothing on screen, on the
      // one page where the token may already have been spent. Never leave the
      // person with no message and no way to retry.
      console.error("[basecamp] verifyOtp threw:", cause);
      setPending(false);
      setError("Could not reach the sign-in service. Check your connection and try again.");
      return;
    }

    if (verifyFailed) {
      setPending(false);
      setError(unusable);
      return;
    }

    // The session is now in cookies, so the password form and the server
    // components behind it see it the ordinary way. `refresh()` before
    // navigating so the server re-renders with that session rather than the
    // signed-out tree it cached a moment ago.
    router.refresh();
    router.push("/accept-invite");
  }

  return (
    <Stack spacing={2.5}>
      <Typography variant="h6" component="h1">
        {target.kind === "invite" ? "Welcome" : "Set a new password"}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {target.kind === "invite"
          ? "You have been given access. Continue to choose a password for your account."
          : "Continue to choose a new password for your account."}
      </Typography>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Button
        variant="contained"
        size="large"
        onClick={confirm}
        disabled={pending}
        startIcon={pending ? <CircularProgress size={16} color="inherit" /> : null}
      >
        {pending ? "Checking…" : "Continue"}
      </Button>

      <Typography variant="caption" color="text.secondary">
        This link works once. If you leave this page before setting a password, ask for a new link.
      </Typography>
    </Stack>
  );
}
