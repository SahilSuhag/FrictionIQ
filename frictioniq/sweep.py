"""The tradeoff curve: sweep one rule's threshold, re-run the whole population, compare.

Both arms see identical input — same clients, same events, same fraud labels. The only
thing that differs is the threshold literal in one rule's expression, so any difference
in outcome is attributable to it. Every point is computed under every ordering-
consistent weighting; the spread is the band on the chart.

Each curve is measured over a window (the last 30 days, 60 days or 12 months). Events
outside the window still take part in attribution, but only the window is counted.

Relaxation only: a looser threshold can only remove hits that were logged, so every
counterfactual hit carries its own measured timestamps. Tightening would invent hits
whose hold durations were never observed.
"""

from __future__ import annotations

import math

import numpy as np

from contract import expression

from .data import Dataset, Rule
from .index import Baseline, prevailing

UNITS = {
    "amount": "usd", "payouts_24h": "count", "refund_ratio_30d": "pct", "counterparty_age_days": "days",
    "hours_since_device_change": "hours", "txn_velocity_ratio": "ratio", "geo_mismatch_share": "pct",
    "ticket_z_score": "sigma", "device_age_hours": "hours", "doc_mismatch_score": "score",
}
INTEGER_FEATURES = {"payouts_24h", "counterparty_age_days"}
LOG_UNITS = {"usd", "ratio"}
_LADDER = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.5, 2.8, 3, 3.5, 4, 4.5, 5, 6, 7, 8, 9]
_ROUND = {1, 2, 2.5, 5}


def fmt(v, unit: str) -> str:
    if v == "on":
        return "on"
    if v == "off":
        return "off"
    if unit == "usd":
        return f"${v:,.0f}"
    if unit == "pct":
        return f"{v * 100:g}%"
    if unit == "ratio":
        return f"{v:g}×"
    if unit == "hours":
        return f"{v:g} h"
    if unit == "days":
        return f"{v:g} days"
    if unit == "sigma":
        return f"{v:g}σ"
    return f"{v:g}"


def _ladder_values(lo: float, hi: float) -> list[float]:
    out = []
    for e in range(math.floor(math.log10(lo)) - 1, math.ceil(math.log10(hi)) + 1):
        for m in _LADDER:
            out.append(round(m * 10 ** e, 10))
    return sorted(set(out))


def _nice_step(span: float, steps: int) -> float:
    raw = span / steps
    mag = 10 ** math.floor(math.log10(raw))
    for m in (1, 2, 2.5, 5, 10):
        if m * mag >= raw:
            return m * mag
    return 10 * mag


def threshold_grid(ds: Dataset, rule: Rule, steps: int) -> list:
    """Readable thresholds from the live setting out to 'rule never fires'. List rules: on/off."""
    expr = rule.expr
    if not expr.sweepable:
        return ["on", "off"]
    x = ds.features[expr.feature][ds.evaluate(rule)]
    cur = expr.threshold
    if x.size == 0:
        return [cur]
    unit = UNITS.get(expr.feature, "")
    if expr.relax_direction > 0:
        end = float(np.nanmax(x))
        if unit in LOG_UNITS and cur > 0:
            vals = [v for v in _ladder_values(cur, end) if v > cur]
        else:
            step = 1.0 if expr.feature in INTEGER_FEATURES else _nice_step(end - cur, steps)
            vals = [round(cur + k * step, 10) for k in range(1, int((end - cur) / step) + 2)]
        grid = [cur]
        for v in vals:
            grid.append(v)
            if v >= end:
                break
    else:
        end = max(0.0, float(np.nanmin(x)))
        step = 1.0 if expr.feature in INTEGER_FEATURES else _nice_step(cur - end, steps)
        grid = [cur]
        v = cur
        while v > end:
            v = round(v - step, 10)
            grid.append(max(v, 0.0))
            if v <= 0:
                break
    return grid


def _ranges(v: np.ndarray) -> dict:
    """Reference value (column 0) plus the spread across sampled weightings."""
    s = v[1:] if v.size > 1 else v
    p5, p50, p95 = np.percentile(s, [5, 50, 95])
    return {"ref": float(v[0]), "p5": float(p5), "p50": float(p50), "p95": float(p95),
            "min": float(s.min()), "max": float(s.max())}


class Sweeper:
    """Counterfactual arms for one measurement window."""

    def __init__(self, ds: Dataset, base: Baseline, window_days: int, band_of: list[str],
                 eligible: np.ndarray, p75: float, cfg: dict):
        self.ds, self.base, self.cfg = ds, base, cfg
        self.days = window_days
        self.F = base.F
        self.legit = ~ds.hit_fraud
        self.win = base.windows[window_days]["mask"]
        self.win_event = ds.event_t >= ds.as_of - window_days * 24
        self.band_of = np.array(band_of)
        self.eligible = eligible            # client mask for the segment policy
        self.p75 = p75
        self.base_total = self.F[base.prevailing & self.legit & self.win].sum(0)
        self.base_client = self._client_ref(base.prevailing & self.win)
        self.base_events = self._intervened_events(base.prevailing)

    # -- helpers -------------------------------------------------------
    def _client_ref(self, mask):
        return np.bincount(self.ds.hit_client[mask], weights=self.F[mask, 0], minlength=self.ds.n_clients)

    def _intervened_events(self, prev):
        """Legit events in the window carrying an inflicted intervention -> prevailing rule."""
        m = prev & self.legit & self.win
        return dict(zip(self.ds.hit_event[m].tolist(), self.ds.hit_rule[m].tolist()))

    def removed_hits(self, rule: Rule, threshold) -> np.ndarray:
        ds = self.ds
        if threshold == "on":
            return np.zeros(ds.n_hits, dtype=bool)
        fires = ds.evaluate(rule, disabled=True) if threshold == "off" else ds.evaluate(rule, threshold)
        return (ds.hit_rule == rule.idx) & ~fires[ds.hit_event]

    def fraud_caught_by(self, rule: Rule, removed: np.ndarray) -> int:
        """Fraud cases in the window this rule still fires on (shadow rules: would fire on)."""
        ds = self.ds
        m = (ds.hit_rule == rule.idx) & ~ds.hit_overridden & ds.hit_fraud & ~removed & self.win
        return int(np.unique(ds.hit_event[m]).size)

    # -- one counterfactual arm ---------------------------------------
    def evaluate(self, removed: np.ndarray, rule: Rule | None = None, detail: bool = False) -> dict:
        ds, F = self.ds, self.F
        prev = prevailing(ds, ds.hit_live & ~removed)

        total = F[prev & self.legit & self.win].sum(0)
        removed_friction = self.base_total - total

        now = self._intervened_events(prev)
        gone = [e for e in self.base_events if e not in now]
        moved = [e for e, r in self.base_events.items() if e in now and now[e] != r]
        gone_clients = np.unique(ds.event_client[np.array(gone, dtype=np.int64)]) if gone else np.array([], int)

        caught_ruleset = np.unique(ds.hit_event[prev & ds.hit_fraud & self.win]).size
        client_now = self._client_ref(prev & self.win)
        delta = client_now - self.base_client

        out = {
            "interventions_removed": len(gone),
            "interventions_reattributed": len(moved),
            "clients_affected": int(gone_clients.size),
            "established_clients_affected": int((self.band_of[gone_clients] == "established").sum()),
            "friction_removed": _ranges(removed_friction),
            "pct_of_total": _ranges(100 * removed_friction / np.maximum(self.base_total, 1e-9)),
            "fraud_caught_ruleset": int(caught_ruleset),
            "clients_above_p75": int((client_now > self.p75).sum()),
            "clients_friction_increased": int((delta > 1e-9).sum()),
            "max_client_increase": float(max(0.0, delta.max())),
        }
        if rule is not None:
            out["fraud_caught_rule"] = self.fraud_caught_by(rule, removed)
            r_mask = ds.hit_rule == rule.idx
            rule_base = F[self.base.prevailing & self.legit & self.win & r_mask].sum(0)
            with np.errstate(invalid="ignore", divide="ignore"):
                pct = np.where(rule_base > 0, 100 * removed_friction / rule_base, 0.0)
            out["pct_of_rule"] = _ranges(pct)
            out["rule_interventions"] = int((prev & self.legit & self.win & r_mask).sum())
        if detail:
            out["_prevailing"] = prev
            out["_client"] = client_now
        return out

    # -- a whole curve -------------------------------------------------
    def curve(self, rule: Rule, grid: list, example_client: int | None) -> dict:
        ds, cfg = self.ds, self.cfg["free_stretch"]
        unit = UNITS.get(rule.expr.feature, "")
        points, seg_points, removed_by_point = [], [], []
        r_mask = ds.hit_rule == rule.idx
        for t in grid:
            removed = self.removed_hits(rule, t)
            removed_by_point.append(removed)
            p = self.evaluate(removed, rule, detail=example_client is not None)
            if example_client is not None:
                prev = p.pop("_prevailing")
                p.pop("_client")
                p["example_interventions"] = int((prev & self.win & r_mask & (ds.hit_client == example_client)).sum())
            p["threshold"] = t
            points.append(p)
            s = self.evaluate(removed & self.eligible[ds.hit_client], rule)
            s["threshold"] = t
            seg_points.append(s)

        base_caught = points[0]["fraud_caught_rule"]
        flat = 0
        for i, p in enumerate(points):
            if p["fraud_caught_rule"] < base_caught:
                break
            flat = i

        legit_base = int((self.base.prevailing & r_mask & self.legit & self.win).sum())
        fp = points[flat]["pct_of_rule"]
        if rule.shadow:
            verdict, label = "shadow", "Shadow: no friction"
        elif legit_base == 0:
            verdict, label = "no_legit_friction", "No client friction"
        elif base_caught == 0:
            verdict, label = "no_fraud", "Caught no fraud here"
        elif flat >= 1 and fp["p5"] >= cfg["free_pct"]:
            verdict, label = "free", f"Free to {fmt(grid[flat], unit)}"
        elif flat >= 1 and fp["ref"] >= cfg["small_pct"]:
            verdict, label = "small", "Small free stretch"
        else:
            verdict, label = "none", "No free stretch"

        # Where the slider opens: the first round setting inside the free stretch that
        # removes most of the rule's friction; for a rule with no free stretch, a step or
        # two out, so the cost is on screen.
        if verdict == "free":
            cands = [i for i in range(1, flat + 1) if points[i]["pct_of_rule"]["ref"] >= cfg["recommend_pct"]]
            rounds = [i for i in cands if unit != "usd" or _is_round(grid[i])]
            recommended = (rounds or cands or [flat])[0]
        elif verdict == "small":
            recommended = flat
        else:
            recommended = min(2, len(grid) - 1)

        return {
            "grid": grid,
            "points": points,
            "segment_points": seg_points,
            "flat_index": flat,
            "verdict": verdict,
            "label": label,
            "recommended_index": recommended,
            "base_fraud_caught_rule": base_caught,
            "removed_at_flat": removed_by_point[flat],
        }


def _is_round(v: float) -> bool:
    m = v / 10 ** math.floor(math.log10(v))
    return round(m, 6) in _ROUND


def expression_at(rule: Rule, t) -> str:
    if t == "on":
        return rule.text
    if t == "off":
        return "(disabled)"
    return expression.with_threshold(rule.text, t)
