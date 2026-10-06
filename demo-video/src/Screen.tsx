import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

// A camera over one FrictionIQ screenshot. Screenshots are 1600 CSS px wide (captured at 2x);
// `x`/`y` are the point in those CSS px the camera centres on, `zoom` is 1 for full width.
export type Shot = { at: number; x: number; y: number; zoom: number };

const CSS_WIDTH = 1600;
const FRAME_W = 1920;
const FRAME_H = 1080;
const ease = Easing.bezier(0.65, 0, 0.35, 1);

export const Screen: React.FC<{ src: string; cssHeight?: number; shots: Shot[]; opacity?: number }> = ({
  src,
  cssHeight = 900,
  shots,
  opacity = 1,
}) => {
  const frame = useCurrentFrame();
  const at = shots.map((s) => s.at);
  const track = (values: number[]) =>
    shots.length === 1
      ? values[0]
      : interpolate(frame, at, values, { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

  const zoom = track(shots.map((s) => s.zoom));
  const scale = (FRAME_W / CSS_WIDTH) * zoom;
  const w = CSS_WIDTH * scale;
  const h = cssHeight * scale;
  const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v));
  const left = clamp(FRAME_W / 2 - track(shots.map((s) => s.x)) * scale, FRAME_W - w);
  const top = clamp(FRAME_H / 2 - track(shots.map((s) => s.y)) * scale, FRAME_H - h);

  return (
    <AbsoluteFill style={{ overflow: "hidden", opacity }}>
      <Img name="Screenshot" src={staticFile(src)} style={{ position: "absolute", width: w, height: h, left, top }} />
    </AbsoluteFill>
  );
};
