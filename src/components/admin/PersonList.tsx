"use client";

import { useMemo, useState } from "react";

import MoreVertRoundedIcon from "@mui/icons-material/MoreVertRounded";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import { adminRoleKey, banKey, isBanned, signInLinkKey } from "@/lib/adminAccess";
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
  currentUserId,
  pending,
  onSelect,
  onReissueLink,
  onSetAdmin,
  onSetBanned,
}: {
  people: Person[];
  selectedId: string;
  counts: Map<string, number>;
  members: Map<string, Member>;
  typeById: Map<string, MemberType>;
  /** Whose session this is — used to refuse self-destructive actions. */
  currentUserId: string;
  pending: Set<string>;
  onSelect: (id: string) => void;
  onReissueLink: (person: Person) => void;
  onSetAdmin: (person: Person, isAdmin: boolean) => void;
  onSetBanned: (person: Person, banned: boolean) => void;
}) {
  const [filter, setFilter] = useState("");
  // Which row's overflow menu is open, and where to anchor it. One at a time,
  // so a single pair of state slots rather than per-row state.
  const [menuFor, setMenuFor] = useState<Person | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  function closeMenu() {
    setMenuFor(null);
    setAnchor(null);
  }

  // Named once, above the tree. An earlier version wrapped the menu body in an
  // inline lambda purely to narrow `menuFor`, which a plain ternary does just as
  // well — and having nowhere to name the derived values meant `isBanned` ran
  // four times and the self-check three times per render.
  const target = menuFor;
  const targetIsSelf = target?.id === currentUserId;
  const targetBanned = target ? isBanned(target) : false;

  /** Run a row action and close the menu — every item does both. */
  function act(run: () => void) {
    run();
    closeMenu();
  }

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
          // The ROSTER is the source of truth for which type someone holds —
          // `list_people()` reads it in the same query as the rest of this row,
          // so a person added a moment ago shows their type as soon as the
          // roster refreshes, without waiting for the separately-fetched
          // members index to catch up. `members` is still consulted for the
          // department, which only it carries.
          const typeId = p.member_type_id ?? member?.member_type_id ?? null;
          const typeName = typeId ? (typeById.get(typeId)?.name ?? "Unknown type") : null;
          // "Staff · Marketing", or just the type when there is no department.
          const subLabel = typeName
            ? [typeName, member?.department].filter(Boolean).join(" · ")
            : "No type";
          // "Joined 12 Mar 2026". The roster's job is answering who is on this
          // project and when they arrived, which an email alone cannot.
          //
          // Explicit locale AND timeZone, for the reason AuditLog.when() spells
          // out: this list is server-rendered and then hydrated, and an omitted
          // timeZone means "the runtime's" — UTC on the server, the visitor's in
          // the browser — so a created_at near midnight renders a different day
          // on each side and React discards the subtree.
          const joined = new Date(p.created_at).toLocaleDateString("en-GB", {
            year: "numeric",
            month: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          const banned = isBanned(p);
          return (
            <Box
              component="li"
              key={p.id}
              sx={{ display: "flex", alignItems: "center", gap: 0.25 }}
            >
              <Box
                component="button"
                type="button"
                onClick={() => onSelect(p.id)}
                aria-pressed={isSelected}
                // The visible count is a bare digit; without this a screen
                // reader announced "someone@… 12" and never said 12 of what.
                aria-label={`${p.email}, ${subLabel}, joined ${joined}${
                  p.is_super_admin ? ", administrator" : ""
                }${banned ? ", suspended" : ""}, ${count} ${
                  count === 1 ? "entry" : "entries"
                } visible`}
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
                  // Dimmed, not hidden. A suspended person is still on the
                  // roster and still holds their grants — that is what makes
                  // the suspension reversible — so the row has to stay
                  // readable while looking inactive.
                  opacity: banned ? 0.55 : 1,
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
                  {/* The badge itself is read-only; promoting and demoting live
                      in the ⋮ menu at the end of the row. Both write
                      `basecamp.super_admins` directly on the administrator's own
                      token — 0004 granted the privileges whose policies 0001
                      already carried. */}
                  {p.is_super_admin ? (
                    <Box
                      component="span"
                      sx={(t) => ({
                        display: "inline-block",
                        mt: 0.25,
                        px: 0.75,
                        py: "1px",
                        borderRadius: 50,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.3px",
                        textTransform: "uppercase",
                        color: t.palette.primary.dark,
                        backgroundColor: t.palette.celestial.light,
                      })}
                    >
                      Admin
                    </Box>
                  ) : null}
                  {banned ? (
                    <Box
                      component="span"
                      sx={(t) => ({
                        display: "inline-block",
                        mt: 0.25,
                        ml: p.is_super_admin ? 0.5 : 0,
                        px: 0.75,
                        py: "1px",
                        borderRadius: 50,
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: "0.3px",
                        textTransform: "uppercase",
                        color: t.palette.error.dark,
                        backgroundColor: t.palette.error.light,
                      })}
                    >
                      Suspended
                    </Box>
                  ) : null}
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
                    {subLabel} · joined {joined}
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

              {/* OUTSIDE the row button, not inside it. A <button> inside a
                  <button> is invalid HTML and browsers recover from it by
                  hoisting the inner one out, which drops its click handler —
                  the menu would render and do nothing. */}
              {/* No Tooltip. Its title was a verbatim copy of the aria-label
                  below, so it told a sighted user nothing the accessible name
                  did not already carry — while mounting one MUI Tooltip (a
                  useId and four timers) per row of a list that grows with every
                  account on the project. */}
              <IconButton
                size="small"
                aria-label={`Actions for ${p.email}`}
                aria-haspopup="menu"
                onClick={(e) => {
                  setMenuFor(p);
                  setAnchor(e.currentTarget);
                }}
                sx={{ flexShrink: 0 }}
              >
                <MoreVertRoundedIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Box>
          );
        })}

        {shown.length === 0 ? (
          <Typography sx={{ px: 1.25, py: 2, fontSize: 12.5, color: "text.secondary" }}>
            No one matches “{filter.trim()}”.
          </Typography>
        ) : null}
      </Box>

      {/* ONE menu for the whole list, re-anchored per row. Rendering a Menu
          inside the map would mount as many Popper instances as there are
          people, on a screen whose roster grows with every account on the
          project. */}
      <Menu anchorEl={anchor} open={menuFor !== null} onClose={closeMenu}>
        {target
          ? [
              <MenuItem
                key="link"
                disabled={pending.has(signInLinkKey(target.id))}
                onClick={() => act(() => onReissueLink(target))}
              >
                <ListItemText
                  primary="Issue a sign-in link"
                  secondary="For someone locked out. Nothing is emailed."
                />
              </MenuItem>,

              <MenuItem
                key="admin"
                // NOT disabled for self. An earlier version was, with copy
                // saying "You cannot change your own administrator status" —
                // a claim nothing enforced, since anyone with devtools could
                // issue the write. A UI that states a rule the database does
                // not have is worse than one that explains the consequence, so
                // the copy now says what actually happens. The catastrophic
                // case IS enforced, by the last-administrator trigger.
                disabled={pending.has(adminRoleKey(target.id))}
                onClick={() => act(() => onSetAdmin(target, !target.is_super_admin))}
              >
                <ListItemText
                  primary={
                    target.is_super_admin ? "Remove as administrator" : "Make an administrator"
                  }
                  secondary={
                    targetIsSelf && target.is_super_admin
                      ? "This is you. You would lose the admin screens, and another administrator would have to restore you."
                      : target.is_super_admin
                        ? "They keep their access; they lose the admin screens."
                        : "Full access to every entry and both admin screens."
                  }
                />
              </MenuItem>,

              <MenuItem
                key="ban"
                disabled={
                  (targetIsSelf && !targetBanned) || pending.has(banKey(target.id))
                }
                onClick={() => act(() => onSetBanned(target, !targetBanned))}
              >
                <ListItemText
                  primary={targetBanned ? "Restore sign-in" : "Suspend sign-in"}
                  secondary={
                    targetIsSelf && !targetBanned
                      ? "You cannot suspend your own account."
                      : targetBanned
                        ? "They can sign in again with the access they already had."
                        : "They keep their grants, so this can be undone."
                  }
                />
              </MenuItem>,
            ]
          : null}
      </Menu>
    </Paper>
  );
}
