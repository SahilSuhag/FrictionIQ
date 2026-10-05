# FrictionIQ

> **Synthetic data throughout.** Every client, rule hit and fraud case here was generated for
> demonstration. No production systems, no client data.

We measure fraud rules on what they catch: hit rates, precision, recall, losses prevented. We
don't measure what they cost the merchant on the other side. Nobody can currently answer *"how
many times did we interrupt this client last month, and which rule did it?"*

FrictionIQ is a measurement and analysis layer over decisions that already happened. It builds
two things:

1. **A friction score per client.** It counts every intervention the client received, weights
   each one by severity and recency, and tags it with the rule that caused it. The score is shown
   as an A–F friction grade.
2. **A tradeoff curve per rule.** It sweeps the rule's threshold, re-runs the whole population,
   and plots the friction removed against the fraud still caught.

It does not detect fraud, score risk or make decisions. Every output is a recommendation, and a
human decides what to do with it.

This is the v3 build, implementing PRD v3 and the Figma screens in [`design/`](design/README.md).

## Quick start

```bash
pip install -r requirements.txt     # numpy, pytest
make all                            # generate the seeded world (seed 4127), then precompute every curve (~20 s)
make test                           # the seven PRD scenarios, the design's rule labels, invariants
open web/index.html                 # or: make serve  →  http://localhost:8000
```

The page is static. It reads `web/data/frictioniq.js` and never recomputes anything, so the
window selector and the threshold slider respond instantly.

## The three screens

They follow the Figma designs' layout and content, in Open Sans, restyled in a lavender
palette: Pale Grey `#FEFDFE` cards on a Diamond Cut `#EBE9F1` page, Italian Fitch `#D1C8E7` and
Mithril Silver `#BCB9C1` for quiet data, Purple Anemone `#8B67F2` for friction and the rule at
fault, and Dark Drama `#5A3A38` for fraud. The A–F grade colours stay as the mock has them. Each
screen has a 30 days / 60 days / 1 year window.

Each screen is kept to a few headline numbers. Every concept is shown once, and supporting detail
sits behind a disclosure (**Details**, **How it's calculated**, **Method and success metrics**).

| Screen | Answers | What's on it |
|---|---|---|
| **Home** (portfolio) | How big is this, and where do I look first? | Four headline numbers with the change against the previous window (interventions, payouts held or denied, good clients with heavy friction, friction free to remove), and fraud caught beneath for balance; one key finding, the 12-month trend and the rule behind it; every client plotted by friction score against good-client band, with the "good clients, heavy friction" quadrant shaded and the A–F counts as its legend; good clients to look at first; one table of the rules causing the most friction (interventions, payouts held or denied, interventions per fraud case caught, free stretch), with the worst in each column highlighted |
| **Client friction detail** | Is this good client being over-challenged, and by which rule? | One-sentence summary; friction grade with its range across weightings; interventions this month against last ("3 → 9"); time waiting on their money; payouts denied; share from the top rule; percentile among similar clients; one timeline lane per rule; intervention log with the points each intervention adds and the total; good-client evidence; "why this rule keeps firing" plot; how the score is calculated, collapsed until asked for |
| **Rule tradeoff explorer** | How much friction does relaxing this rule remove, and what fraud does it cost? | Rule list with free-stretch tags; the curve (friction removed as a band across weightings, fraud still caught as a line, free stretch shaded and named); a threshold slider aligned under the x-axis (or type a value); three numbers against today (interventions removed, payouts no longer held or denied, fraud still caught); the plain-language sentence; a shadow-test proposal you can draft and copy. **Details** holds the full dollar ledger, the option to apply the change only to established high-friction clients, and the method |

## Friction, counted (the differentiator)

Fraud capture is reported today. Friction is not, because nothing adds it up. FrictionIQ
compiles it in two ways that appear throughout the screens:

- **Measured units, no weights.** The headline numbers on Home are built from the logged rule
  hits alone: interventions, legitimate payouts held or denied ($, with client-days waiting in
  the hover), and friction that can be removed at no fraud cost, each against the previous
  window, with fraud caught alongside for balance. The full ledger (interventions that found no
  fraud, payouts held and denied, client-days waiting, ops review hours, fraud caught) is under
  **Details → Counting in dollars** on each rule page, comparing today with the selected
  threshold. It includes the rule's interventions per fraud case caught, and legitimate dollars
  held or denied per fraud dollar stopped. Review time assumes 30 minutes per hold (the PRD says
  20–40).
- **The friction score**, a weighted index for ranking clients. Each client's intervention log
  has a **Points** column that adds up to the score; hover a value for decision weight ×
  hold-time factor × recency. **How it's calculated** opens the formula, the grade cutoff, what
  counted as zero (contributing hits, shadow hits, outages) and why the score is a range. Every
  other screen explains the score in a short hover (the ⓘ buttons).

The **key finding** on Home and the highlights in its rule table are computed, not written by
hand:

- **Key finding:** the 12-month series, and the rule whose launch drove the latest change.
- **Rule table:** the costliest rule in dollars and the least efficient (most interventions per
  fraud case caught) are highlighted.

On seed 4127:
- Friction more than doubled after `payout_limit_100` went live: 489 a month on average, then
  1,170 in the last 30 days.
- `velocity_check` and `payout_limit_100` interrupt clients 19–20 times per fraud case caught.
  `payout_velocity_24h` does it 1.4 times.
- Counted in dollars, `new_counterparty` costs the most: $1.11M of legitimate payouts held, from
  only 43 interventions on large bulk payouts. It ranks 5th by count.

## The demo (under three minutes)

1. **Home.** The shaded "start here" quadrant holds good clients carrying heavy friction. Acme
   Supplies is labelled in it.
2. **Click Acme Supplies.** It has 9 interventions in the last 30 days, 7 of them from
   `payout_limit_100`, and it has never had a confirmed fraud case. That rule went live on Aug 28,
   which is why Acme went from 3 interventions in August to 9 this month. Acme's normal payout is
   about $150, while fraud starts at about $1,900.
3. **Open rule tradeoff.** The slider opens at $500: *"Raising payout_limit_100 from $100 to $500
   removes 588 interventions from 137 clients a month, and catches the same 38 fraud cases."* The
   free stretch runs to $1,800. Acme goes from 7 interventions to 0.
4. **Pick `boarding_doc_mismatch`.** It has no free stretch: the first step already misses fraud.
   This is the honest beat, because some rules earn their friction.
5. **In reserve for Q&A:** Northwind Payfac is the guardrail. It is graded F, but it has 2
   confirmed fraud cases, so the tool recommends nothing for it.

## Results on the seeded population (seed 4127, last 30 days)

| Measure | Baseline | Result |
|---|---|---|
| Fraud caught and missed | 95 caught, 8 missed of 103 | 95 caught after relaxing every rule to the end of its free stretch (unchanged) |
| Friction removed at zero capture cost | 0 (not measured today) | **917 interventions from 227 clients**, free or small free stretch on 7 rules |
| Challenge reduction, established band | current thresholds | established-band friction cut median **81% (80–82%) across 300 weightings** |
| Clients above the high-friction line | 78 | 10; **no client's friction rises** |
| Range width across weightings | n/a | widest free-stretch spread is 15.6 percentage points |
| Rules with no free stretch | unknown | `boarding_doc_mismatch`, `payout_velocity_24h`, `device_change_payout` |

The free-stretch labels match the designs in every window. That includes "Free to $1,800",
"Free to 4×", "Free to 18%", "Small free stretch" for `new_counterparty` and `geo_mismatch`, and
"No free stretch" for the three rules above.

`out/frictioniq-summary.json` holds the 30-day results in the same shape as the designers'
[`data/frictioniq-mock.json`](data/frictioniq-mock.json), so the Figma placeholders can be swapped
for real (synthetic) output.

## How it works

### The friction index (`frictioniq/index.py`)

```
friction(client) = Σ over prevailing hits of  decision_weight × duration_factor × recency_decay
```

| Rule | Effect |
|---|---|
| **Prevailing hits only** | When several live rules hit one event, the highest-ranked decision prevails, and ties go to the lowest binding `order`. The other hits are recorded as *contributing*: they are shown in the log but never scored. |
| **Deny or hold** | A rule authored as `DENY_OR_HOLD` denies an instant payout (it can't be held) and holds a standard one. The weight follows the action actually applied. |
| **Shadow hits score zero** | They fire and log, but no client paid for them. That makes them a free control group. |
| **Duration factor for holds** | `log(1 + hours_held / reference_hours)`, measured from the hit's own timestamps. |
| **Incidents in their own band** | Never added to a score. They are shown as a note and an "Incident" tag. |
| **Recency** | `0.5 ^ (days_since / half_life)`, relative to the as-of date (Oct 3, 2026). |

**Friction grade.** The score maps to A 0–49, B 50–99, C 100–149, D 150–219, E 220–299 and F 300+.
These cutoffs are placeholders from the PRD. The grade describes the friction *we applied*, not the
client, and it is always shown with its range across weightings.

### No single weighting (`index.sample_weightings`)

The weights in `config/frictioniq.json` (v0.1) are placeholders. Every figure is computed under
the placeholder plus **300 sampled configurations**:

- weight vectors that respect the intervention ordering (settlement limit < restriction < hold <
  deny < block < termination)
- each vector scaled so a hold weighs 25, the placeholder value; only the ordering is assumed
- a half-life between 14 and 60 days
- reference hours between 1 and 24
- a log or saturating duration shape

Bands and whiskers on screen are the 5th–95th percentile across these samples.

### Good-client bands (`frictioniq/bands.py`)

There are three bands: **established**, **developing** and **limited history**. They are built
from 12 months of evidence that the controls did not create:

- tenure
- review outcomes: how challenges ended, not whether rules fired
- confirmed fraud, which is a disqualifier, never a score
- payout pattern: week-to-week volume beyond Poisson noise, plus the median payout
- disputes and chargebacks

This definition is a **proposal for Risk Strategy to argue with**, not a validated construct.

### The tradeoff curve (`frictioniq/sweep.py`)

For each rule and window, the sweep walks readable thresholds ($100, $110 … $1,800 …; 3×, 3.5×,
4× …) out to "never fires". The threshold is a literal in `rule_expression`, so each step is a
string edit. At each step the sweep:

- re-evaluates the expression over all decision events
- removes the hits that no longer fire
- re-runs attribution
- recomputes friction under all 301 weightings
- counts fraud caught across the whole population

The **free stretch** is the furthest threshold at which the rule still catches every fraud case it
catches today. The labels work like this:

- **"Free to X"**: the free stretch removes at least 30% of the rule's friction under 95% of
  weightings.
- **"Small free stretch"**: it removes at least 5%.
- **"No free stretch"**: anything less.

The slider opens at the first round setting inside the free stretch that removes 80% of the
rule's friction. For `payout_limit_100` that is $500. The sweep is **relaxation only**, so every
counterfactual hit keeps its measured timestamps.

### Path to production

Clone the rule at the relaxed threshold with `shadow_setting = ON` and run it for 30 days next to
the live rule. The live rule's hits are what clients paid, and the clone's are what they would
have paid. The **Draft shadow test proposal** button writes this up from the curve. **Confirm
first** that shadow hits land in the same store as live hits, and that a clone binds without
changing live order.

## Repository layout

```
contract/     the frozen schema + rule-expression grammar: the ONLY thing generator and analysis share
generator/    teammate-owned seeded synthetic world (clients → behaviour → rule hits → fraud labels)
  registry.py   11 rules + ruleset bindings: the 8 from the designs, 3 the PRD scenarios need, 1 shadow
  scenarios.py  the seven PRD client scenarios (Acme's log matches the mock exactly) + 3 named design clients
  world.py      archetypes, fraud episodes, controlled edge cases, feature distributions
  engine.py     runs events through rulesets; logs prevailing / contributing / shadow / overridden hits
frictioniq/   analysis: index, attribution, bands, weighting sweep, threshold sweep, export
config/       frictioniq.json (placeholder weights, grades, sweep ranges), demo.json (demo walk-through only)
design/       the Figma screen designs and their README
data/         frictioniq-mock.json (the designers' target shape); generated CSVs land here (gitignored)
web/          the three screens, vanilla JS + SVG, reading web/data/frictioniq.js
tests/        PRD scenarios, design labels, invariants
```

### Schema changes in v3 (`contract/schema.py`)

- Rules gain `description` (shown in the log's rule tooltip) and `live_since`. A rule only
  evaluates events after its live date.
- `request_type` may list several types (`PAYOUT|INSTANT_PAYOUT`).
- New decision `DENY_OR_HOLD`, resolved per request type by `contract.schema.resolve_decision`.
- New checkpoint `PRE_SETTLEMENT` and request types `SETTLEMENT` and `BULK_PAYOUT`. Mid-market,
  enterprise and payfac payouts are bulk, so `payout_limit_100` doesn't apply to them.
- New `disputes` table for account standing.
- The history is now 12 months, Oct 3 2025 to Oct 3 2026, to support the 1-year window.

## Where this departs from the PRD or the mock

- **Volumes.** To give the 30-day window the density the screens show, the 12-month dataset
  exceeds the PRD's dataset table (written for a shorter ledger). It has 128k decision events
  against 20–50k, and 1,146 fraud cases against 150–400. Friction events are 7,621, inside 4–8k.
  The 30-day window is what the screens show: 1,265 interventions and 103 fraud cases.
- **Figures differ from the mock.** The mock's values were placeholders. The *shapes* match: Acme's
  log, "3 → 9", ~2 days waiting, 5 payouts denied, the free-stretch labels, and $500 removing
  about 80% at no fraud cost. The *numbers* come from the generator: 1,265 interventions rather
  than 3,570, and 38 fraud cases on the hero rule rather than 148. Acme grades E (C–F across
  weightings) at the 86th percentile of 75 similar clients, rather than F at the 96th.
- **Delta Bakehouse** (85% of its friction from an outage) is in the mock's "look at first" list
  with a grade of E. The PRD says outage friction is never added to a score, so its score is low,
  it grades A, and it doesn't make that list. The incident shows as a tag and a note on its client
  screen.
- **Controlled edge cases.** Every 15 days, each fraud type places one case just past the point
  where its rule's free stretch should end. The PRD calls for fraud labels "from controlled
  scenarios". Without these, a 30-day window holds so few cases per rule that the labels would
  depend on luck.
- **Blind generation was not achieved.** The generator and the analysis were written in the same
  session, and the generator was tuned so the curves match the designs. The code is split along
  the contract (`generator/` never imports `frictioniq/`), so a teammate can take `generator/`,
  rewrite it blind and regenerate. Do that before claiming blind generation.
- **Not built from the design README:** the rule-cell tooltip screenshot (`rule-cell-tooltip.png`)
  wasn't supplied. The tooltip itself is implemented in the intervention log.
- **AI disclosure:** this build, including this write-up, was produced with AI assistance.

## Open questions (from the PRD)

- Are shadow-mode hits logged to the same store as live hits? Can a shadow clone bind without
  disturbing the live order?
- Four colleagues should rank the seven interventions by client burden, to turn invented weights
  into elicited ones.
- Does anyone in Risk Strategy have a view on the good-client definition, or on absolute versus
  peer-relative grade cutoffs?
