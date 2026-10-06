"""Load the generator's tables into column arrays. Reads only what the schema promises."""

from __future__ import annotations

import csv
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import numpy as np

from contract import expression, schema

_EPOCH = datetime.strptime(schema.WINDOW_START, schema.TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
AS_OF_HOURS = (datetime.strptime(schema.WINDOW_END, schema.TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc)
               - _EPOCH).total_seconds() / 3600.0
PAYOUT_REQUESTS = {"PAYOUT", "INSTANT_PAYOUT", "BULK_PAYOUT"}


def hours(ts: str) -> float:
    """ISO timestamp -> hours since WINDOW_START."""
    return (datetime.strptime(ts, schema.TIMESTAMP_FORMAT).replace(tzinfo=timezone.utc) - _EPOCH).total_seconds() / 3600.0


def iso(h: float) -> str:
    return (_EPOCH + timedelta(hours=float(h))).strftime(schema.TIMESTAMP_FORMAT)


def _read(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


@dataclass
class Rule:
    idx: int
    rule_id: str
    name: str
    entity: str
    request_type: str
    category: str
    sub_category: str
    decision: str
    text: str
    expr: expression.Expression
    shadow: bool
    checkpoint: str
    order: int
    ruleset_id: str
    description: str
    live_since: str
    live_from: float          # hours since WINDOW_START
    channel: str = ""         # CARD_PRESENT | CARD_NOT_PRESENT at card checkpoints

    @property
    def requests(self) -> set[str] | None:
        return schema.request_types(self.request_type)


class Dataset:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        manifest_path = os.path.join(data_dir, "manifest.json")
        self.manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}

        # --- clients
        self.clients = _read(os.path.join(data_dir, "clients.csv"))
        for c in self.clients:
            c["tenure_months"] = int(c["tenure_months"]) if c["tenure_months"] else None
            c["peer_group"] = c["peer_group"] or None
        self.client_index = {c["client_id"]: i for i, c in enumerate(self.clients)}
        self.n_clients = len(self.clients)
        self.client_entity = np.array([c["entity"] for c in self.clients])
        self.client_segment = np.array([c["segment"] for c in self.clients])

        # --- rules and bindings
        bindings = {b["rule_id"]: b for b in _read(os.path.join(data_dir, "ruleset_bindings.csv"))}
        self.rules: list[Rule] = []
        for i, r in enumerate(_read(os.path.join(data_dir, "rules.csv"))):
            b = bindings[r["rule_id"]]
            self.rules.append(Rule(i, r["rule_id"], r["rule_name"], r["entity"], r["request_type"], r["category"],
                                   r["sub_category"], r["decision"], r["rule_expression"],
                                   expression.parse(r["rule_expression"]), r["shadow_setting"] == "ON",
                                   b["checkpoint"], int(b["order"]), b["ruleset_id"], r["description"],
                                   r["live_since"], hours(r["live_since"] + "T00:00:00Z"), r.get("channel") or ""))
        self.rule_index = {r.rule_id: r.idx for r in self.rules}

        # --- decision events
        ev = _read(os.path.join(data_dir, "decision_events.csv"))
        # A retried request carries the same idempotency key: count it once, keep the first.
        seen, kept, self.dropped_events = set(), [], set()
        for e in ev:
            k = e.get("idempotency_key") or e["event_id"]
            if k in seen:
                self.dropped_events.add(e["event_id"])
                continue
            seen.add(k)
            kept.append(e)
        ev = kept
        self.n_events = len(ev)
        self.event_ids = [e["event_id"] for e in ev]
        self.event_index = {eid: i for i, eid in enumerate(self.event_ids)}
        self.event_client = np.array([self.client_index[e["client_id"]] for e in ev], dtype=np.int32)
        self.event_checkpoint = np.array([e["checkpoint"] for e in ev])
        self.event_request = np.array([e["request_type"] for e in ev])
        self.event_t = np.array([hours(e["occurred_at"]) for e in ev])
        self.event_is_payout = np.isin(self.event_request, list(PAYOUT_REQUESTS))
        self.event_channel = np.array([e.get("channel", "") for e in ev])
        self.event_recurring = np.array([e.get("is_recurring", "") == "TRUE" for e in ev])
        self.event_tx = [e.get("transaction_id", "") for e in ev]
        self.event_sub = [e.get("sub_merchant_id", "") for e in ev]
        self.has_channel = bool((self.event_channel != "").any())
        self.features = {
            f: np.array([float(e[f]) if e[f] != "" else np.nan for e in ev]) for f in schema.FEATURES
        }
        del ev

        # --- fraud labels (the capture guardrail)
        self.fraud_cases = _read(os.path.join(data_dir, "fraud_cases.csv"))
        self.event_fraud = np.zeros(self.n_events, dtype=bool)
        self.client_fraud_count = np.zeros(self.n_clients, dtype=np.int32)
        self.fraud_cases = [fc for fc in self.fraud_cases if fc["event_id"] not in self.dropped_events]
        for fc in self.fraud_cases:
            self.event_fraud[self.event_index[fc["event_id"]]] = True
            self.client_fraud_count[self.client_index[fc["client_id"]]] += 1

        # --- disputes (account standing)
        self.client_disputes = np.zeros(self.n_clients, dtype=np.int32)
        path = os.path.join(data_dir, "disputes.csv")
        if os.path.exists(path):
            for d in _read(path):
                self.client_disputes[self.client_index[d["client_id"]]] += 1

        # --- rule hits
        hits = [h for h in _read(os.path.join(data_dir, "rule_hits.csv")) if h["event_id"] not in self.dropped_events]
        self.n_hits = len(hits)
        self.hit_ids = [h["hit_id"] for h in hits]
        self.hit_rule = np.array([self.rule_index[h["rule_id"]] for h in hits], dtype=np.int32)
        self.hit_event = np.array([self.event_index[h["event_id"]] for h in hits], dtype=np.int32)
        self.hit_client = np.array([self.client_index[h["client_id"]] for h in hits], dtype=np.int32)
        self.hit_t = np.array([hours(h["triggered_at"]) for h in hits])
        self.hit_resolved_t = np.array([hours(h["resolved_at"]) for h in hits])
        self.hit_hours = np.maximum(self.hit_resolved_t - self.hit_t, 0.0)
        self.hit_final = np.array([h["final_decision"] for h in hits])
        self.hit_action = np.array([h["action_taken"] for h in hits])

        # The intervention each hit applies: a DENY_OR_HOLD rule denies an instant payout
        # and holds anything else. The friction weight comes straight from it.
        self.hit_decision = np.array([schema.resolve_decision(self.rules[r].decision, self.event_request[e])
                                      for r, e in zip(self.hit_rule, self.hit_event)])
        self.hit_rank = np.array([schema.DECISION_RANK[d] for d in self.hit_decision])
        order = np.array([r.order for r in self.rules])
        shadow = np.array([r.shadow for r in self.rules])
        self.hit_order = order[self.hit_rule]
        self.hit_shadow = shadow[self.hit_rule]
        # Downstream override is a fact about what happened, not something the analysis
        # can re-derive, so it is read from the log.
        self.hit_overridden = self.hit_action == "OVERRIDDEN"
        self.hit_live = ~self.hit_shadow & ~self.hit_overridden
        self.hit_is_hold = self.hit_decision == "HOLD"
        self.hit_fraud = self.event_fraud[self.hit_event]

        # --- incidents
        self.incidents = _read(os.path.join(data_dir, "incidents.csv"))
        for inc in self.incidents:
            inc["start_h"] = hours(inc["start"])
            inc["end_h"] = hours(inc["end"])
            inc["clients"] = [self.client_index[c] for c in inc["affected_clients"].split(";") if c]

        # --- account-level actions and ISV sub-merchants (optional tables)
        path = os.path.join(data_dir, "account_actions.csv")
        self.account_actions = _read(path) if os.path.exists(path) else []
        for a in self.account_actions:
            a["start_h"] = hours(a["started_at"])
            a["end_h"] = hours(a["ended_at"]) if a["ended_at"] else None
        path = os.path.join(data_dir, "sub_merchants.csv")
        self.sub_merchants = {s["sub_merchant_id"]: s for s in _read(path)} if os.path.exists(path) else {}

        self.as_of = AS_OF_HOURS

    # ------------------------------------------------------------------
    def rule_applies(self, rule: Rule) -> np.ndarray:
        """Events a rule is evaluated on: its checkpoint, request types, client entity, live date."""
        mask = (self.event_checkpoint == rule.checkpoint) & (self.event_t >= rule.live_from)
        if rule.requests is not None:
            mask &= np.isin(self.event_request, list(rule.requests))
        if rule.entity != "ALL":
            mask &= self.client_entity[self.event_client] == rule.entity
        if rule.channel and self.has_channel:
            mask &= np.isin(self.event_channel, list(schema.RULE_CHANNEL_MATCHES[rule.channel]))
        return mask

    def evaluate(self, rule: Rule, threshold: float | None = None, disabled: bool = False) -> np.ndarray:
        """Re-run a rule over the whole population at a threshold. Returns an event mask."""
        if disabled:
            return np.zeros(self.n_events, dtype=bool)
        x = self.features[rule.expr.feature]
        expr = rule.expr
        t = expr.threshold if threshold is None else threshold
        with np.errstate(invalid="ignore"):
            if expr.op == ">":
                fired = x > t
            elif expr.op == ">=":
                fired = x >= t
            elif expr.op == "<":
                fired = x < t
            elif expr.op == "<=":
                fired = x <= t
            else:
                fired = np.isin(x, np.array(expr.members))
        return fired & ~np.isnan(x) & self.rule_applies(rule)
