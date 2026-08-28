"use client";

import { useState } from "react";

import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { isEmailShaped } from "@/lib/adminLink";
import type { MemberType } from "@/types/admin";

/**
 * Add someone to this app: an address and a type, in one step.
 *
 * WHY THE TYPE IS REQUIRED RATHER THAN OPTIONAL. A person with no type has no
 * type grants, so they land in an app that shows them nothing — and the roster
 * renders them as "No type", which reads as an incomplete task somebody has to
 * come back and finish. Making it part of creating the person means the link
 * you hand over is a link to something.
 *
 * A SINGLE SELECT, because `basecamp.members` carries UNIQUE (user_id): a
 * person holds exactly one type. 0004 asserts that constraint still exists
 * precisely so this control cannot quietly become the wrong shape.
 *
 * The email check here is a courtesy, not a gate. GoTrue is the authority on
 * what it accepts and the route revalidates; this only saves a round trip on an
 * obvious typo.
 */
export default function AddPersonDialog({
  open,
  memberTypes,
  pending,
  onClose,
  onSubmit,
}: {
  open: boolean;
  memberTypes: MemberType[];
  pending: boolean;
  onClose: () => void;
  onSubmit: (email: string, memberTypeId: string) => Promise<boolean>;
}) {
  const [email, setEmail] = useState("");
  const [memberTypeId, setMemberTypeId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setEmail("");
    setMemberTypeId("");
    setError(null);
  }

  function close() {
    if (pending) return;
    reset();
    onClose();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!isEmailShaped(email)) {
      setError("Enter a valid email address.");
      return;
    }
    if (!memberTypeId) {
      setError("Choose a type.");
      return;
    }

    // The parent owns the request and the link dialog that follows it. Clearing
    // the fields only on success keeps a failed attempt editable — retyping an
    // address because the network blipped is exactly the friction that makes
    // people paste it somewhere unsafe to keep it handy.
    const ok = await onSubmit(email, memberTypeId);
    if (ok) reset();
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>Add a person</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              Creates their account and gives you a link to send them. If the address already has an
              account on this project, they are given access instead and no link is issued — they
              sign in with the password they already have. Nothing is emailed either way.
            </Typography>

            {error ? <Alert severity="error">{error}</Alert> : null}

            <TextField
              label="Email address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="off"
              autoFocus
              fullWidth
              required
              disabled={pending}
            />

            <TextField
              select
              label="Type"
              value={memberTypeId}
              onChange={(e) => setMemberTypeId(e.target.value)}
              helperText="What this type can see is set on the Types tab."
              fullWidth
              required
              disabled={pending}
            >
              {memberTypes.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name}
                </MenuItem>
              ))}
            </TextField>

            {memberTypes.length === 0 ? (
              <Alert severity="warning">
                There are no types yet. Create one on the Types tab first — a person with no type
                sees nothing.
              </Alert>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={pending || memberTypes.length === 0}
            startIcon={pending ? <CircularProgress size={16} color="inherit" /> : null}
          >
            {pending ? "Adding…" : "Add person"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
