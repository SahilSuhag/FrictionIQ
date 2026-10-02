"""The tradeoff curve: sweep one rule's threshold, re-run the whole population, compare.

Both arms see identical input — same clients, same events, same fraud labels. The only
thing that differs is the threshold literal in one rule's expression, so any difference
in outcome is attributable to it. Every point is computed under every ordering-
consistent weighting; the spread is what the whiskers show.

Relaxation only: a looser threshold can only remove hits that were logged, so every
counterfactual hit carries its own measured timestamps. Tightening would invent hits
whose hold durations were never observed.
"""

from __future__ import annotations

import numpy as np

from contract import expression

from .data import Dataset, Rule
from .index import Baseline, prevailing

INTEGER_FEATURES = {"txn_count_1h", "payouts_24h", "mcc"}

# A flat stretch counts as "free friction" when, under 95% of weightings, it removes at
# least this share of the rule's friction. Below that it is reported as marginal.
MATERIAL_PCT = 10.0


def _nice(v: float, integer: bool) -> float:
    return float(round(v)) if integer else float(f"{v:.3g}")


def threshold_grid(ds: Dataset, rule: Rule, steps: int) -> list:
    """Thresholds from the live setting out to 'rule never fires'. List rules: on/off."""
    expr = rule.expr
    if not expr.sweepable:
        return ["on", "off"]
    fired = ds.evaluate(rule)
    x = ds.features[expr.feature][fired]
    cur = expr.threshold
    if x.size == 0:
        return [cur]
    integer = expr.feature in INTEGER_FEATURES
    if expr.relax_direction > 0:
        end = float(np.nanmax(x))
        if cur > 0 and end / cur > 4:
            raw = cur * (end / cur) ** np.linspace(0, 1, steps + 1)
        else:
            raw = np.linspace(cur, end, steps + 1)
    else:
        end = max(0.0, float(np.nanmin(x)))
        raw = np.linspace(cur, end, steps + 1)
    grid = [cur]
    for v in raw[1:]:
        n = _nice(v, integer)
        if (n - grid[-1]) * expr.relax_direction > 0:
            grid.append(n)
    # make sure the final point really switches the rule off
    if expr.relax_direction > 0 and grid[-1] < end:
        grid.append(_nice(end, integer) if _nice(end, integer) >= end else end)
    if expr.relax_direction < 0 and grid[-1] > end:
        grid.append(end)
    return grid


def _ranges(v: np.ndarray) -> dict:
    """Reference value (column 0) plus the spread across sampled weightings."""
    s = v[1:] if v.size > 1 else v
    p5, p50, p95 = np.percentile(s, [5, 50, 95])
    return {"ref": float(v[0]), "p5": float(p5), "p50": float(p50), "p95": float(p95),
            "min": float(s.min()), "max": float(s.max())}


class Sweeper:
    def __init__(self, ds: Dataset, base: Baseline, band_of: list[str], eligible: np.ndarray, p75: float):
        self.ds, self.base = ds, base
        self.F = base.F
        self.legit = ~ds.hit_fraud
        self.band_of = np.array(band_of)
        self.eligible = eligible            # client mask for the segment policy
        self.p75 = p75
        self.in30 = ds.hit_t >= ds.as_of - 30 * 24
        self.base_total = self.F[base.prevailing & self.legit].sum(0)
        self.base_client30 = self._client_ref(base.prevailing & self.in30)
        self.base_events = self._intervened_events(base.prevailing)

    # -- helpers -------------------------------------------------------
    def _client_ref(self, mask):
        return np.bincount(self.ds.hit_client[mask], weights=self.F[mask, 0], minlength=self.ds.n_clients)

    def _intervened_events(self, prev):
        """Legit events carrying an inflicted intervention -> prevailing rule index."""
        m = prev & self.legit
        return dict(zip(self.ds.hit_event[m].tolist(), self.ds.hit_rule[m].tolist()))

    def removed_hits(self, rule: Rule, threshold) -> np.ndarray:
        ds = self.ds
        if threshold == "on":
            return np.zeros(ds.n_hits, dtype=bool)
        fires = ds.evaluate(rule, disabled=True) if threshold == "off" else ds.evaluate(rule, threshold)
        return (ds.hit_rule == rule.idx) & ~fires[ds.hit_event]

    # -- one counterfactual arm ---------------------------------------
    def evaluate(self, removed: np.ndarray, rule: Rule | None = None, detail: bool = False) -> dict:
        ds, F = self.ds, self.F
        prev = prevailing(ds, ds.hit_live & ~removed)

        total = F[prev & self.legit].sum(0)
        removed_friction = self.base_total - total

        now = self._intervened_events(prev)
        gone = [e for e in self.base_events if e not in now]
        moved = [e for e, r in self.base_events.items() if e in now and now[e] != r]
        gone_clients = np.unique(ds.event_client[np.array(gone, dtype=np.int64)]) if gone else np.array([], int)

        fraud_hits = prev & ds.hit_fraud
        caught_ruleset = np.unique(ds.hit_event[fraud_hits]).size

        client30 = self._client_ref(prev & self.in30)
        delta = client30 - self.base_client30

        out = {
            "interventions_removed": len(gone),
            "interventions_reattributed": len(moved),
            "clients_affected": int(gone_clients.size),
            "established_clients_affected": int((self.band_of[gone_clients] == "established").sum()),
            "friction_removed": _ranges(removed_friction),
            "pct_of_total": _ranges(100 * removed_friction / self.base_total),
            "fraud_caught_ruleset": int(caught_ruleset),
            "clients_above_p75": int((client30 > self.p75).sum()),
            "clients_friction_increased": int((delta > 1e-9).sum()),
            "max_client_increase": float(max(0.0, delta.max())),
        }
        if rule is not None:
            r_mask = (ds.hit_rule == rule.idx) & ~ds.hit_overridden
            fraud_r = r_mask & ds.hit_fraud & ~removed
            out["fraud_caught_rule"] = int(np.unique(ds.hit_event[fraud_r]).size)
            rule_base = F[self.base.prevailing & self.legit & (ds.hit_rule == rule.idx)].sum(0)
            with np.errstate(invalid="ignore", divide="ignore"):
                pct = np.where(rule_base > 0, 100 * removed_friction / rule_base, 0.0)
            out["pct_of_rule"] = _ranges(pct)
        if detail:
            out["_prevailing"] = prev
            out["_client30"] = client30
        return out

    # -- a whole curve -------------------------------------------------
    def curve(self, rule: Rule, grid: list) -> dict:
        ds = self.ds
        points, seg_points, removed_by_point = [], [], []
        for t in grid:
            removed = self.removed_hits(rule, t)
            removed_by_point.append(removed)
            p = self.evaluate(removed, rule)
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

        r_mask = ds.hit_rule == rule.idx
        legit_base = int((self.base.prevailing & r_mask & self.legit).sum())
        if rule.shadow:
            verdict = "shadow"
        elif legit_base == 0:
            verdict = "no_legit_friction"
        elif flat >= 1 and points[flat]["pct_of_rule"]["p5"] >= MATERIAL_PCT:
            verdict = "free_friction"
        elif flat >= 1 and points[flat]["interventions_removed"] > 0:
            verdict = "marginal"
        else:
            verdict = "earning"

        # Per-client interventions removed at the end of the flat stretch.
        per_client = {}
        if verdict in ("free_friction", "marginal"):
            removed = removed_by_point[flat]
            prev = prevailing(ds, ds.hit_live & ~removed)
            now = self._intervened_events(prev)
            for e in self.base_events:
                if e not in now:
                    c = int(ds.event_client[e])
                    per_client[c] = per_client.get(c, 0) + 1

        return {
            "grid": grid,
            "points": points,
            "segment_points": seg_points,
            "flat_index": flat,
            "verdict": verdict,
            "base_fraud_caught_rule": base_caught,
            "per_client_removed_at_flat": per_client,
            "removed_at_flat": removed_by_point[flat],
        }


def expression_at(rule: Rule, t) -> str:
    if t == "on":
        return rule.text
    if t == "off":
        return "(disabled)"
    return expression.with_threshold(rule.text, t)
