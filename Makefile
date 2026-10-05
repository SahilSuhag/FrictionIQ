SEED ?= 4127
PY ?= python3

.PHONY: all data results test serve clean

all: data results

# Teammate-owned: the seeded synthetic world (clients, events, rule hits, fraud labels).
data:
	$(PY) -m generator --seed $(SEED) --out data

# Analysis: friction index, good-client bands, every threshold for every rule, precomputed.
results:
	$(PY) -m frictioniq --data data --out out --js web/data/frictioniq.js

test:
	$(PY) -m pytest -q

serve:
	$(PY) -m http.server 8000 -d web

clean:
	rm -rf data/*.csv data/manifest.json out
