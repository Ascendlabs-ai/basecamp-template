import Box from "@mui/material/Box";

import { initialsFromEmail } from "@/lib/adminAccess";

/**
 * Initials disc for a person.
 *
 * There is no profiles table on this Supabase project and `list_people()` returns
 * only id and email, so initials come from the email local-part. That is the
 * whole identity this app has — inventing display names would be fabricating
 * data the database does not hold.
 *
 * `selected` inverts the disc (design: selected row gets a filled blue avatar
 * with white text; unselected is the pale tint).
 *
 * Both inks are MEASURED, not inherited by precedent. The unselected disc used
 * `primary.dark` on `celestial.light`, justified in an earlier version of this
 * comment as "the pairing already used elsewhere in the app" — an appeal to
 * precedent that turned out to be 3.77:1 light / 3.40:1 dark, under AA for
 * 10.5–11px text. (The precedent itself is fine: those sites carry an ICON, and
 * 3.77:1 clears the 3:1 non-text floor.) `text.primary` measures 14.72:1 here.
 * Selected is `primary.contrastText` on `primary.main` = 5.34:1.
 */
export default function PersonAvatar({
  email,
  size = 30,
  selected = false,
}: {
  email: string;
  size?: number;
  selected?: boolean;
}) {
  return (
    <Box
      aria-hidden
      sx={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size <= 28 ? 10.5 : 11,
        fontWeight: 700,
        backgroundColor: selected ? "primary.main" : "celestial.light",
        color: selected ? "primary.contrastText" : "text.primary",
      }}
    >
      {initialsFromEmail(email)}
    </Box>
  );
}
