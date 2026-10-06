import { Composition, Folder } from "remotion";
import { DemoVideo, TRANSITION } from "./DemoVideo";
import { ClientScene } from "./scenes/ClientScene";
import { HomeScene } from "./scenes/HomeScene";
import { Intro } from "./scenes/Intro";
import { LookHereScene } from "./scenes/LookHereScene";
import { Outro } from "./scenes/Outro";
import { RuleScene } from "./scenes/RuleScene";
import { FPS, HEIGHT, WIDTH } from "./theme";

const SCENES = [
  { id: "Intro", component: Intro, duration: 150 },
  { id: "Home", component: HomeScene, duration: 360 },
  { id: "LookHere", component: LookHereScene, duration: 270 },
  { id: "Client", component: ClientScene, duration: 300 },
  { id: "RuleTradeoffs", component: RuleScene, duration: 420 },
  { id: "Outro", component: Outro, duration: 180 },
];
const TOTAL = SCENES.reduce((n, s) => n + s.duration, 0) - TRANSITION * (SCENES.length - 1);

export const RemotionRoot: React.FC = () => (
  <>
    <Folder name="Scenes">
      {SCENES.map((s) => (
        <Composition key={s.id} id={s.id} component={s.component} durationInFrames={s.duration} fps={FPS} width={WIDTH} height={HEIGHT} />
      ))}
    </Folder>
    <Composition id="FrictionIQDemo" component={DemoVideo} durationInFrames={TOTAL} fps={FPS} width={WIDTH} height={HEIGHT} />
  </>
);
