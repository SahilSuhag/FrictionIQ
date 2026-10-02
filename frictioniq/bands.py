"""Good-client bands: established, developing, limited history.

A proposal for discussion, not a validated construct. The definition rests on evidence
that is not itself a product of the controls:

* tenure                — independent of any control decision
* resolution outcomes   — how challenges ended, not whether they fired
* confirmed fraud       — a disqualifier, never a score
* behavioural stability — week-to-week volume beyond Poisson noise
* account standing      — chargeback rate, which no fraud rule outputs

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

    cb = ds.features["chargeback_rate_7d"]
    cleared = np.bincount(ds.hit_client[prevailing & (ds.hit_final == "CLEARED")], minlength=ds.n_clients)
    upheld = np.bincount(ds.hit_client[prevailing & (ds.hit_final == "UPHELD")], minlength=ds.n_clients)

    out = []
    for i, c in enumerate(ds.clients):
        cbs = cb[(ds.event_client == i) & ~np.isnan(cb)]
        out.append({
            "tenure_months": c["tenure_months"],
            "challenges": int(cleared[i] + upheld[i]),
            "cleared": int(cleared[i]),
            "upheld": int(upheld[i]),
            "clear_rate": float(cleared[i] / (cleared[i] + upheld[i])) if cleared[i] + upheld[i] else None,
            "confirmed_fraud": int(ds.client_fraud_count[i]),
            "overdispersion": _overdispersion(weekly[i]),
            "weekly_volume_mean": float(weekly[i].mean()),
            "chargeback_rate": float(np.median(cbs)) if cbs.size else None,
        })
    return out


def band(ev: dict, cfg: dict) -> dict:
    est, dev = cfg["good_client"]["established"], cfg["good_client"]["developing"]
    reasons, unknown = [], []

    if ev["confirmed_fraud"] > 0:
        return {"band": LIMITED, "disqualified": True, "unknown": [],
                "reasons": [f"{ev['confirmed_fraud']} confirmed fraud case(s) — disqualifier"]}

    tenure = ev["tenure_months"]
    if tenure is None:
        unknown.append("tenure")
    cr = ev["clear_rate"]
    stable = not np.isnan(ev["overdispersion"]) and ev["overdispersion"] <= est["max_overdispersion"]
    if ev["chargeback_rate"] is None:
        unknown.append("account standing")
    cbr = ev["chargeback_rate"] or 0.0

    def meets(level, need_stable):
        return ((tenure is not None and tenure >= level["min_tenure_months"])
                and (cr is None or cr >= level["min_clear_rate"])
                and cbr <= level["max_chargeback_rate"]
                and (stable or not need_stable))

    if meets(est, True):
        result = ESTABLISHED
    elif meets(dev, False):
        result = DEVELOPING
    elif tenure is None and (cr is None or cr >= est["min_clear_rate"]) and stable \
            and cbr <= est["max_chargeback_rate"]:
        result = DEVELOPING          # unknown-evidence path: capped below established
        reasons.append("tenure unknown — capped at developing")
    else:
        result = LIMITED

    if tenure is not None:
        reasons.append(f"tenure {tenure} months")
    if cr is None:
        reasons.append("no challenges in window — unflagged, not evidenced")
    else:
        reasons.append(f"cleared {ev['cleared']} of {ev['challenges']} challenges")
    reasons.append("stable volume" if stable else "volatile volume")
    if ev["chargeback_rate"] is not None:
        reasons.append(f"chargeback rate {ev['chargeback_rate']:.1%}")
    return {"band": result, "disqualified": False, "unknown": unknown, "reasons": reasons}


def assign(ds: Dataset, prevailing: np.ndarray, cfg: dict) -> list[dict]:
    out = []
    for ev in evidence(ds, prevailing):
        b = band(ev, cfg)
        out.append({**b, "evidence": ev})
    return out
