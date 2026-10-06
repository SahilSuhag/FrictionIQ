import { Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { fontFamily, NAVY } from "./theme";

// A lower-third over a screen (or an upper-third with `top`, when the bottom of the shot
// matters). Fades in at `from` and out at `to` (frames within the scene).
export const Caption: React.FC<{ from: number; to: number; top?: boolean; children: React.ReactNode }> = ({
  from,
  to,
  top = false,
  children,
}) => {
  const frame = useCurrentFrame();
  return (
    <Interactive.Div
      name="Caption"
      style={{
        position: "absolute",
        left: 96,
        ...(top ? { top: 96 } : { bottom: 96 }),
        maxWidth: 1240,
        padding: "28px 40px",
        borderRadius: 24,
        backgroundColor: NAVY,
        color: "white",
        fontFamily,
        fontSize: 46,
        fontWeight: 600,
        lineHeight: 1.25,
        boxShadow: "0 24px 60px rgba(12,22,41,0.35)",
        opacity: interpolate(frame, [from, from + 12, to - 12, to], [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
        translate: interpolate(frame, [from, from + 18], ["0px 30px", "0px 0px"], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
      }}
    >
      {children}
    </Interactive.Div>
  );
};
