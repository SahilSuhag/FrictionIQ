import { linearTiming, TransitionSeries } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { ClientScene } from "./scenes/ClientScene";
import { HomeScene } from "./scenes/HomeScene";
import { Intro } from "./scenes/Intro";
import { LookHereScene } from "./scenes/LookHereScene";
import { Outro } from "./scenes/Outro";
import { RuleScene } from "./scenes/RuleScene";

export const TRANSITION = 15;

export const DemoVideo: React.FC = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence name="Intro" durationInFrames={150}>
      <Intro />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Home" durationInFrames={360}>
      <HomeScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Look here" durationInFrames={270}>
      <LookHereScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Client" durationInFrames={300}>
      <ClientScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Rule tradeoffs" durationInFrames={420}>
      <RuleScene />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: TRANSITION })} />
    <TransitionSeries.Sequence name="Outro" durationInFrames={180}>
      <Outro />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
