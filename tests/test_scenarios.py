"""The seven PRD client scenarios, the screen designs' rule labels, and the invariants the
curve's honesty rests on.

If these behave correctly the logic is right. Scenario pairs are the useful part:
5a/5b differ only in hold duration, 1/7 differ only in whether the rule has a free
stretch.
"""

import json
import os

import numpy as np
import pytest

from contract import expression, schema
from frictioniq import config, index, report
from frictioniq.data import Dataset, hours
from generator import generate

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Labels from the screen designs (frictioniq-mock.json), in the mock's wording. The screens
# now word them as `shown()` does; the verdicts and values are unchanged.
DESIGN_LABELS = {
    "payout_limit_100": "Free to $1,800",
    "velocity_check": "Free to 4×",
    "new_counterparty": "Small free stretch",
    "boarding_doc_mismatch": "No free stretch",
    "geo_mismatch": "Small free stretch",
    "payout_velocity_24h": "No free stretch",
    "refund_ratio_30d": "Free to 18%",
    "device_change_payout": "No free stretch",
}


def shown(design_label: str) -> str:
    """The mock's label as the screens word it."""
    if design_label.startswith("Free to "):
        return "Safe to relax to " + design_label[len("Free to "):]
    return {"Small free stretch": "Little to gain", "No free stretch": "Keep as is"}[design_label]


@pytest.fixture(scope="session")
def world(tmp_path_factory):
    out = tmp_path_factory.mktemp("data")
    generate.main(["--seed", str(generate.DEFAULT_SEED), "--out", str(out)])
    ds = Dataset(str(out))
    cfg = config.load()
    demo = json.load(open(os.path.join(ROOT, "config", "demo.json")))
    res = report.build(ds, cfg, demo)
    clients = {c["client_id"]: c for c in res["clients"]}
    rules = {r["rule_id"]: r for r in res["rules"]}
    return ds, cfg, res, clients, rules


def prevailing_30d(res, cid):
    start = res["meta"]["windows"]["30d"]["start"]
    return [h for h in res["timelines"][cid] if h["a"] == "P" and h["t"] >= start]


# ---------------------------------------------------------------- scenarios

def test_1_hero_one_rule_causes_most_friction_and_relaxing_it_is_free(world):
    ds, cfg, res, clients, rules = world
    acme = clients["ACME-0417"]
    w = acme["windows"]["30d"]
    assert acme["name"] == "Acme Supplies" and acme["band"] == "established"
    hits = prevailing_30d(res, "ACME-0417")
    assert len(hits) == 9 and w["n"] == 9
    r01 = [h for h in hits if h["r"] == "payout_limit_100"]
    assert len(r01) == 7
    assert sorted(h["d"] for h in r01) == ["DENY"] * 5 + ["HOLD"] * 2      # deny-or-hold by payout type
    assert w["prev_n"] == 3                                                 # "3 -> 9"
    assert w["top_rule"] == "payout_limit_100"
    assert w["denied"] == 5 and w["denied_fraud"] == 0
    assert w["holds"] == 3 and w["holds_cleared"] == 3 and 45 <= w["hold_hours"] <= 55   # ~2 days
    ev = acme["evidence"]
    assert (ev["cleared"], ev["challenges"], ev["confirmed_fraud"], ev["disputes_12m"]) == (14, 14, 0, 0)
    assert 140 <= ev["median_payout"] <= 160

    hero = rules["payout_limit_100"]
    c = hero["windows"]["30d"]["curve"]
    assert c["label"] == "Safe to relax to $1,800"
    i500 = hero["grid"].index(500)
    assert c["recommended_index"] == i500
    assert c["points"][i500]["fraud_caught_rule"] == c["base_fraud_caught_rule"]
    assert c["points"][i500]["pct"][0] >= 80
    assert hero["windows"]["30d"]["example"]["client_id"] == "ACME-0417"
    assert c["points"][0]["example_interventions"] == 7 and c["points"][i500]["example_interventions"] == 0


def test_2_incident_band_is_separate_and_relaxing_rules_would_not_help(world):
    _, _, _, clients, _ = world
    w = clients["DELT-2265"]["windows"]["30d"]
    share = w["incident"]["friction"] / (w["incident"]["friction"] + w["score"][0])
    assert 0.8 <= share <= 0.9
    assert w["n"] == 2
    assert w["grade"] == "A"            # the outage is never added to the score


def test_3_earned_friction_is_not_relaxed(world):
    _, _, res, clients, _ = world
    north = clients["NORT-7716"]
    assert north["band"] == "limited" and north["disqualified"]
    assert north["evidence"]["confirmed_fraud"] == 2
    hits = prevailing_30d(res, "NORT-7716")
    assert len(hits) == 11
    assert len({h["r"] for h in hits}) == 4
    assert len({h["c"] for h in hits}) == 3
    assert north["windows"]["30d"]["grade"] == "F"
    assert not north["windows"]["30d"]["eligible"]


def test_4_attribution_by_order_without_double_counting(world):
    _, _, res, clients, _ = world
    by_event = {}
    for h in res["timelines"]["MERI-3054"]:
        by_event.setdefault((h["t"], h["c"]), []).append(h)
    (event,) = [hs for hs in by_event.values() if len(hs) == 3]
    assert {h["r"]: h["a"] for h in event} == {"card_testing_deny": "P", "geo_mismatch": "C",
                                               "new_device_limit": "C"}
    w = clients["MERI-3054"]["windows"]["30d"]
    assert w["n"] == 1
    assert abs(w["score"][0] - sum(h["s"] for h in event)) < 0.05


def test_5_one_long_hold_outweighs_six_short_ones_under_every_weighting(world):
    ds, cfg, *_ = world
    w = index.sample_weightings(cfg)
    base = index.baseline(ds, w)
    f30 = base.windows[30]["rule"]
    a, b = ds.client_index["JUNI-5521"], ds.client_index["OAKM-6630"]
    assert base.windows[30]["count"][a] == 1 and base.windows[30]["count"][b] == 6
    assert (f30[a] > f30[b]).all()


def test_6_shadow_hits_log_but_cost_nothing(world):
    _, _, res, clients, _ = world
    lantern = clients["LANT-8842"]
    assert lantern["band"] == "developing"
    start = res["meta"]["windows"]["30d"]["start"]
    tl = [h for h in res["timelines"]["LANT-8842"] if h["t"] >= start]
    assert sum(h["a"] == "S" for h in tl) == 40
    live = [h for h in tl if h["a"] == "P"]
    assert len(live) == 1
    assert abs(lantern["windows"]["30d"]["score"][0] - live[0]["s"]) < 0.05


def test_7_negative_finding_rule_earning_its_friction(world):
    _, _, res, clients, rules = world
    hits = prevailing_30d(res, "HALC-1190")
    assert len(hits) == 6 and {h["r"] for h in hits} == {"boarding_doc_mismatch"}
    assert clients["HALC-1190"]["band"] == "established"
    for wkey in ("30d", "60d", "1y"):
        c = rules["boarding_doc_mismatch"]["windows"][wkey]["curve"]
        assert c["label"] == "Keep as is"
        assert c["points"][2]["fraud_caught_rule"] < c["base_fraud_caught_rule"]


# ---------------------------------------------------------------- designs

@pytest.mark.parametrize("wkey", ["30d", "60d", "1y"])
def test_rule_labels_match_the_screen_designs(world, wkey):
    *_, rules = world
    got = {rid: rules[rid]["windows"][wkey]["curve"]["label"] for rid in DESIGN_LABELS}
    assert got == {rid: shown(label) for rid, label in DESIGN_LABELS.items()}


def test_rule_list_leads_with_the_hero_rule(world):
    *_, rules = world
    order = sorted(rules.values(), key=lambda r: -r["windows"]["30d"]["interventions"])
    assert order[0]["rule_id"] == "payout_limit_100"


def test_grades_use_the_placeholder_cutoffs(world):
    _, cfg, *_ = world
    cases = {0: "A", 49.9: "A", 50: "B", 149: "C", 150: "D", 219.9: "D", 220: "E", 299: "E", 300: "F", 900: "F"}
    assert {s: report.grade_of(s, cfg) for s in cases} == cases


# ---------------------------------------------------------------- invariants

def test_re_evaluating_rules_reproduces_the_logged_hits(world):
    ds, *_ = world
    for rule in ds.rules:
        fired = np.flatnonzero(ds.evaluate(rule))
        logged = np.unique(ds.hit_event[ds.hit_rule == rule.idx])
        assert np.array_equal(np.sort(fired), logged), rule.rule_id


def test_attribution_matches_the_log(world):
    ds, *_ = world
    prev = index.prevailing(ds, ds.hit_live)
    assert np.array_equal(prev, ds.hit_action == "PREVAILED")


def test_rules_only_fire_after_they_go_live(world):
    ds, *_ = world
    for rule in ds.rules:
        assert (ds.hit_t[ds.hit_rule == rule.idx] >= hours(rule.live_since + "T00:00:00Z")).all(), rule.rule_id


def test_deny_or_hold_denies_instant_payouts_and_holds_the_rest():
    assert schema.resolve_decision("DENY_OR_HOLD", "INSTANT_PAYOUT") == "DENY"
    assert schema.resolve_decision("DENY_OR_HOLD", "PAYOUT") == "HOLD"
    assert schema.resolve_decision("HOLD", "INSTANT_PAYOUT") == "HOLD"


def test_weightings_respect_the_ordering_and_are_anchored_at_the_hold(world):
    _, cfg, *_ = world
    w = index.sample_weightings(cfg)
    assert w.n == cfg["weighting_sweep"]["n_samples"] + 1
    assert (np.diff(w.weights[:, 1:], axis=1) > 0).all()
    assert (w.weights[:, 0] == 0).all()
    hold = schema.DECISION_RANK["HOLD"]
    assert np.allclose(w.weights[:, hold], cfg["decision_weights"]["HOLD"])


def test_curves_are_monotone_and_fraud_is_measured_on_the_whole_population(world):
    ds, _, res, _, rules = world
    for r in rules.values():
        for wkey in ("30d", "1y"):
            pts = r["windows"][wkey]["curve"]["points"]
            caught = [p["fraud_caught_rule"] for p in pts]
            removed = [p["interventions_removed"] for p in pts]
            assert caught == sorted(caught, reverse=True), r["rule_id"]
            assert removed == sorted(removed), r["rule_id"]
    m = res["metrics"]["30d"]["fraud"]
    assert m["caught_after_relax_all"] == m["caught"]


def test_safe_to_remove_is_the_cautious_estimate(world):
    """The headline counts good clients only, at recommended settings: a small share, no fraud lost."""
    _, _, res, _, _ = world
    for wkey in ("30d", "60d", "1y"):
        p, m = res["portfolio"][wkey], res["metrics"][wkey]
        assert m["fraud"]["caught_after_relax_good"] == m["fraud"]["caught"]
        assert 0 < p["free_to_remove"] < m["relax_all"]["interventions_removed"]
        assert p["free_to_remove"] < 0.15 * p["interventions"]
        assert 0 < p["free_to_remove_clients"] <= p["eligible_clients"]


def test_volumes(world):
    """Within the PRD where the 12-month history allows it; see README for the rest."""
    _, _, res, _, rules = world
    c = res["meta"]["counts"]
    assert c["clients"] == 312
    assert 8 <= c["rules"] <= 12
    assert 2 <= len(res["incidents"]) <= 4
    assert res["portfolio"]["30d"]["incidents"]["count"] == 2
    assert 1_000 <= res["portfolio"]["30d"]["interventions"] <= 4_000
    assert res["portfolio"]["30d"]["clients_interrupted"] / 312 >= 0.8


def test_generator_is_reproducible_from_its_seed():
    a = generate.build_world(123)
    b = generate.build_world(123)
    assert [(e.event_id, e.t, e.features) for e in a[1]] == [(e.event_id, e.t, e.features) for e in b[1]]
    assert a[2] == b[2]


def test_threshold_is_a_string_edit():
    assert expression.with_threshold("amount > 100", 500) == "amount > 500"
    assert expression.with_threshold("refund_ratio_30d > 0.15", 0.18) == "refund_ratio_30d > 0.18"
    assert not expression.parse("mcc IN [5967, 7995]").sweepable
    with pytest.raises(ValueError):
        expression.with_threshold("mcc IN [5967]", 1)


# ---------------------------------------------------------------- friction ledger

def test_score_breakdown_reproduces_every_clients_points(world):
    """weight × hold-time factor × recency = points, and points add up to the score."""
    _, _, res, clients, _ = world
    start = res["meta"]["windows"]["30d"]["start"]
    for cid in ("ACME-0417", "NORT-7716", "JUNI-5521", "OAKM-6630"):
        hits = [h for h in res["timelines"][cid] if h["a"] == "P" and h["t"] >= start]
        for h in hits:
            assert abs(h["w"] * h["u"] * h["y"] - h["s"]) < 0.15, (cid, h)
        assert abs(sum(h["s"] for h in hits) - clients[cid]["windows"]["30d"]["score"][0]) < 0.5


def test_ledger_counts_match_the_interventions(world):
    _, _, res, _, rules = world
    p = res["portfolio"]["30d"]
    assert p["ledger"]["n"] == res["trend"]["buckets"][-1]["n"]      # same 30 days, no-fraud interventions
    assert p["ledger"]["n"] <= p["interventions"]
    assert p["ledger"]["reviews"] * 0.5 == p["ledger"]["review_hours"]
    hero = rules["payout_limit_100"]["windows"]["30d"]["curve"]
    first, flat = hero["points"][0], hero["points"][hero["flat_index"]]
    assert first["ledger"]["n"] == first["rule_interventions"]
    assert first["ledger"]["held_usd"] > 0 and first["ledger"]["denied_usd"] > 0
    assert flat["ledger"]["held_usd"] + flat["ledger"]["denied_usd"] < first["ledger"]["held_usd"] + first["ledger"]["denied_usd"]
    assert flat["freed"]["usd"] > 0 and flat["fraud_usd_rule"] == first["fraud_usd_rule"]



@pytest.mark.parametrize("wkey", ["30d", "60d", "1y"])
def test_fraud_saved_and_lost_add_up_to_all_fraud(world, wkey):
    _, _, res, _, rules = world
    p = res["portfolio"][wkey]
    for f in [p["fraud"]] + ([p["prev"]["fraud"]] if p["prev"] else []):
        assert 0 < f["caught"] <= f["total"]
        assert f["caught_usd"] + f["lost_usd"] == f["total_usd"]
    assert p["fraud"]["caught"] == res["metrics"][wkey]["fraud"]["caught"]
    # the ratio's numerator on Home and on the rule page is the same count
    for r in rules.values():
        w = r["windows"][wkey]
        assert w["curve"]["points"][0]["rule_interventions_all"] == w["interventions"]


def test_client_transactions_count_every_money_movement_once(world):
    ds, _, res, clients, _ = world
    w = ds.event_t >= ds.as_of - 30 * 24
    money = w & ~np.isnan(ds.features["amount"])
    assert sum(c["windows"]["30d"]["txn"][0] for c in res["clients"]) == int(money.sum())
    acme = clients["ACME-0417"]["windows"]["30d"]
    assert acme["txn"][0] >= acme["n"] and acme["txn"][1] > 0


def test_clients_have_a_type_and_region(world):
    from contract import schema
    _, _, res, clients, _ = world
    assert all(c["type"] in schema.CLIENT_TYPES and c["region"] in schema.REGIONS for c in res["clients"])
    assert {c["type"] for c in res["clients"]} == set(schema.CLIENT_TYPES)
    assert {c["region"] for c in res["clients"]} == set(schema.REGIONS)
    # scenario clients keep their segment as their type; payfac platforms are ISVs
    assert clients["ACME-0417"]["type"] == "SMB" and clients["NORT-7716"]["type"] == "ISV"


def test_rules_have_readable_names_and_card_channels(world):
    *_, rules = world
    assert all("_" not in r["name"] and r["name"] for r in rules.values())
    assert rules["payout_limit_100"]["name"] == "Payout limit $100"
    capture = {rid for rid, r in rules.items() if r["checkpoint"] == "PRE_CAPTURE"}
    assert capture and all(rules[rid]["channel"] in ("CARD_PRESENT", "CARD_NOT_PRESENT", "") for rid in capture)
    assert rules["geo_mismatch"]["channel"] == "CARD_NOT_PRESENT" and rules["new_device_limit"]["channel"] == ""
    assert all(r["channel"] == "" for rid, r in rules.items() if rid not in capture)

def test_trend_shows_the_hero_rule_launch(world):
    _, _, res, _, _ = world
    b = res["trend"]["buckets"]
    assert len(b) == 12
    prior = sum(x["n"] for x in b[:-1]) / 11
    assert b[-1]["n"] > 2 * prior
    assert max(b[-1]["by_rule"], key=b[-1]["by_rule"].get) == "payout_limit_100"
    assert {"rule_id": "payout_limit_100", "date": "2026-08-28"} in res["trend"]["launches"]


# ---------------------------------------------------------------- payment API fields

def test_clients_carry_api_references(world):
    ds, _, res, clients, _ = world
    ecids = [c["ecid"] for c in res["clients"]]
    assert all(e and e.isdigit() and len(e) == 9 for e in ecids) and len(set(ecids)) == len(ecids)
    assert all(c["mcc"] in schema.MCC and c["industry"] == schema.MCC[c["mcc"]][1] for c in res["clients"])
    region_of = {"CAN": "CA", "USA": "US", "GBR": "EMEA", "DEU": "EMEA", "FRA": "EMEA", "IRL": "EMEA",
                 "AUS": "APAC", "SGP": "APAC", "JPN": "APAC"}
    assert all(region_of[c["country"]] == c["region"] for c in res["clients"])
    assert all(c["mcc"] == 7372 for c in res["clients"] if c["entity"] == "PAYFAC")


def test_card_channels_agree_with_the_rules(world):
    ds, *_ = world
    cap = ds.event_request == "CAPTURE"
    assert set(ds.event_channel[cap]) == set(schema.CHANNELS) and (ds.event_channel[~cap] == "").all()
    assert not (ds.event_recurring & (ds.event_channel != "CARD_NOT_PRESENT")).any()
    cnp = {r.idx for r in ds.rules if r.channel == "CARD_NOT_PRESENT"}
    on_cnp = np.isin(ds.hit_rule, list(cnp))
    assert set(ds.event_channel[ds.hit_event[on_cnp]]) <= schema.RULE_CHANNEL_MATCHES["CARD_NOT_PRESENT"]
    # enforcing channels changes nothing at today's settings: every logged hit still fires
    for r in ds.rules:
        if r.channel:
            fires = ds.evaluate(r)
            assert fires[ds.hit_event[ds.hit_rule == r.idx]].all(), r.rule_id
    assert all(ds.event_tx[e] for e in np.flatnonzero(ds.event_request != "SUBMERCHANT_BOARDING")[:500])


def test_retried_requests_count_once(world, tmp_path):
    import csv
    import shutil
    ds, *_ = world
    src = ds.data_dir
    for f in os.listdir(src):
        shutil.copy(os.path.join(src, f), tmp_path / f)
    with open(tmp_path / "decision_events.csv") as f:
        rows = list(csv.DictReader(f))
    dup = dict(rows[100], event_id="EV-RETRY1")           # same idempotency key, a new event ID
    with open(tmp_path / "decision_events.csv", "a", newline="") as f:
        csv.DictWriter(f, fieldnames=list(rows[0])).writerow(dup)
    with open(tmp_path / "rule_hits.csv") as f:
        hits = list(csv.DictReader(f))
    with open(tmp_path / "rule_hits.csv", "a", newline="") as f:
        csv.DictWriter(f, fieldnames=list(hits[0])).writerow(dict(hits[0], hit_id="HT-RETRY1", event_id="EV-RETRY1"))
    again = Dataset(str(tmp_path))
    assert again.n_events == ds.n_events and again.n_hits == ds.n_hits
    assert again.dropped_events == {"EV-RETRY1"}


def test_home_cut_adds_up_to_the_portfolio(world):
    _, _, res, _, _ = world
    for wkey in ("30d", "1y"):
        P, C = res["portfolio"][wkey], [c["windows"][wkey] for c in res["clients"]]
        assert sum(c["n"] for c in C) == P["interventions"]
        assert sum(c["nf"] for c in C) == P["interventions"] - P["ledger"]["n"]
        assert sum(c["safe"] for c in C) == P["free_to_remove"]
        assert sum(c["fr"][0] for c in C) == P["fraud"]["caught"] and sum(c["fr"][1] for c in C) == P["fraud"]["total"]
        assert abs(sum(c["fr"][2] for c in C) - P["fraud"]["caught_usd"]) <= len(C)       # per-client rounding
        assert abs(sum(c["fr"][4] for c in C) - P["fraud"]["recovered_usd"]) <= len(C)
        assert 0 < P["fraud"]["recovered_usd"] < P["fraud"]["lost_usd"]


def test_account_actions(world):
    ds, _, res, _, _ = world
    as_of = res["meta"]["as_of"]
    acts = [a for c in res["clients"] for a in c["actions"]]
    assert {a["type"] for a in acts} >= {"ACCOUNT_REVIEW", "CAPABILITY_RESTRICTION", "RESERVE", "RECOVERY"}
    assert any(a["type"] == "RESERVE" and not a["end"] for a in acts)
    good_open = {c["client_id"] for c in res["clients"] if c["band"] == "established"
                 for a in c["actions"] if a["type"] != "RECOVERY" and (not a["end"] or a["end"] > as_of)}
    assert good_open
    # recoveries chase only fraud no rule stopped
    caught = set(ds.hit_event[ds.hit_fraud & (ds.hit_action == "PREVAILED")].tolist())
    for a in ds.account_actions:
        if a["action_type"] == "RECOVERY":
            assert ds.event_index[a["event_id"]] not in caught


def test_rule_curves_by_client_type_add_up(world):
    *_, rules = world
    for r in rules.values():
        for p in r["windows"]["30d"]["curve"]["points"]:
            g = p["by_group"]
            assert sum(x[0] for x in g) == p["interventions_removed"]
            assert sum(x[1] for x in g) == p["fraud_caught_rule"]
    hero = rules["payout_limit_100"]["windows"]["30d"]["curve"]
    smb = schema.CLIENT_TYPES.index("SMB")
    assert rules["payout_limit_100"]["grid"][hero["group_flat"][smb]] == 1800
