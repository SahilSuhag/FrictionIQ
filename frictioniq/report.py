"""Run the whole analysis and ship precomputed results for the frontend.

Every threshold setting for every rule, in every window (30 days, 60 days, 12 months),
is computed here ahead of time. The slider in the UI reads these results; nothing
recomputes live, so nothing can hang mid-demo.
"""

from __future__ import annotations

import json
import os

import numpy as np

from contract.schema import DECISION_RANK

from . import bands, index, sweep
from .data import Dataset, iso

WINDOWS = {"30d": 30, "60d": 60, "1y": 365}
WINDOW_LABELS = {"30d": ("30 days", "last 30 days"), "60d": ("60 days", "last 60 days"),
                 "1y": ("1 year", "last 12 months")}
DECISION_LABELS = {"DENY_OR_HOLD": "Deny or hold", "DENY": "Deny", "HOLD": "Hold → manual review",
                   "SETTLEMENT_LIMIT": "Settlement limit", "RESTRICT": "Product restriction",
                   "BLOCK": "Block account", "TERMINATE": "Termination"}
SEGMENT_LABELS = {"SMB": "SMB", "MID_MARKET": "Mid-market", "ENTERPRISE": "Enterprise"}


def _r(x, nd=2):
    return None if x is None else round(float(x), nd)


def grade_of(score: float, cfg: dict) -> str:
    out = "A"
    for g, (lo, _hi) in cfg["friction_grades"]["cutoffs"].items():
        if score >= lo:
            out = g
    return out


def _compact_point(p: dict) -> dict:
    keep = ("interventions_removed", "clients_affected", "established_clients_affected", "fraud_caught_rule",
            "fraud_caught_ruleset", "clients_above_p75", "clients_friction_increased", "rule_interventions",
            "rule_interventions_all",
            "example_interventions", "interventions_reattributed")
    out = {k: p[k] for k in keep if k in p}
    for k in ("ledger", "freed", "fraud_usd_rule"):
        if k in p:
            out[k] = p[k]
    pr = p.get("pct_of_rule")
    if pr:
        out["pct"] = [_r(pr["ref"], 1), _r(pr["p5"], 1), _r(pr["p95"], 1)]
    return out


def build(ds: Dataset, cfg: dict, demo: dict | None = None) -> dict:
    demo = demo or {}
    w = index.sample_weightings(cfg)
    base = index.baseline(ds, w, tuple(WINDOWS.values()))
    band_rows = bands.assign(ds, base.prevailing, cfg)
    band_of = [b["band"] for b in band_rows]
    established = np.array([b == bands.ESTABLISHED for b in band_of])
    legit = ~ds.hit_fraud
    heavy = set(cfg["friction_grades"]["heavy"])
    heavy_floor = min(cfg["friction_grades"]["cutoffs"][g][0] for g in heavy)
    demo_client = ds.client_index.get(demo.get("open_client", ""), None)

    grids = {r.rule_id: sweep.threshold_grid(ds, r, cfg["threshold_steps"]) for r in ds.rules}
    rule_windows = {r.rule_id: {} for r in ds.rules}
    portfolio, metrics, client_windows = {}, {}, [dict() for _ in range(ds.n_clients)]

    for wkey, days in WINDOWS.items():
        wb = base.windows[days]
        scores = wb["rule"]                               # C x S
        ref = scores[:, 0]
        p75 = float(np.percentile(ref, cfg["high_friction_percentile"]))
        eligible = established & (ref > p75)
        sw = sweep.Sweeper(ds, base, days, band_of, eligible, p75, cfg)
        prev_w = base.prevailing & wb["mask"]

        # ------------------------------------------------------------- rules
        curves = {}
        for rule in ds.rules:
            r_mask = ds.hit_rule == rule.idx
            pr = prev_w & r_mask & legit
            ex = demo_client if demo_client is not None and (pr & (ds.hit_client == demo_client)).any() else None
            if ex is None:
                counts = np.bincount(ds.hit_client[pr], minlength=ds.n_clients) * np.where(established, 1, 0)
                ex = int(np.argmax(counts)) if counts.max() > 0 else None
            curve = sw.curve(rule, grids[rule.rule_id], ex)
            curves[rule.rule_id] = curve
            in_w = r_mask & wb["mask"]
            fl = curve["flat_index"]
            rule_windows[rule.rule_id][wkey] = {
                "interventions": int((prev_w & r_mask).sum()),
                "fired": {
                    "total": int(in_w.sum()),
                    "prevailed": int((in_w & base.prevailing).sum()),
                    "contributing": int((in_w & ds.hit_live & ~base.prevailing).sum()),
                    "overridden": int((in_w & ds.hit_overridden).sum()),
                    "shadow": int((in_w & ds.hit_shadow).sum()),
                    "clients": int(np.unique(ds.hit_client[in_w & base.prevailing]).size),
                },
                "curve": {
                    "points": [_compact_point(p) for p in curve["points"]],
                    "segment_points": [_compact_point(p) for p in curve["segment_points"]],
                    "flat_index": fl,
                    "verdict": curve["verdict"],
                    "label": curve["label"],
                    "recommended_index": curve["recommended_index"],
                    "base_fraud_caught_rule": curve["base_fraud_caught_rule"],
                },
                "example": None if ex is None else {
                    "client_id": ds.clients[ex]["client_id"], "name": ds.clients[ex]["client_name"],
                    "baseline": curve["points"][0].get("example_interventions", 0)},
            }

        # ---------------------------------------- every rule relaxed as far as is safe, at once
        relax = [r for r in ds.rules if curves[r.rule_id]["verdict"] in ("free", "small")]
        removed_all = np.zeros(ds.n_hits, dtype=bool)
        for r in relax:
            removed_all |= curves[r.rule_id]["removed_at_flat"]
        ra = sw.evaluate(removed_all, detail=True)
        prev_after, client_after = ra.pop("_prevailing"), ra.pop("_client")
        est_hits = established[ds.hit_client] & wb["mask"]
        est_before = base.F[base.prevailing & legit & est_hits].sum(0)
        est_after = base.F[prev_after & legit & est_hits].sum(0)
        est_cut = 100 * (est_before - est_after) / np.maximum(est_before, 1e-9)

        def top_decile_share(v):
            s = np.sort(v)[::-1]
            k = max(1, int(round(0.1 * len(s))))
            return float(s[:k].sum() / s.sum()) if s.sum() else 0.0

        # ------------------------------------------------------- clients
        # Similar clients: same entity, segment and peer group (entity and segment when
        # the peer group is unknown).
        peer_key = np.array([f"{c['entity']}|{c['segment']}|{c['peer_group'] or ''}" for c in ds.clients])
        pct_rank = np.zeros_like(scores)
        peer_n = np.zeros(ds.n_clients, dtype=int)
        for key in set(peer_key):
            idx = np.flatnonzero(peer_key == key)
            peer_n[idx] = len(idx)
            if len(idx) > 1:
                sub = scores[idx]
                ranks = np.argsort(np.argsort(sub, axis=0), axis=0)
                pct_rank[idx] = 100 * ranks / (len(idx) - 1)
        hold_payout = ds.hit_is_hold & ds.event_is_payout[ds.hit_event]
        deny_payout = (ds.hit_decision == "DENY") & ds.event_is_payout[ds.hit_event]
        amount = np.nan_to_num(ds.features["amount"][ds.hit_event])
        good_heavy = 0
        grade_counts = {g: 0 for g in cfg["friction_grades"]["cutoffs"]}
        # transactions: the money movements the rules screen (captures, settlements, payouts);
        # boarding checks carry no amount and are not transactions
        txn_w = (ds.event_t >= ds.as_of - days * 24) & ~np.isnan(ds.features["amount"])
        txn_n = np.bincount(ds.event_client[txn_w], minlength=ds.n_clients)
        txn_usd = np.bincount(ds.event_client[txn_w], weights=ds.features["amount"][txn_w], minlength=ds.n_clients)
        for i in range(ds.n_clients):
            m = prev_w & (ds.hit_client == i)
            by_rule = {}
            for h in np.flatnonzero(m):
                d = by_rule.setdefault(ds.rules[ds.hit_rule[h]].rule_id, {"count": 0, "score": 0.0})
                d["count"] += 1
                d["score"] += float(base.F[h, 0])
            top = max(by_rule.items(), key=lambda kv: kv[1]["score"]) if by_rule else None
            holds = m & hold_payout
            denies = m & deny_payout
            g = grade_of(ref[i], cfg)
            grade_counts[g] += 1
            is_heavy = bool(established[i] and ref[i] >= heavy_floor)
            good_heavy += is_heavy
            client_windows[i][wkey] = {
                "score": [_r(ref[i], 1), _r(np.percentile(scores[i, 1:], 5), 1), _r(np.percentile(scores[i, 1:], 95), 1)],
                "grade": g,
                "grade_range": [grade_of(np.percentile(scores[i, 1:], 5), cfg),
                                grade_of(np.percentile(scores[i, 1:], 95), cfg)],
                "n": int(wb["count"][i]),
                "txn": [int(txn_n[i]), _r(txn_usd[i], 0)],
                "prev_n": None if wb["prev_count"] is None else int(wb["prev_count"][i]),
                "by_rule": {k: {"count": v["count"], "score": _r(v["score"], 1)} for k, v in by_rule.items()},
                "top_rule": top[0] if top else None,
                "hold_hours": _r(ds.hit_hours[holds].sum(), 1),
                "holds": int(holds.sum()),
                "holds_cleared": int((holds & (ds.hit_final == "CLEARED")).sum()),
                "held_usd": _r(amount[holds].sum(), 0),
                "denied": int(denies.sum()),
                "denied_usd": _r(amount[denies].sum(), 0),
                "denied_fraud": int((denies & ds.hit_fraud).sum()),
                "peer_pct": [_r(pct_rank[i, 0], 0), _r(np.percentile(pct_rank[i, 1:], 5), 0),
                             _r(np.percentile(pct_rank[i, 1:], 95), 0)],
                "peer_n": int(peer_n[i]),
                "incident": {"friction": _r(wb["incident"][i, 0], 1),
                             "items": [{"id": d[0], "hours": _r(d[1], 1)} for d in base.incident_detail[days][i]]},
                "heavy": is_heavy,
                "eligible": bool(eligible[i]),
                "after_relax": _r(client_after[i], 1),
            }

        # ------------------------------------------------------- portfolio
        in_win_inc = [inc for inc in ds.incidents if inc["end_h"] >= ds.as_of - days * 24]
        inc_clients = {c for inc in in_win_inc for c in inc["clients"]}

        def cut(key_fn):
            out = {}
            for h in np.flatnonzero(prev_w):
                k = key_fn(h)
                out[k] = out.get(k, 0) + 1
            return dict(sorted(out.items(), key=lambda kv: -kv[1]))

        amt_ev = np.nan_to_num(ds.features["amount"])

        def fraud_split(start, end):
            """Confirmed fraud in [start, end): stopped by a live rule (saved) or not (lost)."""
            ev = ds.event_fraud & (ds.event_t >= start) & (ds.event_t < end)
            caught = np.unique(ds.hit_event[base.prevailing & ds.hit_fraud & (ds.hit_t >= start) & (ds.hit_t < end)])
            caught = caught[ev[caught]]
            total_usd = amt_ev[ev].sum()
            return {"caught": int(caught.size), "total": int(ev.sum()), "caught_usd": _r(amt_ev[caught].sum(), 0),
                    "total_usd": _r(total_usd, 0), "lost_usd": _r(total_usd - amt_ev[caught].sum(), 0)}

        start = ds.as_of - days * 24
        portfolio[wkey] = {
            "ledger": sweep.ledger(ds, prev_w & legit, amount),
            "fraud": fraud_split(start, ds.as_of + 1),
            "freed": ra["freed"],
            # the previous window of the same length, for "vs previous period" comparisons
            "prev": None if ds.as_of - 2 * days * 24 < 0 else {
                "fraud": fraud_split(start - days * 24, start),
                "interventions": int((base.prevailing & (ds.hit_t >= ds.as_of - 2 * days * 24) & ~wb["mask"]).sum()),
                "ledger": sweep.ledger(ds, base.prevailing & legit & (ds.hit_t >= ds.as_of - 2 * days * 24) & ~wb["mask"], amount),
            },
            "rules": [{"rule_id": r.rule_id, "n": curves[r.rule_id]["points"][0]["ledger"]["n"],
                       "usd": curves[r.rule_id]["points"][0]["ledger"]["denied_usd"]
                       + curves[r.rule_id]["points"][0]["ledger"]["held_usd"],
                       "fraud": curves[r.rule_id]["base_fraud_caught_rule"], "shadow": r.shadow,
                       "live_since": r.live_since} for r in ds.rules],
            "clients": ds.n_clients,
            "interventions": int(prev_w.sum()),
            "clients_interrupted": int((wb["count"] > 0).sum()),
            "good_clients_heavy_friction": int(good_heavy),
            "free_to_remove": ra["interventions_removed"],
            "free_to_remove_clients": ra["clients_affected"],
            "grade_counts": grade_counts,
            "incidents": {"count": len(in_win_inc), "clients_affected": len(inc_clients)},
            "p75": _r(p75, 1),
            "by_checkpoint": cut(lambda h: ds.rules[ds.hit_rule[h]].checkpoint),
            "by_entity": cut(lambda h: f'{ds.clients[ds.hit_client[h]]["entity"]} · {ds.clients[ds.hit_client[h]]["segment"]}'),
        }

        total_fraud = int((ds.event_fraud & (ds.event_t >= ds.as_of - days * 24)).sum())
        base_caught = int(np.unique(ds.hit_event[base.prevailing & ds.hit_fraud & wb["mask"]]).size)
        metrics[wkey] = {
            "fraud": {"total": total_fraud, "caught": base_caught, "missed": total_fraud - base_caught,
                      "caught_after_relax_all": ra["fraud_caught_ruleset"]},
            "free_by_rule": [{
                "rule_id": r.rule_id, "label": curves[r.rule_id]["label"], "verdict": curves[r.rule_id]["verdict"],
                "expression": sweep.expression_at(r, grids[r.rule_id][curves[r.rule_id]["flat_index"]]),
                "interventions_removed": curves[r.rule_id]["points"][curves[r.rule_id]["flat_index"]]["interventions_removed"],
                "pct": _compact_point(curves[r.rule_id]["points"][curves[r.rule_id]["flat_index"]]).get("pct"),
            } for r in ds.rules],
            "relax_all": {
                "rules": [r.rule_id for r in relax],
                "interventions_removed": ra["interventions_removed"],
                "clients_affected": ra["clients_affected"],
                "established_clients_affected": ra["established_clients_affected"],
                "clients_above_p75_before": int((sw.base_client > p75).sum()),
                "clients_above_p75_after": ra["clients_above_p75"],
                "clients_friction_increased": ra["clients_friction_increased"],
                "established_cut_pct": [_r(est_cut[0], 1), _r(np.median(est_cut[1:]), 1),
                                        _r(np.percentile(est_cut[1:], 5), 1), _r(np.percentile(est_cut[1:], 95), 1)],
                "top_decile_share": [_r(top_decile_share(sw.base_client), 3), _r(top_decile_share(client_after), 3)],
            },
            "range_width_pts": _r(max([(c["points"][c["flat_index"]]["pct_of_rule"]["p95"]
                                        - c["points"][c["flat_index"]]["pct_of_rule"]["p5"])
                                       for c in curves.values() if c["verdict"] == "free"] or [0]), 1),
            "no_free_stretch": [r.rule_id for r in ds.rules if curves[r.rule_id]["verdict"] == "none"],
        }

    # ------------------------------------------------------------ trend
    legit_prev = base.prevailing & legit
    buckets = []
    for k in range(12):
        end = ds.as_of - (11 - k) * 30 * 24
        m = legit_prev & (ds.hit_t >= end - 30 * 24) & (ds.hit_t < end)
        by_rule = np.bincount(ds.hit_rule[m], minlength=len(ds.rules))
        buckets.append({"start": iso(end - 30 * 24), "end": iso(end), "n": int(m.sum()),
                        "established": int((m & established[ds.hit_client]).sum()),
                        "by_rule": {ds.rules[i].rule_id: int(v) for i, v in enumerate(by_rule) if v}})
    trend = {"buckets": buckets,
             "launches": [{"rule_id": r.rule_id, "date": r.live_since} for r in ds.rules
                          if not r.shadow and r.live_from >= ds.as_of - 360 * 24]}

    # ------------------------------------------------------------ rules
    rules_out = []
    for r in ds.rules:
        unit = sweep.UNITS.get(r.expr.feature, "")
        grid = grids[r.rule_id]
        rules_out.append({
            "rule_id": r.rule_id, "decision": r.decision, "decision_label": DECISION_LABELS.get(r.decision, r.decision),
            "name": r.name, "channel": r.channel,
            "checkpoint": r.checkpoint, "ruleset_id": r.ruleset_id, "order": r.order, "entity": r.entity,
            "request_type": r.request_type, "live_since": r.live_since, "description": r.description,
            "expression": r.text, "feature": r.expr.feature, "op": r.expr.op, "unit": unit, "shadow": r.shadow,
            "axis": "log" if unit in sweep.LOG_UNITS else "linear",
            "grid": grid, "grid_labels": [sweep.fmt(t, unit) for t in grid],
            "expressions": [sweep.expression_at(r, t) for t in grid],
            "windows": rule_windows[r.rule_id],
        })

    # ------------------------------------------------------------ clients
    tenure_pos = np.full(ds.n_clients, 0.5)
    for b in (bands.ESTABLISHED, bands.DEVELOPING, bands.LIMITED):
        idx = [i for i in range(ds.n_clients) if band_of[i] == b]
        ten = np.array([ds.clients[i]["tenure_months"] if ds.clients[i]["tenure_months"] is not None else np.nan
                        for i in idx], dtype=float)
        ten = np.where(np.isnan(ten), np.nanmedian(ten), ten)
        order = np.argsort(np.argsort(ten + np.arange(len(idx)) * 1e-6))
        tenure_pos[idx] = (order + 0.5) / max(len(idx), 1)

    clients_out = []
    for i, c in enumerate(ds.clients):
        b = band_rows[i]
        ev = b["evidence"]
        clients_out.append({
            "client_id": c["client_id"], "name": c["client_name"], "entity": c["entity"], "segment": c["segment"],
            "type": c.get("client_type") or c["segment"], "region": c.get("region") or None,
            "segment_label": f'{c["entity"].title() if c["entity"] == "DIRECT" else "Payfac"} {SEGMENT_LABELS[c["segment"]]}',
            "tenure_months": c["tenure_months"], "peer_group": c["peer_group"],
            "band": b["band"], "disqualified": b["disqualified"], "unknown": b["unknown"],
            "checks": b["checks"], "reasons": b["reasons"],
            "evidence": {k: (_r(v, 3) if isinstance(v, float) else v) for k, v in ev.items()},
            "x": _r(tenure_pos[i], 3),
            "windows": client_windows[i],
        })

    # ------------------------------------------------------------ timelines
    action_code = {"PREVAILED": "P", "CONTRIBUTING": "C", "SHADOW": "S", "OVERRIDDEN": "O"}
    c_weight, c_hold, c_recency = index.components(ds, w)
    timelines = {c["client_id"]: [] for c in ds.clients}
    for h in np.argsort(ds.hit_t):
        rule = ds.rules[ds.hit_rule[h]]
        e = ds.hit_event[h]
        val = ds.features[rule.expr.feature][e]
        live_contrib = ds.hit_live[h] and not base.prevailing[h]
        timelines[ds.clients[ds.hit_client[h]]["client_id"]].append({
            "t": iso(ds.hit_t[h]), "r": rule.rule_id, "d": str(ds.hit_decision[h]),
            "q": str(ds.event_request[e]), "c": rule.checkpoint,
            "a": "P" if base.prevailing[h] else ("C" if live_contrib else action_code[str(ds.hit_action[h])]),
            "o": str(ds.hit_final[h]), "x": int(ds.hit_fraud[h]),
            "v": None if np.isnan(val) else _r(val, 3), "k": _r(ds.hit_hours[h], 1),
            "s": _r(base.F[h, 0], 1) if base.prevailing[h] else 0,
            **({"w": _r(c_weight[h], 1), "u": _r(c_hold[h], 3), "y": _r(c_recency[h], 3)} if base.prevailing[h] else {}),
            "$": None if np.isnan(ds.features["amount"][e]) else _r(ds.features["amount"][e], 0),
        })

    # Payout amounts per client (for "why this rule keeps firing") and fraud values per rule.
    payouts = {}
    amounts = ds.features["amount"]
    for i, c in enumerate(ds.clients):
        m = (ds.event_client == i) & ds.event_is_payout & (ds.event_t >= ds.as_of - 365 * 24)
        payouts[c["client_id"]] = [[_r(t / 24, 2), _r(a, 2)] for t, a in zip(ds.event_t[m], amounts[m])]
    fraud_values = {}
    for r in ds.rules:
        m = (ds.hit_rule == r.idx) & ds.hit_fraud & ~ds.hit_overridden
        x = ds.features[r.expr.feature][ds.hit_event[m]]
        fraud_values[r.rule_id] = sorted({_r(v, 3) for v in x if not np.isnan(v)})

    return {
        "meta": {
            "synthetic": True,
            "notice": "SYNTHETIC DATA — generated for demonstration. No real clients, people or payments.",
            "seed": ds.manifest.get("seed"),
            "window_start": iso(0),
            "as_of": iso(ds.as_of),
            "windows": {k: {"days": d, "label": WINDOW_LABELS[k][0], "phrase": WINDOW_LABELS[k][1],
                            "start": iso(ds.as_of - d * 24)} for k, d in WINDOWS.items()},
            "counts": ds.manifest.get("counts", {}),
            "n_weightings": int(w.n - 1),
            "weights_version": cfg.get("weights_version", "v0"),
            "decision_rank": DECISION_RANK,
        },
        "config": cfg,
        "grades": cfg["friction_grades"],
        "demo": demo,
        "rules": rules_out,
        "clients": clients_out,
        "timelines": timelines,
        "payouts": payouts,
        "fraud_values": fraud_values,
        "incidents": [{k: inc[k] for k in ("incident_id", "start", "end", "severity")}
                      | {"n_clients": len(inc["clients"])} for inc in ds.incidents],
        "portfolio": portfolio,
        "metrics": metrics,
        "trend": trend,
    }


def summary(result: dict) -> dict:
    """The 30-day results in the shape of the designers' frictioniq-mock.json."""
    p = result["portfolio"]["30d"]
    rules = sorted(result["rules"], key=lambda r: -r["windows"]["30d"]["interventions"])
    hero = next((r for r in result["rules"] if r["rule_id"] == result["demo"].get("hero_rule")), rules[0])
    hw = hero["windows"]["30d"]["curve"]
    sel = hw["recommended_index"]
    sp = hw["points"][sel]
    clients = {c["client_id"]: c for c in result["clients"]}
    acme = clients.get(result["demo"].get("open_client"))
    look = sorted((c for c in result["clients"] if c["band"] == "established"),
                  key=lambda c: -c["windows"]["30d"]["score"][0])[:5]
    out = {
        "_note": "Generated by `python -m frictioniq` from the seeded synthetic world. Same shape as the "
                 "designers' frictioniq-mock.json. Not real clients, rules or outcomes.",
        "generator_seed": result["meta"]["seed"],
        "window": {"default": "30d", "options": list(WINDOWS),
                   "range": f'{result["meta"]["windows"]["30d"]["start"][:10]}/{result["meta"]["as_of"][:10]}'},
        "friction_grades": {**result["grades"]["cutoffs"], "colors": result["grades"]["colors"]},
        "portfolio": {k: p[k] for k in ("clients", "interventions", "clients_interrupted",
                                         "good_clients_heavy_friction", "free_to_remove", "grade_counts", "incidents")},
        "rules": [{"rule_id": r["rule_id"], "decision": r["decision"], "checkpoint": r["checkpoint"],
                   "live_since": r["live_since"], "description": r["description"],
                   "interventions": r["windows"]["30d"]["interventions"],
                   "free_stretch": r["windows"]["30d"]["curve"]["label"]} for r in rules],
        f"tradeoff_{hero['rule_id']}": {
            "today_threshold": hero["grid"][0],
            "selected_threshold": hero["grid"][sel],
            "flat_stretch_ends_at": hero["grid"][hw["flat_index"]],
            "friction_removed_pct": [[t, pt["pct"][0]] for t, pt in zip(hero["grid"], hw["points"])],
            "fraud_caught_pct": [[t, round(100 * pt["fraud_caught_rule"] / max(hw["base_fraud_caught_rule"], 1), 1)]
                                 for t, pt in zip(hero["grid"], hw["points"])],
            "at_selected": {"interventions_removed": sp["interventions_removed"],
                            "removed_pct_range": sp["pct"][1:], "clients_no_longer_interrupted": sp["clients_affected"],
                            "of_which_established": sp["established_clients_affected"],
                            "fraud_cases_caught": sp["fraud_caught_rule"],
                            "fraud_cases_today": hw["base_fraud_caught_rule"]},
        },
        "clients_to_look_at": [{"name": c["name"], "grade": c["windows"]["30d"]["grade"],
                                "score": round(c["windows"]["30d"]["score"][0]),
                                "top_rule": c["windows"]["30d"]["top_rule"]} for c in look],
    }
    if acme:
        a = acme["windows"]["30d"]
        out["client_" + acme["name"].split()[0].lower()] = {
            "client_id": acme["client_id"], "name": acme["name"], "segment": acme["segment_label"],
            "tenure_months": acme["tenure_months"], "band": acme["band"].title(),
            "friction_score": round(a["score"][0]), "score_range": [round(a["score"][1]), round(a["score"][2])],
            "grade": a["grade"], "grade_range": a["grade_range"], "peer_percentile": a["peer_pct"][0],
            "peer_n": a["peer_n"], "interventions_prev_month": a["prev_n"],
            "evidence": {"reviews_cleared": f'{acme["evidence"]["cleared"]} of {acme["evidence"]["challenges"]}',
                         "confirmed_fraud": acme["evidence"]["confirmed_fraud"],
                         "median_payout_usd": round(acme["evidence"]["median_payout"] or 0),
                         "disputes_12m": acme["evidence"]["disputes_12m"]},
            "interventions": [{"date": h["t"][:10], "rule_id": h["r"], "decision": h["d"], "checkpoint": h["c"],
                               "held_hours": h["k"] if h["d"] in ("HOLD", "SETTLEMENT_LIMIT") else None,
                               "outcome": h["o"]}
                              for h in result["timelines"][acme["client_id"]]
                              if h["a"] == "P" and h["t"] >= result["meta"]["windows"]["30d"]["start"]],
        }
    return out


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
    with open(os.path.join(out_dir, "frictioniq-summary.json"), "w") as f:
        json.dump(summary(result), f, indent=2)
    if js_path:
        os.makedirs(os.path.dirname(js_path), exist_ok=True)
        with open(js_path, "w") as f:
            f.write("// Generated by `python -m frictioniq`. SYNTHETIC DATA — for demonstration only.\n")
            f.write("window.FRICTIONIQ = ")
            json.dump(result, f, separators=(",", ":"))
            f.write(";\n")
