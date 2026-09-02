"use client";

import CalendarTodayRoundedIcon from "@mui/icons-material/CalendarTodayRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DnsOutlinedIcon from "@mui/icons-material/DnsOutlined";
import GitHubIcon from "@mui/icons-material/GitHub";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import NorthEastRoundedIcon from "@mui/icons-material/NorthEastRounded";
import PersonOutlineRoundedIcon from "@mui/icons-material/PersonOutlineRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import type { CatalogEntry } from "@/types/catalog";

import StatusChip from "./StatusChip";
import { humanise } from "./entryMeta";

/** One labeled fact. The label is the quiet part; the value carries weight. */
function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start">
      <Box aria-hidden sx={{ color: "text.secondary", mt: 0.25, "& svg": { fontSize: 18 } }}>
        {icon}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="caption"
          component="dt"
          sx={{ color: "text.secondary", display: "block", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}
        >
          {label}
        </Typography>
        <Typography variant="body2" component="dd" sx={{ m: 0, color: "text.primary", fontWeight: 500 }}>
          {children}
        </Typography>
      </Box>
    </Stack>
  );
}

export default function EntryDetailPanel({
  entry,
  open,
  onClose,
  onExited,
}: {
  entry: CatalogEntry | null;
  open: boolean;
  onClose: () => void;
  /** Fires after the slide-out finishes — the caller clears `entry` here so the
   *  content stays rendered through the close animation. */
  onExited: () => void;
}) {
  const e = entry;

  const isLaunchable = e?.entry_type === "launchable" && Boolean(e.launch_url);
  const verified = e?.last_verified_at
    ? new Date(e.last_verified_at).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "never confirmed against a live source";

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      // Drawer traps focus and closes on Escape and backdrop click by default —
      // that is step 8's "closes on escape" and the keyboard-reachable panel,
      // for free and correctly, rather than hand-rolled.
      slotProps={{
        paper: {
          sx: {
            width: { xs: "100%", sm: 460 },
            maxWidth: "100%",
            p: { xs: 2.5, sm: 3 },
          },
        },
        // Clear the entry only after the panel has finished sliding out, so its
        // content does not vanish mid-animation.
        transition: { onExited },
      }}
    >
      {e ? (
        <Stack spacing={2.5} component="section" aria-label={`Details for ${e.display_name}`}>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6" component="h2" sx={{ fontWeight: 700, lineHeight: 1.25 }}>
                {e.display_name}
              </Typography>
              {e.technical_name && e.technical_name !== e.display_name ? (
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  }}
                >
                  {e.technical_name}
                </Typography>
              ) : null}
            </Box>
            <IconButton onClick={onClose} aria-label="Close details" size="small" edge="end">
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <StatusChip status={e.status} />
            <Chip
              size="small"
              variant="outlined"
              label={humanise(e.entry_type)}
              sx={{ textTransform: "capitalize", color: "text.secondary" }}
            />
          </Stack>

          {/* The primary action lives at the top of the panel too, so a
              keyboard user reaches it first and never has to scroll a long
              source note to launch. Distinct from opening detail — this leaves
              for the app itself. */}
          {isLaunchable ? (
            <Button
              component="a"
              href={e.launch_url as string}
              target="_blank"
              rel="noopener noreferrer"
              variant="contained"
              fullWidth
              endIcon={<NorthEastRoundedIcon />}
              sx={{ cursor: "pointer", py: 1.1 }}
            >
              Open {e.display_name}
            </Button>
          ) : null}

          <Typography variant="body2" sx={{ color: "text.primary", lineHeight: 1.7 }}>
            {e.description}
          </Typography>

          <Divider />

          <Box component="dl" sx={{ m: 0, display: "grid", gap: 2 }}>
            <Fact icon={<PersonOutlineRoundedIcon />} label="Owner">
              {e.owner}
            </Fact>
            <Fact icon={<PlayCircleOutlineRoundedIcon />} label="Trigger">
              <Box component="span" sx={{ textTransform: "capitalize" }}>
                {humanise(e.trigger_type)}
              </Box>
            </Fact>
            <Fact icon={<LockOutlinedIcon />} label="Auth boundary">
              <Box component="span" sx={{ textTransform: "capitalize" }}>
                {humanise(e.auth_boundary)}
              </Box>
            </Fact>
            <Fact icon={<DnsOutlinedIcon />} label="Host">
              <Box component="span" sx={{ textTransform: "capitalize" }}>
                {humanise(e.host)}
              </Box>
            </Fact>
            <Fact icon={<CalendarTodayRoundedIcon />} label="Last verified">
              {verified}
            </Fact>
          </Box>

          {e.source_of_truth_note?.trim() ? (
            <>
              <Divider />
              <Box>
                <Typography
                  variant="caption"
                  sx={{ color: "text.secondary", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600, display: "block", mb: 0.75 }}
                >
                  Source note
                </Typography>
                {/* Complete and unclamped — the browse surface only ever showed
                    a hint; the full provenance lives here. */}
                <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.65, whiteSpace: "pre-wrap" }}>
                  {e.source_of_truth_note.trim()}
                </Typography>
              </Box>
            </>
          ) : null}

          {e.repo_url || e.runbook_url ? (
            <>
              <Divider />
              <Stack direction="row" spacing={2.5} flexWrap="wrap" useFlexGap>
                {e.repo_url ? (
                  <Link
                    href={e.repo_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="body2"
                    underline="hover"
                    sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, cursor: "pointer", fontWeight: 600 }}
                  >
                    <GitHubIcon aria-hidden sx={{ fontSize: 16 }} />
                    {e.repo_url.replace(/^https?:\/\/github\.com\//, "")}
                  </Link>
                ) : null}
                {e.runbook_url ? (
                  <Link
                    href={e.runbook_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    variant="body2"
                    underline="hover"
                    sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, cursor: "pointer", fontWeight: 600 }}
                  >
                    <DescriptionOutlinedIcon aria-hidden sx={{ fontSize: 16 }} />
                    Runbook
                  </Link>
                ) : null}
              </Stack>
            </>
          ) : null}
        </Stack>
      ) : null}
    </Drawer>
  );
}
