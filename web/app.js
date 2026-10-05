/* FrictionIQ frontend — the thinnest layer over precomputed results.
 * Reads window.FRICTIONIQ (web/data/frictioniq.js). Nothing is recomputed here: the
 * window selector and the threshold slider index into precomputed settings.
 * Screens follow the Figma designs (Salt, Legacy theme): Home → Client → Rule.
 */
(function () {
  "use strict";

  const D = window.FRICTIONIQ;
  const view = document.getElementById("view");
  if (!D) {
    view.innerHTML = "<div class='card'>No results found. Run <code>make all</code> to build web/data/frictioniq.js.</div>";
    return;
  }

  const SVGNS = "http://www.w3.org/2000/svg";
  const rules = D.rules;
  const ruleById = Object.fromEntries(rules.map((r) => [r.rule_id, r]));
  const clients = D.clients;
  const clientById = Object.fromEntries(clients.map((c) => [c.client_id, c]));
  const GRADES = Object.keys(D.grades.cutoffs);
  const HEAVY = D.grades.heavy;
  const HEAVY_FLOOR = Math.min(...HEAVY.map((g) => D.grades.cutoffs[g][0]));
  const NW = D.meta.n_weightings;
  const demo = D.demo || {};
  const EST = D.config.good_client.established;

  const state = {
    view: "home",
    win: "30d",
    clientId: clientById[demo.open_client] ? demo.open_client : clients[0].client_id,
    ruleId: ruleById[demo.hero_rule] ? demo.hero_rule : rules[0].rule_id,
    idx: {},
    policy: "global",
    showAllHeavy: false,
    showUncredited: false,
    proposalOpen: false,
  };

  // ------------------------------------------------------------------ formatting
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtInt = (n) => Math.round(n).toLocaleString("en-US");
  const pct = (v) => `${Math.round(v)}%`;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dt = (iso) => new Date(iso);
  const dayLabel = (iso) => `${MONTHS[dt(iso).getUTCMonth()]} ${dt(iso).getUTCDate()}`;
  const fullDate = (iso) => `${dayLabel(iso)}, ${dt(iso).getUTCFullYear()}`;
  const W = () => D.meta.windows[state.win];
  const rangeLabel = () => {
    const s = dt(W().start), e = dt(D.meta.as_of);
    const sameYear = s.getUTCFullYear() === e.getUTCFullYear();
    return `${dayLabel(W().start)}${sameYear ? "" : ", " + s.getUTCFullYear()} – ${fullDate(D.meta.as_of)}`;
  };
  const periodPhrase = () => ({ "30d": "a month", "60d": "over 60 days", "1y": "over 12 months" }[state.win]);
  const periodNote = () => ({ "30d": "per month", "60d": "last 60 days", "1y": "last 12 months" }[state.win]);
  const glanceTitle = () => ({ "30d": "Last 30 days", "60d": "Last 60 days", "1y": "Last 12 months" }[state.win]);

  function fmtVal(v, unit, compact) {
    if (v === "on" || v === "off") return v;
    switch (unit) {
      case "usd":
        if (compact && v >= 1000) return "$" + (+(v / 1000).toFixed(1)).toString() + "k";
        return "$" + fmtInt(v);
      case "pct": return `${+(v * 100).toFixed(1)}%`;
      case "ratio": return `${+v.toFixed(2)}×`;
      case "hours": return `${+v.toFixed(1)} h`;
      case "days": return `${+v.toFixed(0)} days`;
      case "sigma": return `${+v.toFixed(2)}σ`;
      default: return `${+(+v).toFixed(3)}`;
    }
  }
  function heldFor(h) {
    if (h.d !== "HOLD" && h.d !== "SETTLEMENT_LIMIT") return "—";
    if (h.k < 1) return `${Math.max(1, Math.round(h.k * 60))} min`;
    if (h.k < 48) return `${Math.round(h.k)} h`;
    return `${Math.round(h.k / 24)} days`;
  }
  function actionLabel(h) {
    const payout = /PAYOUT/.test(h.q);
    switch (h.d) {
      case "DENY": return payout ? "Deny payout" : h.q === "CAPTURE" ? "Deny capture" : "Deny";
      case "HOLD": return "Hold → manual review";
      case "SETTLEMENT_LIMIT": return "Settlement limit";
      case "RESTRICT": return "Product restriction";
      case "BLOCK": return "Block account";
      case "TERMINATE": return "Termination";
      default: return h.d;
    }
  }
  function outcomeLabel(h) {
    if (h.o === "CLEARED") return h.d === "DENY" ? "No fraud found" : h.d === "SETTLEMENT_LIMIT" ? "Limit lifted" : "Cleared";
    if (h.o === "UPHELD") return h.x ? "Fraud confirmed" : "Upheld";
    return "—";
  }
  const shortName = (c) => { const w = c.name.split(" "); return w[0] === "The" && w[1] ? w[1] : w[0]; };
  const gradeColor = (g) => D.grades.colors[g];
  const gradeWord = (g) => ({ A: "Minimal friction", B: "Light friction", C: "Moderate friction", D: "High friction", E: "Heavy friction", F: "Heavy friction" }[g]);
  const bandLabel = (b) => ({ established: "Established", developing: "Developing", limited: "Limited history" }[b]);
  const tagFor = (cv) => ({ free: "tag-free", small: "tag-small", none: "tag-none" }[cv.verdict] || "tag-quiet");
  const verbFor = (r) => (r.op && r.op.startsWith("<") ? "Lowering" : "Raising");

  // ------------------------------------------------------------------ svg + tooltip
  function el(tag, attrs, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, attrs) {
    const t = el("text", { x, y, ...(attrs || {}) }, parent);
    t.textContent = s;
    return t;
  }
  const tip = document.getElementById("tooltip");
  function showTip(evt, html) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - 14;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  function bindTip(node, html) {
    node.addEventListener("mousemove", (e) => showTip(e, typeof html === "function" ? html() : html));
    node.addEventListener("mouseleave", hideTip);
  }
  function niceTicks(lo, hi, n) {
    const span = Math.abs(hi - lo);
    if (!span) return [lo];
    const mag = Math.pow(10, Math.floor(Math.log10(span / n)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
    const a = Math.min(lo, hi), b = Math.max(lo, hi), out = [];
    for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function logTicks(lo, hi, mantissas) {
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++)
      for (const m of mantissas) { const v = m * Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); }
    return out;
  }

  // ------------------------------------------------------------------ routing
  function go(hash) { if (location.hash !== hash) location.hash = hash; else route(); }
  function route() {
    const [v, arg] = location.hash.replace(/^#/, "").split("/");
    if (v === "client") { if (arg && clientById[arg]) state.clientId = arg; state.view = "client"; }
    else if (v === "rule") {
      if (arg && ruleById[arg] && arg !== state.ruleId) { state.ruleId = arg; state.proposalOpen = false; }
      state.view = "rule";
    } else state.view = "home";
    render();
    view.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  function render() {
    hideTip();
    document.querySelectorAll(".nav a").forEach((a) => {
      if (a.dataset.nav === state.view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    if (state.view === "home") renderHome();
    if (state.view === "client") renderClient();
    if (state.view === "rule") renderRule();
  }
  function windowControl(label) {
    return `<div class="window"><div class="window-label">${label || "Window"}</div>
      <div class="seg" role="group" aria-label="Window">${Object.entries(D.meta.windows).map(([k, w]) =>
        `<button type="button" data-win="${k}" aria-pressed="${k === state.win}">${w.label}</button>`).join("")}</div>
      <div class="window-range">${rangeLabel()}</div></div>`;
  }
  function wireCommon() {
    view.querySelectorAll("[data-win]").forEach((b) => (b.onclick = () => { state.win = b.dataset.win; render(); }));
    view.querySelectorAll("[data-client]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); go("#client/" + b.dataset.client); }));
    view.querySelectorAll("[data-rule]").forEach((b) => (b.onclick = (e) => { e.preventDefault(); go("#rule/" + b.dataset.rule); }));
  }
  const footer = (extra) => `<footer class="footer">${extra ? `<div>${extra}</div>` : ""}
    <div>All clients, rules and figures on this screen are synthetic and built for demonstration · generator seed ${D.meta.seed} ·
    friction weights ${D.meta.weights_version} are placeholders, shown as ranges · curves precomputed for every threshold</div></footer>`;

  // ======================================================================
  // 1. Home
  // ======================================================================
  function causeText(c) {
    const w = c.windows[state.win];
    const inc = w.incident.friction, total = inc + w.score[0];
    if (total && inc / total >= 0.5) return `${pct((100 * inc) / total)} from an outage, not a rule`;
    const e = Object.entries(w.by_rule).sort((a, b) => b[1].score - a[1].score);
    if (!e.length) return "No rule interventions";
    const [top, v] = e[0];
    if (v.count / w.n >= 0.75) return `${v.count} of ${w.n} from ${top}`;
    if (v.score / w.score[0] >= 0.5 || e.length === 1) return `Mostly ${top}`;
    return `${top} and ${e[1][0]}`;
  }
  const heavyClients = () => clients.filter((c) => c.windows[state.win].heavy)
    .sort((a, b) => b.windows[state.win].score[0] - a.windows[state.win].score[0]);
  const rulesByVolume = () => rules.slice().sort((a, b) => b.windows[state.win].interventions - a.windows[state.win].interventions);

  function renderHome() {
    const P = D.portfolio[state.win];
    const heavy = heavyClients();
    const look = state.showAllHeavy ? heavy : heavy.slice(0, 5);
    const rr = rulesByVolume().filter((r) => r.windows[state.win].interventions > 0).slice(0, 5);
    const maxR = rr.length ? rr[0].windows[state.win].interventions : 1;
    const heavyCount = HEAVY.reduce((s, g) => s + (P.grade_counts[g] || 0), 0);
    const kpi = (label, value, sub) => `<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Client friction across the portfolio</h1>
          <p class="lead">How often our fraud rules interrupt clients, which rules do it, and which good clients carry the most.</p></div>
        ${windowControl()}
      </div>
      <div class="kpis">
        ${kpi("Interventions", fmtInt(P.interventions), `across ${P.clients} synthetic clients`)}
        ${kpi("Clients interrupted", fmtInt(P.clients_interrupted), `${pct((100 * P.clients_interrupted) / P.clients)} had at least one`)}
        ${kpi("Good clients, heavy friction", fmtInt(P.good_clients_heavy_friction), `Established band, graded ${HEAVY.join(" or ")}`)}
        ${kpi("Free to remove", fmtInt(P.free_to_remove), "interventions, with no change in fraud caught")}
      </div>
      <div class="home-grid">
        <div class="home-left">
          <section class="card">
            <h2>Who carries the friction</h2>
            <div class="card-sub">Each dot is a client, coloured by friction grade. Top right is the problem: good clients we keep interrupting.</div>
            <div class="chart-box" id="scatter"></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>Friction grades across all clients</h2>
              <span class="card-note">${HEAVY.join(" and ")} = heavy friction · ${heavyCount} clients (${pct((100 * heavyCount) / P.clients)})</span></div>
            <div class="grade-bar">${GRADES.map((g) => `<div style="flex:${Math.max(P.grade_counts[g], 0.001)};background:${gradeColor(g)}" title="${g}: ${P.grade_counts[g]} clients"></div>`).join("")}</div>
            <div class="grade-labels">${GRADES.map((g) => `<div style="flex:${Math.max(P.grade_counts[g], 0.001)}">${g} ${P.grade_counts[g]}</div>`).join("")}</div>
          </section>
        </div>
        <div class="home-right">
          <section class="card">
            <h2>Good clients to look at first</h2>
            <div class="card-sub">Established band, heaviest friction first</div>
            <div class="look-list">${look.map((c) => {
              const w = c.windows[state.win];
              return `<div class="look-row">
                <span class="grade-badge" style="background:${gradeColor(w.grade)}" aria-label="Grade ${w.grade}">${w.grade}</span>
                <div style="min-width:0"><a href="#client/${c.client_id}" class="name">${esc(c.name)}</a><div class="cause">${esc(causeText(c))}</div></div>
                <span>${w.incident.items.length ? '<span class="tag tag-incident">Incident</span>' : ""}</span>
                <span class="score">${Math.round(w.score[0])}</span></div>`;
            }).join("") || '<p class="muted" style="padding:10px 0">No established clients are graded E or F in this window.</p>'}</div>
            ${heavy.length > 5 ? `<button class="see-all" id="see-all">${state.showAllHeavy ? "Show the top 5" : `See all ${heavy.length} good clients with heavy friction →`}</button>` : ""}
          </section>
          <section class="card">
            <h2>Rules causing the most friction</h2>
            <div class="card-sub">Interventions in the ${W().phrase}, and how far each can be loosened for free</div>
            <div class="rule-bars">${rr.map((r, i) => {
              const rw = r.windows[state.win];
              return `<div class="rule-bar-row">
                <button class="rname${i === 0 ? " top" : ""}" data-rule="${r.rule_id}">${r.rule_id}</button>
                <span class="tag ${tagFor(rw.curve)}">${esc(rw.curve.label)}</span>
                <div class="bar-line"><span class="bar${i === 0 ? " top" : ""}" style="width:${Math.max(2, (100 * rw.interventions) / maxR) * 0.82}%"></span>${fmtInt(rw.interventions)}</div>
              </div>`;
            }).join("")}</div>
          </section>
        </div>
      </div>
      ${methodSection()}
      ${footer(`Outage friction is tracked separately: ${P.incidents.count} incident${P.incidents.count === 1 ? "" : "s"} this window affected ${P.incidents.clients_affected} clients. It is never added to friction scores, because no rule caused it.`)}`;

    wireCommon();
    const sa = document.getElementById("see-all");
    if (sa) sa.onclick = () => { state.showAllHeavy = !state.showAllHeavy; renderHome(); };
    drawScatter(document.getElementById("scatter"));
  }

  function drawScatter(box) {
    const width = Math.max(300, box.clientWidth);
    const narrow = width < 560;
    const H = narrow ? 300 : 360;
    const m = { l: narrow ? 44 : 64, r: 8, t: 8, b: 48 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": "Friction score against good-client band for every client" }, box);
    const iw = width - m.l - m.r, ih = H - m.t - m.b;
    const scores = clients.map((c) => c.windows[state.win].score[0]).sort((a, b) => a - b);
    const p97 = scores[Math.floor(scores.length * 0.97)];
    const ymax = Math.max(400, Math.ceil(p97 / 100) * 100);
    const ys = (v) => m.t + ih - (Math.min(v, ymax) / ymax) * ih;
    const cols = ["limited", "developing", "established"];
    const cw = iw / 3;
    const cx = (b) => m.l + cw * cols.indexOf(b);

    // good clients, heavy friction
    el("rect", { x: cx("established"), y: m.t, width: cw, height: ys(HEAVY_FLOOR) - m.t, fill: "var(--heavy-wash)" }, svg);
    for (let t = 0; t <= ymax; t += 100) {
      el("line", { x1: m.l, x2: m.l + iw, y1: ys(t), y2: ys(t), class: t === 0 ? "axis" : "grid" }, svg);
      txt(svg, m.l - 12, ys(t) + 4, String(t), { "text-anchor": "end" });
    }
    // grade strip on the y axis
    GRADES.forEach((g) => {
      const [lo, hi] = D.grades.cutoffs[g];
      const top = ys(Math.min(hi == null ? ymax : hi + 1, ymax)), bot = ys(lo);
      if (bot > top) el("rect", { x: m.l - 6, y: top + 1, width: 4, height: bot - top - 2, fill: gradeColor(g) }, svg);
    });
    el("line", { x1: m.l, x2: m.l + iw, y1: ys(HEAVY_FLOOR), y2: ys(HEAVY_FLOOR), stroke: "var(--border-strong)" }, svg);
    for (let i = 1; i < 3; i++) el("line", { x1: m.l + cw * i, x2: m.l + cw * i, y1: m.t, y2: m.t + ih, stroke: "var(--border-strong)" }, svg);
    if (!narrow) {
      const t = txt(svg, -(m.t + ih / 2), 16, "Friction score", { transform: "rotate(-90)", "text-anchor": "middle" });
      t.setAttribute("x", -(m.t + ih / 2));
    }
    const nHeavy = D.portfolio[state.win].good_clients_heavy_friction;
    const halo = "paint-order:stroke;stroke:#fff;stroke-width:3px;stroke-linejoin:round";
    const q = (x, y, a, b) => {
      txt(svg, x, y, a, { class: "t-ink", style: `font-size:12px;${halo}` });
      if (b) txt(svg, x, y + 15, b, { style: halo });
    };
    if (!narrow) {
      q(cx("limited") + 10, m.t + 18, "Friction earned", "limited history or past fraud");
      q(cx("limited") + 10, m.t + ih - 10, "New clients, light touch");
      q(cx("established") + 10, m.t + ih - 10, "Good clients, left alone");
    }
    if (narrow) q(cx("established") + 6, m.t + 16, "Start here", `${nHeavy} clients`);
    else q(cx("established") + 10, m.t + 18, "Good clients, heavy friction", `${nHeavy} clients  ·  start here`);
    cols.forEach((b) => txt(svg, cx(b) + cw / 2, m.t + ih + 18, bandLabel(b), { "text-anchor": "middle", class: "t-ink" }));
    txt(svg, m.l + iw / 2, m.t + ih + 38, narrow ? "Good-client evidence  →" : "Good-client evidence  →  tenure, cleared reviews, no confirmed fraud", { "text-anchor": "middle" });

    const pad = 14;
    const pos = (c) => [cx(c.band) + pad + c.x * (cw - 2 * pad), ys(c.windows[state.win].score[0])];
    const callouts = [];
    clients.forEach((c) => {
      const w = c.windows[state.win];
      const [x, y] = pos(c);
      const dot = el("circle", { cx: x, cy: y, r: 4.5, fill: gradeColor(w.grade), stroke: "#fff", "stroke-width": 1, style: "cursor:pointer" }, svg);
      bindTip(dot, `<b>${esc(c.name)}</b><br><span class="t-muted">${bandLabel(c.band)} · ${esc(c.segment_label)}${c.tenure_months != null ? ` · ${c.tenure_months} months` : ""}</span><br>
        Grade <b>${w.grade}</b> · score ${Math.round(w.score[0])}${w.score[0] > ymax ? " (above the chart)" : ""} · ${w.n} interventions<br>${esc(causeText(c))}`);
      dot.addEventListener("click", () => go("#client/" + c.client_id));
      if (c.client_id === demo.open_client) callouts.push([c, `Grade ${w.grade} · ${causeLine(c)}`]);
      if (c.client_id === demo.guardrail_client) callouts.push([c, `Grade ${w.grade} · earned, ${c.evidence.confirmed_fraud} fraud cases`]);
    });
    if (!narrow) callouts.forEach(([c, line]) => {
      const [x, y] = pos(c);
      el("circle", { cx: x, cy: y, r: 6.5, fill: gradeColor(c.windows[state.win].grade), stroke: "var(--ink)", "stroke-width": 2, "pointer-events": "none" }, svg);
      const g = el("g", { "pointer-events": "none" }, svg);
      const t1 = txt(g, 0, 0, c.name, { class: "t-ink", style: "font-size:12px" });
      const t2 = txt(g, 0, 15, line);
      const bw = Math.max(t1.getComputedTextLength(), t2.getComputedTextLength()) + 14;
      const left = c.band === "established" ? x - bw - 12 : x + 12;
      const top = Math.max(m.t + 2, Math.min(y - 12, m.t + ih - 40));
      g.setAttribute("transform", `translate(${left + 7},${top + 15})`);
      const rect = el("rect", { x: left, y: top, width: bw, height: 36, fill: "#fff", stroke: "var(--border-strong)" });
      svg.insertBefore(rect, g);
    });
  }
  function causeLine(c) {
    const w = c.windows[state.win];
    const top = w.top_rule && w.by_rule[w.top_rule];
    if (!top) return "no interventions";
    return top.count === w.n ? `all ${w.n} from one rule` : `${top.count} of ${w.n} from one rule`;
  }

  function methodSection() {
    const M = D.metrics[state.win], ra = M.relax_all;
    const free = M.free_by_rule.filter((r) => r.verdict === "free").length;
    const rows = [
      ["Fraud caught and missed", `${M.fraud.caught} caught, ${M.fraud.missed} missed of ${M.fraud.total}`,
        `${M.fraud.caught_after_relax_all} caught after relaxing every rule to the end of its free stretch`],
      ["Friction removed at zero capture cost", "0: not measured today",
        `${fmtInt(ra.interventions_removed)} interventions from ${ra.clients_affected} clients, a free stretch on ${free} rules`],
      ["Challenge reduction, established band", "current thresholds",
        `friction cut median ${pct(ra.established_cut_pct[1])} (${pct(ra.established_cut_pct[2])}–${pct(ra.established_cut_pct[3])} across ${NW} weightings)`],
      ["Clients above the high-friction line", `${ra.clients_above_p75_before}`,
        `${ra.clients_above_p75_after} after; ${ra.clients_friction_increased} clients see friction rise; top-decile share ${pct(100 * ra.top_decile_share[0])} → ${pct(100 * ra.top_decile_share[1])}`],
      ["Range width across weightings", "n/a", `widest free-stretch spread: ${M.range_width_pts} percentage points`],
      ["Rules with no free stretch", "unknown today", M.no_free_stretch.join(", ") || "none"],
    ];
    const w = D.config.decision_weights;
    return `<details class="card method"><summary>Method and success metrics · ${W().phrase}</summary>
      <div class="table-scroll"><table><thead><tr><th>Measure</th><th>Baseline</th><th>Result</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("")}</tbody></table></div>
      <p class="card-note" style="margin-top:12px">Friction score = Σ over prevailing interventions of decision weight × hold-duration factor × recency decay.
      Placeholder weights ${D.meta.weights_version}: ${Object.entries(w).filter(([k]) => k !== "SHADOW").map(([k, v]) => `${k.toLowerCase().replace("_", " ")} ${v}`).join(", ")};
      half-life ${D.config.half_life_days} days; hold factor log(1 + hours / ${D.config.reference_hours}). Every figure is re-run across ${NW} weightings
      consistent with that ordering, half-lives ${D.config.weighting_sweep.half_life_days.join("–")} days and reference hours ${D.config.weighting_sweep.reference_hours.join("–")}.
      Grade cutoffs are placeholders. Outages are never added to a score.</p></details>`;
  }

  // ======================================================================
  // 2. Client friction detail
  // ======================================================================
  function goodChecks(c) {
    const ev = c.evidence;
    const disputesOk = ev.disputes_12m <= Math.max(EST.max_disputes_12m, EST.max_dispute_rate * ev.captures_12m);
    return [
      ["Tenure", ev.tenure_months == null ? "Unknown" : `${ev.tenure_months} months`,
        ev.tenure_months == null ? null : ev.tenure_months >= EST.min_tenure_months],
      ["Review outcomes", ev.challenges ? `${ev.cleared} of ${ev.challenges} cleared` : "No reviews yet",
        ev.clear_rate == null ? null : ev.clear_rate >= EST.min_clear_rate],
      ["Confirmed fraud", ev.confirmed_fraud ? `${ev.confirmed_fraud} case${ev.confirmed_fraud > 1 ? "s" : ""}` : "None, ever", !ev.confirmed_fraud],
      ["Payout pattern", ev.median_payout == null ? "No payouts" :
        `${ev.overdispersion != null && ev.overdispersion <= EST.max_overdispersion ? "Stable" : "Volatile"} · median ${fmtVal(ev.median_payout, "usd")}`,
        ev.overdispersion == null ? null : ev.overdispersion <= EST.max_overdispersion],
      ["Disputes & chargebacks", `${ev.disputes_12m} in 12 months`, disputesOk],
    ];
  }
  function summarySentence(c, w) {
    const parts = [];
    const name = shortName(c);
    if (!w.n) parts.push(`No interventions in the ${W().phrase}.`);
    else {
      parts.push(`${w.n} intervention${w.n === 1 ? "" : "s"} in the ${W().phrase}.`);
      const top = w.top_rule && w.by_rule[w.top_rule];
      if (top && w.n > 1 && top.count === w.n) parts.push("All of them came from one rule.");
      else if (top && w.n > 1 && top.count / w.n >= 0.5) parts.push(`${top.count} of them came from one rule.`);
    }
    if (c.evidence.confirmed_fraud) parts.push(`${name} has ${c.evidence.confirmed_fraud} confirmed fraud case${c.evidence.confirmed_fraud > 1 ? "s" : ""}, so this friction is earned.`);
    else parts.push(`${name} has never had a confirmed fraud case.`);
    const inc = w.incident.friction;
    if (inc && inc / (inc + w.score[0]) >= 0.5) parts.push("Most of its friction came from our own outage, not a rule.");
    return parts.join(" ");
  }

  function renderClient() {
    const c = clientById[state.clientId];
    const w = c.windows[state.win];
    const total = w.score[0];
    const byRule = Object.entries(w.by_rule).sort((a, b) => b[1].score - a[1].score);
    const top = w.top_rule;
    const topR = top && w.by_rule[top];
    const others = byRule.filter(([k]) => k !== top).map(([k]) => k);
    const prevMonth = (() => {
      const mid = new Date(Date.parse(W().start) - (W().days * 864e5) / 2);
      return state.win === "30d" ? MONTHS_LONG[mid.getUTCMonth()] : `Previous ${W().label}`;
    })();
    const nowLabel = state.win === "30d" ? "This month" : glanceTitle();
    const holds = w.hold_hours < 24 ? `${Math.round(w.hold_hours)} hours` : `~${Math.round(w.hold_hours / 24)} days`;
    const incItems = w.incident.items;
    const incShare = w.incident.friction ? w.incident.friction / (w.incident.friction + total) : 0;
    const checks = goodChecks(c);
    const icon = (ok) => ok === true ? '<svg viewBox="0 0 16 16"><path d="M3 8.5 6.5 12 13 4.5"/></svg>'
      : ok === false ? '<svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg>' : '<svg viewBox="0 0 16 16"><path d="M4 8h8"/></svg>';

    view.innerHTML = `
      <div class="page-head">
        <div>
          <div class="crumbs"><a href="#home">Clients</a> › ${esc(c.name)}</div>
          <div class="title-row"><h1>${esc(c.name)}</h1>
            <span class="tag tag-info">${bandLabel(c.band)} client</span>
            ${incItems.length ? '<span class="tag tag-incident">Incident</span>' : ""}
            <span class="title-meta">${esc(c.segment_label)}${c.tenure_months != null ? ` · ${c.tenure_months} months` : ""} · ${c.client_id}</span></div>
          <p class="lead">${esc(summarySentence(c, w))}</p>
        </div>
        ${windowControl()}
      </div>
      <div class="client-grid">
        <div class="client-left">
          <section class="card">
            <div class="card-head"><h2>${glanceTitle()} at a glance</h2><span class="card-note">Weights ${D.meta.weights_version} are placeholders, so every score is shown as a range</span></div>
            <div class="glance">
              <div><div class="stat-label">Friction grade</div>
                <div class="grade-big"><span class="letter" style="color:${gradeColor(w.grade)}">${w.grade}</span><span class="word">${gradeWord(w.grade)}</span></div>
                <div id="grade-scale"></div>
                <div class="stat-sub">${w.grade_range[0] === w.grade_range[1] ? w.grade_range[0] : w.grade_range.join("–")} across weightings · score ${Math.round(total)}</div></div>
              <div><div class="stat-label">Interventions</div>
                <div class="arrow-pair">${w.prev_n == null ? "" : `<div class="col"><span class="stat-value muted">${w.prev_n}</span><span>${prevMonth}</span></div><span class="arrow">→</span>`}
                  <div class="col"><span class="stat-value accent">${w.n}</span><span>${nowLabel}</span></div></div></div>
              <div><div class="stat-label">Waiting on their money</div>
                <div class="stat-value">${w.holds ? holds : "None"}</div>
                <div class="stat-sub">${w.holds ? `${w.holds} payout${w.holds > 1 ? "s" : ""} held for review, ${w.holds_cleared === w.holds ? "all cleared" : `${w.holds_cleared} cleared`}` : "no payouts held"}</div></div>
              <div><div class="stat-label">Payouts denied</div>
                <div class="stat-value">${w.denied}</div>
                <div class="stat-sub">${w.denied ? (w.denied_fraud ? `${w.denied_fraud} confirmed fraud` : "no fraud found in any") : "none in this window"}</div></div>
            </div>
            <div class="glance-bottom">
              <div><div class="stat-label">Caused by</div>
                ${topR ? `<div class="share-bar">${byRule.map(([k, v], i) => `<div style="flex:${Math.max(v.score, 0.01)};background:${k === top ? "var(--orange)" : i % 2 ? "var(--grey-2)" : "var(--grey-1)"}" title="${k}: ${v.count}"></div>`).join("")}</div>
                <div><span class="big-accent">${pct((100 * topR.score) / Math.max(total, 1e-9))}</span> from ${top} · ${topR.count} of ${w.n} interventions</div>
                <div class="stat-sub">${others.length ? `${others.length} other rule${others.length > 1 ? "s" : ""}: ${others.join(", ")}` : "no other rules"}</div>`
                : '<div class="stat-sub">No rule interventions in this window.</div>'}</div>
              <div><div class="stat-label">Compared with similar clients</div>
                <div id="peer-strip"></div>
                <div><span class="big-accent">${ordinal(w.peer_pct[0])} percentile</span> of similar ${esc(c.segment_label)} clients</div>
                <div class="stat-sub">n = ${w.peer_n} · whisker = weighting range</div></div>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2>Interventions by rule</h2><span class="card-note">One row per rule, busiest first · each dot is one intervention · hover for action and hold time</span></div>
            <div class="lanes" id="lanes"></div>
            <div class="note-row"><span class="box"></span><span>${incItems.length
              ? `Incident friction: ${incItems.map((i) => `${i.hours} h inside ${i.id}`).join(", ")} — ${pct(100 * incShare)} of this client's friction this window. Outages are our fault, not a rule's, so they are shown separately and never added to the score.`
              : "Incident friction: none in this window. Outages are our fault, not a rule's, so they are shown separately and never added to the score."}</span></div>
          </section>
          <section class="card">
            <div class="card-head"><h2>Intervention log</h2><span class="card-note">Newest first · only the rule whose decision prevailed is credited</span></div>
            <div class="table-scroll" id="log"></div>
            <div class="table-tools"><label><input type="checkbox" id="show-uncredited" ${state.showUncredited ? "checked" : ""}> Also show contributing, shadow and overridden hits</label></div>
          </section>
        </div>
        <div class="client-right">
          <section class="card">
            <div class="card-head"><h2>Is this a good client?</h2><span class="tag tag-info">${bandLabel(c.band)}</span></div>
            <div class="card-sub">Based on evidence the fraud rules did not create</div>
            <div class="evidence">${checks.map(([k, v, ok]) => `<div class="ev-row ${ok === false ? "bad" : ok == null ? "unknown" : ""}">${icon(ok)}<span>${k}</span><span class="v">${esc(v)}</span></div>`).join("")}</div>
            <p class="card-note" style="margin-top:10px">A proposal for Risk Strategy, not a validated score. Any confirmed fraud disqualifies a client outright.${c.unknown.length ? ` Unknown evidence (${c.unknown.join(", ")}) caps a client below established.` : ""}</p>
          </section>
          ${top ? `<section class="card" id="why-card"></section>` : ""}
        </div>
      </div>
      ${footer()}`;

    wireCommon();
    document.getElementById("show-uncredited").onchange = (e) => { state.showUncredited = e.target.checked; renderLog(c); };
    drawGradeScale(document.getElementById("grade-scale"), w);
    drawPeerStrip(document.getElementById("peer-strip"), c, w);
    drawLanes(document.getElementById("lanes"), c, w);
    renderLog(c);
    if (top) renderWhy(document.getElementById("why-card"), c, w, ruleById[top]);
  }
  const ordinal = (n) => { const v = Math.round(n), s = ["th", "st", "nd", "rd"], r = v % 100; return v + (s[(r - 20) % 10] || s[r] || s[0]); };

  function drawGradeScale(box, w) {
    const width = 180, H = 34, seg = width / GRADES.length;
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": `Grade ${w.grade}, ${w.grade_range.join(" to ")} across weightings` }, box);
    GRADES.forEach((g, i) => {
      el("rect", { x: i * seg + 1, y: 14, width: seg - 2, height: 6, fill: gradeColor(g) }, svg);
      txt(svg, i * seg + seg / 2, 31, g, { "text-anchor": "middle", style: `font-size:10px;${g === w.grade ? "fill:" + gradeColor(g) + ";font-weight:700" : ""}` });
    });
    const xi = (g) => GRADES.indexOf(g) * seg + seg / 2;
    const a = xi(w.grade_range[0]), b = xi(w.grade_range[1]);
    el("line", { x1: a, x2: b, y1: 7, y2: 7, stroke: "var(--ink)", "stroke-width": 1.5 }, svg);
    [a, b].forEach((x) => el("line", { x1: x, x2: x, y1: 4, y2: 10, stroke: "var(--ink)", "stroke-width": 1.5 }, svg));
    el("path", { d: `M${xi(w.grade) - 4},4 h8 l-4,6z`, fill: "var(--ink)" }, svg);
  }

  function peerKey(c) { return `${c.entity}|${c.segment}|${c.peer_group || ""}`; }
  function drawPeerStrip(box, c, w) {
    const peers = clients.filter((p) => peerKey(p) === peerKey(c));
    const vals = peers.map((p) => p.windows[state.win].score[0]);
    const max = Math.max(...vals, w.score[2], 1);
    const width = 260, H = 26, l = 4, r = 10;
    const xs = (v) => l + (v / max) * (width - l - r);
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, role: "img", "aria-label": "This client's score among similar clients" }, box);
    el("line", { x1: l, x2: width - r, y1: 14, y2: 14, stroke: "var(--border)" }, svg);
    peers.forEach((p, i) => { if (p !== c) el("circle", { cx: xs(p.windows[state.win].score[0]), cy: 14 + ((i % 3) - 1) * 4, r: 2.6, fill: "var(--grey-1)" }, svg); });
    el("line", { x1: xs(w.score[1]), x2: xs(w.score[2]), y1: 14, y2: 14, stroke: "var(--orange)", "stroke-width": 1.5 }, svg);
    [w.score[1], w.score[2]].forEach((v) => el("line", { x1: xs(v), x2: xs(v), y1: 10, y2: 18, stroke: "var(--orange)", "stroke-width": 1.5 }, svg));
    el("circle", { cx: xs(w.score[0]), cy: 14, r: 5, fill: "var(--orange)", stroke: "#fff", "stroke-width": 1.5 }, svg);
  }

  function windowHits(c, credited) {
    const start = W().start;
    return D.timelines[c.client_id].filter((h) => h.t >= start && (credited ? h.a === "P" : true));
  }

  function drawLanes(box, c, w) {
    const hits = windowHits(c, true);
    const counts = {};
    hits.forEach((h) => (counts[h.r] = (counts[h.r] || 0) + 1));
    const lanes = Object.keys(counts).sort((a, b) => (b === w.top_rule) - (a === w.top_rule) || counts[b] - counts[a]);
    if (!lanes.length) { box.innerHTML = '<p class="muted" style="padding:8px 0">No interventions in this window.</p>'; return; }
    const width = Math.max(300, box.clientWidth), narrow = width < 560;
    const laneH = 40, m = { l: narrow ? 110 : 168, r: 40, t: 4, b: 28 };
    const H = m.t + m.b + laneH * lanes.length;
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": `Interventions by rule for ${c.name}` }, box);
    const t0 = Date.parse(W().start), t1 = Date.parse(D.meta.as_of);
    const pad = 16;
    const xs = (iso) => m.l + pad + ((Date.parse(iso) - t0) / (t1 - t0)) * (width - m.l - m.r - 2 * pad);
    lanes.forEach((rid, k) => {
      const y = m.t + laneH * k + laneH / 2;
      const isTop = rid === w.top_rule;
      if (isTop) el("rect", { x: 0, y: m.t + laneH * k, width, height: laneH, fill: "var(--orange-wash)" }, svg);
      el("line", { x1: m.l + pad, x2: width - m.r - pad, y1: y, y2: y, stroke: "var(--border)" }, svg);
      const label = txt(svg, 8, y + 4, rid, { style: `font-size:12.5px;fill:${isTop ? "var(--orange)" : "var(--ink)"};cursor:pointer` });
      label.addEventListener("click", () => go("#rule/" + rid));
      txt(svg, width - 10, y + 4, String(counts[rid]), { "text-anchor": "end", class: "t-strong", style: `font-size:12.5px;${isTop ? "fill:var(--orange)" : ""}` });
      hits.filter((h) => h.r === rid).forEach((h) => {
        const dot = el("circle", { cx: xs(h.t), cy: y, r: 6, fill: isTop ? "var(--orange)" : "#8e949d", stroke: "#fff", "stroke-width": 1.5 }, svg);
        const hit = el("circle", { cx: xs(h.t), cy: y, r: 11, fill: "transparent" }, svg);
        bindTip(hit, `<b>${dayLabel(h.t)}</b> · ${esc(rid)}<br>${actionLabel(h)} · ${h.c}<br>Held for ${heldFor(h)} · ${outcomeLabel(h)}`);
        dot.setAttribute("pointer-events", "none");
      });
    });
    const days = W().days, step = days <= 31 ? 7 : days <= 62 ? 14 : 61;
    for (let d = 0; d <= days; d += step) {
      const iso = new Date(t0 + d * 864e5).toISOString();
      txt(svg, xs(iso), H - 8, days > 62 ? `${MONTHS[dt(iso).getUTCMonth()]} ${dt(iso).getUTCFullYear() % 100}` : dayLabel(iso), { "text-anchor": "middle" });
    }
    txt(svg, width - 10, H - 8, `total ${hits.length}`, { "text-anchor": "end" });
  }

  function renderLog(c) {
    const w = c.windows[state.win];
    const hits = windowHits(c, !state.showUncredited).slice().reverse();
    const roleNote = { C: "Not credited · contributing", S: "Not credited · shadow, logged only", O: "Not credited · overridden downstream" };
    const box = document.getElementById("log");
    box.innerHTML = `<table><thead><tr><th>Date</th><th>Rule</th><th>Action</th><th>Checkpoint</th><th>Held for</th><th>Outcome</th></tr></thead><tbody>
      ${hits.map((h) => `<tr class="${h.a === "P" ? "" : "uncredited"}"><td>${dayLabel(h.t)}</td>
        <td class="rule-cell${h.r === w.top_rule && h.a === "P" ? " top" : ""}"><span data-tip-rule="${h.r}">${h.r}</span></td>
        <td>${h.a === "P" ? actionLabel(h) : roleNote[h.a]}</td><td>${h.c}</td><td>${h.a === "P" ? heldFor(h) : "—"}</td>
        <td>${h.a === "P" ? outcomeLabel(h) : "—"}</td></tr>`).join("") || '<tr><td colspan="6" class="muted">No interventions in this window.</td></tr>'}
      </tbody></table>`;
    box.querySelectorAll("[data-tip-rule]").forEach((s) => {
      const r = ruleById[s.dataset.tipRule];
      bindTip(s, `<b>${r.rule_id}</b><br>${esc(r.description)}<br><span class="t-muted">${r.decision_label} · ${r.checkpoint} · live since ${fullDate(r.live_since + "T00:00:00Z")}</span>`);
    });
  }

  function renderWhy(card, c, w, r) {
    const cv = r.windows[state.win].curve;
    const today = r.grid[0];
    const proposedIdx = !c.disqualified && (cv.verdict === "free" || cv.verdict === "small") ? cv.recommended_index : null;
    const proposed = proposedIdx != null ? r.grid[proposedIdx] : null;
    const start = W().start, startDay = (Date.parse(start) - Date.parse(D.meta.window_start)) / 864e5;
    let vals;
    if (r.feature === "amount" && D.payouts[c.client_id]) vals = D.payouts[c.client_id].filter((p) => p[0] >= startDay).map((p) => p[1]);
    else vals = windowHits(c, false).filter((h) => h.r === r.rule_id && h.v != null).map((h) => h.v);
    const fraud = (D.fraud_values[r.rule_id] || []).filter((v) => v != null);
    const up = !r.op.startsWith("<");
    const fires = (v) => (up ? v > today : v < today);
    const fraudEdge = fraud.length ? (up ? Math.min(...fraud) : Math.max(...fraud)) : null;
    const name = shortName(c);
    const noun = r.feature === "amount" ? "payouts" : "events";
    const roundEdge = (v) => (r.unit === "usd" ? Number(v.toPrecision(2)) : v);
    const hitVals = vals.filter(fires);
    const stillFlagged = proposed == null ? hitVals.length : hitVals.filter((v) => (up ? v > proposed : v < proposed)).length;
    const median = r.feature === "amount" && c.evidence.median_payout != null ? Math.round(c.evidence.median_payout / 10) * 10 : null;

    let text;
    const disq = c.disqualified;
    if (r.shadow) text = `This rule runs in shadow: it logs what it would do, and no client pays for it.`;
    else if (proposed == null && !disq) text = `Fraud this rule catches sits right at its threshold of ${fmtVal(today, r.unit)}, so loosening it would miss fraud straight away. This friction is buying protection.`;
    else {
      const where = median != null ? `${name}'s normal payouts sit around ${fmtVal(median, "usd")}` : `${name}'s flagged ${noun} sit ${up ? "just above" : "just below"} ${fmtVal(today, r.unit)}`;
      const fraudPart = fraudEdge != null ? `, while fraud starts around ${fmtVal(roundEdge(fraudEdge), r.unit)}` : "";
      if (c.disqualified) text = `${where}${fraudPart}. ${name} has confirmed fraud, so nothing is recommended for this client.`;
      else {
        const effect = stillFlagged === 0 ? `would stop flagging ${name}` : `would stop flagging ${hitVals.length - stillFlagged} of ${hitVals.length} of these`;
        const safe = fraudEdge == null || (up ? proposed < fraudEdge : proposed > fraudEdge) ? ` and still sit ${up ? "below" : "above"} every confirmed fraud case` : "";
        text = `${where}${fraudPart}. A threshold of ${fmtVal(proposed, r.unit)} ${effect}${safe}.`;
      }
    }

    card.innerHTML = `<h2>Why ${r.rule_id} keeps firing</h2>
      <div class="card-sub">${esc(name)}'s ${noun} vs the rule threshold${r.axis === "log" ? " · log scale" : ""}</div>
      <div class="chart-box" id="why-plot"></div>
      <p class="why-text">${esc(text)}</p>
      <button class="btn" data-rule="${r.rule_id}"><svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>Open rule tradeoff</button>`;
    card.querySelector("[data-rule]").onclick = () => go("#rule/" + r.rule_id);

    const box = document.getElementById("why-plot");
    const width = Math.max(260, box.clientWidth), H = 116;
    const m = { l: 8, r: 8, t: 22, b: 30 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": `${name}'s values against the ${r.rule_id} threshold and confirmed fraud` }, box);
    const all = vals.concat(fraud, [today], proposed != null ? [proposed] : []).filter((v) => v > 0 || r.axis !== "log");
    let lo = Math.min(...all), hi = Math.max(...all);
    if (r.axis === "log") { lo = Math.pow(10, Math.floor(Math.log10(lo) * 2) / 2); hi = Math.pow(10, Math.ceil(Math.log10(hi) * 2) / 2); }
    else { const span = hi - lo || 1; lo -= span * 0.05; hi += span * 0.05; }
    const xs = (v) => {
      const f = r.axis === "log" ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo);
      return m.l + Math.max(0, Math.min(1, f)) * (width - m.l - m.r);
    };
    const yMid = m.t + (H - m.t - m.b) / 2;
    if (fraudEdge != null) {
      const a = xs(today), b = xs(fraudEdge);
      el("rect", { x: Math.min(a, b), y: m.t, width: Math.abs(b - a), height: H - m.t - m.b, fill: "var(--free-wash)" }, svg);
      const nf = txt(svg, (a + b) / 2, m.t - 6, "no fraud ever seen here", { "text-anchor": "middle" });
      const nb = nf.getBBox();
      if (nb.x < m.l) nf.setAttribute("x", (a + b) / 2 + (m.l - nb.x));
      txt(svg, xs(up ? hi : lo) + (up ? -2 : 2), m.t - 6, "confirmed fraud", { "text-anchor": up ? "end" : "start" });
    }
    el("line", { x1: xs(today), x2: xs(today), y1: m.t - 2, y2: H - m.b, stroke: "var(--red)", "stroke-width": 2 }, svg);
    if (proposed != null) el("line", { x1: xs(proposed), x2: xs(proposed), y1: m.t, y2: H - m.b, stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "2 3" }, svg);
    el("line", { x1: m.l, x2: width - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }, svg);
    // fraud diamonds (a sample, spread so they read as a cluster)
    const fs = fraud.length > 24 ? fraud.filter((_, i) => i % Math.ceil(fraud.length / 24) === 0) : fraud;
    fs.forEach((v, i) => { const x = xs(v), y = yMid + ((i % 3) - 1) * 9; el("path", { d: `M${x},${y - 4.5} l4.5,4.5 l-4.5,4.5 l-4.5,-4.5z`, fill: "#3a3d44" }, svg); });
    vals.forEach((v, i) => {
      const x = xs(v), y = yMid + ((i % 3) - 1) * 9;
      el("circle", fires(v) ? { cx: x, cy: y, r: 4.5, fill: "var(--orange)" } : { cx: x, cy: y, r: 3.8, fill: "#fff", stroke: "var(--orange)", "stroke-width": 1.5 }, svg);
    });
    // axis labels: today and proposed first, the range ends only where they fit
    const taken = [];
    const lab = (v, s, attrs, y) => {
      const t = txt(svg, xs(v), y || H - m.b + 15, s, { "text-anchor": "middle", ...(attrs || {}) });
      const b = t.getBBox();
      if (!y && taken.some(([a, z]) => b.x < z + 6 && b.x + b.width > a - 6)) { t.remove(); return false; }
      if (!y) taken.push([b.x, b.x + b.width]);
      return true;
    };
    lab(today, `${fmtVal(today, r.unit, true)} today`, { style: "fill:var(--red)" });
    if (proposed != null && !lab(proposed, `${fmtVal(proposed, r.unit, true)} proposed`, { class: "t-strong" }))
      lab(proposed, `${fmtVal(proposed, r.unit, true)} proposed`, { class: "t-strong", "text-anchor": "start", x: xs(proposed) + 4 }, m.t + 10);
    lab(lo, fmtVal(lo, r.unit, true), { "text-anchor": "start" });
    lab(hi, fmtVal(hi, r.unit, true), { "text-anchor": "end" });
  }

  // ======================================================================
  // 3. Rule tradeoff explorer
  // ======================================================================
  const idxKey = () => `${state.ruleId}|${state.win}`;
  function currentIdx(r) {
    const k = idxKey();
    if (state.idx[k] == null) state.idx[k] = r.windows[state.win].curve.recommended_index;
    return Math.min(state.idx[k], r.grid.length - 1);
  }
  const ptsOf = (r) => (state.policy === "segment" ? r.windows[state.win].curve.segment_points : r.windows[state.win].curve.points);

  function renderRule() {
    const r = ruleById[state.ruleId];
    const rw = r.windows[state.win];
    const list = rulesByVolume();
    view.innerHTML = `
      <div class="page-head">
        <div>
          <div class="crumbs"><a href="#rule">Rule tradeoffs</a> › ${r.rule_id}</div>
          <div class="title-row"><h1>${r.rule_id}</h1>
            <span class="title-meta">${r.decision_label} · ${r.checkpoint} · live since ${dayLabel(r.live_since + "T00:00:00Z")} · ${esc(r.description.charAt(0).toLowerCase() + r.description.slice(1).replace(/\.$/, ""))}</span></div>
          <p class="lead">Drag the threshold to see how much friction it removes and how much fraud it still catches, across every synthetic client.</p>
        </div>
        <div class="window"><div class="window-label">Measured on</div>
          <div class="window-range" style="margin:0 0 6px">All ${clients.length} clients · ${W().phrase}</div>
          <div class="seg" role="group" aria-label="Window">${Object.entries(D.meta.windows).map(([k, w]) => `<button type="button" data-win="${k}" aria-pressed="${k === state.win}">${w.label}</button>`).join("")}</div>
        </div>
      </div>
      <div class="rule-grid">
        <section class="card rule-list">
          <div class="card-head"><div><h2>Rules</h2><div class="card-sub">Sorted by interventions caused, ${W().phrase}</div></div></div>
          ${list.map((x) => `<button class="rule-item" data-rule="${x.rule_id}" aria-current="${x.rule_id === r.rule_id}">
              <span><div class="rid">${x.rule_id}</div><div class="rcount">${fmtInt(x.windows[state.win].interventions)} interventions</div></span>
              <span class="tag ${tagFor(x.windows[state.win].curve)}">${esc(x.windows[state.win].curve.label)}</span></button>`).join("")}
          <div class="foot">"Free" = threshold can be relaxed this far without missing any fraud the rule catches today.</div>
        </section>
        <section class="card">
          <div class="card-head"><h2>What each threshold buys and costs</h2>
            <div class="legend"><span><i style="background:var(--teal);height:8px;opacity:.6"></i>Friction removed</span><span><i style="background:var(--ink)"></i>Fraud still caught</span></div></div>
          <div class="chart-box" id="curve"></div>
          <div class="slider-row">
            <div class="threshold-line"><strong>Threshold</strong>
              <input class="threshold-input" id="threshold-input" aria-label="Threshold value" ${r.sweepable === false ? "disabled" : ""}>
              <span class="muted">today: ${fmtVal(r.grid[0], r.unit)} · drag, or type ${r.unit === "usd" ? "an amount" : "a value"}</span></div>
            <div class="slider" id="slider" role="slider" tabindex="0" aria-label="Threshold"></div>
          </div>
          <p class="chart-caption">Shaded band around the blue line = range across ${NW} ordering-consistent friction weightings. Fraud caught does not depend on weights.</p>
          <div class="policy"><span>Apply the new threshold to</span>
            <div class="seg" role="group" aria-label="Apply to">
              <button type="button" data-policy="global" aria-pressed="${state.policy === "global"}">All clients</button>
              <button type="button" data-policy="segment" aria-pressed="${state.policy === "segment"}">Established clients above the ${ordinal(D.config.high_friction_percentile)} percentile</button></div></div>
        </section>
        <div class="rule-right" style="display:grid;gap:16px;min-width:0">
          <section class="card" id="compare"></section>
          <section class="card" id="next-step"></section>
        </div>
      </div>
      ${footer()}`;

    wireCommon();
    view.querySelectorAll("[data-policy]").forEach((b) => (b.onclick = () => { state.policy = b.dataset.policy; renderRule(); }));
    const input = document.getElementById("threshold-input");
    input.addEventListener("change", () => {
      const raw = parseFloat(input.value.replace(/[^0-9.\-]/g, ""));
      if (isNaN(raw)) { updateRule(); return; }
      const v = r.unit === "pct" ? raw / 100 : raw;
      let best = 0, bd = Infinity;
      r.grid.forEach((g, i) => { const d = r.axis === "log" ? Math.abs(Math.log(g) - Math.log(Math.max(v, 1e-9))) : Math.abs(g - v); if (d < bd) { bd = d; best = i; } });
      state.idx[idxKey()] = best;
      updateRule();
    });
    drawCurve(r);
    updateRule();
  }

  let curveGeo = null;
  function drawCurve(r) {
    const box = document.getElementById("curve");
    const cv = r.windows[state.win].curve, pts = ptsOf(r);
    const width = Math.max(300, box.clientWidth), H = 300;
    const m = { l: 40, r: 14, t: 26, b: 40 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": `Tradeoff curve for ${r.rule_id}` }, box);
    const iw = width - m.l - m.r, ih = H - m.t - m.b, n = r.grid.length;
    const lo = r.grid[0], hi = r.grid[n - 1];
    const fx = (v) => (r.axis === "log" ? (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) : (v - lo) / (hi - lo || 1));
    const xv = (v) => m.l + fx(v) * iw;
    const xs = (i) => xv(r.grid[i]);
    const ys = (v) => m.t + ih - (Math.max(0, Math.min(100, v)) / 100) * ih;

    for (const t of [0, 25, 50, 75, 100]) {
      el("line", { x1: m.l, x2: m.l + iw, y1: ys(t), y2: ys(t), class: t === 0 ? "axis" : "grid" }, svg);
      txt(svg, m.l - 6, ys(t) + 4, `${t}%`, { "text-anchor": "end" });
    }
    const ticks = r.axis === "log"
      ? logTicks(Math.min(lo, hi), Math.max(lo, hi), r.unit === "usd" ? [1, 2.5, 5] : [1, 1.5, 2, 3, 4, 5, 6, 8])
      : niceTicks(lo, hi, Math.max(3, Math.floor(iw / 80)));
    let lastX = -1e9;
    const shown = [];
    ticks.forEach((t) => { const x = xv(t); if (Math.abs(x - lastX) >= 44) { shown.push(t); lastX = x; } });
    shown.forEach((t) => txt(svg, xv(t), m.t + ih + 16, fmtVal(t, r.unit, true), { "text-anchor": "middle" }));
    txt(svg, m.l, m.t + ih + 34, iw < 420 ? `Threshold${r.axis === "log" ? " · log scale" : ""}`
      : `Threshold: ${r.decision_label.toLowerCase()} when ${r.feature} ${r.op} this value${r.axis === "log" ? " · log scale" : ""}`, { "text-anchor": "start" });

    const fl = cv.flat_index;
    if (fl > 0) {
      el("rect", { x: xs(0), y: m.t, width: xs(fl) - xs(0), height: ih, fill: "var(--free-wash)" }, svg);
      const fx0 = xs(fl) - xs(0) > 150 ? xs(fl) - 8 : xs(fl) + 8, anchor = xs(fl) - xs(0) > 150 ? "end" : "start";
      txt(svg, fx0, m.t + ih - 46, "Free stretch", { class: "t-strong", "text-anchor": anchor });
      txt(svg, fx0, m.t + ih - 31, "Fraud caught is unchanged", { class: "t-ink", "text-anchor": anchor });
      txt(svg, fx0, m.t + ih - 16, `all the way to ${fmtVal(r.grid[fl], r.unit)}`, { class: "t-ink", "text-anchor": anchor });
    }
    if (fl > 0 && fl < n - 1 && cv.base_fraud_caught_rule > 0) {
      el("line", { x1: xs(fl), x2: xs(fl), y1: m.t, y2: m.t + ih, stroke: "var(--ink-2)", "stroke-dasharray": "3 3" }, svg);
      if (iw - (xs(fl) - m.l) > 120) {
        txt(svg, xs(fl) + 8, ys(24), `Past ${fmtVal(r.grid[fl], r.unit)},`, {});
        txt(svg, xs(fl) + 8, ys(24) + 14, "fraud starts", {});
        txt(svg, xs(fl) + 8, ys(24) + 28, "slipping through", {});
      }
    }
    txt(svg, xs(0) + 4, m.t - 10, "Today", { style: "fill:var(--red);font-weight:600" });

    const band = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.pct[2]).toFixed(1)}`).join("")
      + pts.slice().reverse().map((p, j) => `L${xs(n - 1 - j).toFixed(1)},${ys(p.pct[1]).toFixed(1)}`).join("") + "Z";
    el("path", { d: band, fill: "var(--teal-band)" }, svg);
    el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.pct[0]).toFixed(1)}`).join(""), fill: "none", stroke: "var(--teal)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);
    const base = cv.base_fraud_caught_rule;
    const fraudPct = pts.map((p) => (base ? (100 * p.fraud_caught_rule) / base : 100));
    if (base) el("path", { d: fraudPct.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(""), fill: "none", stroke: "var(--ink)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);

    const marker = el("g", { "pointer-events": "none" }, svg);
    curveGeo = { svg, marker, xs, ys, m, ih, iw, width, fraudPct, pts, base, xv, shown };

    const hit = el("rect", { x: m.l - 6, y: m.t, width: iw + 12, height: ih, fill: "transparent", style: "cursor:pointer" }, svg);
    const nearest = (evt) => {
      const b = svg.getBoundingClientRect(), x = ((evt.clientX - b.left) / b.width) * width;
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(xs(i) - x); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    hit.addEventListener("mousemove", (e) => {
      const i = nearest(e), p = pts[i];
      showTip(e, `<b><code>${esc(r.expressions[i])}</code></b><br>Friction removed <b>${pct(p.pct[0])}</b> <span class="t-muted">(${pct(p.pct[1])}–${pct(p.pct[2])})</span><br>
        ${fmtInt(p.interventions_removed)} interventions · ${p.clients_affected} clients<br>Fraud caught by this rule <b>${p.fraud_caught_rule} of ${base}</b><br><span class="t-muted">Click to set the threshold here</span>`);
    });
    hit.addEventListener("mouseleave", hideTip);
    hit.addEventListener("click", (e) => { state.idx[idxKey()] = nearest(e); updateRule(); });

    // slider aligned to the plot's x axis
    const slider = document.getElementById("slider");
    const sw = slider.clientWidth, scale = sw / width;
    slider.innerHTML = "";
    const left = m.l * scale, right = (m.l + iw) * scale;
    const mk = (cls, style) => { const d = document.createElement("div"); d.className = cls; Object.assign(d.style, style); slider.appendChild(d); return d; };
    mk("track", { left: left + "px", width: right - left + "px" });
    const fill = mk("fill", { left: left + "px" });
    shown.forEach((t) => mk("tick", { left: xv(t) * scale + "px" }));
    mk("today", { left: xs(0) * scale - 1 + "px" });
    const thumb = mk("thumb", {});
    curveGeo.slider = { slider, fill, thumb, scale, left };
    const pick = (clientX) => {
      const b = slider.getBoundingClientRect(), x = (clientX - b.left) / scale;
      let best = 0, bd = Infinity;
      for (let i = 0; i < n; i++) { const d = Math.abs(xs(i) - x); if (d < bd) { bd = d; best = i; } }
      if (best !== state.idx[idxKey()]) { state.idx[idxKey()] = best; updateRule(); }
    };
    slider.onpointerdown = (e) => { slider.setPointerCapture(e.pointerId); pick(e.clientX); };
    slider.onpointermove = (e) => { if (slider.hasPointerCapture(e.pointerId)) pick(e.clientX); };
    slider.onkeydown = (e) => {
      const i = currentIdx(r);
      const next = { ArrowRight: i + 1, ArrowUp: i + 1, ArrowLeft: i - 1, ArrowDown: i - 1, Home: 0, End: n - 1 }[e.key];
      if (next == null) return;
      e.preventDefault();
      state.idx[idxKey()] = Math.max(0, Math.min(n - 1, next));
      updateRule();
    };
  }

  function updateRule() {
    const r = ruleById[state.ruleId];
    const rw = r.windows[state.win], cv = rw.curve, pts = ptsOf(r);
    const i = currentIdx(r), p = pts[i], T = r.grid[i], base = cv.base_fraud_caught_rule;
    const g = curveGeo;
    // marker
    g.marker.innerHTML = "";
    const x = g.xs(i);
    el("line", { x1: x, x2: x, y1: g.m.t, y2: g.m.t + g.ih, stroke: "var(--ink)", "stroke-width": 1.5 }, g.marker);
    const callout = (cx, cy, s, color, above) => {
      const t = txt(g.marker, 0, 0, s, { class: "t-ink", style: `font-size:12px;${color ? "fill:" + color : ""}` });
      const w = t.getComputedTextLength() + 12;
      let bx = Math.min(Math.max(cx - w / 2, g.m.l), g.m.l + g.iw - w);
      if (!above && cy + 30 > g.m.t + g.ih) above = true;
      const by = above ? cy - 26 : cy + 8;
      t.setAttribute("x", bx + 6); t.setAttribute("y", by + 13);
      const rect = el("rect", { x: bx, y: by, width: w, height: 18, fill: "#fff", stroke: color || "var(--ink)" });
      g.marker.insertBefore(rect, t);
    };
    if (base) {
      el("circle", { cx: x, cy: g.ys(g.fraudPct[i]), r: 5, fill: "#fff", stroke: "var(--ink)", "stroke-width": 2 }, g.marker);
      callout(x, g.ys(g.fraudPct[i]), `${pct(g.fraudPct[i])} caught`, null, true);
    }
    el("circle", { cx: x, cy: g.ys(p.pct[0]), r: 4.5, fill: "#fff", stroke: "var(--teal)", "stroke-width": 2 }, g.marker);
    if (i > 0) callout(x, g.ys(p.pct[0]), `${pct(p.pct[0])} removed`, "var(--teal)", false);
    // slider
    const s = g.slider;
    s.thumb.style.left = x * s.scale + "px";
    s.fill.style.width = Math.max(0, x * s.scale - s.left) + "px";
    s.slider.setAttribute("aria-valuemin", 0); s.slider.setAttribute("aria-valuemax", r.grid.length - 1);
    s.slider.setAttribute("aria-valuenow", i); s.slider.setAttribute("aria-valuetext", r.expressions[i]);
    document.getElementById("threshold-input").value = fmtVal(T, r.unit);

    // comparison card
    const lost = base - p.fraud_caught_rule;
    const who = state.policy === "segment" ? " for established clients above the high-friction line" : "";
    let statement;
    if (r.shadow) statement = `${r.rule_id} runs in shadow: it logs what it would have done and no client pays for it. Nothing to remove.`;
    else if (i === 0) statement = `At today's setting, ${r.rule_id} interrupts clients ${fmtInt(rw.interventions)} times ${periodPhrase()}, across ${fmtInt(rw.fired.clients)} clients. Move the threshold to see what loosening it buys.`;
    else {
      const head = `${verbFor(r)} ${r.rule_id} from ${fmtVal(r.grid[0], r.unit)} to ${fmtVal(T, r.unit)}${who} removes ${fmtInt(p.interventions_removed)} interventions from ${fmtInt(p.clients_affected)} clients ${periodPhrase()}`;
      statement = lost <= 0 ? `${head}, and catches the same ${base} fraud case${base === 1 ? "" : "s"}.`
        : `${head}, but misses ${lost} of the ${base} fraud cases it catches today.`;
    }
    const ex = rw.example;
    const cmp = document.getElementById("compare");
    cmp.innerHTML = `<div class="card-head"><h2>At ${fmtVal(T, r.unit)}, compared with today</h2><span class="card-note">${periodNote()}</span></div>
      <div class="compare-panel"><div class="label">Friction removed</div>
        <div class="value link-blue">${fmtInt(p.interventions_removed)} fewer intervention${p.interventions_removed === 1 ? "" : "s"}</div>
        <div class="sub">${pct(p.pct[0])} of what this rule causes today (range ${pct(p.pct[1])}–${pct(p.pct[2])})</div></div>
      <div class="compare-panel"><div class="label">Clients no longer interrupted</div>
        <div class="value">${fmtInt(p.clients_affected)} client${p.clients_affected === 1 ? "" : "s"}</div>
        <div class="sub">${p.established_clients_affected} of them in the Established band</div></div>
      <div class="compare-panel"><div class="label">Fraud still caught</div>
        <div class="value">${base ? `${p.fraud_caught_rule} of ${base} cases` : "No fraud caught today"}</div>
        <div class="sub">${!base ? "This rule caught no fraud in this window" : lost <= 0 ? "Every fraud case this rule catches today, it still catches" : `Misses ${lost} case${lost > 1 ? "s" : ""} this rule catches today`}</div></div>
      <p class="statement">${esc(statement)}</p>
      ${ex && i > 0 ? `<p class="example">Example: <a href="#client/${ex.client_id}">${esc(ex.name)}</a> goes from ${ex.baseline} intervention${ex.baseline === 1 ? "" : "s"} to ${pts === cv.points ? p.example_interventions : cv.points[i].example_interventions}</p>` : ""}`;

    // next step
    const ns = document.getElementById("next-step");
    const canTest = !r.shadow && i > 0 && lost <= 0 && p.interventions_removed > 0;
    if (!canTest) {
      ns.innerHTML = `<h2>Next step</h2><p class="why-text">${r.shadow ? "This rule is already a shadow test: its hits show what clients would have paid, without anyone paying." :
        cv.verdict === "none" ? `No relaxation to test: the first step already misses fraud this rule catches. ${r.rule_id} is earning its friction.` :
        lost > 0 ? `This setting misses fraud. Move the threshold back inside the free stretch (up to ${fmtVal(r.grid[cv.flat_index], r.unit)}) to propose a shadow test.` :
        "Pick a looser threshold to propose a shadow test."}</p><p class="card-note">Recommendation only. Nothing on this screen changes a live rule.</p>`;
      return;
    }
    const expr = r.expressions[i];
    ns.innerHTML = `<h2>Next step: test it on live traffic, safely</h2>
      <p class="why-text" style="margin-bottom:0">Run a copy of this rule at ${fmtVal(T, r.unit)} in shadow mode. It sees real traffic and logs what it would have done, but never touches a client. After 30 days, compare it with the live rule.</p>
      <ol class="steps"><li><span class="n">1</span>Clone ${r.rule_id} at ${fmtVal(T, r.unit)}, shadow on</li>
        <li><span class="n">2</span>Run for 30 days alongside the live rule</li><li><span class="n">3</span>Risk Strategy reviews the comparison</li></ol>
      <button class="btn" id="draft">${state.proposalOpen ? "Hide shadow test proposal" : "Draft shadow test proposal"}</button>
      ${state.proposalOpen ? `<div class="proposal"><pre id="proposal-text">${esc(proposalText(r, i, p, expr))}</pre><button class="btn-secondary btn" id="copy">Copy</button> <span id="copy-status" class="muted" aria-live="polite"></span></div>` : ""}
      <p class="card-note" style="margin-top:12px">Recommendation only. Nothing on this screen changes a live rule.</p>`;
    document.getElementById("draft").onclick = () => { state.proposalOpen = !state.proposalOpen; updateRule(); };
    const copy = document.getElementById("copy");
    if (copy) copy.onclick = () => {
      const t = document.getElementById("proposal-text");
      const done = (msg) => (document.getElementById("copy-status").textContent = msg);
      try {
        navigator.clipboard.writeText(t.textContent).then(() => done("Copied"), () => { selectText(t); done("Selected: press Ctrl+C to copy"); });
      } catch (e) { selectText(t); done("Selected: press Ctrl+C to copy"); }
    };
  }
  function selectText(node) { const r = document.createRange(); r.selectNodeContents(node); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  function proposalText(r, i, p, expr) {
    const cv = r.windows[state.win].curve;
    return [
      `Shadow test proposal: ${r.rule_id}`,
      ``,
      `Live rule        ${r.rule_id}: ${r.expression} (${r.decision_label.toLowerCase()}, ${r.checkpoint}, ${r.ruleset_id} order ${r.order})`,
      `Shadow clone     ${r.rule_id}_shadow: ${expr}, shadow_setting = ON, bound after order ${r.order}`,
      `Window           30 days, same traffic as the live rule`,
      `Applies to       ${state.policy === "segment" ? "established clients above the high-friction line" : "all clients"}`,
      ``,
      `Expected on the synthetic population (${W().phrase}):`,
      `  ${fmtInt(p.interventions_removed)} fewer interventions, ${pct(p.pct[0])} of this rule's friction (${pct(p.pct[1])}–${pct(p.pct[2])} across ${NW} weightings)`,
      `  ${fmtInt(p.clients_affected)} clients no longer interrupted, ${p.established_clients_affected} of them established`,
      `  Fraud caught by the rule: ${p.fraud_caught_rule} of ${cv.base_fraud_caught_rule}`,
      ``,
      `Constraint: the clone must not miss any fraud the live rule catches over the window.`,
      `Confirm first: shadow hits land in the same store as live hits, and the clone binds without changing live order.`,
      ``,
      `Prepared by FrictionIQ from synthetic data. Recommendation only; nothing changes a live rule.`,
    ].join("\n");
  }

  // ------------------------------------------------------------------ wiring
  (function wireTopbar() {
    const v = demo.viewer || {};
    document.getElementById("viewer-name").textContent = v.name || "";
    document.getElementById("viewer-role").textContent = v.role || "";
    document.getElementById("viewer-avatar").textContent = (v.name || "").split(" ").map((s) => s[0]).join("").slice(0, 2);
    document.getElementById("client-options").innerHTML = clients.map((c) => `<option value="${esc(c.name)} · ${c.client_id}">`).join("");
    const pop = document.getElementById("search-pop"), btn = document.getElementById("search-toggle"), input = document.getElementById("search-input");
    btn.onclick = () => { pop.hidden = !pop.hidden; btn.setAttribute("aria-expanded", String(!pop.hidden)); if (!pop.hidden) input.focus(); };
    input.addEventListener("change", () => {
      const id = (input.value.match(/[A-Z]{4}-\d{4}/) || [])[0];
      const hit = id ? clientById[id] : clients.find((c) => c.name.toLowerCase() === input.value.trim().toLowerCase());
      if (hit) { pop.hidden = true; input.value = ""; go("#client/" + hit.client_id); }
    });
    document.querySelector('.nav a[data-nav="client"]').onclick = (e) => { e.preventDefault(); go("#client/" + state.clientId); };
    document.querySelector('.nav a[data-nav="rule"]').onclick = (e) => { e.preventDefault(); go("#rule/" + state.ruleId); };
  })();
  window.addEventListener("hashchange", route);
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  route();
})();
