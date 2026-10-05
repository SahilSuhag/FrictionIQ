"""Generate the seeded synthetic world and write it as CSV under data/.

    python -m generator --seed 4127 --out data

Every record is synthetic and built for demonstration. The seed is recorded in
data/manifest.json so the demo reproduces exactly.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
from datetime import timedelta

from contract import schema

from . import engine, registry, scenarios
from .world import (_EPOCH, BACKGROUND_MIX, EDGE_CASES, FRAUD_TYPES, WINDOW_HOURS, Client, archetype_params, at,
                    background_events, client_id_for, derive_timeline_features, edge_fraud, fictional_names,
                    fraud_episode)

DEFAULT_SEED = 4127

# Incidents: (id, severity, start, duration hours, n random affected clients).
# Two fall inside the last 30 days; the SEV1 one covers Delta Bakehouse.
INCIDENTS = [
    ("INC-0211", "SEV2", at("2026-02-11", 9), 10.0, 40),
    ("INC-0623", "SEV3", at("2026-06-23", 14), 6.0, 55),
    ("INC-0912", "SEV2", at("2026-09-12", 7), 8.0, 25),
    ("INC-0919", "SEV1", at("2026-09-19", 6), 40.0, 20),
]


def ts(hours: float) -> str:
    return (_EPOCH + timedelta(hours=hours)).strftime(schema.TIMESTAMP_FORMAT)


def build_world(seed: int):
    rng = random.Random(seed)
    clients: dict[str, Client] = {}
    events = []

    scen_clients, scen_events = scenarios.build(rng)
    named = scenarios.named_heavy(rng)
    for c in scen_clients + named:
        clients[c.client_id] = c
    events += scen_events
    taken_names = {c.client_name for c in clients.values()}
    taken_ids = set(clients)

    n_bad = sum(v[1] for v in FRAUD_TYPES.values())
    names = iter(fictional_names(rng, len(BACKGROUND_MIX) + n_bad, taken_names))

    def new_client(archetype, tenure):
        params, entity, segment, peer = archetype_params(rng, archetype)
        name = next(names)
        c = Client(client_id_for(rng, name, taken_ids), name, entity, segment, tenure, peer, archetype, params)
        clients[c.client_id] = c
        return c

    for archetype in BACKGROUND_MIX:
        tenure = rng.choice([rng.randint(2, 11), rng.randint(12, 23), rng.randint(24, 96), rng.randint(24, 96)])
        c = new_client(archetype, tenure)
        c.clear_prob = 0.97 if tenure >= 24 else 0.9
        c.disputes_per_year = {"enterprise": 2.0, "payfac": 1.5, "mid_market": 1.0}.get(archetype, 0.3)

    # Bad actors. Fraud episodes are spread evenly over the year per fraud type, so
    # every window — the last 30 days included — sees each kind of fraud.
    for ftype, (base, n_actors, n_episodes, n_events) in FRAUD_TYPES.items():
        actors = []
        for _ in range(n_actors):
            tenure = rng.randint(18, 40) if rng.random() < 0.15 else rng.randint(1, 14)
            c = new_client(base, tenure)
            c.archetype, c.fraud_type, c.clear_prob = "bad_actor", ftype, 0.55
            c.params["volatility"] = rng.uniform(0.5, 0.9)
            c.disputes_per_year = rng.uniform(4, 10)
            if ftype in ("cash_out", "payout_burst"):
                c.params.update(instant_share=0.6, payout_amt=rng.uniform(40, 90))
            actors.append(c)
        total = n_actors * n_episodes
        starts = [(k + rng.uniform(0.1, 0.9)) * (WINDOW_HOURS - 4 * 24) / total for k in range(total)]
        rng.shuffle(starts)
        for i, start in enumerate(starts):
            events += fraud_episode(rng, actors[i % n_actors], ftype, start, n_events)
        if ftype in EDGE_CASES:
            slot = 15 * 24
            for k in range(int(WINDOW_HOURS // slot)):
                t = k * slot + rng.uniform(0.05, 0.95) * slot
                events.append(edge_fraud(rng, rng.choice(actors), ftype, t))

    # Legitimate device changes (a new phone, a new laptop) for everyone but the scenarios.
    for c in clients.values():
        if c.scenario is None:
            c.device_changes = sorted(rng.uniform(0, WINDOW_HOURS) for _ in range(rng.choice([0, 1, 1, 2, 3])))
            events += background_events(rng, c)

    # Controlled missingness on a small subset of background clients.
    bg = [c for c in clients.values() if c.scenario is None and c.client_id not in {n.client_id for n in named}]
    for c in rng.sample(bg, 15):
        c.tenure_months = None
    for c in rng.sample(bg, 9):
        c.peer_group = None

    derive_timeline_features(clients, events)

    events.sort(key=lambda e: (e.t, e.client_id))
    for i, ev in enumerate(events):
        ev.event_id = f"EV-{i + 1:06d}"

    hits = engine.evaluate(rng, clients, events)

    # Incidents: Delta Bakehouse sits inside the SEV1 window; other scenario clients stay out.
    eligible = sorted(c.client_id for c in bg)
    incidents = []
    for inc_id, sev, start, dur, n in INCIDENTS:
        affected = rng.sample(eligible, n)
        if inc_id == "INC-0919":
            affected.append(scenarios.INCIDENT_CLIENT)
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

    disputes = []
    for c in sorted(clients.values(), key=lambda c: c.client_id):
        n = sum(1 for _ in range(12) if rng.random() < c.disputes_per_year / 12)
        for _ in range(n):
            disputes.append({"client_id": c.client_id, "opened_at": ts(rng.uniform(0, WINDOW_HOURS)),
                             "kind": rng.choice(["chargeback", "chargeback", "dispute", "reversal"])})
    for i, d in enumerate(disputes):
        d["dispute_id"] = f"DS-{i + 1:04d}"

    return clients, events, hits, incidents, fraud_cases, disputes


# Region and client type are drawn from a hash of the client ID rather than the seeded RNG, so
# adding them left every other generated value unchanged.
REGION_MIX = [("CA", 40), ("US", 30), ("EMEA", 18), ("APAC", 12)]
SCOTIA_SHARE = 15   # percent of direct background clients typed SCOTIA


def _bucket(client_id: str, salt: str) -> int:
    return int(hashlib.sha256(f"{salt}:{client_id}".encode()).hexdigest(), 16) % 100


def region_of(c: Client) -> str:
    b, total = _bucket(c.client_id, "region"), 0
    for region, share in REGION_MIX:
        total += share
        if b < total:
            return region
    return REGION_MIX[-1][0]


def client_type_of(c: Client) -> str:
    """ISV for payfac platforms; SCOTIA for a share of direct background clients; else the segment."""
    if c.entity == "PAYFAC":
        return "ISV"
    if c.scenario is None and _bucket(c.client_id, "type") < SCOTIA_SHARE:
        return "SCOTIA"
    return c.segment


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

    clients, events, hits, incidents, fraud_cases, disputes = build_world(args.seed)
    os.makedirs(args.out, exist_ok=True)

    write_csv(os.path.join(args.out, "rules.csv"), schema.RULE_FIELDS, registry.rule_rows())
    write_csv(os.path.join(args.out, "ruleset_bindings.csv"), schema.RULESET_BINDING_FIELDS,
              registry.binding_rows())
    write_csv(os.path.join(args.out, "clients.csv"), schema.CLIENT_FIELDS,
              [{**vars(c), "client_type": client_type_of(c), "region": region_of(c)}
               for c in sorted(clients.values(), key=lambda c: c.client_id)])
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
    write_csv(os.path.join(args.out, "disputes.csv"), schema.DISPUTE_FIELDS, disputes)

    last30 = WINDOW_HOURS - 30 * 24
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
            "friction_events": sum(1 for h in hits if h["action_taken"] == "PREVAILED"),
            "friction_events_30d": sum(1 for h in hits if h["action_taken"] == "PREVAILED" and h["t"] >= last30),
            "incidents": len(incidents),
            "fraud_cases": len(fraud_cases),
            "fraud_cases_30d": sum(1 for e in events if e.fraud_type and e.t >= last30),
            "disputes": len(disputes),
        },
    }
    with open(os.path.join(args.out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print(json.dumps(manifest["counts"], indent=2))


if __name__ == "__main__":
    main()
