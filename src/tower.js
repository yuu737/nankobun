// 東京スカイツリー・東京タワー。PLATEAU の読み込んだ範囲（文京区・千代田区）の外にあるので、
// 高さは公式の値を使い、形は見た目のための簡単な模型（輪切りを積んだ形）にする。
import * as THREE from 'three';

// 区切り：[下の高さ, 上の高さ, 下の半径, 上の半径, 色]。東京タワーの半径は四角の半分の幅
const SEG = {
  skytree: [
    [0, 60, 39, 33, 'w'], [60, 150, 33, 28, 'w'], [150, 250, 28, 24, 'w'], [250, 335, 24, 22, 'w'],
    [335, 340, 22, 34, 'w'], [340, 352, 35, 36, 'g'], [352, 358, 36, 36, 'w'], [358, 366, 36, 21, 'w'],
    [366, 440, 21, 18, 'w'],
    [440, 444, 18, 23, 'w'], [444, 452, 24, 24, 'g'], [452, 458, 24, 15, 'w'],
    [458, 497, 13, 11, 'w'], [497, 500, 11, 6, 'w'], [500, 580, 5, 3.5, 'w'], [580, 634, 3, 0.8, 'w'],
  ],
  tokyotower: [
    [0, 40, 42, 31, 'o'], [40, 70, 31, 24, 'w'], [70, 100, 24, 18.5, 'o'], [100, 125, 18.5, 15, 'w'], [125, 145, 15, 13, 'o'],
    [145, 148, 19, 19, 'w'], [148, 157, 19, 19, 'g'], [157, 160, 19, 19, 'w'],
    [160, 185, 12, 10, 'o'], [185, 205, 10, 8.5, 'w'], [205, 225, 8.5, 7.2, 'o'], [225, 245, 7.2, 6, 'w'],
    [245, 253, 9, 9, 'g'],
    [253, 275, 5, 4, 'o'], [275, 295, 4, 3, 'w'], [295, 315, 3, 2.2, 'o'], [315, 333, 2.2, 0.6, 'w'],
  ],
};
export const TOWERS = {
  skytree: { id: 'skytree', name: '東京スカイツリー', short: 'スカイツリー', h: 634, square: false },
  tokyotower: { id: 'tokyotower', name: '東京タワー', short: '東京タワー', h: 333, square: true },
};

const COLORS = { w: '#eef1f2', g: '#3b4550', o: '#E8682F' };
const matCache = {};
const matOf = (k, white) => (matCache[k + white] ??= new THREE.MeshStandardMaterial({ color: k === 'w' ? white : COLORS[k], roughness: k === 'g' ? 0.25 : 0.6, metalness: k === 'g' ? 0.3 : 0.05, flatShading: true }));

export function towerKit(T) {
  const seg = SEG[T.id];
  const radial = T.square ? 4 : 40;
  const white = T.square ? '#f4f1ea' : COLORS.w;
  const parts = seg.map(([y0, y1, r0, r1, c]) => {
    const k = T.square ? Math.SQRT2 : 1;
    const g = new THREE.CylinderGeometry(r1 * k, r0 * k, y1 - y0, radial, 1, false, T.square ? Math.PI / 4 : 0);
    g.translate(0, (y0 + y1) / 2, 0);
    return [g, matOf(c, white)];
  });
  const make = () => {
    const grp = new THREE.Group();
    for (const [g, m] of parts) { const mesh = new THREE.Mesh(g, m); mesh.castShadow = mesh.receiveShadow = true; grp.add(mesh); }
    return grp;
  };
  const rAt = (y) => {
    for (const [y0, y1, r0, r1] of seg) if (y >= y0 && y <= y1) return r0 + (r1 - r0) * ((y - y0) / Math.max(y1 - y0, 1e-6));
    return 0;
  };
  const R = seg[0][2];
  // 切る時に使う形（輪切りの外形）
  const shape = {
    box: [-R, R, -R, R], H: T.h, rim: 4,   // 切り口の下の赤い帯は 4 m（高い塔で太くなりすぎないように）
    inside: (x, z) => (T.square ? Math.max(Math.abs(x), Math.abs(z)) <= R : Math.hypot(x, z) <= R),
    top: (x, z) => {
      const d = T.square ? Math.max(Math.abs(x), Math.abs(z)) : Math.hypot(x, z);
      let top = 0;
      for (const [y0, y1, r0, r1] of seg) if (d <= Math.max(r0, r1)) top = y1;
      return top;
    },
    ringAt: (y) => {
      const r = rAt(Math.min(Math.max(y, 0), T.h));
      if (T.square) return [[-r, -r], [r, -r], [r, r], [-r, r]];
      const out = [];
      for (let i = 0; i < 40; i++) { const t = (i / 40) * 2 * Math.PI; out.push([Math.cos(t) * r, Math.sin(t) * r]); }
      return out;
    },
  };
  return { make, shape, R, depth: R * 1.6 };
}
