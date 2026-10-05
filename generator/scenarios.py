"""The seven PRD client scenarios, seeded deliberately, plus three named clients from
the screen designs.

Each scenario client gets a quiet background (events that trip no rule) plus
hand-placed events whose features trip specific rules. Rule hits are NOT written
here: they come out of the same rule evaluation as everyone else's, so the
scenarios exercise the real pipeline.
"""

from __future__ import annotations

import random

from .world import CHECKPOINT_FOR, Client, Event, archetype_params, at, background_events, legit_features

R01_LIVE = at("2026-08-28", 0)
SHADOW_LIVE = at("2026-09-01", 0)


def _quiet_params(**over):
    p = {
        "capture_rate": 0.35, "ticket": 600, "geo": 0.05, "new_device": 0.0, "settle_rate": 0.35, "spike": 0.0,
        "payout_rate": 0.2, "payout_amt": 70.0, "instant_share": 0.3, "bulk": False, "new_cp": 0.0,
        "refund": 0.04, "boarding_rate": 0.0, "volatility": 0.08, "quiet": True,
    }
    p.update(over)
    return p


def _client(cid, name, entity, segment, tenure, peer, scenario, **params):
    return Client(cid, name, entity, segment, tenure, peer, archetype="scenario", params=_quiet_params(**params),
                  clear_prob=1.0, scenario=scenario, disputes_per_year=0.0)


def _ev(rng, c: Client, rtype: str, date: str, hour=12.0, outcome="CLEARED", hold=None, fraud=None, **features):
    f = legit_features(rng, c, rtype)
    f.update(features)
    return Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, at(date, hour), f, fraud_type=fraud,
                 hold_hours=hold, outcome=outcome)


def build(rng: random.Random) -> tuple[list[Client], list[Event]]:
    clients, events = [], []

    # 1 — Acme Supplies. The hero case. Direct SMB, 38 months, established, never fraud.
    #     Normal payout ~$150 sits just above payout_limit_100's cap, live since Aug 28.
    #     August: 3 interventions. Last 30 days: 9, 7 of them from payout_limit_100.
    acme = _client("ACME-0417", "Acme Supplies", "DIRECT", "SMB", 38, "smb_retail", "1_hero",
                   payout_rate=0.23, payout_amt=150.0)
    clients.append(acme)
    events += background_events(rng, acme, payouts_until=R01_LIVE)
    # payout_limit_100: instant payouts are denied, standard payouts held
    for date, kind, hold in [("2026-08-30", "INSTANT_PAYOUT", None),
                             ("2026-09-04", "INSTANT_PAYOUT", None), ("2026-09-07", "PAYOUT", 18.0),
                             ("2026-09-11", "INSTANT_PAYOUT", None), ("2026-09-15", "INSTANT_PAYOUT", None),
                             ("2026-09-20", "PAYOUT", 30.0), ("2026-09-25", "INSTANT_PAYOUT", None),
                             ("2026-09-30", "INSTANT_PAYOUT", None)]:
        events.append(_ev(rng, acme, kind, date, 10.0, hold=hold if hold else rng.uniform(14, 30),
                          amount=round(rng.uniform(128, 178), 2)))
    # velocity_check settlement limits and new_counterparty holds across the year
    for date, hours, ratio in [("2026-02-03", 60.0, 3.3), ("2026-08-19", 48.0, 3.2), ("2026-09-17", 72.0, 3.4)]:
        events.append(_ev(rng, acme, "SETTLEMENT", date, 9.0, hold=hours, txn_velocity_ratio=ratio))
    for date, hours in [("2026-05-14", 4.0), ("2026-08-08", 3.0), ("2026-09-27", 2.0)]:
        events.append(_ev(rng, acme, "PAYOUT", date, 15.0, hold=hours, amount=85.0, counterparty_age_days=0))

    # 2 — Delta Bakehouse. Two rule hits plus 40 hours inside the SEV1 incident window.
    #     Most of its friction is incident-driven; relaxing rules would do nothing.
    delta = _client("DELT-2265", "Delta Bakehouse", "DIRECT", "SMB", 26, "smb_food", "2_incident", payout_amt=42.0)
    clients.append(delta)
    events += background_events(rng, delta)
    events.append(_ev(rng, delta, "CAPTURE", "2026-09-24", hold=60, device_age_hours=10.0))
    events.append(_ev(rng, delta, "CAPTURE", "2026-09-27", hold=70, device_age_hours=30.0))

    # 3 — Northwind Payfac. Payfac, 7 months, limited history, 2 confirmed fraud cases.
    #     11 prevailing hits across 4 rules and 3 checkpoints. Friction is earned.
    north = _client("NORT-7716", "Northwind Payfac", "PAYFAC", "SMB", 7, "payfac_platform", "3_earned",
                    bulk=True, payout_amt=12000.0, boarding_rate=0.25, capture_rate=0.5)
    north.clear_prob = 0.5
    clients.append(north)
    events += background_events(rng, north)
    events += [
        _ev(rng, north, "SUBMERCHANT_BOARDING", "2026-09-08", outcome="UPHELD", hold=30, fraud="doc_fraud",
            doc_mismatch_score=0.94),
        _ev(rng, north, "SUBMERCHANT_BOARDING", "2026-09-14", outcome="CLEARED", hold=28, doc_mismatch_score=0.86),
        _ev(rng, north, "SUBMERCHANT_BOARDING", "2026-09-26", outcome="UPHELD", hold=32, doc_mismatch_score=0.9),
        _ev(rng, north, "CAPTURE", "2026-09-16", outcome="UPHELD", fraud="geo_card_testing", ticket_z_score=6.3),
        _ev(rng, north, "CAPTURE", "2026-09-22", outcome="CLEARED", ticket_z_score=4.4),
        _ev(rng, north, "CAPTURE", "2026-09-10", outcome="UPHELD", hold=6, geo_mismatch_share=0.72),
        _ev(rng, north, "CAPTURE", "2026-09-19", outcome="CLEARED", hold=5, geo_mismatch_share=0.7),
        _ev(rng, north, "CAPTURE", "2026-09-29", outcome="UPHELD", hold=7, geo_mismatch_share=0.78),
        _ev(rng, north, "BULK_PAYOUT", "2026-09-12", outcome="UPHELD", hold=26, refund_ratio_30d=0.24),
        _ev(rng, north, "BULK_PAYOUT", "2026-09-21", outcome="CLEARED", hold=22, refund_ratio_30d=0.21),
        _ev(rng, north, "BULK_PAYOUT", "2026-09-30", outcome="UPHELD", hold=28, refund_ratio_30d=0.27),
    ]

    # 4 — Meridian Freight Group. Enterprise, 52 months. One PRE_CAPTURE event hit by three
    #     rules: geo_mismatch (order 10, HOLD), card_testing_deny (order 20, DENY),
    #     new_device_limit (order 30, SETTLEMENT_LIMIT). Attributed to the DENY only.
    meridian = _client("MERI-3054", "Meridian Freight Group", "DIRECT", "ENTERPRISE", 52, "domestic_enterprise",
                       "4_attribution", capture_rate=0.7, ticket=20000, bulk=True, payout_rate=0.3, payout_amt=90000)
    clients.append(meridian)
    events += background_events(rng, meridian)
    events.append(_ev(rng, meridian, "CAPTURE", "2026-09-23", hold=18,
                      geo_mismatch_share=0.7, ticket_z_score=4.6, device_age_hours=20.0))

    # 5a / 5b — differ in exactly one dimension: one long hold vs six short ones.
    juniper = _client("JUNI-5521", "Juniper & Pine Florals", "DIRECT", "SMB", 30, "smb_retail", "5a_long_hold",
                      payout_amt=38.0)
    oakmoss = _client("OAKM-6630", "Oakmoss Candle Co.", "DIRECT", "SMB", 30, "smb_retail", "5b_short_holds",
                      payout_amt=38.0)
    clients += [juniper, oakmoss]
    events += background_events(rng, juniper) + background_events(rng, oakmoss)
    events.append(_ev(rng, juniper, "PAYOUT", "2026-09-21", hold=96.0, amount=45.0, refund_ratio_30d=0.19))
    for day in range(18, 24):
        events.append(_ev(rng, oakmoss, "PAYOUT", f"2026-09-{day}", hold=rng.uniform(22, 28) / 60, amount=45.0,
                          refund_ratio_30d=round(rng.uniform(0.16, 0.2), 3)))

    # 6 — Lantern Street Books. Developing band, 19 months. 40 hits from the shadow rule
    #     payout_limit_50_shadow and 1 live hit. Friction reflects the live hit only.
    lantern = _client("LANT-8842", "Lantern Street Books", "DIRECT", "SMB", 19, "smb_retail", "6_shadow",
                      payout_amt=35.0)
    clients.append(lantern)
    events += background_events(rng, lantern, payouts_until=SHADOW_LIVE)
    t0 = at("2026-09-03", 6.0)
    for k in range(41):                       # every 17.5 h, so never 3 inside 24 h
        t = t0 + k * 17.5
        if k == 20:                           # the one live hit: a $40 payout held on refund ratio
            events.append(Event(lantern.client_id, "PRE_PAYOUT", "PAYOUT", t,
                                {**legit_features(rng, lantern, "PAYOUT"), "amount": 40.0, "refund_ratio_30d": 0.18},
                                hold_hours=4.0, outcome="CLEARED"))
            continue
        f = legit_features(rng, lantern, "INSTANT_PAYOUT")
        f["amount"] = round(rng.uniform(55, 95), 2)
        events.append(Event(lantern.client_id, "PRE_PAYOUT", "INSTANT_PAYOUT", t, f, outcome="CLEARED"))

    # 7 — Halcyon Freight Systems. Enterprise, 44 months, established. Six holds from the
    #     tightly targeted boarding rule. High friction, but the rule is earning it.
    halcyon = _client("HALC-1190", "Halcyon Freight Systems", "DIRECT", "ENTERPRISE", 44, "domestic_enterprise",
                      "7_earning", capture_rate=0.7, ticket=30000, bulk=True, payout_rate=0.3,
                      payout_amt=120000, boarding_rate=0.12)
    clients.append(halcyon)
    events += background_events(rng, halcyon)
    for date, score in zip(["2026-09-07", "2026-09-12", "2026-09-16", "2026-09-21", "2026-09-26", "2026-09-30"],
                           [0.83, 0.91, 0.81, 0.88, 0.93, 0.85]):
        events.append(_ev(rng, halcyon, "SUBMERCHANT_BOARDING", date, hold=rng.uniform(14, 26),
                          doc_mismatch_score=score))

    return clients, _space_payouts(events)


def _space_payouts(events: list[Event]) -> list[Event]:
    """Scenario clients pay out at most twice a day, so payout_velocity_24h never fires
    on them by accident. Hand-placed payouts are kept; background ones that crowd them go."""
    from .world import PAYOUT_TYPES
    keep, last = [], {}
    planned = sorted((e for e in events if e.request_type in PAYOUT_TYPES and e.outcome is not None),
                     key=lambda e: e.t)
    planned_times: dict[str, list[float]] = {}
    for e in planned:
        planned_times.setdefault(e.client_id, []).append(e.t)
    for e in sorted(events, key=lambda e: e.t):
        if e.request_type in PAYOUT_TYPES and e.outcome is None:
            near_planned = any(abs(e.t - t) < 13 for t in planned_times.get(e.client_id, []))
            if near_planned or e.t - last.get(e.client_id, -1e9) < 13:
                continue
            last[e.client_id] = e.t
        keep.append(e)
    return keep


# Named clients from the screen designs. Their profiles lean towards heavy friction;
# where they rank is left to the population.
NAMED_HEAVY = [
    ("BIRC-2087", "Birchway Florists", 40, {"payout_rate": 0.3, "payout_amt": 140.0, "spike": 0.35,
                                             "instant_share": 0.5}),
    ("COPP-6413", "Copperline Tools", 33, {"payout_rate": 0.32, "payout_amt": 115.0, "new_cp": 0.3,
                                            "instant_share": 0.4}),
    ("EVER-3378", "Evergreen Print", 51, {"payout_rate": 0.33, "payout_amt": 210.0, "instant_share": 0.5}),
]


def named_heavy(rng: random.Random) -> list[Client]:
    out = []
    for cid, name, tenure, over in NAMED_HEAVY:
        params, entity, segment, peer = archetype_params(rng, "smb")
        params.update(over, volatility=0.08)
        out.append(Client(cid, name, entity, segment, tenure, peer, "smb", params, clear_prob=0.99,
                          disputes_per_year=0.0))
    return out


INCIDENT_CLIENT = "DELT-2265"
