"""The seven PRD client scenarios, plus the invariants the curve's honesty rests on.

If these behave correctly the logic is right. Scenario pairs are the useful part:
5a/5b differ only in hold duration, 1/7 differ only in whether the rule has a flat
stretch.
"""

import numpy as np
import pytest

from contract import expression
from frictioniq import config, index, report
from frictioniq.data import Dataset
from generator import generate


@pytest.fixture(scope="session")
def world(tmp_path_factory):
    out = tmp_path_factory.mktemp("data")
    generate.main(["--seed", str(generate.DEFAULT_SEED), "--out", str(out)])
    ds = Dataset(str(out))
    cfg = config.load()
    res = report.build(ds, cfg)
    clients = {c["client_id"]: c for c in res["clients"]}
    rules = {r["rule_id"]: r for r in res["rules"]}
    return ds, cfg, res, clients, rules


def prevailing_30d(res, cid):
    return [h for h in res["timelines"][cid] if h["action"] == "PREVAILED" and h["t"] >= "2026-09-01"]


# ---------------------------------------------------------------- scenarios

def test_1_hero_one_rule_causes_most_friction_and_relaxing_it_is_free(world):
    ds, cfg, res, clients, rules = world
    acme = clients["CL-0001"]
    assert acme["name"] == "Acme Supplies"
    assert acme["band"] == "established"
    hits = prevailing_30d(res, "CL-0001")
    assert len(hits) == 9
    assert sum(h["rule_id"] == "R01" for h in hits) == 7
    assert acme["top_rule"] == "R01"
    assert all(h["final"] == "CLEARED" for h in res["timelines"]["CL-0001"])

    r01 = rules["R01"]["curve"]
    assert r01["verdict"] == "free_friction"
    # Raising the cap to $500 keeps every fraud case the rule caught.
    i500 = max(i for i, t in enumerate(r01["grid"]) if t <= 500)
    assert r01["points"][i500]["fraud_caught_rule"] == r01["base_fraud_caught_rule"]
    # ...and at the end of the flat stretch all of Acme's R01 denials are gone.
    assert acme["relax_removed_at_flat"]["R01"] == 21


def test_2_incident_band_is_separate_and_relaxing_rules_would_not_help(world):
    _, _, _, clients, _ = world
    harbor = clients["CL-0002"]
    share = harbor["incident30"] / (harbor["incident30"] + harbor["f30"]["ref"])
    assert 0.8 <= share <= 0.9
    assert harbor["n30"] == 2
    assert harbor["relax_removed_at_flat"] == {}


def test_3_earned_friction_is_not_relaxed(world):
    _, _, res, clients, _ = world
    nimbus = clients["CL-0003"]
    assert nimbus["band"] == "limited" and nimbus["disqualified"]
    assert nimbus["evidence"]["confirmed_fraud"] == 2
    hits = prevailing_30d(res, "CL-0003")
    assert len(hits) == 11
    assert len({h["rule_id"] for h in hits}) == 4
    assert len({h["checkpoint"] for h in hits}) == 3
    assert not nimbus["eligible_for_segment_policy"]


def test_4_attribution_by_order_without_double_counting(world):
    ds, _, res, clients, _ = world
    tl = res["timelines"]["CL-0004"]
    by_event = {}
    for h in tl:
        by_event.setdefault(h["event_id"], []).append(h)
    (event,) = [hs for hs in by_event.values() if len(hs) == 3]
    actions = {h["rule_id"]: h["action"] for h in event}
    assert actions == {"R08": "PREVAILED", "R03": "CONTRIBUTING", "R04": "CONTRIBUTING"}
    assert clients["CL-0004"]["n30"] == 1
    assert clients["CL-0004"]["contributing"] == 2
    assert abs(clients["CL-0004"]["f30"]["ref"] - sum(h["friction"] for h in event)) < 0.01


def test_5_one_long_hold_outweighs_six_short_ones_under_every_weighting(world):
    ds, cfg, _, _, _ = world
    w = index.sample_weightings(cfg)
    base = index.baseline(ds, w)
    f30 = base.windows[30]["rule"]
    a, b = ds.client_index["CL-0005"], ds.client_index["CL-0006"]
    assert base.windows[30]["count"][a] == 1 and base.windows[30]["count"][b] == 6
    assert (f30[a] > f30[b]).all()


def test_6_shadow_hits_log_but_cost_nothing(world):
    _, _, res, clients, _ = world
    lantern = clients["CL-0007"]
    assert lantern["band"] == "developing"
    assert lantern["shadow"] == 40
    assert lantern["n30"] == 1
    live = [h for h in res["timelines"]["CL-0007"] if h["action"] == "PREVAILED"]
    assert len(live) == 1 and abs(lantern["f30"]["ref"] - live[0]["friction"]) < 0.01


def test_7_negative_finding_rule_earning_its_friction(world):
    _, _, res, clients, rules = world
    halcyon = clients["CL-0008"]
    assert halcyon["band"] == "established"
    hits = prevailing_30d(res, "CL-0008")
    assert len(hits) == 6 and {h["rule_id"] for h in hits} == {"R02"}
    r02 = rules["R02"]["curve"]
    assert r02["verdict"] == "earning"
    assert r02["flat_index"] == 0
    assert r02["points"][1]["fraud_caught_rule"] < r02["base_fraud_caught_rule"]


# ---------------------------------------------------------------- invariants

def test_re_evaluating_rules_reproduces_the_logged_hits(world):
    ds, *_ = world
    for rule in ds.rules:
        fired = np.flatnonzero(ds.evaluate(rule))
        logged = np.unique(ds.hit_event[ds.hit_rule == rule.idx])
        assert np.array_equal(np.sort(fired), logged), rule.rule_id


def test_attribution_matches_the_log(world):
    ds, cfg, *_ = world
    prev = index.prevailing(ds, ds.hit_live)
    assert np.array_equal(prev, ds.hit_action == "PREVAILED")


def test_weightings_respect_the_intervention_ordering(world):
    _, cfg, *_ = world
    w = index.sample_weightings(cfg)
    assert w.n == cfg["weighting_sweep"]["n_samples"] + 1
    assert (np.diff(w.weights[:, 1:], axis=1) > 0).all()
    assert (w.weights[:, 0] == 0).all()


def test_curves_are_monotone_and_fraud_is_measured_on_the_whole_population(world):
    ds, _, res, _, rules = world
    for r in rules.values():
        pts = r["curve"]["points"]
        caught = [p["fraud_caught_rule"] for p in pts]
        removed = [p["interventions_removed"] for p in pts]
        assert caught == sorted(caught, reverse=True), r["rule_id"]
        assert removed == sorted(removed), r["rule_id"]
    assert res["metrics"]["fraud"]["total"] == int(ds.event_fraud.sum())
    assert res["metrics"]["fraud"]["caught_after_relax_all"] == res["metrics"]["fraud"]["caught_baseline"]


def test_volumes_match_the_prd(world):
    _, _, res, _, rules = world
    c = res["meta"]["counts"]
    assert 200 <= c["clients"] <= 400
    assert 8 <= c["rules"] <= 12
    assert 20_000 <= c["decision_events"] <= 50_000
    assert 4_000 <= c["friction_events"] <= 8_000
    assert 150 <= c["fraud_cases"] <= 400
    assert 2 <= len(res["incidents"]) <= 4
    verdicts = {r["curve"]["verdict"] for r in rules.values()}
    assert {"free_friction", "earning"} <= verdicts


def test_generator_is_reproducible_from_its_seed():
    a = generate.build_world(123)
    b = generate.build_world(123)
    assert [(e.event_id, e.t, e.features) for e in a[1]] == [(e.event_id, e.t, e.features) for e in b[1]]
    assert a[2] == b[2]


def test_threshold_is_a_string_edit():
    assert expression.with_threshold("amount > 100", 500) == "amount > 500"
    assert expression.with_threshold("refund_ratio_30d > 0.15", 0.2) == "refund_ratio_30d > 0.2"
    assert not expression.parse("mcc IN [5967, 7995]").sweepable
    with pytest.raises(ValueError):
        expression.with_threshold("mcc IN [5967]", 1)
