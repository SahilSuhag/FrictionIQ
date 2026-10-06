import { AbsoluteFill } from "remotion";
import { Caption } from "../Caption";
import { Screen } from "../Screen";
import { PAGE } from "../theme";

// "Is friction landing on the right clients?" with the tenured heavy-friction segment open.
export const LookHereScene: React.FC = () => (
  <AbsoluteFill name="Look here" style={{ backgroundColor: PAGE }}>
    <Screen
      src="shots/home-cell.png"
      shots={[
        { at: 0, x: 600, y: 400, zoom: 1.5 },
        { at: 120, x: 560, y: 430, zoom: 1.6 },
        { at: 170, x: 800, y: 780, zoom: 1.35 },
      ]}
    />
    <Caption from={10} to={130}>Tenured clients carry heavy friction more often than new ones.</Caption>
    <Caption from={165} to={270} top>One click lists exactly who they are.</Caption>
  </AbsoluteFill>
);
