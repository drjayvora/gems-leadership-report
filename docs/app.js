/* GEMS admissions leadership report. Screens: #/funnel · #/productivity · #/roi · #/calls · #/notes
   Data arrives encrypted (docs/data.enc); the password derives the AES key in the browser. All numbers are computed here
   from lead/call/visit rows, so the filters (dates, school, source) apply everywhere. */
(() => {
  "use strict";
  const $ = s => document.querySelector(s);
  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "class") e.className = v; else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const k of kids.flat(9)) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  };
  const fmt = n => n == null || isNaN(n) ? "–" : Math.round(n).toLocaleString("en-IN");
  const fmt1 = n => n == null || isNaN(n) ? "–" : (Math.round(n * 10) / 10).toLocaleString("en-IN");
  const pct = (a, b) => b ? Math.round(100 * a / b) + "%" : "–";
  const inr = n => n == null || !isFinite(n) ? "–" : "₹" + Math.round(n).toLocaleString("en-IN");
  const dshort = d => new Date(d + "T00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } },
                  set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };

  let D, KEY, F;

  // ---------- crypto ----------
  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
  const decrypt = async (buf) => { const b = new Uint8Array(buf); return crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, KEY, b.slice(12)); };
  async function deriveRaw(pass) {
    const k = await (await fetch("key.json", { cache: "no-store" })).json();
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", salt: b64(k.salt), iterations: k.iter, hash: "SHA-256" }, base, 256);
  }
  async function open(raw) {
    KEY = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await decrypt(await (await fetch("data.enc", { cache: "no-store" })).arrayBuffer());
    const ds = new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"));
    D = JSON.parse(await new Response(ds).text());
    start();
  }
  function showGate(msg) {
    $("#gate").hidden = false; $("#top").hidden = $("#view").hidden = $("#filters").hidden = true;
    $("#gateErr").textContent = msg || "";
  }
  $("#gateForm").addEventListener("submit", async ev => {
    ev.preventDefault(); $("#unlockBtn").disabled = true; $("#gateErr").textContent = "Unlocking…";
    try {
      const raw = await deriveRaw($("#pw").value);
      await open(raw);
      if ($("#remember").checked) store.set("gems-lr-key", toB64(raw));
    } catch { $("#gateErr").textContent = "That password didn't work."; }
    $("#unlockBtn").disabled = false;
  });
  $("#lock").addEventListener("click", () => { store.set("gems-lr-key", null); location.hash = ""; location.reload(); });

  // ---------- filters ----------
  const inRange = d => d && d >= F.from && d <= F.to;
  const leadOk = l => inRange(l[0]) && (F.school < 0 || l[1] === F.school) && (F.source < 0 || l[2] === F.source);
  function filterBar() {
    const el = $("#filters"); el.innerHTML = ""; el.hidden = false;
    const date = (k, label) => h("label", {}, label, h("input", { type: "date", value: F[k], min: D.meta.start, max: D.meta.end,
      onchange: e => { F[k] = e.target.value || (k === "from" ? D.meta.start : D.meta.end); render(); } }));
    const sel = (k, label, opts) => h("label", {}, label, h("select", { onchange: e => { F[k] = +e.target.value; render(); } },
      h("option", { value: -1 }, "All"), opts.map(([v, t]) => h("option", { value: v, selected: F[k] === v ? "" : null }, t))));
    const quick = (t, days) => h("button", { type: "button", onclick: () => {
      F.to = D.meta.end; F.from = days ? new Date(Date.parse(D.meta.end) - (days - 1) * 864e5).toISOString().slice(0, 10) : D.meta.start; render(); } }, t);
    el.append(date("from", "From"), date("to", "To"),
      h("div", { class: "quick" }, quick("Season", 0), quick("Last 7 days", 7), quick("Today", 1)),
      sel("school", "School", D.schools.map((s, i) => [i, s.short]).filter(([i]) => D.leads.some(l => l[1] === i) || D.spend.some(x => x.school === D.schools[i].name))),
      sel("source", "Lead source", D.sources.map((s, i) => [i, s])),
      h("div", { class: "asof" }, `Season ${D.meta.season} · data as of ${D.meta.taken}`));
  }

  // ---------- table ----------
  function table(cols, rows, { total, sort } = {}) {
    let key = sort ?? 1, dir = -1;
    const wrap = h("div", { class: "tw" });
    const draw = () => {
      const c = cols[key];
      const rs = c ? [...rows].sort((a, b) => { const x = c.v(a), y = c.v(b); return (typeof x === "string" ? x.localeCompare(y) : (x ?? -1) - (y ?? -1)) * dir; }) : rows;
      const maxes = cols.map(c => c.bar ? Math.max(1, ...rows.map(r => c.v(r) || 0)) : 0);
      wrap.innerHTML = "";
      wrap.append(h("table", {},
        h("thead", {}, h("tr", {}, cols.map((c, i) => h("th", { class: (i === key ? "sorted" + (dir > 0 ? " asc" : "") : null), title: c.tip,
          onclick: () => { dir = key === i ? -dir : (i === 0 ? 1 : -1); key = i; draw(); } }, c.t)))),
        h("tbody", {}, rs.map(r => h("tr", {}, cols.map((c, i) => {
          const v = c.v(r), txt = (c.f || fmt)(v);
          if (c.bar) return h("td", {}, h("span", { class: "bar", style: `width:${Math.round(60 * (v || 0) / maxes[i])}px` }), txt);
          return h("td", {}, txt);
        }))),
        total ? h("tr", { class: "total" }, cols.map(c => h("td", {}, (c.f || fmt)(c.v(total))))) : null)));
    };
    draw(); return wrap;
  }

  // ---------- chart: single-series daily bars ----------
  function dailyBars(points, label) {
    const W = 760, H = 180, P = { l: 34, r: 8, t: 10, b: 24 };
    const max = Math.max(1, ...points.map(p => p[1])), n = points.length, bw = (W - P.l - P.r) / Math.max(n, 1);
    const y = v => H - P.b - (H - P.t - P.b) * v / max;
    const ticks = [0, Math.ceil(max / 2), max];
    const box = h("div", { class: "chart" }), tip = h("div", { class: "tip", hidden: "" });
    const ns = "http://www.w3.org/2000/svg", s = (t, a) => { const e = document.createElementNS(ns, t); for (const k in a) e.setAttribute(k, a[k]); return e; };
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });
    ticks.forEach(t => { svg.append(s("line", { x1: P.l, x2: W - P.r, y1: y(t), y2: y(t), class: "grid" })); const tx = s("text", { x: P.l - 6, y: y(t) + 3, "text-anchor": "end", class: "axis" }); tx.textContent = t; svg.append(tx); });
    const every = Math.ceil(n / 8);
    points.forEach(([d, v], i) => {
      const x = P.l + i * bw, bh = H - P.b - y(v);
      if (v) { const r = Math.min(4, bw / 2 - 1, bh); svg.append(s("path", { fill: "var(--bar)",
        d: `M${x + 1},${H - P.b} v${-(bh - r)} q0,${-r} ${r},${-r} h${Math.max(0, bw - 2 - 2 * r)} q${r},0 ${r},${r} v${bh - r} z` })); }
      const hit = s("rect", { x, y: P.t, width: bw, height: H - P.t - P.b, fill: "transparent" });
      hit.addEventListener("mouseenter", () => { tip.hidden = false; tip.textContent = `${dshort(d)}: ${v} ${label.toLowerCase()}`;
        tip.style.left = (100 * (x + bw / 2) / W) + "%"; tip.style.top = (100 * y(v) / H) + "%"; });
      hit.addEventListener("mouseleave", () => tip.hidden = true);
      svg.append(hit);
      if (i % every === 0) { const tx = s("text", { x: x + bw / 2, y: H - 6, "text-anchor": "middle", class: "axis" }); tx.textContent = dshort(d); svg.append(tx); }
    });
    box.append(svg, tip); return box;
  }
  const days = () => { const out = []; for (let t = Date.parse(F.from); t <= Date.parse(F.to); t += 864e5) out.push(new Date(t).toISOString().slice(0, 10)); return out; };

  // ---------- funnel ----------
  const STAGES = [["Leads", null], ["Visits scheduled", 4], ["Walk-ins (visits done)", 5], ["Applications", 6], ["Admissions", 7]];
  const count = ls => { const c = [ls.length, 0, 0, 0, 0]; for (const l of ls) { if (l[4]) c[1]++; if (l[5]) c[2]++; if (l[6]) c[3]++; if (l[7]) c[4]++; } return c; };
  const funnelCols = first => [
    { t: first, v: r => r.name, f: x => x },
    { t: "Leads", v: r => r.c[0], bar: true }, { t: "Visits scheduled", v: r => r.c[1] }, { t: "Walk-ins", v: r => r.c[2], tip: "Visits done" },
    { t: "Applications", v: r => r.c[3], tip: "Application fee paid" }, { t: "Admissions", v: r => r.c[4], tip: "Admission fee paid" },
    { t: "Lead → walk-in", v: r => r.c[0] ? r.c[2] / r.c[0] : null, f: x => x == null ? "–" : Math.round(100 * x) + "%" },
    { t: "Walk-in → application", v: r => r.c[2] ? r.c[3] / r.c[2] : null, f: x => x == null ? "–" : Math.round(100 * x) + "%" }];
  function viewFunnel() {
    const ls = D.leads.filter(leadOk), c = count(ls);
    const bySchool = D.schools.map((s, i) => ({ name: s.short, c: count(ls.filter(l => l[1] === i)) })).filter(r => r.c[0]);
    const bySource = D.sources.map((s, i) => ({ name: s, c: count(ls.filter(l => l[2] === i)) })).filter(r => r.c[0]);
    const srcCols = D.sources.map((s, i) => [s, i]).filter(([, i]) => ls.some(l => l[2] === i)).sort((a, b) => ls.filter(l => l[2] === b[1]).length - ls.filter(l => l[2] === a[1]).length);
    const mx = Math.max(1, ...bySchool.flatMap(r => srcCols.map(([, j]) => ls.filter(l => l[1] === D.schools.findIndex(s => s.short === r.name) && l[2] === j).length)));
    const per = days().map(d => [d, ls.filter(l => l[0] === d).length]);
    return [
      h("div", { class: "tiles" }, STAGES.map(([t], i) => h("div", { class: "tile" }, h("div", { class: "k" }, t), h("div", { class: "v" }, fmt(c[i])),
        h("div", { class: "s" }, i ? `${pct(c[i], c[0])} of leads` : `${dshort(F.from)} – ${dshort(F.to)}`)))),
      h("div", { class: "grid2" },
        h("section", { class: "card" }, h("h2", {}, "Admissions funnel"), h("p", { class: "sub" }, "Leads created in the period, and how far each has got so far."),
          h("div", { class: "funnel" }, STAGES.map(([t], i) => h("div", { class: "frow" }, h("div", {}, t),
            h("div", { class: "track" }, h("div", { class: "fill", style: `width:${100 * c[i] / Math.max(1, c[0])}%` })),
            h("div", { class: "n" }, fmt(c[i]), i ? h("span", {}, pct(c[i], c[i - 1]) + " of prev.") : null))))),
        h("section", { class: "card" }, h("h2", {}, "New leads per day"), h("p", { class: "sub" }, "Leads created each day, with the current filters."), dailyBars(per, "Leads"))),
      h("section", { class: "card" }, h("h2", {}, "By school"), h("p", { class: "sub" }, "Click a column to sort."),
        table(funnelCols("School"), bySchool, { total: { name: "Total", c } })),
      h("section", { class: "card" }, h("h2", {}, "By lead source"), table(funnelCols("Source"), bySource, { total: { name: "Total", c } })),
      h("section", { class: "card" }, h("h2", {}, "Leads by school and source"), h("p", { class: "sub" }, "Darker cells hold more leads."),
        h("div", { class: "tw" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "School"), srcCols.map(([s]) => h("th", {}, s)), h("th", {}, "Total"))),
          h("tbody", {}, bySchool.map(r => { const si = D.schools.findIndex(s => s.short === r.name);
            return h("tr", {}, h("td", {}, r.name), srcCols.map(([, j]) => { const n = ls.filter(l => l[1] === si && l[2] === j).length;
              return h("td", { class: "heat", style: n ? `background:color-mix(in oklab, var(--heat-1) ${Math.round(8 + 72 * n / mx)}%, var(--heat-0));color:${n / mx > .55 ? "#fff" : "inherit"}` : null }, n || ""); }),
              h("td", {}, h("b", {}, r.c[0]))); })))))
    ];
  }

  // ---------- productivity ----------
  function productivity() {
    const firstCall = new Map();   // "p|lead" -> earliest outgoing call datetime by p
    for (const k of D.calls) if (k[2] === "O" && k[5] >= 0) { const key = k[1] + "|" + k[5]; if (!firstCall.has(key) || k[6] < firstCall.get(key)) firstCall.set(key, k[6]); }
    const schoolOkLead = i => i >= 0 ? (F.school < 0 || D.leads[i][1] === F.school) && (F.source < 0 || D.leads[i][2] === F.source) : F.school < 0 && F.source < 0;
    return D.people.map((p, pi) => {
      const mine = D.leads.map((l, i) => [l, i]).filter(([l]) => l[8].includes(pi));
      const home = (() => { const c = {}; mine.forEach(([l]) => c[l[1]] = (c[l[1]] || 0) + 1); const b = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return b ? D.schools[b[0]].short : "–"; })();
      const assigned = mine.filter(([l]) => leadOk(l));
      const ks = D.calls.filter(k => k[1] === pi && inRange(k[0]) && schoolOkLead(k[5]));
      const out = ks.filter(k => k[2] === "O"), inc = ks.filter(k => k[2] === "I" && k[3]);
      const callDays = new Set(out.map(k => k[0])).size;
      const vb = D.visits.filter(v => v[1] === pi && inRange(v[0]) && (F.school < 0 || v[5] === F.school)).length;
      const vd = D.visits.filter(v => (v[1] === pi || v[2] === pi) && v[3] === "Done" && inRange(v[4]) && (F.school < 0 || v[5] === F.school)).length;
      const act = mine.filter(([l]) => (F.school < 0 || l[1] === F.school) && (F.source < 0 || l[2] === F.source));
      const hrs = assigned.map(([l, i]) => { const t = firstCall.get(pi + "|" + i); return t ? (Date.parse(t.replace(" ", "T")) - Date.parse(l[11].replace(" ", "T"))) / 36e5 : null; })
        .filter(x => x != null && x >= 0).sort((a, b) => a - b);
      return { name: p.name, role: p.role, home, assigned: assigned.length, untouched: assigned.filter(([l]) => l[9]).length,
        dials: out.length, dialled: new Set(out.filter(k => k[5] >= 0).map(k => k[5])).size, connects: out.filter(k => k[3]).length,
        talk: out.reduce((s, k) => s + (k[3] ? k[4] : 0), 0) / 60 + inc.reduce((s, k) => s + k[4], 0) / 60, incoming: inc.length,
        perDay: callDays ? out.length / callDays : null, callDays, vb, vd,
        apps: act.filter(([l]) => inRange(l[6])).length, adms: act.filter(([l]) => inRange(l[7])).length,
        firstHrs: hrs.length ? hrs[Math.floor(hrs.length / 2)] : null };
    });
  }
  function viewProductivity() {
    const rows = productivity().filter(r => r.assigned || r.dials || r.vb || r.vd || r.incoming);
    const sum = (rs, k) => rs.reduce((s, r) => s + (r[k] || 0), 0);
    const tot = rs => ({ name: "Total", home: "", assigned: sum(rs, "assigned"), untouched: sum(rs, "untouched"), dials: sum(rs, "dials"), dialled: sum(rs, "dialled"),
      connects: sum(rs, "connects"), talk: sum(rs, "talk"), incoming: sum(rs, "incoming"), vb: sum(rs, "vb"), vd: sum(rs, "vd"), apps: sum(rs, "apps"), adms: sum(rs, "adms"),
      perDay: null, firstHrs: null });
    const cols = school => [
      { t: "Counsellor", v: r => r.name, f: x => x }, ...(school ? [{ t: "School", v: r => r.home, f: x => x }] : []),
      { t: "Leads assigned", v: r => r.assigned, tip: "Leads created in the period that are assigned to this person" },
      { t: "Untouched", v: r => r.untouched, tip: "Assigned, still New, never dialled" },
      { t: "Dials", v: r => r.dials, bar: true }, { t: "Leads dialled", v: r => r.dialled },
      { t: "Connects", v: r => r.connects }, { t: "Connect rate", v: r => r.dials ? r.connects / r.dials : null, f: x => x == null ? "–" : Math.round(100 * x) + "%" },
      { t: "Talk (min)", v: r => r.talk, f: fmt, tip: "Connected outgoing plus answered incoming calls" },
      { t: "Dials / day", v: r => r.perDay, f: fmt1, tip: "Average on days with at least one dial" },
      { t: "Incoming answered", v: r => r.incoming },
      { t: "Visits scheduled", v: r => r.vb, tip: "Visits this person booked in the period" },
      { t: "Walk-ins", v: r => r.vd, tip: "Visits done that this person booked or conducted" },
      { t: "Applications", v: r => r.apps }, { t: "Admissions", v: r => r.adms },
      { t: "First call (hrs)", v: r => r.firstHrs, f: fmt1, tip: "Median hours from lead creation to this person's first dial" }];
    const pre = rows.filter(r => r.role === "Pre-sales"), sch = rows.filter(r => r.role === "School");
    const crmCalls = sum(sch, "dials");
    return [
      h("section", { class: "card" }, h("h2", {}, "Pre-sales: central admissions desk"),
        h("p", { class: "sub" }, "Calls, connects and visits in the period. Leads assigned counts leads created in the period."),
        table(cols(false), pre, { total: tot(pre), sort: 3 })),
      h("section", { class: "card" }, h("h2", {}, "School counsellors"),
        h("p", { class: "sub" }, "The school is where most of each counsellor's leads are. A lead handed over from the desk stays with both, so it counts for both."),
        table(cols(true), sch, { total: tot(sch), sort: 2 }),
        crmCalls < sum(pre, "dials") / 10 ? h("p", { class: "warnbox" }, `School counsellors logged ${fmt(crmCalls)} dials in the CRM in this period, against ${fmt(sum(pre, "dials"))} from the desk. If they call from personal phones, their calling isn't captured here.`) : null)
    ];
  }

  // ---------- spend & lead quality, by school ----------
  function viewROI() {
    const spend = D.spend.filter(x => inRange(x.date) && (F.school < 0 || x.school === D.schools[F.school].name));
    const srcOf = ch => new Set((D.channels[ch] || []).map(s => D.sources.indexOf(s)));
    const reached = new Set(D.calls.filter(k => k[3] && k[5] >= 0).map(k => k[5]));
    const bySchool = {};
    for (const x of spend) {
      const g = bySchool[x.school] ||= { school: x.school, agencies: new Set(), ch: {}, spend: 0, first: null, last: null, spread: false };
      g.agencies.add(x.agency); g.spend += x.spend; g.ch[x.channel] = (g.ch[x.channel] || 0) + x.spend; g.spread ||= x.spread;
      if (x.spend > 0) { g.first = !g.first || x.date < g.first ? x.date : g.first; g.last = !g.last || x.date > g.last ? x.date : g.last; }
    }
    const rows = Object.values(bySchool).map(g => {
      const si = D.schools.findIndex(s => s.name === g.school);
      const src = new Set(Object.keys(g.ch).flatMap(ch => [...srcOf(ch)]));
      const win = l => l[1] === si && l[0] >= g.first && l[0] <= g.last;
      const all = D.leads.map((l, i) => [l, i]).filter(([l]) => win(l));
      const paid = all.filter(([l]) => src.has(l[2]));
      // Spend before the school's first CRM lead can't be matched to leads: shown, but left out of the cost ratios.
      const firstLead = D.leads.filter(l => l[1] === si).reduce((m, l) => !m || l[0] < m ? l[0] : m, null);
      g.pre = spend.filter(x => x.school === g.school && (!firstLead || x.date < firstLead)).reduce((t, x) => t + x.spend, 0);
      g.matched = g.spend - g.pre;
      const ls = paid.map(([l]) => l), n = ls.length;
      const c = count(ls);
      return Object.assign(g, { name: D.schools[si]?.short || g.school, meta: g.ch.Meta || 0, google: g.ch.Google || 0, agency: [...g.agencies].join(", "),
        all: all.length, paid: n, c,
        reached: paid.filter(([, i]) => reached.has(i)).length, untouched: ls.filter(l => l[9]).length,
        junk: ls.filter(l => l[3] === "Junk").length, lost: ls.filter(l => l[3] === "Lost").length,
        hotwarm: ls.filter(l => l[12] === "Hot" || l[12] === "Warm").length });
    });
    const sum = k => rows.reduce((t, r) => t + (typeof r[k] === "number" ? r[k] : 0), 0);
    const tot = { name: "Total", agency: "", first: null, meta: sum("meta"), google: sum("google"), spend: sum("spend"), pre: sum("pre"), matched: sum("matched"),
      all: sum("all"), paid: sum("paid"), reached: sum("reached"), untouched: sum("untouched"), junk: sum("junk"), lost: sum("lost"), hotwarm: sum("hotwarm"),
      c: [0, 1, 2, 3, 4].map(i => rows.reduce((t, r) => t + r.c[i], 0)) };
    const per = (k, i) => r => r[k] && r.c[i] ? r[k] / r.c[i] : null;
    const share = (k) => ({ v: r => r.paid ? r[k] / r.paid : null, f: x => x == null ? "–" : Math.round(100 * x) + "%" });
    const costCols = [
      { t: "School", v: r => r.name, f: x => x },
      { t: "Agency", v: r => r.agency, f: x => x },
      { t: "Dates", v: r => r.first ? `${dshort(r.first)} – ${dshort(r.last)}` : "–", f: x => x, tip: "First and last day with spend in the selected dates" },
      { t: "Meta spend", v: r => r.meta, f: inr }, { t: "Google spend", v: r => r.google, f: inr },
      { t: "Total spend", v: r => r.spend, f: inr, bar: true },
      { t: "Paid leads", v: r => r.paid, tip: "CRM leads from the channels this school paid for (Meta = Meta, Instagram and Facebook ads; Google = Google Ads), in the spend dates" },
      { t: "CPL", v: r => r.paid ? r.matched / r.paid : null, f: inr, tip: "Cost per paid lead" },
      { t: "All leads", v: r => r.all, tip: "Every CRM lead for the school in the spend dates, any source" },
      { t: "Blended CPL", v: r => r.all ? r.matched / r.all : null, f: inr, tip: "Spend divided by all leads" },
      { t: "Walk-ins", v: r => r.c[2] }, { t: "Cost / walk-in", v: per("matched", 2), f: inr },
      { t: "Applications", v: r => r.c[3] }, { t: "Cost / application", v: per("matched", 3), f: inr },
      { t: "Admissions", v: r => r.c[4] }, { t: "Cost / admission", v: per("matched", 4), f: inr }];
    const qualCols = [
      { t: "School", v: r => r.name, f: x => x },
      { t: "Paid leads", v: r => r.paid, bar: true },
      { t: "Reached", ...share("reached"), tip: "At least one connected call" },
      { t: "Untouched", ...share("untouched"), tip: "Still New and never dialled" },
      { t: "Hot or warm", ...share("hotwarm"), tip: "Intent marked Hot or Warm by the counsellor" },
      { t: "Junk", ...share("junk") }, { t: "Lost", ...share("lost") },
      { t: "Visit scheduled", v: r => r.paid ? r.c[1] / r.paid : null, f: x => x == null ? "–" : Math.round(100 * x) + "%" },
      { t: "Walk-in", v: r => r.paid ? r.c[2] / r.paid : null, f: x => x == null ? "–" : Math.round(100 * x) + "%" },
      { t: "Application", v: r => r.paid ? r.c[3] / r.paid : null, f: x => x == null ? "–" : (Math.round(1000 * x) / 10) + "%" },
      { t: "Admission", v: r => r.paid ? r.c[4] / r.paid : null, f: x => x == null ? "–" : (Math.round(1000 * x) / 10) + "%" }];
    // Paid leads at schools with no spend data for that channel
    const missing = [];
    for (const ch of Object.keys(D.channels)) {
      const src = srcOf(ch);
      D.schools.forEach((s, si) => {
        if (spend.some(x => x.school === s.name && x.channel === ch)) return;
        const n = D.leads.filter(l => l[1] === si && src.has(l[2]) && leadOk(l)).length;
        if (n) missing.push({ name: s.short, ch, n });
      });
    }
    const spread = rows.some(r => r.spread);
    return [
      h("div", { class: "tiles" },
        h("div", { class: "tile" }, h("div", { class: "k" }, "Marketing spend"), h("div", { class: "v" }, inr(tot.spend)), h("div", { class: "s" }, `${rows.length} school${rows.length === 1 ? "" : "s"} with spend data`)),
        h("div", { class: "tile" }, h("div", { class: "k" }, "Paid leads"), h("div", { class: "v" }, fmt(tot.paid)), h("div", { class: "s" }, `CPL ${inr(tot.paid ? tot.matched / tot.paid : null)}`)),
        h("div", { class: "tile" }, h("div", { class: "k" }, "Walk-ins from paid leads"), h("div", { class: "v" }, fmt(tot.c[2])), h("div", { class: "s" }, `${inr(tot.c[2] ? tot.matched / tot.c[2] : null)} per walk-in`)),
        h("div", { class: "tile" }, h("div", { class: "k" }, "Applications from paid leads"), h("div", { class: "v" }, fmt(tot.c[3])), h("div", { class: "s" }, `${inr(tot.c[3] ? tot.matched / tot.c[3] : null)} per application`))),
      h("section", { class: "card" }, h("h2", {}, "Spend, leads and cost by school"),
        h("p", { class: "sub" }, "Spend is what the agencies report. Leads and every stage after them come from the CRM."),
        rows.length ? table(costCols, rows, { total: tot, sort: 5 }) : h("p", { class: "muted" }, "No spend data in these dates."),
        tot.pre ? h("p", { class: "warnbox" }, `${inr(tot.pre)} of this spend was before those schools had any leads in the CRM, so it can't be matched to leads. The cost columns use the remaining ${inr(tot.matched)}.`) : null,
        spread ? h("p", { class: "note" }, "Some agencies sent one total for a period. That total is spread evenly over its days, so a shorter date filter shows a pro-rated share.") : null),
      h("section", { class: "card" }, h("h2", {}, "Lead quality and funnel, paid leads"),
        h("p", { class: "sub" }, "Share of each school's paid leads at each stage so far."),
        rows.length ? table(qualCols, rows, { total: tot, sort: 1 }) : null),
      h("section", { class: "card" }, h("h2", {}, "Paid leads with no spend data yet"),
        h("p", { class: "sub" }, "Leads from paid channels at schools where no agency has sent spend for that channel in these dates."),
        missing.length ? table([{ t: "School", v: r => r.name, f: x => x }, { t: "Channel", v: r => r.ch, f: x => x }, { t: "CRM leads", v: r => r.n, bar: true }], missing, { sort: 2 })
          : h("p", { class: "muted" }, "Every paid lead in these dates has spend data."))
    ];
  }

  // ---------- calls ----------
  function viewCalls() {
    const cs = D.showcase || [];
    return [h("section", { class: "card" }, h("h2", {}, "Sample calls"),
      h("p", { class: "sub" }, "Recorded calls from the central admissions desk. Press play to listen."),
      cs.length ? h("div", { class: "calls" }, cs.map(c => {
        const box = h("div", { class: "card call" },
          h("h3", {}, `${c.counsellor} · ${c.school}`),
          h("div", { class: "meta" }, `${c.when} · ${Math.floor(c.dur_s / 60)} min ${c.dur_s % 60} s · ${c.outcome}`),
          h("p", {}, c.desc));
        const btn = h("button", { class: "btn", onclick: async () => {
          btn.disabled = true; btn.textContent = "Loading…";
          try {
            const plain = await decrypt(await (await fetch("rec/" + c.file)).arrayBuffer());
            const a = h("audio", { controls: "", src: URL.createObjectURL(new Blob([plain], { type: "audio/mpeg" })) });
            btn.replaceWith(a); a.play();
          } catch { btn.textContent = "Recording not available"; }
        } }, "▶ Play recording");
        box.append(btn); return box;
      })) : h("p", { class: "muted" }, "Recordings are being added."))];
  }

  // ---------- notes ----------
  function viewNotes() {
    const d = D.meta.definitions;
    return [h("section", { class: "card" }, h("h2", {}, "Definitions"),
      h("table", {}, h("tbody", {}, [["Lead", d.lead], ["Visit scheduled", d.visit_scheduled], ["Walk-in", d.visit_done], ["Application", d.application], ["Admission", d.admission],
        ["Funnel", "Counts leads created in the selected dates and how far each has progressed so far, so recent leads have had less time to convert."],
        ["Productivity", "Calls, visits, applications and admissions count when they happened, within the selected dates."],
        ["Spend and ROI", "Spend is what the agencies report, by school. Leads, walk-ins, applications and admissions come from the CRM, never from the agency's own counts. Paid leads are CRM leads from the channels the school paid for, created between its first and last day of spend."]]
        .map(([k, v]) => h("tr", {}, h("td", {}, h("b", {}, k)), h("td", { style: "text-align:left;white-space:normal" }, v)))))),
      h("section", { class: "card" }, h("h2", {}, "Data"),
        h("p", {}, `Season ${D.meta.season}, from ${dshort(D.meta.start)}. Source: GEMS CRM, refreshed ${D.meta.taken}. Duplicate leads are excluded. The report holds no parent names or contact details.`))];
  }

  // ---------- router ----------
  const VIEWS = { funnel: ["Funnel", viewFunnel], productivity: ["Productivity", viewProductivity], roi: ["Spend and ROI by school", viewROI], calls: ["Calls", viewCalls], notes: ["Definitions", viewNotes] };
  function render() {
    store.set("gems-lr-f", JSON.stringify(F));
    const name = (location.hash.match(/^#\/(\w+)/) || [])[1] in VIEWS ? location.hash.match(/^#\/(\w+)/)[1] : "funnel";
    document.querySelectorAll("#nav a").forEach(a => a.classList.toggle("on", a.dataset.nav === name));
    filterBar();
    $("#filters").hidden = name === "calls" || name === "notes";
    const v = $("#view"); v.innerHTML = "";
    v.append(h("h1", {}, VIEWS[name][0]), ...VIEWS[name][1]());
  }
  function start() {
    try { F = JSON.parse(store.get("gems-lr-f")); } catch {}
    if (!F || F.season !== D.meta.season) F = { season: D.meta.season, from: D.meta.start, to: D.meta.end, school: -1, source: -1 };
    if (F.to > D.meta.end || F.to === F.dataEnd) F.to = D.meta.end;
    F.dataEnd = D.meta.end;
    $("#gate").hidden = true; $("#top").hidden = $("#view").hidden = false;
    window.addEventListener("hashchange", render); render();
  }

  const saved = store.get("gems-lr-key");
  if (saved) open(b64(saved)).catch(() => { store.set("gems-lr-key", null); showGate(); }); else showGate();
})();
