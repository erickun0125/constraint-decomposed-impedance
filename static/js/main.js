(function () {
  "use strict";
  const D = window.PAGE_DATA;
  const NS = "http://www.w3.org/2000/svg";
  const C = { iso: "#9aa0a8", ours: "#0072b2", oracle: "#16191f", feas: "#1b9e77", cons: "#e0533d", line: "#e3e1da", ink2: "#3a404a", muted: "#6b7280" };

  // ---------- helpers ----------
  function el(tag, attrs, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs || {}) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function txt(parent, x, y, s, attrs) {
    const t = el("text", Object.assign({ x, y }, attrs || {}), parent);
    t.textContent = s;
    return t;
  }
  function svg(w, h) { return el("svg", { viewBox: `0 0 ${w} ${h}`, class: "chart", role: "img" }); }
  const fmt = (v) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));

  // ---------- nav ----------
  const nav = document.getElementById("topnav");
  const onScroll = () => nav.classList.toggle("show", window.scrollY > 420);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---------- math ----------
  if (window.renderMathInElement) {
    renderMathInElement(document.body, { delimiters: [{ left: "$", right: "$", display: false }], throwOnError: false });
  }

  // ---------- copy ----------
  document.querySelectorAll("[data-copy]").forEach((b) => {
    b.addEventListener("click", () => {
      const t = document.querySelector(b.dataset.copy).textContent;
      navigator.clipboard.writeText(t).then(() => { b.textContent = "Copied"; setTimeout(() => (b.textContent = "Copy"), 1400); });
    });
  });

  // ---------- real clips: step label synced to the clip (grasping -> ensemble overlay -> rollout) ----------
  fetch("static/data/real_timing.json", { cache: "no-cache" }).then((r) => r.json()).then((T) => {
    document.querySelectorAll(".real-media[data-clip]").forEach((box) => {
      const c = T.clips[box.dataset.clip];
      if (!c) return;
      const v = box.querySelector("video"), lab = box.querySelector(".real-step");
      const set = () => {
        const t = v.currentTime;
        const [txt, cls] = t < c.overlay_start_s ? ["Grasping", ""] : t < c.overlay_end_s ? ["Sampled trajectories", "ens"] : ["Ours executing", "exec"];
        if (lab.textContent !== txt) { lab.textContent = txt; lab.className = "real-step " + cls; }
      };
      v.addEventListener("timeupdate", set);
      set();
    });
  }).catch(() => {});

  // ---------- real clips: all five have the same length; start and restart them together ----------
  (function () {
    const grid = document.querySelector(".real-grid");
    if (!grid) return;
    const vids = [...grid.querySelectorAll("video")];
    let ended = 0, timer = null, inView = false;
    const restart = () => {
      ended = 0;
      clearTimeout(timer);
      timer = null;
      vids.forEach((v) => { v.currentTime = 0; });
      if (inView) vids.forEach((v) => v.play().catch(() => {}));
    };
    vids.forEach((v) => v.addEventListener("ended", () => {
      ended += 1;
      if (ended === vids.length) restart();
      else if (!timer) timer = setTimeout(restart, 600); // a straggler should not stall the group
    }));
    new IntersectionObserver((es) => {
      inView = es[0].isIntersecting;
      if (inView) vids.forEach((v) => { if (v.paused && !v.ended) v.play().catch(() => {}); });
      else vids.forEach((v) => v.pause());
    }, { threshold: 0.2 }).observe(grid);
  })();


  // ---------- tables ----------
  (function () {
    const t3 = (a, dec) => a ? a.map((v, i) => i === 1 ? `<b>${dec(v)}</b>` : dec(v)).join(" / ") : "– / – / –";
    const two = (v) => v.toFixed(2);
    let h = `<table class="data"><thead><tr><th>Task</th><th>SR (%)</th><th>SE (°)</th><th>ICF (N·s)</th><th>PCF (N)</th><th>ICM (N·m·s)</th><th>PCM (N·m)</th></tr></thead><tbody>`;
    Object.values(D.sim).forEach((r) => {
      h += `<tr><td>${r.label}</td><td>${r.sr.join(" / ")}</td><td>${r.se.toFixed(2)}</td><td>${t3(r.icf, fmt)}</td><td>${t3(r.pcf, fmt)}</td><td>${t3(r.icm, two)}</td><td>${t3(r.pcm, two)}</td></tr>`;
    });
    document.getElementById("sim-table").innerHTML = h + "</tbody></table>";

    const p = (a, dag) => `${fmt(a[0])} / <b>${fmt(a[1])}</b> (${a[2].toFixed(2)})${dag ? "†" : ""}`;
    h = `<table class="data"><thead><tr><th>Task</th><th>SE (°)</th><th>ICF (N·s)</th><th>PCF (N)</th><th>ICM (N·m·s)</th><th>PCM (N·m)</th></tr></thead><tbody>`;
    D.real.forEach((r) => {
      h += `<tr><td>${r.label}</td><td>${r.se.toFixed(2)}</td><td>${p(r.icf)}</td><td>${p(r.pcf)}</td><td>${p(r.icm, r.fullMoment)}</td><td>${p(r.pcm, r.fullMoment)}</td></tr>`;
    });
    document.getElementById("real-table").innerHTML = h + "</tbody></table>";
  })();

  // ---------- results as ratio tables with bullet bars (rows = objects, columns = metrics) ----------
  // Shared by the simulation and real-world sections. Each cell: Ours/Iso ratio, a bar with the Iso tick at 1.0
  // (and, in simulation, the Oracle/Iso marker), and the underlying means (Iso -> Ours).
  const METRICS = [
    { k: "icf", name: "Force impulse", abbr: "ICF", unit: "N·s" },
    { k: "pcf", name: "Peak force", abbr: "PCF", unit: "N" },
    { k: "icm", name: "Moment impulse", abbr: "ICM", unit: "N·m·s" },
    { k: "pcm", name: "Peak moment", abbr: "PCM", unit: "N·m" }
  ];
  const RMAX = 1.25;
  const pct = (r) => (Math.min(r, RMAX) / RMAX) * 100;
  // Paired bars on a common scale: grey = Iso (always 1.0), blue = Ours (Ours/Iso). The grey left uncovered is the
  // reduction; when Ours exceeds Iso, the excess is drawn in vermillion beyond the end of the grey bar.
  function bulletBar(ratio) {
    const w = pct(ratio), one = pct(1);
    const over = ratio > 1 ? `<i class="rb-over" style="left:${one}%;width:${w - one}%"></i>` : "";
    return `<span class="rb"><i class="rb-iso" style="width:${one}%"></i><i class="rb-ours" style="width:${Math.min(w, one)}%"></i>${over}</span>`;
  }
  function ratioTable(host, rows, opts) {
    let h = `<table class="ratio-table"><thead><tr><th></th>${METRICS.map((m) => `<th>${m.name}<span>${m.abbr}</span></th>`).join("")}</tr></thead><tbody>`;
    rows.forEach((r) => {
      h += `<tr data-key="${r.key || ""}"><th scope="row">${r.img ? `<img src="${r.img}" alt="">` : ""}<span><b>${r.title}</b>${r.sub}</span></th>`;
      METRICS.forEach((m) => {
        const c = r.cells[m.k];
        if (!c) { h += `<td><div class="rc-top"><b class="na">–</b></div><div class="rc-raw">${opts.naText || ""}</div></td>`; return; }
        const raw = c.iso != null ? `${fmt(c.iso)} → ${fmt(c.ours)} ${m.unit}${c.oracle != null ? `<br>Oracle ${fmt(c.oracle)}` : ""}` : "";
        h += `<td><div class="rc-top"><b class="${c.ratio > 1 ? "worse" : "better"}">${c.ratio.toFixed(2)}×</b>${c.mark ? `<sup>${c.mark}</sup>` : ""}</div>${bulletBar(c.ratio)}${raw ? `<div class="rc-raw">${raw}</div>` : ""}</td>`;
      });
      h += "</tr>";
    });
    host.innerHTML = h + "</tbody></table>";
  }

  // real world (Table 2; ratios as printed)
  (function () {
    const host = document.getElementById("real-ratio-table");
    if (!host) return;
    const IMG = { Revolute: "laptop_revolute", Prismatic: "drawer_prismatic", Helical: "screw_helical", Cylindrical: "phonestand_cylindrical", Crank: "grinder_crank" };
    const rows = D.real.map((r) => ({
      title: r.object, sub: r.label, img: `static/img/real_${IMG[r.label]}.webp`,
      cells: Object.fromEntries(METRICS.map((m) => [m.k, { iso: r[m.k][0], ours: r[m.k][1], ratio: r[m.k][2],
        mark: r.fullMoment && (m.k === "icm" || m.k === "pcm") ? "†" : "" }]))
    }));
    rows.push({ title: "Average", sub: "over objects", cells: Object.fromEntries(METRICS.map((m) => [m.k, { ratio: D.realAverage[m.k], mark: m.k === "icm" || m.k === "pcm" ? "‡" : "" }])) });
    ratioTable(host, rows, {});
  })();

  // simulation (Table 1; ratios from the unrounded means, static/data/sim_ratios.json)
  (function () {
    const host = document.getElementById("sim-ratio-table");
    if (!host) return;
    fetch("static/data/sim_ratios.json", { cache: "no-cache" }).then((r) => r.json()).then((R) => {
      const IMG = { revolute: "revolute", cylindrical: "cylindrical", planar: "planar", universal: "u_joint" };
      const rows = Object.keys(D.sim).map((key) => {
        const r = D.sim[key], q = R.tasks[key];
        return {
          key, title: r.label, sub: "", img: `static/img/sim_ensemble_${IMG[key]}.webp`,
          cells: Object.fromEntries(METRICS.map((m) => [m.k, q[m.k] ? { iso: r[m.k][0], ours: r[m.k][1],
            ratio: q[m.k].ours_ratio } : null]))
        };
      });
      ratioTable(host, rows, { naText: "no constrained rotation" });
      highlightSim(currentSim);
    });
  })();
  let currentSim = "revolute";
  function highlightSim(key) {
    currentSim = key;
    document.querySelectorAll("#sim-ratio-table tbody tr").forEach((tr) => tr.classList.toggle("sel", tr.dataset.key === key));
  }
  const VKEY = { revolute: "revolute", cylindrical: "cylindrical", planar: "planar", u_joint: "universal" };
  window.addEventListener("viewer:task", (e) => highlightSim(VKEY[e.detail] || "revolute"));
})();
