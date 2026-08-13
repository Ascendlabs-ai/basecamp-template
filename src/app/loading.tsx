import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";

/**
 * Root Suspense fallback — the frame, not a page.
 *
 * This file used to be a `Container`-based 6-card catalog grid, written when
 * the catalog WAS the root page. The catalog has since moved to
 * `(shell)/page.tsx` and got its own boundary, but this one did not move with
 * it — and it is still the fallback covering `(shell)/layout.tsx`'s own awaits,
 * because a layout suspends in its PARENT's boundary. So a hard load of
 * /admin/access painted a full-width, sidebar-less catalog skeleton before the
 * shell appeared: the "navigation disappears" failure the shell exists to
 * prevent, wearing the wrong page's clothes.
 *
 * It is now shaped like the shell — a dark 256px rail plus a canvas band — so
 * the first frame has the same silhouette as every frame after it. It
 * deliberately shows NO nav items and NO content: at this point the server has
 * not decided what this viewer can see, and inventing rows would be guessing at
 * an RLS answer.
 *
 * `/login` sits outside `(shell)` and is synchronous, so it never lands here.
 */
export default function RootLoading() {
  return (
    <Box sx={{ display: "flex", minHeight: "100dvh" }}>
      <Box
        aria-hidden
        sx={{
          display: { xs: "none", lg: "block" },
          width: 256,
          flexShrink: 0,
          backgroundColor: "shell.bg",
        }}
      />

      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            minHeight: 54,
            px: { xs: 2, md: 4 },
            backgroundColor: "background.paper",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Skeleton variant="text" width={120} height={18} />
        </Box>

        <Box role="status" aria-label="Loading" sx={{ px: { xs: 2, md: 4 }, py: { xs: 3, md: 3.25 }, flex: 1 }}>
          <Skeleton variant="text" width={300} height={44} />
          <Skeleton variant="text" width="50%" height={22} sx={{ mb: 4 }} />
          <Skeleton variant="rounded" height={320} />
        </Box>
      </Box>
    </Box>
  );
}
