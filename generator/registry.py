"""Synthetic rule registry and ruleset bindings, copying production rule-authoring shape.

Rules vary in quality on purpose (PRD "Generation rules"): some over-fire on good
clients and have a long free stretch, some are tightly targeted and have none, and one
runs in shadow. payout_limit_100 is the hero rule; boarding_doc_mismatch is the
negative finding.
"""

# rule_id, entity, request_type, category, sub_category, decision, rule_expression,
# shadow_setting, checkpoint, order, live_since, description
RULES = [
    ("payout_limit_100", "DIRECT", "PAYOUT|INSTANT_PAYOUT", "payout_risk", "payout_size",
     "DENY_OR_HOLD", "amount > 100", "OFF", "PRE_PAYOUT", 20, "2026-08-28",
     "Denies or holds any payout over $100 before it is released."),
    ("velocity_check", "ALL", "SETTLEMENT", "velocity", "txn_velocity",
     "SETTLEMENT_LIMIT", "txn_velocity_ratio > 3", "OFF", "PRE_SETTLEMENT", 10, "2024-03-11",
     "Limits settlement when a client's 24-hour transaction count is 3x their 30-day average."),
    ("new_counterparty", "ALL", "*", "payout_risk", "counterparty",
     "HOLD", "counterparty_age_days < 14", "OFF", "PRE_PAYOUT", 30, "2025-01-20",
     "Holds a payout for review when it goes to someone the client first paid less than 14 days ago."),
    ("boarding_doc_mismatch", "ALL", "SUBMERCHANT_BOARDING", "identity", "kyb_documents",
     "HOLD", "doc_mismatch_score > 0.8", "OFF", "CLIENT_BOARDING", 20, "2023-06-05",
     "Holds a new sub-merchant for review when its documents don't match the registry record."),
    ("geo_mismatch", "ALL", "CAPTURE", "geography", "card_origin",
     "HOLD", "geo_mismatch_share > 0.6", "OFF", "PRE_CAPTURE", 10, "2024-11-04",
     "Holds a capture batch when most of its cards come from outside the client's usual region."),
    ("payout_velocity_24h", "ALL", "PAYOUT|INSTANT_PAYOUT", "payout_risk", "payout_velocity",
     "DENY", "payouts_24h > 2", "OFF", "PRE_PAYOUT", 15, "2024-07-01",
     "Denies a third payout within 24 hours."),
    ("refund_ratio_30d", "ALL", "*", "refund_abuse", "refund_ratio",
     "HOLD", "refund_ratio_30d > 0.15", "OFF", "PRE_PAYOUT", 35, "2023-02-13",
     "Holds a payout when refunds exceed 15% of the client's sales over 30 days."),
    ("device_change_payout", "ALL", "*", "account_takeover", "device_change",
     "DENY", "hours_since_device_change < 48", "OFF", "PRE_PAYOUT", 10, "2025-05-19",
     "Denies a payout made within 48 hours of a login from a new device."),
    ("card_testing_deny", "ALL", "CAPTURE", "card_testing", "ticket_size",
     "DENY", "ticket_z_score > 4", "OFF", "PRE_CAPTURE", 20, "2023-09-25",
     "Denies a capture batch whose ticket size is far outside the client's own pattern."),
    ("new_device_limit", "ALL", "CAPTURE", "device", "new_device",
     "SETTLEMENT_LIMIT", "device_age_hours < 72", "OFF", "PRE_CAPTURE", 30, "2024-02-12",
     "Limits settlement on captures from a device first seen less than 72 hours ago."),
    ("payout_limit_50_shadow", "DIRECT", "PAYOUT|INSTANT_PAYOUT", "payout_risk", "payout_size",
     "DENY_OR_HOLD", "amount > 50", "ON", "PRE_PAYOUT", 25, "2026-09-01",
     "Shadow test of a $50 payout cap: logs what it would deny or hold, acts on nothing."),
]

# Readable names for the screens (rule_id stays the identifier).
NAMES = {
    "payout_limit_100": "Payout limit $100",
    "velocity_check": "Velocity check",
    "new_counterparty": "New counterparty",
    "boarding_doc_mismatch": "Boarding document mismatch",
    "geo_mismatch": "Geo mismatch",
    "payout_velocity_24h": "Payout velocity 24h",
    "refund_ratio_30d": "Refund ratio 30d",
    "device_change_payout": "Device change payout",
    "card_testing_deny": "Card testing",
    "new_device_limit": "New device limit",
    "payout_limit_50_shadow": "Payout limit $50 (shadow)",
}

# Card channel for rules at card checkpoints. Metadata only: it does not change when a rule fires.
CHANNELS = {
    "geo_mismatch": "CARD_NOT_PRESENT",
    "card_testing_deny": "CARD_NOT_PRESENT",
    "new_device_limit": "CARD_PRESENT",
}

RULESETS = {
    "CLIENT_BOARDING": "RS-BOARDING-01",
    "PRE_CAPTURE": "RS-CAPTURE-01",
    "PRE_SETTLEMENT": "RS-SETTLEMENT-01",
    "PRE_PAYOUT": "RS-PAYOUT-01",
}

# Downstream allowlist: geo_mismatch hits on allowlisted global enterprises are
# overridden most of the time. The rule fires constantly there but rarely acts.
OVERRIDE_RULES = {"geo_mismatch": ("global_enterprise", 0.85)}


def rule_rows():
    return [{
        "rule_id": r[0], "rule_name": NAMES.get(r[0], r[0]), "entity": r[1], "request_type": r[2], "category": r[3],
        "sub_category": r[4], "decision": r[5], "rule_expression": r[6], "shadow_setting": r[7],
        "description": r[11], "live_since": r[10], "channel": CHANNELS.get(r[0], ""),
    } for r in RULES]


def binding_rows():
    return [{"ruleset_id": RULESETS[r[8]], "rule_id": r[0], "checkpoint": r[8], "order": r[9]} for r in RULES]
