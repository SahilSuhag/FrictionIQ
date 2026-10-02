"""The friction index.

    friction(client) = Σ over prevailing hits of  decision_weight × duration_factor × recency_decay

* Prevailing hits only — when several live rules hit one event, the highest-ranked
  decision prevails (ties: lowest binding order). The rest are contributing hits:
  recorded, shown, never scored.
* Shadow hits score zero — they fire and log, but no client paid for them.
* Duration factor applies to holds — log(1 + hours_held / reference_hours), measured
  from the hit's own timestamps. Non-hold actions take a factor of 1.
* Incidents score in their own band — never mixed into the rule-attributed total.

It is an index, not a model: deterministic, and every number traces to the events
that produced it.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from contract.schema import DECISION_RANK

from .data import Dataset

RANKED_DECISIONS = sorted(DECISION_RANK, key=DECISION_RANK.get)   # SETTLEMENT_LIMIT .. TERMINATE


@dataclass
class Weightings:
    """S weighting configurations. Column 0 is always the placeholder (POC) config."""
    weights: np.ndarray        # S x 7, indexed by decision rank (0 = shadow, always 0)
    half_life: np.ndarray      # S, days
    reference_hours: np.ndarray  # S
    saturating: np.ndarray     # S, bool — duration shape
    cap_hours: float
    incident_weights: dict

    @property
    def n(self) -> int:
        return len(self.half_life)


def placeholder(cfg: dict) -> Weightings:
    w = np.array([[0.0] + [cfg["decision_weights"][d] for d in RANKED_DECISIONS]])
    return Weightings(w, np.array([float(cfg["half_life_days"])]), np.array([float(cfg["reference_hours"])]),
                      np.array([cfg["duration_shape"] == "saturating"]), float(cfg["saturating_cap_hours"]),
                      cfg["incident_severity_weights"])


def sample_weightings(cfg: dict) -> Weightings:
    """Anchor A: sample weight vectors consistent with the intervention ordering.

    Six uniform draws, sorted, scaled so the heaviest (termination) is 100 — every
    vector respects settlement limit < restriction < hold < deny < block < termination
    and nothing else is assumed. Half-life, reference hours and duration shape are
    swept alongside, because they are as arbitrary as the weights.
    """
    sw = cfg["weighting_sweep"]
    rng = np.random.default_rng(sw["seed"])
    n = sw["n_samples"]
    u = np.sort(rng.uniform(0.02, 1.0, size=(n, len(RANKED_DECISIONS))), axis=1)
    u = 100.0 * u / u[:, -1:]
    base = placeholder(cfg)
    weights = np.vstack([base.weights, np.hstack([np.zeros((n, 1)), u])])
    lo, hi = sw["half_life_days"]
    half_life = np.concatenate([base.half_life, rng.uniform(lo, hi, n)])
    rlo, rhi = sw["reference_hours"]
    ref = np.concatenate([base.reference_hours, np.exp(rng.uniform(np.log(rlo), np.log(rhi), n))])
    shapes = sw["duration_shapes"]
    sat = np.concatenate([base.saturating, rng.choice([s == "saturating" for s in shapes], n)])
    return Weightings(weights, half_life, ref, sat, base.cap_hours, base.incident_weights)


def duration_factor(hours: np.ndarray, w: Weightings) -> np.ndarray:
    """N x S. log(1 + h / ref); the saturating shape caps h first."""
    h = hours[:, None]
    h = np.where(w.saturating[None, :], np.minimum(h, w.cap_hours), h)
    return np.log1p(h / w.reference_hours[None, :])


def decay(age_hours: np.ndarray, w: Weightings) -> np.ndarray:
    """N x S. 0.5 ^ (days_since / half_life)."""
    return np.power(0.5, (age_hours[:, None] / 24.0) / w.half_life[None, :])


def hit_friction(ds: Dataset, w: Weightings) -> np.ndarray:
    """Friction each hit would contribute IF it prevailed, under every weighting (H x S).

    Whether it does prevail is decided by ``prevailing``; shadow and overridden hits
    can never prevail, so their value here is irrelevant.
    """
    wt = w.weights[:, ds.hit_rank].T                                      # H x S
    dur = np.where(ds.hit_is_hold[:, None], duration_factor(ds.hit_hours, w), 1.0)
    return wt * dur * decay(ds.as_of - ds.hit_t, w)


def prevailing(ds: Dataset, live: np.ndarray) -> np.ndarray:
    """Attribution by order. Returns a hit mask: one prevailing hit per event with any live hit."""
    idx = np.flatnonzero(live)
    out = np.zeros(ds.n_hits, dtype=bool)
    if idx.size == 0:
        return out
    key = ds.hit_rank[idx] * 1000 - ds.hit_order[idx]
    order = np.lexsort((-key, ds.hit_event[idx]))
    ev = ds.hit_event[idx][order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = ev[1:] != ev[:-1]
    out[idx[order[first]]] = True
    return out


def client_totals(ds: Dataset, mask: np.ndarray, F: np.ndarray) -> np.ndarray:
    """Sum F over the masked hits, per client (C x S)."""
    out = np.zeros((ds.n_clients, F.shape[1]))
    idx = np.flatnonzero(mask)
    np.add.at(out, ds.hit_client[idx], F[idx])
    return out


def incident_friction(ds: Dataset, w: Weightings, window_days: float | None = None) -> tuple[np.ndarray, list]:
    """Incident band per client (C x S): severity weight × duration factor × recency.

    Returns the matrix and a per-client list of (incident_id, hours, reference friction).
    """
    out = np.zeros((ds.n_clients, w.n))
    detail = [[] for _ in range(ds.n_clients)]
    start = ds.as_of - window_days * 24 if window_days else -np.inf
    for inc in ds.incidents:
        if inc["end_h"] < start:
            continue
        hrs = inc["end_h"] - max(inc["start_h"], start)
        sev = w.incident_weights[inc["severity"]]
        h = np.array([hrs])
        val = (sev * duration_factor(h, w) * decay(np.array([ds.as_of - inc["end_h"]]), w))[0]
        for c in inc["clients"]:
            out[c] += val
            detail[c].append((inc["incident_id"], hrs, float(val[0])))
    return out, detail


@dataclass
class Baseline:
    """Everything at the live thresholds, computed once and shared by the sweep."""
    w: Weightings
    F: np.ndarray               # H x S
    prevailing: np.ndarray      # H mask
    windows: dict               # days -> {"rule": C x S, "incident": C x S, "count": C}
    incident_detail: list


def baseline(ds: Dataset, w: Weightings, windows=(7, 30)) -> Baseline:
    F = hit_friction(ds, w)
    prev = prevailing(ds, ds.hit_live)
    out = {}
    detail = None
    for d in windows:
        in_window = ds.hit_t >= ds.as_of - d * 24
        m = prev & in_window
        inc, det = incident_friction(ds, w, d)
        if d == max(windows):
            detail = det
        out[d] = {
            "rule": client_totals(ds, m, F),
            "incident": inc,
            "count": np.bincount(ds.hit_client[m], minlength=ds.n_clients),
        }
    return Baseline(w, F, prev, out, detail)
