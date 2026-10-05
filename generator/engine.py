"""Run every event through the bound rulesets and log what happened.

Every hit is logged regardless of outcome, as Shield does: prevailing, contributing,
shadow and downstream-overridden hits all land in rule_hits.
"""

from __future__ import annotations

import math
import random

from contract import expression
from contract.schema import DECISION_RANK, request_types, resolve_decision

from .registry import OVERRIDE_RULES, RULES
from .world import WINDOW_HOURS, Client, Event, at

# Median hours to resolve. HOLD medians are per rule because review queues differ.
HOLD_MEDIAN = {"payout_limit_100": 20.0, "new_counterparty": 3.0, "boarding_doc_mismatch": 18.0,
               "geo_mismatch": 3.0, "refund_ratio_30d": 8.0}
RESOLVE = {
    "SETTLEMENT_LIMIT": (60.0, 0.4),
    "RESTRICT": (168.0, 0.3),
    "DENY": (20.0, 0.8),
    "BLOCK": (96.0, 0.5),
    "TERMINATE": (0.0, 0.0),
}


class _Rule:
    def __init__(self, row):
        (self.rule_id, self.entity, req, _cat, _sub, self.decision, text, shadow, self.checkpoint,
         self.order, live_since, _desc) = row
        self.requests = request_types(req)
        self.expr = expression.parse(text)
        self.shadow = shadow == "ON"
        self.live_from = at(live_since, 0)

    def applies(self, ev: Event, client: Client) -> bool:
        if ev.checkpoint != self.checkpoint or ev.t < self.live_from:
            return False
        if self.requests is not None and ev.request_type not in self.requests:
            return False
        if self.entity != "ALL" and client.entity != self.entity:
            return False
        return self.expr.matches(ev.features.get(self.expr.feature))


def _duration(rng: random.Random, rule: _Rule, decision: str, upheld: bool) -> float:
    if decision == "HOLD":
        median, sigma = (30.0 if upheld else HOLD_MEDIAN.get(rule.rule_id, 4.0)), 0.6
    else:
        median, sigma = RESOLVE[decision]
    if median == 0:
        return 0.0
    return rng.lognormvariate(math.log(median), sigma)


def evaluate(rng: random.Random, clients: dict[str, Client], events: list[Event]) -> list[dict]:
    rules = [_Rule(r) for r in RULES]
    by_checkpoint: dict[str, list[_Rule]] = {}
    for r in rules:
        by_checkpoint.setdefault(r.checkpoint, []).append(r)

    hits = []
    for ev in events:
        client = clients[ev.client_id]
        fired = [r for r in by_checkpoint.get(ev.checkpoint, []) if r.applies(ev, client)]
        if not fired:
            continue

        decision = {r.rule_id: resolve_decision(r.decision, ev.request_type) for r in fired}
        status = {}
        for r in fired:
            if r.shadow:
                status[r.rule_id] = "SHADOW"
            elif r.rule_id in OVERRIDE_RULES and client.peer_group == OVERRIDE_RULES[r.rule_id][0] \
                    and rng.random() < OVERRIDE_RULES[r.rule_id][1]:
                status[r.rule_id] = "OVERRIDDEN"
            else:
                status[r.rule_id] = "LIVE"

        live = [r for r in fired if status[r.rule_id] == "LIVE"]
        prevailing = max(live, key=lambda r: (DECISION_RANK[decision[r.rule_id]], -r.order)) if live else None

        if prevailing is None:
            final = "NO_ACTION"
        elif ev.outcome is not None:
            final = ev.outcome
        elif ev.fraud_type is not None:
            final = "UPHELD"
        else:
            final = "CLEARED" if rng.random() < client.clear_prob else "UPHELD"

        for r in fired:
            if status[r.rule_id] != "LIVE":
                action, hours = status[r.rule_id], 0.0
            else:
                action = "PREVAILED" if r is prevailing else "CONTRIBUTING"
                if r is prevailing and ev.hold_hours is not None:
                    hours = ev.hold_hours
                else:
                    hours = _duration(rng, r, decision[r.rule_id], final == "UPHELD")
            hours = min(hours, WINDOW_HOURS - ev.t)      # measured up to the as-of
            hits.append({
                "rule_id": r.rule_id,
                "client_id": ev.client_id,
                "event_id": ev.event_id,
                "t": ev.t,
                "resolved_t": ev.t + hours,
                "final_decision": final,
                "action_taken": action,
            })
    return hits
