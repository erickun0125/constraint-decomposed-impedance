// Viewer step "Twists & PCA" (between "Sample" and "Impedance gains"): the sampled trajectories become body
// twists, PCA in se(3) ranks their directions, and the dimension is selected. Data: data.twist
// (stored body twists, scaled as (alpha*omega, v); spectrum sqrt(lambda_k);
// 6-D principal directions; thresholds). Each twist is drawn as a vector from the TCP, split for display into
// its linear part (blue) and angular part (purple); then the principal directions appear as axes whose length is
// proportional to sqrt(lambda_k), and those below max(kappa_rel sqrt(lambda_6), v_abs) fade.
import * as THREE from "three";

const BLUE = 0x0072b2, PURPLE = 0x7a5195, GREY = 0x9aa0a8;
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export const twistText = (m, thr) => `Consecutive poses of every sampled trajectory give body twists. PCA is computed on the full 6-D twists in se(3) (uncentered, weighted by α); for display, each twist and each principal direction is split at the TCP into its linear part (blue) and angular part (purple), and the bar colours in the panel show how each principal direction divides between the two. Axis length is the RMS grasp-point speed √λₖ; directions slower than max(κ_rel√λ₆, v_abs) = ${(thr * 1000).toFixed(1)} mm/s fade out, and the remaining ${m === 1 ? "m = 1 direction defines" : `m = ${m} directions define`} the feasible subspace.`;

function pointsMat(color, size) {
  return new THREE.PointsMaterial({ color, size, sizeAttenuation: false, transparent: true, opacity: 0.85, depthTest: false });
}

// variant a: twist cloud + principal axes at the TCP
function buildCloud(T, anchor, anchorQ) {
  const g = new THREE.Group();
  const H = T.twists_scaled[0].length;
  const norms = [];
  T.twists_scaled.forEach((s) => s.forEach((V) => { norms.push(Math.hypot(V[0], V[1], V[2]), Math.hypot(V[3], V[4], V[5])); }));
  norms.sort((x, y) => x - y);
  const scale = 0.085 / norms[Math.floor(0.98 * (norms.length - 1))];   // m per (m/s), shared by both parts
  // each twist as a vector from the TCP (uncentered PCA works on exactly these vectors); tips as dots
  const mk = (off, color) => {
    const seg = [], tip = [], wp = [], wpt = [];
    for (let t = 0; t < H; t++) T.twists_scaled.forEach((s) => {       // waypoint-major, so draw ranges grow by waypoint
      const V = s[t];
      const d = new THREE.Vector3(V[off], V[off + 1], V[off + 2]).multiplyScalar(scale).applyQuaternion(anchorQ);
      seg.push(anchor.x, anchor.y, anchor.z, anchor.x + d.x, anchor.y + d.y, anchor.z + d.z);
      tip.push(anchor.x + d.x, anchor.y + d.y, anchor.z + d.z);
      wp.push(t, t);
      wpt.push(t);
    });
    const grp = new THREE.Group();
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.16, depthTest: false }));
    lines.renderOrder = 11;
    lines.userData = { wp };
    const pg = new THREE.BufferGeometry();
    pg.setAttribute("position", new THREE.Float32BufferAttribute(tip, 3));
    const pts = new THREE.Points(pg, pointsMat(color, 3.0));
    pts.renderOrder = 11;
    pts.userData = { wp: wpt };
    grp.add(lines, pts);
    grp.userData = { parts: [lines, pts], H };
    return grp;
  };
  const lin = mk(3, BLUE), ang = mk(0, PURPLE);
  g.add(lin, ang);
  // principal directions: half-length = scale * sqrt(lambda_k) * |part|, kept ones solid, others grey
  const axes = new THREE.Group();
  T.U_scaled.forEach((u, k) => {
    const kept = k < T.m;
    [[3, BLUE], [0, PURPLE]].forEach(([off, col]) => {
      const dir = new THREE.Vector3(u[off], u[off + 1], u[off + 2]);
      const part = dir.length();
      if (part < 0.05) return;
      dir.normalize().applyQuaternion(anchorQ);
      const half = Math.max(0.006, scale * T.sqrt_lambda[k] * part * 1.6);
      const geo = new THREE.CylinderGeometry(kept ? 0.0028 : 0.0013, kept ? 0.0028 : 0.0013, 2 * half, 12);
      const mat = new THREE.MeshBasicMaterial({ color: kept ? col : GREY, transparent: true, opacity: 0, depthTest: false });
      const rod = new THREE.Mesh(geo, mat);
      rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      rod.position.copy(anchor);
      rod.renderOrder = 12;
      rod.userData = { kept };
      axes.add(rod);
    });
  });
  g.add(axes);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.005, 16, 12), new THREE.MeshBasicMaterial({ color: 0x16191f, depthTest: false }));
  dot.position.copy(anchor);
  dot.renderOrder = 13;
  g.add(dot);
  g.userData = { kind: "a", clouds: [lin, ang], axes };
  return g;
}

export function buildTwist(data) {
  const aq = data.anchor_quat;
  return buildCloud(data.twist, v3(data.ensemble.anchor), new THREE.Quaternion(aq[0], aq[1], aq[2], aq[3]));
}

// progress: seconds since the step started
export function updateTwist(g, tsec) {
  const grow = Math.min(1, tsec / 2.4);
  const reveal = (obj, H) => {                                    // entries are waypoint-major
    const wp = obj.userData.wp, lim = grow * H - 1e-9;
    let n = 0;
    while (n < wp.length && wp[n] < lim) n++;
    obj.geometry.setDrawRange(0, n);
  };
  if (g.userData.kind === "a") {
    g.userData.clouds.forEach((c) => {
      const dim = tsec > 3.6 ? Math.max(0.35, 1 - (tsec - 3.6) * 0.6) : 1;
      c.userData.parts.forEach((p, i) => {
        reveal(p, c.userData.H);
        p.material.opacity = (i === 0 ? 0.16 : 0.85) * dim;
      });
    });
    const ax = Math.min(1, Math.max(0, (tsec - 2.6) / 0.6));
    const fade = Math.min(1, Math.max(0, (tsec - 4.0) / 0.8));
    g.userData.axes.children.forEach((r) => { r.material.opacity = r.userData.kept ? ax : ax * (1 - 0.75 * fade); });
  }
  return { spectrum: tsec > 2.6, select: tsec > 4.0 };
}

// spectrum panel: sqrt(lambda_k) on a log scale with the threshold max(kappa_rel sqrt(lambda_6), v_abs).
// Each bar is split by width into the angular (purple) and linear (blue) share of its 6-D principal direction,
// |u_k[omega]|^2 : |u_k[v]|^2 in the PCA metric (the two shares sum to 1).
export function drawSpectrum(el, T, state) {
  const W = 300, H = 186, L = 44, R = 10, Tp = 26, B = 46;
  const lo = Math.log10(1e-4), hi = Math.log10(0.5);
  const y = (v) => Tp + (1 - (Math.log10(Math.max(v, 1e-4)) - lo) / (hi - lo)) * (H - Tp - B);
  const bw = (W - L - R) / 6;
  const C = { w: "#7a5195", v: "#0072b2", wOff: "#cdbfd8", vOff: "#c3d6e4" };
  let s = `<svg viewBox="0 0 ${W} ${H}" width="100%">`;
  [1e-4, 1e-3, 1e-2, 1e-1].forEach((v) => {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#e3e1da"/><text x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end" font-size="9.5" fill="#6b7280">${v * 1000 >= 1 ? v * 1000 : (v * 1000).toFixed(1)}</text>`;
  });
  T.sqrt_lambda.forEach((v, k) => {
    const u = T.U_scaled[k];
    const sw = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], sv = u[3] * u[3] + u[4] * u[4] + u[5] * u[5];
    const fw = sw / (sw + sv);
    const off = state.select && k >= T.m;
    const x0 = L + k * bw + 5, w = bw - 10, top = y(v), h = y(1e-4) - y(v);
    s += `<rect x="${x0}" y="${top}" width="${w * fw}" height="${h}" fill="${off ? C.wOff : C.w}"/>`;
    s += `<rect x="${x0 + w * fw}" y="${top}" width="${w * (1 - fw)}" height="${h}" fill="${off ? C.vOff : C.v}"/>`;
    s += `<text x="${L + k * bw + bw / 2}" y="${H - B + 13}" text-anchor="middle" font-size="10" fill="#3a404a">${k + 1}</text>`;
  });
  if (state.select) {
    s += `<line x1="${L}" x2="${W - R}" y1="${y(T.threshold)}" y2="${y(T.threshold)}" stroke="#d55e00" stroke-width="1.6" stroke-dasharray="5 3"/>`;
    s += `<text x="${W - R}" y="${y(T.threshold) - 4}" text-anchor="end" font-size="9.5" fill="#d55e00">max(κ_rel√λ₆, v_abs)</text>`;
  }
  s += `<text x="0" y="12" font-size="10.5" font-weight="600" fill="#16191f">√λₖ  (RMS speed, mm/s)</text>`;
  s += `<text x="${(W + L) / 2}" y="${H - B + 26}" text-anchor="middle" font-size="9.5" fill="#6b7280">principal direction k (6-D)${state.select ? ` · kept m = ${T.m}` : ""}</text>`;
  s += `<rect x="${L}" y="${H - 11}" width="9" height="9" fill="${C.w}"/><text x="${L + 13}" y="${H - 3}" font-size="9.5" fill="#3a404a">angular share</text>`;
  s += `<rect x="${L + 92}" y="${H - 11}" width="9" height="9" fill="${C.v}"/><text x="${L + 105}" y="${H - 3}" font-size="9.5" fill="#3a404a">linear share</text></svg>`;
  el.innerHTML = s;
}
