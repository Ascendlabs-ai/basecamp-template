import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

/**
 * The 54px canvas top bar: breadcrumb on the left, app-owned controls on the
 * right. Deliberately sparse — all navigation lives in the sidebar, so nothing
 * that navigates belongs here.
 *
 * Holds no state of its own — it renders text and whatever the caller hands it.
 * It is a Server Component at the page call sites, and is pulled into the
 * client bundle by AccessAdmin, which owns the admin route's top bar because
 * the view switch lives there. Worth hoisting into the shell layout eventually
 * (it is chrome, and five branches currently each remember to render it).
 */
export default function TopBar({
  parent,
  current,
  children,
}: {
  /** Optional breadcrumb parent, e.g. "Admin" in "Admin / Access". */
  parent?: string;
  current: string;
  /** App-owned controls: date range, view switch, primary action. */
  children?: React.ReactNode;
}) {
  return (
    <Box
      component="header"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        minHeight: 54,
        px: { xs: 2, md: 4 },
        py: { xs: 1, md: 0 },
        flexShrink: 0,
        flexWrap: "wrap",
        backgroundColor: "background.paper",
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Stack direction="row" spacing={2.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography component="p" sx={{ fontSize: 13, color: "text.secondary" }}>
          {parent ? (
            <Box component="span" sx={{ color: "text.secondary" }}>
              {parent}&nbsp;/&nbsp;
            </Box>
          ) : null}
          <Box component="span" sx={{ color: "text.primary", fontWeight: 700 }}>
            {current}
          </Box>
        </Typography>
      </Stack>

      {children ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap" }}>
          {children}
        </Stack>
      ) : null}
    </Box>
  );
}
