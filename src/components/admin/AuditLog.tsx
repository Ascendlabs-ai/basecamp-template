"use client";

import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

import { describeAuditActor, describeAuditRow, formatAuditTime } from "@/lib/auditText";
import type { AuditRow } from "@/types/admin";

/**
 * Admin · Audit — who granted or revoked what, for whom, and when.
 *
 * READ-ONLY BY CONSTRUCTION, not by convention. `basecamp.access_audit` has one
 * policy (SELECT, super_admin) and no INSERT/UPDATE/DELETE policy at all, and
 * `authenticated` holds only SELECT. The rows are written by AFTER triggers on
 * the four tables that decide access — `access_grants`, `type_grants`,
 * `members` and `super_admins` — so there is nothing for this component to
 * submit even if it wanted to.
 *
 * That also means this view shows changes the app did not make. A grant issued
 * in the SQL Editor appears here with a null actor, which is why "System"
 * renders as a distinct label rather than a blank cell — the absence of a
 * signed-in actor is information, not missing data.
 */

export default function AuditLog({ rows, error }: { rows: AuditRow[]; error: string | null }) {
  // An unreadable log says so, rather than rendering as an empty one. Those two
  // states look identical and mean opposite things.
  if (error) {
    return (
      <Paper elevation={0} sx={{ maxWidth: 560, mx: "auto", mt: { xs: 4, md: 8 }, p: { xs: 3, sm: 5 }, border: 1, borderColor: "divider" }}>
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
          The audit log could not be read
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
          Granting and revoking still work — this tab is history, and nothing here
          decides access. Error code <code>{error}</code>.
        </Typography>
      </Paper>
    );
  }
  if (rows.length === 0) {
    return (
      <Paper
        elevation={0}
        sx={{
          maxWidth: 560,
          mx: "auto",
          mt: { xs: 4, md: 8 },
          p: { xs: 3, sm: 5 },
          textAlign: "center",
          border: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700, mb: 1 }}>
          Nothing recorded yet
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary", lineHeight: 1.7 }}>
          Every grant and revoke from here on is recorded automatically. Changes made
          before the log existed are not — it starts from when it was installed, and
          cannot be backfilled.
        </Typography>
      </Paper>
    );
  }

  return (
    <Box>
      <Typography
        component="h2"
        sx={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.5px",
          color: "text.secondary",
          mb: 1.25,
        }}
      >
        Access changes · most recent {rows.length}
      </Typography>

      <Paper elevation={0} sx={{ border: 1, borderColor: "divider", overflow: "hidden" }}>
        <Box component="ul" sx={{ listStyle: "none", m: 0, p: 0 }}>
          {rows.map((row) => (
            <Box
              key={row.id}
              component="li"
              sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 1.5,
                px: 2,
                py: 1.25,
                borderBottom: 1,
                borderColor: "divider",
                "&:last-of-type": { borderBottom: 0 },
                flexWrap: "wrap",
              }}
            >
              <Chip
                label={row.action}
                size="small"
                sx={(t) => ({
                  height: 20,
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.3px",
                  color: row.action === "grant" ? t.palette.status.greenText : t.palette.status.redText,
                  backgroundColor:
                    row.action === "grant" ? t.palette.status.greenBg : t.palette.status.redBg,
                })}
              />
              <Typography variant="body2" sx={{ flex: 1, minWidth: 220 }}>
                <Box component="span" sx={{ fontWeight: 600 }}>
                  {describeAuditActor(row.actor_email)}
                </Box>{" "}
                {describeAuditRow(row)}
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: "text.secondary", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
              >
                <time dateTime={row.occurred_at}>{formatAuditTime(row.occurred_at)}</time>
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      <Typography variant="caption" sx={{ display: "block", color: "text.secondary", mt: 1.5 }}>
        Showing the most recent {rows.length} changes, newest first. Written by the database, not by this screen — a change made directly in SQL
        appears here too, with <strong>System</strong> as the actor. The log cannot be
        edited or deleted, including by an administrator.
      </Typography>
    </Box>
  );
}
