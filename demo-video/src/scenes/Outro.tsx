import { AbsoluteFill, Easing, Interactive, interpolate, useCurrentFrame } from "remotion";
import { fontFamily, INDIGO, NAVY } from "../theme";

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill
      name="Outro"
      style={{ backgroundColor: NAVY, fontFamily, color: "white", justifyContent: "center", alignItems: "center" }}
    >
      <Interactive.Div
        name="Logo"
        style={{
          width: 160,
          height: 160,
          borderRadius: 36,
          backgroundColor: INDIGO,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: 96,
          fontWeight: 800,
          scale: interpolate(frame, [0, 25], [0.6, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.spring({ damping: 200 }),
            output: "perceptual-scale",
          }),
          opacity: interpolate(frame, [0, 15], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        F
      </Interactive.Div>
      <Interactive.Div
        name="Wordmark"
        style={{
          marginTop: 40,
          fontSize: 110,
          fontWeight: 800,
          opacity: interpolate(frame, [15, 35], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        FrictionIQ
      </Interactive.Div>
      <Interactive.Div
        name="Tagline"
        style={{
          marginTop: 16,
          fontSize: 52,
          fontWeight: 400,
          opacity: interpolate(frame, [35, 55], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Friction, counted. A human decides what to change.
      </Interactive.Div>
      <Interactive.Div
        name="Disclaimer"
        style={{
          position: "absolute",
          bottom: 100,
          fontSize: 30,
          color: "rgba(255,255,255,0.6)",
          opacity: interpolate(frame, [55, 75], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        Synthetic data throughout. No production systems, no client data.
      </Interactive.Div>
    </AbsoluteFill>
  );
};
