// PLATEAU の建物・道路から街の 3D を組み立てる。
// 座標：x＝東、z＝南（three.js の右手系で北が -z）、y＝標高 [m]。
import * as THREE from 'three';
import { STYLES, styleFor, bayWidth, makeFacadeTextures, makeGroundTextures, makeStoreTextures, STORES, storeFor, makeSignTextures } from './textures.js';

const V2 = THREE.Vector2;

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// 地面の高さ（建物の足元の標高をならした格子）
export function makeGround(g) {
  const { n, step, x0, z } = g;
  return (x, y) => {
    const fx = Math.min(Math.max((x - x0) / step, 0), n - 1.001), fy = Math.min(Math.max((y - x0) / step, 0), n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const a = z[j * n + i], b = z[j * n + i + 1], c = z[(j + 1) * n + i], d = z[(j + 1) * n + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

export class Builder {
  constructor() { this.pos = []; this.nor = []; this.uv = []; this.face = []; this.vbid = []; this.vbase = []; this.base = 0; this.col = []; this.tint = [1, 1, 1]; }
  tri(a, b, c, n, ua, ub, uc, bid) {
    // 面の向きを法線に合わせる
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    this.pos.push(...a, ...b, ...c);
    this.nor.push(...n, ...n, ...n);
    this.uv.push(...ua, ...ub, ...uc);
    this.face.push(bid);
    this.vbid.push(bid, bid, bid);
    this.vbase.push(this.base, this.base, this.base);
    this.col.push(...this.tint, ...this.tint, ...this.tint);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(this.vbid, 1));
    g.setAttribute('aBase', new THREE.Float32BufferAttribute(this.vbase, 1));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    g.userData.faceBid = Int32Array.from(this.face);
    return g;
  }
}

// 比べる時に、選んだ建物の外を地面へ沈める。uSink：1＝そのまま、0＝沈みきる。
// 残す建物は 128×128 の表（1 マス＝1 棟）で持つ。SINK.select([番号...]) で決める
const SEL_N = 128;
const selData = new Uint8Array(SEL_N * SEL_N);
const selTex = new THREE.DataTexture(selData, SEL_N, SEL_N, THREE.RedFormat, THREE.UnsignedByteType);
selTex.magFilter = selTex.minFilter = THREE.NearestFilter; selTex.needsUpdate = true;
export const SINK = {
  uSink: { value: 1 }, uSelTex: { value: selTex },
  select(ids) { selData.fill(0); for (const i of ids) if (i >= 0 && i < selData.length) selData[i] = 255; selTex.needsUpdate = true; },
};
function sinkable(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSink = SINK.uSink;
    sh.uniforms.uSelTex = SINK.uSelTex;
    sh.vertexShader = 'attribute float aBid;\nattribute float aBase;\nuniform float uSink;\nuniform sampler2D uSelTex;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nif (aBid > -0.5 && uSink < 0.999) { int bi = int(aBid + 0.5); if (texelFetch(uSelTex, ivec2(bi % 128, bi / 128), 0).r < 0.5) transformed.y = aBase + (transformed.y - aBase) * uSink; }');
  };
  mat.customProgramCacheKey = () => 'sinkable';
  return mat;
}
function sinkMesh(m) {
  m.customDepthMaterial = sinkable(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }));
  return m;
}

// 平らな多角形（xz 平面）を三角形に分ける
function flatPoly(B, ring, y, holes, bid, up = true, uvScale = 8) {
  const contour = ring.map(([x, z]) => new V2(x, z));
  const hs = (holes || []).map((h) => h.map(([x, z]) => new V2(x, z)));
  const idx = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = contour.concat(...hs);
  const n = up ? [0, 1, 0] : [0, -1, 0];
  for (const [i, j, k] of idx) {
    const p = [all[i], all[j], all[k]];
    B.tri([p[0].x, y, p[0].y], [p[1].x, y, p[1].y], [p[2].x, y, p[2].y], n,
      [p[0].x / uvScale, p[0].y / uvScale], [p[1].x / uvScale, p[1].y / uvScale], [p[2].x / uvScale, p[2].y / uvScale], bid);
  }
}

// 車道の白線：細長い車道の面（交差点の間の区間）を主軸に沿って見て、両端の外側線と中央の破線を引く。
// PLATEAU の道路には車線の情報が無いので、形からの推定（まっすぐな区間だけ）
function laneLines(B, ring, c, y) {
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of ring) { sxx += (x - c[0]) ** 2; szz += (z - c[1]) ** 2; sxz += (x - c[0]) * (z - c[1]); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), ax = Math.cos(ang), az = Math.sin(ang);
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [x, z] of ring) {
    const u = (x - c[0]) * ax + (z - c[1]) * az, v = -(x - c[0]) * az + (z - c[1]) * ax;
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  const L = u1 - u0, W = v1 - v0;
  if (L < 18 || W < 5.5 || W > 32 || L / W < 2.2) return;
  // 外形の面積が外接長方形に近い（まっすぐな区間）ときだけ
  let A = 0;
  for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; A += x1 * z2 - x2 * z1; }
  if (Math.abs(A) / 2 < 0.8 * L * W) return;
  const P = (u, v) => [c[0] + ax * u - az * v, y, c[1] + az * u + ax * v];
  const quad = (ua, ub, va, vb) => {
    const p = [P(ua, va), P(ub, va), P(ub, vb), P(ua, vb)];
    B.tri(p[0], p[1], p[2], [0, 1, 0], [0, 0], [1, 0], [1, 1], -1);
    B.tri(p[0], p[2], p[3], [0, 1, 0], [0, 0], [1, 1], [0, 1], -1);
  };
  const e = 2.5;   // 交差点の手前は少し空ける
  for (const vv of [v0 + 0.6, v1 - 0.75]) quad(u0 + e, u1 - e, vv, vv + 0.15);
  const vm = (v0 + v1) / 2;
  if (W > 13) { quad(u0 + e, u1 - e, vm - 0.18, vm - 0.03); quad(u0 + e, u1 - e, vm + 0.03, vm + 0.18); }
  else for (let u = u0 + e; u + 5 < u1 - e; u += 10) quad(u, u + 5, vm - 0.075, vm + 0.075);
}

// 外形を立ち上げた壁。v は足元 z0 からの高さを「2 階分」で割った値
function walls(B, ring, yb, yt, z0, tileW, tileH, bid) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) continue;
    // ring は xz で時計回り（北が -z なので、元の xy で反時計回り）→ 外向きの法線
    const n = [-(z2 - z1) / len, 0, (x2 - x1) / len];
    const u1 = s / tileW, u2 = (s + len) / tileW, vb = (yb - z0) / tileH, vt = (yt - z0) / tileH;
    const a = [x1, yb, z1], b = [x2, yb, z2], c = [x2, yt, z2], d = [x1, yt, z1];
    B.tri(a, b, c, n, [u1, vb], [u2, vb], [u2, vt], bid);
    B.tri(a, c, d, n, [u1, vb], [u2, vt], [u1, vt], bid);
    s += len;
  }
}

// LOD2 の 1 面（3D の多角形）
function lod2Poly(B, rings, z0, tileW, tileH, bid, wallB, roofB) {
  const pts = rings.map((r) => {
    const out = [];
    for (let i = 0; i < r.length; i += 3) out.push([r[i] / 10, r[i + 2] / 10, -r[i + 1] / 10]);
    return out;
  });
  const ex = pts[0];
  // Newell の法線
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ex.length; i++) {
    const a = ex[i], b = ex[(i + 1) % ex.length];
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-6) return;
  const n = [nx / L, ny / L, nz / L];
  const isWall = Math.abs(n[1]) < 0.35;
  const T = isWall ? wallB : roofB;
  let proj, uvf;
  if (isWall) {
    const t = [-n[2], 0, n[0]], tl = Math.hypot(t[0], t[2]) || 1;
    t[0] /= tl; t[2] /= tl;
    proj = (p) => new V2(p[0] * t[0] + p[2] * t[2], p[1]);
    uvf = (p) => [(p[0] * t[0] + p[2] * t[2]) / tileW, (p[1] - z0) / tileH];
  } else {
    proj = (p) => new V2(p[0], p[2]);
    uvf = (p) => [p[0] / 8, p[2] / 8];
  }
  const contour = ex.map(proj), holes = pts.slice(1).map((h) => h.map(proj));
  let idx;
  try { idx = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { return; }
  const all = ex.concat(...pts.slice(1));
  for (const [i, j, k] of idx) T.tri(all[i], all[j], all[k], n, uvf(all[i]), uvf(all[j]), uvf(all[k]), bid);
}

// 1 棟の形を Builder に積む。返り値は見た目の高さ
export function buildBuilding(rec, bid, wallB, roofB, st, storeB = null) {
  const tileW = 4 * bayWidth(st);
  const hDisp = rec.tower ? rec.h : (rec.p ? (rec.h ?? rec.H) : rec.H);
  const fl = rec.fl > 0 ? rec.fl : 0;
  let floorH = fl ? hDisp / fl : (STYLES[st][0] === 'house' ? 3.0 : 3.8);
  floorH = Math.min(Math.max(floorH, 2.8), 6.0);
  const tileH = 2 * floorH;
  const z0 = rec.z0;
  wallB.base = roofB.base = z0 - 3.5;
  if (rec.p) {
    for (const poly of rec.p) lod2Poly(wallB, poly.slice(1), z0, tileW, tileH, bid, wallB, roofB);
    // LOD2 の壁は地面の高さに届かないことがあるので、足元を少し下まで延ばす
    for (const r of rec.rings) walls(wallB, r.map(([x, y]) => [x, -y]), z0 - 3, z0, z0, tileW, tileH, bid);
    return hDisp;
  }
  const top = z0 + rec.H;
  // 1 階の店先（用途で決める）。1 階は少し高くとる
  const gfH = Math.min(Math.max(floorH * 1.15, 3.6), 5.0);
  const useStore = storeB && rec.H > gfH + 2.5;
  if (useStore) storeB.base = z0 - 3.5;
  for (const r of rec.rings) {
    const ring = r.map(([x, y]) => [x, -y]);
    if (useStore) {
      walls(storeB, ring, z0 - 3, z0 + gfH, z0, 16, gfH, bid);
      walls(wallB, ring, z0 + gfH, top, z0, tileW, tileH, bid);
    } else walls(wallB, ring, z0 - 3, top, z0, tileW, tileH, bid);
    flatPoly(roofB, ring, top, null, bid);
  }
  if (rec.tower) {
    const ring = rec.tower.map(([x, y]) => [x, -y]);
    walls(wallB, ring, top, z0 + rec.h, z0, tileW, tileH, bid);
    flatPoly(roofB, ring, z0 + rec.h, null, bid);
  }
  return hDisp;
}

export function buildCity(data, renderer, skipId) {
  const facade = makeFacadeTextures(renderer);
  const gt = makeGroundTextures(renderer);
  const ground = makeGround(data.ground);
  const group = new THREE.Group();

  // 地面
  {
    const { n, step, x0, z } = data.ground;
    const geo = new THREE.PlaneGeometry((n - 1) * step, (n - 1) * step, n - 1, n - 1);
    geo.rotateX(-Math.PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k), zz = p.getZ(k);
      p.setY(k, ground(x, -zz) - 0.3);
      uv.setXY(k, x / 12, zz / 12);
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: gt.plaza.map, roughness: 0.95, color: '#e2ddd3' }));
    m.receiveShadow = true;
    group.add(m);
    // 範囲の外の地面（遠くから見た時に、街が板のように浮いて見えないよう霞の中まで続ける）
    let zmin = 1e9; for (const v of z) zmin = Math.min(zmin, v);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshStandardMaterial({ color: '#b9b4aa', roughness: 1 }));
    far.rotation.x = -Math.PI / 2; far.position.y = zmin - 1.5;
    group.add(far);
  }

  // 道路（車道・交差点・歩道・島）。歩道は 15 cm 上げて縁石を付ける。交差点の縁に横断歩道
  const signals = [];
  {
    const kinds = { car: [gt.asphalt, 0.0, 7], cross: [gt.asphalt, 0.0, 7], walk: [gt.walk, 0.15, 2.4], aux: [gt.green, 0.25, 4] };
    const B = { car: new Builder(), walk: new Builder(), aux: new Builder() };
    const curbB = new Builder(), paintB = new Builder();
    for (const r of data.roads) {
      const ring = r.r.map(([x, y]) => [x, -y]);
      const c = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      const y0 = ground(c[0], -c[1]);
      const y = y0 + kinds[r.k][1];
      const tgt = r.k === 'cross' ? B.car : B[r.k];
      try { flatPoly(tgt, ring, y, null, -1, true, kinds[r.k][2]); } catch { continue; }
      if (r.k === 'walk' || r.k === 'aux') walls(curbB, ring, y0 - 0.3, y, y0, 1.0, 0.5, -1);
      if (r.k === 'car') laneLines(paintB, ring, c, y + 0.02);
      if (r.k === 'cross') {
        for (let i = 0; i < ring.length; i++) {
          const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
          const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          if (L < 6 || L > 40) continue;
          const tx = (p2[0] - p1[0]) / L, tz = (p2[1] - p1[1]) / L;
          let nx = -tz, nz = tx;
          const mx = (p1[0] + p2[0]) / 2, mz = (p1[1] + p2[1]) / 2;
          if ((c[0] - mx) * nx + (c[1] - mz) * nz < 0) { nx = -nx; nz = -nz; }
          const yy = y + 0.03;
          const q = (a, b) => [p1[0] + tx * a + nx * b, yy, p1[1] + tz * a + nz * b];
          for (let s0 = 0.9; s0 + 0.45 < L - 0.9; s0 += 0.9) {
            const A = q(s0, 0.5), Bq = q(s0 + 0.45, 0.5), Cq = q(s0 + 0.45, 4.2), Dq = q(s0, 4.2);
            paintB.tri(A, Bq, Cq, [0, 1, 0], [0, 0], [1, 0], [1, 1], -1);
            paintB.tri(A, Cq, Dq, [0, 1, 0], [0, 0], [1, 1], [0, 1], -1);
          }
          if (L >= 8 && Math.hypot(p1[0], p1[1]) < 1000) signals.push([p1[0] - tx * 1.0 - nx * 1.4, y0 + 0.15, p1[1] - tz * 1.0 - nz * 1.4, Math.atan2(nx, nz)]);
        }
      }
    }
    const mat = (t, rough, extra = {}) => new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rough, bumpMap: t.bump, bumpScale: 0.6, roughness: rough, envMapIntensity: 0.4, ...extra });
    for (const k of Object.keys(B)) {
      if (!B[k].pos.length) continue;
      const m = new THREE.Mesh(B[k].geometry(), mat(kinds[k][0], 1.0, { polygonOffset: true, polygonOffsetFactor: -1 - kinds[k][1] * 10, polygonOffsetUnits: -2 }));
      m.receiveShadow = true;
      group.add(m);
    }
    const curb = new THREE.Mesh(curbB.geometry(), mat(gt.curb, 0.9));
    curb.receiveShadow = curb.castShadow = true;
    group.add(curb);
    const paint = new THREE.Mesh(paintB.geometry(), new THREE.MeshStandardMaterial({ color: '#efece4', roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    paint.receiveShadow = true;
    group.add(paint);
  }
  // 信号機（横断歩道の端に 1 本ずつ、灯りは道の方を向く）
  if (signals.length) {
    const n = signals.length;
    const poleG = new THREE.CylinderGeometry(0.08, 0.11, 5.4, 8); poleG.translate(0, 2.7, 0);
    const armG = new THREE.BoxGeometry(0.08, 0.08, 2.2); armG.translate(0, 5.2, 1.1);
    const headG = new THREE.BoxGeometry(1.25, 0.42, 0.3); headG.translate(0, 5.2, 2.1);
    const lampG = new THREE.CircleGeometry(0.14, 16); lampG.translate(-0.4, 5.2, 2.26);
    const metal = new THREE.MeshStandardMaterial({ color: '#7c7f80', roughness: 0.45, metalness: 0.6 });
    const red = new THREE.MeshStandardMaterial({ color: '#ff4a3a', emissive: '#ff3020', emissiveIntensity: 2.2 });
    const meshes = [new THREE.InstancedMesh(poleG, metal, n), new THREE.InstancedMesh(armG, metal, n), new THREE.InstancedMesh(headG, metal, n), new THREE.InstancedMesh(lampG, red, n)];
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), U = new THREE.Vector3(0, 1, 0), P0 = new THREE.Vector3(), S1 = new THREE.Vector3(1, 1, 1);
    signals.forEach(([x, y, z, a], i) => {
      Q.setFromAxisAngle(U, a); P0.set(x, y, z); M.compose(P0, Q, S1);
      for (const m of meshes) m.setMatrixAt(i, M);
    });
    for (const m of meshes.slice(0, 3)) { m.castShadow = true; m.receiveShadow = true; }
    group.add(...meshes);
  }

  // 建物：配色ごとに 1 つのメッシュにまとめる
  const wallBs = STYLES.map(() => new Builder());
  const storeBs = STORES.map(() => new Builder());
  const store = makeStoreTextures(renderer);
  const roofB = new Builder();
  const recs = data.buildings;
  const tops = new Float32Array(recs.length);
  recs.forEach((rec, i) => {
    if (rec.id === skipId) { tops[i] = -1; return; }
    const st = styleFor(rec, hashStr(rec.id));
    rec.style = st;
    const hh = hashStr(rec.id + 't');
    const lum = 0.86 + ((hh & 255) / 255) * 0.2, warm = (((hh >>> 8) & 255) / 255 - 0.5) * 0.08;
    wallBs[st].tint = [lum * (1 + warm), lum, lum * (1 - warm)];
    const sf = storeFor(rec, hashStr(rec.id) >>> 3);
    tops[i] = rec.z0 + buildBuilding(rec, i, wallBs[st], roofB, st, sf >= 0 ? storeBs[sf] : null);
  });
  const pickables = [];
  const mats = { wall: [], store: [], roof: null };
  wallBs.forEach((B, st) => {
    if (!B.pos.length) return;
    const f = facade[st];
    const m = sinkMesh(new THREE.Mesh(B.geometry(), sinkable(new THREE.MeshStandardMaterial({
      map: f.map, roughnessMap: f.rough, bumpMap: f.bump, bumpScale: 1.6, roughness: 1.0, metalness: f.kind === 'glassTower' ? 0.15 : 0.0,
      envMapIntensity: f.kind === 'glassTower' ? 0.9 : 0.55, side: THREE.DoubleSide, vertexColors: true,
    }))));
    m.castShadow = m.receiveShadow = true;
    mats.wall[st] = m.material;
    group.add(m); pickables.push(m);
  });
  storeBs.forEach((B, k) => {
    if (!B.pos.length) return;
    const f = store[k];
    const m = sinkMesh(new THREE.Mesh(B.geometry(), sinkable(new THREE.MeshStandardMaterial({
      map: f.map, roughnessMap: f.rough, bumpMap: f.bump, bumpScale: 1.6, roughness: 1.0, envMapIntensity: 0.55, side: THREE.DoubleSide,
      emissiveMap: f.emissive, emissive: f.emissive ? '#ffffff' : '#000000', emissiveIntensity: 0.9,
    }))));
    m.castShadow = m.receiveShadow = true;
    mats.store[k] = m.material;
    group.add(m); pickables.push(m);
  });
  {
    const m = sinkMesh(new THREE.Mesh(roofB.geometry(), sinkable(new THREE.MeshStandardMaterial({ map: gt.roof.map, roughnessMap: gt.roof.rough, roughness: 1.0, side: THREE.DoubleSide }))));
    m.castShadow = m.receiveShadow = true;
    mats.roof = m.material;
    group.add(m); pickables.push(m);
  }

  // 看板：商業系の建物に、袖看板（壁から突き出す縦長）と屋上の看板。見た目のための飾りで、PLATEAU には無い
  {
    const signs = makeSignTextures(renderer);
    const SB = signs.map(() => new Builder());
    const quad = (B, a, b, c, d, n, bid) => {
      B.tri(a, b, c, n, [0, 0], [1, 0], [1, 1], bid);
      B.tri(a, c, d, n, [0, 0], [1, 1], [0, 1], bid);
    };
    recs.forEach((rec, i) => {
      if (tops[i] < 0 || rec.p || !['402', '404', '413', '414', '401'].includes(rec.usage)) return;
      const hs = hashStr(rec.id + 's');
      if (rec.usage === '401' && hs % 3) return;
      const c0 = rec.rings[0];
      if (Math.hypot(c0[0][0], c0[0][1]) > 1000) return;
      const ring = c0.map(([x, y]) => [x, -y]);
      // いちばん長い辺
      let bi = 0, bl = 0;
      for (let k = 0; k < ring.length; k++) { const p = ring[k], q = ring[(k + 1) % ring.length]; const l = Math.hypot(q[0] - p[0], q[1] - p[1]); if (l > bl) { bl = l; bi = k; } }
      if (bl < 8) return;
      const p = ring[bi], q = ring[(bi + 1) % ring.length];
      const tx = (q[0] - p[0]) / bl, tz = (q[1] - p[1]) / bl, nx = -tz, nz = tx;   // 外向き
      const z0 = rec.z0, H = rec.H;
      const v = hs % signs.length, B = SB[v];
      B.base = z0 - 3.5;
      if (H > 9) {
        // 袖看板：辺の端から 1.5 m、壁から 0.3〜1.3 m 突き出す
        const sx = p[0] + tx * 1.5 + nx * 0.3, sz = p[1] + tz * 1.5 + nz * 0.3;
        const yb = z0 + 4.2, yt = z0 + Math.min(H - 1.5, 4.2 + 3 + (hs % 7) * 2.2);
        const ex = nx * 1.0, ez = nz * 1.0;
        const nn = [tx, 0, tz];
        quad(B, [sx, yb, sz], [sx + ex, yb, sz + ez], [sx + ex, yt, sz + ez], [sx, yt, sz], nn, i);
        quad(B, [sx + ex, yb, sz + ez], [sx, yb, sz], [sx, yt, sz], [sx + ex, yt, sz + ez], [-tx, 0, -tz], i);
      }
      if (H > 14 && hs % 2 === 0) {
        // 屋上の看板：長い辺に沿って、外向き
        const w = Math.min(bl * 0.7, 18), h = Math.min(6, w * 0.35);
        const m = (bl - w) / 2, y = z0 + H;
        const a = [p[0] + tx * m + nx * 0.2, y + 0.8, p[1] + tz * m + nz * 0.2];
        const b = [a[0] + tx * w, y + 0.8, a[2] + tz * w];
        quad(B, a, b, [b[0], y + 0.8 + h, b[2]], [a[0], y + 0.8 + h, a[2]], [nx, 0, nz], i);
      }
    });
    SB.forEach((B, k) => {
      if (!B.pos.length) return;
      const m = sinkMesh(new THREE.Mesh(B.geometry(), sinkable(new THREE.MeshStandardMaterial({
        map: signs[k], emissiveMap: signs[k], emissive: '#ffffff', emissiveIntensity: 0.55, roughness: 0.5, side: THREE.DoubleSide,
      }))));
      m.castShadow = true;
      group.add(m);
    });
  }

  // 見通しを調べるための建物の高さの格子（4 m）
  const H = { n: 700, step: 4, x0: -1400 };
  H.top = new Float32Array(H.n * H.n).fill(-1e9);
  recs.forEach((rec, i) => {
    if (tops[i] < 0) return;
    const rings = rec.tower ? [rec.tower] : rec.rings;
    for (const ring of rings) {
      let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
      for (const [x, y] of ring) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
      const i0 = Math.max(0, Math.floor((minx - H.x0) / H.step)), i1 = Math.min(H.n - 1, Math.ceil((maxx - H.x0) / H.step));
      const j0 = Math.max(0, Math.floor((miny - H.x0) / H.step)), j1 = Math.min(H.n - 1, Math.ceil((maxy - H.x0) / H.step));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const px = H.x0 + (ii + 0.5) * H.step, py = H.x0 + (j + 0.5) * H.step;
        let inside = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
          const [xa, ya] = ring[a], [xb, yb] = ring[b];
          if ((ya > py) !== (yb > py) && px < (xb - xa) * (py - ya) / (yb - ya) + xa) inside = !inside;
        }
        if (inside) H.top[j * H.n + ii] = Math.max(H.top[j * H.n + ii], tops[i]);
      }
    }
  });
  // 低層部（tower の外側）も入れる
  recs.forEach((rec, i) => {
    if (!rec.tower || tops[i] < 0) return;
    const t = rec.z0 + rec.H;
    for (const ring of rec.rings) for (const [x, y] of ring) {
      const ii = Math.floor((x - H.x0) / H.step), j = Math.floor((y - H.x0) / H.step);
      if (ii >= 0 && j >= 0 && ii < H.n && j < H.n) H.top[j * H.n + ii] = Math.max(H.top[j * H.n + ii], t);
    }
  });
  // (x,y) の地点から見て、点 (tx,ty,tz) が見えるか
  const clear = (x, y, eye, tx, ty, tz) => {
    const d = Math.hypot(tx - x, ty - y), steps = Math.ceil(d / 3);
    for (let s = 1; s < steps - 1; s++) {
      const f = s / steps, px = x + (tx - x) * f, py = y + (ty - y) * f, pz = eye + (tz - eye) * f;
      const ii = Math.floor((px - H.x0) / H.step), j = Math.floor((py - H.x0) / H.step);
      if (ii < 0 || j < 0 || ii >= H.n || j >= H.n) continue;
      if (H.top[j * H.n + ii] > pz) return false;
    }
    return true;
  };
  const topAt = (x, y) => {
    const ii = Math.floor((x - H.x0) / H.step), j = Math.floor((y - H.x0) / H.step);
    if (ii < 0 || j < 0 || ii >= H.n || j >= H.n) return -1e9;
    return H.top[j * H.n + ii];
  };
  const blockedAt = (x, y) => {
    const ii = Math.floor((x - H.x0) / H.step), j = Math.floor((y - H.x0) / H.step);
    if (ii < 0 || j < 0 || ii >= H.n || j >= H.n) return false;
    return H.top[j * H.n + ii] > -1e8;
  };

  // 車道の上の地点（立ち位置の候補）
  const roadPts = [];
  for (const r of data.roads) {
    if (r.k !== 'car' && r.k !== 'walk') continue;
    const c = r.r.reduce((a, p) => [a[0] + p[0] / r.r.length, a[1] + p[1] / r.r.length], [0, 0]);
    roadPts.push(c);
  }

  return { group, pickables, ground, tops, clear, blockedAt, topAt, roadPts, mats, textures: { facade, gt } };
}

// 建物 1 棟を物差しにする時の形。足元の中心を原点・足元の高さを 0 にした複製用の形（沈めない）
export function makeBuildingMaker(rec, mats) {
  const st = rec.style ?? 0;
  const sf = storeFor(rec, hashStr(rec.id) >>> 3);
  const W = new Builder(), R = new Builder(), S = new Builder();
  const hDisp = buildBuilding(rec, -1, W, R, st, sf >= 0 ? S : null);
  // 床（物差しの形だけ）。下から見ても、切った時も、中が抜けて見えないように
  for (const r of rec.rings) { try { flatPoly(R, r.map(([x, y]) => [x, -y]), rec.z0, null, -1, false); } catch { /* 形の悪い外形は床なし */ } }
  const r0 = rec.rings[0];
  let cx = 0, cy = 0;
  for (const [x, y] of r0) { cx += x / r0.length; cy += y / r0.length; }
  let rmax = 0, minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const [x, y] of r0) { rmax = Math.max(rmax, Math.hypot(x - cx, y - cy)); minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, -y); maxz = Math.max(maxz, -y); }
  const parts = [];
  for (const [B, mat] of [[W, mats.wall[st]], [R, mats.roof], [S, sf >= 0 ? mats.store[sf] : null]]) {
    if (!B.pos.length || !mat) continue;
    const g = B.geometry();
    g.translate(-cx, -rec.z0, cy);
    // 地面の下に伸ばした壁の足（3 m）は物差しには要らないので、0 より下は 0 に寄せる
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) < 0) p.setY(i, 0);
    p.needsUpdate = true;
    parts.push([g, mat]);
  }
  const make = () => {
    const grp = new THREE.Group();
    for (const [g, m] of parts) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; grp.add(mesh); }
    return grp;
  };
  // 足元の外形（形の中の座標）。端数を切る時の切り口に使う
  const ring = r0.map(([x, y]) => [x - cx, -y + cy]);
  return { make, vis: hDisp, R: rmax, depth: Math.min(maxx - minx, maxz - minz), ring };
}
