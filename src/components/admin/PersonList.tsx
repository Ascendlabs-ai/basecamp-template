"use client";

import { useMemo, useState } from "react";

import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Box from "@mui/material/Box";
import InputAdornment from "@mui/material/InputAdornment";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import type { Member, MemberType, Person } from "@/types/admin";

import PersonAvatar from "./PersonAvatar";

/**
 * The staff list from the design's left column.
 *
 * Two departures, both forced by the data rather than chosen:
 *
 *  - **The sub-label is the person's TYPE and DEPARTMENT**, which is the design's
 *    "admin · marketing" line. It reads from `basecamp.members`, this app's own
 *    table — NOT from an external role table, which is shared across every app on
 *    this Supabase project and has no tenant column. Someone with no type shows "No type"
 *    rather than being left blank, because blank reads as a rendering bug and
 *    "no type" is a real, actionable state.
 *  - **A filter field.** A real directory may hold dozens of accounts, and it
 *    grows with every login on any app sharing the project. An unfiltered list
 *    of that size is already a scroll.
 *
 * Filtering is on email only, and is a plain substring — never on domain.
 * Email domain is not an authorization signal here (external staff are real
 * team members), so it must not become a sorting or grouping axis either.
 */
export default function PersonList({
  people,
  selectedId,
  counts,
  members,
  typeById,
  onSelect,
}: {
  people: Person[];
  selectedId: string;
  counts: Map<string, number>;
  members: Map<string, Member>;
  typeById: Map<string, MemberType>;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState("");

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return people;
    return people.filter((p) => p.email.toLowerCase().includes(needle));
  }, [people, filter]);

  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.25,
        border: 1,
        borderColor: "divider",
        position: { md: "sticky" },
        top: { md: 16 },
        maxHeight: { md: "calc(100dvh - 120px)" },
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <Typography
        component="h2"
        sx={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "text.secondary",
          px: 1.25,
          pt: 1,
          pb: 0.75,
        }}
      >
        People · {people.length}
      </Typography>

      <TextField
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter people"
        aria-label="Filter people by email"
        size="small"
        sx={{ mx: 0.5, mb: 1 }}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon sx={{ fontSize: 17, color: "text.secondary" }} />
              </InputAdornment>
            ),
          },
        }}
      />

      <Box
        component="ul"
        sx={{ listStyle: "none", m: 0, p: 0, overflowY: "auto", minHeight: 0, flex: 1 }}
      >
        {shown.map((p) => {
          const isSelected = p.id === selectedId;
          const count = counts.get(p.id) ?? 0;
          const member = members.get(p.id);
          const typeName = member ? (typeById.get(member.member_type_id)?.name ?? "Unknown type") : null;
          // "Staff · Marketing", or just the type when there is no department.
          const subLabel = typeName
            ? [typeName, member?.department].filter(Boolean).join(" · ")
            : "No type";
          return (
            <Box component="li" key={p.id}>
              <Box
                component="button"
                type="button"
                onClick={() => onSelect(p.id)}
                aria-pressed={isSelected}
                // The visible count is a bare digit; without this a screen
                // reader announced "someone@… 12" and never said 12 of what.
                aria-label={`${p.email}, ${subLabel}, ${count} ${count === 1 ? "entry" : "entries"} visible`}
                sx={(theme) => ({
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: 1.25,
                  px: 1.25,
                  py: 1.125,
                  minHeight: 44,
                  border: 0,
                  borderRadius: 2,
                  textAlign: "left",
                  font: "inherit",
                  cursor: "pointer",
                  backgroundColor: isSelected ? theme.palette.celestial.light : "transparent",
                  transition: theme.transitions.create(["background-color"], { duration: 150 }),
                  "&:hover": {
                    backgroundColor: isSelected
                      ? theme.palette.celestial.light
                      : theme.palette.action.hover,
                  },
                  "&:focus-visible": {
                    outline: `3px solid ${theme.palette.primary.main}`,
                    outlineOffset: -2,
                  },
                })}
              >
                <PersonAvatar email={p.email} selected={isSelected} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    title={p.email}
                    sx={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: "text.primary",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.email}
                  </Typography>
                  {/* The design's type · department line. aria-hidden because
                      the button's own label already reads it out; leaving it
                      exposed makes a screen reader say it twice. */}
                  <Typography
                    aria-hidden
                    sx={{
                      fontSize: 10.5,
                      color: member ? "text.secondary" : "text.disabled",
                      fontStyle: member ? "normal" : "italic",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {subLabel}
                  </Typography>
                </Box>
                <Typography
                  aria-hidden
                  sx={{
                    flexShrink: 0,
                    fontSize: 10.5,
                    fontWeight: isSelected ? 600 : 400,
                    // text.primary (15.1:1 on celestial.light), not
                    // primary.dark (3.77:1 — under AA at this 10.5px size).
                    color: isSelected ? "text.primary" : "text.secondary",
                  }}
                >
                  {count}
                </Typography>
              </Box>
            </Box>
          );
        })}

        {shown.length === 0 ? (
          <Typography sx={{ px: 1.25, py: 2, fontSize: 12.5, color: "text.secondary" }}>
            No one matches “{filter.trim()}”.
          </Typography>
        ) : null}
      </Box>
    </Paper>
  );
}
