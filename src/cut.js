// 端数を「切る」：1 個に満たない分を、物差しの形から切り落とす。
// 形の三角形を平面で切り（向きに頼らない）、切り口は赤い面でふさぐ。切り落とした側は横へずれて消える。
import * as THREE from 'three';

const RED = '#C8372B';
const capMat = new THREE.MeshBasicMaterial({ color: RED, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

// 平面より手前（距離 <= 0）だけを残す。全部の属性を辺の上で補間する
function clipGeometry(src, plane) {
  const g = src.index ? src.toNonIndexed() : src;
  const names = Object.keys(g.attributes);
  const P = g.attributes.position;
  const dist = new Float32Array(P.count);
  const v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) dist[i] = plane.distanceToPoint(v.fromBufferAttribute(P, i));
  const out = {};
  for (const k of names) out[k] = [];
  const push = (i, j, t) => {
    for (const k of names) {
      const a = g.attributes[k], s = a.itemSize, arr = a.array, o = out[k];
      for (let c = 0; c < s; c++) { const x = arr[i * s + c]; o.push(j < 0 ? x : x + (arr[j * s + c] - x) * t); }
    }
  };
  const groups = g.groups.length ? g.groups : [{ start: 0, count: P.count, materialIndex: 0 }];
  const outGroups = [];
  for (const gr of groups) {
    const start = out.position.length / 3;
    const end = Math.min(gr.start + gr.count, P.count);
    for (let t0 = gr.start; t0 + 2 < end; t0 += 3) {
      const tri = [t0, t0 + 1, t0 + 2];
      if (dist[t0] <= 0 && dist[t0 + 1] <= 0 && dist[t0 + 2] <= 0) { push(t0, -1, 0); push(t0 + 1, -1, 0); push(t0 + 2, -1, 0); continue; }
      if (dist[t0] > 0 && dist[t0 + 1] > 0 && dist[t0 + 2] > 0) continue;
      const poly = [];
      for (let e = 0; e < 3; e++) {
        const i = tri[e], j = tri[(e + 1) % 3], di = dist[i], dj = dist[j];
        if (di <= 0) poly.push([i, -1, 0]);
        if ((di <= 0) !== (dj <= 0)) poly.push([i, j, di / (di - dj)]);
      }
      for (let k = 1; k + 1 < poly.length; k++) { push(...poly[0]); push(...poly[k]); push(...poly[k + 1]); }
    }
    const e2 = out.position.length / 3;
    if (e2 > start) outGroups.push({ start, count: e2 - start, materialIndex: gr.materialIndex ?? 0 });
  }
  if (!out.position.length) return null;
  const geo = new THREE.BufferGeometry();
  for (const k of names) {
    const a = g.attributes[k];
    geo.setAttribute(k, new THREE.BufferAttribute(new a.array.constructor(out[k]), a.itemSize, a.normalized));
  }
  if (src.groups.length) for (const gr of outGroups) geo.addGroup(gr.start, gr.count, gr.materialIndex);
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

// 2D の多角形（[[a, b], ...]）を三角形に分け、to3(a, b) で 3D に置いた形
function fillPolygon(poly, to3) {
  if (poly.length < 3) return null;
  const contour = poly.map(([a, b]) => new THREE.Vector2(a, b));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = [];
  for (const t of tris) for (const k of t) pos.push(...to3(contour[k].x, contour[k].y));
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// 物差しの形（obj の中の座標）：inside(x, z)・top(x, z)・ringAt(y)・box（足元の範囲）
// 東京ドーム：半径 1・高さ 1 の角の丸い四角に、空気膜の屋根（dome.js の domeGeometry と同じ式）
export function domeShape(wallF = 0.33) {
  const rr = (x, z) => Math.pow(Math.pow(Math.abs(x), 4) + Math.pow(Math.abs(z), 4), 0.25);
  const se = (t) => Math.pow(Math.pow(Math.abs(Math.cos(t)), 4) + Math.pow(Math.abs(Math.sin(t)), 4), -0.25);
  return {
    box: [-1, 1, -1, 1], H: 1,
    inside: (x, z) => rr(x, z) <= 1,
    top: (x, z) => {
      const r = rr(x, z);
      if (r > 1) return 0;
      if (r > 0.985) return wallF;
      return wallF + (1 - wallF) * Math.pow(Math.max(0, 1 - Math.pow(r / 0.985, 2.2)), 0.55);
    },
    ringAt: (y) => {
      let rho;
      if (y <= wallF) rho = 1 - 0.015 * (y / wallF);
      else rho = 0.985 * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, (y - wallF) / (1 - wallF)), 1 / 0.55)), 1 / 2.2);
      const out = [];
      for (let i = 0; i < 96; i++) { const t = (i / 96) * 2 * Math.PI, r = se(t) * rho; out.push([Math.cos(t) * r, Math.sin(t) * r]); }
      return out;
    },
  };
}
// 建物：足元の外形（obj の中の座標）を、高さ vis まで立てた柱として扱う
export function prismShape(ring, vis) {
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const [x, z] of ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  return { box: [minx, maxx, minz, maxz], H: vis, inside, top: (x, z) => (inside(x, z) ? vis : 0), ringAt: () => ring };
}

// 縦の切り口で、面積（または体積）の q だけ残る位置。n は obj の親の座標の水平な向き。n·p <= d の側を残す
export function cutOffset(obj, shape, n, q, byVolume = false) {
  obj.updateMatrix();
  const M = obj.matrix, N = 72, [x0, x1, z0, z1] = shape.box;
  const pts = [];
  let total = 0;
  const v = new THREE.Vector3();
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = x0 + ((i + 0.5) / N) * (x1 - x0), z = z0 + ((j + 0.5) / N) * (z1 - z0);
    if (!shape.inside(x, z)) continue;
    const w = byVolume ? shape.top(x, z) : 1;
    if (w <= 0) continue;
    v.set(x, 0, z).applyMatrix4(M);
    pts.push([v.x * n.x + v.z * n.z, w]); total += w;
  }
  pts.sort((a, b) => a[0] - b[0]);
  let acc = 0;
  for (const [p, w] of pts) { acc += w; if (acc >= q * total) return p; }
  return pts.length ? pts[pts.length - 1][0] : 0;
}

// 切り口の赤い面（obj の中の座標）。plane は obj の中の座標の平面（距離 <= 0 を残す）
function capGeometry(shape, plane) {
  const n = plane.normal, d = -plane.constant;   // n·p = d
  if (Math.abs(n.y) > 0.9) {
    // 水平に切る：その高さの外形
    const y = d / n.y;
    return fillPolygon(shape.ringAt(y), (a, b) => [a, y, b]);
  }
  // 縦に切る：切り口に沿って足元から屋根までの形をたどる
  const h = Math.hypot(n.x, n.z), nx = n.x / h, nz = n.z / h, dd = d / h;
  const mx = -nz, mz = nx;
  const [x0, x1, z0, z1] = shape.box, W = Math.max(Math.abs(x0), Math.abs(x1), Math.abs(z0), Math.abs(z1)) * 1.5;
  const S = 240, geos = [];
  let run = [];
  const flush = () => {
    if (run.length >= 2) {
      // 下の辺 → 屋根の線（逆順）で一周
      const ring = [[run[0][0], 0], [run[run.length - 1][0], 0], ...run.slice().reverse().map(([w, t]) => [w, t])];
      const g = fillPolygon(ring, (w, y) => [nx * dd + mx * w, y, nz * dd + mz * w]);
      if (g) geos.push(g);
    }
    run = [];
  };
  for (let i = 0; i <= S; i++) {
    const w = -W + (2 * W * i) / S, x = nx * dd + mx * w, z = nz * dd + mz * w;
    if (shape.inside(x, z)) run.push([w, shape.top(x, z)]); else flush();
  }
  flush();
  if (!geos.length) return null;
  if (geos.length === 1) return geos[0];
  // いくつかに分かれる時は 1 つにまとめる
  const pos = [];
  for (const g of geos) pos.push(...g.attributes.position.array);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// 水平に切った時の、切り口のすぐ下の赤い帯（下から見上げても切ったと分かるように）
function rimGeometry(shape, y) {
  const bh = shape.rim ?? 0.065 * shape.H, y0 = Math.max(0, y - bh);
  const a = shape.ringAt(y0), b = shape.ringAt(y);
  if (a.length !== b.length || a.length < 3) return null;
  const k = 1.006, pos = [];
  for (let i = 0; i < a.length; i++) {
    const j = (i + 1) % a.length;
    const p = [a[i][0] * k, y0, a[i][1] * k], q = [a[j][0] * k, y0, a[j][1] * k], r = [b[j][0] * k, y, b[j][1] * k], t = [b[i][0] * k, y, b[i][1] * k];
    pos.push(...p, ...q, ...r, ...p, ...r, ...t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// 切り落とした側の見た目（淡い無彩色・薄く）。dome.js の cutStep もこの濃さから消していく
export const OFF_COLOR = '#d6d3cd';
export const OFF_OPACITY = 0.3;
// obj（物差し 1 個）を、親の座標の平面 n·p = d で切る。n の側（はみ出た分）を off、残りを keep として返す
export function cutUnit(obj, shape, n, d) {
  obj.updateMatrix();
  const inv = obj.matrix.clone().invert();
  const planeLocal = new THREE.Plane(n.clone().normalize(), -d / n.length()).applyMatrix4(inv);
  const make = (plane, fade) => {
    const grp = new THREE.Group();
    grp.position.copy(obj.position); grp.quaternion.copy(obj.quaternion); grp.scale.copy(obj.scale);
    const mats = [];
    obj.updateMatrixWorld(true);
    obj.traverse((m) => {
      if (!m.isMesh) return;
      // m の中の座標 → obj の中の座標
      const M = new THREE.Matrix4();
      const chain = [];
      for (let o = m; o && o !== obj; o = o.parent) chain.push(o);
      for (const o of chain.reverse()) { o.updateMatrix(); M.multiply(o.matrix); }
      const pl = plane.clone().applyMatrix4(M.clone().invert());
      const geo = clipGeometry(m.geometry, pl);
      if (!geo) return;
      let mat = m.material;
      // 切り落とした側は、模様を外した淡い灰色で薄く（数える側だけが濃く見えるように。赤は使わない）
      if (fade) { mat = Array.isArray(mat) ? mat.map((x) => x.clone()) : mat.clone(); for (const x of [].concat(mat)) { x.transparent = true; x.opacity = OFF_OPACITY; x.depthWrite = false; x.map = null; x.color?.set(OFF_COLOR); if (x.emissive) x.emissive.set('#000000'); x.needsUpdate = true; mats.push(x); } }
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = !fade; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.matrix.copy(M);
      grp.add(mesh);
    });
    const cg = capGeometry(shape, planeLocal);
    if (cg) {
      const cm = fade ? capMat.clone() : capMat;
      // 消えていく側の切り口は赤にしない（半透明の赤は空と混ざってピンクに見えるため、地の色で塞ぐ）
      if (fade) { cm.color.set(OFF_COLOR); cm.transparent = true; cm.opacity = OFF_OPACITY; cm.depthWrite = false; mats.push(cm); }
      grp.add(new THREE.Mesh(cg, cm));
    }
    if (!fade && Math.abs(planeLocal.normal.y) > 0.9) {
      const rg = rimGeometry(shape, -planeLocal.constant / planeLocal.normal.y);
      if (rg) grp.add(new THREE.Mesh(rg, capMat));
    }
    grp.userData.fadeMats = mats;
    return grp;
  };
  return { keep: make(planeLocal, false), off: make(planeLocal.clone().negate(), true) };
}
