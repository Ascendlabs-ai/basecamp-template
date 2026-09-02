"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import UploadRoundedIcon from "@mui/icons-material/UploadRounded";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import Logo from "@/components/Logo";
import {
  ACCEPTED_LOGO_TYPES,
  BRANDING_BUCKET,
  displayNameProblem,
  logoFileProblem,
  logoObjectPath,
  publicLogoUrl,
  type Branding,
} from "@/lib/branding";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_URL } from "@/lib/supabase/env";

export default function BrandingAdmin({ initial }: { initial: Branding }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [current, setCurrent] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function chooseFile(file: File | null) {
    setError(null);
    if (!file) return;
    const problem = logoFileProblem(file);
    if (problem) {
      setSelectedFile(null);
      setError(problem);
      if (fileInput.current) fileInput.current.value = "";
      return;
    }
    setSelectedFile(file);
    setRemoveLogo(false);
  }

  async function save() {
    setError(null);
    setNotice(null);

    const nameProblem = displayNameProblem(displayName);
    if (nameProblem) {
      setError(nameProblem);
      return;
    }
    if (selectedFile) {
      const fileProblem = logoFileProblem(selectedFile);
      if (fileProblem) {
        setError(fileProblem);
        return;
      }
    }

    setPending(true);
    const supabase = createClient();
    let uploadedPath: string | null = null;

    try {
      if (selectedFile) {
        uploadedPath = logoObjectPath(selectedFile.type, crypto.randomUUID());
        if (!uploadedPath) throw new Error("Choose a PNG, JPEG, or WebP image.");
        const { error: uploadError } = await supabase.storage
          .from(BRANDING_BUCKET)
          .upload(uploadedPath, selectedFile, {
            cacheControl: "31536000",
            contentType: selectedFile.type,
            upsert: false,
          });
        if (uploadError) throw new Error(`The logo could not be uploaded: ${uploadError.message}`);
      }

      const nextPath = uploadedPath ?? (removeLogo ? null : current.logoPath);
      const { error: saveError } = await supabase.rpc("configure_branding", {
        p_display_name: displayName.trim(),
        p_logo_path: nextPath,
      });

      if (saveError) {
        if (uploadedPath) await supabase.storage.from(BRANDING_BUCKET).remove([uploadedPath]);
        throw new Error(`Branding was not saved: ${saveError.message}`);
      }

      let cleanupWarning = false;
      if (current.logoPath && current.logoPath !== nextPath) {
        const { error: removeError } = await supabase.storage
          .from(BRANDING_BUCKET)
          .remove([current.logoPath]);
        cleanupWarning = Boolean(removeError);
      }

      const saved: Branding = {
        displayName: displayName.trim(),
        logoPath: nextPath,
        logoUrl: publicLogoUrl(SUPABASE_URL, nextPath),
      };
      setCurrent(saved);
      setDisplayName(saved.displayName);
      setSelectedFile(null);
      setRemoveLogo(false);
      if (fileInput.current) fileInput.current.value = "";
      setNotice(
        cleanupWarning
          ? "Branding was saved. The previous unused logo could not be removed from storage."
          : "Branding was saved.",
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Branding could not be saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack spacing={2.5}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity={notice.includes("could not") ? "warning" : "success"}>{notice}</Alert> : null}

      <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 }, border: 1, borderColor: "divider" }}>
        <Stack spacing={2.5}>
          <Box>
            <Typography component="h2" variant="h6" sx={{ fontWeight: 700 }}>
              Basecamp identity
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              The saved name and logo appear in the sidebar, sign-in screens, and browser page titles.
            </Typography>
          </Box>

          <TextField
            label="Display name"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            required
            inputProps={{ maxLength: 100 }}
            helperText={`${displayName.trim().length}/100 characters`}
            disabled={pending}
            fullWidth
          />

          <Stack spacing={1.5}>
            <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Logo</Typography>
            <Box sx={{ p: 2, borderRadius: 2, backgroundColor: "shell.bg", alignSelf: "flex-start" }}>
              <Logo variant="secondary" height={32} on="dark" branding={removeLogo ? { ...current, logoPath: null, logoUrl: null, displayName: displayName.trim() || current.displayName } : { ...current, displayName: displayName.trim() || current.displayName }} />
            </Box>
            {selectedFile ? (
              <Typography variant="body2" color="text.secondary">
                Ready to upload: {selectedFile.name} ({Math.ceil(selectedFile.size / 1024)} KB)
              </Typography>
            ) : removeLogo ? (
              <Typography variant="body2" color="text.secondary">
                The custom logo will be removed. The default Basecamp mark will be used instead.
              </Typography>
            ) : null}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
              <Button component="label" variant="outlined" startIcon={<UploadRoundedIcon />} disabled={pending}>
                {current.logoPath ? "Replace logo" : "Upload logo"}
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept={ACCEPTED_LOGO_TYPES.join(",")}
                  onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
                />
              </Button>
              {current.logoPath || selectedFile ? (
                <Button
                  color="error"
                  startIcon={<DeleteOutlineRoundedIcon />}
                  disabled={pending}
                  onClick={() => {
                    setSelectedFile(null);
                    setRemoveLogo(Boolean(current.logoPath));
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  Remove logo
                </Button>
              ) : null}
            </Stack>
            <Typography variant="caption" color="text.secondary">
              PNG, JPEG, or WebP. Maximum 2 MB. The logo is public because it appears before sign-in.
            </Typography>
          </Stack>

          <Box>
            <Button
              variant="contained"
              onClick={() => void save()}
              disabled={pending}
              startIcon={pending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {pending ? "Saving…" : "Save branding"}
            </Button>
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}
