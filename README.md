# FrictionIQ

> **Synthetic data throughout.** Every client, rule hit and fraud case here was generated for
> demonstration. No production systems, no client data.

We measure fraud rules on what they catch: hit rates, precision, recall, losses prevented. We
don't measure what they cost the merchant on the other side. Nobody can currently answer *"how
many times did we interrupt this client last month, and which rule did it?"*

FrictionIQ is a measurement and analysis layer over decisions that already happened. It builds
two things:

1. **A friction score per client.** It counts every intervention the client received (deny, hold,
   settlement limit, restriction, block, termination), weights each by severity and recency, and
   tags each one with the rule that caused it.
2. **A tradeoff curve per rule.** It sweeps the rule's threshold, re-runs the whole population,
   and plots the friction removed against the fraud still caught.

It does not detect fraud, score risk or make decisions. Every output is a recommendation, and a
human decides what to do with it.

## Quick start

```bash
pip install -r requirements.txt     # numpy, pytest
make all                            # generate the seeded world, then precompute every curve (~6 s)
make test                           # the seven PRD scenarios + invariants
open web/index.html                 # or: make serve  →  http://localhost:8000
```

The page is static. It reads `web/data/frictioniq.js` and never recomputes anything, so the
slider responds instantly and nothing can hang during a recording.

## The demo (under three minutes)

1. **Client friction detail → Acme Supplies** (the page opens here). Acme is a good merchant: 38
   months with us, established band, 25 of 25 challenges cleared, no fraud. It received **9
   interventions in 30 days, and 7 of them came from one rule**, `instant_payout_cap` (DENY when
   `amount > 100`). Acme's normal instant payout is about $150.
2. Click **Open the instant_payout_cap curve →**. Drag the slider. Friction drops while the fraud
   line stays flat out to **$781**, because the fraud this rule catches is mostly $2,000+. Read out
   the sentence under the chart: *"Relaxing instant_payout_cap from $100 to $518 removes 1,495
   interventions from 89 clients … with no change in fraud caught (53 of 53)."*
3. Switch to **boarding_identity_mismatch**. This curve has no flat stretch: the first step of
   relaxation already loses fraud. That's the honest beat. Some rules are earning their friction.
4. In reserve for Q&A: **Nimbus Pay Partners**, the guardrail. It has high friction and 2
   confirmed fraud cases, and the tool declines to relax.

## Results on the seeded population (seed 20261006)

| Measure | Baseline | Result |
|---|---|---|
| Fraud caught and missed | 232 caught, 28 missed of 260 | 232 caught after relaxing every free-friction rule to the end of its flat stretch (unchanged) |
| Friction events removed at zero capture cost | 0 (not measured today) | **2,595 interventions from 206 clients**, non-trivial on 8 rules |
| Challenge reduction, established band | 1,445 interventions | 710 after; friction cut median **64% (53–74%) across 300 weightings** |
| Clients above the high-friction line | 78 | 24; **no client's friction rises** |
| Range width across weightings | n/a | widest flat-stretch spread is 4.8 percentage points |
| Rules with no flat stretch | unknown | `boarding_identity_mismatch`; `high_risk_mcc_restrict` is a two-state list rule |

The distributional check found something worth stating. After relaxation, the top decile's share
of total friction rises from 38% to 59%. Nobody was pushed up, though: what remains is concentrated
on clients outside the established band, mostly ones with confirmed fraud.

## How it works

### The friction index (`frictioniq/index.py`)

```
friction(client) = Σ over prevailing hits of  decision_weight × duration_factor × recency_decay
```

| Rule | Effect |
|---|---|
| **Prevailing hits only** | When several live rules hit one event, the highest-ranked decision prevails, and ties go to the lowest binding `order`. The other hits are recorded as *contributing* and shown in the client view, but they caused nothing and are not scored. |
| **Shadow hits score zero** | They fire and log, but no client paid for them. That makes them a free control group. |
| **Duration factor for holds** | `log(1 + hours_held / reference_hours)`, from the hit's own `triggered_at` and `resolved_at`. Non-hold actions take a factor of 1. |
| **Incidents in their own band** | Severity weight × duration factor × recency, never mixed into the rule-attributed total. |
| **Recency** | `0.5 ^ (days_since / half_life)` |

The index is deliberately **not a model**. It is deterministic arithmetic, so every number
traces back to the events that produced it.

### No single weighting (`index.sample_weightings`)

The weights in `config/frictioniq.json` are placeholders and are labelled that way on screen.
Every result is computed under the placeholder setting plus **300 sampled configurations**. Each
sample uses weight vectors consistent with the intervention ordering (settlement limit <
restriction < hold < deny < block < termination), a half-life between 14 and 60 days, reference
hours between 1 and 24, and a log or saturating duration shape. The whiskers on every curve show
the 5th–95th percentile across these samples.

### Good-client bands (`frictioniq/bands.py`)

There are three bands: **established**, **developing** and **limited history**. They are built on
evidence that does not itself come from the controls:

- tenure
- **resolution outcomes**: how challenges ended, not whether rules fired
- behavioural stability: week-to-week volume beyond Poisson noise
- account standing: chargeback rate

Confirmed fraud is a disqualifier, never a score. If tenure is unknown, the client is capped at
developing. This definition is a **proposal for Risk Strategy to argue with**, not a validated
construct.

### The tradeoff curve (`frictioniq/sweep.py`)

For each rule, the sweep walks a grid of thresholds from the live setting out to "never fires".
The threshold is a literal in `rule_expression`, so each step is a string edit
(`contract.expression.with_threshold`). At each step the sweep:

- re-evaluates the expression over all decision events
- removes the hits that no longer fire
- re-runs attribution, so another rule can take over an event
- recomputes friction under all 301 weightings
- counts fraud caught across the whole population

Both arms see identical clients, events and fraud labels.

- **Flat stretch** is the furthest threshold at which the rule still catches every fraud case it
  caught at the live setting.
- **Verdicts**: *free friction* means the flat stretch removes at least 10% of the rule's friction
  under 95% of weightings. *Marginal* means it removes less. *Earning its friction* means there is
  no flat stretch. Shadow rules, rules that fire only on fraud, and two-state list rules are
  labelled as such.
- **Segment policy** (dynamic relaxation): a toggle applies the relaxed threshold only to
  established clients above the 75th-percentile friction line.
- **Relaxation only.** A looser threshold can only remove hits that were logged, so every
  counterfactual hold keeps its measured duration. Tightening would invent hits whose durations
  were never observed.

### Path to production

Shield rules have a shadow setting. Clone the rule, set the clone's threshold to the relaxed
value, set `shadow_setting = ON`, and run it against live traffic for one reporting window. The
live rule's hits are what clients paid, and the clone's hits are what they would have paid. The
counterfactual becomes an observation. The explorer prints the exact clone expression for any
slider position. **Two things to confirm first:** that shadow hits land in the same store as live
hits, and that a shadow clone can bind to a ruleset without changing the live order.

## Repository layout

```
contract/     the frozen schema + rule-expression grammar: the ONLY thing generator and analysis share
generator/    teammate-owned seeded synthetic world (clients → behaviour → rule hits → fraud labels)
  registry.py   12 rules + ruleset bindings, varying in quality on purpose
  scenarios.py  the seven PRD client scenarios, seeded deliberately
  world.py      population archetypes, fraud scenarios, feature distributions
  engine.py     runs events through rulesets; logs prevailing/contributing/shadow/overridden hits
frictioniq/   analysis: index, attribution, bands, weighting sweep, threshold sweep, export
config/       frictioniq.json (placeholder weights + sweep ranges), demo.json (demo walk-through only)
web/          three screens, vanilla JS + SVG, reading web/data/frictioniq.js
tests/        PRD scenarios 1–7 as tests, plus invariants
```

### Schema (`contract/schema.py`)

These tables mirror the rule-authoring structure in the PRD: `rules`, `ruleset_bindings`,
`rule_hits`, `clients` and `incidents`. There are three additions, all marked in the code:

- `event_id` on `rule_hits`, because attribution is per event and a hit must name its event.
- `decision_events`, the population every sweep re-runs over. It carries the feature columns that
  rule expressions compare against.
- `fraud_cases`, the capture guardrail.

## What to know before presenting this

- **Blind generation was not achieved in this build.** The PRD asks for the generator and the
  analysis to be written by different people, with the schema as the only contract. Here both
  were written in the same session. The generator was tuned to the PRD's generation rules, which
  require one rule with a long flat stretch and one with none, and it was tuned after seeing the
  first curves. The code is separated along the contract (`generator/` never imports
  `frictioniq/`) so that your teammate can take ownership of `generator/`, rewrite its
  distributions blind, and regenerate. Do this before claiming blind generation.
- The 7 scenario clients are curated. The success metrics above are population-wide.
- Downstream overrides (`action_taken = OVERRIDDEN`) are read from the log, because the analysis
  cannot re-derive them.
- `config/demo.json` names the demo clients for the walkthrough only. The analysis does not read
  it.
- Explanations are scoped to Operations, not to clients, because telling a client why they were
  held teaches evasion.
- **AI disclosure:** this build, including this write-up, was produced with AI assistance.

## Open questions (from the PRD)

- Are shadow-mode hits logged to the same store as live hits? Can a shadow clone bind without
  disturbing the live order?
- Four colleagues should rank the seven interventions by client burden. That would turn invented
  weights into elicited ones.
- Does anyone in Risk Strategy have a view on the good-client definition?
