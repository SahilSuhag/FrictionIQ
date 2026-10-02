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

    m = result["metrics"]
    print(f"fraud caught at live thresholds: {m['fraud']['caught_baseline']} of {m['fraud']['total']}")
    for r in m["free_friction_by_rule"]:
        print(f"  {r['rule_id']} {r['name']:<30} {r['verdict']:<18} flat to {r['expression']:<34} "
              f"removes {r['interventions_removed']:>5} interventions")
    ra = m["relax_all"]
    print(f"all free-friction rules relaxed together: {ra['interventions_removed']} interventions removed "
          f"from {ra['clients_affected']} clients; fraud caught {m['fraud']['caught_after_relax_all']} "
          f"of {m['fraud']['total']}")
    print(f"rules with no flat stretch: {', '.join(m['no_flat_stretch']) or 'none'}")


if __name__ == "__main__":
    main()
