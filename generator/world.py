"""Coherent synthetic world: client profiles drive behaviour, behaviour drives rule hits.

Everything here is synthetic and built for demonstration. Names are fictional.
Time is carried internally as float hours since WINDOW_START (0 .. WINDOW_HOURS).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone

from contract import schema

_EPOCH = datetime.strptime(schema.WINDOW_START, schema.TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
WINDOW_HOURS = (datetime.strptime(schema.WINDOW_END, schema.TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
                - _EPOCH).total_seconds() / 3600.0
WINDOW_DAYS = int(WINDOW_HOURS // 24)


def at(date: str, hour: float = 12.0) -> float:
    """'2026-09-04' -> hours since WINDOW_START."""
    d = datetime.strptime(date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return (d - _EPOCH).total_seconds() / 3600.0 + hour


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
    device_changes: list = field(default_factory=list)   # hours
    disputes_per_year: float = 0.3


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
    "SETTLEMENT": "PRE_SETTLEMENT",
    "PAYOUT": "PRE_PAYOUT",
    "INSTANT_PAYOUT": "PRE_PAYOUT",
    "BULK_PAYOUT": "PRE_PAYOUT",
    "SUBMERCHANT_BOARDING": "CLIENT_BOARDING",
}
PAYOUT_TYPES = {"PAYOUT", "INSTANT_PAYOUT", "BULK_PAYOUT"}


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
# fictional names and identifiers
# ---------------------------------------------------------------------------

_PREFIX = ["Amber", "Birch", "Cobalt", "Driftwood", "Ember", "Fernhill", "Granite", "Hollow", "Ivory",
           "Jasper", "Kestrel", "Linden", "Marigold", "Nettle", "Opal", "Pebble", "Quill", "Rowan",
           "Saffron", "Thistle", "Umber", "Velvet", "Willow", "Yarrow", "Zephyr", "Bramble", "Cinder",
           "Dovetail", "Elm", "Foxglove", "Gull", "Heron", "Inkwell", "Juniper", "Kiln", "Lark", "Moss",
           "Nimbus", "Orchard", "Pinecone", "Quarry", "Ridge", "Sparrow", "Tidewater", "Upland", "Vale",
           "Wren", "Copper", "Slate", "Clover", "Marlow", "Brightwater", "Ashgrove", "Fable", "Harbour"]
_NOUN = ["Provisions", "Goods", "Works", "Trading", "Supply", "Studio", "Outfitters", "Kitchen", "Market",
         "Logistics", "Labs", "Collective", "Mercantile", "Atelier", "Freight", "Partners", "Wares",
         "Systems", "Commerce", "Exchange", "Bakery", "Florists", "Print", "Tools", "Cafe"]
_SUFFIX = ["Co.", "Ltd", "LLC", "Group", "Inc.", ""]


def fictional_names(rng: random.Random, n: int, taken: set[str]) -> list[str]:
    names = []
    while len(names) < n:
        name = f"{rng.choice(_PREFIX)} {rng.choice(_NOUN)} {rng.choice(_SUFFIX)}".strip()
        if name not in taken:
            taken.add(name)
            names.append(name)
    return names


def client_id_for(rng: random.Random, name: str, taken: set[str]) -> str:
    """ACME-0417 style: four letters from the name, four digits."""
    letters = "".join(ch for ch in name.upper() if ch.isalpha())
    prefix = (letters + "XXXX")[:4]
    while True:
        cid = f"{prefix}-{rng.randint(1000, 9999):04d}"
        if cid not in taken:
            taken.add(cid)
            return cid


# ---------------------------------------------------------------------------
# background archetypes
# ---------------------------------------------------------------------------

def _base_params(rng):
    return {
        "capture_rate": rng.uniform(0.25, 0.45),
        "ticket": rng.uniform(200, 1500),
        "geo": rng.uniform(0.0, 0.2),
        "new_device": rng.uniform(0.01, 0.04),
        "settle_rate": rng.uniform(0.25, 0.45),
        "spike": rng.uniform(0.02, 0.08),          # share of settlements with a 3-4x legitimate spike
        "payout_rate": rng.uniform(0.05, 0.28),
        "payout_amt": _smb_payout_median(rng),
        "instant_share": rng.uniform(0.0, 0.7),
        "bulk": False,
        "new_cp": rng.uniform(0.01, 0.06),
        "refund": rng.uniform(0.01, 0.08),
        "boarding_rate": 0.0,
        "volatility": rng.uniform(0.05, 0.2) if rng.random() < 0.8 else rng.uniform(0.4, 0.8),
        "quiet": False,
    }


def _smb_payout_median(rng):
    u = rng.random()
    if u < 0.35:
        return rng.uniform(35, 100)
    if u < 0.93:
        return rng.uniform(100, 350)
    return loguniform(rng, 350, 2000)


def archetype_params(rng: random.Random, archetype: str) -> tuple[dict, str, str, str]:
    """Return (params, entity, segment, peer_group) for a background archetype."""
    p = _base_params(rng)
    entity, segment = "DIRECT", "SMB"
    peer = rng.choice(["smb_retail", "smb_services", "smb_food"])
    if archetype == "smb":
        pass
    elif archetype == "seasonal_refund":
        p["refund"] = rng.uniform(0.14, 0.17)
        peer = "smb_retail"
    elif archetype == "mid_market":
        segment, peer = "MID_MARKET", rng.choice(["mm_retail", "mm_services"])
        p.update(capture_rate=rng.uniform(0.3, 0.5), settle_rate=rng.uniform(0.25, 0.35), ticket=rng.uniform(2000, 9000),
                 payout_rate=rng.uniform(0.2, 0.35), payout_amt=rng.uniform(5000, 30000), bulk=True,
                 geo=rng.uniform(0, 0.35))
    elif archetype == "enterprise":
        segment = "ENTERPRISE"
        glob = rng.random() < 0.5
        peer = "global_enterprise" if glob else "domestic_enterprise"
        p.update(capture_rate=rng.uniform(0.6, 0.8), settle_rate=rng.uniform(0.45, 0.55), ticket=rng.uniform(5000, 50000),
                 geo=rng.uniform(0.62, 0.9) if glob else rng.uniform(0.05, 0.4),
                 boarding_rate=rng.uniform(0.05, 0.15), payout_rate=rng.uniform(0.3, 0.5), bulk=True,
                 payout_amt=rng.uniform(40000, 250000), volatility=rng.uniform(0.05, 0.15), spike=rng.uniform(0.01, 0.03))
    elif archetype == "payfac":
        entity = "PAYFAC"
        segment = "SMB" if rng.random() < 0.5 else "MID_MARKET"
        peer = "payfac_platform"
        p.update(capture_rate=rng.uniform(0.4, 0.6), settle_rate=rng.uniform(0.35, 0.45), boarding_rate=rng.uniform(0.25, 0.5),
                 payout_rate=0.25, payout_amt=rng.uniform(8000, 40000), bulk=True, geo=rng.uniform(0, 0.45))
    else:
        raise ValueError(archetype)
    return p, entity, segment, peer


# fraud type -> (base archetype, actors, episodes per actor, events per episode)
FRAUD_TYPES = {
    "cash_out": ("smb", 6, 4, 10),
    "ato_device": ("smb", 5, 4, 7),
    "mule_counterparty": ("smb", 4, 3, 6),
    "refund_abuse": ("smb", 4, 5, 5),
    "velocity_burst": ("smb", 4, 3, 8),
    "doc_fraud": ("payfac", 4, 4, 7),
    "geo_card_testing": ("smb", 4, 3, 8),
    "payout_burst": ("smb", 3, 4, 6),
    "stealth": ("smb", 4, 3, 4),
}

BACKGROUND_MIX = ["smb"] * 151 + ["seasonal_refund"] * 12 + ["mid_market"] * 35 + ["enterprise"] * 30 + ["payfac"] * 35


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
        new_dev = (not quiet) and rng.random() < p["new_device"]
        return {
            "amount": round(rng.lognormvariate(math.log(p["ticket"]), 0.5), 2),
            "geo_mismatch_share": round(clip(rng.gauss(p["geo"], 0.06), 0, 0.5 if quiet else 1.0), 3),
            "ticket_z_score": round(z, 2),
            "device_age_hours": round(rng.uniform(0, 300) if new_dev else rng.uniform(500, 20000), 1),
        }
    if rtype == "SETTLEMENT":
        u = rng.random()
        if not quiet and u < p["spike"]:
            ratio = rng.uniform(3.0, 3.98)            # legitimate sales spike
        elif not quiet and u < p["spike"] + 0.004:
            ratio = rng.uniform(4.0, 6.0)             # rare legitimate surge past 4x
        else:
            ratio = min(rng.lognormvariate(0, 0.3), 2.6)
        return {
            "amount": round(rng.lognormvariate(math.log(p["ticket"] * 3), 0.4), 2),
            "txn_velocity_ratio": round(ratio, 2),
        }
    if rtype in PAYOUT_TYPES:
        refund = max(0.0, rng.gauss(p["refund"], 0.012))
        if quiet:
            refund = min(refund, 0.12)
        new_cp = (not quiet) and rng.random() < p["new_cp"]
        return {
            "amount": round(rng.lognormvariate(math.log(p["payout_amt"]), 0.3), 2),
            "refund_ratio_30d": round(refund, 3),
            "counterparty_age_days": rng.randint(0, 13) if new_cp else rng.randint(30, 2000),
            # payouts_24h and hours_since_device_change are derived from the timeline later
        }
    if rtype == "SUBMERCHANT_BOARDING":
        score = rng.uniform(0.80, 0.97) if (not quiet and rng.random() < 0.05) else (rng.random() ** 2) * 0.75
        return {"doc_mismatch_score": round(score, 3)}
    raise ValueError(rtype)


def payout_type(rng, c: Client) -> str:
    if c.params["bulk"]:
        return "BULK_PAYOUT"
    return "INSTANT_PAYOUT" if rng.random() < c.params["instant_share"] else "PAYOUT"


def fraud_episode(rng: random.Random, c: Client, ftype: str, start: float, n: int) -> list[Event]:
    """One burst of fraud: n events over a few days starting at `start`."""
    events = []
    span = rng.uniform(2, 8) * 24
    if ftype in ("cash_out", "payout_burst"):
        # payouts in quick succession, so payouts_24h climbs
        t = start
        for _ in range(n):
            t += rng.uniform(1, 5)
            rtype = "INSTANT_PAYOUT"
            f = legit_features(rng, c, rtype)
            if ftype == "cash_out":
                f["amount"] = round(rng.uniform(1850, 2150) if rng.random() < 0.3
                                    else max(2150.0, rng.lognormvariate(math.log(3200), 0.3)), 2)
            else:
                f["amount"] = round(rng.uniform(40, 99), 2)
            f["counterparty_age_days"] = rng.randint(30, 400)
            events.append(Event(c.client_id, "PRE_PAYOUT", rtype, t, f, fraud_type=ftype))
        return events
    for _ in range(n):
        t = start + rng.uniform(0, span)
        if ftype == "ato_device":
            rtype = "PAYOUT"
            f = legit_features(rng, c, rtype)
            f["amount"] = round(rng.uniform(2000, 9000), 2)
            f["counterparty_age_days"] = rng.randint(30, 400)
            u = rng.random()
            # takeovers cash out just inside the 48-hour window the rule was tuned to
            f["hours_since_device_change"] = round(rng.uniform(45, 48) if u < 0.5 else rng.uniform(2, 45) if u < 0.9
                                                   else rng.uniform(48, 70), 1)
        elif ftype == "mule_counterparty":
            rtype = "PAYOUT"
            f = legit_features(rng, c, rtype)
            f["amount"] = round(rng.uniform(40, 99), 2)
            # mules are paid soon after being added, often just inside the 14-day window
            f["counterparty_age_days"] = rng.randint(8, 10) if rng.random() < 0.5 else rng.randint(0, 7)
        elif ftype == "refund_abuse":
            rtype = "PAYOUT"
            f = legit_features(rng, c, rtype)
            f["amount"] = round(rng.uniform(40, 99), 2)
            f["counterparty_age_days"] = rng.randint(30, 400)
            f["refund_ratio_30d"] = round(rng.uniform(0.185, 0.2) if rng.random() < 0.5 else rng.uniform(0.2, 0.6), 3)
        elif ftype == "velocity_burst":
            rtype = "SETTLEMENT"
            f = legit_features(rng, c, rtype)
            f["txn_velocity_ratio"] = round(rng.uniform(4.05, 4.5) if rng.random() < 0.25 else loguniform(rng, 4.5, 15), 2)
        elif ftype == "doc_fraud":
            rtype = "SUBMERCHANT_BOARDING"
            u = rng.random()
            f = {"doc_mismatch_score": round(rng.uniform(0.80, 0.82) if u < 0.55 else rng.uniform(0.82, 0.99) if u < 0.92
                                             else rng.uniform(0.70, 0.80), 3)}
        elif ftype == "geo_card_testing":
            rtype = "CAPTURE"
            f = legit_features(rng, c, rtype)
            f["geo_mismatch_share"] = round(rng.uniform(0.66, 0.98), 3)
            if rng.random() < 0.35:
                f["ticket_z_score"] = round(rng.uniform(4.2, 9), 2)
            if rng.random() < 0.4:
                f["device_age_hours"] = round(rng.uniform(0, 8), 1)
        elif ftype == "stealth":
            # fraud that slips under every threshold: small payouts, ordinary captures
            rtype = "PAYOUT" if rng.random() < 0.5 else "CAPTURE"
            f = legit_features(rng, c, rtype)
            if rtype == "PAYOUT":
                f.update(amount=round(rng.uniform(40, 95), 2), counterparty_age_days=rng.randint(30, 400),
                         refund_ratio_30d=min(f["refund_ratio_30d"], 0.1))
        else:
            raise ValueError(ftype)
        events.append(Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, t, f, fraud_type=ftype))
    return events


# Controlled edge cases: where each kind of fraud starts, placed on a fixed cadence so
# every window holds the same evidence about where a rule's free stretch ends.
EDGE_CASES = {
    "cash_out": ("INSTANT_PAYOUT", lambda r: {"amount": round(r.uniform(1850, 1990), 2),
                                              "counterparty_age_days": r.randint(30, 400)}),
    "velocity_burst": ("SETTLEMENT", lambda r: {"txn_velocity_ratio": round(r.uniform(4.05, 4.45), 2)}),
    "refund_abuse": ("PAYOUT", lambda r: {"refund_ratio_30d": round(r.uniform(0.182, 0.189), 3),
                                          "amount": round(r.uniform(40, 99), 2),
                                          "counterparty_age_days": r.randint(30, 400)}),
    "doc_fraud": ("SUBMERCHANT_BOARDING", lambda r: {"doc_mismatch_score": round(r.uniform(0.801, 0.804), 3)}),
    "ato_device": ("PAYOUT", lambda r: {"hours_since_device_change": round(r.uniform(47.1, 47.9), 1),
                                        "amount": round(r.uniform(2000, 9000), 2),
                                        "counterparty_age_days": r.randint(30, 400)}),
    "mule_counterparty": ("PAYOUT", lambda r: {"counterparty_age_days": 10, "amount": round(r.uniform(40, 99), 2)}),
    "geo_card_testing": ("CAPTURE", lambda r: {"geo_mismatch_share": round(r.uniform(0.665, 0.669), 3),
                                               "ticket_z_score": round(r.uniform(4.25, 4.35), 2)}),
}


def edge_fraud(rng: random.Random, c: Client, ftype: str, t: float) -> Event:
    rtype, feats = EDGE_CASES[ftype]
    f = legit_features(rng, c, rtype) if rtype != "SUBMERCHANT_BOARDING" else {}
    f.update(feats(rng))
    return Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, t, f, fraud_type=ftype)


# ---------------------------------------------------------------------------
# event timelines
# ---------------------------------------------------------------------------

def background_events(rng: random.Random, c: Client, payouts_until: float = WINDOW_HOURS) -> list[Event]:
    p = c.params
    weekly = [max(0.1, rng.lognormvariate(0, p["volatility"])) for _ in range(WINDOW_DAYS // 7 + 2)]
    events = []
    rates = [("CAPTURE", p["capture_rate"]), ("SETTLEMENT", p["settle_rate"]),
             ("PAYOUT", p["payout_rate"]), ("SUBMERCHANT_BOARDING", p["boarding_rate"])]
    for kind, rate in rates:
        if rate <= 0:
            continue
        for day in range(WINDOW_DAYS):
            for _ in range(poisson(rng, rate * weekly[day // 7])):
                t = day * 24 + rng.uniform(0, 24)
                if kind == "PAYOUT" and t >= payouts_until:
                    continue
                rtype = payout_type(rng, c) if kind == "PAYOUT" else kind
                events.append(Event(c.client_id, CHECKPOINT_FOR[rtype], rtype, t, legit_features(rng, c, rtype)))
    return events


def derive_timeline_features(clients: dict[str, Client], events: list[Event]) -> None:
    """Fill features that depend on a client's own timeline: payouts_24h, hours_since_device_change."""
    by_client: dict[str, list[Event]] = {}
    for ev in events:
        if ev.request_type in PAYOUT_TYPES:
            by_client.setdefault(ev.client_id, []).append(ev)
    for cid, evs in by_client.items():
        evs.sort(key=lambda e: e.t)
        times = [e.t for e in evs]
        changes = sorted(clients[cid].device_changes)
        lo = 0
        for i, ev in enumerate(evs):
            while times[lo] <= ev.t - 24:
                lo += 1
            if "payouts_24h" not in ev.features:
                ev.features["payouts_24h"] = i - lo + 1
            if "hours_since_device_change" not in ev.features:
                prior = [d for d in changes if d <= ev.t]
                ev.features["hours_since_device_change"] = round(ev.t - prior[-1], 1) if prior else 99999.0
