import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";

/**
 * Suspense fallback for everything INSIDE the shell.
 *
 * Without this the nearest boundary was `src/app/loading.tsx`, which sits above
 * `(shell)/layout.tsx` — so the sidebar suspended along with the page and a
 * hard load of /admin/access showed a full-width, sidebar-less *catalog*
 * skeleton before the whole frame snapped into place. That is precisely the
 * "navigation disappears" failure the persistent shell exists to prevent.
 *
 * Shaped like the canvas, not like the catalog: a top-bar band and a content
 * block at the same padding the pages use, so the swap does not jolt.
 */
export default function ShellLoading() {
  return (
    <>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minHeight: 54,
          px: { xs: 2, md: 4 },
          flexShrink: 0,
          backgroundColor: "background.paper",
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Skeleton variant="text" width={140} height={18} />
      </Box>

      <Box role="status" aria-label="Loading" sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
        <Skeleton variant="text" width={320} height={44} />
        <Skeleton variant="text" width="55%" height={22} sx={{ mb: 4 }} />
        <Skeleton variant="rounded" height={120} sx={{ mb: 2 }} />
        <Skeleton variant="rounded" height={260} />
      </Box>
    </>
  );
}
