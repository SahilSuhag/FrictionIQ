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
  const EST = D.config.good_client.established, DEV = D.config.good_client.developing;

  const state = {
    view: "home",
    win: "30d",
    clientId: null,   // chosen on first visit: the good client carrying the most friction
    ruleId: ruleById[demo.hero_rule] ? demo.hero_rule : rules[0].rule_id,
    idx: {},
    policy: "global",
    showAllHeavy: false,
    showUncredited: false,
    proposalOpen: false,
    filters: { band: [], type: [], region: [], industry: [] },
    cut: { type: "", region: "" },    // Home: cut by client type and region
    query: "",
    openGrades: ["F", "E"],
    paneOpen: window.innerWidth > 980,
    ruleFilters: { cp: [], type: [], region: [] },
    ruleQuery: "",
    rulePaneOpen: window.innerWidth > 980,
    ruleFiltersOpen: true,
    rulePaneScroll: 0,
    filtersOpen: true,
    paneScroll: 0,
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
  const fmtUsd = (v) => {
    if (v >= 1e6) return "$" + parseFloat((v / 1e6).toFixed(2)) + "M";
    if (v >= 1e4) return "$" + Math.round(v / 1e3) + "k";
    return "$" + fmtInt(v);
  };
  const fmt1 = (v) => (v >= 10 ? fmtInt(v) : (+v.toFixed(1)).toString());
  const shortName = (c) => { const w = c.name.split(" "); return w[0] === "The" && w[1] ? w[1] : w[0]; };
  const gradeColor = (g) => D.grades.colors[g];
  const gradeWord = (g) => ({ A: "Minimal friction", B: "Light friction", C: "Moderate friction", D: "High friction", E: "Heavy friction", F: "Heavy friction" }[g]);
  // What we know about a client, from evidence the rules didn't create. Internal band ids stay
  // limited / developing / established; confirmed fraud is shown as its own group.
  const bandLabel = (b) => ({ established: "Tenured", developing: "Partly proven", limited: "New", fraud: "Confirmed fraud" }[b]);
  const bandOf = (c) => (c.disqualified ? "fraud" : c.band);
  const TYPE_LABELS = { ENTERPRISE: "Enterprise", MID_MARKET: "Middle Market", SMB: "SMB", ISV: "ISV", SCOTIA: "Scotia" };
  const REGIONS = ["CA", "US", "EMEA", "APAC"];
  // Rules by readable name; checkpoints in words, with the card channel where there is one.
  const rn = (id) => (ruleById[id] && ruleById[id].name) || String(id).replace(/_/g, " ");
  const CHECKPOINTS = [
    ["CLIENT_ONBOARDING", "Client onboarding"], ["PRODUCT_ONBOARDING", "Product onboarding"],
    ["PRE_AUTH_CP", "Pre-auth, card present"], ["PRE_AUTH_CNP", "Pre-auth, card not present"],
    ["PRE_CAPTURE_CNP", "Pre-capture, card not present"], ["PRE_CAPTURE_CP", "Pre-capture, card present"],
    ["PRE_CAPTURE_ANY", "Pre-capture, both channels"],
    ["PRE_SETTLEMENT", "Pre-settlement"], ["PRE_PAYOUT", "Pre-payout"],
  ];
  const CP_LABEL = Object.fromEntries(CHECKPOINTS);
  const cpKey = (r) => r.checkpoint === "CLIENT_BOARDING" ? "CLIENT_ONBOARDING"
    : r.checkpoint === "PRE_CAPTURE" ? ({ CARD_PRESENT: "PRE_CAPTURE_CP", CARD_NOT_PRESENT: "PRE_CAPTURE_CNP" }[r.channel] || "PRE_CAPTURE_ANY") : r.checkpoint;
  const cpOf = (r) => CP_LABEL[cpKey(r)] || r.checkpoint;
  const hitCp = (h) => (ruleById[h.r] ? cpOf(ruleById[h.r]) : h.c);
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
  function showTipAt(node, html) {
    const r = node.getBoundingClientRect();
    showTip({ clientX: r.right, clientY: r.bottom }, html);
  }

  // Short explanations behind the small "i" buttons. The full worked calculation is on
  // the client page.
  const WT = D.config.decision_weights;
  const cutoffText = () => GRADES.map((g, i) => (i < GRADES.length - 1 ? `${g} under ${D.grades.cutoffs[GRADES[i + 1]][0]}` : `${g} ${D.grades.cutoffs[g][0]}+`)).join(" · ");
  const INFO = {
    score: () => `<b>How the friction score works</b><br>Every intervention a client received adds points: deny ${WT.DENY}, hold ${WT.HOLD} (scaled up the longer the hold lasted), settlement limit ${WT.SETTLEMENT_LIMIT}. Points halve every ${D.config.half_life_days} days, so recent friction counts most. Only the rule whose decision prevailed scores; shadow hits and outages add nothing.<br><span class="t-muted">Grades: ${cutoffText()}. Weights ${D.meta.weights_version} are placeholders, so scores carry a range. Open any client to see the full calculation.</span>`,
    ledger: () => `<b>Measured, not weighted</b><br>Counts, dollars and hours come straight from the logged rule hits: which payouts were denied or held, how long each hold lasted, how many manual reviews they created. No weights are involved.`,
    nofraud: () => `<b>Found no fraud</b><br>The event the rule stopped was never confirmed as fraud. These are the interruptions legitimate business paid for.`,
    review: () => `<b>Ops review time</b><br>Every hold becomes a manual review. This assumes 30 minutes each; the PRD's taxonomy puts it at 20–40.`,
    removed: () => `<b>Friction removed</b><br>The fall in friction score, summed over every client, as a share of what this rule causes today. It is a band because the weights are placeholders: ${NW} weightings with the same ordering were tried.`,
    perfraud: () => `<b>Ratio: interventions per fraud case</b><br>The rule's interventions divided by the fraud cases it caught. 20 : 1 means it intervened 20 times for each fraud case it caught, so most of its interventions landed on good clients. The higher the ratio, the more room there may be to tune the rule. Its <i>Room to relax</i> tag says whether it can be loosened without missing fraud.`,
    actions: () => `<b>Account-level actions</b><br>Actions on the client's account rather than on one payment, from the payment API's actions schema: a reserve on daily sales, a restricted capability (keyed-in, terminal, new products), an account review, or a block. They last days or weeks, so they can weigh more than any single intervention. They are listed here and on each client's page, but not yet counted in the friction score.`,
    found: () => { const P = D.portfolio[state.win], f = P.interventions - P.ledger.n; return `<b>Interventions that found fraud</b><br>Of the ${fmtInt(P.interventions)} interventions in the ${W().phrase}, ${fmtInt(f)} stopped a confirmed fraud case (${((100 * f) / Math.max(P.interventions, 1)).toFixed(1)}%): about 1 in ${Math.round(P.interventions / Math.max(f, 1))}. The other ${fmtInt(P.ledger.n)} interrupted clients whose activity was legitimate. The higher the second number, the more good clients the rules interrupt for each fraud case they catch.`; },
    hold: () => `<b>Payout hold time</b><br>How long payouts sat on hold for manual review, added up across every held payout. A held payout is money the client has already earned but cannot use until a reviewer releases it. Shown in days.`,
    history: () => `<b>How clients are grouped</b><br>By evidence the fraud rules did not create.<br><b>Tenured</b>: ${EST.min_tenure_months}+ months with us, ${Math.round(100 * EST.min_clear_rate)}%+ of reviews cleared, steady payouts, few disputes.<br><b>Partly proven</b>: ${DEV.min_tenure_months}+ months, ${Math.round(100 * DEV.min_clear_rate)}%+ of reviews cleared, disputes within limits, but not yet long or steady enough to count as tenured.<br><b>New</b>: anything less, mostly clients with us under ${DEV.min_tenure_months} months.<br>Any confirmed fraud takes a client out of all three.`,
    txn: () => `<b>Transactions</b><br>The money movements the rules screened in this window: card payments captured, settlements and payouts, with their total value. Boarding checks are not transactions.`,
    fraudcases: () => `<b>Fraud cases caught</b><br>Confirmed fraud cases this rule fired on. One case can trip more than one rule, so this column adds up to more than the fraud saved total.`,
    saved: () => `<b>Fraud saved</b><br>Confirmed fraud that a live rule denied or held before the money left, in dollars (the payout, settlement or capture it was on), across every client. Cases with no amount, such as boarding fraud, count as cases but add no dollars.`,
    lost: () => `<b>Fraud loss</b><br>Confirmed fraud that no live rule stopped, in dollars (the payout, settlement or capture it was on), across every client. Money recovered afterwards is shown under it: net loss is the loss less what was recovered. Fraud saved and fraud loss together make up all confirmed fraud in the window.`,
    safe: () => { const P = D.portfolio[state.win]; return `<b>Safe to remove</b><br>A cautious estimate. The ${P.free_to_remove_rules} rules with room to relax move only to their recommended setting, not the far end of their safe range, and only for good clients carrying heavy friction: tenured clients above the ${D.config.high_friction_percentile}th percentile of friction (${fmtInt(P.eligible_clients)} in this window). Every fraud case caught today is still caught, and every other client keeps today's rules.`; },
    relax: () => { const fs = D.config.free_stretch; return `<b>Room to relax</b><br>How far a rule's threshold can be loosened without missing any fraud it catches today.<br><b>Safe to relax to …</b> Loosening it that far catches the same fraud and removes at least ${fs.free_pct}% of the rule's friction (under 95% of the weightings tried).<br><b>Little to gain</b> It can be loosened a little without missing fraud, but that removes less than ${fs.free_pct}% of its friction.<br><b>Keep as is</b> The first step looser already misses fraud: the rule earns its friction.`; },
  };
  const info = (key, label) => `<button type="button" class="info" data-info="${key}" aria-label="${label || "How this is calculated"}">i</button>`;
  function wireInfo(root) {
    root.querySelectorAll("[data-info]").forEach((b) => {
      const html = () => INFO[b.dataset.info]();
      b.addEventListener("mouseenter", () => showTipAt(b, html()));
      b.addEventListener("focus", () => showTipAt(b, html()));
      b.addEventListener("mouseleave", hideTip);
      b.addEventListener("blur", hideTip);
      b.addEventListener("click", (e) => { e.preventDefault(); showTipAt(b, html()); });
    });
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
  // Navigation routes directly and records the hash where the frame allows it, so it
  // also works inside sandboxed viewers that block hash changes.
  let routed = null;
  function go(hash) {
    try { if (location.hash !== hash) history.pushState(null, "", hash); } catch (e) { /* sandboxed frame */ }
    route(hash);
  }
  function route(hash) {
    routed = hash = hash || location.hash;
    const [v, arg] = hash.replace(/^#/, "").split("/");
    if (v === "client") {
      if (arg && clientById[arg]) state.clientId = arg;
      else if (!state.clientId) state.clientId = defaultClient();
      state.view = "client";
    }
    else if (v === "rule") {
      if (arg && ruleById[arg] && arg !== state.ruleId) { state.ruleId = arg; state.proposalOpen = false; }
      state.view = "rule";
    } else state.view = "home";
    if (state.view !== "home") state.cell = null;
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
    wireInfo(view);
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
    if (v.count / w.n >= 0.75) return `${v.count} of ${w.n} from ${rn(top)}`;
    if (v.score / w.score[0] >= 0.5 || e.length === 1) return `Mostly ${rn(top)}`;
    return `${rn(top)} and ${rn(e[1][0])}`;
  }
  const heavyClients = () => clients.filter((c) => c.windows[state.win].heavy)
    .sort((a, b) => b.windows[state.win].score[0] - a.windows[state.win].score[0]);
  const rulesByVolume = () => rules.slice().sort((a, b) => b.windows[state.win].interventions - a.windows[state.win].interventions);

  // Home can be cut by client type and region. Every figure is then summed from the
  // per-client results, so a cut and the whole portfolio are counted the same way.
  const PAYOUT_Q = ["PAYOUT", "INSTANT_PAYOUT", "BULK_PAYOUT"];
  const REGION_LIST = ["CA", "US", "EMEA", "APAC"];
  const inCut = (c) => (!state.cut.type || c.type === state.cut.type) && (!state.cut.region || c.region === state.cut.region);
  const cutOn = () => !!(state.cut.type || state.cut.region);
  const cutClients = () => clients.filter(inCut);
  const cutKey = () => `${state.cut.type}|${state.cut.region}`;
  const cutLabel = () => [state.cut.type && TYPE_LABELS[state.cut.type], state.cut.region].filter(Boolean).join(" · ");
  function agg(list) {
    const a = { n: 0, prevN: 0, nf: 0, nfPrev: 0, fr: [0, 0, 0, 0, 0], frPrev: [0, 0, 0, 0, 0], hasPrev: false, safe: 0,
      safeUsd: 0, safeClients: 0, txn: 0, interrupted: 0 };
    list.forEach((c) => {
      const w = c.windows[state.win];
      a.n += w.n; a.nf += w.nf; a.safe += w.safe; a.safeUsd += w.safe_usd; a.safeClients += w.safe > 0 ? 1 : 0;
      a.txn += w.txn[0]; a.interrupted += w.n > 0 ? 1 : 0;
      w.fr.forEach((v, i) => (a.fr[i] += v));
      if (w.prev_n != null) { a.hasPrev = true; a.prevN += w.prev_n; a.nfPrev += w.nf_prev; w.fr_prev.forEach((v, i) => (a.frPrev[i] += v)); }
    });
    return a;
  }

  // Monthly series over the last 12 months, rebuilt from the hits of the clients in the cut. The
  // latest month reproduces the headline totals exactly.
  const SERIES = {};
  function series() {
    if (SERIES[cutKey()]) return SERIES[cutKey()];
    const B = D.trend.buckets, z = () => B.map(() => 0);
    const out = { ints: z(), found: z(), saved: z(), legit: z(), legitEst: z(), byRule: B.map(() => ({})) };
    cutClients().forEach((c) => D.timelines[c.client_id].forEach((h) => {
      if (h.a !== "P") return;
      const i = B.findIndex((b) => h.t >= b.start && h.t < b.end);
      if (i < 0) return;
      out.ints[i]++;
      if (h.x) { out.found[i]++; out.saved[i] += h.$ || 0; return; }
      out.legit[i]++;
      if (c.band === "established") out.legitEst[i]++;
      out.byRule[i][h.r] = (out.byRule[i][h.r] || 0) + 1;
    }));
    out.rate = out.ints.map((n, i) => out.found[i] / Math.max(n, 1));
    return (SERIES[cutKey()] = out);
  }
  // the 12 monthly buckets behind the key finding, for the whole portfolio or the cut
  const trendBuckets = () => (cutOn()
    ? D.trend.buckets.map((b, i) => { const S = series(); return { start: b.start, end: b.end, n: S.legit[i], established: S.legitEst[i], by_rule: S.byRule[i] }; })
    : D.trend.buckets);
  let sparkN = 0;
  function spark(vals, color) {
    const W = 120, H = 34, max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1;
    const x = (i) => 1 + (i / (vals.length - 1)) * (W - 2), y = (v) => H - 2 - ((v - min) / span) * (H - 6);
    const line = vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const id = `spark${++sparkN}`;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="${line} L${x(vals.length - 1)},${H} L${x(0)},${H} Z" fill="url(#${id})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>`;
  }
  const ICON = {
    ints: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M12 8v5M12 16h.01"/>',
    found: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12h.01"/>',
    safe: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
    saved: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
    lost: '<path d="M12 4 2.8 20h18.4z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  };
  const splitUnit = (v) => { const m = String(v).match(/^(.*?)([kM])$/); return m ? [m[1], m[2]] : [String(v), ""]; };
  const initials = (name) => name.split(/\s+/).filter((w) => /[A-Za-z]/.test(w[0])).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  function cutControl() {
    const opt = (v, l, cur) => `<option value="${v}"${v === cur ? " selected" : ""}>${l}</option>`;
    return `<div class="cut-controls">
      <div class="cut"><label class="window-label" for="cut-type">Client type</label>
        <select id="cut-type" data-cut="type">${opt("", "All types", state.cut.type)}${D.client_types.map((t) => opt(t, TYPE_LABELS[t] || t, state.cut.type)).join("")}</select></div>
      <div class="cut"><label class="window-label" for="cut-region">Region</label>
        <select id="cut-region" data-cut="region">${opt("", "All regions", state.cut.region)}${REGION_LIST.map((r) => opt(r, r, state.cut.region)).join("")}</select></div></div>`;
  }

  function actionShort(a) {
    if (a.type === "RESERVE") return `Reserve ${a.reserve_pct}% up to ${fmtUsd(a.reserve_cap_usd)}`;
    if (a.type === "CAPABILITY_RESTRICTION") return `${({ KEYED_IN: "Keyed-in", TERMINAL: "Terminal", NEW_PRODUCT: "New product" })[a.detail] || "Capability"} restricted`;
    if (a.type === "ACCOUNT_REVIEW") return "Account under review";
    if (a.type === "BLOCK") return "Blocked";
    if (a.type === "RECOVERY") return a.recovered_usd ? `Recovered ${fmtUsd(a.recovered_usd)}` : "Recovery attempted, nothing recovered";
    return a.type;
  }

  function renderHome() {
    const P = D.portfolio[state.win];
    const list = cutClients(), A = agg(list);
    const heavy = heavyClients().filter(inCut);
    const look = state.showAllHeavy ? heavy : heavy.slice(0, 5);
    // red when the change is worse for clients or the business, teal when it is better
    const delta = (now, before, upIsWorse = true) => {
      if (before == null || !before) return "";
      const d = (100 * (now - before)) / before;
      const tone = Math.abs(d) < 0.5 ? "" : (d > 0) === upIsWorse ? " worse" : " better";
      return `<span class="delta${tone}" title="vs previous ${W().label}">${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))}</span>`;
    };
    const share = A.safe / Math.max(A.n, 1);
    const SR = series();
    // compact stat tiles: label, value with a 12-month trend (or a meter) beside it, change, one note
    const tile = (o) => { const [v, u] = o.unit ? [o.value, o.unit] : splitUnit(o.value); return `<div class="tile${o.cls ? " " + o.cls : ""}">
      <div class="t-head"><span class="t-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[o.icon]}</svg></span><span class="t-label">${o.label}</span>${o.extra || ""}</div>
      <div class="t-main"><div class="t-value">${o.html || `${v}<span class="t-unit">${u}</span>`}</div>${o.viz ? `<div class="t-viz">${o.viz}</div>` : ""}</div>
      <div class="t-foot">${o.change ? `${o.change}<span class="t-vs">vs prev. ${W().days} days</span>` : `<span class="t-vs">${o.fallback}</span>`}</div>
      ${o.note ? `<div class="t-note">${o.note}</div>` : ""}</div>`; };
    const trend = (vals, color) => `${spark(vals, color)}<div class="t-cap">12 months</div>`;
    const miniMeter = (frac, cls) => `<div class="meter ${cls || ""}" role="img" aria-label="${pct(100 * frac)}"><span style="width:${(100 * Math.min(1, frac)).toFixed(1)}%"></span></div>`;
    // interventions that found fraud, as "1 in N": the rest interrupted good clients
    const oneIn = (f, n) => Math.round(n / Math.max(f, 1));
    const foundChange = A.hasPrev && A.nfPrev && A.nf ? (() => {
      const now = oneIn(A.nf, A.n), was = oneIn(A.nfPrev, A.prevN);
      return now === was ? "" : `<span class="delta ${now > was ? "worse" : "better"}">${now > was ? "▼" : "▲"} from 1 in ${was}</span>`;
    })() : "";
    const [caught, total, savedUsd, totalUsd, recUsd] = A.fr, lostUsd = totalUsd - savedUsd;
    const FP = A.hasPrev ? A.frPrev : null;
    const perK = A.txn ? (1000 * A.n) / A.txn : 0;
    const fraudFallback = !A.hasPrev ? "no earlier period in the data" : total || (FP && FP[1]) ? "same as the previous period" : "no fraud in either period";

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Client friction across the portfolio</h1>
          <p class="lead">${cutOn() ? `Showing <b>${esc(cutLabel())}</b> clients: ${fmtInt(list.length)} of ${fmtInt(clients.length)}. <button class="link-btn" id="cut-clear">Show all clients</button>`
            : "How often our fraud rules interrupt clients, which rules do it, and which good clients carry the most."}</p></div>
        <div class="head-controls">${cutControl()}${windowControl()}</div>
      </div>
      <div class="tiles">
        <div class="tile hero">
          <div class="t-head"><span class="t-icon"><svg viewBox="0 0 24 24" aria-hidden="true">${ICON.safe}</svg></span><span class="t-label">Safe to remove</span>${info("safe", "What counts as safe")}</div>
          <div class="h-main"><div class="h-value">${(100 * share).toFixed(1)}<span>%</span></div>
            <div class="h-text">of interventions can be removed without letting any fraud through</div></div>
          ${miniMeter(share, "light")}
          <div class="h-note">${fmtInt(A.safe)} of ${fmtInt(A.n)} interventions · ${fmtInt(A.safeClients)} good clients · ${fmtUsd(A.safeUsd)} of payouts</div>
        </div>
        ${tile({ icon: "ints", label: "Interventions", value: fmtInt(A.n), change: delta(A.n, A.hasPrev ? A.prevN : null), fallback: "no earlier period in the data", viz: trend(SR.ints, "var(--accent)"), note: `${fmt1(perK)} per 1,000 transactions · ${fmtInt(A.interrupted)} clients` })}
        ${tile({ icon: "found", label: "Found fraud", extra: info("found", "What this means"), html: A.nf ? `1<span class="t-unit t-in">in</span>${fmtInt(oneIn(A.nf, A.n))}` : "none", change: foundChange, fallback: A.hasPrev ? "no change" : "no earlier period in the data", viz: trend(SR.rate, "var(--accent)"), note: `${((100 * A.nf) / Math.max(A.n, 1)).toFixed(1)}% of interventions` })}
        ${tile({ icon: "saved", cls: "good", label: "Fraud saved", extra: info("saved", "What counts as fraud saved"), value: fmtUsd(savedUsd), change: delta(savedUsd, FP && FP[2], false), fallback: fraudFallback, viz: trend(SR.saved, "var(--good)"), note: `${fmtInt(caught)} of ${fmtInt(total)} cases stopped` })}
        ${tile({ icon: "lost", cls: "fraud", label: "Fraud loss", extra: info("lost", "What counts as fraud loss"), value: fmtUsd(lostUsd), change: delta(lostUsd, FP && FP[3] - FP[2]), fallback: fraudFallback, note: recUsd ? `${fmtUsd(recUsd)} recovered · net ${fmtUsd(lostUsd - recUsd)}` : `${fmtInt(total - caught)} of ${fmtInt(total)} cases got through` })}
      </div>
      <div class="home-top">${bannerSection()}</div>
      ${ruleTable(P)}
      <div class="home-grid">
        ${gridSection(P)}
        <section class="card look-card">
          <div class="card-head"><h2>Good clients to look at first</h2>${heavy.length > 5 ? `<button class="see-all head-link" id="see-all">${state.showAllHeavy ? "Top 5" : `See all ${heavy.length}`}</button>` : ""}</div>
          <div class="card-sub">Tenured clients with heavy friction (the "Look here" segment), heaviest first</div>
          <div class="look-list">${look.map((c) => {
            const w = c.windows[state.win];
            return `<div class="look-row">
              <span class="grade-badge" style="background:${gradeColor(w.grade)}" aria-label="Grade ${w.grade}">${w.grade}</span>
              <div style="min-width:0"><a href="#client/${c.client_id}" class="name">${esc(c.name)}</a><div class="cause">${esc(causeText(c))}</div></div>
              <span>${w.incident.items.length ? '<span class="tag tag-incident">Incident</span>' : ""}</span>
              <span class="score" title="Friction score">${Math.round(w.score[0])}</span></div>`;
          }).join("") || '<p class="muted" style="padding:10px 0">No tenured clients carry heavy friction in this window.</p>'}</div>
        </section>
      </div>
      <div id="cell-list" class="cell-list" role="region" aria-live="polite"></div>
      <footer class="footer">
        <div>Synthetic data · seed ${D.meta.seed} · weights ${D.meta.weights_version} are placeholders · outages tracked separately (${P.incidents.count} this window, ${P.incidents.clients_affected} clients), never added to scores ·
          <button class="link-btn" id="method-toggle" aria-expanded="${!!state.showMethod}">Method and success metrics</button></div>
        ${state.showMethod ? methodSection() : ""}
      </footer>`;

    wireCommon();
    const sa = document.getElementById("see-all");
    if (sa) sa.onclick = () => { state.showAllHeavy = !state.showAllHeavy; renderHome(); };
    const sr = document.getElementById("see-all-rules");
    if (sr) sr.onclick = () => { state.showAllRules = !state.showAllRules; renderHome(); };
    document.getElementById("method-toggle").onclick = () => { state.showMethod = !state.showMethod; renderHome(); };
    view.querySelectorAll("[data-cut]").forEach((sel) => (sel.onchange = () => { state.cut[sel.dataset.cut] = sel.value; state.cell = null; renderHome(); }));
    const cc = document.getElementById("cut-clear");
    if (cc) cc.onclick = () => { state.cut = { type: "", region: "" }; state.cell = null; renderHome(); };
    wireGrid();
    drawTrend(document.getElementById("trend-chart"));
  }

  function bannerSection() {
    const t = trendFacts();
    if (!t.avg && !t.last.n) return `<section class="card banner"><div class="kf-text"><div><div class="eyebrow">Key finding</div>
      <h3>No friction on these clients in 12 months</h3><p>No intervention that found no fraud, for ${esc(cutLabel())} clients.</p></div></div></section>`;
    const ratio = t.avg ? t.last.n / t.avg : 2;
    const head = ratio >= 2 ? `Friction more than doubled${t.launch ? ` after ${rn(t.rise)} went live` : ""}`
      : `Friction ${ratio >= 1 ? "rose" : "fell"} ${pct(Math.abs(100 * (ratio - 1)))} in the last 30 days`;
    return `<section class="card banner">
      <div class="kf-text"><div><div class="eyebrow">Key finding</div><h3>${head}</h3>
        <p>${cutOn() ? `For ${esc(cutLabel())} clients, interventions` : "Interventions"} that found no fraud averaged ${fmtInt(t.avg)} a month, then reached ${fmtInt(t.last.n)} in the last 30 days.
        ${rn(t.rise)}${t.launch ? `, live since ${dayLabel(t.launch.date + "T00:00:00Z")},` : ""} accounts for ${fmtInt(t.last.by_rule[t.rise] || 0)} of them.</p>
        </div><button class="btn btn-soft" data-rule="${t.rise}">Open ${rn(t.rise)} →</button></div>
      <div class="chart-box" id="trend-chart"></div>
    </section>`;
  }

  // per-rule figures for the clients in the cut, from their hits
  function ruleStatsCut() {
    const start = W().start, out = {};
    cutClients().forEach((c) => D.timelines[c.client_id].forEach((h) => {
      if (h.t < start) return;
      const s = out[h.r] || (out[h.r] = { n: 0, fraud: 0, usd: 0 });
      if (h.a === "P") { s.n++; if (!h.x && PAYOUT_Q.includes(h.q) && (h.d === "HOLD" || h.d === "DENY")) s.usd += h.$ || 0; }
      if (h.x && h.a !== "O") s.fraud++;
    }));
    return out;
  }
  function ruleTable(P) {
    const stats = cutOn() ? ruleStatsCut()
      : Object.fromEntries(P.rules.map((r) => [r.rule_id, { fraud: r.fraud, usd: r.usd }]));
    const nOf = (r) => (cutOn() ? (stats[r.rule_id] || {}).n || 0 : r.windows[state.win].interventions);
    const all = rules.filter((r) => !r.shadow && nOf(r) > 0).sort((a, b) => nOf(b) - nOf(a));
    const rows = state.showAllRules ? all : all.slice(0, 5);
    const fraudOf = (r) => (stats[r.rule_id] || {}).fraud || 0;
    const per = (r) => (fraudOf(r) ? nOf(r) / fraudOf(r) : null);
    const usdOf = (r) => (stats[r.rule_id] || {}).usd || 0;
    const maxUsd = Math.max(...rows.map(usdOf)), maxPer = Math.max(...rows.map((r) => per(r) || 0));
    const maxN = Math.max(...rows.map(nOf), 1);
    if (!rows.length) return `<section class="card"><div class="card-head"><h2>Rules causing the most friction</h2></div><p class="muted">No rule interventions for these clients in the ${W().phrase}.</p></section>`;
    return `<section class="card rules-card">
      <div class="card-head"><div><h2>Rules causing the most friction</h2><div class="card-sub">${state.showAllRules || all.length <= 5 ? "All rules" : "Top 5"} by interventions · ${W().phrase}${cutOn() ? ` · ${esc(cutLabel())} clients` : ""} · highlighted: the highest ratio, where there may be most room to tune, and the costliest in dollars</div></div>
        ${all.length > 5 ? `<button class="see-all head-link" id="see-all-rules">${state.showAllRules ? "Top 5" : `See all ${all.length}`}</button>` : ""}</div>
      <div class="table-scroll"><table class="rule-table"><thead><tr><th>Rule</th><th class="c">Interventions</th>
        <th class="c">Fraud cases caught ${info("fraudcases")}</th><th class="c">Ratio ${info("perfraud")}</th>
        <th class="c">Payouts held or denied</th><th>Room to relax ${info("relax")}</th></tr></thead><tbody>
      ${rows.map((r, i) => {
        const rw = r.windows[state.win], u = usdOf(r), pr = per(r), n = nOf(r);
        return `<tr><td><button class="rname${i === 0 ? " top" : ""}" data-rule="${r.rule_id}">${esc(rn(r.rule_id))}</button></td>
          <td class="c"><div class="inline-bar"><span class="track"><span style="width:${(100 * n) / maxN}%" class="${i === 0 ? "top" : ""}"></span></span><b class="num">${fmtInt(n)}</b></div></td>
          <td class="c">${fmtInt(fraudOf(r))}</td>
          <td class="c">${pr == null ? '<span class="muted">no fraud caught</span>' : `<span class="${pr === maxPer ? "hl-cell" : ""}">${fmt1(pr)}&nbsp;:&nbsp;1</span>`}</td>
          <td class="c">${u ? `<span class="${u === maxUsd ? "hl-cell" : ""}">${fmtUsd(u)}</span>` : '<span class="muted">—</span>'}</td>
          <td><span class="tag ${tagFor(rw.curve)}">${esc(rw.curve.label)}</span></td></tr>`;
      }).join("")}</tbody></table></div>
    </section>`;
  }

  function trendFacts() {
    const B = trendBuckets(), last = B[B.length - 1], prior = B.slice(0, -1);
    const avg = prior.reduce((s, b) => s + b.n, 0) / prior.length;
    const rise = rules.map((r) => [r.rule_id, (last.by_rule[r.rule_id] || 0) - prior.reduce((s, b) => s + (b.by_rule[r.rule_id] || 0), 0) / prior.length])
      .sort((a, b) => b[1] - a[1])[0][0];
    return { B, last, avg, rise, launch: D.trend.launches.find((l) => l.rule_id === rise) };
  }

  function drawTrend(box) {
    if (!box) return;
    const t = trendFacts();
    const width = Math.max(240, box.clientWidth), H = width > 480 ? 230 : 170, m = { l: 4, r: 4, t: 28, b: 20 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": "Interventions that found no fraud, by month, last 12 months" }, box);
    const n = t.B.length, bw = (width - m.l - m.r) / n, max = Math.max(...t.B.map((b) => b.n)) * 1.15;
    svg.insertAdjacentHTML("afterbegin", '<defs><linearGradient id="trendHi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6b69d6"/><stop offset="1" stop-color="var(--accent)"/></linearGradient></defs>');
    const pill = (x, y, text, dark) => {
      const t0 = txt(svg, x, y, text, { "text-anchor": "middle", style: `font-size:11px;font-weight:600;fill:${dark ? "#fff" : "var(--ink-2)"}` });
      const b = t0.getBBox();
      const r = el("rect", { x: b.x - 7, y: b.y - 3, width: b.width + 14, height: b.height + 6, rx: (b.height + 6) / 2, fill: dark ? "var(--navy)" : "var(--surface)", stroke: dark ? "none" : "var(--border-strong)" });
      svg.insertBefore(r, t0);
    };
    const ys = (v) => m.t + (H - m.t - m.b) * (1 - v / max);
    t.B.forEach((b, i) => {
      const x = m.l + i * bw + 2, last = i === n - 1;
      const bar = el("path", { d: `M${x},${ys(0)} V${ys(b.n) + 3} q0,-3 3,-3 h${bw - 10} q3,0 3,3 V${ys(0)} Z`, fill: last ? "url(#trendHi)" : "var(--lilac)", "fill-opacity": last ? 1 : 0.75 }, svg);
      bindTip(bar, `<b>${dayLabel(b.start)} – ${dayLabel(b.end)}</b><br>${fmtInt(b.n)} interventions that found no fraud<br>${fmtInt(b.established)} on tenured clients`);
      if (last) pill(x + (bw - 4) / 2, ys(b.n) - 9, fmtInt(b.n), true);
      if (i === 0 || last || i === Math.floor(n / 2)) txt(svg, x + (bw - 4) / 2, H - 4, MONTHS[dt(b.end).getUTCMonth()], { "text-anchor": "middle" });
    });
    el("line", { x1: m.l, x2: width - m.r - bw, y1: ys(t.avg), y2: ys(t.avg), stroke: "var(--ink-2)", "stroke-dasharray": "3 3" }, svg);
    pill(m.l + 70, ys(t.avg) - 9, `11-month avg ${fmtInt(t.avg)}`, false);
    el("line", { x1: m.l, x2: width - m.r, y1: ys(0), y2: ys(0), class: "axis" }, svg);
  }

  // Who carries the friction: clients counted by friction grade (rows) and good-client band
  // (columns). Every number opens the list of clients behind it.
  const BANDS = ["limited", "developing", "established"];
  // Grid cells are "level|band". Clients with confirmed fraud sit outside the grid ("|fraud").
  const LEVELS = [
    { key: "heavy", label: "Heavy", grades: HEAVY },
    { key: "moderate", label: "Moderate", grades: GRADES.filter((g, i) => i >= 2 && !HEAVY.includes(g)) },
    { key: "light", label: "Light", grades: GRADES.slice(0, 2) },
  ];
  const levelOf = (g) => LEVELS.find((l) => l.grades.includes(g)).key;
  const levelLabel = (k) => LEVELS.find((l) => l.key === k).label;
  const inCell = (cell) => {
    const [l, b] = cell.split("|");
    return cutClients().filter((c) => (b === "fraud" ? c.disqualified : !c.disqualified && (!b || c.band === b))
      && (!l || levelOf(c.windows[state.win].grade) === l));
  };
  const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
  // Who carries the friction: for each group of clients (by how much evidence we have that they
  // are good), the share at each friction level, and interventions per client. Friction should
  // fall as the evidence grows; the chart shows whether it does.
  function gridSection(P) {
    const sum = (list) => list.reduce((t, c) => t + c.windows[state.win].n, 0);
    const per = (list) => (list.length ? sum(list) / list.length : 0);
    const allInts = sum(cutClients());
    const HOT = "heavy|established";
    const groups = [
      { b: "limited", name: "New", sub: `under ${DEV.min_tenure_months} months, or a weaker record` },
      { b: "developing", name: "Partly proven", sub: `${DEV.min_tenure_months}+ months, mostly clean` },
      { b: "established", name: "Tenured", sub: `${EST.min_tenure_months}+ months, clean and steady` },
    ];
    const bar = (b, muted) => {
      const all = inCell(`|${b}`), n = all.length;
      if (!n) return '<div class="fb-bar empty">no clients</div>';
      return `<div class="fb-bar${muted ? " muted" : ""}">${LEVELS.map((l) => {
        const cell = `${l.key}|${b}`, list = inCell(cell), k = list.length, share = (100 * k) / n;
        if (!k) return "";
        const hot = cell === HOT;
        const label = share >= 9 ? `${fmtInt(k)}<span> · ${pct(share)}</span>` : share >= 5 ? fmtInt(k) : "";
        return `<button type="button" class="fb-seg lvl-${l.key}${hot ? " hot" : ""}${state.cell === cell ? " active" : ""}" data-cell="${cell}"
            style="flex:${share.toFixed(2)}" aria-label="${k} ${bandLabel(b).toLowerCase()} clients with ${l.label.toLowerCase()} friction: list them"
            data-tip="<b>${bandLabel(b)} · ${l.label.toLowerCase()} friction</b><br>${k} of ${n} clients (${pct(share)})<br>${fmtInt(sum(list))} interventions">${label}</button>`;
      }).join("")}</div>`;
    };
    const row = (g, muted) => {
      const list = inCell(`|${g.b}`), heavyN = inCell(`heavy|${g.b}`).length;
      return `<div class="fb-row${muted ? " muted" : ""}">
        <div class="fb-name">${g.name}${g.b === "established" && inCell(HOT).length ? '<em class="hot-pill">Look here</em>' : ""}<span>${g.sub}</span></div>
        <div class="fb-track">${bar(g.b, muted)}</div>
        <div class="fb-num"><b>${fmt1(per(list))}</b><span>${list.length ? pct((100 * heavyN) / list.length) : "—"} heavy</span></div></div>`;
    };
    // the takeaway: do the rules go easier on clients we know are good?
    const share = (b) => { const n = inCell(`|${b}`).length; return n ? inCell(`heavy|${b}`).length / n : 0; };
    const sNew = share("limited"), sGood = share("established");
    const pNew = per(inCell("|limited")), pGood = per(inCell("|established"));
    const hot = inCell(HOT), hotInts = sum(hot);
    const heavyVerdict = sGood > sNew * 1.15 ? "<b>more often</b> than" : sGood >= sNew * 0.85 ? "<b>as often</b> as" : "less often than";
    const perVerdict = pGood >= 0.85 * pNew && pGood <= 1.15 * pNew ? "about as many interventions each" : pGood < pNew ? "fewer interventions each" : "more interventions each";
    const fraudList = inCell("|fraud");
    return `<section class="card grid-card">
      <div class="card-head"><h2>Is friction landing on the right clients?</h2></div>
      <p class="grid-take">Tenured clients carry heavy friction ${heavyVerdict} new clients (${pct(100 * sGood)} against ${pct(100 * sNew)}) and get ${perVerdict} (${fmt1(pGood)} against ${fmt1(pNew)}): the rules don't ease off as a client builds a track record.${hot.length ? ` <b>${fmtInt(hot.length)} tenured clients carry heavy friction</b>: ${fmtInt(hotInts)} interventions, ${pct((100 * hotInts) / Math.max(allInts, 1))} of all.` : ""}</p>
      <div class="fb-head">
        <div class="fb-legend">${LEVELS.map((l) => `<span><i class="lvl-${l.key}"></i>${l.label} friction <em>grades ${l.grades[0]}–${l.grades[l.grades.length - 1]}</em></span>`).join("")}${info("history", "How clients are grouped")}</div>
        <div class="fb-numhead">Interventions per client</div></div>
      <div class="fb-rows">${groups.map((g) => row(g)).join("")}
        ${fraudList.length ? `<div class="fb-divider"><span>For contrast</span></div>${row({ b: "fraud", name: "Confirmed fraud", sub: "friction here is the rules doing their job" }, true)}` : ""}</div>
      <p class="card-note fb-note">Each bar is one group of clients, split by how much friction our rules put on them. Click a segment to list the clients.</p>
    </section>`;
  }
  function cellTitle(cell) {
    const [l, b] = cell.split("|");
    if (b === "fraud") return "Clients with confirmed fraud";
    if (l && b) return `${bandLabel(b)} clients with ${levelLabel(l).toLowerCase()} friction`;
    if (l) return `All clients with ${levelLabel(l).toLowerCase()} friction`;
    if (b) return `${bandLabel(b)} clients`;
    return "All clients without confirmed fraud";
  }
  function topRuleByCount(w) {
    const e = Object.entries(w.by_rule).sort((x, y) => y[1].count - x[1].count || y[1].score - x[1].score)[0];
    return e ? { rule: e[0], count: e[1].count } : null;
  }
  // The list opens inline under the grid, so the number that was clicked stays in view.
  function openCell(cell, focus) {
    const panel = document.getElementById("cell-list");
    if (!panel) return;
    state.cell = cell;
    const list = inCell(cell).sort((x, y) => y.windows[state.win].n - x.windows[state.win].n || y.windows[state.win].score[0] - x.windows[state.win].score[0]);
    panel.setAttribute("aria-labelledby", "cell-title");
    panel.innerHTML = `<div class="cp-head"><div><h3 id="cell-title" tabindex="-1">${cellTitle(cell)}</h3>
        <div class="card-sub">${fmtInt(list.length)} client${list.length === 1 ? "" : "s"} · ${W().phrase} · most interventions first</div></div>
        <button type="button" class="cp-close" aria-label="Close the list">×</button></div>
      <div class="cp-body"><table class="cp-table"><thead><tr><th>Client</th><th class="c">Transactions ${info("txn", "What counts as a transaction")}</th><th class="c">Transaction value</th><th class="c">Interventions</th><th>Rule causing most</th></tr></thead>
      <tbody>${list.map((c) => {
        const w = c.windows[state.win], t = topRuleByCount(w);
        return `<tr><td><span class="row-person"><span class="pi-avatar" style="background:${tint(gradeColor(w.grade), 0.16)};color:${gradeColor(w.grade)}">${initials(c.name)}</span><a href="#client/${c.client_id}" data-client="${c.client_id}">${esc(c.name)}</a></span></td>
          <td class="c" data-label="Transactions">${fmtInt(w.txn[0])}</td><td class="c" data-label="Value">${fmtUsd(w.txn[1])}</td><td class="c" data-label="Interventions"><b>${fmtInt(w.n)}</b></td>
          <td class="nowrap" data-label="Rule causing most">${t ? `<a href="#rule/${t.rule}" data-rule="${t.rule}">${esc(rn(t.rule))}</a> <span class="muted">· ${t.count} of ${w.n}</span>` : '<span class="muted">none</span>'}</td></tr>`;
      }).join("")}</tbody></table></div>`;
    wireInfo(panel);
    panel.querySelector(".cp-close").onclick = () => closeCell(true);
    panel.querySelectorAll("[data-client]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); go("#client/" + a.dataset.client); }));
    panel.querySelectorAll("[data-rule]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); go("#rule/" + a.dataset.rule); }));
    view.querySelectorAll(".fb-seg").forEach((b) => b.classList.toggle("active", b.dataset.cell === cell));
    if (focus) {
      panel.querySelector("#cell-title").focus({ preventScroll: true });
      // bring the list into view, but never scroll the clicked number under the top bar
      const btn = view.querySelector(`[data-cell="${cell}"]`);
      const head = panel.getBoundingClientRect().top, room = Math.min(260, innerHeight * 0.4);
      const by = Math.min(head - (innerHeight - room), (btn ? btn.getBoundingClientRect().top : head) - 76);
      if (by > 0) window.scrollBy({ top: by, behavior: "smooth" });
    }
  }
  function closeCell(restoreFocus) {
    const panel = document.getElementById("cell-list");
    const cell = state.cell;
    if (!panel || !cell) { state.cell = null; return; }
    panel.innerHTML = "";
    panel.removeAttribute("aria-labelledby");
    state.cell = null;
    hideTip();
    view.querySelectorAll(".fb-seg.active").forEach((b) => b.classList.remove("active"));
    if (restoreFocus) { const b = view.querySelector(`[data-cell="${cell}"]`); if (b) b.focus(); }
  }
  function wireGrid() {
    view.querySelectorAll(".fb-seg").forEach((b) => (b.onclick = () => (state.cell === b.dataset.cell ? closeCell(true) : openCell(b.dataset.cell, true))));
    view.querySelectorAll(".fb-seg[data-tip]").forEach((b) => bindTip(b, b.dataset.tip));
    if (state.cell) openCell(state.cell, false);
  }

  function methodSection() {
    const M = D.metrics[state.win], P = D.portfolio[state.win], ra = M.relax_all;
    const free = M.free_by_rule.filter((r) => r.verdict === "free").length;
    const rows = [
      ["Fraud caught and missed", `${M.fraud.caught} caught, ${M.fraud.missed} missed of ${M.fraud.total}`,
        `${M.fraud.caught_after_relax_all} caught after relaxing every rule as far as is safe`],
      ["Safe to remove: good clients, recommended settings", "0: not measured today",
        `${fmtInt(P.free_to_remove)} interventions from ${P.free_to_remove_clients} good clients; fraud caught ${M.fraud.caught_after_relax_good} of ${M.fraud.total}`],
      ["Upper bound: every client, every rule as far as is safe", "0: not measured today",
        `${fmtInt(ra.interventions_removed)} interventions from ${ra.clients_affected} clients; ${free} rules safe to relax`],
      ["Challenge reduction, tenured clients", "current thresholds",
        `friction cut median ${pct(ra.established_cut_pct[1])} (${pct(ra.established_cut_pct[2])}–${pct(ra.established_cut_pct[3])} across ${NW} weightings)`],
      ["Clients above the high-friction line", `${ra.clients_above_p75_before}`,
        `${ra.clients_above_p75_after} after; ${ra.clients_friction_increased} clients see friction rise; top-decile share ${pct(100 * ra.top_decile_share[0])} → ${pct(100 * ra.top_decile_share[1])}`],
      ["Range width across weightings", "n/a", `widest spread in the safe range: ${M.range_width_pts} percentage points`],
      ["Rules to keep as is (relaxing misses fraud)", "unknown today", M.no_free_stretch.map(rn).join(", ") || "none"],
    ];
    const w = D.config.decision_weights;
    return `<details class="card method" open><summary>Method and success metrics · ${W().phrase}</summary>
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

  // ======================================================================
  // Clients: every client grouped by friction grade, with filters. Opening one shows its page.
  const FILTERS = [
    { key: "band", title: "Good-client history", options: ["established", "developing", "limited", "fraud"], label: (b) => bandLabel(b), of: bandOf },
    { key: "type", title: "Client type", options: Object.keys(TYPE_LABELS), label: (t) => TYPE_LABELS[t], of: (c) => c.type },
    { key: "region", title: "Region", options: REGIONS, label: (r) => r, of: (c) => c.region },
    { key: "industry", title: "Industry", options: [...new Set(clients.map((c) => c.industry).filter(Boolean))].sort(), label: (i) => i, of: (c) => c.industry },
  ];
  const matches = (c, skip) => FILTERS.every((f) => f.key === skip || !state.filters[f.key].length || state.filters[f.key].includes(f.of(c)))
    && (!state.query || `${c.name} ${c.client_id} ${c.ecid || ""}`.toLowerCase().includes(state.query.toLowerCase().trim()));
  const gradeCutoff = (g) => { const [lo, hi] = D.grades.cutoffs[g]; return hi == null ? `${lo} and above` : `${lo}–${hi}`; };

  const defaultClient = () => (heavyClients()[0] || clientById[demo.open_client] || clients[0]).client_id;

  // The client pane: every client grouped by friction grade, filterable, beside the client view.
  function renderPane() {
    const pane = document.getElementById("client-pane");
    if (!pane) return;
    const keep = pane.childElementCount ? pane.scrollTop : state.paneScroll;
    if (!state.paneOpen) {
      pane.innerHTML = `<button type="button" class="pane-toggle rail" id="pane-toggle" aria-expanded="false" title="Show the client list">
        <span aria-hidden="true">»</span><span class="rail-label">Clients · ${fmtInt(clients.filter((c) => matches(c)).length)}</span></button>`;
      document.getElementById("pane-toggle").onclick = () => { state.paneOpen = true; renderClient(); };
      return;
    }
    const list = clients.filter((c) => matches(c));
    const sel = clientById[state.clientId], selGrade = sel && sel.windows[state.win].grade;
    const nOn = FILTERS.reduce((t, f) => t + state.filters[f.key].length, 0);
    const chips = (f) => f.options.map((o) => {
      const n = clients.filter((c) => matches(c, f.key) && f.of(c) === o).length;
      return `<button type="button" class="chip" data-filter="${f.key}" data-value="${o}" aria-pressed="${state.filters[f.key].includes(o)}">${esc(f.label(o))} <span>${n}</span></button>`;
    }).join("");
    const groups = GRADES.slice().reverse().map((g) => {
      const cs = list.filter((c) => c.windows[state.win].grade === g).sort((a, b) => b.windows[state.win].score[0] - a.windows[state.win].score[0]);
      if (!cs.length) return "";
      const note = g === GRADES[GRADES.length - 1] ? "most friction" : g === GRADES[0] ? "least friction" : `score ${gradeCutoff(g)}`;
      return `<details class="pane-group" data-grade="${g}" ${state.openGrades.includes(g) || g === selGrade ? "open" : ""}>
        <summary><span class="grade-badge sm" style="background:${gradeColor(g)}">${g}</span><span class="pg-note">${note}</span><span class="pg-count">${cs.length}</span></summary>
        ${cs.map((c) => { const w = c.windows[state.win]; return `<a class="pane-item client-item" href="#client/${c.client_id}" data-pick="${c.client_id}" aria-current="${c.client_id === state.clientId}">
          <span class="pi-avatar" style="background:${tint(gradeColor(g), 0.16)};color:${gradeColor(g)}">${initials(c.name)}</span>
          <span class="pi-name">${esc(c.name)}</span><span class="pi-score" title="Friction score">${Math.round(w.score[0])}</span>
          <span class="pi-meta">${bandLabel(bandOf(c))} · ${TYPE_LABELS[c.type] || "—"} · ${c.region || "—"}</span></a>`; }).join("")}
      </details>`;
    }).join("");
    pane.innerHTML = `
      <div class="pane-head"><h2>Clients</h2><span class="muted">${fmtInt(list.length)} of ${fmtInt(clients.length)}</span>
        <button type="button" class="pane-toggle" id="pane-toggle" aria-expanded="true" title="Hide the client list">«</button></div>
      <input id="pane-q" class="pane-search" type="search" placeholder="Search name, ID or ECID" aria-label="Search clients" value="${esc(state.query)}" autocomplete="off">
      <details class="pane-filters" ${state.filtersOpen ? "open" : ""}><summary>Filters${nOn ? ` · ${nOn} on` : ""}</summary>
        ${FILTERS.map((f) => `<div class="f-title">${f.title}</div><div class="chips">${chips(f)}</div>`).join("")}
        ${nOn || state.query ? '<button type="button" class="link-btn" id="pane-clear">Clear filters</button>' : ""}</details>
      <div class="pane-list">${groups || '<p class="muted pane-empty">No clients match these filters.</p>'}</div>`;

    pane.scrollTop = keep;   // opens at the top: search, filters and the F group first
    document.getElementById("pane-toggle").onclick = () => { state.paneOpen = false; renderClient(); };
    const q = document.getElementById("pane-q");
    q.oninput = () => { state.query = q.value; renderPane(); const n = document.getElementById("pane-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    pane.querySelectorAll("[data-filter]").forEach((b) => (b.onclick = () => {
      const arr = state.filters[b.dataset.filter], i = arr.indexOf(b.dataset.value);
      if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.value);
      renderPane();
    }));
    const clr = document.getElementById("pane-clear");
    if (clr) clr.onclick = () => { FILTERS.forEach((f) => (state.filters[f.key] = [])); state.query = ""; renderPane(); };
    pane.querySelector(".pane-filters").addEventListener("toggle", (e) => { state.filtersOpen = e.target.open; });
    pane.querySelectorAll("details.pane-group").forEach((d) => d.addEventListener("toggle", () => {
      const g = d.dataset.grade, i = state.openGrades.indexOf(g);
      if (d.open && i < 0) state.openGrades.push(g);
      if (!d.open && i >= 0) state.openGrades.splice(i, 1);
    }));
    pane.querySelectorAll("[data-pick]").forEach((a) => (a.onclick = (e) => {
      e.preventDefault();
      state.paneScroll = pane.scrollTop;
      go("#client/" + a.dataset.pick);
    }));
  }

  const COUNTRY = { CAN: "Canada", USA: "United States", GBR: "United Kingdom", DEU: "Germany", FRA: "France", IRL: "Ireland",
    AUS: "Australia", SGP: "Singapore", JPN: "Japan" };
  const PEER_LABEL = { smb_retail: "retail", smb_services: "services", smb_food: "restaurants", mm_retail: "retail",
    mm_services: "services", global_enterprise: "global", domestic_enterprise: "domestic", payfac_platform: "platforms" };
  const CH_LABEL = { P: "Card present", K: "Keyed-in", O: "Online" };
  const subName = (id) => (D.sub_merchants[id] ? D.sub_merchants[id].name + (D.sub_merchants[id].status === "APPLICANT" ? " (applicant)" : "") : id);

  // Account-level actions on this client: open first, then the last 12 months.
  function actionsPanel(c) {
    const asOf = D.meta.as_of;
    const isOpen = (a) => a.type !== "RECOVERY" && (!a.end || a.end > asOf);
    const acts = c.actions.slice().sort((a, b) => isOpen(b) - isOpen(a) || (b.start > a.start ? 1 : -1));
    const span = (a) => `${dayLabel(a.start)} – ${isOpen(a) ? "open" : dayLabel(a.end)}`;
    const extra = (a) => a.type === "RESERVE" ? `${fmtUsd(a.held_usd || 0)} ${isOpen(a) ? "held now" : "held at most"}`
      : a.type === "ACCOUNT_REVIEW" && a.outcome ? ({ CLEARED: "cleared", UPHELD: "upheld" })[a.outcome] || "" : "";
    return `<section class="card">
      <div class="card-head"><h2>Account-level actions</h2>${info("actions", "About account-level actions")}</div>
      <div class="card-sub">${acts.filter(isOpen).length ? `${acts.filter(isOpen).length} open now` : "None open now"} · last 12 months</div>
      ${acts.length ? `<div class="acts">${acts.slice(0, 6).map((a) => `<div class="act${isOpen(a) ? " open" : ""}">
          <span class="act-dot" aria-hidden="true"></span><div><div class="act-name">${esc(actionShort(a))}</div>
          <div class="act-sub">${span(a)}${extra(a) ? ` · ${esc(extra(a))}` : ""}</div></div></div>`).join("")}
        ${acts.length > 6 ? `<div class="muted act-more">and ${acts.length - 6} earlier</div>` : ""}</div>`
        : '<p class="muted" style="margin:6px 0 0">No reserves, restrictions, reviews or blocks in the last 12 months.</p>'}
      <p class="card-note" style="margin-top:10px">Not in the friction score yet.</p>
    </section>`;
  }

  // ISV platforms: which of their sub-merchants carry the friction.
  function subMerchantPanel(c) {
    const hits = windowHits(c, true), by = {};
    hits.forEach((h) => { if (!h.sm) return; const s = by[h.sm] || (by[h.sm] = { n: 0, rules: {} }); s.n++; s.rules[h.r] = (s.rules[h.r] || 0) + 1; });
    const rows = Object.entries(by).sort((a, b) => b[1].n - a[1].n);
    const topRule = (s) => Object.entries(s.rules).sort((a, b) => b[1] - a[1])[0][0];
    return `<section class="card">
      <div class="card-head"><h2>Sub-merchants carrying the friction</h2></div>
      <div class="card-sub">${rows.length ? `${rows.length} sub-merchant${rows.length > 1 ? "s" : ""} and applicants with interventions, ${W().phrase}` : `No sub-merchant interventions, ${W().phrase}`}</div>
      ${rows.length ? `<div class="subs">${rows.slice(0, 6).map(([id, s]) => `<div class="sub-row"><div><div class="sub-name">${esc(subName(id))}</div>
          <div class="act-sub">${id} · mostly ${esc(rn(topRule(s)))}</div></div><span class="score">${s.n}</span></div>`).join("")}
        ${rows.length > 6 ? `<div class="muted act-more">and ${rows.length - 6} more</div>` : ""}</div>` : ""}
    </section>`;
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

    view.innerHTML = `<div class="client-shell${state.paneOpen ? "" : " pane-closed"}">
      <aside class="list-pane" id="client-pane" aria-label="Clients"></aside>
      <div class="client-main">
      <div class="page-head">
        <div>
          <div class="crumbs">Clients › ${esc(c.name)}</div>
          <div class="title-row"><h1>${esc(c.name)}</h1>
            <span class="tag tag-info">${c.disqualified ? "Confirmed fraud" : `${bandLabel(c.band)} client`}</span>
            ${incItems.length ? '<span class="tag tag-incident">Incident</span>' : ""}
            <span class="title-meta">${TYPE_LABELS[c.type] || esc(c.segment_label)}${c.industry ? ` · ${c.industry}` : ""}${c.country ? ` · ${COUNTRY[c.country] || c.country}` : c.region ? ` · ${c.region}` : ""}${c.tenure_months != null ? ` · ${c.tenure_months} months` : ""}</span></div>
          <div class="refs">
            ${c.ecid ? `<span class="ref"><span class="ref-k">ECID</span><span class="ref-v" id="ecid">${c.ecid}</span><button type="button" class="ref-copy" id="copy-ecid" aria-label="Copy ECID" title="Copy ECID"><svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.5"/><path d="M3 10.5V4a1 1 0 0 1 1-1h6.5"/></svg></button></span>` : ""}
            <span class="ref"><span class="ref-k">Client ID</span><span class="ref-v">${c.client_id}</span></span>
            ${c.mcc ? `<span class="ref"><span class="ref-k">MCC</span><span class="ref-v">${c.mcc}</span><span class="ref-d">${esc(c.mcc_desc || "")}</span></span>` : ""}
            ${c.country ? `<span class="ref"><span class="ref-k">Processing country</span><span class="ref-v">${c.country}</span></span>` : ""}
          </div>
          <p class="lead">${esc(summarySentence(c, w))}</p>
        </div>
        ${windowControl()}
      </div>
      <div class="client-grid">
        <div class="client-left">
          <section class="card">
            <div class="card-head"><h2>${glanceTitle()} at a glance</h2></div>
            <div class="glance">
              <div><div class="stat-label">Friction grade ${info("score", "How the friction score works")}</div>
                <div class="grade-big"><span class="letter" style="background:${gradeColor(w.grade)}">${w.grade}</span><span class="word">${gradeWord(w.grade)}</span></div>
                <div class="stat-sub">Score ${Math.round(total)} · range ${Math.round(w.score[1])}–${Math.round(w.score[2])}</div>
                <button class="see-all calc-link" id="calc-link">How it's calculated ↓</button></div>
              <div><div class="stat-label">Interventions</div>
                <div class="arrow-pair">${w.prev_n == null ? "" : `<div class="col"><span class="stat-value muted">${w.prev_n}</span><span>${prevMonth}</span></div><span class="arrow">→</span>`}
                  <div class="col"><span class="stat-value accent">${w.n}</span><span>${nowLabel}</span></div></div></div>
              <div><div class="stat-label">Payout hold time ${info("hold", "What payout hold time means")}</div>
                <div class="stat-value">${w.holds ? holds : "None"}</div>
                <div class="stat-sub">${w.holds ? `added up across ${w.holds} held payout${w.holds > 1 ? "s" : ""} (${fmtUsd(w.held_usd)}) · ${w.holds_cleared === w.holds ? "all released" : `${w.holds_cleared} released`}` : "no payouts held for review"}</div></div>
              <div><div class="stat-label">Payouts denied</div>
                <div class="stat-value">${w.denied}</div>
                <div class="stat-sub">${w.denied ? `${fmtUsd(w.denied_usd)} · ${w.denied_fraud ? `${w.denied_fraud} confirmed fraud` : "no fraud found in any"}` : "none in this window"}</div></div>
            </div>
            <div class="glance-bottom">
              <div><div class="stat-label">Caused by</div>
                ${topR ? `<div class="share-bar">${byRule.map(([k, v], i) => `<div style="flex:${Math.max(v.score, 0.01)};background:${k === top ? "var(--accent)" : i % 2 ? "var(--lilac)" : "var(--silver)"}" title="${rn(k)}: ${v.count}"></div>`).join("")}</div>
                <div><span class="big-accent">${pct((100 * topR.score) / Math.max(total, 1e-9))}</span> from ${esc(rn(top))} · ${topR.count} of ${w.n} interventions</div>
                <div class="stat-sub">${others.length ? `${others.length} other rule${others.length > 1 ? "s" : ""}: ${others.map(rn).join(", ")}` : "no other rules"}</div>`
                : '<div class="stat-sub">No rule interventions in this window.</div>'}</div>
              <div><div class="stat-label">Compared with similar clients</div>
                <div class="peer-big">${ordinal(w.peer_pct[0])} <span>percentile</span></div>
                <div class="stat-sub">of ${w.peer_n} similar ${esc(c.segment_label)} clients${PEER_LABEL[c.peer_group] ? ` · ${PEER_LABEL[c.peer_group]}` : ""}</div></div>
            </div>
          </section>
          <section class="card">
            <div class="card-head"><h2>Interventions by rule</h2><span class="card-note">Busiest rule first · hover a dot for details</span></div>
            <div class="lanes" id="lanes"></div>
            <p class="card-note note-line">${incItems.length
              ? `Outage: ${incItems.map((i) => `${i.hours} h inside ${i.id}`).join(", ")}, ${pct(100 * incShare)} of this client's friction. Kept separate, never added to the score.`
              : "No outage friction in this window. Outages are never added to the score."}</p>
          </section>
          <section class="card">
            <div class="card-head"><h2>Intervention log</h2><span class="card-note">Newest first · points add up to the friction score</span></div>
            <div class="table-scroll" id="log"></div>
            <div class="table-tools"><label><input type="checkbox" id="show-uncredited" ${state.showUncredited ? "checked" : ""}> Also show contributing, shadow and overridden hits</label></div>
          </section>
          <details class="card calc" id="calc" ${state.calcOpen ? "open" : ""}></details>
        </div>
        <div class="client-right">
          <section class="card">
            <div class="card-head"><h2>Is this a good client?</h2><span class="tag tag-info">${bandLabel(bandOf(c))}</span></div>
            <div class="card-sub">Based on evidence the fraud rules did not create</div>
            <div class="evidence">${checks.map(([k, v, ok]) => `<div class="ev-row ${ok === false ? "bad" : ok == null ? "unknown" : ""}">${icon(ok)}<span>${k}</span><span class="v">${esc(v)}</span></div>`).join("")}</div>
            <p class="card-note" style="margin-top:10px">A proposal for Risk Strategy, not a validated score. Any confirmed fraud disqualifies a client outright.${c.unknown.length ? ` Unknown evidence (${c.unknown.join(", ")}) caps a client below tenured.` : ""}</p>
          </section>
          ${actionsPanel(c)}
          ${top ? `<section class="card" id="why-card"></section>` : ""}
          ${c.entity === "PAYFAC" ? subMerchantPanel(c) : ""}
        </div>
      </div>
      ${footer()}</div></div>`;

    wireCommon();
    renderPane();
    const cp = document.getElementById("copy-ecid");
    if (cp) cp.onclick = () => {
      const done = () => { cp.classList.add("done"); cp.title = "Copied"; setTimeout(() => cp.classList.remove("done"), 1200); };
      try { navigator.clipboard.writeText(c.ecid).then(done, done); } catch (e) { done(); }
    };
    document.getElementById("show-uncredited").onchange = (e) => { state.showUncredited = e.target.checked; renderLog(c); };
    drawLanes(document.getElementById("lanes"), c, w);
    renderLog(c);
    renderCalc(document.getElementById("calc"), c, w);
    const calc = document.getElementById("calc");
    calc.addEventListener("toggle", () => { state.calcOpen = calc.open; });
    document.getElementById("calc-link").onclick = () => { calc.open = true; calc.scrollIntoView({ behavior: "smooth", block: "start" }); };
    if (top) renderWhy(document.getElementById("why-card"), c, w, ruleById[top]);
  }
  const ordinal = (n) => { const v = Math.round(n), s = ["th", "st", "nd", "rd"], r = v % 100; return v + (s[(r - 20) % 10] || s[r] || s[0]); };

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
      if (isTop) el("rect", { x: 0, y: m.t + laneH * k, width, height: laneH, fill: "var(--accent-wash)" }, svg);
      el("line", { x1: m.l + pad, x2: width - m.r - pad, y1: y, y2: y, stroke: "var(--border)" }, svg);
      const label = txt(svg, 8, y + 4, rn(rid), { style: `font-size:12.5px;fill:${isTop ? "var(--accent-ink)" : "var(--ink)"};cursor:pointer` });
      label.addEventListener("click", () => go("#rule/" + rid));
      txt(svg, width - 10, y + 4, String(counts[rid]), { "text-anchor": "end", class: "t-strong", style: `font-size:12.5px;${isTop ? "fill:var(--accent-ink)" : ""}` });
      hits.filter((h) => h.r === rid).forEach((h) => {
        const dot = el("circle", { cx: xs(h.t), cy: y, r: 6, fill: isTop ? "var(--accent)" : "var(--silver)", stroke: "#fff", "stroke-width": 1.5 }, svg);
        const hit = el("circle", { cx: xs(h.t), cy: y, r: 11, fill: "transparent" }, svg);
        bindTip(hit, `<b>${dayLabel(h.t)}</b> · ${esc(rn(rid))}<br>${actionLabel(h)} · ${hitCp(h)}${h.$ != null ? ` · ${fmtUsd(h.$)}` : ""}<br>Held for ${heldFor(h)} · ${outcomeLabel(h)}<br><span class="t-muted">Adds ${(+h.s).toFixed(1)} points: weight ${h.w}${h.d === "HOLD" ? ` × hold ${h.u}` : ""} × recency ${h.y}</span>`);
        dot.setAttribute("pointer-events", "none");
      });
    });
    const days = W().days, step = (days <= 31 ? 7 : days <= 62 ? 14 : 61) * (narrow ? 2 : 1);
    for (let d = 0; d <= days; d += step) {
      const iso = new Date(t0 + d * 864e5).toISOString();
      if (xs(iso) > width - 75) continue;
      txt(svg, xs(iso), H - 8, days > 62 ? `${MONTHS[dt(iso).getUTCMonth()]} ${dt(iso).getUTCFullYear() % 100}` : dayLabel(iso), { "text-anchor": "middle" });
    }
    txt(svg, width - 10, H - 8, `total ${hits.length}`, { "text-anchor": "end" });
  }

  function renderLog(c) {
    const w = c.windows[state.win];
    const hits = windowHits(c, !state.showUncredited).slice().reverse();
    const roleNote = { C: "Not credited · contributing", S: "Not credited · shadow, logged only", O: "Not credited · overridden downstream" };
    const box = document.getElementById("log");
    box.innerHTML = `<table><thead><tr><th>Date</th><th>Rule</th><th>Action</th><th>Checkpoint</th><th>Held for</th><th>Outcome</th><th class="num">Points ${info("score", "How points are calculated")}</th></tr></thead><tbody>
      ${hits.map((h) => `<tr class="${h.a === "P" ? "" : "uncredited"}"><td>${dayLabel(h.t)}${h.tx ? `<span class="log-ref">${h.tx}</span>` : ""}${h.sm ? `<span class="log-ref">${esc(subName(h.sm))}</span>` : ""}</td>
        <td class="rule-cell${h.r === w.top_rule && h.a === "P" ? " top" : ""}"><span data-tip-rule="${h.r}">${esc(rn(h.r))}</span></td>
        <td>${h.a === "P" ? actionLabel(h) : roleNote[h.a]}</td><td>${hitCp(h)}${h.ch ? `<span class="log-ref">${CH_LABEL[h.ch]}${h.rc ? " · recurring" : ""}</span>` : ""}</td><td>${h.a === "P" ? heldFor(h) : "—"}</td>
        <td>${h.a === "P" ? outcomeLabel(h) : "—"}</td>
        <td class="num">${h.a === "P" ? `<span class="pts" data-pts="${h.w}|${h.d === "HOLD" ? h.u : 1}|${h.y}|${heldFor(h)}">${(+h.s).toFixed(1)}</span>` : "0"}</td></tr>`).join("") || '<tr><td colspan="7" class="muted">No interventions in this window.</td></tr>'}
      ${hits.length ? `<tr class="calc-total"><td colspan="6">Friction score</td><td class="num">${w.score[0].toFixed(1)}</td></tr>` : ""}
      </tbody></table>`;
    wireInfo(box);
    box.querySelectorAll("[data-pts]").forEach((sp) => {
      const [wt, hf, rec, held] = sp.dataset.pts.split("|");
      bindTip(sp, `<b>${sp.textContent} points</b> = weight ${wt}${hf !== "1" ? ` × hold-time ${(+hf).toFixed(2)} <span class="t-muted">(${held})</span>` : ""} × recency ${(+rec).toFixed(2)}`);
    });
    box.querySelectorAll("[data-tip-rule]").forEach((s) => {
      const r = ruleById[s.dataset.tipRule];
      bindTip(s, `<b>${esc(rn(r.rule_id))}</b><br>${esc(r.description)}<br><span class="t-muted">${r.decision_label} · ${cpOf(r)} · live since ${fullDate(r.live_since + "T00:00:00Z")}</span>`);
    });
  }

  function renderCalc(card, c, w) {
    const all = windowHits(c, false);
    const contrib = all.filter((h) => h.a === "C").length, over = all.filter((h) => h.a === "O").length;
    const shadow = all.filter((h) => h.a === "S"), shadowRules = [...new Set(shadow.map((h) => h.r))];
    const total = w.score[0];
    const ref = D.config.reference_hours, hl = D.config.half_life_days;
    const [lo, hi] = D.grades.cutoffs[w.grade];
    const hf = (h) => Math.log1p(h / ref).toFixed(1);
    const weights = Object.entries(WT).filter(([k, v]) => v > 0).map(([k, v]) => `${k.charAt(0) + k.slice(1).toLowerCase().replace("_", " ")} ${v}`).join(" · ");
    const inc = w.incident;
    card.innerHTML = `<summary><h2>How ${esc(shortName(c))}'s score of ${Math.round(total)} is calculated</h2><span class="card-note">Each row of the log above, added up</span></summary>
      <div class="formula">
        <div class="term"><div class="t-name">Decision weight</div><div class="t-desc">${weights}</div></div>
        <span class="op" aria-hidden="true">×</span>
        <div class="term"><div class="t-name">Hold-time factor</div><div class="t-desc">Holds only: ln(1 + hours ÷ ${ref}). 25 min ≈ ${hf(25 / 60)}, 18 h ≈ ${hf(18)}, 4 days ≈ ${hf(96)}</div></div>
        <span class="op" aria-hidden="true">×</span>
        <div class="term"><div class="t-name">Recency</div><div class="t-desc">0.5 ^ (days ago ÷ ${hl}): today 1, ${hl} days ago 0.5</div></div>
        <span class="op" aria-hidden="true">=</span>
        <div class="term result"><div class="t-name">Points</div><div class="t-desc">${Math.round(total)} in total → grade <b>${w.grade}</b> (${lo}${hi == null ? "+" : `–${hi}`})</div></div>
      </div>
      <div class="calc-cols">
        <div><div class="stat-label">Counted as zero</div><ul class="calc-list">
          ${contrib ? `<li>${contrib} contributing hit${contrib === 1 ? "" : "s"}: another rule's decision prevailed on the same event</li>` : ""}
          ${shadow.length ? `<li>${shadow.length} shadow hit${shadow.length === 1 ? "" : "s"} from ${shadowRules.map(rn).join(", ")}: logged, no client paid</li>` : ""}
          ${over ? `<li>${over} hit${over === 1 ? "" : "s"} overridden downstream</li>` : ""}
          <li>Outages: ${inc.items.length ? `${inc.friction.toFixed(0)} points from ${inc.items.map((i) => i.id).join(", ")}, kept in their own band` : "none in this window"}</li></ul></div>
        <div><div class="stat-label">Why a range</div><p class="calc-note">The weights are placeholders (${D.meta.weights_version}). Re-run under ${NW} weightings that keep the same order, half-lives of ${D.config.weighting_sweep.half_life_days.join("–")} days and other hold-time shapes, the score runs ${Math.round(w.score[1])}–${Math.round(w.score[2])} (grades ${w.grade_range.join("–")}).</p></div>
      </div>`;
  }

  function renderWhy(card, c, w, r) {
    const cv = r.windows[state.win].curve;
    const today = r.grid[0];
    const recIdx = !c.disqualified && (cv.verdict === "free" || cv.verdict === "small") ? cv.recommended_index : null;
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
    const flaggedAt = (t) => hitVals.filter((v) => (up ? v > t : v < t)).length;
    // The rule's general recommendation may not help this client (its payouts sit above it).
    // Then show the first setting inside the safe range that does.
    let proposedIdx = recIdx;
    if (recIdx != null && hitVals.length && flaggedAt(r.grid[recIdx]) === hitVals.length) {
      const better = [];
      for (let i = recIdx + 1; i <= cv.flat_index; i++) if (typeof r.grid[i] === "number" && flaggedAt(r.grid[i]) < hitVals.length) better.push(i);
      if (better.length) proposedIdx = better.find((i) => flaggedAt(r.grid[i]) === 0) ?? better[better.length - 1];
    }
    const proposed = proposedIdx != null ? r.grid[proposedIdx] : null;
    const ownSetting = proposedIdx != null && proposedIdx !== recIdx;
    const stillFlagged = proposed == null ? hitVals.length : flaggedAt(proposed);
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
        text = ownSetting
          ? `${where}${fraudPart}. The rule's general recommendation (${fmtVal(r.grid[recIdx], r.unit)}) would not help ${name}; ${fmtVal(proposed, r.unit)}, still inside the safe range, ${effect}${safe}.`
          : `${where}${fraudPart}. A threshold of ${fmtVal(proposed, r.unit)} ${effect}${safe}.`;
      }
    }

    card.innerHTML = `<h2>Why ${esc(rn(r.rule_id))} keeps firing</h2>
      <div class="card-sub">${esc(name)}'s ${noun} vs the rule threshold${r.axis === "log" ? " · log scale" : ""}</div>
      <div class="chart-box" id="why-plot"></div>
      <p class="why-text">${esc(text)}</p>
      <button class="btn" data-rule="${r.rule_id}"><svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>Open rule tradeoff</button>`;
    card.querySelector("[data-rule]").onclick = () => go("#rule/" + r.rule_id);

    const box = document.getElementById("why-plot");
    const width = Math.max(260, box.clientWidth), H = 116;
    const m = { l: 8, r: 8, t: 22, b: 30 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": `${name}'s values against the ${rn(r.rule_id)} threshold and confirmed fraud` }, box);
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
      const cf = txt(svg, xs(up ? hi : lo) + (up ? -2 : 2), m.t - 6, "confirmed fraud", { "text-anchor": up ? "end" : "start" });
      // keep the two labels apart: shorten the first if they touch, then slide it clear
      const gap = () => { const n = nf.getBBox(), c = cf.getBBox(); return up ? c.x - 8 - (n.x + n.width) : n.x - 8 - (c.x + c.width); };
      if (gap() < 0) nf.textContent = "no fraud seen";
      if (gap() < 0) nf.setAttribute("x", +nf.getAttribute("x") + (up ? gap() : -gap()));
      const nb = nf.getBBox();
      if (nb.x < m.l) nf.setAttribute("x", +nf.getAttribute("x") + (m.l - nb.x));
    }
    el("line", { x1: xs(today), x2: xs(today), y1: m.t - 2, y2: H - m.b, stroke: "var(--ink)", "stroke-width": 2 }, svg);
    if (proposed != null) el("line", { x1: xs(proposed), x2: xs(proposed), y1: m.t, y2: H - m.b, stroke: "var(--ink)", "stroke-width": 1.5, "stroke-dasharray": "2 3" }, svg);
    el("line", { x1: m.l, x2: width - m.r, y1: H - m.b, y2: H - m.b, class: "axis" }, svg);
    // fraud diamonds (a sample, spread so they read as a cluster)
    const fs = fraud.length > 24 ? fraud.filter((_, i) => i % Math.ceil(fraud.length / 24) === 0) : fraud;
    fs.forEach((v, i) => { const x = xs(v), y = yMid + ((i % 3) - 1) * 9; el("path", { d: `M${x},${y - 4.5} l4.5,4.5 l-4.5,4.5 l-4.5,-4.5z`, fill: "var(--fraud)" }, svg); });
    vals.forEach((v, i) => {
      const x = xs(v), y = yMid + ((i % 3) - 1) * 9;
      el("circle", fires(v) ? { cx: x, cy: y, r: 4.5, fill: "var(--accent)" } : { cx: x, cy: y, r: 3.8, fill: "#fff", stroke: "var(--accent)", "stroke-width": 1.5 }, svg);
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
    lab(today, `${fmtVal(today, r.unit, true)} today`, { style: "fill:var(--ink)" });
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

  // Interventions (and shadow hits) per rule on the clients the type and region filters select.
  function ruleHits(types, regions) {
    const start = W().start, out = {};
    clients.forEach((c) => {
      if (types.length && !types.includes(c.type)) return;
      if (regions.length && !regions.includes(c.region)) return;
      D.timelines[c.client_id].forEach((h) => {
        if (h.t < start || (h.a !== "P" && h.a !== "S")) return;
        const o = out[h.r] || (out[h.r] = { n: 0, shadow: 0 });
        if (h.a === "P") o.n++; else o.shadow++;
      });
    });
    return out;
  }
  const RULE_FILTERS = [
    { key: "cp", title: "Checkpoint", options: CHECKPOINTS.map((c) => c[0]), label: (k) => CP_LABEL[k] },
    { key: "type", title: "Client type", options: Object.keys(TYPE_LABELS), label: (t) => TYPE_LABELS[t] },
    { key: "region", title: "Region", options: REGIONS, label: (x) => x },
  ];
  // Rules shown for a set of filters: at a chosen checkpoint, and firing on the chosen clients.
  function rulesFor(f) {
    const scoped = f.type.length || f.region.length, hits = scoped ? ruleHits(f.type, f.region) : null;
    return rules.filter((r) => (!f.cp.length || f.cp.includes(cpKey(r)))
      && (!state.ruleQuery || `${rn(r.rule_id)} ${r.rule_id} ${r.description}`.toLowerCase().includes(state.ruleQuery.toLowerCase()))
      && (!scoped || (hits[r.rule_id] && (hits[r.rule_id].n || hits[r.rule_id].shadow))))
      .map((r) => ({ r, n: scoped ? hits[r.rule_id].n : r.windows[state.win].interventions, scoped }));
  }

  function renderRulePane() {
    const pane = document.getElementById("rule-pane");
    if (!pane) return;
    const keep = pane.childElementCount ? pane.scrollTop : state.rulePaneScroll;
    const F = state.ruleFilters;
    if (!state.rulePaneOpen) {
      pane.innerHTML = `<button type="button" class="pane-toggle rail" id="rule-pane-toggle" aria-expanded="false" title="Show the rule list">
        <span aria-hidden="true">»</span><span class="rail-label">Rules · ${rulesFor(F).length}</span></button>`;
      document.getElementById("rule-pane-toggle").onclick = () => { state.rulePaneOpen = true; renderRule(); };
      return;
    }
    const list = rulesFor(F);
    const nOn = RULE_FILTERS.reduce((t, f) => t + F[f.key].length, 0);
    const scoped = F.type.length || F.region.length;
    const chips = (f) => f.options.map((o) => {
      const on = F[f.key].includes(o);
      const n = rulesFor({ ...F, [f.key]: [o] }).length;
      return `<button type="button" class="chip" data-rfilter="${f.key}" data-value="${o}" aria-pressed="${on}" ${n || on ? "" : "disabled"}>${esc(f.label(o))} <span>${n}</span></button>`;
    }).join("");
    const groups = CHECKPOINTS.map(([key, label]) => {
      const rs = list.filter((x) => cpKey(x.r) === key).sort((a, b) => b.n - a.n);
      if (!rs.length) return "";
      return `<div class="pane-group rule-group"><div class="rg-head">${label}<span class="pg-count">${rs.length}</span></div>
        ${rs.map(({ r, n }) => { const cv = r.windows[state.win].curve; return `<a class="pane-item rule-item" href="#rule/${r.rule_id}" data-pick-rule="${r.rule_id}" aria-current="${r.rule_id === state.ruleId}">
          <span class="pi-name">${esc(rn(r.rule_id))}</span>
          <span class="pi-desc">${esc(r.description)}</span>
          <span class="pi-meta">${r.shadow ? "Shadow · acts on nothing" : `${fmtInt(n)} intervention${n === 1 ? "" : "s"}${scoped ? " on these clients" : ""}`}</span>
          <span class="tag ${tagFor(cv)}">${esc(cv.label)}</span></a>`; }).join("")}</div>`;
    }).join("");
    pane.innerHTML = `
      <div class="pane-head"><h2>Rules</h2><span class="muted">${list.length} of ${rules.length}</span>
        <button type="button" class="pane-toggle" id="rule-pane-toggle" aria-expanded="true" title="Hide the rule list">«</button></div>
      <input id="rule-q" class="pane-search" type="search" placeholder="Search rules" aria-label="Search rules" value="${esc(state.ruleQuery)}" autocomplete="off">
      <details class="pane-filters" ${state.ruleFiltersOpen ? "open" : ""}><summary>Filters${nOn ? ` · ${nOn} on` : ""}</summary>
        ${RULE_FILTERS.map((f) => `<div class="f-title">${f.title}</div><div class="chips">${chips(f)}</div>`).join("")}
        <p class="pane-note">Client type and region keep the rules that intervened on those clients ${W().phrase}, with their counts.</p>
        ${nOn || state.ruleQuery ? '<button type="button" class="link-btn" id="rule-clear">Clear filters</button>' : ""}</details>
      <div class="pane-list">${groups || '<p class="muted pane-empty">No rules match these filters.</p>'}
        <p class="pane-note pane-foot">Tags: how far each rule can be loosened without missing fraud ${info("relax")}</p></div>`;

    pane.scrollTop = keep;
    wireInfo(pane);
    document.getElementById("rule-pane-toggle").onclick = () => { state.rulePaneOpen = false; renderRule(); };
    const q = document.getElementById("rule-q");
    q.oninput = () => { state.ruleQuery = q.value; renderRulePane(); const n = document.getElementById("rule-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); };
    pane.querySelectorAll("[data-rfilter]").forEach((b) => (b.onclick = () => {
      const arr = F[b.dataset.rfilter], i = arr.indexOf(b.dataset.value);
      if (i >= 0) arr.splice(i, 1); else arr.push(b.dataset.value);
      renderRulePane();
    }));
    const clr = document.getElementById("rule-clear");
    if (clr) clr.onclick = () => { RULE_FILTERS.forEach((f) => (F[f.key] = [])); state.ruleQuery = ""; renderRulePane(); };
    pane.querySelector(".pane-filters").addEventListener("toggle", (e) => { state.ruleFiltersOpen = e.target.open; });
    pane.querySelectorAll("[data-pick-rule]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); state.rulePaneScroll = pane.scrollTop; go("#rule/" + a.dataset.pickRule); }));
  }

  function renderRule() {
    const r = ruleById[state.ruleId];
    const rw = r.windows[state.win];
    view.innerHTML = `
      <div class="page-head">
        <div>
          <div class="crumbs">Rule tradeoffs › ${esc(rn(r.rule_id))}</div>
          <div class="title-row"><h1>${esc(rn(r.rule_id))}</h1>
            <span class="title-meta">${r.decision_label} · ${cpOf(r)} · live since ${dayLabel(r.live_since + "T00:00:00Z")}</span></div>
          <p class="lead">${esc(r.description)}</p>
        </div>
        <div class="window"><div class="window-label">Measured on</div>
          <div class="window-range" style="margin:0 0 6px">All ${clients.length} clients · ${W().phrase}</div>
          <div class="seg" role="group" aria-label="Window">${Object.entries(D.meta.windows).map(([k, w]) => `<button type="button" data-win="${k}" aria-pressed="${k === state.win}">${w.label}</button>`).join("")}</div>
        </div>
      </div>
      <div class="rule-grid${state.rulePaneOpen ? "" : " pane-closed"}">
        <aside class="list-pane" id="rule-pane" aria-label="Rules"></aside>
        <div class="rule-mid">
        <section class="card">
          <div class="card-head"><h2>What each threshold buys and costs</h2>
            <div class="legend"><span><i style="background:var(--accent);height:8px;opacity:.55"></i>Friction removed ${info("removed")}</span><span><i style="background:var(--fraud)"></i>Fraud still caught</span></div></div>
          <div class="chart-box" id="curve"></div>
          <div class="slider-row">
            <div class="threshold-line"><strong>Threshold</strong>
              <input class="threshold-input" id="threshold-input" aria-label="Threshold value" ${r.sweepable === false ? "disabled" : ""}>
              <span class="muted">today: ${fmtVal(r.grid[0], r.unit)} · drag, or type ${r.unit === "usd" ? "an amount" : "a value"}</span>
              ${state.policy === "segment" ? `<span class="tag tag-free">Applied to tenured, high-friction clients only</span>` : ""}</div>
            <div class="slider" id="slider" role="slider" tabindex="0" aria-label="Threshold"></div>
          </div>
        </section>
        <section class="card" id="by-type"></section>
        <details class="card more" ${state.detailsOpen ? "open" : ""} id="more">
          <summary><h2>Details</h2><span class="card-note">Full dollar ledger, who the change applies to, method</span></summary>
          <div class="policy"><span>Apply the new threshold to</span>
            <div class="seg" role="group" aria-label="Apply to">
              <button type="button" data-policy="global" aria-pressed="${state.policy === "global"}">All clients</button>
              <button type="button" data-policy="segment" aria-pressed="${state.policy === "segment"}">Tenured clients above the ${ordinal(D.config.high_friction_percentile)} percentile</button></div></div>
          <div id="dollars"></div>
          <p class="chart-caption">The shaded band is the range across ${NW} ordering-consistent friction weightings. Fraud caught does not depend on weights.</p>
        </details>
        </div>
        <div class="rule-right" style="display:grid;gap:16px;min-width:0">
          <section class="card" id="compare"></section>
          <section class="card" id="softer" hidden></section>
          <section class="card" id="next-step"></section>
        </div>
      </div>
      ${footer()}`;

    wireCommon();
    renderRulePane();
    view.querySelectorAll("[data-policy]").forEach((b) => (b.onclick = () => { state.policy = b.dataset.policy; renderRule(); }));
    const more = document.getElementById("more");
    more.addEventListener("toggle", () => { state.detailsOpen = more.open; });
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

  // The same rule, cut by client type: where each type's fraud starts, and what the current
  // setting does for each. A rule can carry its own threshold per client type.
  function renderByType(r, i, pts) {
    const box = document.getElementById("by-type");
    const cv = r.windows[state.win].curve, types = D.client_types;
    if (!pts[0].by_group) { box.hidden = true; return; }
    const rows = types.map((t, k) => ({ t, k, ints: pts[0].by_group[k][2], fraud: pts[0].by_group[k][1],
      removed: pts[i].by_group[k][0], still: pts[i].by_group[k][1], flat: cv.group_flat[k] }))
      .filter((x) => x.ints || x.fraud);
    if (rows.length < 2 || r.shadow) { box.hidden = true; return; }
    box.hidden = false;
    const safeTo = (x) => (!x.fraud ? '<span class="muted">no fraud seen</span>'
      : x.flat === 0 ? '<span class="tag tag-none">Keep as is</span>' : `<span class="tag tag-free">Safe to ${fmtVal(r.grid[x.flat], r.unit)}</span>`);
    const withFraud = rows.filter((x) => x.fraud), without = rows.filter((x) => !x.fraud);
    const ends = [...new Set(withFraud.map((x) => x.flat))];
    const take = without.length && withFraud.length
      ? `${withFraud.map((x) => `${TYPE_LABELS[x.t]} fraud starts past ${fmtVal(r.grid[x.flat], r.unit)}`).join("; ")}. ${without.map((x) => TYPE_LABELS[x.t]).join(" and ")} clients show <b>no fraud on this rule</b> in this window, so one threshold for everyone may be stricter than they need.`
      : ends.length > 1 ? "Where fraud starts differs by client type, so a threshold per type could remove more friction than one for everyone."
      : "Fraud starts at the same point for every client type this rule touches.";
    box.innerHTML = `<div class="card-head"><h2>By client type</h2><span class="card-note">${periodNote()}</span></div>
      <p class="grid-take">${take}</p>
      <div class="table-scroll"><table class="type-table"><thead><tr><th>Client type</th><th class="c">Interventions that found no fraud</th><th class="c">Fraud cases caught</th>
        <th>Safe range</th><th class="c">At ${fmtVal(r.grid[i], r.unit)}: removed</th><th class="c">Fraud still caught</th></tr></thead><tbody>
      ${rows.map((x) => `<tr><td><b>${TYPE_LABELS[x.t]}</b></td><td class="c">${fmtInt(x.ints)}</td><td class="c">${fmtInt(x.fraud)}</td><td>${safeTo(x)}</td>
        <td class="c">${i ? fmtInt(x.removed) : "—"}</td><td class="c ${x.still < x.fraud ? "bad-text" : ""}">${x.fraud ? `${x.still} of ${x.fraud}` : "—"}</td></tr>`).join("")}</tbody></table></div>
      ${without.length ? '<p class="card-note" style="margin-top:8px">No fraud seen in one window is not proof of no risk: check the 12-month view before relaxing a rule further for one client type.</p>' : ""}`;
  }

  // For an amount rule: hold only the part above the threshold and settle the rest (the API's hold
  // ceiling), instead of holding or denying the whole payment.
  function renderSofter(r, i, p, T) {
    const box = document.getElementById("softer");
    const ok = r.feature === "amount" && r.op === ">" && !r.shadow && typeof T === "number" && p.rule_interventions != null;
    if (!ok) { box.hidden = true; return; }
    box.hidden = false;
    const released = T * p.rule_interventions, leak = T * (p.fraud_prevailing_rule || 0);
    box.innerHTML = `<div class="card-head"><h2>Softer option: hold only the part above ${fmtVal(T, r.unit)}</h2></div>
      <p class="why-text" style="margin:4px 0 12px">Instead of holding or denying the whole payout, settle the first ${fmtVal(T, r.unit)} and hold the rest.</p>
      <div class="soft-stats">
        <div class="big-stat pos"><div class="value">${fmtUsd(released)}</div><div class="label">more released to good clients, at once</div>
          <div class="sub">${fmtVal(T, r.unit)} on each of ${fmtInt(p.rule_interventions)} payouts that found no fraud</div></div>
        <div class="big-stat ${leak ? "bad" : ""}"><div class="value">${fmtUsd(leak)}</div><div class="label">of fraud let through</div>
          <div class="sub">${p.fraud_prevailing_rule ? `${fmtVal(T, r.unit)} on each of ${fmtInt(p.fraud_prevailing_rule)} fraud payouts; the rest stays held` : "no fraud payouts at this setting"}</div></div>
      </div>
      <p class="card-note">Uses the payment API's hold ceiling. Changes the action, not the threshold.</p>`;
  }

  let curveGeo = null;
  function drawCurve(r) {
    const box = document.getElementById("curve");
    const cv = r.windows[state.win].curve, pts = ptsOf(r);
    const width = Math.max(300, box.clientWidth), H = 300;
    const m = { l: 40, r: 14, t: 26, b: 40 };
    const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, role: "img", "aria-label": `Tradeoff curve for ${rn(r.rule_id)}` }, box);
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
      txt(svg, fx0, m.t + ih - 46, "Safe to relax", { class: "t-strong", "text-anchor": anchor });
      txt(svg, fx0, m.t + ih - 31, "Fraud caught is unchanged", { class: "t-ink", "text-anchor": anchor });
      txt(svg, fx0, m.t + ih - 16, `all the way to ${fmtVal(r.grid[fl], r.unit)}`, { class: "t-ink", "text-anchor": anchor });
    }
    if (fl > 0 && fl < n - 1 && cv.base_fraud_caught_rule > 0) {
      el("line", { x1: xs(fl), x2: xs(fl), y1: m.t, y2: m.t + ih, stroke: "var(--accent-ink)", "stroke-dasharray": "3 3" }, svg);
      if (iw - (xs(fl) - m.l) > 120) {
        txt(svg, xs(fl) + 8, ys(24), `Past ${fmtVal(r.grid[fl], r.unit)},`, {});
        txt(svg, xs(fl) + 8, ys(24) + 14, "fraud starts", {});
        txt(svg, xs(fl) + 8, ys(24) + 28, "slipping through", {});
      }
    }
    txt(svg, xs(0) + 4, m.t - 10, "Today", { style: "fill:var(--ink);font-weight:600" });

    const band = pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.pct[2]).toFixed(1)}`).join("")
      + pts.slice().reverse().map((p, j) => `L${xs(n - 1 - j).toFixed(1)},${ys(p.pct[1]).toFixed(1)}`).join("") + "Z";
    svg.insertAdjacentHTML("afterbegin", '<defs><linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".16"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>');
    el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.pct[0]).toFixed(1)}`).join("") + `L${xs(n - 1).toFixed(1)},${ys(0).toFixed(1)}L${xs(0).toFixed(1)},${ys(0).toFixed(1)}Z`, fill: "url(#curveFill)" }, svg);
    el("path", { d: band, fill: "var(--accent-band)" }, svg);
    el("path", { d: pts.map((p, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(p.pct[0]).toFixed(1)}`).join(""), fill: "none", stroke: "var(--accent)", "stroke-width": 2.5, "stroke-linejoin": "round" }, svg);
    const base = cv.base_fraud_caught_rule;
    const fraudPct = pts.map((p) => (base ? (100 * p.fraud_caught_rule) / base : 100));
    if (base) el("path", { d: fraudPct.map((v, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(""), fill: "none", stroke: "var(--fraud)", "stroke-width": 2, "stroke-linejoin": "round" }, svg);

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
      t.setAttribute("x", bx + 6); t.setAttribute("y", by + 14);
      const rect = el("rect", { x: bx, y: by, width: w, height: 20, rx: 10, fill: "var(--surface)", stroke: color || "var(--fraud)" });
      g.marker.insertBefore(rect, t);
    };
    if (base) {
      el("circle", { cx: x, cy: g.ys(g.fraudPct[i]), r: 5, fill: "var(--surface)", stroke: "var(--fraud)", "stroke-width": 2 }, g.marker);
      callout(x, g.ys(g.fraudPct[i]), `${pct(g.fraudPct[i])} caught`, null, true);
    }
    el("circle", { cx: x, cy: g.ys(p.pct[0]), r: 5, fill: "var(--surface)", stroke: "var(--accent)", "stroke-width": 2.5 }, g.marker);
    if (i > 0) callout(x, g.ys(p.pct[0]), `${pct(p.pct[0])} removed`, "var(--accent-ink)", false);
    // slider
    const s = g.slider;
    s.thumb.style.left = x * s.scale + "px";
    s.fill.style.width = Math.max(0, x * s.scale - s.left) + "px";
    s.slider.setAttribute("aria-valuemin", 0); s.slider.setAttribute("aria-valuemax", r.grid.length - 1);
    s.slider.setAttribute("aria-valuenow", i); s.slider.setAttribute("aria-valuetext", r.expressions[i]);
    document.getElementById("threshold-input").value = fmtVal(T, r.unit);

    renderDollars(r, i, pts);

    // comparison card
    const lost = base - p.fraud_caught_rule;
    const who = state.policy === "segment" ? " for tenured clients above the high-friction line" : "";
    let statement;
    if (r.shadow) statement = `${rn(r.rule_id)} runs in shadow: it logs what it would have done and no client pays for it. Nothing to remove.`;
    else if (i === 0) statement = `At today's setting, ${rn(r.rule_id)} interrupts clients ${fmtInt(rw.interventions)} times ${periodPhrase()}, across ${fmtInt(rw.fired.clients)} clients. Move the threshold to see what loosening it buys.`;
    else {
      const head = `${verbFor(r)} ${rn(r.rule_id)} from ${fmtVal(r.grid[0], r.unit)} to ${fmtVal(T, r.unit)}${who} removes ${fmtInt(p.interventions_removed)} interventions from ${fmtInt(p.clients_affected)} clients ${periodPhrase()}`;
      statement = lost <= 0 ? `${head}, and catches the same ${base} fraud case${base === 1 ? "" : "s"}.`
        : `${head}, but misses ${lost} of the ${base} fraud cases it catches today.`;
    }
    const ex = rw.example;
    const cmp = document.getElementById("compare");
    const freedUsd = p.freed ? p.freed.usd : 0;
    cmp.innerHTML = `<div class="card-head"><h2>At ${fmtVal(T, r.unit)}, compared with today</h2><span class="card-note">${periodNote()}</span></div>
      <div class="big-stats">
        <div class="big-stat"><div class="value">${fmtInt(p.interventions_removed)}</div>
          <div class="label">fewer interventions, ${fmtInt(p.clients_affected)} clients no longer interrupted</div>
          <div class="sub">${pct(p.pct[0])} of this rule's friction (range ${pct(p.pct[1])}–${pct(p.pct[2])})</div></div>
        ${freedUsd ? `<div class="big-stat"><div class="value">${fmtUsd(freedUsd)}</div>
          <div class="label">of payouts no longer held or denied</div>
          <div class="sub">${fmtInt(p.freed.wait_days)} fewer days of payout hold time · ${fmtInt(p.freed.review_hours)} fewer review hours</div></div>` : ""}
        <div class="big-stat ${lost > 0 ? "bad" : "good"}"><div class="value">${base ? `${p.fraud_caught_rule} of ${base}` : "—"}</div>
          <div class="label">fraud cases still caught</div>
          <div class="sub">${!base ? "This rule caught no fraud in this window" : lost <= 0 ? "Everything it catches today, it still catches" : `Misses ${lost} it catches today`}</div></div>
      </div>
      <p class="statement">${esc(statement)}</p>
      ${ex && i > 0 ? `<p class="example">Example: <a href="#client/${ex.client_id}">${esc(ex.name)}</a> goes from ${ex.baseline} intervention${ex.baseline === 1 ? "" : "s"} to ${pts === cv.points ? p.example_interventions : cv.points[i].example_interventions}</p>` : ""}`;

    wireInfo(cmp);
    renderByType(r, i, pts);
    renderSofter(r, i, p, T);

    // next step
    const ns = document.getElementById("next-step");
    const canTest = !r.shadow && i > 0 && lost <= 0 && p.interventions_removed > 0;
    if (!canTest) {
      ns.innerHTML = `<h2>Next step</h2><p class="why-text">${r.shadow ? "This rule is already a shadow test: its hits show what clients would have paid, without anyone paying." :
        cv.verdict === "none" ? `No relaxation to test: the first step already misses fraud this rule catches. ${rn(r.rule_id)} is earning its friction.` :
        lost > 0 ? `This setting misses fraud. Move the threshold back inside the safe range (up to ${fmtVal(r.grid[cv.flat_index], r.unit)}) to propose a shadow test.` :
        "Pick a looser threshold to propose a shadow test."}</p><p class="card-note">Recommendation only. Nothing on this screen changes a live rule.</p>`;
      return;
    }
    const expr = r.expressions[i];
    ns.innerHTML = `<h2>Next step: test it on live traffic, safely</h2>
      <p class="why-text" style="margin-bottom:0">Run a copy of this rule at ${fmtVal(T, r.unit)} in shadow mode. It sees real traffic and logs what it would have done, but never touches a client. After 30 days, compare it with the live rule.</p>
      <ol class="steps"><li><span class="n">1</span>Clone ${esc(rn(r.rule_id))} at ${fmtVal(T, r.unit)}, shadow on</li>
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
  function renderDollars(r, i, pts) {
    const card = document.getElementById("dollars");
    const a = pts[0], b = pts[i], A = a.ledger, B = b.ledger;
    if (!A) { card.innerHTML = ""; return; }
    const T = r.grid[i];
    const sign = (v, f) => (Math.abs(v) < 0.5 ? "no change" : (v > 0 ? "+" : "−") + f(Math.abs(v)));
    const rows = [];
    const add = (label, va, vb, f, key, show) => { if (show === false) return; rows.push(`<tr><td>${label}${key ? " " + info(key) : ""}</td><td class="num">${f(va)}</td><td class="num">${f(vb)}</td><td class="num delta">${sign(vb - va, f)}</td></tr>`); };
    const usdN = (u, n) => `${fmtUsd(u)} <span class="muted">(${fmtInt(n)})</span>`;
    add("Interventions that found no fraud", A.n, B.n, fmtInt, "nofraud");
    add("Clients interrupted by this rule", A.clients, B.clients, fmtInt);
    rows.push(`<tr><td>Legitimate payouts denied</td><td class="num">${usdN(A.denied_usd, A.denied_n)}</td><td class="num">${usdN(B.denied_usd, B.denied_n)}</td><td class="num delta">${sign(B.denied_usd - A.denied_usd, fmtUsd)}</td></tr>`);
    rows.push(`<tr><td>Legitimate payouts held</td><td class="num">${usdN(A.held_usd, A.held_n)}</td><td class="num">${usdN(B.held_usd, B.held_n)}</td><td class="num delta">${sign(B.held_usd - A.held_usd, fmtUsd)}</td></tr>`);
    add("Payout hold time (days)", A.wait_days, B.wait_days, fmtInt, "hold", A.wait_days > 0);
    if (A.limited_n) rows.push(`<tr><td>Settlement limited</td><td class="num">${usdN(A.limited_usd, A.limited_n)}</td><td class="num">${usdN(B.limited_usd, B.limited_n)}</td><td class="num delta">${sign(B.limited_usd - A.limited_usd, fmtUsd)}</td></tr>`);
    add("Ops review hours", A.review_hours, B.review_hours, fmtInt, "review", A.reviews > 0);
    rows.push(`<tr class="sep"><td>Fraud caught by this rule</td><td class="num">${a.fraud_caught_rule} <span class="muted">(${fmtUsd(a.fraud_usd_rule || 0)})</span></td><td class="num">${b.fraud_caught_rule} <span class="muted">(${fmtUsd(b.fraud_usd_rule || 0)})</span></td><td class="num delta">${sign(b.fraud_caught_rule - a.fraud_caught_rule, fmtInt)}</td></tr>`);
    if (a.fraud_caught_rule) {
      const ra = a.rule_interventions_all / a.fraud_caught_rule, rb = b.fraud_caught_rule ? b.rule_interventions_all / b.fraud_caught_rule : null;
      rows.push(`<tr><td>Ratio: interventions per fraud case ${info("perfraud")}</td><td class="num">${fmt1(ra)} : 1</td><td class="num">${rb == null ? "—" : fmt1(rb) + " : 1"}</td><td class="num delta"></td></tr>`);
      const la = A.denied_usd + A.held_usd, lb = B.denied_usd + B.held_usd;
      if (la && a.fraud_usd_rule) rows.push(`<tr><td>Legitimate dollars held or denied per fraud dollar stopped</td><td class="num">$${(la / a.fraud_usd_rule).toFixed(2)}</td><td class="num">${b.fraud_usd_rule ? "$" + (lb / b.fraud_usd_rule).toFixed(2) : "—"}</td><td class="num delta"></td></tr>`);
    }
    card.innerHTML = `<h3 class="sub-h">Counting in dollars ${info("ledger")} <span class="card-note">this rule's own interventions, ${W().phrase}</span></h3>
      <div class="table-scroll"><table class="dollars"><thead><tr><th></th><th class="num">Today (${fmtVal(r.grid[0], r.unit)})</th><th class="num">At ${fmtVal(T, r.unit)}</th><th class="num">Change</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>
      <p class="card-note" style="margin-top:8px">Legitimate = never confirmed as fraud. Dollars are the payout amounts denied or held.${b.interventions_reattributed ? ` ${fmtInt(b.interventions_reattributed)} interventions move to another rule when this one stops firing, so the portfolio saves ${fmtInt(b.interventions_removed)}.` : ""}</p>`;
    wireInfo(card);
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
      `Applies to       ${state.policy === "segment" ? "tenured clients above the high-friction line" : "all clients"}`,
      ``,
      `Expected on the synthetic population (${W().phrase}):`,
      `  ${fmtInt(p.interventions_removed)} fewer interventions, ${pct(p.pct[0])} of this rule's friction (${pct(p.pct[1])}–${pct(p.pct[2])} across ${NW} weightings)`,
      `  ${fmtInt(p.clients_affected)} clients no longer interrupted, ${p.established_clients_affected} of them tenured`,
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
  })();
  // In-app links route directly ("#client" opens the client list; "#rule" keeps the current rule).
  document.addEventListener("click", (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const h = a.getAttribute("href");
    go(h === "#rule" ? "#rule/" + state.ruleId : h);
  });
  window.addEventListener("popstate", () => route(location.hash));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && state.cell && document.getElementById("cell-list")) closeCell(true); });
  window.addEventListener("hashchange", () => { if (location.hash !== routed) route(location.hash); });
  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
  route();
})();
