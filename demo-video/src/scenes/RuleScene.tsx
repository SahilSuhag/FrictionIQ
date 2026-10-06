import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Caption } from "../Caption";
import { Screen, Shot } from "../Screen";
import { PAGE } from "../theme";

// Rule tradeoff explorer. The slider sweep is a crossfade between screenshots taken at
// $100, $200, $300, $500, $1,000, $1,800 and $2,500 (scripts/capture.mjs).
const STEPS = 7;
const STEP_AT = [0, 40, 75, 110, 150, 195, 300]; // frame each step is fully shown
const CAMERA: Shot[] = [
  { at: 0, x: 800, y: 450, zoom: 1 },
  { at: 30, x: 1000, y: 430, zoom: 1.3 },
];

export const RuleScene: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill name="Rule tradeoffs" style={{ backgroundColor: PAGE }}>
      {Array.from({ length: STEPS }, (_, i) => (
        <Screen
          key={i}
          src={`shots/rule-step-${i}.png`}
          shots={CAMERA}
          opacity={
            i === 0
              ? 1
              : interpolate(frame, [STEP_AT[i] - 10, STEP_AT[i]], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
          }
        />
      ))}
      <Caption from={10} to={120}>Every rule gets a tradeoff curve: friction removed against fraud still caught.</Caption>
      <Caption from={125} to={285}>Raise this one to $1,800: 663 fewer interventions, all 38 fraud cases still caught.</Caption>
      <Caption from={290} to={420}>One step further, and fraud starts slipping through.</Caption>
    </AbsoluteFill>
  );
};
