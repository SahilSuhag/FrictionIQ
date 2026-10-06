import { AbsoluteFill } from "remotion";
import { Caption } from "../Caption";
import { Screen } from "../Screen";
import { PAGE } from "../theme";

// Client friction detail for Kiln Goods: grade F, 0 → 14 interventions, one rule behind most.
export const ClientScene: React.FC = () => (
  <AbsoluteFill name="Client" style={{ backgroundColor: PAGE }}>
    <Screen
      src="shots/client.png"
      shots={[
        { at: 0, x: 800, y: 450, zoom: 1 },
        { at: 40, x: 800, y: 450, zoom: 1 },
        { at: 90, x: 620, y: 330, zoom: 1.8 },
        { at: 170, x: 620, y: 330, zoom: 1.8 },
        { at: 220, x: 780, y: 560, zoom: 1.5 },
      ]}
    />
    <Caption from={15} to={165}>Kiln Goods: 72 months, never a fraud case, and a friction grade of F.</Caption>
    <Caption from={175} to={300}>12 of its 14 interventions came from one rule: Payout limit $100.</Caption>
  </AbsoluteFill>
);
