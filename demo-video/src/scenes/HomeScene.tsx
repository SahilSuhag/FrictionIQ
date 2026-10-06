import { AbsoluteFill } from "remotion";
import { Caption } from "../Caption";
import { Screen } from "../Screen";
import { PAGE } from "../theme";

// Portfolio view: full screen, then the "safe to remove" hero, then the key finding.
export const HomeScene: React.FC = () => (
  <AbsoluteFill name="Home" style={{ backgroundColor: PAGE }}>
    <Screen
      src="shots/home.png"
      shots={[
        { at: 0, x: 800, y: 450, zoom: 1 },
        { at: 45, x: 800, y: 450, zoom: 1 },
        { at: 90, x: 420, y: 300, zoom: 1.9 },
        { at: 190, x: 420, y: 300, zoom: 1.9 },
        { at: 240, x: 800, y: 500, zoom: 1.15 },
      ]}
    />
    <Caption from={20} to={95}>FrictionIQ counts every time a fraud rule interrupts a client.</Caption>
    <Caption from={100} to={195}>10.9% of interventions could go without letting any fraud through.</Caption>
    <Caption from={245} to={360}>And friction more than doubled after one rule went live.</Caption>
  </AbsoluteFill>
);
