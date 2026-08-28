"use client";

import { useState } from "react";

import ContentCopyRoundedIcon from "@mui/icons-material/ContentCopyRounded";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";

/**
 * The one and only place a sign-in link is ever displayed.
 *
 * THE LINK IS A CREDENTIAL. Whoever opens it becomes the person it was issued
 * for. It is therefore never written to the audit log, never logged to a
 * console, never put in an error message, and never persisted anywhere — it
 * exists in this component's props for as long as the dialog is open and is
 * gone when it closes. That is why the warning below says single-use rather
 * than merely "shown once": "shown once" describes this dialog's behaviour,
 * while single-use describes the token, and it is the token property that
 * decides how carefully the link has to be handled on its way to the person.
 *
 * SELECTABLE TEXT, NOT JUST A COPY BUTTON. `navigator.clipboard` needs a secure
 * context and can be refused by permissions policy; a copy button that silently
 * fails would leave the administrator with no way to retrieve a link they
 * cannot get back. The read-only field is the fallback that always works.
 */
export default function LinkRevealDialog({
  open,
  link,
  email,
  created,
  onClose,
}: {
  open: boolean;
  link: string | null;
  email: string | null;
  /** True when this request created the account; false when it already existed. */
  created: boolean;
  onClose: () => void;
}) {
  // ONE tri-state, not two booleans. Two independent flags can both be true —
  // and were: the catch below set `copyFailed` without clearing `copied`, so a
  // successful copy followed by a failed one rendered the green and the red
  // alert at the same time.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopyState("copied");
    } catch {
      // Not a silent failure: the administrator needs to know to select the
      // text by hand, because there is no second chance at this link.
      setCopyState("failed");
    }
  }

  function close() {
    setCopyState("idle");
    onClose();
  }

  return (
    // DELIBERATE EXIT ONLY. The default Dialog closes on a backdrop click and
    // on Escape; here that would destroy the only copy of a link that cannot be
    // shown again, forcing the administrator to issue a new one and burn this
    // token. "Done" is the way out.
    <Dialog
      open={open}
      onClose={(_event, reason) => {
        if (reason === "backdropClick" || reason === "escapeKeyDown") return;
        close();
      }}
      fullWidth
      maxWidth="sm"
    >
      <DialogTitle>{created ? "Account created" : "Sign-in link ready"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText component="div">
            {created ? (
              <>
                <strong>{email}</strong> now has an account. Send them this link so they can choose
                a password.
              </>
            ) : (
              <>
                <strong>{email}</strong> already had an account. This link lets them set a new
                password.
              </>
            )}
          </DialogContentText>

          <Alert severity="warning">
            This link works <strong>once</strong>, and it is not shown again. Copy it now and send
            it to {email ?? "them"} directly — a chat message, a text, or in person. Anyone who
            opens it can sign in as them, so do not post it anywhere other people can read.
          </Alert>

          <TextField
            value={link ?? ""}
            label="Sign-in link"
            fullWidth
            multiline
            minRows={2}
            slotProps={{ htmlInput: { readOnly: true, "aria-label": "Sign-in link" } }}
            onFocus={(e) => e.target.select()}
          />

          {copyState === "copied" ? (
            <Alert severity="success">Copied to the clipboard.</Alert>
          ) : null}
          {copyState === "failed" ? (
            <Alert severity="error">
              Could not reach the clipboard. Select the link above and copy it manually.
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={copy} startIcon={<ContentCopyRoundedIcon />} variant="contained">
          Copy link
        </Button>
        <Button onClick={close}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
