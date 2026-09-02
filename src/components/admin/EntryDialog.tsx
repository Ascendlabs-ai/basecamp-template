"use client";

import { useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { categoryLabel } from "@/lib/adminAccess";
import { authModeLabel, parseRedirectUris, ssoReadiness } from "@/lib/appConfig";
import { categoryTree, type EntryDraft } from "@/lib/catalogAdmin";
import { NAV_GROUP_LABEL, NAV_GROUP_ORDER, type AdminCategory, type Person } from "@/types/admin";
import type { EntryStatus, EntryType } from "@/types/catalog";

const ENTRY_TYPES: Array<{ value: EntryType; label: string }> = [
  { value: "launchable", label: "Launchable app" },
  { value: "reference_only", label: "Reference only" },
  { value: "catalog_only", label: "Catalog only" },
];

const ENTRY_STATUSES: Array<{ value: EntryStatus; label: string }> = [
  { value: "active", label: "Active" },
  { value: "coming_soon", label: "Coming soon" },
  { value: "unverified", label: "Unverified" },
  { value: "retiring", label: "Retiring" },
  { value: "orphaned", label: "Orphaned" },
  { value: "wind_down", label: "Wind down" },
];

const HOSTS = ["vercel", "cloudflare", "supabase_edge", "launchd", "wordpress", "claude_artifact", "n8n", "none", "unknown"] as const;
const TRIGGERS = ["user", "cron", "slack", "webhook", "manual"] as const;

function optionLabel(value: string) {
  return value.split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

export default function EntryDialog({ open, mode, initial, categories, people, nextSortOrderFor, busy, onCancel, onSubmit }: {
  open: boolean;
  mode: "create" | "edit";
  initial: EntryDraft;
  categories: AdminCategory[];
  people: Person[];
  nextSortOrderFor: (categoryId: string) => number;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (draft: EntryDraft) => Promise<boolean>;
}) {
  const categoryNames = new Map(categories.map((category) => [category.id, { name: category.name }]));
  const [draft, setDraft] = useState(initial);
  const [seed, setSeed] = useState(initial);
  if (seed !== initial) {
    setSeed(initial);
    setDraft(initial);
  }

  function set<K extends keyof EntryDraft>(key: K, value: EntryDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  const readiness = ssoReadiness(
    draft.auth_mode,
    draft.auth_mode === "basecamp_sso"
      ? { entry_id: "draft", client_id: draft.oauth_client_id, redirect_uris: parseRedirectUris(draft.oauth_redirect_uris), enabled: draft.oauth_enabled }
      : null,
  );

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 700 }}>{mode === "create" ? "Add an app" : "Configure app"}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pt: 0.5 }}>
          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 13, fontWeight: 700 }}>Catalog details</Typography>
            <TextField autoFocus size="small" label="App name" value={draft.display_name} onChange={(event) => set("display_name", event.target.value)} required fullWidth />
            <TextField size="small" label="Description" value={draft.description} onChange={(event) => set("description", event.target.value)} multiline minRows={2} required helperText="Explain what the app is for so the catalog record is complete." fullWidth />
            <TextField size="small" label="Owner" value={draft.owner} onChange={(event) => set("owner", event.target.value)} required placeholder="Person, team, or email" fullWidth />
          </Stack>

          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 13, fontWeight: 700 }}>Classification and location</Typography>
          <TextField
            select size="small" label="Category" value={draft.category_id} required fullWidth
            onChange={(event) => {
              const categoryId = event.target.value;
              setDraft((current) => ({ ...current, category_id: categoryId, sort_order: mode === "create" ? nextSortOrderFor(categoryId) : current.sort_order }));
            }}
          >
            {categoryTree(categories).flatMap(({ category, children }) => [
              <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>,
              ...children.map((child) => <MenuItem key={child.id} value={child.id} sx={{ pl: 4 }}>{categoryLabel(child, categoryNames)}</MenuItem>),
            ])}
          </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField select size="small" label="Entry type" value={draft.entry_type} onChange={(event) => {
                const entryType = event.target.value as EntryType;
                setDraft((current) => ({ ...current, entry_type: entryType, nav_group: entryType === "launchable" ? current.nav_group : "" }));
              }} fullWidth>
                {ENTRY_TYPES.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Catalog status" value={draft.status} onChange={(event) => set("status", event.target.value as EntryStatus)} fullWidth>
                {ENTRY_STATUSES.map((option) => <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>)}
              </TextField>
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField select size="small" label="Hosting" value={draft.host} onChange={(event) => set("host", event.target.value)} fullWidth>
                {HOSTS.map((value) => <MenuItem key={value} value={value}>{optionLabel(value)}</MenuItem>)}
              </TextField>
              <TextField select size="small" label="Trigger" value={draft.trigger_type} onChange={(event) => set("trigger_type", event.target.value)} fullWidth>
                {TRIGGERS.map((value) => <MenuItem key={value} value={value}>{optionLabel(value)}</MenuItem>)}
              </TextField>
            </Stack>
            {draft.entry_type === "launchable" ? (
              <TextField select size="small" label="Sidebar group" value={draft.nav_group} onChange={(event) => set("nav_group", event.target.value as EntryDraft["nav_group"])} helperText="Optional. This controls where the app appears in the launcher sidebar." fullWidth>
                <MenuItem value="">Not shown in the sidebar</MenuItem>
                {NAV_GROUP_ORDER.map((value) => <MenuItem key={value} value={value}>{NAV_GROUP_LABEL[value]}</MenuItem>)}
              </TextField>
            ) : null}
          </Stack>

          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 13, fontWeight: 700 }}>Links and source record</Typography>
            <TextField size="small" label="App URL" value={draft.launch_url} onChange={(event) => set("launch_url", event.target.value)} placeholder="https://…" required={draft.entry_type === "launchable"} helperText={draft.entry_type === "launchable" ? "Required for a launchable app." : "Optional for this entry type."} fullWidth />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField size="small" label="Repository URL" value={draft.repo_url} onChange={(event) => set("repo_url", event.target.value)} placeholder="https://…" fullWidth />
              <TextField size="small" label="Runbook URL" value={draft.runbook_url} onChange={(event) => set("runbook_url", event.target.value)} placeholder="https://…" fullWidth />
            </Stack>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField size="small" label="Technical name" value={draft.technical_name} onChange={(event) => set("technical_name", event.target.value)} fullWidth />
              <TextField size="small" type="number" label="Sort position" value={draft.sort_order} onChange={(event) => set("sort_order", Number(event.target.value))} fullWidth />
            </Stack>
            <TextField size="small" label="Source-of-truth note" value={draft.source_of_truth_note} onChange={(event) => set("source_of_truth_note", event.target.value)} multiline minRows={2} fullWidth />
          </Stack>

          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 13, fontWeight: 700 }}>Availability and access</Typography>
            <FormControlLabel control={<Switch checked={draft.is_active} onChange={(event) => set("is_active", event.target.checked)} />} label="Visible and available to the team" />

          <TextField select size="small" label="Who can use this app" value={draft.access_mode} onChange={(event) => set("access_mode", event.target.value as EntryDraft["access_mode"])} fullWidth>
            <MenuItem value="everyone">Everyone on the team</MenuItem>
            <MenuItem value="selected">Selected people or granted member types</MenuItem>
          </TextField>
          {draft.access_mode === "selected" ? (
            <Stack spacing={0.25} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.25 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 700, color: "text.secondary", mb: 0.5 }}>People with access</Typography>
              {people.map((person) => (
                <FormControlLabel key={person.id} label={person.email} control={
                  <Checkbox
                    size="small"
                    checked={draft.selected_user_ids.includes(person.id)}
                    onChange={(event) => set("selected_user_ids", event.target.checked ? [...draft.selected_user_ids, person.id] : draft.selected_user_ids.filter((id) => id !== person.id))}
                  />
                } />
              ))}
              {people.length === 0 ? <Typography variant="body2" color="text.secondary">Add team members before selecting individual access.</Typography> : null}
            </Stack>
          ) : null}
          </Stack>

          <Stack spacing={1.5}>
            <Typography component="h2" sx={{ fontSize: 13, fontWeight: 700 }}>Authentication</Typography>
          <TextField select size="small" label="Sign-in behavior" value={draft.auth_mode} onChange={(event) => set("auth_mode", event.target.value as EntryDraft["auth_mode"])} fullWidth>
            {(["link_only", "external_sign_in", "basecamp_sso"] as const).map((modeOption) => <MenuItem key={modeOption} value={modeOption}>{authModeLabel(modeOption)}</MenuItem>)}
          </TextField>
          {draft.auth_mode === "basecamp_sso" ? (
            <Stack spacing={1.5} sx={{ border: 1, borderColor: "divider", borderRadius: 2, p: 1.5 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700 }}>Basecamp SSO configuration</Typography>
              <TextField size="small" label="Supabase OAuth client ID" value={draft.oauth_client_id} onChange={(event) => set("oauth_client_id", event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" fullWidth required />
              <TextField size="small" label="Exact redirect URIs" value={draft.oauth_redirect_uris} onChange={(event) => set("oauth_redirect_uris", event.target.value)} placeholder="https://app.example.org/auth/callback" helperText="One URI per line. HTTPS is required except for localhost development." multiline minRows={2} fullWidth required />
              <FormControlLabel control={<Switch checked={draft.oauth_enabled} onChange={(event) => set("oauth_enabled", event.target.checked)} />} label="OAuth client mapping enabled" />
              <Alert severity={readiness === "ready" ? "success" : "warning"}>
                {readiness === "ready" ? "The client mapping is complete. Basecamp will still enforce team access during token issuance." : "This app remains unavailable until its OAuth client ID and exact redirect URI are valid."}
              </Alert>
            </Stack>
          ) : null}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="contained" disabled={busy} onClick={() => void onSubmit(draft)} startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}>
          {mode === "create" ? "Add app" : "Save changes"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
