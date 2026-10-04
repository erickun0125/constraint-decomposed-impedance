// Interactive 3D viewer of a recorded simulation rollout:
// grasp -> trajectory ensemble -> twists and PCA -> impedance gains at the TCP -> execution with the force plot.
// Data: static/data/viewer_<task>.json (exported from the recorded simulation rollouts).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { buildTwist, updateTwist, drawSpectrum, twistText } from "./viewer_twist.js";

const root = document.getElementById("viewer");
const canvas = document.getElementById("v-canvas");
const stage = root.querySelector(".viewer-stage");
const captionEl = document.getElementById("v-caption");
const plotEl = document.getElementById("v-plot");
const timeEl = document.getElementById("v-time");
const legendEl = document.getElementById("v-gains");
const scrub = document.getElementById("v-scrub");
const specEl = document.getElementById("v-spec");

const COLORS = { exec: 0xd55e00, ground: 0xebe9e3, high: new THREE.Color(0x1b9e77), low: new THREE.Color(0xe0533d) };
const PLOT = {
  iso: { color: "#9aa0a8", label: "Iso", width: 1.6 },
  oracle: { color: "#16191f", label: "Oracle", width: 1.3, dash: "5 4" },
  ours: { color: "#0072b2", label: "Ours", width: 2.6 },
};
const TASKS = {
  revolute: { label: "Revolute", camDir: [-1.0, -0.9, 0.65] },
  cylindrical: { label: "Cylindrical", camDir: [-0.7, -0.55, 1.1] },
  planar: { label: "Planar", camDir: [-1.0, -0.4, 0.35] },
  u_joint: { label: "Universal", camDir: [0.25, -1.0, 0.45], zoom: 1.3 },
};
const SPAN_TEXT = {
  revolute: "Here: one linear direction along the handle's path, and the hinge direction as the rotation axis.",
  cylindrical: "Here: a plane of linear motion (around and along the shaft), and the shaft as the rotation axis.",
  planar: "Here: the board plane for linear motion, and the board normal as the rotation axis.",
  u_joint: "Here: a plane of linear motion around the joint centre, and all three rotation axes (the envelope of the two hinges).",
};
const STEP_TEXT = {
  1: "The gripper has just closed on the handle. Ours now samples the policy many times from this one observation.",
  2: "The sampled trajectories differ mostly along the directions the object allows.",
  3: (t) => `PCA of their twists gives the feasible subspace. The impedance gains are 6×6 matrices on twists: high along this subspace and low (×0.1) along its complement. They are not block-diagonal, since a feasible direction can couple rotation and translation (as for a handle moving on an arc). For display only, the view draws the linear part (blue) and the angular part (purple) of the subspace separately at the TCP and leaves out this rotation–translation coupling. ${SPAN_TEXT[t]}`,
  4: "Ours executes with these gains held fixed in the TCP frame; faded copies mark earlier poses. The plot compares the constraint-violating force of Iso, Ours, and Oracle on this same trial.",
};

// ---------- three.js setup ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf4f3ef);
const camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.01, 20);
camera.up.set(0, 0, 1);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.2;
controls.maxDistance = 3;

scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc9bd, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -0.7, right: 0.7, top: 0.7, bottom: -0.7, near: 0.1, far: 5 });
key.shadow.radius = 4;
key.shadow.bias = -0.0005;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(1, 0.8, 0.6);
scene.add(fill);
const ground = new THREE.Mesh(new THREE.CircleGeometry(3, 64), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
ground.receiveShadow = true;
scene.add(ground);

let gripperTemplate = null;
const gltfReady = new GLTFLoader().loadAsync("static/data/panda_gripper.glb").then((g) => {
  gripperTemplate = g.scene;
  gripperTemplate.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
});

// ---------- helpers ----------
const viridis = [[0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.53], [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551], [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318], [0.741, 0.873, 0.15], [0.993, 0.906, 0.144]];
function viridisAt(x) {
  const f = x * (viridis.length - 1), i = Math.min(viridis.length - 2, Math.floor(f)), t = f - i;
  const a = viridis[i], b = viridis[i + 1];
  return new THREE.Color().setRGB(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, THREE.SRGBColorSpace);
}
const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);
const setPose = (o, p) => { o.position.set(p[0], p[1], p[2]); o.quaternion.set(p[3], p[4], p[5], p[6]); };

function shapeMesh(shape, size, color) {
  let geo;
  if (shape === "cuboid") geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  else if (shape === "cylinder") { geo = new THREE.CylinderGeometry(size[0], size[0], size[1], 48); geo.rotateX(Math.PI / 2); }
  else geo = new THREE.SphereGeometry(size[0], 40, 24);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(color[0], color[1], color[2], THREE.SRGBColorSpace), roughness: 0.75 }));
  m.castShadow = true; m.receiveShadow = true;
  return m;
}
function tube(points, radius, color, segs, radial = 6) {
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v3)), segs, radius, radial, false);
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.5, transparent: true }));
  m.userData = { segs, radial };
  return m;
}
function setTubeFraction(m, f) {
  const n = Math.max(0, Math.min(m.userData.segs, Math.round(f * m.userData.segs)));
  m.geometry.setDrawRange(0, n * m.userData.radial * 6);
}
function glyphMat(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.35, depthTest: false, transparent: true, opacity: 0.95 });
}

const SPAN_COL = { v: 0x0072b2, w: 0x7a5195 };

// Span glyph in the TCP frame: the linear (v) and angular (omega) parts of the estimated feasible subspace,
// i.e. the directions along which Ours keeps the high gain. Rank 1 = line / axis, 2 = plane, 3 = all.
function spanGlyph(span, opacity = 1, curl = true) {
  const g = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0), zz = new THREE.Vector3(0, 0, 1);
  const mat = (c, o = 0.95) => { const m = glyphMat(c); m.opacity = o * opacity; m.side = THREE.DoubleSide; return m; };
  const lin = new THREE.Group(), ang = new THREE.Group();
  lin.name = "v"; ang.name = "w";
  const dbl = (d, L, r, m, grp) => {
    const sh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 2 * L, 14), m);
    sh.quaternion.setFromUnitVectors(up, d);
    grp.add(sh);
    for (const sg of [1, -1]) {
      const h = new THREE.Mesh(new THREE.ConeGeometry(r * 3.2, r * 7.5, 18), m);
      h.quaternion.setFromUnitVectors(up, d.clone().multiplyScalar(sg));
      h.position.copy(d).multiplyScalar(sg * L);
      grp.add(h);
    }
  };
  // linear part
  const V = span.v, vb = V.basis.map(v3);
  if (V.rank === 1) dbl(vb[0].normalize(), 0.075, 0.0032, mat(SPAN_COL.v), lin);
  else if (V.rank === 2) {
    const n = v3(V.normal).normalize();
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.068, 72), mat(SPAN_COL.v, 0.26));
    disk.quaternion.setFromUnitVectors(zz, n);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.0018, 8, 96), mat(SPAN_COL.v));
    rim.quaternion.copy(disk.quaternion);
    lin.add(disk, rim);
    vb.forEach((d) => dbl(d.normalize(), 0.06, 0.0022, mat(SPAN_COL.v), lin));
  } else if (V.rank === 3) {
    lin.add(new THREE.Mesh(new THREE.SphereGeometry(0.06, 40, 24), mat(SPAN_COL.v, 0.2)));
  }
  // angular part: axis + curl per basis direction
  const W = span.w;
  W.basis.map(v3).forEach((a, k) => {
    a.normalize();
    const m = mat(SPAN_COL.w);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, W.rank === 1 ? 0.2 : 0.12, 12), m);
    rod.quaternion.setFromUnitVectors(up, a);
    ang.add(rod);
    if (!curl) {
      for (const sg of [1, -1]) {
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 8), m);
        tip.position.copy(a).multiplyScalar(sg * (W.rank === 1 ? 0.1 : 0.06));
        ang.add(tip);
      }
      return;
    }
    const R = 0.026 + 0.006 * k;
    const ring = new THREE.Group();
    ring.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.003, 10, 72, Math.PI * 1.6), m));
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.0085, 0.02, 16), m);
    head.position.set(R, 0, 0);
    head.rotation.z = Math.PI;
    ring.add(head);
    ring.quaternion.setFromUnitVectors(zz, a);
    ang.add(ring);
  });
  g.add(lin, ang);
  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0055, 16, 12), mat(0x16191f));
  g.add(dot);
  g.traverse((o) => { o.renderOrder = 10; });
  return g;
}
const showPart = { v: true, w: true };
function applyPartVisibility(c) {
  const f = (grp) => grp.traverse((o) => { if (o.name === "v" || o.name === "w") o.visible = showPart[o.name]; });
  f(c.glyph);
  c.ghosts.children.forEach(f);
}

function buildTask(task, data) {
  const group = new THREE.Group();
  const objLinks = {};
  for (const [name, L] of Object.entries(data.object.links)) {
    const node = new THREE.Group();
    if (L.visible) node.add(shapeMesh(L.shape, L.size, L.color));
    objLinks[name] = node;
    group.add(node);
  }
  const h = data.object.handle;
  const hm = shapeMesh(h.shape, h.size, h.color);
  hm.position.set(h.pos[0], h.pos[1], h.pos[2]);
  hm.quaternion.set(h.quat[1], h.quat[2], h.quat[3], h.quat[0]);
  objLinks[h.parent].add(hm);
  const grip = {};
  const gr = gripperTemplate.clone(true);
  for (const n of data.gripper.nodes) {
    const node = gr.getObjectByName(n);
    if (node) {
      node.traverse((o) => { if (o.isMesh) o.material = o.material.clone(); });
      grip[n] = node;
      group.add(node);
    }
  }
  const ens = new THREE.Group();
  const n = data.ensemble.samples.length;
  data.ensemble.samples.forEach((pts, k) => ens.add(tube(pts, 0.0016, viridisAt(k / (n - 1)), 96)));
  group.add(ens);
  const glyph = spanGlyph(data.span);
  group.add(glyph);
  // faded copies along the executed path (step 4), revealed as playback passes them
  const ghosts = new THREE.Group();
  {
    const A = data.arms.ours, n0 = data.trigger_frame, n1 = A.t.length - 1, K = 5;
    for (let k = 0; k < K; k++) {
      const i = Math.round(n0 + (k / K) * (n1 - n0));
      const gh = spanGlyph(data.span, 0.32);
      gh.scale.setScalar(0.8);
      gh.position.copy(v3(A.tcp[i]));
      const q = A.tcp_quat[i];
      gh.quaternion.set(q[0], q[1], q[2], q[3]);
      gh.userData.frame = i;
      ghosts.add(gh);
    }
  }
  group.add(ghosts);
  const ours = data.arms.ours;
  const trailPts = ours.tcp.slice(data.trigger_frame).filter((_, k) => k % 2 === 0);
  const trail = tube(trailPts, 0.0022, COLORS.exec, trailPts.length * 3, 8);
  trail.material.transparent = false;
  group.add(trail);
  // "Twists & PCA" step (id 2.5)
  const twist = buildTwist(data);
  twist.visible = false;
  group.add(twist);
  return { task, data, group, objLinks, grip, ens, glyph, ghosts, trail, twist };
}

function applyFrame(c, i) {
  const A = c.data.arms.ours;
  i = Math.max(0, Math.min(A.t.length - 1, i));
  for (const [name, node] of Object.entries(c.objLinks)) if (A.object[name]) setPose(node, A.object[name][i]);
  for (const [name, node] of Object.entries(c.grip)) if (A.gripper[name]) setPose(node, A.gripper[name][i]);
  c.glyph.position.copy(v3(A.tcp[i]));
  const q = A.tcp_quat[i];
  c.glyph.quaternion.set(q[0], q[1], q[2], q[3]);
  return i;
}

function setFade(c, alpha) {
  const f = (o) => {
    if (!o.isMesh) return;
    o.material.transparent = alpha < 1;
    o.material.opacity = alpha;
    o.material.depthWrite = alpha >= 1;
  };
  Object.values(c.objLinks).forEach((n) => n.traverse(f));
  Object.values(c.grip).forEach((n) => n.traverse(f));
}

function frameCamera(c) {
  const box = new THREE.Box3();
  applyFrame(c, c.data.trigger_frame);
  Object.values(c.objLinks).forEach((n) => box.expandByObject(n));
  ground.position.z = box.min.z - 0.0005;
  c.data.ensemble.samples.forEach((s) => s.forEach((p) => box.expandByPoint(v3(p))));
  Object.values(c.grip).forEach((n) => box.expandByObject(n));
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const baseName = Object.keys(c.data.object.links)[0];
  const bq = c.data.arms.ours.object[baseName][c.data.trigger_frame];
  const dir = v3(TASKS[c.task].camDir).normalize().applyQuaternion(new THREE.Quaternion(bq[3], bq[4], bq[5], bq[6]));
  dir.z = Math.abs(dir.z) + 0.15;
  dir.normalize();
  const dist = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 0.78 * (TASKS[c.task].zoom || 1);
  camera.position.copy(center).addScaledVector(dir, dist);
  controls.target.copy(center);
  const tcp = v3(c.data.arms.ours.tcp[c.data.trigger_frame]);
  c.views = {
    wide: { pos: camera.position.clone(), target: center.clone() },
    close: { pos: tcp.clone().addScaledVector(dir, 0.5), target: tcp.clone() },
  };
  key.target.position.copy(center);
  key.position.copy(center).add(new THREE.Vector3(-0.6, -1.0, 1.6));
  controls.update();
}

// ---------- gain legend ----------
const RANK_WORD = { v: ["", "a line", "a plane", "all directions"], w: ["", "one axis", "two axes", "all three axes"] };
function drawLegend(c) {
  const S = c.data.span;
  const item = (k, name) => `<button class="g-item" data-part="${k}" aria-pressed="${showPart[k]}"><i style="background:#${new THREE.Color(SPAN_COL[k]).getHexString()}"></i>${name}<span>rank ${S[k].rank} · ${RANK_WORD[k][S[k].rank]}</span></button>`;
  legendEl.innerHTML = `<div class="g-title">High-gain (feasible) twist subspace</div><div class="g-sub">shown at the TCP, split for display into</div>${item("v", "Linear part")}${item("w", "Angular part")}<div class="g-sub">Complement: low gain (×0.1)</div>`;
  legendEl.querySelectorAll("[data-part]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.part;
    showPart[k] = !showPart[k];
    if (!showPart.v && !showPart.w) showPart[k === "v" ? "w" : "v"] = true;
    legendEl.querySelectorAll("[data-part]").forEach((x) => x.setAttribute("aria-pressed", showPart[x.dataset.part]));
    applyPartVisibility(c);
  }));
}

// ---------- plot ----------
let plotMap = null;
function drawPlot(c) {
  const W = 1000, H = 150, L = 46, R = 12, T = 14, B = 26;
  const arms = c.data.arms;
  const tmax = Math.max(...Object.values(arms).map((a) => a.t[a.t.length - 1]));
  const fmax = Math.max(...Object.values(arms).map((a) => Math.max(...a.f_perp))) * 1.08;
  const x = (t) => L + (t / tmax) * (W - L - R), y = (f) => T + (1 - f / fmax) * (H - T - B);
  let s = `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">`;
  const step = fmax > 16 ? 5 : fmax > 8 ? 2 : fmax > 4 ? 1 : 0.5;
  for (let v = 0; v <= fmax; v += step) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${+v.toFixed(1)}</text>`;
  for (let t = 0; t <= tmax + 1e-6; t += 1) s += `<text x="${x(t)}" y="${H - 8}" text-anchor="middle">${t} s</text>`;
  for (const k of ["iso", "oracle", "ours"]) {
    const a = arms[k], st = PLOT[k];
    const pts = a.t.map((t, i) => `${x(t).toFixed(1)},${y(a.f_perp[i]).toFixed(1)}`).join(" ");
    s += `<polyline points="${pts}" fill="none" stroke="${st.color}" stroke-width="${st.width}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ""}/>`;
  }
  s += `<line id="v-cursor" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#d55e00" stroke-width="1.5"/>`;
  s += `<text x="${L}" y="${T - 3}">‖f⊥‖ (N)</text></svg>`;
  s += `<div class="legend small plot-legend">${["iso", "ours", "oracle"].map((k) => `<span><i class="ln${PLOT[k].dash ? " dash" : ""}" style="${PLOT[k].dash ? "" : `background:${PLOT[k].color}`}"></i>${PLOT[k].label}${k === "oracle" ? " (sim only)" : ""}</span>`).join("")}</div>`;
  plotEl.innerHTML = s;
  plotMap = { L, R, W, tmax };
}
function valueAt(a, t) {
  if (t > a.t[a.t.length - 1] + 1e-6) return null;
  let i = 0;
  while (i < a.t.length - 1 && a.t[i + 1] <= t + 1e-9) i++;
  return a.f_perp[i];
}

// ---------- state & steps ----------
const cache = {};
let cur = null, step = 1, frame = 0, playing = false, growT = 0, lastTs = 0, twistT = 0, specState = "";
let tween = null;
function flyTo(view) {
  if (!view) return;
  tween = { t: 0, p0: camera.position.clone(), q0: controls.target.clone(), p1: view.pos.clone(), q1: view.target.clone() };
}

function setStep(s) {
  step = s;
  root.querySelectorAll("[data-step]").forEach((b) => b.setAttribute("aria-selected", +b.dataset.step === s ? "true" : "false"));
  root.classList.toggle("exec-mode", s === 4);
  root.classList.toggle("gain-mode", s >= 3);
  captionEl.textContent = s === 2.5 ? twistText(cur.data.twist.m, cur.data.twist.threshold)
    : typeof STEP_TEXT[s] === "function" ? STEP_TEXT[s](cur.task) : STEP_TEXT[s];
  root.classList.toggle("twist-mode", s === 2.5);
  cur.twist.visible = s === 2.5;
  twistT = 0;
  specState = "";
  cur.ens.visible = s === 2 || s === 2.5 || s === 3;
  cur.glyph.visible = s >= 3;
  cur.trail.visible = s === 4;
  cur.ghosts.visible = s === 4;
  applyPartVisibility(cur);
  setFade(cur, s === 3 || s === 2.5 ? 0.4 : 1);
  flyTo(s === 3 || s === 2.5 ? cur.views.close : cur.views.wide);
  if (s <= 3) {
    playing = false;
    frame = applyFrame(cur, cur.data.trigger_frame);
    if (s === 2) growT = 0;
    cur.ens.children.forEach((m) => { m.material.opacity = s === 3 ? 0.25 : s === 2.5 ? 0.12 : 1; setTubeFraction(m, s === 2 ? 0 : 1); });
  } else {
    frame = 0;
    playing = true;
  }
}

async function loadTask(task) {
  root.classList.add("loading");
  await gltfReady;
  if (!cache[task]) cache[task] = buildTask(task, await (await fetch(`static/data/viewer_${task}.json`, { cache: "no-cache" })).json());
  if (cur) scene.remove(cur.group);
  cur = cache[task];
  scene.add(cur.group);
  root.querySelectorAll("[data-task]").forEach((b) => b.setAttribute("aria-selected", b.dataset.task === task ? "true" : "false"));
  frameCamera(cur);
  drawLegend(cur);
  drawPlot(cur);
  setStep(step);
  if (tween) { camera.position.copy(tween.p1); controls.target.copy(tween.q1); tween = null; }
  root.classList.remove("loading");
  window.dispatchEvent(new CustomEvent("viewer:task", { detail: task }));
}

// ---------- loop ----------
function resize() {
  const w = stage.clientWidth, h = stage.clientHeight, pr = renderer.getPixelRatio();
  if (canvas.width !== Math.floor(w * pr) || canvas.height !== Math.floor(h * pr)) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}
let visible = false;
function tick(ts) {
  requestAnimationFrame(tick);
  if (!cur || !visible) return;
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0);
  lastTs = ts;
  resize();
  if (step === 2 && growT < 1) {
    growT = Math.min(1, growT + dt / 2.2);
    const e = 1 - Math.pow(1 - growT, 2);
    cur.ens.children.forEach((m) => setTubeFraction(m, e));
  }
  if (step === 2.5) {
    twistT += dt;
    const st = updateTwist(cur.twist, twistT);
    const key = st.spectrum ? (st.select ? "sel" : "spec") : "";
    if (key !== specState) {
      specState = key;
      root.classList.toggle("spec-on", !!key);
      if (key) drawSpectrum(specEl, cur.data.twist, st);
    }
  }
  if (step === 4) {
    const A = cur.data.arms.ours;
    if (playing) {
      frame += dt * cur.data.fps;
      if (frame >= A.t.length - 1 + cur.data.fps * 0.8) frame = 0;
    }
    const i = applyFrame(cur, Math.floor(frame));
    setTubeFraction(cur.trail, Math.max(0, (i - cur.data.trigger_frame) / Math.max(1, A.t.length - 1 - cur.data.trigger_frame)));
    cur.ghosts.children.forEach((gh) => { gh.visible = gh.userData.frame <= i; });
    const t = A.t[i];
    const c = document.getElementById("v-cursor");
    if (c && plotMap) { const xx = plotMap.L + (t / plotMap.tmax) * (plotMap.W - plotMap.L - plotMap.R); c.setAttribute("x1", xx); c.setAttribute("x2", xx); }
    if (document.activeElement !== scrub) scrub.value = String(i / (A.t.length - 1));
    const iso = valueAt(cur.data.arms.iso, t);
    timeEl.textContent = `t = ${t.toFixed(2)} s · ‖f⊥‖ Ours ${A.f_perp[i].toFixed(2)} N` + (iso !== null ? ` · Iso ${iso.toFixed(2)} N` : "");
  }
  if (tween) {
    tween.t = Math.min(1, tween.t + dt / 0.7);
    const e = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;
    camera.position.lerpVectors(tween.p0, tween.p1, e);
    controls.target.lerpVectors(tween.q0, tween.q1, e);
    if (tween.t >= 1) tween = null;
  }
  controls.update();
  renderer.render(scene, camera);
}

// ---------- UI ----------
root.querySelectorAll("[data-task]").forEach((b) => b.addEventListener("click", () => loadTask(b.dataset.task)));
root.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => setStep(+b.dataset.step)));
document.getElementById("v-play").addEventListener("click", () => { playing = !playing; });
scrub.addEventListener("input", () => {
  playing = false;
  frame = +scrub.value * (cur.data.arms.ours.t.length - 1);
});

let started = false;
new IntersectionObserver((es) => {
  visible = es[0].isIntersecting;
  if (visible && !started) {
    started = true;
    const qs = new URLSearchParams(location.search); // ?vtask=planar&vstep=3 (deep link / testing)
    if (qs.get("vstep")) step = +qs.get("vstep");
    loadTask(qs.get("vtask") || "revolute");
    requestAnimationFrame(tick);
  }
}, { rootMargin: "200px" }).observe(root);
