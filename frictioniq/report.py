"""Run the whole analysis and ship precomputed results for the frontend.

Every threshold setting for every rule is computed here, ahead of time. The slider in
the UI reads these results; nothing recomputes live, so nothing can hang mid-demo.
"""

from __future__ import annotations

import json
import os

import numpy as np

from contract.schema import DECISION_RANK

from . import bands, index, sweep
from .data import Dataset, iso

UNITS = {
    "amount": "usd", "payouts_24h": "count", "hours_since_bank_change": "hours", "refund_ratio_30d": "pct",
    "txn_count_1h": "count", "ticket_z_score": "sigma", "device_age_hours": "hours",
    "cross_border_share": "pct", "chargeback_rate_7d": "pct", "identity_mismatch_score": "score",
    "synthetic_id_score": "score", "mcc": "code",
}


def _r(x, nd=2):
    return None if x is None else round(float(x), nd)


def _range_of(v: np.ndarray) -> dict:
    s = v[1:]
    return {"ref": _r(v[0]), "p5": _r(np.percentile(s, 5)), "p95": _r(np.percentile(s, 95))}


def _strip(p: dict) -> dict:
    return {k: v for k, v in p.items() if not k.startswith("_")}


def build(ds: Dataset, cfg: dict, demo: dict | None = None) -> dict:
    w = index.sample_weightings(cfg)
    base = index.baseline(ds, w, tuple(cfg["score_windows_days"]))
    band_rows = bands.assign(ds, base.prevailing, cfg)
    band_of = [b["band"] for b in band_rows]
    established = np.array([b == bands.ESTABLISHED for b in band_of])

    w30 = base.windows[30]
    f30 = w30["rule"]                      # C x S
    p75 = float(np.percentile(f30[:, 0], cfg["high_friction_percentile"]))
    eligible = established & (f30[:, 0] > p75)
    sw = sweep.Sweeper(ds, base, band_of, eligible, p75)

    # ------------------------------------------------------------------ rules
    rules_out, curves = [], {}
    for rule in ds.rules:
        grid = sweep.threshold_grid(ds, rule, cfg["threshold_steps"])
        curve = sw.curve(rule, grid)
        curves[rule.rule_id] = curve
        m = ds.hit_rule == rule.idx
        prev_m = base.prevailing & m
        log_axis = (rule.expr.sweepable and rule.expr.relax_direction > 0 and len(grid) > 1
                    and grid[0] > 0 and grid[-1] / grid[0] > 4)
        rules_out.append({
            "rule_id": rule.rule_id,
            "name": rule.name,
            "decision": rule.decision,
            "checkpoint": rule.checkpoint,
            "ruleset_id": rule.ruleset_id,
            "order": rule.order,
            "entity": rule.entity,
            "request_type": rule.request_type,
            "category": rule.category,
            "sub_category": rule.sub_category,
            "expression": rule.text,
            "shadow": rule.shadow,
            "feature": rule.expr.feature,
            "op": rule.expr.op,
            "sweepable": rule.expr.sweepable,
            "unit": UNITS.get(rule.expr.feature, ""),
            "axis": "log" if log_axis else "linear",
            "fired": {
                "total": int(m.sum()),
                "prevailed": int(prev_m.sum()),
                "contributing": int((m & ds.hit_live & ~base.prevailing).sum()),
                "overridden": int((m & ds.hit_overridden).sum()),
                "shadow": int((m & ds.hit_shadow).sum()),
                "prevailed_on_fraud": int((prev_m & ds.hit_fraud).sum()),
                "prevailed_cleared": int((prev_m & (ds.hit_final == "CLEARED")).sum()),
                "clients": int(np.unique(ds.hit_client[prev_m]).size),
            },
            "curve": {
                "grid": grid,
                "expressions": [sweep.expression_at(rule, t) for t in grid],
                "points": curve["points"],
                "segment_points": curve["segment_points"],
                "flat_index": curve["flat_index"],
                "verdict": curve["verdict"],
                "base_fraud_caught_rule": curve["base_fraud_caught_rule"],
            },
        })

    # --------------------------------------------- all rules at their flat end
    relax_rules = [r for r in ds.rules if curves[r.rule_id]["verdict"] == "free_friction"]
    removed_all = np.zeros(ds.n_hits, dtype=bool)
    for r in relax_rules:
        removed_all |= curves[r.rule_id]["removed_at_flat"]
    relax_all = sw.evaluate(removed_all, detail=True)
    prev_after = relax_all["_prevailing"]
    client30_after = relax_all["_client30"]

    legit = ~ds.hit_fraud
    est_hits = established[ds.hit_client]
    est_before = base.F[base.prevailing & legit & est_hits].sum(0)
    est_after = base.F[prev_after & legit & est_hits].sum(0)
    est_cut = 100 * (est_before - est_after) / est_before
    est_int_before = int((base.prevailing & legit & est_hits).sum())
    est_int_after = int((prev_after & legit & est_hits).sum())

    def top_decile_not_established(v):
        k = max(1, int(round(0.1 * len(v))))
        top = np.argsort(v)[::-1][:k]
        return int((~established[top]).sum()), k

    def top_decile_share(v):
        s = np.sort(v)[::-1]
        k = max(1, int(round(0.1 * len(s))))
        return float(s[:k].sum() / s.sum()) if s.sum() else 0.0

    total_fraud = int(ds.event_fraud.sum())
    base_caught = int(np.unique(ds.hit_event[base.prevailing & ds.hit_fraud]).size)

    # ------------------------------------------------------------ clients
    shadow_n = np.bincount(ds.hit_client[ds.hit_shadow], minlength=ds.n_clients)
    contrib = ds.hit_live & ~base.prevailing
    contrib_n = np.bincount(ds.hit_client[contrib], minlength=ds.n_clients)
    total30 = f30[:, 0] + w30["incident"][:, 0]
    # Rank stability across weightings: percentile of this client's 30-day friction in each.
    pct_rank = (np.argsort(np.argsort(f30, axis=0), axis=0) + 1) / ds.n_clients * 100   # C x S

    in30 = ds.hit_t >= ds.as_of - 30 * 24
    clients_out = []
    for i, c in enumerate(ds.clients):
        m = base.prevailing & in30 & (ds.hit_client == i)
        by_rule = {}
        for h in np.flatnonzero(m):
            rid = ds.rules[ds.hit_rule[h]].rule_id
            d = by_rule.setdefault(rid, {"count": 0, "friction": 0.0})
            d["count"] += 1
            d["friction"] += float(base.F[h, 0])
        top = max(by_rule.items(), key=lambda kv: kv[1]["friction"]) if by_rule else None
        relax_note = {rid: n for rid, cv in curves.items()
                      for cc, n in cv["per_client_removed_at_flat"].items() if cc == i}
        b = band_rows[i]
        clients_out.append({
            "client_id": c["client_id"],
            "name": c["client_name"],
            "entity": c["entity"],
            "segment": c["segment"],
            "tenure_months": c["tenure_months"],
            "peer_group": c["peer_group"],
            "band": b["band"],
            "disqualified": b["disqualified"],
            "unknown": b["unknown"],
            "reasons": b["reasons"],
            "evidence": {k: (_r(v, 4) if isinstance(v, float) else v) for k, v in b["evidence"].items()},
            "f7": _range_of(base.windows[7]["rule"][i]),
            "f30": _range_of(f30[i]),
            "incident30": _r(w30["incident"][i, 0]),
            "incident_detail": [{"incident_id": d[0], "hours": _r(d[1], 1), "friction": _r(d[2])}
                                for d in base.incident_detail[i]],
            "n7": int(base.windows[7]["count"][i]),
            "n30": int(w30["count"][i]),
            "contributing": int(contrib_n[i]),
            "shadow": int(shadow_n[i]),
            "by_rule30": {k: {"count": v["count"], "friction": _r(v["friction"])} for k, v in by_rule.items()},
            "top_rule": top[0] if top else None,
            "pct_rank": {"ref": _r(pct_rank[i, 0], 1), "p5": _r(np.percentile(pct_rank[i, 1:], 5), 1),
                         "p95": _r(np.percentile(pct_rank[i, 1:], 95), 1)},
            "high_friction": bool(f30[i, 0] > p75),
            "eligible_for_segment_policy": bool(eligible[i]),
            "relax_removed_at_flat": relax_note,
            "f30_after_relax_all": _r(client30_after[i]),
            "total30": _r(total30[i]),
        })

    # ------------------------------------------------------------ timelines
    timelines = {c["client_id"]: [] for c in ds.clients}
    for h in range(ds.n_hits):
        rule = ds.rules[ds.hit_rule[h]]
        e = ds.hit_event[h]
        val = ds.features[rule.expr.feature][e]
        timelines[ds.clients[ds.hit_client[h]]["client_id"]].append({
            "hit_id": ds.hit_ids[h],
            "rule_id": rule.rule_id,
            "event_id": ds.event_ids[e],
            "t": iso(ds.hit_t[h]),
            "resolved": iso(ds.hit_resolved_t[h]),
            "hours": _r(ds.hit_hours[h]),
            "decision": rule.decision,
            "checkpoint": rule.checkpoint,
            "request_type": str(ds.event_request[e]),
            "action": "PREVAILED" if base.prevailing[h] else str(ds.hit_action[h]) if ds.hit_action[h] in (
                "SHADOW", "OVERRIDDEN") else "CONTRIBUTING",
            "final": str(ds.hit_final[h]),
            "fraud": bool(ds.hit_fraud[h]),
            "value": None if np.isnan(val) else _r(val, 3),
            "friction": _r(base.F[h, 0]) if base.prevailing[h] else 0,
        })

    # ------------------------------------------------------------ portfolio cuts
    def cut(key_fn):
        out = {}
        m = base.prevailing & in30
        for h in np.flatnonzero(m):
            k = key_fn(h)
            out[k] = out.get(k, 0.0) + float(base.F[h, 0])
        return {k: _r(v, 1) for k, v in sorted(out.items())}

    by_checkpoint = cut(lambda h: ds.rules[ds.hit_rule[h]].checkpoint)
    by_entity = cut(lambda h: f'{ds.clients[ds.hit_client[h]]["entity"]} · {ds.clients[ds.hit_client[h]]["segment"]}')
    by_decision = cut(lambda h: ds.rules[ds.hit_rule[h]].decision)

    quadrant = {}
    for i in range(ds.n_clients):
        good = "good" if established[i] else "not_established"
        hi = "high" if f30[i, 0] > p75 else "low"
        quadrant[f"{good}_{hi}"] = quadrant.get(f"{good}_{hi}", 0) + 1
    fraud_low = int(((ds.client_fraud_count > 0) & (f30[:, 0] <= p75)).sum())
    fraud_high = int(((ds.client_fraud_count > 0) & (f30[:, 0] > p75)).sum())

    # Clients like the hero: established, most of their friction from one free-friction rule.
    lookalikes = {}
    for co in clients_out:
        if co["band"] == bands.ESTABLISHED and co["top_rule"] and co["n30"] >= 3:
            top = co["by_rule30"][co["top_rule"]]
            if curves[co["top_rule"]]["verdict"] == "free_friction" and top["friction"] >= 0.5 * co["f30"]["ref"]:
                lookalikes[co["top_rule"]] = lookalikes.get(co["top_rule"], 0) + 1

    flat_widths = []
    for ro in rules_out:
        if ro["curve"]["verdict"] == "free_friction":
            p = ro["curve"]["points"][ro["curve"]["flat_index"]]["pct_of_rule"]
            flat_widths.append(p["p95"] - p["p5"])

    metrics = {
        "fraud": {"total": total_fraud, "caught_baseline": base_caught, "missed_baseline": total_fraud - base_caught,
                  "caught_after_relax_all": relax_all["fraud_caught_ruleset"]},
        "free_friction_by_rule": [
            {"rule_id": ro["rule_id"], "name": ro["name"], "verdict": ro["curve"]["verdict"],
             "threshold": ro["curve"]["grid"][ro["curve"]["flat_index"]],
             "expression": ro["curve"]["expressions"][ro["curve"]["flat_index"]],
             "interventions_removed": ro["curve"]["points"][ro["curve"]["flat_index"]]["interventions_removed"],
             "clients_affected": ro["curve"]["points"][ro["curve"]["flat_index"]]["clients_affected"],
             "pct_of_rule": ro["curve"]["points"][ro["curve"]["flat_index"]].get("pct_of_rule")}
            for ro in rules_out
        ],
        "relax_all": {
            "rules": [r.rule_id for r in relax_rules],
            **_strip(relax_all),
            "established_friction_cut_pct": {"ref": _r(est_cut[0], 1), "p50": _r(np.median(est_cut[1:]), 1),
                                             "p5": _r(np.percentile(est_cut[1:], 5), 1),
                                             "p95": _r(np.percentile(est_cut[1:], 95), 1)},
            "established_interventions_before": est_int_before,
            "established_interventions_after": est_int_after,
            "clients_above_p75_before": int((sw.base_client30 > p75).sum()),
            "top_decile_share_before": _r(top_decile_share(sw.base_client30), 3),
            "top_decile_share_after": _r(top_decile_share(client30_after), 3),
            "top_decile_not_established_before": top_decile_not_established(sw.base_client30)[0],
            "top_decile_not_established_after": top_decile_not_established(client30_after)[0],
            "top_decile_size": top_decile_not_established(client30_after)[1],
        },
        "range_width_max_pct_points": _r(max(flat_widths) if flat_widths else 0, 1),
        "no_flat_stretch": [ro["name"] for ro in rules_out if ro["curve"]["verdict"] == "earning" and ro["sweepable"]],
        "two_state_rules": [ro["name"] for ro in rules_out if not ro["sweepable"]],
        "hero_lookalikes": lookalikes,
    }

    return {
        "meta": {
            "synthetic": True,
            "notice": "SYNTHETIC DATA — generated for demonstration. No real clients, people or payments.",
            "seed": ds.manifest.get("seed"),
            "window_start": iso(0),
            "as_of": iso(ds.as_of),
            "counts": ds.manifest.get("counts", {}),
            "n_weightings": int(w.n - 1),
            "decision_rank": DECISION_RANK,
        },
        "config": cfg,
        "demo": demo or {},
        "rules": rules_out,
        "clients": clients_out,
        "timelines": timelines,
        "incidents": [{k: inc[k] for k in ("incident_id", "start", "end", "severity")}
                      | {"n_clients": len(inc["clients"])} for inc in ds.incidents],
        "portfolio": {
            "p75": _r(p75), "by_checkpoint": by_checkpoint, "by_entity": by_entity, "by_decision": by_decision,
            "quadrant": quadrant, "fraud_clients_low_friction": fraud_low, "fraud_clients_high_friction": fraud_high,
            "segment_policy_clients": int(eligible.sum()),
        },
        "metrics": metrics,
    }


class _Encoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, np.integer):
            return int(o)
        if isinstance(o, np.floating):
            return float(o)
        if isinstance(o, np.bool_):
            return bool(o)
        return super().default(o)


def _round_floats(o, nd=3):
    if isinstance(o, float):
        return round(o, nd)
    if isinstance(o, dict):
        return {k: _round_floats(v, nd) for k, v in o.items()}
    if isinstance(o, list):
        return [_round_floats(v, nd) for v in o]
    return o


def write(result: dict, out_dir: str, js_path: str | None = None) -> None:
    os.makedirs(out_dir, exist_ok=True)
    result = _round_floats(json.loads(json.dumps(result, cls=_Encoder)))
    with open(os.path.join(out_dir, "results.json"), "w") as f:
        json.dump(result, f, separators=(",", ":"))
    with open(os.path.join(out_dir, "metrics.json"), "w") as f:
        json.dump({"meta": result["meta"], "metrics": result["metrics"]}, f, indent=2)
    if js_path:
        os.makedirs(os.path.dirname(js_path), exist_ok=True)
        with open(js_path, "w") as f:
            f.write("// Generated by `python -m frictioniq`. SYNTHETIC DATA — for demonstration only.\n")
            f.write("window.FRICTIONIQ = ")
            json.dump(result, f, separators=(",", ":"))
            f.write(";\n")
