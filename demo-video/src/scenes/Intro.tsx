import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { CORAL, fontFamily, NAVY } from "../theme";

export const Intro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      name="Intro"
      style={{ backgroundColor: NAVY, fontFamily, color: "white", justifyContent: "center", padding: "0 160px" }}
    >
      <Interactive.Div
        name="Line 1"
        style={{
          fontSize: 84,
          fontWeight: 800,
          lineHeight: 1.1,
          opacity: interpolate(frame, [10, 30], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [10, 40], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        We measure fraud rules on what they catch.
      </Interactive.Div>
      <Interactive.Div
        name="Line 2"
        style={{
          marginTop: 32,
          fontSize: 84,
          fontWeight: 800,
          lineHeight: 1.1,
          color: CORAL,
          opacity: interpolate(frame, [60, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          translate: interpolate(frame, [60, 90], ["0px 40px", "0px 0px"], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      >
        Not on what they cost good clients.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
