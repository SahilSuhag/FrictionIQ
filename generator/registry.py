"""Synthetic rule registry and ruleset bindings, copying production rule-authoring shape.

Rules vary in quality on purpose (PRD "Generation rules"): some over-fire on good
clients and have a long flat stretch, some are tightly targeted and have none, one is
a list-membership rule (two states, no curve) and one runs in shadow.
"""

# rule_id, rule_name, entity, request_type, category, sub_category, decision,
# rule_expression, shadow_setting, checkpoint, order
RULES = [
    ("R01", "instant_payout_cap", "DIRECT", "INSTANT_PAYOUT", "payout_risk", "instant_payout",
     "DENY", "amount > 100", "OFF", "PRE_PAYOUT", 20),
    ("R02", "boarding_identity_mismatch", "ALL", "SUBMERCHANT_BOARDING", "identity", "kyb_mismatch",
     "HOLD", "identity_mismatch_score > 0.8", "OFF", "CLIENT_BOARDING", 20),
    ("R03", "velocity_check", "ALL", "CAPTURE", "velocity", "txn_velocity",
     "HOLD", "txn_count_1h > 30", "OFF", "PRE_CAPTURE", 10),
    ("R04", "new_device_settlement_limit", "ALL", "CAPTURE", "device", "new_device",
     "SETTLEMENT_LIMIT", "device_age_hours < 72", "OFF", "PRE_CAPTURE", 30),
    ("R05", "high_risk_mcc_restrict", "ALL", "CAPTURE", "merchant_profile", "mcc",
     "RESTRICT", "mcc IN [5967, 7995, 5816]", "OFF", "PRE_CAPTURE", 50),
    ("R06", "refund_ratio_hold", "ALL", "*", "refund_abuse", "refund_ratio",
     "HOLD", "refund_ratio_30d > 0.15", "OFF", "PRE_PAYOUT", 30),
    ("R07", "bank_change_payout_deny", "ALL", "*", "account_takeover", "bank_change",
     "DENY", "hours_since_bank_change < 72", "OFF", "PRE_PAYOUT", 10),
    ("R08", "ticket_anomaly_deny", "ALL", "CAPTURE", "card_testing", "ticket_size",
     "DENY", "ticket_z_score > 4", "OFF", "PRE_CAPTURE", 20),
    ("R09", "cross_border_hold", "ALL", "CAPTURE", "geography", "cross_border",
     "HOLD", "cross_border_share > 0.6", "OFF", "PRE_CAPTURE", 40),
    ("R10", "payout_velocity_shadow", "ALL", "INSTANT_PAYOUT", "payout_risk", "payout_velocity",
     "DENY", "payouts_24h > 2", "ON", "PRE_PAYOUT", 15),
    ("R11", "synthetic_identity_terminate", "ALL", "SUBMERCHANT_BOARDING", "identity", "synthetic_id",
     "TERMINATE", "synthetic_id_score > 0.95", "OFF", "CLIENT_BOARDING", 10),
    ("R12", "chargeback_spike_block", "ALL", "CAPTURE", "disputes", "chargeback_rate",
     "BLOCK", "chargeback_rate_7d > 0.05", "OFF", "PRE_CAPTURE", 60),
]

RULESETS = {
    "CLIENT_BOARDING": "RS-BOARDING-01",
    "PRE_CAPTURE": "RS-CAPTURE-01",
    "PRE_PAYOUT": "RS-PAYOUT-01",
}

# Downstream allowlist: R09 hits on allowlisted global enterprises are overridden
# most of the time. The rule fires constantly but rarely inflicts anything.
OVERRIDE_RULES = {"R09": ("global_enterprise", 0.85)}


def rule_rows():
    keys = ["rule_id", "rule_name", "entity", "request_type", "category", "sub_category",
            "decision", "rule_expression", "shadow_setting"]
    return [dict(zip(keys, r[:9])) for r in RULES]


def binding_rows():
    return [
        {"ruleset_id": RULESETS[r[9]], "rule_id": r[0], "checkpoint": r[9], "order": r[10]}
        for r in RULES
    ]
