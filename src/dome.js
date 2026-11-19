// PLATEAU 基準の東京ドーム（物差し）の形と、降らせる・縮める演出。
// 形は見た目のための近似（角の丸い四角の土台に、空気膜の屋根）。数字は PLATEAU の値を使う。
import * as THREE from 'three';
import { cutUnit, cutOffset } from './cut.js';

// 角の丸い四角（超楕円 n=4）の半径
const SE_N = 4;
const se = (t) => {
  const c = Math.cos(t), s = Math.sin(t);
  return Math.pow(Math.pow(Math.abs(c), SE_N) + Math.pow(Math.abs(s), SE_N), -1 / SE_N);
};
// 超楕円（半径 1）の面積
const SE_AREA = (() => { let a = 0; const N = 2000; for (let i = 0; i < N; i++) { const r = se((i / N) * 2 * Math.PI); a += 0.5 * r * r * (2 * Math.PI / N); } return a; })();

function roofTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f2ec'; g.fillRect(0, 0, 1024, 1024);
  // 28 本のケーブルの格子（斜め）
  g.strokeStyle = 'rgba(150,150,150,0.55)'; g.lineWidth = 3;
  for (let k = -1024; k < 2048; k += 1024 / 14) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 1024, 1024); g.stroke();
    g.beginPath(); g.moveTo(k, 1024); g.lineTo(k + 1024, 0); g.stroke();
  }
  for (let i = 0; i < 20000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.03})`; g.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function wallTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c6bf'; g.fillRect(0, 0, 1024, 256);
  for (let x = 0; x < 1024; x += 32) { g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x, 0, 6, 256); }
  g.fillStyle = '#5b6066'; g.fillRect(0, 150, 1024, 40);         // 窓の帯
  g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(0, 150, 1024, 6);
  g.fillStyle = '#b7b3ab'; g.fillRect(0, 0, 1024, 18);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(6, 1);
  return t;
}

// 半径 1・高さ 1 のドーム（壁は高さ wallF まで）
function domeGeometry(wallF = 0.33) {
  const seg = 128, rows = 24;
  const pos = [], uv = [], idx = [];
  // 壁
  for (let r = 0; r <= 1; r++) for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * 2 * Math.PI, R = se(t) * (r ? 0.985 : 1);
    pos.push(Math.cos(t) * R, r * wallF, Math.sin(t) * R); uv.push(i / seg, r);
  }
  for (let i = 0; i < seg; i++) { const a = i, b = i + 1, c = seg + 1 + i, d = seg + 2 + i; idx.push(a, c, b, b, c, d); }
  // 屋根（縁から頂上へ、空気膜のふくらみ）
  const base = pos.length / 3;
  for (let k = 0; k <= rows; k++) {
    const f = k / rows;                        // 0＝縁、1＝頂上
    const s = 1 - f;                            // 中心からの距離の比
    const y = wallF + (1 - wallF) * Math.pow(1 - Math.pow(s, 2.2), 0.55);
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * 2 * Math.PI, R = se(t) * 0.985 * s;
      pos.push(Math.cos(t) * R, y, Math.sin(t) * R);
      uv.push(0.5 + Math.cos(t) * R * 0.5, 0.5 + Math.sin(t) * R * 0.5);
    }
  }
  const g1 = new THREE.BufferGeometry();
  const wallIdx = idx.slice();
  const roofIdx = [];
  for (let k = 0; k < rows; k++) for (let i = 0; i < seg; i++) {
    const a = base + k * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
    roofIdx.push(a, c, b, b, c, d);
  }
  // 床（下向き）。積んだドームを下から見ても、切った時も、中が抜けて見えないように
  const fb = pos.length / 3, floorIdx = [];
  pos.push(0, 0, 0); uv.push(0.5, 0.5);
  for (let i = 0; i <= seg; i++) { const t = (i / seg) * 2 * Math.PI, R = se(t); pos.push(Math.cos(t) * R, 0, Math.sin(t) * R); uv.push(0.5 + Math.cos(t) * R * 0.5, 0.5 + Math.sin(t) * R * 0.5); }
  for (let i = 0; i < seg; i++) floorIdx.push(fb, fb + 1 + i, fb + 2 + i);
  g1.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g1.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g1.setIndex(wallIdx.concat(roofIdx, floorIdx));
  g1.addGroup(0, wallIdx.length, 0);
  g1.addGroup(wallIdx.length, roofIdx.length, 1);
  g1.addGroup(wallIdx.length + roofIdx.length, floorIdx.length, 2);
  g1.computeVertexNormals();
  return g1;
}

// PLATEAU の東京ドームの外形に合わせる：主軸の向きと、外形の面積に合う大きさ
export function fitDome(rec) {
  const ring = rec.rings[0].map(([x, y]) => [x, -y]);
  const n = ring.length;
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x / n; cz += z / n; }
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of ring) { sxx += (x - cx) ** 2; szz += (z - cz) ** 2; sxz += (x - cx) * (z - cz); }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const ca = Math.cos(ang), sa = Math.sin(ang);
  let a = 0, b = 0;
  for (const [x, z] of ring) { const u = (x - cx) * ca + (z - cz) * sa, v = -(x - cx) * sa + (z - cz) * ca; a = Math.max(a, Math.abs(u)); b = Math.max(b, Math.abs(v)); }
  const k = Math.sqrt(rec.area / (SE_AREA * a * b));
  return { cx, cz, ang, ax: a * k, az: b * k, h: rec.h, area: rec.area };
}

// 東京ドームの形（見た目のための近似）
export function makeDomeMaker(fit) {
  const geo = domeGeometry();
  const mats = [
    new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.8 }),
    new THREE.MeshStandardMaterial({ map: roofTexture(), roughness: 0.55, emissive: '#fffaf0', emissiveIntensity: 0.06 }),
    new THREE.MeshStandardMaterial({ color: '#b9b5ad', roughness: 0.9 }),
  ];
  return () => {
    const m = new THREE.Mesh(geo, mats);
    m.castShadow = m.receiveShadow = true;
    m.rotation.y = -fit.ang;
    m.scale.set(fit.ax, fit.h, fit.az);
    return m;
  };
}

// 物差しを降らせる・縮める・倒して並べる。unit.make() が 1 個ぶんの形を返す（足元の中心が原点、高さ unit.vis）
export class DropKit {
  constructor(scene) {
    this.scene = scene;
    this.live = [];
    this.shake = 0;
  }
  clear() {
    for (const o of this.live) { this.scene.remove(o.root); if (o.ring) this.scene.remove(o.ring); o.dispose?.(); }
    this.live = [];
  }
  dust(x, y, z, r) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 64), new THREE.MeshBasicMaterial({ color: '#e8e0d0', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.5, z); m.scale.setScalar(r);
    this.scene.add(m);
    return m;
  }
  // 1 個を落とす。final：着地の後に縮める比 [x, y, z]（1 個に満たない分）
  // cut：端数を切る時 { n, d } か { n, q, byVolume }（n·p <= d の側を残す。座標は物差し 1 個の親の座標）
  drop({ unit, x, z, yLand, delay = 0, final = null, cut = null, onLand, onSquash, dropFrom = 260 }) {
    const root = new THREE.Group();
    const obj = unit.make();
    root.add(obj);
    root.position.set(x, yLand + dropFrom, z);
    root.visible = false;
    this.scene.add(root);
    const st = { kind: 'drop', unit, root, obj: root, unitObj: obj, t: -delay, phase: 'fall', vy: 0, yLand, final, cut, onLand, onSquash, base: root.scale.clone() };
    this.live.push(st);
    return st;
  }
  // 倒して並べる：足元 (x, y, z) に立てて、dir（水平の単位ベクトル）の向きへ倒す。final：高さ方向に縮める比
  topple({ unit, x, y, z, dir, delay = 0, final = 1, cut = null, onLand, onSquash }) {
    const root = new THREE.Group();          // 足元を支点に回す
    const inner = new THREE.Group();
    const obj = unit.make();
    inner.add(obj);
    root.add(inner);
    root.position.set(x, y, z);
    root.rotation.y = Math.atan2(dir.x, dir.z);     // 子の +z が dir を向く
    root.visible = false;
    this.scene.add(root);
    const st = { kind: 'topple', unit, root, inner, obj: root, unitObj: obj, t: -delay, phase: 'rise', y0: y, final, cut, onLand, onSquash, depth: unit.depth ?? unit.R };
    this.live.push(st);
    return st;
  }
  update(dt) {
    const G = 260;
    for (const s of this.live) {
      s.t += dt;
      if (s.t < 0) continue;
      const o = s.root;
      o.visible = true;
      if (s.kind === 'static') continue;
      if (s.kind === 'custom') { s.update?.(s.t, dt); continue; }
      if (s.kind === 'reveal') { if (!s.done) { s.done = true; s.onLand?.(s); } continue; }
      if (s.kind === 'grow') {
        const f = Math.min(s.t / (s.dur ?? 1.5), 1), e = 1 - Math.pow(1 - f, 3);
        o.scale.y = Math.max(0.001, e);
        if (f >= 1 && !s.done) { s.done = true; s.onLand?.(s); }
        continue;
      }
      if (s.kind === 'topple') {
        if (s.phase === 'rise') {
          // 地面からにゅっと生える
          const f = Math.min(s.t / 0.25, 1);
          s.inner.scale.set(1, 0.05 + 0.95 * f, 1);
          if (f >= 1) { s.phase = 'tip'; s.t2 = 0; }
        } else if (s.phase === 'tip') {
          s.t2 += dt;
          const f = Math.min(s.t2 / 0.45, 1), e = f * f;           // だんだん速く倒れる
          const a = e * Math.PI / 2;
          s.inner.rotation.x = a;
          o.position.y = s.y0 + s.depth * 0.5 * Math.sin(a) * 0.98;   // 倒れた時に地面に乗るよう、厚みの半分だけ上げる
          if (f >= 1) {
            s.phase = s.cut ? 'cut' : s.final < 0.999 ? 'squash' : 'rest'; s.t3 = 0;
            this.shake = Math.min(1.0, this.shake + 0.35);
            s.onLand?.(s);
            if (s.cut) { s.t3 = -0.25; } else if (s.final < 0.999) s.onSquash?.(s);
          }
        } else if (s.phase === 'squash') {
          s.t3 += dt;
          const f = Math.min(s.t3 / 0.7, 1), e = 1 - Math.pow(1 - f, 3) + Math.sin(f * Math.PI) * 0.1;
          s.inner.scale.set(1, 1 + (s.final - 1) * e, 1);
          if (f >= 1) { s.inner.scale.set(1, s.final, 1); s.phase = 'rest'; }
        } else if (s.phase === 'cut') this.cutStep(s, dt);
        continue;
      }
      if (s.phase === 'fall') {
        s.vy += G * dt;
        o.position.y -= s.vy * dt;
        if (o.position.y <= s.yLand) {
          o.position.y = s.yLand; s.phase = 'bounce'; s.t2 = 0;
          this.shake = Math.min(1.2, this.shake + 0.6);
          s.ring = this.dust(o.position.x, s.yLand, o.position.z, s.unit.R * 1.05);
          s.onLand?.(s);
        }
      } else if (s.phase === 'bounce') {
        s.t2 += dt;
        const k = Math.exp(-s.t2 * 7) * Math.sin(s.t2 * 26);
        o.scale.set(s.base.x * (1 + 0.06 * k), s.base.y * (1 - 0.12 * k), s.base.z * (1 + 0.06 * k));
        if (s.t2 > 0.7) {
          o.scale.copy(s.base);
          if (s.cut) { s.phase = 'cut'; s.t3 = -0.1; }
          else if (s.final) { s.phase = 'squash'; s.t3 = 0; s.onSquash?.(s); } else s.phase = 'rest';
        }
      } else if (s.phase === 'squash') {
        s.t3 += dt;
        const T = 0.9, f = Math.min(s.t3 / T, 1);
        const e = 1 - Math.pow(1 - f, 3) + Math.sin(f * Math.PI) * 0.12;
        const [sx, sy, sz] = s.final;
        o.scale.set(s.base.x * (1 + (sx - 1) * e), s.base.y * (1 + (sy - 1) * e), s.base.z * (1 + (sz - 1) * e));
        if (f >= 1) { o.scale.set(s.base.x * sx, s.base.y * sy, s.base.z * sz); s.phase = 'rest'; }
      } else if (s.phase === 'cut') this.cutStep(s, dt);
      if (s.ring) {
        s.ring.scale.multiplyScalar(1 + dt * 0.9);
        s.ring.material.opacity = Math.max(0, s.ring.material.opacity - dt * 0.5);
        s.ring.visible = s.ring.material.opacity > 0.01;
      }
    }
    this.shake = Math.max(0, this.shake - dt * 2.5);
  }
  // 端数を切る：スパッと切って、はみ出た分を横へずらして消す
  cutStep(s, dt) {
    s.t3 += dt;
    if (s.t3 < 0) return;
    if (!s.off) {
      const obj = s.unitObj, parent = obj.parent, c = s.cut;
      const shape = s.unit.shape();
      const d = c.d ?? cutOffset(obj, shape, c.n, c.q, c.byVolume);
      const { keep, off } = cutUnit(obj, shape, c.n, d);
      parent.remove(obj); parent.add(keep, off);
      s.unitObj = keep; s.off = off; s.offBase = off.position.clone();
      s.cutDir = c.n.clone().normalize(); s.sep = c.sep ?? 20;
      this.shake = Math.min(1.0, this.shake + 0.2);
      s.onSquash?.(s);
    }
    const t = s.t3;
    const e = 1 - Math.pow(1 - Math.min(t / 0.45, 1), 3);
    const drift = e + Math.max(0, t - 0.45) * 0.5;
    s.off.position.copy(s.offBase).addScaledVector(s.cutDir, s.sep * drift);
    const op = THREE.MathUtils.clamp(1 - (t - 0.55) / 0.6, 0, 1);
    for (const m of s.off.userData.fadeMats) m.opacity = op;
    if (t > 0.55) for (const m of s.off.children) m.castShadow = false;
    if (op <= 0) { s.off.parent?.remove(s.off); s.phase = 'rest'; }
  }
}
