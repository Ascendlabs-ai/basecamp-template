"use client";

import { useMemo, useState } from "react";

import AddRoundedIcon from "@mui/icons-material/AddRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import LockRoundedIcon from "@mui/icons-material/LockRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

import {
  CREATE_TYPE_KEY,
  deleteTypeKey,
  indexTypeGrants,
  grantKey,
  typeGrantKey,
} from "@/lib/adminAccess";
import type { GrantCategory, Member, MemberType, ToggleTarget, TypeGrant } from "@/types/admin";

/**
 * Admin · Access · Types — what each type can see, and who holds it.
 *
 * This is the view the whole rebuild is for. Per-person-per-entry could not
 * answer "what does an external client see"; a type is that answer written
 * once, and this is where it gets written.
 *
 * Beyond the handoff, which predates user types. It reuses the handoff's own
 * vocabulary — the card, the section header, the 36×20 switch, the grant grid —
 * so it reads as part of the same screen rather than a bolted-on third thing.
 *
 * System types cannot be deleted. The database refuses it with a trigger; this
 * shows a lock instead of a delete button so the refusal is visible before you
 * click, not only after.
 */
export default function TypesAdmin({
  memberTypes,
  categories,
  typeGrants,
  members,
  pending,
  onToggleTypeGrant,
  onCreateType,
  onDeleteType,
}: {
  memberTypes: MemberType[];
  categories: GrantCategory[];
  typeGrants: TypeGrant[];
  members: Member[];
  pending: Set<string>;
  onToggleTypeGrant: (typeId: string, target: ToggleTarget) => void;
  onCreateType: (name: string, description: string | null) => Promise<boolean>;
  onDeleteType: (typeId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string>(memberTypes[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const typeGrantIndex = useMemo(() => indexTypeGrants(typeGrants), [typeGrants]);

  // How many people hold each type — derived, and the number that decides
  // whether a delete can succeed at all (the FK is ON DELETE RESTRICT).
  const holdersByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of members) {
      counts.set(m.member_type_id, (counts.get(m.member_type_id) ?? 0) + 1);
    }
    return counts;
  }, [members]);

  const selected = memberTypes.find((t) => t.id === selectedId) ?? memberTypes[0];

  const grantedCount = useMemo(() => {
    if (!selected) return 0;
    let n = 0;
    for (const cat of categories) {
      const wholeCategory = typeGrantIndex.has(grantKey(selected.id, { categoryId: cat.id }));
      for (const entry of cat.entries) {
        if (wholeCategory || typeGrantIndex.has(grantKey(selected.id, { entryId: entry.id }))) n += 1;
      }
    }
    return n;
  }, [selected, categories, typeGrantIndex]);

  const totalEntries = categories.reduce((n, c) => n + c.entries.length, 0);
  const createPending = pending.has(CREATE_TYPE_KEY);

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", md: "292px minmax(0, 1fr)" },
        gap: 2,
        alignItems: "start",
      }}
    >
      {/* ---- Type list + create ------------------------------------------- */}
      <Stack spacing={2} sx={{ position: { md: "sticky" }, top: { md: 16 } }}>
        <Paper elevation={0} sx={{ p: 1.25, border: 1, borderColor: "divider" }}>
          <Typography
            component="h2"
            sx={{
              fontSize: 11, fontWeight: 600, textTransform: "uppercase",
              letterSpacing: "0.5px", color: "text.secondary", px: 1.25, pt: 1, pb: 0.75,
            }}
          >
            Types · {memberTypes.length}
          </Typography>

          <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
            {memberTypes.map((t) => {
              const isSelected = t.id === selected?.id;
              const holders = holdersByType.get(t.id) ?? 0;
              const deletePending = pending.has(deleteTypeKey(t.id));
              return (
                <Box component="li" key={t.id}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={0.5}
                    sx={(theme) => ({
                      borderRadius: 2,
                      backgroundColor: isSelected ? theme.palette.celestial.light : "transparent",
                      "&:hover": {
                        backgroundColor: isSelected
                          ? theme.palette.celestial.light
                          : theme.palette.action.hover,
                      },
                    })}
                  >
                    <Box
                      component="button"
                      type="button"
                      onClick={() => setSelectedId(t.id)}
                      aria-pressed={isSelected}
                      aria-label={`${t.name}, ${holders} ${holders === 1 ? "person" : "people"}${t.is_system ? ", system type" : ""}`}
                      sx={(theme) => ({
                        flex: 1, minWidth: 0, display: "flex", flexDirection: "column",
                        alignItems: "flex-start", gap: 0.25,
                        px: 1.25, py: 1.125, minHeight: 44,
                        border: 0, background: "none", textAlign: "left", font: "inherit",
                        cursor: "pointer",
                        "&:focus-visible": {
                          outline: `3px solid ${theme.palette.primary.main}`, outlineOffset: -2,
                        },
                      })}
                    >
                      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ maxWidth: "100%" }}>
                        <Typography
                          sx={{
                            fontSize: 13, fontWeight: 600, color: "text.primary",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {t.name}
                        </Typography>
                        {t.is_system ? (
                          <LockRoundedIcon
                            aria-hidden
                            sx={{ fontSize: 12, color: "text.secondary", flexShrink: 0 }}
                          />
                        ) : null}
                      </Stack>
                      <Typography aria-hidden sx={{ fontSize: 10.5, color: "text.secondary" }}>
                        {holders} {holders === 1 ? "person" : "people"}
                      </Typography>
                    </Box>

                    {t.is_system ? (
                      // A lock, not a disabled bin. The database refuses this
                      // delete with a trigger; showing why up front beats an
                      // error after the click.
                      <Tooltip title="System type — cannot be deleted">
                        <Box component="span" sx={{ display: "inline-flex", px: 1 }}>
                          <LockRoundedIcon sx={{ fontSize: 16, color: "text.disabled" }} />
                        </Box>
                      </Tooltip>
                    ) : (
                      <Tooltip
                        title={
                          holders > 0
                            ? `${holders} ${holders === 1 ? "person holds" : "people hold"} this type — reassign them first`
                            : `Delete the ${t.name} type`
                        }
                      >
                        <Box component="span" sx={{ display: "inline-flex" }}>
                          <IconButton
                            size="small"
                            aria-label={`Delete the ${t.name} type`}
                            aria-disabled={holders > 0 || deletePending}
                            onClick={() => {
                              if (holders === 0 && !deletePending) onDeleteType(t.id);
                            }}
                            sx={{
                              cursor: holders > 0 ? "not-allowed" : "pointer",
                              color: holders > 0 ? "text.disabled" : "text.secondary",
                            }}
                          >
                            {deletePending ? (
                              <CircularProgress size={14} />
                            ) : (
                              <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                            )}
                          </IconButton>
                        </Box>
                      </Tooltip>
                    )}
                  </Stack>
                </Box>
              );
            })}
          </Box>
        </Paper>

        <Paper elevation={0} sx={{ p: 2, border: 1, borderColor: "divider" }}>
          <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, mb: 0.25 }}>
            New type
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 1.5 }}>
            The slug is derived from the name. Custom types can be deleted; the
            four system types cannot.
          </Typography>
          <Stack spacing={1.5}>
            <TextField
              size="small"
              label="Name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Contractor"
            />
            <TextField
              size="small"
              label="Description"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What this type is for"
              multiline
              minRows={2}
            />
            <Button
              variant="contained"
              size="small"
              startIcon={createPending ? <CircularProgress size={14} color="inherit" /> : <AddRoundedIcon />}
              disabled={newName.trim() === "" || createPending}
              onClick={() => {
                // Clear on SUCCESS only. Clearing straight after dispatch meant
                // a duplicate slug, an RLS refusal or a dropped connection left
                // the snackbar naming the problem and both fields already
                // blank, so the fix for a typo was to retype everything.
                void onCreateType(
                  newName,
                  newDescription.trim() === "" ? null : newDescription.trim(),
                ).then((created) => {
                  if (created) {
                    setNewName("");
                    setNewDescription("");
                  }
                });
              }}
              sx={{ cursor: newName.trim() === "" ? "default" : "pointer", alignSelf: "flex-start" }}
            >
              Create type
            </Button>
          </Stack>
        </Paper>
      </Stack>

      {/* ---- Selected type's default grants -------------------------------- */}
      {selected ? (
        <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: "divider" }}>
          <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 0.25 }}>
            <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, flex: 1, minWidth: 0 }}>
              What {selected.name} can see
            </Typography>
            {selected.is_system ? (
              <Chip
                size="small"
                icon={<LockRoundedIcon />}
                label="System type"
                sx={{
                  fontSize: 10.5, fontWeight: 600,
                  backgroundColor: "background.paper",
                  border: 1, borderColor: "divider", color: "text.primary",
                  "& .MuiChip-icon": { fontSize: 14, color: "text.secondary" },
                }}
              />
            ) : null}
          </Stack>
          <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 2 }}>
            {selected.description ? `${selected.description} ` : ""}
            <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
              {grantedCount} of {totalEntries} entries.
            </Box>{" "}
            Everyone holding this type sees these, plus anything granted to them
            individually.
          </Typography>

          <Stack spacing={2.5}>
            {categories.map((cat) => {
              const catKey = typeGrantKey(selected.id, { categoryId: cat.id });
              const catOn = typeGrantIndex.has(grantKey(selected.id, { categoryId: cat.id }));
              const catPending = pending.has(catKey);

              return (
                <Box key={cat.id} component="section" aria-labelledby={`type-cat-${cat.slug}`}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ pb: 0.75, mb: 1.25, borderBottom: 1, borderColor: "divider" }}
                  >
                    <Typography
                      id={`type-cat-${cat.slug}`}
                      component="h3"
                      sx={{
                        flex: 1, minWidth: 0, fontSize: 11, fontWeight: 700,
                        textTransform: "uppercase", letterSpacing: "0.5px", color: "text.secondary",
                      }}
                    >
                      {cat.name}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: "text.secondary" }}>Whole category</Typography>
                    <Box sx={{ width: 18, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                      {catPending ? <CircularProgress size={14} aria-label="Saving" /> : null}
                    </Box>
                    <Switch
                      size="small"
                      checked={catOn}
                      readOnly={catPending}
                      onChange={() => {
                        if (!catPending) onToggleTypeGrant(selected.id, { categoryId: cat.id });
                      }}
                      inputProps={{
                        "aria-label": `Grant the whole ${cat.name} category to the ${selected.name} type`,
                        "aria-disabled": catPending || undefined,
                        "aria-busy": catPending || undefined,
                      }}
                      sx={{ cursor: "pointer" }}
                    />
                  </Stack>

                  <Box
                    sx={{
                      display: "grid", gap: 1.25,
                      gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                    }}
                  >
                    {cat.entries.map((entry) => {
                      const direct = typeGrantIndex.has(grantKey(selected.id, { entryId: entry.id }));
                      const on = direct || catOn;
                      const entryPending = pending.has(typeGrantKey(selected.id, { entryId: entry.id }));
                      const viaCategory = catOn && !direct;

                      return (
                        <Stack
                          key={entry.id}
                          direction="row"
                          alignItems="center"
                          spacing={1}
                          sx={(theme) => ({
                            border: 1,
                            borderColor: on ? "primary.main" : "divider",
                            backgroundColor: on ? theme.palette.celestial.light : "transparent",
                            borderRadius: 2.5, px: 1.75, py: 1.25, minHeight: 44,
                            transition: theme.transitions.create(
                              ["background-color", "border-color"], { duration: 150 }),
                          })}
                        >
                          <Typography
                            title={entry.display_name}
                            sx={{
                              flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}
                          >
                            {entry.display_name}
                          </Typography>

                          {viaCategory ? (
                            <Chip
                              size="small"
                              icon={<CheckRoundedIcon />}
                              label={`Via ${cat.name}`}
                              sx={{
                                flexShrink: 0, maxWidth: 150, fontSize: 10.5, fontWeight: 600,
                                backgroundColor: "background.paper",
                                border: 1, borderColor: "primary.main", color: "text.primary",
                                "& .MuiChip-icon": { fontSize: 14, color: "primary.dark" },
                              }}
                            />
                          ) : (
                            <>
                              <Box sx={{ width: 18, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                                {entryPending ? <CircularProgress size={14} aria-label="Saving" /> : null}
                              </Box>
                              <Switch
                                size="small"
                                checked={direct}
                                readOnly={entryPending}
                                onChange={() => {
                                  if (!entryPending) onToggleTypeGrant(selected.id, { entryId: entry.id });
                                }}
                                inputProps={{
                                  "aria-label": `Grant ${entry.display_name} to the ${selected.name} type`,
                                  "aria-disabled": entryPending || undefined,
                                  "aria-busy": entryPending || undefined,
                                }}
                                sx={{ cursor: "pointer" }}
                              />
                            </>
                          )}
                        </Stack>
                      );
                    })}
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Paper>
      ) : null}
    </Box>
  );
}
