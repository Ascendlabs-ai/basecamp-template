"use client";

import ButtonBase from "@mui/material/ButtonBase";

/**
 * The detail trigger, shared by LaunchTile and FeatureEntry. This is the
 * accessibility-critical, non-obvious primitive that must live in ONE place —
 * duplicating it invites reintroducing the dead-hit-area regression.
 *
 * The caller wraps this in its own heading Typography (h3), which sets the
 * font/size; the button inherits it. Load-bearing details:
 *
 *   - position: static. ButtonBase defaults to position: relative, which would
 *     make the ::after's containing block the button itself (sized to the text)
 *     instead of the entry's position: relative Paper — so the "click anywhere
 *     opens detail" hit area would cover only the title. static hands the
 *     containing block to the Paper, so ::after inset:0 covers the whole card.
 *   - disableRipple, because once the button is static a ripple would emanate
 *     from the wrong origin; opening the drawer is the click feedback.
 *   - the ::after IS the hit area (whole card) and the focus ring; the Paper
 *     must be the nearest positioned ancestor and must not clip overflow.
 */
export default function StretchedDetailButton({
  name,
  onOpen,
}: {
  name: string;
  onOpen: () => void;
}) {
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={`Details for ${name}`}
      disableRipple
      sx={(theme) => ({
        position: "static",
        textAlign: "left",
        justifyContent: "flex-start",
        font: "inherit",
        color: "inherit",
        "&::after": { content: '""', position: "absolute", inset: 0, borderRadius: "12px" },
        "&.Mui-focusVisible::after": {
          outline: `3px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {name}
    </ButtonBase>
  );
}
