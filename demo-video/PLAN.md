# FrictionIQ demo video: plan

A ~54 second product demo, 1920×1080 at 30 fps, built in Remotion from real Playwright
screenshots of the static FrictionIQ app. Synthetic data throughout, said on the last card.

**Audience:** fraud and risk leads who own the fraud numbers.
**One message:** FrictionIQ counts what fraud rules cost good clients, and shows how far a
rule can relax before any fraud slips through.

## Storyboard

| # | Scene | Time | On screen | Caption (draft voiceover) |
|---|---|---|---|---|
| 1 | Intro | 0:00–0:05 | Navy title card | "We measure fraud rules on what they catch. Not on what they cost good clients." |
| 2 | Home | 0:05–0:17 | Portfolio view; push in on **Safe to remove 10.9%**, then pull back to the key-finding chart (489 → 1,170) | "FrictionIQ counts every time a fraud rule interrupts a client." · "10.9% of interventions could go without letting any fraud through." · "And friction more than doubled after one rule went live." |
| 3 | Look here | 0:17–0:26 | "Is friction landing on the right clients?" with the tenured heavy-friction segment open, then the client list | "Tenured clients carry heavy friction more often than new ones." · "One click lists exactly who they are." |
| 4 | Client | 0:26–0:36 | Kiln Goods: grade F, 0 → 14 interventions, the Payout limit $100 lane | "Kiln Goods: 72 months, never a fraud case, and a friction grade of F." · "12 of its 14 interventions came from one rule: Payout limit $100." |
| 5 | Rule tradeoffs | 0:36–0:49 | Payout limit $100 curve; the slider sweeps $100 → $1,800 (safe), then $2,500 (fraud slips) | "Every rule gets a tradeoff curve…" · "Raise this one to $1,800: 663 fewer interventions, all 38 fraud cases still caught." · "One step further, and fraud starts slipping through." |
| 6 | Outro | 0:49–0:54 | Logo, "Friction, counted. A human decides what to change.", synthetic-data note | — |

Scenes are joined with 15-frame fades. Every number above is read straight off the
screenshots (seed 4127, 30-day window, Sep 3 – Oct 3, 2026).

## What's built (starter)

- `scripts/capture.mjs`: Playwright capture of every shot into `public/shots/` at 2×,
  including the seven slider positions for scene 5.
- `src/Screen.tsx`: a camera over a screenshot (keyframed centre point and zoom).
- `src/Caption.tsx`: the navy lower-third (or upper-third with `top`).
- `src/scenes/*`: one component per scene, each also registered on its own in the Studio
  under **Scenes**; `src/DemoVideo.tsx` strings them together as `FrictionIQDemo`.

## Next steps (not done yet)

1. **Voiceover.** Record or generate (ElevenLabs via Remotion's voiceover recipe) from the
   caption lines above, then fit scene durations to the audio.
2. **Real interaction.** Swap the slider crossfade for a Playwright screen recording of the
   drag, or add a cursor layer and click ripples on the stills.
3. **Music and sound.** A quiet bed and a soft tick on each slider step.
4. **Highlights.** Rings or underlines on the number each caption names.
5. **Cut-downs.** A 15 s social version (scenes 1, 5, 6) and a 9:16 vertical.
