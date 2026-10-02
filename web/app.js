/* FrictionIQ frontend — the thinnest layer over precomputed results.
 * Reads window.FRICTIONIQ (web/data/frictioniq.js). Nothing is recomputed here:
 * the slider indexes into precomputed threshold settings.
 */
(function () {
  "use strict";

  const D = window.FRICTIONIQ;
  if (!D) {
    document.querySelector("main").innerHTML =
      "<div class='card'>No results found. Run <code>make all</code> to generate data/frictioniq.js.</div>";
    return;
  }

  const rules = D.rules;
  const ruleById = Object.fromEntries(rules.map((r) => [r.rule_id, r]));
  const clients = D.clients;
  const clientById = Object.fromEntries(clients.map((c) => [c.client_id, c]));
  const NW = D.meta.n_weightings;
  const SVGNS = "http://www.w3.org/2000/svg";

  const state = {
    view: "client",
    ruleId: D.demo.hero_rule || rules[0].rule_id,
    idx: 0,
    policy: "global",
    clientId: D.demo.open_client || clients[0].client_id,
  };

  // ------------------------------------------------------------ formatting
  const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
  const fmtPct = (v, d = 0) => `${v.toFixed(d)}%`;
  function fmtVal(v, unit) {
    if (v === "on") return "on (live list)";
    if (v === "off") return "off";
    switch (unit) {
      case "usd": return "$" + fmtInt(v);
      case "pct": return `${+(v * 100).toFixed(2)}%`;
      case "hours": return `${+v.toFixed(1)}h`;
      case "sigma": return `${+v.toFixed(2)}σ`;
      case "count": return String(Math.round(v));
      default: return String(+(+v).toFixed(3));
    }
  }
  const fmtDate = (iso) => iso.slice(0, 10);
  const fmtDateShort = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const VERDICT_LABEL = {
    free_friction: "Free friction",
    marginal: "Marginal",
    earning: "Earning its friction",
    shadow: "Shadow (control group)",
    no_legit_friction: "No client friction",
    two_state: "Two-state rule",
  };
  const verdictOf = (r) => (!r.sweepable && r.curve.verdict === "earning" ? "two_state" : r.curve.verdict);
  const BAND_LABEL = { established: "Established", developing: "Developing", limited: "Limited history" };

  // ------------------------------------------------------------ svg helpers
  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function text(parent, x, y, s, attrs = {}) {
    const t = el("text", { x, y, ...attrs }, parent);
    t.textContent = s;
    return t;
  }
  function niceTicks(lo, hi, n = 5) {
    const span = hi - lo;
    if (span <= 0) return [lo];
    const step0 = span / n;
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const out = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function logTicks(lo, hi) {
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      for (const m of [1, 2, 5]) {
        const v = m * Math.pow(10, e);
        if (v >= lo && v <= hi) out.push(v);
      }
    }
    return out;
  }

  const tip = document.getElementById("tooltip");
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    const r = tip.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  const hideTip = () => (tip.hidden = true);

  // ------------------------------------------------------------ routing
  function go(view, arg, push = true) {
    state.view = view;
    if (view === "explorer" && arg && ruleById[arg]) {
      if (arg !== state.ruleId) state.idx = 0;
      state.ruleId = arg;
    }
    if (view === "client" && arg && clientById[arg]) state.clientId = arg;
    const hash = view === "explorer" ? `#explorer/${state.ruleId}` : view === "client" ? `#client/${state.clientId}` : "#portfolio";
    if (push && location.hash !== hash) { try { history.pushState(null, "", hash); } catch (e) { /* sandboxed frame */ } }
    render();
    window.scrollTo({ top: 0 });
  }
  function fromHash() {
    const [view, arg] = location.hash.replace(/^#/, "").split("/");
    if (["explorer", "client", "portfolio"].includes(view)) go(view, arg, false);
    else go(state.view, state.view === "client" ? state.clientId : state.ruleId, false);
  }

  function render() {
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
    for (const v of ["explorer", "client", "portfolio"]) document.getElementById("view-" + v).hidden = v !== state.view;
    hideTip();
    if (state.view === "explorer") renderExplorer();
    if (state.view === "client") renderClient();
    if (state.view === "portfolio") renderPortfolio();
  }

  // ======================================================================
  // 1. Rule tradeoff explorer
  // ======================================================================
  function renderRuleList() {
    const box = document.getElementById("rule-list");
    box.innerHTML = "";
    for (const r of rules) {
      const v = verdictOf(r);
      const b = document.createElement("button");
      b.className = "rule-item";
      b.setAttribute("aria-current", String(r.rule_id === state.ruleId));
      b.innerHTML = `<span class="name">${esc(r.name)}</span>
        <span class="sub"><span>${r.rule_id} · ${r.decision} · ${r.checkpoint}</span>
        <span class="badge ${v}">${VERDICT_LABEL[v]}</span></span>`;
      b.onclick = () => go("explorer", r.rule_id);
      box.appendChild(b);
    }
  }

  function points(r) {
    return state.policy === "segment" ? r.curve.segment_points : r.curve.points;
  }

  function renderExplorer() {
    renderRuleList();
    const r = ruleById[state.ruleId];
    const c = r.curve;
    const v = verdictOf(r);
    const slider = document.getElementById("threshold");
    slider.max = c.grid.length - 1;
    state.idx = Math.min(state.idx, c.grid.length - 1);
    slider.value = state.idx;
    slider.setAttribute("aria-valuetext", c.expressions[state.idx]);

    document.getElementById("rule-title").textContent = r.name;
    document.getElementById("rule-meta").innerHTML =
      `<span>${r.rule_id}</span><span>${r.decision} at ${r.checkpoint}</span><span>order ${r.order} in ${r.ruleset_id}</span>` +
      `<span>${r.request_type === "*" ? "all requests" : r.request_type}</span><span>entity ${r.entity}</span>` +
      `<span>live: <code>${esc(r.expression)}</code></span>${r.shadow ? "<span><b>shadow_setting = ON</b></span>" : ""}`;

    document.querySelectorAll(".policy-toggle button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.policy === state.policy)));

    const flatT = fmtVal(c.grid[c.flat_index], r.unit);
    const fp = c.points[c.flat_index];
    const vtext = {
      free_friction: `<strong>Flat stretch: ${fmtVal(c.grid[0], r.unit)} → ${flatT}.</strong> Loosening to here removes ${fmtPct(fp.pct_of_rule.ref)} of this rule's friction (${fmtPct(fp.pct_of_rule.p5)}–${fmtPct(fp.pct_of_rule.p95)} across ${NW} weightings) and the rule still catches all ${c.base_fraud_caught_rule} fraud cases it caught. Past that point the trade is real — and where to stop is a human decision.`,
      marginal: `<strong>Short flat stretch: ${fmtVal(c.grid[0], r.unit)} → ${flatT}.</strong> Only ${fmtPct(fp.pct_of_rule.ref)} of this rule's friction is free; most of what it does is buying protection.`,
      earning: `<strong>No flat stretch.</strong> The first step of relaxation already loses fraud this rule catches. This rule is earning its friction — an honest negative finding.`,
      two_state: `<strong>List-membership rule — two states, not a curve.</strong> Switching it off loses ${c.base_fraud_caught_rule - c.points[1].fraud_caught_rule} of ${c.base_fraud_caught_rule} fraud cases it catches.`,
      shadow: `<strong>Shadow rule.</strong> It fires and logs what it would have done; no client paid for any of its ${r.fired.shadow} hits. This is the control group — and the production path.`,
      no_legit_friction: `<strong>No client friction to remove.</strong> In this population the rule fires only on fraud; relaxing it can only cost capture.`,
    }[v];
    document.getElementById("verdict").innerHTML = `<span class="badge ${v}">${VERDICT_LABEL[v]}</span> ${vtext}`;

    drawCurve(r);
    updateReadout(r);
    renderFireStats(r);
    renderCurveTable(r);
  }

  function updateReadout(r) {
    const c = r.curve;
    const pts = points(r);
    const p = pts[state.idx];
    const base = c.base_fraud_caught_rule;
    const T = c.grid[state.idx];
    document.getElementById("expr-live").textContent = c.expressions[state.idx];
    document.getElementById("fig-friction").textContent = fmtPct(p.pct_of_rule.ref);
    document.getElementById("fig-friction-sub").innerHTML =
      `of this rule's friction · ${fmtPct(p.pct_of_rule.p5)}–${fmtPct(p.pct_of_rule.p95)} across ${NW} weightings<br>` +
      `<b>${fmtInt(p.interventions_removed)}</b> interventions removed from <b>${fmtInt(p.clients_affected)}</b> clients`;
    document.getElementById("fig-fraud").textContent = base ? `${p.fraud_caught_rule} of ${base}` : "—";
    const totalFraud = D.metrics.fraud.total;
    document.getElementById("fig-fraud-sub").innerHTML =
      (base ? `${fmtPct((100 * p.fraud_caught_rule) / base)} of what it catches at the live setting<br>` : "") +
      `whole ruleset still stops ${p.fraud_caught_ruleset} of ${totalFraud} fraud cases`;
    const b0 = c.points[0];
    document.getElementById("fig-dist").innerHTML =
      `Clients above the high-friction line: <b>${p.clients_above_p75}</b> (live: ${b0.clients_above_p75}).<br>` +
      `Clients whose friction <i>rises</i>: <b>${p.clients_friction_increased}</b>` +
      (p.clients_friction_increased ? ` (max +${p.max_client_increase.toFixed(0)}) — another rule takes over` : "");

    const name = `<b>${esc(r.name)}</b>`;
    let s;
    if (state.idx === 0) {
      s = r.shadow
        ? `${name} is in shadow: ${r.fired.shadow} hits logged across ${D.meta.counts.clients} clients' traffic, zero friction inflicted. Drag the slider to explore — nothing changes for clients either way.`
        : `Live setting <code>${esc(r.expression)}</code>. In 90 days ${name} inflicted ${fmtInt(r.fired.prevailed)} interventions on ${fmtInt(r.fired.clients)} clients; ${fmtInt(r.fired.prevailed_cleared)} of them were cleared on review. Drag the slider to relax it.`;
    } else {
      const from = fmtVal(c.grid[0], r.unit), to = fmtVal(T, r.unit);
      const verb = r.sweepable ? `Relaxing ${name} from ${from} to ${to}` : `Switching ${name} off`;
      const who = state.policy === "segment" ? " for established clients already above the high-friction line" : "";
      const est = p.established_clients_affected ? ` (${p.established_clients_affected} of them established)` : "";
      const friction = `removes <b>${fmtInt(p.interventions_removed)}</b> interventions from <b>${fmtInt(p.clients_affected)}</b> clients${est} — ${fmtPct(p.pct_of_rule.ref)} of the rule's friction, ${fmtPct(p.pct_of_rule.p5)}–${fmtPct(p.pct_of_rule.p95)} across ${NW} weightings —`;
      if (p.fraud_caught_rule >= base) {
        s = `${verb}${who} ${friction} <b>with no change in fraud caught</b> (${p.fraud_caught_rule} of ${base}).`;
      } else {
        const lost = base - p.fraud_caught_rule;
        s = `${verb}${who} ${friction} and <b>costs ${lost} of the ${base} fraud cases</b> this rule caught; the whole ruleset still stops ${p.fraud_caught_ruleset} of ${totalFraud}.`;
      }
    }
    document.getElementById("statement").innerHTML = s;

    // production path follows the slider (or the flat-stretch end at the live setting)
    const pick = state.idx > 0 ? state.idx : c.flat_index;
    const sp = document.getElementById("shadow-path");
    if (r.shadow) {
      sp.innerHTML = `<p>This rule is already a shadow rule. Its ${r.fired.shadow} hits show exactly what the population would have paid if it went live — a free counterfactual.</p>`;
    } else if (pick === 0) {
      sp.innerHTML = `<p>No relaxation to shadow-test: there is no setting where capture holds.</p>`;
    } else {
      sp.innerHTML = `<p>Clone <b>${r.rule_id}</b> and bind the clone to <code>${r.ruleset_id}</code> with
        <code>${esc(c.expressions[pick])}</code> and <code>shadow_setting = ON</code>. Over one reporting window the live rule's hits are what
        clients paid; the clone's are what they would have paid. Same traffic, no client affected — the counterfactual becomes an observation.</p>
        <p class="muted">To confirm first: shadow hits land in the same store as live hits, and a shadow clone can bind without changing live order.</p>`;
    }
    markCurve(r);
  }

  function renderFireStats(r) {
    const f = r.fired;
    const live = f.total - f.shadow;
    const pct = live ? (100 * f.prevailed) / live : 0;
    document.getElementById("fire-stats").innerHTML = `<dl class="kv">
      <dt>Hits logged (90 days)</dt><dd>${fmtInt(f.total)}</dd>
      <dt>Became friction (prevailed)</dt><dd>${fmtInt(f.prevailed)}${live ? ` · ${fmtPct(pct)} of live hits` : ""}</dd>
      <dt>Contributing, not scored</dt><dd>${fmtInt(f.contributing)}</dd>
      <dt>Overridden downstream</dt><dd>${fmtInt(f.overridden)}</dd>
      <dt>Shadow, cost nothing</dt><dd>${fmtInt(f.shadow)}</dd>
      <dt>Prevailed on confirmed fraud</dt><dd>${fmtInt(f.prevailed_on_fraud)}</dd>
      <dt>Cleared on review</dt><dd>${fmtInt(f.prevailed_cleared)}</dd>
      <dt>Clients affected</dt><dd>${fmtInt(f.clients)}</dd></dl>`;
  }

  function renderCurveTable(r) {
    const c = r.curve;
    const pts = points(r);
    let h = `<div class="table-scroll"><table><thead><tr><th>Threshold</th><th>Expression</th><th class="num">Interventions removed</th>
      <th class="num">Clients</th><th class="num">Friction removed (ref)</th><th class="num">Range, ${NW} weightings</th>
      <th class="num">Fraud caught by rule</th><th class="num">Stopped by ruleset</th></tr></thead><tbody>`;
    pts.forEach((p, i) => {
      h += `<tr${i === c.flat_index ? ' style="font-weight:600"' : ""}><td>${fmtVal(c.grid[i], r.unit)}</td><td><code>${esc(c.expressions[i])}</code></td>
        <td class="num">${fmtInt(p.interventions_removed)}</td><td class="num">${p.clients_affected}</td>
        <td class="num">${fmtPct(p.pct_of_rule.ref, 1)}</td><td class="num">${fmtPct(p.pct_of_rule.p5, 1)}–${fmtPct(p.pct_of_rule.p95, 1)}</td>
        <td class="num">${p.fraud_caught_rule} / ${c.base_fraud_caught_rule}</td><td class="num">${p.fraud_caught_ruleset}</td></tr>`;
    });
    document.getElementById("curve-table").innerHTML = h + "</tbody></table></div>";
  }

  let curveGeom = null;
  function drawCurve(r) {
    const box = document.getElementById("curve-chart");
    box.innerHTML = "";
    const c = r.curve;
    const pts = points(r);
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `<span><span class="key" style="background:var(--series-1)"></span>Friction removed (whiskers: 5th–95th pct of ${NW} weightings)</span>
      <span><span class="key" style="background:var(--fraud-line)"></span>Fraud this rule still catches</span>
      <span><span class="key" style="background:var(--fraud-line-2)"></span>Fraud the whole ruleset still stops</span>
      ${c.flat_index > 0 ? '<span><span class="wash" style="background:var(--flat-wash);outline:1px solid var(--good)"></span>Flat stretch</span>' : ""}`;
    box.appendChild(legend);

    const W = Math.max(280, box.clientWidth - 16), H = 330;
    const m = { l: 46, r: W < 600 ? 92 : 116, t: 18, b: 44 };
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img",
      "aria-label": `Tradeoff curve for ${r.name}: friction removed and fraud caught as the threshold is relaxed` }, box);
    const iw = W - m.l - m.r, ih = H - m.t - m.b;

    let xs;
    const n = c.grid.length;
    if (!r.sweepable) {
      xs = (i) => m.l + (n === 1 ? 0 : (i / (n - 1)) * iw);
    } else if (r.axis === "log") {
      const a = Math.log(c.grid[0]), b = Math.log(c.grid[n - 1]);
      xs = (i) => m.l + ((Math.log(c.grid[i]) - a) / (b - a)) * iw;
    } else {
      const a = c.grid[0], b = c.grid[n - 1];
      xs = (i) => m.l + (b === a ? 0 : ((c.grid[i] - a) / (b - a)) * iw);
    }
    const valToX = (v) => {
      if (r.axis === "log") return m.l + ((Math.log(v) - Math.log(c.grid[0])) / (Math.log(c.grid[n - 1]) - Math.log(c.grid[0]))) * iw;
      return m.l + ((v - c.grid[0]) / (c.grid[n - 1] - c.grid[0])) * iw;
    };
    const ys = (v) => m.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

    // grid + y axis
    for (const t of [0, 25, 50, 75, 100]) {
      el("line", { x1: m.l, x2: m.l + iw, y1: ys(t), y2: ys(t), class: t === 0 ? "baseline" : "grid" }, svg);
      text(svg, m.l - 8, ys(t) + 4, `${t}%`, { "text-anchor": "end", class: "axis-label" });
    }
    // x axis
    if (r.sweepable) {
      const lo = Math.min(c.grid[0], c.grid[n - 1]), hi = Math.max(c.grid[0], c.grid[n - 1]);
      const ticks = r.axis === "log" ? logTicks(lo, hi) : niceTicks(lo, hi, 6);
      for (const t of ticks) {
        const x = valToX(t);
        el("line", { x1: x, x2: x, y1: m.t + ih, y2: m.t + ih + 4, class: "baseline" }, svg);
        text(svg, x, m.t + ih + 17, fmtVal(t, r.unit), { "text-anchor": "middle", class: "axis-label" });
      }
    } else {
      c.grid.forEach((g, i) => text(svg, xs(i), m.t + ih + 17, g === "on" ? "list on (live)" : "list off", { "text-anchor": "middle", class: "axis-label" }));
    }
    const dirWord = !r.sweepable ? "" : r.op.startsWith(">") ? "raise threshold →" : "lower threshold →";
    text(svg, m.l + iw, m.t + ih + 36, `${r.feature} · relax: ${dirWord}`, { "text-anchor": "end", class: "axis-label" });
    text(svg, m.l, m.t + ih + 36, `live: ${fmtVal(c.grid[0], r.unit)}`, { "text-anchor": "start", class: "axis-label" });

    // flat stretch
    if (c.flat_index > 0) {
      const x1 = xs(c.flat_index);
      el("rect", { x: m.l, y: m.t, width: x1 - m.l, height: ih, fill: "var(--flat-wash)" }, svg);
      el("line", { x1, x2: x1, y1: m.t, y2: m.t + ih, stroke: "var(--good)", "stroke-width": 1 }, svg);
      const label = `Flat stretch — capture intact to ${fmtVal(c.grid[c.flat_index], r.unit)}`;
      const anchorEnd = x1 - m.l > 230;
      text(svg, anchorEnd ? x1 - 6 : x1 + 6, m.t + 14, label, { "text-anchor": anchorEnd ? "end" : "start", fill: "var(--good-text)", style: "fill:var(--good-text);font-weight:600" });
    }

    const base = c.base_fraud_caught_rule || 1;
    const rsBase = pts[0].fraud_caught_ruleset || 1;
    const fr = pts.map((p) => p.pct_of_rule);
    const fraud = pts.map((p) => (100 * p.fraud_caught_rule) / base);
    const fraudRs = pts.map((p) => (100 * p.fraud_caught_ruleset) / rsBase);
    const path = (vals) => vals.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join("");

    // whisker band + whiskers
    const band = fr.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.p95).toFixed(1)}`).join("") +
      fr.slice().reverse().map((p, j) => `L${xs(n - 1 - j).toFixed(1)},${ys(p.p5).toFixed(1)}`).join("") + "Z";
    el("path", { d: band, fill: "var(--series-1-wash)", stroke: "none" }, svg);
    fr.forEach((p, i) => {
      if (p.p95 - p.p5 < 0.5) return;
      const x = xs(i);
      el("line", { x1: x, x2: x, y1: ys(p.p5), y2: ys(p.p95), stroke: "var(--series-1)", "stroke-width": 1.25, opacity: 0.7 }, svg);
      for (const yv of [p.p5, p.p95]) el("line", { x1: x - 3, x2: x + 3, y1: ys(yv), y2: ys(yv), stroke: "var(--series-1)", "stroke-width": 1.25, opacity: 0.7 }, svg);
    });

    el("path", { d: path(fraudRs), fill: "none", stroke: "var(--fraud-line-2)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    el("path", { d: path(fraud), fill: "none", stroke: "var(--fraud-line)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);
    el("path", { d: path(fr.map((p) => p.ref)), fill: "none", stroke: "var(--series-1)", "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }, svg);

    // direct end labels (with leader nudging if they collide)
    const ends = [
      { y: ys(fr[n - 1].ref), s: "Friction removed" },
      { y: ys(fraud[n - 1]), s: "Fraud · this rule" },
      { y: ys(fraudRs[n - 1]), s: "Fraud · ruleset" },
    ].sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].ly = (ends[i - 1].ly || ends[i - 1].y) + 14;
    for (const e of ends) {
      const ly = e.ly || e.y;
      if (Math.abs(ly - e.y) > 1) el("line", { x1: m.l + iw + 2, x2: m.l + iw + 8, y1: e.y, y2: ly - 4, stroke: "var(--axis)" }, svg);
      text(svg, m.l + iw + 10, ly, e.s, { class: "direct", style: "font-size:11px" });
    }

    // marker layer
    const marker = el("g", {}, svg);
    curveGeom = { svg, marker, xs, ys, fr, fraud, fraudRs, m, ih, iw, n };

    // hover / click layer
    const hit = el("rect", { x: m.l - 6, y: m.t, width: iw + 12, height: ih, fill: "transparent", style: "cursor:pointer" }, svg);
    const nearest = (evt) => {
      const pt = svg.getBoundingClientRect();
      const x = ((evt.clientX - pt.left) / pt.width) * W;
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(xs(i) - x); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    hit.addEventListener("mousemove", (evt) => {
      const i = nearest(evt);
      const p = pts[i];
      showTip(evt, `<b><code>${esc(c.expressions[i])}</code></b><br>
        Friction removed <b>${fmtPct(p.pct_of_rule.ref, 1)}</b> <span class="t-muted">(${fmtPct(p.pct_of_rule.p5, 1)}–${fmtPct(p.pct_of_rule.p95, 1)})</span><br>
        ${fmtInt(p.interventions_removed)} interventions · ${p.clients_affected} clients<br>
        Fraud caught by rule <b>${p.fraud_caught_rule} / ${c.base_fraud_caught_rule}</b><br>
        <span class="t-muted">Click to move the slider here</span>`);
      drawHover(i);
    });
    hit.addEventListener("mouseleave", () => { hideTip(); drawHover(null); });
    hit.addEventListener("click", (evt) => { state.idx = nearest(evt); document.getElementById("threshold").value = state.idx; updateReadout(r); });
  }

  function drawHover(i) {
    if (!curveGeom) return;
    const g = curveGeom;
    let h = g.svg.querySelector(".hover-line");
    if (i === null) { if (h) h.remove(); return; }
    if (!h) { h = el("line", { class: "hover-line", stroke: "var(--axis)", "stroke-width": 1, "pointer-events": "none" }); g.svg.insertBefore(h, g.marker); }
    const x = g.xs(i);
    h.setAttribute("x1", x); h.setAttribute("x2", x); h.setAttribute("y1", g.m.t); h.setAttribute("y2", g.m.t + g.ih);
  }

  function markCurve(r) {
    if (!curveGeom) return;
    const g = curveGeom;
    g.marker.innerHTML = "";
    const i = state.idx, x = g.xs(i);
    el("line", { x1: x, x2: x, y1: g.m.t, y2: g.m.t + g.ih, stroke: "var(--ink)", "stroke-width": 1.5, "pointer-events": "none" }, g.marker);
    for (const [v, col] of [[g.fraudRs[i], "var(--fraud-line-2)"], [g.fraud[i], "var(--fraud-line)"], [g.fr[i].ref, "var(--series-1)"]]) {
      el("circle", { cx: x, cy: g.ys(v), r: 5.5, fill: col, stroke: "var(--surface)", "stroke-width": 2, "pointer-events": "none" }, g.marker);
    }
  }

  // ======================================================================
  // 2. Client friction detail
  // ======================================================================
  function quickPicks() {
    const picks = [];
    const add = (id, label) => { if (id && clientById[id] && !picks.some((p) => p[0] === id)) picks.push([id, label]); };
    add(D.demo.open_client, "Demo: " + (clientById[D.demo.open_client] || {}).name);
    add(D.demo.guardrail_client, "Guardrail: " + (clientById[D.demo.guardrail_client] || {}).name);
    const est = clients.filter((c) => c.band === "established").sort((a, b) => b.f30.ref - a.f30.ref)[0];
    if (est) add(est.client_id, "Highest-friction established client");
    const inc = clients.filter((c) => c.total30 > 0).sort((a, b) => b.incident30 / b.total30 - a.incident30 / a.total30)[0];
    if (inc) add(inc.client_id, "Most incident-driven client");
    return picks;
  }

  function renderClient() {
    const c = clientById[state.clientId];
    const dl = document.getElementById("client-options");
    if (!dl.childElementCount) {
      dl.innerHTML = clients.map((x) => `<option value="${esc(x.name)} · ${x.client_id}">`).join("");
      const qp = document.getElementById("quick-picks");
      qp.innerHTML = "";
      for (const [id, label] of quickPicks()) {
        const b = document.createElement("button");
        b.textContent = label;
        b.onclick = () => go("client", id);
        qp.appendChild(b);
      }
    }
    document.getElementById("client-search").value = "";

    const tenure = c.tenure_months == null ? "tenure unknown" : `${c.tenure_months} months`;
    document.getElementById("client-head").innerHTML = `<h1>${esc(c.name)}</h1>
      <span class="sub">${c.client_id} · ${c.entity} · ${c.segment} · ${tenure} · peer group ${c.peer_group || "unknown"}</span>
      <span class="band">${BAND_LABEL[c.band]}${c.disqualified ? " · disqualified" : ""}</span>`;

    const total = c.f30.ref + c.incident30;
    const incShare = total ? (100 * c.incident30) / total : 0;
    const tiles = [
      ["Friction · 30 days", c.f30.ref.toFixed(0), `${c.f30.p5.toFixed(0)}–${c.f30.p95.toFixed(0)} across ${NW} weightings`],
      ["Friction · 7 days", c.f7.ref.toFixed(0), `${c.n7} intervention${c.n7 === 1 ? "" : "s"}`],
      ["Interventions · 30 days", c.n30, `+${c.contributing} contributing, ${c.shadow} shadow (90d, unscored)`],
      ["Incident band · 30 days", c.incident30.toFixed(0), c.incident30 ? `${fmtPct(incShare)} of total friction — inflicted by us` : "no incident exposure"],
      ["Friction percentile", `${c.pct_rank.ref.toFixed(0)}`, `${c.pct_rank.p5.toFixed(0)}–${c.pct_rank.p95.toFixed(0)} across weightings`],
    ];
    document.getElementById("client-tiles").innerHTML = tiles.map(([l, v, s]) =>
      `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");

    drawTimeline(c);
    renderExplanation(c);
    renderEvidence(c);
    renderAttribution(c);
    renderHits(c);
  }

  function renderExplanation(c) {
    const parts = [];
    const total = c.f30.ref + c.incident30;
    const rr = Object.entries(c.by_rule30).sort((a, b) => b[1].friction - a[1].friction);
    if (!c.n30 && !c.incident30) {
      parts.push(`${esc(c.name)} received no interventions in the last 30 days.`);
    } else {
      parts.push(`${esc(c.name)} received <b>${c.n30}</b> intervention${c.n30 === 1 ? "" : "s"} in the last 30 days (friction ${c.f30.ref.toFixed(0)}, higher than ${c.pct_rank.ref.toFixed(0)}% of clients).`);
      if (rr.length) {
        const [rid, v] = rr[0], r = ruleById[rid];
        const share = c.f30.ref ? (100 * v.friction) / c.f30.ref : 0;
        parts.push(`<b>${v.count} of ${c.n30}</b> came from <b>${esc(r.name)}</b> (${r.decision} at ${r.checkpoint}), ${fmtPct(share)} of rule-attributed friction.`);
      }
    }
    const ev = c.evidence;
    if (ev.challenges) parts.push(`Over 90 days ${ev.cleared} of ${ev.challenges} challenges were cleared on review.`);
    if (c.contributing || c.shadow) parts.push(`${c.contributing} contributing and ${c.shadow} shadow hits were logged but not scored — they caused nothing.`);
    if (c.incident30 && total && c.incident30 / total > 0.5) {
      parts.push(`<b>Most of this client's friction (${fmtPct((100 * c.incident30) / total)}) came from our own incidents.</b> Relaxing rules would not help — this is an operations conversation, not a rules one.`);
    }
    let action = "";
    if (c.disqualified) {
      action = `<p><b>Not eligible for relaxation:</b> ${esc(c.reasons[0])}. This friction is earned; the tool declines to relax it.</p>`;
    } else {
      const notes = Object.entries(c.relax_removed_at_flat).sort((a, b) => b[1] - a[1]);
      if (notes.length) {
        const [rid, k] = notes[0], r = ruleById[rid];
        const flatExpr = r.curve.expressions[r.curve.flat_index];
        action = `<p>At the end of ${esc(r.name)}'s flat stretch (<code>${esc(flatExpr)}</code>), <b>${k}</b> of this client's interventions over 90 days would not have happened — at zero cost in fraud caught.
          <button class="link" data-rule="${rid}">Open the ${esc(r.name)} curve →</button></p>`;
      } else if (rr.length && verdictOf(ruleById[rr[0][0]]) === "earning") {
        const r = ruleById[rr[0][0]];
        action = `<p>The rule behind most of this friction, ${esc(r.name)}, has no flat stretch: relaxing it loses capture immediately. This client's friction is buying protection.
          <button class="link" data-rule="${r.rule_id}">See why →</button></p>`;
      } else if (c.n30) {
        action = `<p>None of this client's interventions sit inside a flat stretch: no free relaxation is available.</p>`;
      }
      if (c.eligible_for_segment_policy) action += `<p class="muted">In the segment policy: established band and above the high-friction line.</p>`;
    }
    const box = document.getElementById("client-explain");
    box.innerHTML = `<div class="explain"><p>${parts.join(" ")}</p>${action}</div>`;
    box.querySelectorAll("[data-rule]").forEach((b) => (b.onclick = () => go("explorer", b.dataset.rule)));
  }

  function renderEvidence(c) {
    const ev = c.evidence;
    const g = D.config.good_client;
    const od = ev.overdispersion == null || isNaN(ev.overdispersion) ? "n/a" : ev.overdispersion.toFixed(2);
    document.getElementById("client-evidence").innerHTML = `<dl class="kv">
      <dt>Band</dt><dd><b>${BAND_LABEL[c.band]}</b>${c.disqualified ? " (disqualified)" : ""}</dd>
      <dt>Tenure</dt><dd>${ev.tenure_months == null ? "<i>unknown</i>" : ev.tenure_months + " months"}</dd>
      <dt>Resolution outcomes</dt><dd>${ev.challenges ? `${ev.cleared} cleared, ${ev.upheld} upheld` : "no challenges — unflagged, not evidenced"}</dd>
      <dt>Confirmed fraud</dt><dd>${ev.confirmed_fraud ? `<b>${ev.confirmed_fraud}</b> — disqualifier` : "none"}</dd>
      <dt>Behavioural stability</dt><dd>${od} excess weekly variation (≤ ${g.established.max_overdispersion} for established)</dd>
      <dt>Account standing</dt><dd>${ev.chargeback_rate == null ? "<i>unknown</i>" : `chargeback rate ${(ev.chargeback_rate * 100).toFixed(2)}%`}</dd>
      ${c.unknown.length ? `<dt>Unknown evidence</dt><dd>${c.unknown.join(", ")}</dd>` : ""}
      </dl>
      <p class="muted" style="margin:10px 0 0">Established: tenure ≥ ${g.established.min_tenure_months} months, ≥ ${g.established.min_clear_rate * 100}% of challenges cleared, stable volume, chargebacks ≤ ${g.established.max_chargeback_rate * 100}%, no confirmed fraud.
      Built on how challenges ended, not on whether rules fired.</p>`;
  }

  function renderAttribution(c) {
    const rr = Object.entries(c.by_rule30).sort((a, b) => b[1].friction - a[1].friction);
    if (!rr.length) { document.getElementById("client-attr").innerHTML = `<p class="muted">No prevailing hits in the last 30 days.</p>`; return; }
    let h = `<div class="table-scroll"><table><thead><tr><th>Rule</th><th>Decision · checkpoint</th><th class="num">Interventions</th><th class="num">Friction</th><th class="num">Share</th><th>Rule verdict</th><th></th></tr></thead><tbody>`;
    for (const [rid, v] of rr) {
      const r = ruleById[rid], vd = verdictOf(r);
      h += `<tr><td><b>${esc(r.name)}</b> <span class="muted">${rid}</span></td><td>${r.decision} · ${r.checkpoint}</td>
        <td class="num">${v.count}</td><td class="num">${v.friction.toFixed(1)}</td><td class="num">${fmtPct((100 * v.friction) / (c.f30.ref || 1))}</td>
        <td><span class="badge ${vd}">${VERDICT_LABEL[vd]}</span></td><td><button class="link" data-rule="${rid}">Curve →</button></td></tr>`;
    }
    if (c.incident30) h += `<tr><td><b>Incident band</b></td><td>not rule-attributed</td><td class="num">${c.incident_detail.length}</td><td class="num">${c.incident30.toFixed(1)}</td><td class="num">separate</td><td colspan="2" class="muted">${c.incident_detail.map((d) => `${d.incident_id}: ${d.hours}h`).join(", ")}</td></tr>`;
    const box = document.getElementById("client-attr");
    box.innerHTML = h + "</tbody></table></div>";
    box.querySelectorAll("[data-rule]").forEach((b) => (b.onclick = () => go("explorer", b.dataset.rule)));
  }

  function renderHits(c) {
    const hits = D.timelines[c.client_id].slice().reverse();
    let h = `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Rule</th><th>Decision</th><th>Checkpoint</th><th>Action</th><th>Outcome</th>
      <th class="num">Held / open (h)</th><th class="num">Value</th><th class="num">Friction</th></tr></thead><tbody>`;
    for (const x of hits) {
      const r = ruleById[x.rule_id];
      h += `<tr><td>${fmtDate(x.t)}</td><td>${esc(r.name)}</td><td>${x.decision}</td><td>${x.checkpoint}</td><td>${x.action.toLowerCase()}</td>
        <td>${x.final.toLowerCase()}${x.fraud ? " · fraud" : ""}</td><td class="num">${x.decision === "HOLD" && x.action === "PREVAILED" ? x.hours.toFixed(1) : "—"}</td>
        <td class="num">${x.value == null ? "—" : fmtVal(x.value, r.unit)}</td><td class="num">${x.friction ? x.friction.toFixed(1) : "0"}</td></tr>`;
    }
    document.getElementById("client-hits").innerHTML = h + "</tbody></table></div>";
  }

  function drawTimeline(c) {
    const box = document.getElementById("timeline");
    box.innerHTML = "";
    const hits = D.timelines[c.client_id];
    const lanes = [...new Set(hits.map((h) => h.rule_id))].sort();
    const incidents = c.incident_detail.map((d) => D.incidents.find((i) => i.incident_id === d.incident_id));
    const allLanes = (incidents.length ? ["__inc"] : []).concat(lanes);

    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `<span><span class="dot" style="background:var(--series-1)"></span>Prevailing — scored (size = friction)</span>
      <span><span class="ring"></span>Contributing — not scored</span>
      <span><span class="dot" style="background:var(--muted);width:6px;height:6px"></span>Shadow / overridden — cost nothing</span>
      <span><span class="dot" style="background:var(--series-2)"></span>Confirmed fraud event</span>
      <span><span class="key" style="background:var(--series-1);opacity:.45"></span>Measured hold duration</span>
      ${incidents.length ? '<span><span class="wash" style="background:var(--fraud-line-2)"></span>Incident window</span>' : ""}`;
    box.appendChild(legend);
    if (!allLanes.length) { box.insertAdjacentHTML("beforeend", "<p class='muted'>No rule hits or incidents in the window.</p>"); return; }

    const W = Math.max(280, box.clientWidth), laneH = 34;
    const narrow = W < 600;
    const m = { l: narrow ? 92 : 190, r: 16, t: 22, b: 26 };
    const H = m.t + m.b + laneH * allLanes.length;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Intervention timeline for ${c.name}` }, box);
    const t0 = Date.parse(D.meta.window_start), t1 = Date.parse(D.meta.as_of);
    const xs = (iso) => m.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - m.l - m.r);
    const ly = (k) => m.t + laneH * k + laneH / 2;

    // last 30 days
    const x30 = xs(new Date(t1 - 30 * 864e5).toISOString());
    el("rect", { x: x30, y: m.t - 6, width: W - m.r - x30, height: H - m.t - m.b + 6, fill: "var(--surface-2)" }, svg);
    text(svg, x30 + 4, m.t - 9, "last 30 days", { class: "axis-label" });

    for (let d = 0; d <= 90; d += narrow ? 30 : 15) {
      const iso = new Date(t0 + d * 864e5).toISOString();
      const x = xs(iso);
      el("line", { x1: x, x2: x, y1: m.t - 4, y2: H - m.b, class: "grid" }, svg);
      text(svg, x, H - m.b + 16, fmtDateShort(iso), { "text-anchor": "middle", class: "axis-label" });
    }

    allLanes.forEach((lane, k) => {
      const y = ly(k);
      el("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: "grid" }, svg);
      if (lane === "__inc") {
        text(svg, m.l - 10, y + 4, narrow ? "Incidents" : "Incidents (separate band)", { "text-anchor": "end", class: "direct" });
        for (const inc of incidents) {
          const x1 = xs(inc.start), x2 = Math.max(xs(inc.end), x1 + 3);
          const r = el("rect", { x: x1, y: y - 9, width: x2 - x1, height: 18, rx: 3, fill: "var(--fraud-line-2)" }, svg);
          const d = c.incident_detail.find((q) => q.incident_id === inc.incident_id);
          r.addEventListener("mousemove", (evt) => showTip(evt, `<b>${inc.incident_id}</b> · ${inc.severity}<br>${fmtDate(inc.start)} → ${fmtDate(inc.end)}<br>${d.hours}h exposed · friction ${d.friction.toFixed(1)}<br><span class="t-muted">Inflicted by us, not by a rule</span>`));
          r.addEventListener("mouseleave", hideTip);
        }
        return;
      }
      const r = ruleById[lane];
      text(svg, m.l - 10, y - 2, narrow ? r.rule_id : r.name, { "text-anchor": "end", class: "direct" });
      text(svg, m.l - 10, y + 11, narrow ? r.decision : `${r.decision} · ${r.checkpoint}`, { "text-anchor": "end", class: "axis-label", style: "font-size:10px" });
      const mine = hits.filter((h) => h.rule_id === lane);
      // hold durations first so dots sit on top
      for (const h of mine) {
        if (h.decision === "HOLD" && h.action === "PREVAILED" && h.hours > 0) {
          el("line", { x1: xs(h.t), x2: Math.max(xs(h.resolved), xs(h.t) + 1), y1: y, y2: y, stroke: "var(--series-1)", "stroke-width": 4, opacity: 0.45, "stroke-linecap": "round" }, svg);
        }
      }
      for (const h of mine) {
        const x = xs(h.t);
        let node;
        if (h.action === "PREVAILED") {
          const rad = Math.max(4, Math.min(9, 2.5 + Math.sqrt(h.friction) * 0.9));
          node = el("circle", { cx: x, cy: y, r: rad, fill: h.fraud ? "var(--series-2)" : "var(--series-1)", stroke: "var(--surface)", "stroke-width": 2 }, svg);
        } else if (h.action === "CONTRIBUTING") {
          node = el("circle", { cx: x, cy: y, r: 4.5, fill: "var(--surface)", stroke: h.fraud ? "var(--series-2)" : "var(--series-1)", "stroke-width": 2 }, svg);
        } else {
          node = el("circle", { cx: x, cy: y, r: 3, fill: h.fraud ? "var(--series-2)" : "var(--muted)", opacity: 0.8 }, svg);
        }
        const hit = el("circle", { cx: x, cy: y, r: 10, fill: "transparent" }, svg);
        hit.addEventListener("mousemove", (evt) => showTip(evt, `<b>${esc(r.name)}</b> <span class="t-muted">${r.rule_id}</span><br>
          ${fmtDate(h.t)} · ${h.request_type} · ${h.decision}<br>${h.action.toLowerCase()} · outcome ${h.final.toLowerCase()}${h.fraud ? " · <b>confirmed fraud</b>" : ""}<br>
          ${r.feature} = ${h.value == null ? "—" : fmtVal(h.value, r.unit)}${h.decision === "HOLD" && h.action === "PREVAILED" ? `<br>held ${h.hours.toFixed(1)}h (measured)` : ""}<br>
          friction ${h.friction ? h.friction.toFixed(1) : "0 (not scored)"}`));
        hit.addEventListener("mouseleave", hideTip);
        node.setAttribute("pointer-events", "none");
      }
    });
  }

  // ======================================================================
  // 3. Portfolio
  // ======================================================================
  function renderPortfolio() {
    const M = D.metrics, P = D.portfolio, ra = M.relax_all;
    const q = P.quadrant;
    const tiles = [
      ["Clients", fmtInt(clients.length), `${D.meta.counts.decision_events.toLocaleString()} decision events · 90 days`],
      ["High-friction line", P.p75.toFixed(0), `${D.config.high_friction_percentile}th percentile of 30-day friction`],
      ["Good clients carrying high friction", q.good_high || 0, "established band, above the line"],
      ["Fraud caught at live thresholds", `${M.fraud.caught_baseline} / ${M.fraud.total}`, `${M.fraud.missed_baseline} missed — measured on the whole population`],
      ["Free friction across all rules", fmtInt(ra.interventions_removed), `interventions removable at zero capture cost · ${ra.clients_affected} clients`],
    ];
    document.getElementById("portfolio-tiles").innerHTML = tiles.map(([l, v, s]) =>
      `<div class="tile"><div class="label">${l}</div><div class="value">${v}</div><div class="sub">${s}</div></div>`).join("");
    drawSwarm();
    drawBars("by-checkpoint", P.by_checkpoint);
    drawBars("by-entity", P.by_entity);
    renderMetrics();
    renderConfig();
  }

  function drawSwarm() {
    const box = document.getElementById("swarm");
    box.innerHTML = "";
    const legend = document.createElement("div");
    legend.className = "legend";
    legend.innerHTML = `<span><span class="dot" style="background:var(--series-1)"></span>No confirmed fraud</span>
      <span><span class="dot" style="background:var(--series-2)"></span>Confirmed fraud</span>
      <span><span class="wash" style="background:var(--series-1-wash)"></span>Good client, high friction — the population this product is for</span>`;
    box.appendChild(legend);
    const bandsOrder = ["established", "developing", "limited"];
    const W = Math.max(280, box.clientWidth), rowH = 120;
    const m = { l: W < 600 ? 100 : 130, r: 20, t: 26, b: 34 };
    const H = m.t + m.b + rowH * 3;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": "Friction distribution by good-client band" }, box);
    const pos = clients.map((c) => c.f30.ref).filter((f) => f > 0);
    const minF = Math.max(0.5, Math.min(...pos)), maxF = Math.max(...pos);
    const xs = (f) => m.l + 8 + ((Math.log10(f) - Math.log10(minF)) / (Math.log10(maxF) - Math.log10(minF))) * (W - m.l - m.r - 8);
    const p75 = D.portfolio.p75;

    // quadrant callout
    const xq = xs(p75);
    el("rect", { x: xq, y: m.t, width: W - m.r - xq, height: rowH, fill: "var(--series-1-wash)" }, svg);
    text(svg, W - m.r - 6, m.t - 8, `${D.portfolio.quadrant.good_high || 0} good clients above the line`, { "text-anchor": "end", class: "direct" });

    for (const t of [1, 3, 10, 30, 100, 300, 1000, 3000].filter((t) => t >= minF && t <= maxF)) {
      el("line", { x1: xs(t), x2: xs(t), y1: m.t, y2: H - m.b, class: "grid" }, svg);
      text(svg, xs(t), H - m.b + 16, String(t), { "text-anchor": "middle", class: "axis-label" });
    }
    text(svg, W - m.r, H - 4, "30-day friction (log scale) →", { "text-anchor": "end", class: "axis-label" });
    el("line", { x1: xq, x2: xq, y1: m.t - 4, y2: H - m.b, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
    text(svg, xq + 4, H - m.b - 6, `high-friction line (p${D.config.high_friction_percentile} = ${p75.toFixed(0)})`, { class: "axis-label" });

    bandsOrder.forEach((b, k) => {
      const cy = m.t + rowH * k + rowH / 2;
      const all = clients.filter((c) => c.band === b);
      const members = all.filter((c) => c.f30.ref > 0).sort((a, z) => a.f30.ref - z.f30.ref);
      const zero = all.length - members.length;
      text(svg, m.l - 12, cy - 9, BAND_LABEL[b], { "text-anchor": "end", class: "direct" });
      text(svg, m.l - 12, cy + 6, `${all.length} clients`, { "text-anchor": "end", class: "axis-label" });
      if (zero) text(svg, m.l - 12, cy + 20, `${zero} with no friction`, { "text-anchor": "end", class: "axis-label" });
      if (k) el("line", { x1: m.l, x2: W - m.r, y1: m.t + rowH * k, y2: m.t + rowH * k, class: "baseline" }, svg);
      // simple beeswarm
      const placed = [];
      const r = 4.5, gap = 2 * r + 1;
      for (const c of members) {
        const x = xs(c.f30.ref);
        let off = 0;
        for (let tries = 0; tries < 60; tries++) {
          off = tries === 0 ? 0 : Math.ceil(tries / 2) * (gap * 0.55) * (tries % 2 ? 1 : -1);
          if (!placed.some((p) => Math.abs(p.x - x) < gap && Math.abs(p.y - off) < gap)) break;
        }
        off = Math.max(-rowH / 2 + 8, Math.min(rowH / 2 - 8, off));
        placed.push({ x, y: off });
        const dot = el("circle", { cx: x, cy: cy + off, r, fill: c.evidence.confirmed_fraud ? "var(--series-2)" : "var(--series-1)", stroke: "var(--surface)", "stroke-width": 1.5, style: "cursor:pointer" }, svg);
        dot.addEventListener("mousemove", (evt) => showTip(evt, `<b>${esc(c.name)}</b> <span class="t-muted">${c.client_id}</span><br>
          ${BAND_LABEL[c.band]} · ${c.entity} ${c.segment}<br>30-day friction <b>${c.f30.ref.toFixed(0)}</b> · ${c.n30} interventions<br>
          ${c.top_rule ? `mostly ${esc(ruleById[c.top_rule].name)}` : ""}${c.incident30 ? `<br>incident band ${c.incident30.toFixed(0)}` : ""}<br><span class="t-muted">Click to open</span>`));
        dot.addEventListener("mouseleave", hideTip);
        dot.addEventListener("click", () => go("client", c.client_id));
      }
    });
  }

  function drawBars(id, data) {
    const box = document.getElementById(id);
    box.innerHTML = "";
    const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
    const W = Math.max(280, box.clientWidth), rowH = 32;
    const m = { l: W < 500 ? 120 : 150, r: 110, t: 4, b: 4 };
    const H = m.t + m.b + rowH * entries.length;
    const svg = el("svg", { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: "img" }, box);
    const max = Math.max(...entries.map((e) => e[1]), 1);
    const total = entries.reduce((s, e) => s + e[1], 0);
    entries.forEach(([k, v], i) => {
      const y = m.t + i * rowH + 6, w = ((W - m.l - m.r) * v) / max;
      text(svg, m.l - 10, y + 14, k, { "text-anchor": "end", class: "direct", style: "font-weight:500" });
      el("path", { d: `M${m.l},${y} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v12 a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} Z`, fill: "var(--series-1)" }, svg);
      text(svg, m.l + w + 6, y + 14, `${fmtInt(v)} · ${fmtPct((100 * v) / total)}`, { class: "axis-label" });
    });
  }

  function renderMetrics() {
    const M = D.metrics, ra = M.relax_all, f = M.fraud;
    const est = ra.established_friction_cut_pct;
    const nonTrivial = M.free_friction_by_rule.filter((r) => r.verdict === "free_friction");
    const rows = [
      ["Fraud caught and missed", `${f.caught_baseline} caught, ${f.missed_baseline} missed of ${f.total}`,
        `${f.caught_after_relax_all} caught after relaxing every free-friction rule to its flat-stretch end — unchanged`],
      ["Friction events removed at zero capture cost", "0 — nothing like this is measured today",
        `${fmtInt(ra.interventions_removed)} interventions from ${ra.clients_affected} clients, non-trivial on ${nonTrivial.length} rules`],
      ["Challenge reduction, good-client band", `${fmtInt(ra.established_interventions_before)} interventions on established clients`,
        `${fmtInt(ra.established_interventions_after)} after · friction cut median ${fmtPct(est.p50)} (${fmtPct(est.p5)}–${fmtPct(est.p95)} across ${NW} weightings)`],
      ["Clients above the high-friction line", `${ra.clients_above_p75_before}`,
        `${ra.clients_above_p75} after · ${ra.clients_friction_increased} clients see friction rise. Top-decile share of friction ${fmtPct(100 * ra.top_decile_share_before)} → ${fmtPct(100 * ra.top_decile_share_after)}: what remains concentrates, but on ${ra.top_decile_not_established_after} of ${ra.top_decile_size} top-decile clients outside the established band — nobody was pushed up.`],
      ["Range width across weightings", "n/a", `widest flat-stretch spread ${M.range_width_max_pct_points} percentage points (5th–95th) — narrow enough that the conclusions hold throughout`],
      ["Rules with no flat stretch", "unknown today",
        `${M.no_flat_stretch.join(", ") || "none"}${M.two_state_rules.length ? `; two-state (list) rules: ${M.two_state_rules.join(", ")}` : ""} — a negative finding worth reporting`],
    ];
    let h = `<div class="table-scroll"><table><thead><tr><th>Measure</th><th>Baseline</th><th>Result</th></tr></thead><tbody>` +
      rows.map((r) => `<tr><td><b>${r[0]}</b></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("") + "</tbody></table></div>";
    h += `<h3 style="margin-top:18px">Per rule, at the end of its flat stretch</h3><div class="table-scroll"><table><thead><tr><th>Rule</th><th>Verdict</th><th>Setting</th>
      <th class="num">Interventions removed</th><th class="num">Clients</th><th class="num">Share of rule friction</th></tr></thead><tbody>`;
    for (const r of M.free_friction_by_rule) {
      const rule = ruleById[r.rule_id], v = verdictOf(rule);
      h += `<tr><td><button class="link" data-rule="${r.rule_id}">${esc(r.name)}</button></td><td><span class="badge ${v}">${VERDICT_LABEL[v]}</span></td>
        <td><code>${esc(r.expression)}</code></td><td class="num">${fmtInt(r.interventions_removed)}</td><td class="num">${r.clients_affected}</td>
        <td class="num">${r.pct_of_rule ? `${fmtPct(r.pct_of_rule.ref)} (${fmtPct(r.pct_of_rule.p5)}–${fmtPct(r.pct_of_rule.p95)})` : "—"}</td></tr>`;
    }
    const box = document.getElementById("metrics");
    box.innerHTML = h + "</tbody></table></div>";
    box.querySelectorAll("[data-rule]").forEach((b) => (b.onclick = () => go("explorer", b.dataset.rule)));
  }

  function renderConfig() {
    const c = D.config;
    const w = c.decision_weights;
    document.getElementById("config").innerHTML = `<p class="muted">${esc(c._notice)}</p>
      <table><thead><tr><th>Intervention</th><th class="num">Rank</th><th class="num">Placeholder weight</th></tr></thead><tbody>
      ${Object.entries(w).map(([k, v]) => `<tr><td>${k}</td><td class="num">${k === "SHADOW" ? 0 : D.meta.decision_rank[k]}</td><td class="num">${v}</td></tr>`).join("")}
      </tbody></table>
      <dl class="kv" style="margin-top:12px">
      <dt>Recency half-life</dt><dd>${c.half_life_days} days · swept ${c.weighting_sweep.half_life_days.join("–")}</dd>
      <dt>Hold duration factor</dt><dd>log(1 + hours / ${c.reference_hours}) · reference hours swept ${c.weighting_sweep.reference_hours.join("–")}, shapes ${c.weighting_sweep.duration_shapes.join(" / ")} (cap ${c.saturating_cap_hours}h)</dd>
      <dt>Incident severity weights</dt><dd>${Object.entries(c.incident_severity_weights).map(([k, v]) => `${k} ${v}`).join(" · ")}</dd>
      <dt>Weightings sampled</dt><dd>${NW} ordering-consistent vectors (seed ${c.weighting_sweep.seed}) + the placeholder</dd>
      <dt>Generator seed</dt><dd>${D.meta.seed}</dd></dl>`;
  }

  // ------------------------------------------------------------ wiring
  document.getElementById("seed").textContent = D.meta.seed;
  document.getElementById("asof").textContent = fmtDate(D.meta.as_of);
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => go(b.dataset.view, b.dataset.view === "explorer" ? state.ruleId : state.clientId)));
  document.getElementById("threshold").addEventListener("input", (e) => {
    state.idx = +e.target.value;
    const r = ruleById[state.ruleId];
    e.target.setAttribute("aria-valuetext", r.curve.expressions[state.idx]);
    updateReadout(r);
  });
  document.querySelectorAll(".policy-toggle button").forEach((b) => (b.onclick = () => { state.policy = b.dataset.policy; renderExplorer(); }));
  document.getElementById("client-search").addEventListener("change", (e) => {
    const id = (e.target.value.match(/CL-\d+/) || [])[0];
    const hit = id ? clientById[id] : clients.find((c) => c.name.toLowerCase() === e.target.value.toLowerCase());
    if (hit) go("client", hit.client_id);
  });
  document.getElementById("theme-toggle").onclick = () => {
    const root = document.documentElement;
    const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
    root.dataset.theme = dark ? "light" : "dark";
  };
  window.addEventListener("popstate", fromHash);
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  fromHash();
})();
