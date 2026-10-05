"""Run the analysis over the generated world and ship results for the frontend.

    python -m frictioniq --data data --out out --js web/data/frictioniq.js
"""

import argparse
import json
import os

from . import config, report
from .data import Dataset


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", default="data")
    ap.add_argument("--config", default=config.DEFAULT_CONFIG)
    ap.add_argument("--demo", default=os.path.join(config.ROOT, "config", "demo.json"))
    ap.add_argument("--out", default="out")
    ap.add_argument("--js", default=os.path.join("web", "data", "frictioniq.js"))
    args = ap.parse_args(argv)

    cfg = config.load(args.config)
    demo = json.load(open(args.demo)) if os.path.exists(args.demo) else {}
    result = report.build(Dataset(args.data), cfg, demo)
    report.write(result, args.out, args.js)

    m = result["metrics"]["30d"]
    p = result["portfolio"]["30d"]
    print(f"last 30 days: {p['interventions']} interventions on {p['clients_interrupted']} of {p['clients']} clients; "
          f"{p['good_clients_heavy_friction']} established clients graded E or F")
    print(f"fraud caught at live thresholds: {m['fraud']['caught']} of {m['fraud']['total']}")
    for r in m["free_by_rule"]:
        print(f"  {r['rule_id']:<24} {r['label']:<22} {r['expression']:<34} removes {r['interventions_removed']:>4}")
    ra = m["relax_all"]
    print(f"every rule relaxed as far as is safe, at once: {ra['interventions_removed']} interventions removed from "
          f"{ra['clients_affected']} clients; fraud caught {m['fraud']['caught_after_relax_all']} of {m['fraud']['total']}")
    print(f"keep as is (relaxing misses fraud): {', '.join(m['no_free_stretch']) or 'none'}")


if __name__ == "__main__":
    main()
