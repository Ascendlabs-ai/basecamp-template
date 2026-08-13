"use client";

import { useState } from "react";

import CheckRoundedIcon from "@mui/icons-material/CheckRounded";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  effectiveEntryCount,
  grantKey,
  memberKey,
  pendingKey,
  resolveAccess,
} from "@/lib/adminAccess";
import type {
  Grant,
  GrantCategory,
  Member,
  MemberType,
  Person,
  ToggleTarget,
  TypeGrant,
} from "@/types/admin";

const NO_TYPE = "__none__";

/**
 * "<person>'s access" — the day-to-day admin task, in two parts.
 *
 * THE TYPE comes first, because it is the efficient lever: setting someone's
 * type is one decision that grants a whole set, and the individual switches
 * below are the exceptions on top of it.
 *
 * INDIVIDUAL GRANTS below, at two levels because `access_grants` supports two:
 * a whole category, or one entry.
 *
 * Entries the person's TYPE already covers render as a "Via <type>" chip rather
 * than a switch, for the same reason category-inherited entries do: the switch
 * would control a row that changes nothing visible. Where they have BOTH an
 * individual grant and type coverage, the switch stays live but says so — that
 * is a real row an admin may want to clean up.
 */
export default function GrantsByPerson({
  person,
  categories,
  grantIndex,
  typeGrantIndex,
  memberIndex,
  memberTypes,
  pending,
  onToggle,
  onAssign,
}: {
  person: Person;
  categories: GrantCategory[];
  grantIndex: Map<string, Grant>;
  typeGrantIndex: Map<string, TypeGrant>;
  memberIndex: Map<string, Member>;
  memberTypes: MemberType[];
  pending: Set<string>;
  onToggle: (userId: string, target: ToggleTarget) => void;
  onAssign: (userId: string, typeId: string | null, department: string | null) => void;
}) {
  const member = memberIndex.get(person.id);
  const memberPending = pending.has(memberKey(person.id));

  // Draft state for the type/department form. Re-seeded when the selected
  // person changes or their saved row changes — a render-phase update keyed on
  // identity, not an effect, so the form never paints the previous person's
  // values for a frame.
  // The key must cover EVERY field the form seeds from, member_type_id
  // included: without it a type change arriving from the server on an unchanged
  // department left the dropdown showing the stale value while the helper text
  // under it read the new one.
  const seedKey = (m: typeof member) =>
    `${person.id}:${m?.id ?? ""}:${m?.member_type_id ?? ""}:${m?.department ?? ""}`;
  const [draftKey, setDraftKey] = useState(seedKey(member));
  const [typeId, setTypeId] = useState(member?.member_type_id ?? NO_TYPE);
  const [department, setDepartment] = useState(member?.department ?? "");
  const currentKey = seedKey(member);
  if (draftKey !== currentKey) {
    setDraftKey(currentKey);
    setTypeId(member?.member_type_id ?? NO_TYPE);
    setDepartment(member?.department ?? "");
  }

  const dirty =
    typeId !== (member?.member_type_id ?? NO_TYPE) ||
    department.trim() !== (member?.department ?? "");

  const totalVisible = effectiveEntryCount(
    grantIndex, typeGrantIndex, memberIndex, person.id, categories,
  );
  const totalEntries = categories.reduce((n, c) => n + c.entries.length, 0);
  const currentTypeName = member
    ? (memberTypes.find((t) => t.id === member.member_type_id)?.name ?? "Unknown type")
    : null;

  return (
    <Stack spacing={2} sx={{ minWidth: 0 }}>
      {/* ---- Type and department ------------------------------------------ */}
      <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: "divider" }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700 }}>
          {person.email}
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mt: 0.25, mb: 2 }}>
          A type grants a whole set at once. Individual grants below are the
          exceptions on top of it.{" "}
          <Box component="span" sx={{ fontWeight: 600, color: "text.primary" }}>
            {totalVisible} of {totalEntries} entries visible.
          </Box>
        </Typography>

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} alignItems={{ sm: "flex-start" }}>
          <TextField
            select
            size="small"
            label="Type"
            value={typeId}
            onChange={(e) => setTypeId(e.target.value)}
            sx={{ minWidth: 200 }}
            helperText={currentTypeName ? `Currently ${currentTypeName}` : "No type assigned"}
          >
            <MenuItem value={NO_TYPE}>
              <em>No type</em>
            </MenuItem>
            {memberTypes.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            size="small"
            label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="e.g. Marketing"
            sx={{ minWidth: 200 }}
            // Free text, like entries.owner. There is no departments table, and
            // an enum here would be a guess at an org chart this app does not own.
            helperText="Optional. Shown under their name."
          />

          <Button
            variant="contained"
            size="small"
            disabled={!dirty || memberPending}
            onClick={() =>
              onAssign(
                person.id,
                typeId === NO_TYPE ? null : typeId,
                department.trim() === "" ? null : department.trim(),
              )
            }
            startIcon={memberPending ? <CircularProgress size={14} color="inherit" /> : undefined}
            sx={{ cursor: dirty && !memberPending ? "pointer" : "default", mt: { sm: 0.25 } }}
          >
            {memberPending ? "Saving" : "Save"}
          </Button>
        </Stack>
      </Paper>

      {/* ---- Individual grants -------------------------------------------- */}
      <Paper elevation={0} sx={{ p: { xs: 2, sm: 2.5 }, border: 1, borderColor: "divider" }}>
        <Typography component="h2" sx={{ fontSize: 14, fontWeight: 700, mb: 0.25 }}>
          Individual access
        </Typography>
        <Typography sx={{ fontSize: 11.5, color: "text.secondary", mb: 2 }}>
          Granting a category covers every entry inside it, including ones added later.
        </Typography>

        <Stack spacing={2.5}>
          {categories.map((cat) => {
            const catKey = pendingKey(person.id, { categoryId: cat.id });
            const catOn = grantIndex.has(grantKey(person.id, { categoryId: cat.id }));
            const catPending = pending.has(catKey);

            return (
              <Box key={cat.id} component="section" aria-labelledby={`grant-cat-${cat.slug}`}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ pb: 0.75, mb: 1.25, borderBottom: 1, borderColor: "divider" }}
                >
                  <Typography
                    id={`grant-cat-${cat.slug}`}
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
                      if (!catPending) onToggle(person.id, { categoryId: cat.id });
                    }}
                    inputProps={{
                      "aria-label": `Grant the whole ${cat.name} category to ${person.email}`,
                      "aria-disabled": catPending || undefined,
                      "aria-busy": catPending || undefined,
                    }}
                    sx={{ cursor: "pointer" }}
                  />
                </Stack>

                <Box
                  sx={{
                    display: "grid",
                    gap: 1.25,
                    gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
                  }}
                >
                  {cat.entries.map((entry) => {
                    const access = resolveAccess(
                      grantIndex, typeGrantIndex, memberIndex, person.id, entry.id, cat.id,
                    );
                    const entryPending = pending.has(pendingKey(person.id, { entryId: entry.id }));
                    // Covered by the category grant, or by the type: either way
                    // the entry switch would control a row that changes nothing.
                    // `viaCategory` comes from resolveAccess rather than being
                    // recomputed here — that hand-rolled duplicate was the proof
                    // the field was missing from CellAccess, and its absence is
                    // what let the matrix ship without the same guard.
                    const inert = access.source === "type" || access.viaCategory;
                    const inertReason = access.source === "type" ? `Via ${currentTypeName}` : `Via ${cat.name}`;

                    return (
                      <Stack
                        key={entry.id}
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        sx={(theme) => ({
                          border: 1,
                          // Granted cells get a tinted fill and a brand border so
                          // "what does this person have" is answerable by scanning
                          // figure-vs-ground, not by reading every switch knob.
                          borderColor: access.source !== "none" ? "primary.main" : "divider",
                          backgroundColor:
                            access.source !== "none" ? theme.palette.celestial.light : "transparent",
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

                        {inert ? (
                          <Chip
                            size="small"
                            icon={<CheckRoundedIcon />}
                            label={inertReason}
                            sx={{
                              flexShrink: 0, maxWidth: 150, fontSize: 10.5, fontWeight: 600,
                              backgroundColor: "background.paper",
                              border: 1, borderColor: "primary.main", color: "text.primary",
                              "& .MuiChip-icon": { fontSize: 14, color: "primary.dark" },
                            }}
                          />
                        ) : (
                          <>
                            {/* Fixed-width slot so the switch does not shift
                                sideways when the spinner appears. */}
                            <Box sx={{ width: 18, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                              {entryPending ? <CircularProgress size={14} aria-label="Saving" /> : null}
                            </Box>
                            <Switch
                              size="small"
                              checked={access.source === "individual"}
                              readOnly={entryPending}
                              onChange={() => {
                                if (!entryPending) onToggle(person.id, { entryId: entry.id });
                              }}
                              inputProps={{
                                // Three cases, matching the matrix. An ON switch
                                // labelled "Grant …" states the wrong verb, and
                                // when a whole-category grant also covers this
                                // entry the click will not remove the person's
                                // access — the label has to say so BEFORE the
                                // click, not leave it to be discovered after.
                                "aria-label": access.alsoViaType
                                  ? `Revoke the individual grant on ${entry.display_name} for ${person.email}. Their type also grants it, so they keep access.`
                                  : access.source === "individual"
                                    ? grantIndex.has(grantKey(person.id, { categoryId: cat.id }))
                                      ? `Revoke the individual grant on ${entry.display_name} for ${person.email}. The grant on the whole ${cat.name} category also covers it, so they keep access.`
                                      : `Revoke ${entry.display_name} from ${person.email}`
                                    : `Grant ${entry.display_name} to ${person.email}`,
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
    </Stack>
  );
}
