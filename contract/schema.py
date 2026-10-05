"""The attribute schema: the only contract between the generator and the analysis.

Agreed on day one and frozen. The generator writes these tables; the analysis reads
them. Neither side imports the other's code — only this module and
``contract.expression``.

Field lists mirror the existing rule-authoring structure (PRD "Required attributes").
Additions beyond the PRD table are marked ``# added`` with the reason.
"""

# ---------------------------------------------------------------------------
# Tables (CSV files under data/, one per object)
# ---------------------------------------------------------------------------

RULE_FIELDS = [
    "rule_id",           # the rule's name, e.g. payout_limit_100
    "rule_name",
    "entity",            # client entity the rule applies to: ALL | DIRECT | PAYFAC
    "request_type",      # one request type, several joined by "|", or * for any at the checkpoint
    "category",
    "sub_category",
    "decision",          # one of DECISIONS below
    "rule_expression",   # "<feature> <op> <number>" or "<feature> IN [a, b, c]"
    "shadow_setting",    # ON | OFF
    "description",       # added: what the rule does, in words (shown on hover in the client log)
    "live_since",        # added: date the rule went live; it is evaluated only on later events
    "channel",           # added: CARD_PRESENT | CARD_NOT_PRESENT for card checkpoints, else blank
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
    "client_type",       # ENTERPRISE | MID_MARKET | SMB | ISV | SCOTIA
    "region",            # CA | US | EMEA | APAC
]

CLIENT_TYPES = ["ENTERPRISE", "MID_MARKET", "SMB", "ISV", "SCOTIA"]
REGIONS = ["CA", "US", "EMEA", "APAC"]

INCIDENT_FIELDS = ["incident_id", "start", "end", "affected_clients", "severity"]

# added: the population every sweep re-runs over. One row per request that reached a
# checkpoint. Feature columns are blank where they do not apply to the request type.
FEATURES = [
    "amount",                     # payouts and captures, USD
    "payouts_24h",                # payouts by this client in the trailing 24 hours, this one included
    "refund_ratio_30d",           # refunds / sales over the trailing 30 days
    "counterparty_age_days",      # days since the client first paid this counterparty (0 = never before)
    "hours_since_device_change",  # hours since a login from a new device
    "txn_velocity_ratio",         # 24-hour transaction count / 30-day daily average
    "geo_mismatch_share",         # share of a capture batch's cards from outside the client's region
    "ticket_z_score",             # ticket size against the client's own baseline
    "device_age_hours",           # age of the capturing device
    "doc_mismatch_score",         # sub-merchant documents vs registry record, 0..1
]
DECISION_EVENT_FIELDS = ["event_id", "client_id", "checkpoint", "request_type", "occurred_at"] + FEATURES

FRAUD_CASE_FIELDS = ["case_id", "client_id", "event_id", "confirmed_at", "fraud_type"]

# added: account standing for the good-client definition — disputes, chargebacks and
# reversals are not fraud-rule outputs, which is why they can be evidence.
DISPUTE_FIELDS = ["dispute_id", "client_id", "opened_at", "kind"]

TABLES = {
    "rules": RULE_FIELDS,
    "ruleset_bindings": RULESET_BINDING_FIELDS,
    "rule_hits": RULE_HIT_FIELDS,
    "clients": CLIENT_FIELDS,
    "incidents": INCIDENT_FIELDS,
    "decision_events": DECISION_EVENT_FIELDS,
    "fraud_cases": FRAUD_CASE_FIELDS,
    "disputes": DISPUTE_FIELDS,
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
# A rule may be authored as DENY_OR_HOLD: it denies what cannot be held (an instant
# payout) and holds everything else for manual review.
COMPOUND_DECISIONS = {"DENY_OR_HOLD"}
DECISIONS = list(DECISION_RANK) + sorted(COMPOUND_DECISIONS)

INSTANT_REQUESTS = {"INSTANT_PAYOUT"}


def resolve_decision(decision: str, request_type: str) -> str:
    """The intervention a rule actually applies to one request."""
    if decision == "DENY_OR_HOLD":
        return "DENY" if request_type in INSTANT_REQUESTS else "HOLD"
    return decision


def request_types(field: str) -> set[str] | None:
    """Parse a rule's request_type field. None means any request at the checkpoint."""
    return None if field == "*" else set(field.split("|"))


CHECKPOINTS = ["CLIENT_BOARDING", "PRE_CAPTURE", "PRE_SETTLEMENT", "PRE_PAYOUT"]
REQUEST_TYPES = ["SUBMERCHANT_BOARDING", "CAPTURE", "SETTLEMENT", "PAYOUT", "INSTANT_PAYOUT", "BULK_PAYOUT"]
ENTITIES = ["DIRECT", "PAYFAC"]
SEGMENTS = ["SMB", "MID_MARKET", "ENTERPRISE"]
INCIDENT_SEVERITIES = ["SEV1", "SEV2", "SEV3"]

FINAL_DECISIONS = ["CLEARED", "UPHELD", "NO_ACTION"]
ACTIONS = ["PREVAILED", "CONTRIBUTING", "SHADOW", "OVERRIDDEN"]

# All timestamps are ISO-8601 UTC strings: 2026-09-14T10:32:00Z
TIMESTAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"

# The observation window every table covers: twelve months. The index is computed
# "as of" WINDOW_END.
WINDOW_START = "2025-10-03T00:00:00Z"
WINDOW_END = "2026-10-03T00:00:00Z"
