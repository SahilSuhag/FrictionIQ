"""The attribute schema: the only contract between the generator and the analysis.

Agreed on day one and frozen. The generator writes these tables; the analysis reads
them. Neither side imports the other's code — only this module and
``contract.expression``.

Field lists mirror the existing rule-authoring structure (PRD "Required attributes").
Two additions beyond the PRD table are marked ``# added``; both are needed for the
analysis to do what the PRD asks of it.
"""

# ---------------------------------------------------------------------------
# Tables (CSV files under data/, one per object)
# ---------------------------------------------------------------------------

RULE_FIELDS = [
    "rule_id",
    "rule_name",
    "entity",            # client entity the rule applies to: ALL | DIRECT | PAYFAC
    "request_type",      # INSTANT_PAYOUT | PAYOUT | CAPTURE | SUBMERCHANT_BOARDING | * (any at checkpoint)
    "category",
    "sub_category",
    "decision",          # one of DECISIONS below
    "rule_expression",   # "<feature> <op> <number>" or "<feature> IN [a, b, c]"
    "shadow_setting",    # ON | OFF
]

RULESET_BINDING_FIELDS = ["ruleset_id", "rule_id", "checkpoint", "order"]

RULE_HIT_FIELDS = [
    "hit_id",
    "rule_id",
    "client_id",
    "event_id",          # added: attribution is per event, so a hit must name its event
    "triggered_at",
    "resolved_at",
    "final_decision",    # how the event ended: CLEARED | UPHELD | NO_ACTION
    "action_taken",      # what this hit did: PREVAILED | CONTRIBUTING | SHADOW | OVERRIDDEN
]

CLIENT_FIELDS = [
    "client_id",
    "client_name",       # fictional, for the demo screens
    "entity",            # DIRECT | PAYFAC
    "segment",           # SMB | MID_MARKET | ENTERPRISE
    "tenure_months",     # may be blank (controlled missingness)
    "peer_group",        # may be blank (controlled missingness)
]

INCIDENT_FIELDS = ["incident_id", "start", "end", "affected_clients", "severity"]

# added: the population every sweep re-runs over. One row per request that reached a
# checkpoint. Feature columns are blank where they do not apply to the request type.
FEATURES = [
    "amount",
    "payouts_24h",
    "hours_since_bank_change",
    "refund_ratio_30d",
    "txn_count_1h",
    "ticket_z_score",
    "device_age_hours",
    "cross_border_share",
    "mcc",
    "chargeback_rate_7d",
    "identity_mismatch_score",
    "synthetic_id_score",
]
DECISION_EVENT_FIELDS = ["event_id", "client_id", "checkpoint", "request_type", "occurred_at"] + FEATURES

FRAUD_CASE_FIELDS = ["case_id", "client_id", "event_id", "confirmed_at", "fraud_type"]

TABLES = {
    "rules": RULE_FIELDS,
    "ruleset_bindings": RULESET_BINDING_FIELDS,
    "rule_hits": RULE_HIT_FIELDS,
    "clients": CLIENT_FIELDS,
    "incidents": INCIDENT_FIELDS,
    "decision_events": DECISION_EVENT_FIELDS,
    "fraud_cases": FRAUD_CASE_FIELDS,
}

# ---------------------------------------------------------------------------
# Vocabularies
# ---------------------------------------------------------------------------

# Intervention rank (PRD event taxonomy). Higher rank = heavier burden on the client.
# When several live rules hit one event, the highest-ranked decision prevails; ties
# go to the lowest binding order.
DECISION_RANK = {
    "SETTLEMENT_LIMIT": 1,
    "RESTRICT": 2,
    "HOLD": 3,
    "DENY": 4,
    "BLOCK": 5,
    "TERMINATE": 6,
}
DECISIONS = list(DECISION_RANK)

CHECKPOINTS = ["CLIENT_BOARDING", "PRE_CAPTURE", "PRE_PAYOUT"]
REQUEST_TYPES = ["SUBMERCHANT_BOARDING", "CAPTURE", "PAYOUT", "INSTANT_PAYOUT"]
ENTITIES = ["DIRECT", "PAYFAC"]
SEGMENTS = ["SMB", "MID_MARKET", "ENTERPRISE"]
INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3"]

FINAL_DECISIONS = ["CLEARED", "UPHELD", "NO_ACTION"]
ACTIONS = ["PREVAILED", "CONTRIBUTING", "SHADOW", "OVERRIDDEN"]

# All timestamps are ISO-8601 UTC strings: 2026-09-14T10:32:00Z
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# The observation window every table covers. The index is computed "as of" WINDOW_END.
WINDOW_START = "2026-07-03T00:00:00Z"
WINDOW_END = "2026-10-01T00:00:00Z"
