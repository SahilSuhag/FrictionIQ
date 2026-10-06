// Captures FrictionIQ screens for the demo video into public/shots.
// Run `make serve` (or `python3 -m http.server 8000 -d web`) from the repo root first.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.FRICTIONIQ_URL ?? "http://localhost:8000/";
const OUT = new URL("../public/shots/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium",
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
const settle = () => page.waitForTimeout(600);
const shot = async (name, opts = {}) => {
  await settle();
  await page.screenshot({ path: OUT + name + ".png", ...opts });
  console.log("saved", name);
};
const go = async (hash) => {
  await page.goto(BASE + hash);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
};

// 1. Home: the portfolio view, then the full page for a slow pan.
await go("#home");
await shot("home");
await shot("home-full", { fullPage: true });

// 2. Home: open the "Look here" segment (tenured clients with heavy friction).
const hot = page.locator(".hot-pill").first();
if (await hot.count()) {
  const seg = page.locator('[data-cell="heavy|established"]').first();
  if (await seg.count()) await seg.click();
  else await hot.click();
  await page.waitForTimeout(400);
  await page.locator("#cell-title").scrollIntoViewIfNeeded().catch(() => {});
  await shot("home-cell");
}

// 3. Client detail: opens on the tenured client with the most friction.
await go("#client");
await shot("client");
await shot("client-full", { fullPage: true });

// 4. Rule tradeoff explorer: sweep the threshold from today's $100 up to the edge of
//    the safe range ($1,800) and one step past it ($2,500), where fraud starts slipping.
await go("#rule");
const slider = page.locator("#slider");
await slider.focus();
await page.keyboard.press("Home");
await page.evaluate(() => window.scrollTo(0, 0));
const SWEEP = [0, 8, 12, 16, 21, 28, 31]; // $100, $200, $300, $500, $1,000, $1,800, $2,500
let at = 0;
for (const [n, index] of SWEEP.entries()) {
  for (; at < index; at++) await page.keyboard.press("ArrowRight");
  await shot(`rule-step-${n}`);
}

await browser.close();
