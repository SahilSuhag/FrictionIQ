"""Good-client bands: established, developing, limited history.

A proposal for discussion, not a validated construct. The definition rests on evidence
that is not itself a product of the controls, gathered over the full 12 months:

* tenure                — independent of any control decision
* review outcomes       — how challenges ended, not whether they fired
* confirmed fraud       — a disqualifier, never a score
* payout pattern        — week-to-week volume beyond Poisson noise, and the median payout
* disputes & chargebacks— account standing, which no fraud rule outputs

Banding rather than scoring: easier to defend, easier to explain, and it does not
imply a precision the inputs cannot support.
"""

from __future__ import annotations

import numpy as np

from .data import Dataset

ESTABLISHED, DEVELOPING, LIMITED = "established", "developing", "limited"


def _overdispersion(counts: np.ndarray) -> float:
    """Coefficient of variation in excess of Poisson noise: sqrt(max(0, var - mean)) / mean."""
    m = counts.mean()
    if m <= 0:
        return float("nan")
    return float(np.sqrt(max(0.0, counts.var(ddof=1) - m)) / m)


def evidence(ds: Dataset, prevailing: np.ndarray) -> list[dict]:
    n_weeks = int(np.ceil(ds.as_of / (24 * 7)))
    week = np.minimum((ds.event_t // (24 * 7)).astype(int), n_weeks - 1)
    weekly = np.zeros((ds.n_clients, n_weeks))
    np.add.at(weekly, (ds.event_client, week), 1)
    captures = np.bincount(ds.event_client[ds.event_request == "CAPTURE"], minlength=ds.n_clients)

    cleared = np.bincount(ds.hit_client[prevailing & (ds.hit_final == "CLEARED")], minlength=ds.n_clients)
    upheld = np.bincount(ds.hit_client[prevailing & (ds.hit_final == "UPHELD")], minlength=ds.n_clients)
    amounts = ds.features["amount"]

    out = []
    for i, c in enumerate(ds.clients):
        pay = amounts[(ds.event_client == i) & ds.event_is_payout]
        out.append({
            "tenure_months": c["tenure_months"],
            "challenges": int(cleared[i] + upheld[i]),
            "cleared": int(cleared[i]),
            "upheld": int(upheld[i]),
            "clear_rate": float(cleared[i] / (cleared[i] + upheld[i])) if cleared[i] + upheld[i] else None,
            "confirmed_fraud": int(ds.client_fraud_count[i]),
            "overdispersion": _overdispersion(weekly[i]),
            "median_payout": float(np.median(pay)) if pay.size else None,
            "disputes_12m": int(ds.client_disputes[i]),
            "captures_12m": int(captures[i]),
        })
    return out


def band(ev: dict, cfg: dict) -> dict:
    est, dev = cfg["good_client"]["established"], cfg["good_client"]["developing"]
    unknown = []

    if ev["confirmed_fraud"] > 0:
        return {"band": LIMITED, "disqualified": True, "unknown": [], "checks": {},
                "reasons": [f"{ev['confirmed_fraud']} confirmed fraud case(s), a disqualifier"]}

    tenure = ev["tenure_months"]
    if tenure is None:
        unknown.append("tenure")
    cr = ev["clear_rate"]
    stable = not np.isnan(ev["overdispersion"]) and ev["overdispersion"] <= est["max_overdispersion"]

    def standing_ok(level):
        return ev["disputes_12m"] <= max(level["max_disputes_12m"], level["max_dispute_rate"] * ev["captures_12m"])

    checks = {
        "tenure": tenure is not None and tenure >= est["min_tenure_months"],
        "reviews": cr is None or cr >= est["min_clear_rate"],
        "fraud": True,
        "payout_pattern": stable,
        "disputes": standing_ok(est),
    }

    def meets(level, need_stable):
        return ((tenure is not None and tenure >= level["min_tenure_months"])
                and (cr is None or cr >= level["min_clear_rate"])
                and standing_ok(level)
                and (stable or not need_stable))

    reasons = []
    if meets(est, True):
        result = ESTABLISHED
    elif meets(dev, False):
        result = DEVELOPING
    elif tenure is None and checks["reviews"] and stable and checks["disputes"]:
        result = DEVELOPING          # unknown-evidence path: capped below established
        reasons.append("tenure unknown, so capped at developing")
    else:
        result = LIMITED
    return {"band": result, "disqualified": False, "unknown": unknown, "checks": checks, "reasons": reasons}


def assign(ds: Dataset, prevailing: np.ndarray, cfg: dict) -> list[dict]:
    return [{**band(ev, cfg), "evidence": ev} for ev in evidence(ds, prevailing)]
