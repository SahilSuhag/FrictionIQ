"""Fields from the payment API contract, added on top of the seeded world.

Everything here is drawn from a hash of an ID, or from its own random stream, after the
rules have run. The seeded world (clients, events, rule hits, fraud labels) is untouched,
so every number the screens showed before stays the same.

- Clients: ECID, merchant category code (MCC), processing country.
- Card payments: channel (the API's InitiatorType), recurring flag.
- Every payment: transaction ID, idempotency key; for ISV platforms, the sub-merchant.
- Account-level actions: reviews, capability restrictions, reserves, blocks, recoveries.
"""

from __future__ import annotations

import hashlib
import random

from contract import schema

from .registry import CHANNELS as RULE_CHANNELS
from .world import WINDOW_HOURS, Client, Event

PAYOUTS = {"PAYOUT", "INSTANT_PAYOUT", "BULK_PAYOUT"}


def _h(*parts) -> int:
    return int(hashlib.sha256(":".join(str(p) for p in parts).encode()).hexdigest(), 16)


def _u(*parts) -> float:
    """A uniform number in [0, 1) from a hash."""
    return (_h(*parts) % 10**9) / 10**9


def _pick(u: float, weighted: list[tuple]) -> object:
    total = sum(w for _, w in weighted)
    acc = 0.0
    for v, w in weighted:
        acc += w / total
        if u < acc:
            return v
    return weighted[-1][0]


# ---------------------------------------------------------------- clients

MCC_BY_PEER = {
    "smb_retail": [5651, 5732, 5999, 5311], "smb_services": [7299, 7349, 8999], "smb_food": [5812, 5814],
    "mm_retail": [5311, 5651, 5732], "mm_services": [7399, 8742],
    "global_enterprise": [4722, 5045, 5732], "domestic_enterprise": [5411, 5311, 4900],
    "payfac_platform": [7372],
}
MCC_BY_SEGMENT = {"SMB": [5999, 7299], "MID_MARKET": [7399, 5311], "ENTERPRISE": [5311, 4722]}
COUNTRIES = {"CA": [("CAN", 1)], "US": [("USA", 1)],
             "EMEA": [("GBR", 50), ("DEU", 25), ("FRA", 15), ("IRL", 10)],
             "APAC": [("AUS", 50), ("SGP", 30), ("JPN", 20)]}


def ecid_of(c: Client) -> str:
    return str(100_000_000 + _h("ecid", c.client_id) % 900_000_000)


def mcc_of(c: Client) -> int:
    options = MCC_BY_PEER["payfac_platform"] if c.entity == "PAYFAC" else \
        MCC_BY_PEER.get(c.peer_group or "", MCC_BY_SEGMENT[c.segment])
    return options[_h("mcc", c.client_id) % len(options)]


def country_of(client_id: str, region: str) -> str:
    return _pick(_u("country", client_id), COUNTRIES[region])


# ---------------------------------------------------------------- card payments

# Each client's channel mix, by industry: (card present, keyed-in, card not present).
CHANNEL_MIX = {"Restaurants": (85, 5, 10), "Retail": (55, 5, 40), "Services": (35, 30, 35),
               "Travel": (10, 15, 75), "Wholesale": (10, 35, 55), "Utilities": (5, 15, 80),
               "Software": (5, 5, 90), "Grocery": (90, 2, 8)}
RECURRING_SHARE = {"Software": 0.45, "Utilities": 0.6, "Services": 0.2}   # of online payments
POS, KEYED, CNP = schema.CHANNELS


def _channel_mix(c: Client) -> tuple:
    return CHANNEL_MIX[schema.MCC[mcc_of(c)][1]]


def assign_event_fields(clients: dict[str, Client], events: list[Event], hits: list[dict]) -> None:
    """Channel, recurring flag, transaction ID, idempotency key and sub-merchant for every event.

    Channel is the API's InitiatorType. It is set after the rules ran so it agrees with the rules
    bound to a channel: a payment a card-not-present rule fired on was keyed in or made online,
    one a card-present rule fired on was made at a terminal.
    """
    needs: dict[str, set] = {}
    for h in hits:
        ch = RULE_CHANNELS.get(h["rule_id"])
        if ch:
            needs.setdefault(h["event_id"], set()).add(ch)
    subs = sub_merchants(clients)
    for ev in events:
        c = clients[ev.client_id]
        if ev.request_type == "CAPTURE":
            pos, keyed, cnp = _channel_mix(c)
            need = needs.get(ev.event_id, set())
            if "CARD_NOT_PRESENT" in need or ev.fraud_type == "geo_card_testing":
                ev.channel = _pick(_u("ch", ev.event_id), [(KEYED, keyed), (CNP, cnp)])
            elif "CARD_PRESENT" in need:
                ev.channel = POS
            else:
                ev.channel = _pick(_u("ch", ev.event_id), [(POS, pos), (KEYED, keyed), (CNP, cnp)])
            if ev.channel == CNP and not ev.fraud_type:
                share = RECURRING_SHARE.get(schema.MCC[mcc_of(c)][1], 0.1)
                ev.is_recurring = "TRUE" if _u("rec", ev.event_id) < share else "FALSE"
            else:
                ev.is_recurring = "FALSE"
        if ev.request_type != "SUBMERCHANT_BOARDING":
            ev.transaction_id = "TX" + format(_h("tx", ev.event_id) % 16**12, "012X")
        else:
            ev.transaction_id = ""
        k = format(_h("idem", ev.event_id) % 16**32, "032x")
        ev.idempotency_key = f"{k[:8]}-{k[8:12]}-{k[12:16]}-{k[16:20]}-{k[20:]}"
        if c.entity == "PAYFAC":
            if ev.request_type == "SUBMERCHANT_BOARDING":
                ev.sub_merchant_id = f"{c.client_id}-A{_h('app', ev.event_id) % 10**4:04d}"
            else:
                active = subs[c.client_id]
                # a few sub-merchants carry most of a platform's volume
                ev.sub_merchant_id = _pick(_u("sm", ev.event_id), [(s, 1 / (i + 1)) for i, s in enumerate(active)])


_FIRST = ["Juniper", "Copper", "Maple", "Harbor", "Lumen", "Atlas", "Willow", "Cobalt", "Sable", "Fern",
          "Orchid", "Granite", "Saffron", "Birch", "Indigo", "Marlow", "Quill", "Ember", "Tidewater", "Aspen"]
_SECOND = ["Bakery", "Studio", "Outfitters", "Repair", "Florist", "Cafe", "Fitness", "Books", "Salon",
           "Print Co.", "Supply", "Kitchen", "Market", "Tailors", "Pets", "Garden", "Cycles", "Dental", "Spa", "Tutors"]
_SUB_MCC = [5812, 5814, 5651, 5999, 7299, 7349, 8999, 5732]


def _sub_name(sub_id: str) -> str:
    return f"{_FIRST[_h('n1', sub_id) % len(_FIRST)]} {_SECOND[_h('n2', sub_id) % len(_SECOND)]}"


def sub_merchants(clients: dict[str, Client]) -> dict[str, list[str]]:
    return {c.client_id: [f"{c.client_id}-S{k + 1:02d}" for k in range(6 + _h("nsub", c.client_id) % 15)]
            for c in clients.values() if c.entity == "PAYFAC"}


def sub_merchant_rows(clients: dict[str, Client], events: list[Event]) -> list[dict]:
    rows = [{"sub_merchant_id": s, "client_id": cid, "name": _sub_name(s),
             "mcc": _SUB_MCC[_h("smcc", s) % len(_SUB_MCC)], "status": "ACTIVE"}
            for cid, subs in sub_merchants(clients).items() for s in subs]
    seen = set()
    for ev in events:
        if ev.request_type == "SUBMERCHANT_BOARDING" and ev.sub_merchant_id and ev.sub_merchant_id not in seen:
            seen.add(ev.sub_merchant_id)
            rows.append({"sub_merchant_id": ev.sub_merchant_id, "client_id": ev.client_id,
                         "name": _sub_name(ev.sub_merchant_id), "mcc": _SUB_MCC[_h("smcc", ev.sub_merchant_id) % 8],
                         "status": "APPLICANT"})
    return sorted(rows, key=lambda r: r["sub_merchant_id"])


# ---------------------------------------------------------------- account-level actions

def account_actions(seed: int, clients: dict[str, Client], events: list[Event], hits: list[dict],
                    fraud_cases: list[dict], ts) -> list[dict]:
    """Reviews, capability restrictions, reserves, blocks and recoveries, from their own random stream."""
    rng = random.Random(f"{seed}-account-actions")
    out = []
    by_client: dict[str, list[Event]] = {}
    for ev in events:
        by_client.setdefault(ev.client_id, []).append(ev)
    prevailed = {h["event_id"] for h in hits if h["action_taken"] == "PREVAILED"}
    amount_of = {ev.event_id: ev.features.get("amount") for ev in events}

    def add(cid, kind, start, end=None, **kw):
        out.append({"client_id": cid, "action_type": kind, "started_at": start, "ended_at": end, **kw})

    fraud_by_client: dict[str, list[dict]] = {}
    for fc in fraud_cases:
        fraud_by_client.setdefault(fc["client_id"], []).append(fc)

    for cid in sorted(clients):
        c = clients[cid]
        evs = by_client.get(cid, [])
        last_event = max((e.t for e in evs), default=0.0)
        cases = sorted(fraud_by_client.get(cid, []), key=lambda f: f["confirmed_h"])
        if cases:
            # a confirmed case opens an account review (one per episode); money that got out is chased back
            last_review = -1e9
            for fc in cases:
                t = fc["confirmed_h"]
                if t - last_review > 30 * 24:
                    add(cid, "ACCOUNT_REVIEW", t, min(t + rng.uniform(24, 120), WINDOW_HOURS), outcome="UPHELD")
                    last_review = t
                amt = amount_of.get(fc["event_id"])
                if fc["event_id"] not in prevailed and amt:
                    if rng.random() < 0.65:
                        add(cid, "RECOVERY", t, min(t + rng.uniform(5, 30) * 24, WINDOW_HOURS),
                            recovered_usd=round(amt * rng.uniform(0.2, 0.9), 2), event_id=fc["event_id"],
                            outcome="RECOVERED")
                    else:
                        add(cid, "RECOVERY", t, min(t + rng.uniform(10, 40) * 24, WINDOW_HOURS),
                            recovered_usd=0.0, event_id=fc["event_id"], outcome="NOT_RECOVERED")
            # blocked once nothing more comes through after the last confirmed case
            block_at = cases[-1]["confirmed_h"] + 24
            if block_at < WINDOW_HOURS and last_event < block_at:
                add(cid, "BLOCK", block_at, None, detail="CONFIRMED_FRAUD")
            continue

        u = rng.random()
        industry = schema.MCC[mcc_of(c)][1]
        big = c.segment in ("MID_MARKET", "ENTERPRISE") or c.entity == "PAYFAC"
        if u < (0.16 if big or industry == "Travel" else 0.04):
            start = rng.uniform(0, WINDOW_HOURS - 24)
            # half are set indefinitely, until someone lifts them
            end = start + rng.uniform(30, 120) * 24 if rng.random() < 0.5 else WINDOW_HOURS + 1
            pct = rng.choice([5, 5, 10, 10, 15])
            cap = round(rng.choice([10, 25, 50, 100, 250]) * 1000 * (3 if c.segment == "ENTERPRISE" else 1), 0)
            sales = sum(e.features.get("amount") or 0 for e in evs
                        if e.request_type == "CAPTURE" and start <= e.t < min(end, WINDOW_HOURS))
            add(cid, "RESERVE", start, end if end < WINDOW_HOURS else None, reserve_pct=pct,
                reserve_cap_usd=cap, held_usd=round(min(cap, sales * pct / 100), 2))
        u = rng.random()
        if u < 0.07:
            mix = _channel_mix(c)
            detail = "KEYED_IN" if mix[1] >= 15 and rng.random() < 0.7 else rng.choice(["TERMINAL", "NEW_PRODUCT", "NEW_PRODUCT"])
            start = rng.uniform(0, WINDOW_HOURS - 24)
            end = start + rng.uniform(7, 60) * 24 if rng.random() < 0.55 else WINDOW_HOURS + 1
            add(cid, "CAPABILITY_RESTRICTION", start, end if end < WINDOW_HOURS else None, detail=detail)
        u = rng.random()
        if u < 0.08:
            start = rng.uniform(0, WINDOW_HOURS - 24) if rng.random() < 0.8 else rng.uniform(WINDOW_HOURS - 14 * 24, WINDOW_HOURS - 12)
            end = start + rng.uniform(2, 14) * 24
            add(cid, "ACCOUNT_REVIEW", start, end if end < WINDOW_HOURS else None,
                outcome=("CLEARED" if rng.random() < 0.85 else "UPHELD") if end < WINDOW_HOURS else "")
    out.sort(key=lambda a: (a["started_at"], a["client_id"], a["action_type"]))
    for i, a in enumerate(out):
        a["action_id"] = f"AA-{i + 1:04d}"
        a["started_h"], a["ended_h"] = a["started_at"], a["ended_at"]
        a["started_at"] = ts(a["started_at"])
        a["ended_at"] = "" if a["ended_at"] is None else ts(a["ended_at"])
    return out
