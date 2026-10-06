# FrictionIQ demo video

A Remotion project for a short FrictionIQ product demo. See [PLAN.md](PLAN.md) for the storyboard.

```bash
npm i

# 1. Capture screenshots (serve the app first: `make serve` from the repo root)
node scripts/capture.mjs            # FRICTIONIQ_URL / CHROMIUM_PATH to override

# 2. Preview and edit in the Studio
npm run dev

# 3. Render
npx remotion render FrictionIQDemo out/frictioniq-demo.mp4
```

Screenshots in `public/shots/` are committed so the video renders without re-capturing.
Inter is bundled in `public/fonts/` (SIL Open Font License) so renders work offline.
