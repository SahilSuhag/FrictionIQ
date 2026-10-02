"""Rule-expression grammar shared by the generator and the analysis.

Two shapes only, matching how production rules are authored:

    <feature> <op> <number>          op in  >  >=  <  <=
    <feature> IN [<n>, <n>, ...]

The threshold is a literal inside the string, so a sweep is a string edit over a
numeric comparison rather than a code change (``with_threshold``). A list-membership
rule has two states — on or off — not a curve.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_COMPARISON = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s*(>=|<=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$")
_MEMBERSHIP = re.compile(r"^\s*([a-z_][a-z0-9_]*)\s+IN\s+\[([^\]]*)\]\s*$")


@dataclass(frozen=True)
class Expression:
    feature: str
    op: str                      # ">", ">=", "<", "<=", "IN"
    threshold: float | None = None
    members: tuple[float, ...] = ()

    @property
    def sweepable(self) -> bool:
        return self.op != "IN"

    @property
    def relax_direction(self) -> int:
        """+1 if relaxing means raising the threshold, -1 if lowering it."""
        if self.op in (">", ">="):
            return 1
        if self.op in ("<", "<="):
            return -1
        return 0

    def matches(self, value: float | None) -> bool:
        if value is None:
            return False
        if self.op == ">":
            return value > self.threshold
        if self.op == ">=":
            return value >= self.threshold
        if self.op == "<":
            return value < self.threshold
        if self.op == "<=":
            return value <= self.threshold
        return value in self.members


def parse(text: str) -> Expression:
    m = _COMPARISON.match(text)
    if m:
        return Expression(feature=m.group(1), op=m.group(2), threshold=float(m.group(3)))
    m = _MEMBERSHIP.match(text)
    if m:
        members = tuple(float(x) for x in m.group(2).split(",") if x.strip())
        return Expression(feature=m.group(1), op="IN", members=members)
    raise ValueError(f"unsupported rule expression: {text!r}")


def format_number(x: float) -> str:
    return str(int(x)) if float(x).is_integer() else f"{x:g}"


def with_threshold(text: str, threshold: float) -> str:
    """Return the expression with its numeric literal replaced — the sweep primitive."""
    expr = parse(text)
    if not expr.sweepable:
        raise ValueError(f"list-membership rule has no threshold: {text!r}")
    return f"{expr.feature} {expr.op} {format_number(threshold)}"
