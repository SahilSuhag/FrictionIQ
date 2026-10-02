"""Coherent synthetic world: client profiles drive behaviour, behaviour drives rule hits.

Everything here is synthetic and built for demonstration. Names are fictional.
Time is carried internally as float hours since WINDOW_START (0 .. WINDOW_HOURS).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

WINDOW_DAYS = 90
WINDOW_HOURS = WINDOW_DAYS * 24.0

NORMAL_MCCS = [5411, 5812, 5999, 5732, 5651, 7230, 7299, 8299, 5943, 5992, 5045, 4214]
RISKY_MCCS = [5967, 7995, 5816]


@dataclass
class Client:
    client_id: str
    client_name: str
    entity: str
    segment: str
    tenure_months: int | None
    peer_group: str | None
    archetype: str
    params: dict
    clear_prob: float = 0.92
    scenario: str | None = None
    fraud_type: str | None = None
    bank_changes: list = field(default_factory=list)   # hours (may be negative)


@dataclass
class Event:
    client_id: str
    checkpoint: str
    request_type: str
    t: float
    features: dict
    fraud_type: str | None = None
    hold_hours: float | None = None    # scenario override for measured resolution time
    outcome: str | None = None         # scenario override: CLEARED | UPHELD
    event_id: str = ""


CHECKPOINT_FOR = {
    "CAPTURE": "PRE_CAPTURE",
    "PAYOUT": "PRE_PAYOUT",
    "INSTANT_PAYOUT": "PRE_PAYOUT",
    "SUBMERCHANT_BOARDING": "CLIENT_BOARDING",
}


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def clip(x, lo=0.0, hi=1.0):
    return max(lo, min(hi, x))


def poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def loguniform(rng, lo, hi):
    return math.exp(rng.uniform(math.log(lo), math.log(hi)))


# ---------------------------------------------------------------------------
# fictional names
# ---------------------------------------------------------------------------

_PREFIX = ["Amber", "Birch", "Cobalt", "Driftwood", "Ember", "Fernhill", "Granite", "Hollow", "Ivory",
           "Jasper", "Kestrel", "Linden", "Marigold", "Nettle", "Opal", "Pebble", "Quill", "Rowan",
           "Saffron", "Thistle", "Umber", "Velvet", "Willow", "Yarrow", "Zephyr", "Bramble", "Cinder",
           "Dovetail", "Elm", "Foxglove", "Gull", "Heron", "Inkwell", "Juniper", "Kiln", "Lark", "Moss",
           "Nimbus", "Orchard", "Pinecone", "Quarry", "Ridge", "Sparrow", "Tidewater", "Upland", "Vale",
           "Wren", "Copper", "Slate", "Clover"]
_NOUN = ["Provisions", "Goods", "Works", "Trading", "Supply", "Studio", "Outfitters", "Kitchen", "Market",
         "Logistics", "Labs", "Collective", "Mercantile", "Atelier", "Freight", "Partners", "Wares",
         "Systems", "Commerce", "Exchange"]
_SUFFIX = ["Co.", "Ltd", "LLC", "Group", "& Sons", "Inc.", ""]


def fictional_names(rng: random.Random, n: int, taken: set[str]) -> list[str]:
    names = []
    while len(names) < n:
        name = f"{rng.choice(_PREFIX)} {rng.choice(_NOUN)} {rng.choice(_SUFFIX)}".strip()
        if name not in taken:
            taken.add(name)
            names.append(name)
    return names


# ---------------------------------------------------------------------------
# background archetypes
# ---------------------------------------------------------------------------

def _base_params(rng):
    return {
        "capture_rate": rng.uniform(0.3, 0.9),
        "ticket": rng.uniform(200, 1500),
        "velocity": rng.uniform(2, 10),
        "new_device": rng.uniform(0.01, 0.04),
        "xb": rng.uniform(0.0, 0.2),
        "mcc": rng.choice(NORMAL_MCCS),
        "cb": rng.uniform(0.0, 0.008),
        "payout_rate": rng.uniform(0.08, 0.2),
        "payout_amt": rng.uniform(800, 6000),
        "instant_rate": 0.0,
        "instant_amt": 0.0,
        "refund": rng.uniform(0.01, 0.08),
        "boarding_rate": 0.0,
        "volatility": rng.uniform(0.05, 0.2) if rng.random() < 0.8 else rng.uniform(0.4, 0.8),
        "quiet": False,
    }


def archetype_params(rng: random.Random, archetype: str) -> tuple[dict, str, str, str]:
    """Return (params, entity, segment, peer_group) for a background archetype."""
    p = _base_params(rng)
    entity, segment = "DIRECT", "SMB"
    peer = rng.choice(["smb_retail", "smb_services", "smb_food"])
    if archetype == "smb_instant":
        p["instant_rate"] = rng.uniform(0.15, 0.45)
        p["instant_amt"] = rng.uniform(110, 320) if rng.random() < 0.6 else rng.uniform(35, 110)
    elif archetype == "smb_standard":
        pass
    elif archetype == "mid_market":
        segment, peer = "MID_MARKET", rng.choice(["mm_retail", "mm_services"])
        p.update(capture_rate=rng.uniform(0.8, 1.5), velocity=rng.uniform(8, 22), ticket=rng.uniform(2000, 9000),
                 payout_rate=rng.uniform(0.15, 0.3), payout_amt=rng.uniform(5000, 30000), xb=rng.uniform(0, 0.35))
        if rng.random() < 0.35:
            p["instant_rate"] = rng.uniform(0.1, 0.3)
            p["instant_amt"] = rng.uniform(150, 900)
    elif archetype == "enterprise":
        segment = "ENTERPRISE"
        glob = rng.random() < 0.5
        peer = "global_enterprise" if glob else "domestic_enterprise"
        p.update(capture_rate=rng.uniform(1.5, 2.8), velocity=rng.uniform(16, 34), ticket=rng.uniform(5000, 50000),
                 xb=rng.uniform(0.62, 0.9) if glob else rng.uniform(0.05, 0.4),
                 boarding_rate=rng.uniform(0.05, 0.15), payout_rate=rng.uniform(0.3, 0.5),
                 payout_amt=rng.uniform(40000, 250000), volatility=rng.uniform(0.05, 0.15))
    elif archetype == "payfac":
        entity = "PAYFAC"
        segment = "SMB" if rng.random() < 0.5 else "MID_MARKET"
        peer = "payfac_platform"
        p.update(capture_rate=rng.uniform(1.0, 2.0), velocity=rng.uniform(10, 26), boarding_rate=rng.uniform(0.2, 0.45),
                 payout_rate=0.2, payout_amt=rng.uniform(8000, 40000), xb=rng.uniform(0, 0.5))
    elif archetype == "high_risk_mcc":
        p["mcc"] = rng.choice(RISKY_MCCS)
        peer = "smb_high_risk_vertical"
    elif archetype == "seasonal_refund":
        p["refund"] = rng.uniform(0.12, 0.26)
        peer = "smb_retail"
    else:
        raise ValueError(archetype)
    return p, entity, segment, peer


# fraud type -> (base archetype, n_fraud_events range)
FRAUD_TYPES = {
    "cash_out": ("smb_instant", (5, 10)),
    "ato_bank_change": ("smb_standard", (5, 9)),
    "card_testing": ("smb_standard", (6, 11)),
    "refund_abuse": ("smb_standard", (5, 9)),
    "synthetic_boarding": ("payfac", (5, 8)),
    "identity_boarding": ("payfac", (6, 10)),
    "chargeback_spike": ("smb_standard", (5, 9)),
    "mcc_laundering": ("high_risk_mcc", (5, 9)),
}
FRAUD_MIX = (["cash_out"] * 7 + ["ato_bank_change"] * 5 + ["card_testing"] * 5 + ["refund_abuse"] * 3
             + ["synthetic_boarding"] * 2 + ["identity_boarding"] * 4 + ["chargeback_spike"] * 3
             + ["mcc_laundering"] * 2)
STEALTH_TYPES = ["stealth_payout", "stealth_capture"]

BACKGROUND_MIX = (["smb_instant"] * 70 + ["smb_standard"] * 70 + ["mid_market"] * 40 + ["enterprise"] * 30
                  + ["payfac"] * 35 + ["high_risk_mcc"] * 8 + ["seasonal_refund"] * 12)


# ---------------------------------------------------------------------------
# feature draws
# ---------------------------------------------------------------------------

def legit_features(rng: random.Random, c: Client, rtype: str) -> dict:
    p = c.params
    quiet = p.get("quiet", False)
    if rtype == "CAPTURE":
        z = rng.gauss(0, 1.0)
        if quiet:
            z = clip(z, -2.5, 2.5)
        elif rng.random() < 0.002:
            z = rng.uniform(4.1, 6.0)          # legitimate one-off large order
        cb = max(0.0, rng.gauss(p["cb"], 0.003))
        if not quiet and rng.random() < 0.0015:
            cb = rng.uniform(0.051, 0.08)        # legitimate dispute cluster
        new_dev = (not quiet) and rng.random() < p["new_device"]
        vel = max(0, round(rng.gauss(p["velocity"], p["velocity"] * 0.3)))
        return {
            "amount": round(rng.lognormvariate(math.log(p["ticket"]), 0.5), 2),
            "txn_count_1h": min(vel, 25) if quiet else vel,
            "ticket_z_score": round(z, 2),
            "device_age_hours": round(rng.uniform(0, 300) if new_dev else rng.uniform(500, 20000), 1),
            "cross_border_share": round(clip(rng.gauss(p["xb"], 0.06), 0, 0.55 if quiet else 1.0), 3),
            "mcc": p["mcc"],
            "chargeback_rate_7d": round(cb, 4),
        }
    if rtype in ("PAYOUT", "INSTANT_PAYOUT"):
        median = (p["instant_amt"] if rtype == "INSTANT_PAYOUT" else p["payout_amt"]) or 100.0
        refund = max(0.0, rng.gauss(p["refund"], 0.025))
        if quiet:
            refund = min(refund, 0.12)
        return {
            "amount": round(rng.lognormvariate(math.log(median), 0.3), 2),
            "refund_ratio_30d": round(refund, 3),
            # payouts_24h and hours_since_bank_change are derived from the timeline later
        }
    if rtype == "SUBMERCHANT_BOARDING":
        ims = rng.uniform(0.80, 0.97) if (not quiet and rng.random() < 0.045) else (rng.random() ** 2) * 0.75
        return {
            "identity_mismatch_score": round(ims, 3),
            "synthetic_id_score": round((rng.random() ** 3) * 0.6, 3),
        }
    raise ValueError(rtype)


def fraud_features(rng: random.Random, c: Client, ftype: str) -> tuple[str, dict, float | None]:
    """Return (request_type, features, forced hours_since_bank_change)."""
    if ftype == "cash_out":
        f = legit_features(rng, c, "INSTANT_PAYOUT")
        f["amount"] = round(rng.uniform(650, 1500) if rng.random() < 0.15
                            else max(1800.0, rng.lognormvariate(math.log(3000), 0.35)), 2)
        return "INSTANT_PAYOUT", f, None
    if ftype == "ato_bank_change":
        f = legit_features(rng, c, "PAYOUT")
        f["amount"] = round(rng.uniform(3000, 15000), 2)
        hrs = rng.uniform(28, 56) if rng.random() < 0.15 else rng.uniform(0.5, 20)
        return "PAYOUT", f, hrs
    if ftype == "card_testing":
        f = legit_features(rng, c, "CAPTURE")
        f["txn_count_1h"] = rng.randint(32, 44) if rng.random() < 0.12 else round(loguniform(rng, 45, 220))
        f["ticket_z_score"] = round(rng.uniform(4.2, 9) if rng.random() < 0.35 else rng.gauss(1.5, 1.0), 2)
        if rng.random() < 0.4:
            f["device_age_hours"] = round(rng.uniform(0, 8), 1)
        if rng.random() < 0.5:
            f["cross_border_share"] = round(rng.uniform(0.7, 0.98), 3)
        return "CAPTURE", f, None
    if ftype == "refund_abuse":
        f = legit_features(rng, c, "PAYOUT")
        f["refund_ratio_30d"] = round(rng.uniform(0.22, 0.6), 3)
        return "PAYOUT", f, None
    if ftype == "synthetic_boarding":
        f = legit_features(rng, c, "SUBMERCHANT_BOARDING")
        f["synthetic_id_score"] = round(rng.uniform(0.96, 0.995), 3)
        f["identity_mismatch_score"] = round(rng.uniform(0.6, 0.99), 3)
        return "SUBMERCHANT_BOARDING", f, None
    if ftype == "identity_boarding":
        f = legit_features(rng, c, "SUBMERCHANT_BOARDING")
        # Fraud crowds the top of the score range, densest just above where the rule
        # was tuned — which is why this rule has no flat stretch.
        u = rng.random()
        f["identity_mismatch_score"] = round(rng.uniform(0.70, 0.80) if u < 0.08
                                             else rng.uniform(0.80, 0.83) if u < 0.5
                                             else rng.uniform(0.83, 0.99), 3)
        return "SUBMERCHANT_BOARDING", f, None
    if ftype == "chargeback_spike":
        f = legit_features(rng, c, "CAPTURE")
        f["chargeback_rate_7d"] = round(rng.uniform(0.06, 0.25), 4)
        if rng.random() < 0.4:
            f["cross_border_share"] = round(rng.uniform(0.65, 0.95), 3)
        return "CAPTURE", f, None
    if ftype == "mcc_laundering":
        f = legit_features(rng, c, "CAPTURE")
        f["amount"] = round(f["amount"] * rng.uniform(3, 8), 2)
        return "CAPTURE", f, None
    if ftype == "stealth_payout":
        f = legit_features(rng, c, "INSTANT_PAYOUT")
        f["amount"] = round(rng.uniform(60, 95), 2)
        return "INSTANT_PAYOUT", f, None
    if ftype == "stealth_capture":
        f = legit_features(rng, c, "CAPTURE")
        f["txn_count_1h"] = rng.randint(20, 29)
        return "CAPTURE", f, None
    raise ValueError(ftype)


# ---------------------------------------------------------------------------
# event timelines
# ---------------------------------------------------------------------------

def background_events(rng: random.Random, c: Client) -> list[Event]:
    p = c.params
    weekly = [max(0.1, rng.lognormvariate(0, p["volatility"])) for _ in range(WINDOW_DAYS // 7 + 1)]
    events = []
    rates = [("CAPTURE", p["capture_rate"]), ("PAYOUT", p["payout_rate"]),
             ("INSTANT_PAYOUT", p["instant_rate"]), ("SUBMERCHANT_BOARDING", p["boarding_rate"])]
    for rtype, rate in rates:
        if rate <= 0:
            continue
        for day in range(WINDOW_DAYS):
            for _ in range(poisson(rng, rate * weekly[day // 7])):
                t = day * 24 + rng.uniform(0, 24)
                events.append(Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, t, legit_features(rng, c, rtype)))
    # A legitimate bank-account change is often followed by a test payout.
    for bc in c.bank_changes:
        if 0 <= bc < WINDOW_HOURS - 72 and rng.random() < 0.8:
            t = bc + rng.uniform(1, 71)
            events.append(Event(c.client_id, "PRE_PAYOUT", "PAYOUT", t, legit_features(rng, c, "PAYOUT")))
    return events


def fraud_events(rng: random.Random, c: Client, ftype: str, n: int) -> list[Event]:
    """Fraud arrives in a burst: a run of days somewhere in the window."""
    start = rng.uniform(5 * 24, WINDOW_HOURS - 12 * 24)
    span = rng.uniform(2, 10) * 24
    events = []
    for _ in range(n):
        rtype, f, forced_bank = fraud_features(rng, c, ftype)
        ev = Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, start + rng.uniform(0, span), f, fraud_type=ftype)
        if forced_bank is not None:
            ev.features["hours_since_bank_change"] = round(forced_bank, 1)
        events.append(ev)
    return events


def derive_timeline_features(clients: dict[str, Client], events: list[Event]) -> None:
    """Fill features that depend on a client's own timeline: payouts_24h, hours_since_bank_change."""
    by_client: dict[str, list[Event]] = {}
    for ev in events:
        if ev.request_type in ("PAYOUT", "INSTANT_PAYOUT"):
            by_client.setdefault(ev.client_id, []).append(ev)
    for cid, evs in by_client.items():
        evs.sort(key=lambda e: e.t)
        times = [e.t for e in evs]
        changes = sorted(clients[cid].bank_changes)
        lo = 0
        for i, ev in enumerate(evs):
            while times[lo] <= ev.t - 24:
                lo += 1
            if "payouts_24h" not in ev.features:
                ev.features["payouts_24h"] = i - lo + 1
            if "hours_since_bank_change" not in ev.features:
                prior = [b for b in changes if b <= ev.t]
                ev.features["hours_since_bank_change"] = round(ev.t - prior[-1], 1) if prior else 99999.0
