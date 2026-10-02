"""Generate the seeded synthetic world and write it as CSV under data/.

    python -m generator --seed 20261006 --out data

Every record is synthetic and built for demonstration. The seed is recorded in
data/manifest.json so the demo reproduces exactly.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
from datetime import datetime, timedelta, timezone

from contract import schema

from . import engine, registry, scenarios
from .world import (BACKGROUND_MIX, FRAUD_MIX, FRAUD_TYPES, STEALTH_TYPES, WINDOW_HOURS, Client,
                    archetype_params, background_events, derive_timeline_features, fictional_names,
                    fraud_events)

DEFAULT_SEED = 20261006
WINDOW_START = datetime.strptime(schema.WINDOW_START, schema.TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)

# Incidents: (id, severity, start hour, duration hours, n random affected clients)
INCIDENTS = [
    ("INC-01", "SEV2", 18 * 24 + 8, 12.0, 40),     # payout pipeline degradation, Jul 21
    ("INC-03", "SEV3", 55 * 24 + 13, 6.0, 60),     # settlement file delay, Aug 27
    ("INC-02", "SEV1", 77 * 24 + 6, 40.0, 20),     # capture outage, Sep 18-19 (40h)
]


def ts(hours: float) -> str:
    return (WINDOW_START + timedelta(hours=hours)).strftime(schema.TIMESTAMP_FORMAT)


def build_world(seed: int):
    rng = random.Random(seed)
    clients: dict[str, Client] = {}
    events = []

    scen_clients, scen_events = scenarios.build(rng)
    for c in scen_clients:
        clients[c.client_id] = c
    events += scen_events
    taken = {c.client_name for c in scen_clients}

    # Background population.
    n_bg = len(BACKGROUND_MIX) + len(FRAUD_MIX) + 6
    names = fictional_names(rng, n_bg, taken)
    idx = 0

    def new_client(archetype, tenure):
        nonlocal idx
        params, entity, segment, peer = archetype_params(rng, archetype)
        cid = f"CL-{1001 + idx}"
        c = Client(cid, names[idx], entity, segment, tenure, peer, archetype, params)
        idx += 1
        c.bank_changes = [-rng.uniform(2000, 30000)]
        if rng.random() < 0.3:
            c.bank_changes.append(rng.uniform(0, WINDOW_HOURS))
        clients[cid] = c
        return c

    for archetype in BACKGROUND_MIX:
        tenure = rng.choice([rng.randint(2, 11), rng.randint(12, 23), rng.randint(24, 96), rng.randint(24, 96)])
        c = new_client(archetype, tenure)
        c.clear_prob = 0.97 if tenure >= 24 else 0.9

    # Bad actors: mostly young accounts, a few long-tenured bust-outs.
    for ftype in FRAUD_MIX:
        base, (lo, hi) = FRAUD_TYPES[ftype]
        tenure = rng.randint(18, 40) if rng.random() < 0.15 else rng.randint(1, 14)
        c = new_client(base, tenure)
        c.archetype, c.fraud_type, c.clear_prob = "bad_actor", ftype, 0.55
        c.bank_changes = c.bank_changes[:1]     # no incidental in-window bank change
        c.params["volatility"] = rng.uniform(0.5, 0.9)
        if ftype == "cash_out":
            c.params["instant_rate"] = max(c.params["instant_rate"], 0.2)
            c.params["instant_amt"] = rng.uniform(40, 90)
        events += fraud_events(rng, c, ftype, rng.randint(lo, hi))

    # Stealth fraud: bad clients whose fraud slips under every threshold (low friction).
    for k in range(6):
        ftype = STEALTH_TYPES[k % 2]
        base = "smb_instant" if ftype == "stealth_payout" else "smb_standard"
        c = new_client(base, rng.randint(3, 20))
        c.archetype, c.fraud_type, c.clear_prob = "stealth_bad", ftype, 0.8
        c.params["instant_rate"] = max(c.params["instant_rate"], 0.15)
        c.params["instant_amt"] = min(c.params["instant_amt"] or 70, 90)
        events += fraud_events(rng, c, ftype, rng.randint(3, 5))

    for c in clients.values():
        events += background_events(rng, c)

    # Controlled missingness on a small subset of background clients.
    bg = [c for c in clients.values() if c.scenario is None]
    for c in rng.sample(bg, 15):
        c.tenure_months = None
    for c in rng.sample(bg, 9):
        c.peer_group = None

    derive_timeline_features(clients, events)

    events.sort(key=lambda e: (e.t, e.client_id))
    for i, ev in enumerate(events):
        ev.event_id = f"EV-{i + 1:06d}"

    hits = engine.evaluate(rng, clients, events)

    # Incidents: scenario 2 sits inside the SEV1 window; other scenario clients stay out.
    eligible = [c.client_id for c in bg]
    quiet_smb = [c.client_id for c in bg if c.archetype == "smb_standard"]
    incidents = []
    for inc_id, sev, start, dur, n in INCIDENTS:
        if inc_id == "INC-02":
            affected = [scenarios.SCENARIO_INCIDENT_CLIENT] + rng.sample(quiet_smb, n)
        else:
            affected = rng.sample(eligible, n)
        incidents.append({"incident_id": inc_id, "start": ts(start), "end": ts(start + dur),
                          "affected_clients": ";".join(sorted(affected)), "severity": sev})

    fraud_cases = []
    for ev in events:
        if ev.fraud_type:
            confirmed = min(ev.t + rng.uniform(24, 240), WINDOW_HOURS - 1)
            fraud_cases.append({"client_id": ev.client_id, "event_id": ev.event_id,
                                "confirmed_at": ts(confirmed), "fraud_type": ev.fraud_type})
    for i, fc in enumerate(fraud_cases):
        fc["case_id"] = f"FC-{i + 1:04d}"

    return clients, events, hits, incidents, fraud_cases


def write_csv(path, fields, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in fields})


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seed", type=int, default=DEFAULT_SEED)
    ap.add_argument("--out", default="data")
    args = ap.parse_args(argv)

    clients, events, hits, incidents, fraud_cases = build_world(args.seed)
    os.makedirs(args.out, exist_ok=True)

    write_csv(os.path.join(args.out, "rules.csv"), schema.RULE_FIELDS, registry.rule_rows())
    write_csv(os.path.join(args.out, "ruleset_bindings.csv"), schema.RULESET_BINDING_FIELDS,
              registry.binding_rows())
    write_csv(os.path.join(args.out, "clients.csv"), schema.CLIENT_FIELDS,
              [vars(c) for c in sorted(clients.values(), key=lambda c: c.client_id)])
    write_csv(os.path.join(args.out, "decision_events.csv"), schema.DECISION_EVENT_FIELDS,
              [{"event_id": e.event_id, "client_id": e.client_id, "checkpoint": e.checkpoint,
                "request_type": e.request_type, "occurred_at": ts(e.t), **e.features} for e in events])
    hit_rows = []
    for i, h in enumerate(sorted(hits, key=lambda h: (h["t"], h["event_id"], h["rule_id"]))):
        hit_rows.append({"hit_id": f"HT-{i + 1:06d}", "rule_id": h["rule_id"], "client_id": h["client_id"],
                         "event_id": h["event_id"], "triggered_at": ts(h["t"]),
                         "resolved_at": ts(h["resolved_t"]), "final_decision": h["final_decision"],
                         "action_taken": h["action_taken"]})
    write_csv(os.path.join(args.out, "rule_hits.csv"), schema.RULE_HIT_FIELDS, hit_rows)
    write_csv(os.path.join(args.out, "incidents.csv"), schema.INCIDENT_FIELDS, incidents)
    write_csv(os.path.join(args.out, "fraud_cases.csv"), schema.FRAUD_CASE_FIELDS, fraud_cases)

    manifest = {
        "synthetic": True,
        "notice": "SYNTHETIC DATA — generated for demonstration. No real clients, people or payments.",
        "seed": args.seed,
        "window_start": schema.WINDOW_START,
        "window_end": schema.WINDOW_END,
        "counts": {
            "clients": len(clients),
            "rules": len(registry.RULES),
            "decision_events": len(events),
            "rule_hits": len(hit_rows),
            "friction_events": sum(1 for h in hit_rows if h["action_taken"] == "PREVAILED"),
            "incidents": len(incidents),
            "fraud_cases": len(fraud_cases),
        },
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(json.dumps(manifest["counts"], indent=2))


if __name__ == "__main__":
    main()
