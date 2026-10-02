"""The seven PRD client scenarios, seeded deliberately.

Each scenario client gets a quiet background (events that trip no rule) plus
hand-placed events whose features trip specific rules. Rule hits are NOT written
here — they come out of the same rule evaluation as everyone else's, so the
scenarios exercise the real pipeline.

Times are hours since WINDOW_START; the window ends at WINDOW_HOURS (the as-of).
"""

from __future__ import annotations

import random

from .world import WINDOW_HOURS, Client, Event, legit_features

END = WINDOW_HOURS


def days_ago(d: float) -> float:
    return END - d * 24


def _quiet_params(rng, **over):
    p = {
        "capture_rate": 0.6, "ticket": 600, "velocity": 6, "new_device": 0.0, "xb": 0.05, "mcc": 5999,
        "cb": 0.002, "payout_rate": 0.14, "payout_amt": 2400, "instant_rate": 0.0, "instant_amt": 0.0,
        "refund": 0.04, "boarding_rate": 0.0, "volatility": 0.08, "quiet": True,
    }
    p.update(over)
    return p


def _client(rng, cid, name, entity, segment, tenure, peer, scenario, **params):
    return Client(cid, name, entity, segment, tenure, peer, archetype="scenario",
                  params=_quiet_params(rng, **params), clear_prob=1.0, scenario=scenario,
                  bank_changes=[-rng.uniform(3000, 20000)])


def _ev(c: Client, rtype: str, t: float, rng, outcome="CLEARED", hold_hours=None, fraud=None, **features):
    from .world import CHECKPOINT_FOR
    f = legit_features(rng, c, rtype)
    f.update(features)
    return Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, t, f, fraud_type=fraud,
                 hold_hours=hold_hours, outcome=outcome)


def build(rng: random.Random) -> tuple[list[Client], list[Event]]:
    clients, events = [], []

    # 1 — Acme Supplies. The hero case. Direct SMB, 38 months, established, never fraud.
    #     Normal instant payout ~$150 sits just above R01's $100 cap, so R01 denies
    #     nearly every one. 9 prevailing hits in the last 30 days, 7 from R01.
    acme = _client(rng, "CL-0001", "Acme Supplies", "DIRECT", "SMB", 38, "smb_retail", "1_hero")
    clients.append(acme)
    for d in [2, 5, 9, 13, 18, 23, 27]:                                  # last 30 days: 7 R01 denies
        events.append(_ev(acme, "INSTANT_PAYOUT", days_ago(d) + rng.uniform(-3, 3), rng,
                          hold_hours=rng.uniform(14, 30), amount=round(rng.uniform(128, 178), 2)))
    for d in [33, 37, 41, 46, 50, 54, 58, 63, 67, 71, 76, 80, 84, 88]:   # prior 60 days: 14 more
        events.append(_ev(acme, "INSTANT_PAYOUT", days_ago(d) + rng.uniform(-3, 3), rng,
                          hold_hours=rng.uniform(14, 30), amount=round(rng.uniform(122, 185), 2)))
    events.append(_ev(acme, "PAYOUT", days_ago(11), rng, hold_hours=5.5, refund_ratio_30d=0.17))  # R06 hold
    events.append(_ev(acme, "CAPTURE", days_ago(20), rng, hold_hours=1.4, txn_count_1h=34))      # R03 hold
    events.append(_ev(acme, "PAYOUT", days_ago(52), rng, hold_hours=7.0, refund_ratio_30d=0.16))
    events.append(_ev(acme, "CAPTURE", days_ago(74), rng, hold_hours=0.9, txn_count_1h=33))

    # 2 — Harbor Lane Bakery. Two rule hits plus 40 hours inside the SEV1 incident window.
    #     Most of its friction is incident-driven; relaxing rules would do nothing.
    harbor = _client(rng, "CL-0002", "Harbor Lane Bakery", "DIRECT", "SMB", 26, "smb_food", "2_incident")
    clients.append(harbor)
    events.append(_ev(harbor, "CAPTURE", days_ago(9), rng, hold_hours=60, device_age_hours=10.0))   # R04 limit
    events.append(_ev(harbor, "CAPTURE", days_ago(6), rng, hold_hours=70, device_age_hours=30.0))   # R04 limit

    # 3 — Nimbus Pay Partners. Payfac, 7 months, limited history, 2 confirmed fraud cases.
    #     11 prevailing hits across 4 rules and 3 checkpoints. Friction is earned.
    nimbus = _client(rng, "CL-0003", "Nimbus Pay Partners", "PAYFAC", "SMB", 7, "payfac_platform", "3_earned",
                     boarding_rate=0.25, capture_rate=1.0, velocity=10)
    nimbus.clear_prob = 0.5
    clients.append(nimbus)
    events += [
        _ev(nimbus, "SUBMERCHANT_BOARDING", days_ago(27), rng, "UPHELD", 30, fraud="identity_boarding",
            identity_mismatch_score=0.94),
        _ev(nimbus, "SUBMERCHANT_BOARDING", days_ago(21), rng, "CLEARED", 16, identity_mismatch_score=0.86),
        _ev(nimbus, "SUBMERCHANT_BOARDING", days_ago(8), rng, "UPHELD", 26, identity_mismatch_score=0.9),
        _ev(nimbus, "CAPTURE", days_ago(25), rng, "UPHELD", 2.0, txn_count_1h=48),
        _ev(nimbus, "CAPTURE", days_ago(16), rng, "CLEARED", 1.1, txn_count_1h=37),
        _ev(nimbus, "CAPTURE", days_ago(4), rng, "UPHELD", 3.0, txn_count_1h=52),
        _ev(nimbus, "CAPTURE", days_ago(19), rng, "UPHELD", None, fraud="card_testing", ticket_z_score=6.3),
        _ev(nimbus, "CAPTURE", days_ago(12), rng, "CLEARED", None, ticket_z_score=4.4),
        _ev(nimbus, "PAYOUT", days_ago(23), rng, "UPHELD", 20, refund_ratio_30d=0.24),
        _ev(nimbus, "PAYOUT", days_ago(14), rng, "CLEARED", 9, refund_ratio_30d=0.19),
        _ev(nimbus, "PAYOUT", days_ago(3), rng, "UPHELD", 22, refund_ratio_30d=0.27),
    ]

    # 4 — Meridian Freight Group. Enterprise, 52 months. One PRE_CAPTURE event hit by three
    #     rules: R03 (order 10, HOLD), R08 (order 20, DENY), R04 (order 30, SETTLEMENT_LIMIT).
    #     Attributed to the DENY only; the other two are contributing.
    meridian = _client(rng, "CL-0004", "Meridian Freight Group", "DIRECT", "ENTERPRISE", 52, "domestic_enterprise",
                       "4_attribution", capture_rate=1.5, ticket=20000, velocity=12, payout_rate=0.3,
                       payout_amt=90000)
    clients.append(meridian)
    events.append(_ev(meridian, "CAPTURE", days_ago(10), rng, hold_hours=18,
                      txn_count_1h=36, ticket_z_score=4.6, device_age_hours=20.0))

    # 5a / 5b — differ in exactly one dimension: one long hold vs six short ones.
    juniper = _client(rng, "CL-0005", "Juniper & Pine Florals", "DIRECT", "SMB", 30, "smb_retail", "5a_long_hold")
    oakmoss = _client(rng, "CL-0006", "Oakmoss Candle Co.", "DIRECT", "SMB", 30, "smb_retail", "5b_short_holds")
    clients += [juniper, oakmoss]
    events.append(_ev(juniper, "PAYOUT", days_ago(12), rng, hold_hours=96.0, refund_ratio_30d=0.19))
    for d in [14.5, 13.5, 12.5, 11.5, 10.5, 9.5]:
        events.append(_ev(oakmoss, "PAYOUT", days_ago(d), rng, hold_hours=rng.uniform(22, 28) / 60,
                          refund_ratio_30d=round(rng.uniform(0.16, 0.2), 3)))

    # 6 — Lantern Street Books. Developing band, 19 months. 40 hits from the shadow rule
    #     R10 (payouts_24h > 2) and 1 live hit. Friction reflects the live hit only.
    lantern = _client(rng, "CL-0007", "Lantern Street Books", "DIRECT", "SMB", 19, "smb_retail", "6_shadow",
                      payout_rate=0.0)
    clients.append(lantern)
    for d in [28, 25, 22, 19, 16, 13, 10, 7, 4, 2]:          # ten burst days, six small payouts each
        base = days_ago(d)
        for k in range(6):
            events.append(_ev(lantern, "INSTANT_PAYOUT", base + k * 1.5, rng, amount=round(rng.uniform(40, 92), 2)))
    events.append(_ev(lantern, "PAYOUT", days_ago(15), rng, hold_hours=4.0, refund_ratio_30d=0.18))  # R06 live

    # 7 — Halcyon Freight Systems. Enterprise, 44 months, established. Six holds from the
    #     tightly targeted boarding rule R02. High friction, but the rule is earning it.
    halcyon = _client(rng, "CL-0008", "Halcyon Freight Systems", "DIRECT", "ENTERPRISE", 44, "domestic_enterprise",
                      "7_earning", capture_rate=1.8, ticket=30000, velocity=12, payout_rate=0.3,
                      payout_amt=120000, boarding_rate=0.12)
    clients.append(halcyon)
    for d, score in zip([26, 21, 17, 12, 7, 3], [0.83, 0.91, 0.81, 0.88, 0.93, 0.85]):
        events.append(_ev(halcyon, "SUBMERCHANT_BOARDING", days_ago(d), rng, hold_hours=rng.uniform(14, 26),
                          identity_mismatch_score=score))

    return clients, events


SCENARIO_INCIDENT_CLIENT = "CL-0002"
