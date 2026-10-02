import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_CONFIG = os.path.join(ROOT, "config", "frictioniq.json")


def load(path: str = DEFAULT_CONFIG) -> dict:
    with open(path) as f:
        return json.load(f)
