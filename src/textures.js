// 外壁・店先・路面の画像をその場で描く（外部の画像は使わない）。
// 1 枚に「色」「ざらつき（roughness）」「凹凸（bump）」を同時に描く。ガラスはつるつる・凹ませ、壁はざらざら。
// 外壁の 1 枚は「柱の間 4 つ × 2 階分」、店先の 1 枚は「柱の間 4 つ × 1 階分」。
import * as THREE from 'three';

const rnd = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const S = 512, BAY = S / 4, FL = S / 2;

// 3 枚を同時に描く道具
class Paint {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.c = [0, 1, 2, 3].map(() => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; });
    [this.g, this.r, this.b, this.e] = this.c.map((c) => c.getContext('2d'));
    this.r.fillStyle = '#e6e6e6'; this.r.fillRect(0, 0, w, h);   // 壁はざらざら
    this.b.fillStyle = '#808080'; this.b.fillRect(0, 0, w, h);   // 凹凸の基準
    this.e.fillStyle = '#000'; this.e.fillRect(0, 0, w, h);      // 光るところ
    this.emissive = false;
  }
  rect(x, y, w, h, color, rough, bump) {
    if (color) { this.g.fillStyle = color; this.g.fillRect(x, y, w, h); }
    if (rough != null) { this.r.fillStyle = gray(rough); this.r.fillRect(x, y, w, h); }
    if (bump != null) { this.b.fillStyle = gray(bump); this.b.fillRect(x, y, w, h); }
  }
}
const gray = (v) => { const k = Math.round(Math.min(1, Math.max(0, v)) * 255); return `rgb(${k},${k},${k})`; };
const shade = (hex, f) => {
  const c = new THREE.Color(hex);
  if (f > 0) c.lerp(new THREE.Color('#ffffff'), f); else c.lerp(new THREE.Color('#000000'), -f);
  return `#${c.getHexString()}`;
};

// 壁の地：まだら・細かい粒・目地・雨だれ
function wallBase(P, r, color, opts = {}) {
  const { g } = P;
  g.fillStyle = color; g.fillRect(0, 0, P.w, P.h);
  for (let i = 0; i < 60; i++) {
    const x = r() * P.w, y = r() * P.h, rad = 20 + r() * 90;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const dark = r() < 0.5;
    grd.addColorStop(0, dark ? 'rgba(60,50,40,0.05)' : 'rgba(255,255,250,0.05)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < P.w * P.h / 10; i++) {
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${0.03 + r() * 0.03})`;
    g.fillRect(r() * P.w, r() * P.h, 1, 1);
  }
  if (opts.tile) {
    // タイル張り：細かい格子
    g.strokeStyle = 'rgba(0,0,0,0.07)'; g.lineWidth = 1;
    for (let y = 0; y < P.h; y += opts.tile) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(P.w, y + 0.5); g.stroke(); }
    for (let y = 0, k = 0; y < P.h; y += opts.tile, k++) for (let x = (k % 2) * opts.tile; x < P.w; x += opts.tile * 2.5) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + opts.tile); g.stroke(); }
  }
  if (opts.panels) {
    g.fillStyle = 'rgba(0,0,0,0.10)';
    for (let x = 0; x < P.w; x += BAY) g.fillRect(x, 0, 2, P.h);
    for (let y = 0; y < P.h; y += FL) g.fillRect(0, y, P.w, 2);
    P.b.fillStyle = gray(0.42);
    for (let x = 0; x < P.w; x += BAY) P.b.fillRect(x, 0, 2, P.h);
  }
}

function streaks(P, r, n = 30) {
  const { g } = P;
  for (let i = 0; i < n; i++) {
    const x = r() * P.w, y = r() * P.h, len = 30 + r() * 140, w = 2 + r() * 6;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, 'rgba(50,44,36,0.10)'); grd.addColorStop(1, 'rgba(50,44,36,0)');
    g.fillStyle = grd; g.fillRect(x, y, w, len);
  }
}

// 窓：くぼみの影・サッシ・ガラス（空の映り込み＋室内）
function windowAt(P, r, x, y, w, h, o = {}) {
  const { g } = P;
  const frame = o.frame ?? '#8d9093', reveal = o.reveal ?? 7;
  // くぼみ（上と左に影、下に明るい水切り）
  P.rect(x - 3, y - 3, w + 6, h + 6, shade(o.wall ?? '#999', -0.25), 0.8, 0.30);
  g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x - 3, y - 3, w + 6, reveal); g.fillRect(x - 3, y - 3, reveal * 0.7, h + 6);
  P.rect(x - 4, y + h + 2, w + 8, 4, shade(o.wall ?? '#bbb', 0.25), 0.6, 0.75);
  // サッシ
  P.rect(x, y, w, h, frame, 0.35, 0.45);
  const gx = x + 3, gy = y + 3, gw = w - 6, gh = h - 6;
  // ガラス：上ほど空が映って明るい
  const sky = o.sky ?? ['#b9c6cf', '#7d8b96'];
  const grd = g.createLinearGradient(0, gy, 0, gy + gh);
  grd.addColorStop(0, sky[0]); grd.addColorStop(0.55, sky[1]); grd.addColorStop(1, shade(sky[1], -0.35));
  g.fillStyle = grd; g.fillRect(gx, gy, gw, gh);
  P.r.fillStyle = gray(0.06); P.r.fillRect(gx, gy, gw, gh);
  P.b.fillStyle = gray(0.12); P.b.fillRect(gx, gy, gw, gh);
  // 室内：カーテン・ブラインド・暗い部屋
  const k = r();
  if (k < 0.35) {
    const cw = gw * (0.3 + r() * 0.6), cx = r() < 0.5 ? gx : gx + gw - cw;
    g.fillStyle = `rgba(${225 + r() * 25},${215 + r() * 25},${195 + r() * 25},0.55)`; g.fillRect(cx, gy, cw, gh);
    g.fillStyle = 'rgba(0,0,0,0.06)'; for (let i = cx; i < cx + cw; i += 5) g.fillRect(i, gy, 1.5, gh);
  } else if (k < 0.55) {
    g.fillStyle = 'rgba(235,232,225,0.45)';
    const bh = gh * (0.3 + r() * 0.7);
    for (let i = gy; i < gy + bh; i += 4) g.fillRect(gx, i, gw, 2);
  } else if (k < 0.62) {
    g.fillStyle = 'rgba(255,214,150,0.22)'; g.fillRect(gx, gy + gh * 0.3, gw, gh * 0.7);   // 灯り
  } else {
    g.fillStyle = 'rgba(20,24,28,0.25)'; g.fillRect(gx, gy + gh * 0.35, gw, gh * 0.65);
  }
  // 斜めの映り込み
  if (r() < 0.5) {
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath();
    const ox = gx + r() * gw;
    g.moveTo(ox, gy); g.lineTo(ox + gw * 0.18, gy); g.lineTo(ox - gw * 0.25, gy + gh); g.lineTo(ox - gw * 0.43, gy + gh); g.closePath(); g.fill();
  }
  // 方立て
  if (o.split) {
    const n = o.split;
    for (let i = 1; i < n; i++) P.rect(gx + (gw * i) / n - 2, gy, 4, gh, frame, 0.35, 0.5);
  }
  if (o.transom) P.rect(gx, gy + gh * 0.72, gw, 3, frame, 0.35, 0.5);
}

const PAINTERS = {
  // 事務所・官公庁：柱と梁の格子にガラス
  office(P, r, p) {
    wallBase(P, r, p.wall, { panels: true });
    for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
      const x = b * BAY, y = f * FL;
      windowAt(P, r, x + 10, y + 40, BAY - 20, FL - 78, { frame: p.frame, wall: p.wall, sky: p.sky, split: 2, transom: true });
    }
    for (let f = 0; f < 2; f++) {
      const y = f * FL + FL - 30;
      P.rect(0, y, S, 30, p.band, 0.85, 0.62);
      P.g.fillStyle = 'rgba(0,0,0,0.12)'; P.g.fillRect(0, y + 26, S, 4);
    }
    streaks(P, r);
  },
  // ガラス張りの塔
  glassTower(P, r, p) {
    P.rect(0, 0, S, S, p.frame, 0.3, 0.5);
    for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
      const x = b * BAY, y = f * FL;
      const t = r() * 0.08 - 0.04;
      const grd = P.g.createLinearGradient(0, y, 0, y + FL);
      grd.addColorStop(0, shade(p.sky[0], t)); grd.addColorStop(1, shade(p.sky[1], t));
      P.g.fillStyle = grd; P.g.fillRect(x + 3, y + 3, BAY - 6, FL - 40);
      P.r.fillStyle = gray(0.04); P.r.fillRect(x + 3, y + 3, BAY - 6, FL - 40);
      P.b.fillStyle = gray(0.45); P.b.fillRect(x + 3, y + 3, BAY - 6, FL - 40);
      P.rect(x + 3, y + FL - 37, BAY - 6, 34, p.band, 0.25, 0.5);
      if (r() < 0.4) { P.g.fillStyle = 'rgba(240,236,228,0.35)'; P.g.fillRect(x + 3, y + 3, BAY - 6, (FL - 40) * (0.2 + r() * 0.6)); }
    }
  },
  // 共同住宅：ベランダの床と手すり、掃き出し窓
  apartment(P, r, p) {
    wallBase(P, r, p.wall, { tile: 9 });
    for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
      const x = b * BAY, y = f * FL;
      windowAt(P, r, x + 16, y + 30, BAY - 32, FL - 92, { frame: p.frame ?? '#9a9a96', wall: p.wall, sky: p.sky, split: 2 });
      // ベランダの床の小口と、その下の影
      P.rect(x, y + FL - 40, BAY, 12, shade(p.wall, 0.12), 0.85, 0.95);
      const sh = P.g.createLinearGradient(0, y + FL - 28, 0, y + FL);
      sh.addColorStop(0, 'rgba(0,0,0,0.22)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      P.g.fillStyle = sh; P.g.fillRect(x, y + FL - 28, BAY, 28);
      // 手すり
      if (p.glassRail) {
        P.g.fillStyle = 'rgba(200,215,222,0.55)'; P.g.fillRect(x + 2, y + FL - 104, BAY - 4, 64);
        P.r.fillStyle = gray(0.1); P.r.fillRect(x + 2, y + FL - 104, BAY - 4, 64);
        P.rect(x + 2, y + FL - 106, BAY - 4, 4, '#8e9496', 0.3, 0.9);
      } else {
        P.rect(x, y + FL - 104, BAY, 64, p.rail, 0.8, 0.9);
        P.g.fillStyle = 'rgba(0,0,0,0.10)'; for (let k = 6; k < BAY; k += 10) P.g.fillRect(x + k, y + FL - 104, 2, 64);
      }
      if (r() < 0.3) { P.g.fillStyle = `hsl(${r() * 360},35%,72%)`; P.g.fillRect(x + 20 + r() * 50, y + FL - 124, 16 + r() * 22, 26); }
      P.rect(x + BAY - 4, y + 22, 4, FL - 62, shade(p.wall, -0.2), 0.8, 0.85);   // 戸境
    }
    streaks(P, r, 20);
  },
  // 戸建て：小さな窓と外壁の目地
  house(P, r, p) {
    wallBase(P, r, p.wall);
    P.g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let y = 0; y < S; y += 12) P.g.fillRect(0, y, S, 1.5);
    for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
      if (r() < 0.38) continue;
      const x = b * BAY, y = f * FL;
      const w = BAY * (0.36 + r() * 0.3), h = FL * (0.32 + r() * 0.22);
      windowAt(P, r, x + (BAY - w) / 2, y + FL * 0.24, w, h, { frame: p.frame, wall: p.wall, sky: p.sky, split: r() < 0.5 ? 2 : 0, reveal: 4 });
      if (r() < 0.5) P.rect(x + (BAY - w) / 2 - 6, y + FL * 0.24 - 14, w + 12, 7, '#6f6d68', 0.6, 0.9);
    }
    streaks(P, r, 12);
  },
  // 学校・病院：横に長い窓と庇
  school(P, r, p) {
    wallBase(P, r, p.wall, { panels: false });
    for (let f = 0; f < 2; f++) {
      const y = f * FL;
      windowAt(P, r, 6, y + 62, S - 12, FL - 118, { frame: p.frame, wall: p.wall, sky: p.sky, split: 8 });
      P.rect(0, y + FL - 48, S, 12, shade(p.wall, 0.15), 0.85, 0.95);
      const sh = P.g.createLinearGradient(0, y + FL - 36, 0, y + FL - 10);
      sh.addColorStop(0, 'rgba(0,0,0,0.18)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
      P.g.fillStyle = sh; P.g.fillRect(0, y + FL - 36, S, 26);
    }
    streaks(P, r);
  },
  // 倉庫・工場・その他：窓の少ない壁
  plain(P, r, p) {
    wallBase(P, r, p.wall);
    P.g.fillStyle = 'rgba(0,0,0,0.07)';
    for (let x = 0; x < S; x += 8) P.g.fillRect(x, 0, 1.5, S);
    for (let f = 0; f < 2; f++) for (let b = 0; b < 4; b++) {
      if (r() < 0.6) continue;
      const x = b * BAY, y = f * FL;
      windowAt(P, r, x + 34, y + 70, BAY - 68, 46, { frame: '#777', wall: p.wall, sky: p.sky, reveal: 3 });
    }
    streaks(P, r, 40);
  },
};

const SKY = { cool: ['#c3ced6', '#6f7f8b'], dark: ['#a8b3bb', '#4b5862'], warm: ['#cfcabf', '#7f7a72'], green: ['#bccac4', '#5d6f6a'] };

// 種類ごとの色違い。[絵の種類, 配色]
export const STYLES = [
  ['office', { wall: '#cfc8bb', frame: '#8b8d8f', band: '#bdb5a6', sky: SKY.cool }],
  ['office', { wall: '#a9a6a0', frame: '#55595c', band: '#94918a', sky: SKY.dark }],
  ['office', { wall: '#ddd6c7', frame: '#a09b92', band: '#cfc7b6', sky: SKY.warm }],
  ['glassTower', { frame: '#80888f', band: '#6e777e', sky: SKY.cool }],
  ['glassTower', { frame: '#5e6469', band: '#4e5459', sky: SKY.green }],
  ['office', { wall: '#d7cfc1', frame: '#6c6a66', band: '#c4bba9', sky: SKY.warm }],
  ['office', { wall: '#bfb7aa', frame: '#4c4c4c', band: '#aaa294', sky: SKY.dark }],
  ['apartment', { wall: '#e4dccc', rail: '#cfc8ba', sky: SKY.dark }],
  ['apartment', { wall: '#cdbfa8', rail: '#a09886', sky: SKY.warm }],
  ['apartment', { wall: '#dddcd6', rail: '#9aa0a3', glassRail: true, sky: SKY.cool }],
  ['house', { wall: '#e8e1d3', frame: '#7c776f', sky: SKY.dark }],
  ['house', { wall: '#c9bba6', frame: '#5a554e', sky: SKY.warm }],
  ['house', { wall: '#aaa69d', frame: '#ece8df', sky: SKY.dark }],
  ['school', { wall: '#e6e0d3', frame: '#9aa0a3', sky: SKY.cool }],
  ['school', { wall: '#d4c9b5', frame: '#8a8c8a', sky: SKY.green }],
  ['plain', { wall: '#b6b2aa', sky: SKY.dark }],
  ['plain', { wall: '#9e9c96', sky: SKY.warm }],
];

// PLATEAU の用途コード（Building_usage）→ 使える配色の番号
const BY_USAGE = {
  '401': [0, 1, 2, 3, 4, 5, 6], '402': [5, 6, 0], '403': [0, 2, 3], '404': [5, 6, 1],
  '411': [10, 11, 12], '412': [7, 8, 9], '413': [10, 11, 7], '414': [7, 8, 9], '415': [10, 11, 15],
  '421': [0, 1, 13], '422': [13, 14, 0], '431': [15, 16], '441': [15, 16],
};

export function styleFor(rec, hash) {
  let opts = BY_USAGE[rec.usage] ?? [15, 16, 0, 10];
  const h = rec.h ?? rec.H;
  if (h > 60 && ['401', '403', '421', '402', '404'].includes(rec.usage)) opts = [3, 4, 0, 1];
  return opts[hash % opts.length];
}

// 柱の間の幅 [m]（絵の 1 枚は 4 つ分）
export function bayWidth(styleIdx) {
  const kind = STYLES[styleIdx][0];
  return { office: 3.6, glassTower: 3.0, apartment: 3.6, house: 2.6, school: 3.8, plain: 5.0 }[kind];
}

// ---------- 1 階の店先 ----------
const SIGN = ['#c8463a', '#e3ad2f', '#2f62a8', '#2e8558', '#f1ede3', '#6b3d78', '#d9652f', '#1f1f1f'];
function storePainter(kind) {
  return (P, r) => {
    const W = P.w, H = P.h, bay = W / 4;
    wallBase(P, r, kind === 'lobby' ? '#8f8f8c' : '#b8b2a8');
    if (kind === 'shutter') {
      for (let b = 0; b < 4; b++) {
        const x = b * bay;
        if (r() < 0.65) {
          P.rect(x + 8, H * 0.22, bay - 16, H * 0.78, '#a4a6a6', 0.5, 0.55);
          P.g.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = H * 0.22; y < H; y += 6) P.g.fillRect(x + 8, y, bay - 16, 2);
          P.b.fillStyle = gray(0.4); for (let y = H * 0.22; y < H; y += 6) P.b.fillRect(x + 8, y, bay - 16, 2);
        } else windowAt(P, r, x + 18, H * 0.3, bay - 36, H * 0.6, { frame: '#666', sky: SKY.dark });
      }
      return;
    }
    if (kind === 'lobby') {
      P.rect(0, 0, W, H * 0.16, '#6f716f', 0.5, 0.7);
      for (let b = 0; b < 4; b++) {
        const x = b * bay;
        P.rect(x, H * 0.16, 10, H, '#55585a', 0.3, 0.7);
        const gy = H * 0.16, gh = H * 0.84;
        const grd = P.g.createLinearGradient(0, gy, 0, H);
        grd.addColorStop(0, '#9fadb6'); grd.addColorStop(1, '#3d444a');
        P.g.fillStyle = grd; P.g.fillRect(x + 10, gy, bay - 10, gh);
        P.r.fillStyle = gray(0.05); P.r.fillRect(x + 10, gy, bay - 10, gh);
        P.b.fillStyle = gray(0.2); P.b.fillRect(x + 10, gy, bay - 10, gh);
        P.g.fillStyle = 'rgba(255,220,170,0.25)'; P.g.fillRect(x + 10, gy + gh * 0.25, bay - 10, gh * 0.75);
        P.e.fillStyle = 'rgba(255,214,160,0.35)'; P.e.fillRect(x + 10, gy + gh * 0.3, bay - 10, gh * 0.7);
      }
      P.emissive = true;
      return;
    }
    // 店：看板の帯・ひさし・ガラスの奥の明るい店内
    const signH = H * 0.2;
    for (let b = 0; b < 4; b++) {
      const x = b * bay;
      const col = SIGN[Math.floor(r() * SIGN.length)];
      P.rect(x, 0, bay, signH, col, 0.6, 0.75);
      // 看板の文字らしき白い塊
      P.g.fillStyle = col === '#f1ede3' ? '#333' : 'rgba(255,255,255,0.9)';
      const n = 2 + Math.floor(r() * 4), cw = signH * 0.5;
      for (let k = 0; k < n; k++) P.g.fillRect(x + 14 + k * (cw + 5), signH * 0.25, cw, signH * 0.5);
      if (r() < 0.5) { P.e.fillStyle = 'rgba(255,255,255,0.5)'; P.e.fillRect(x, 0, bay, signH); P.emissive = true; }
      // ひさし
      if (r() < 0.45) {
        const ac = SIGN[Math.floor(r() * SIGN.length)];
        P.rect(x + 4, signH, bay - 8, H * 0.08, ac, 0.8, 0.95);
        P.g.fillStyle = 'rgba(255,255,255,0.25)'; for (let k = x + 4; k < x + bay - 8; k += 16) P.g.fillRect(k, signH, 8, H * 0.08);
      }
      // ガラスと店内
      const gy = signH + H * 0.1, gh = H - gy;
      P.rect(x + 4, gy - 4, bay - 8, gh + 4, '#3d3f41', 0.3, 0.6);
      const grd = P.g.createLinearGradient(0, gy, 0, H);
      grd.addColorStop(0, '#f2e2c4'); grd.addColorStop(1, '#a88d6a');
      P.g.fillStyle = grd; P.g.fillRect(x + 8, gy, bay - 16, gh);
      P.g.fillStyle = 'rgba(60,45,30,0.35)';
      for (let k = 0; k < 6; k++) P.g.fillRect(x + 12 + r() * (bay - 40), gy + gh * (0.3 + r() * 0.5), 6 + r() * 20, gh * (0.2 + r() * 0.3)); // 棚・人影
      P.g.fillStyle = 'rgba(255,255,255,0.12)'; P.g.fillRect(x + 8, gy, bay - 16, gh * 0.25);
      P.r.fillStyle = gray(0.05); P.r.fillRect(x + 8, gy, bay - 16, gh);
      P.b.fillStyle = gray(0.25); P.b.fillRect(x + 8, gy, bay - 16, gh);
      P.e.fillStyle = 'rgba(255,205,140,0.55)'; P.e.fillRect(x + 8, gy, bay - 16, gh);
      P.rect(x + bay / 2 - 2, gy, 4, gh, '#3d3f41', 0.3, 0.6);
    }
    P.emissive = true;
  };
}
export const STORES = ['shop', 'shop', 'shop', 'lobby', 'shutter'];
export function storeFor(rec, hash) {
  const u = rec.usage;
  if (['402', '404', '413', '414'].includes(u)) return hash % 3;
  if (['401', '403', '421', '422'].includes(u)) return (hash % 4 === 0) ? hash % 3 : 3;
  if (['431', '441', '415'].includes(u)) return 4;
  return -1;
}

function toTextures(P, renderer, color = true) {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const mk = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  return { map: mk(P.c[0], color), rough: mk(P.c[1], false), bump: mk(P.c[2], false), emissive: P.emissive ? mk(P.c[3], true) : null };
}

export function makeFacadeTextures(renderer) {
  return STYLES.map(([kind, pal], i) => {
    const P = new Paint(S, S);
    PAINTERS[kind](P, rnd(1000 + i * 77), pal);
    return { ...toTextures(P, renderer), kind };
  });
}

export function makeStoreTextures(renderer) {
  return STORES.map((kind, i) => {
    const P = new Paint(S, S / 2);
    storePainter(kind)(P, rnd(5000 + i * 31));
    return { ...toTextures(P, renderer), kind };
  });
}

function surface(base, speck, extra, renderer, seed, size = 512) {
  const P = new Paint(size, size);
  const r = rnd(seed);
  P.g.fillStyle = base; P.g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size / 5; i++) {
    const v = Math.floor(r() * 255);
    P.g.fillStyle = `rgba(${v},${v},${v},${speck})`;
    P.g.fillRect(r() * size, r() * size, 1 + r(), 1 + r());
  }
  P.r.fillStyle = gray(0.92); P.r.fillRect(0, 0, size, size);
  if (extra) extra(P, size, r);
  return toTextures(P, renderer);
}

export function makeGroundTextures(renderer) {
  return {
    asphalt: surface('#6b6863', 0.12, (P, s, r) => {
      const g = P.g;
      for (let i = 0; i < 6; i++) { g.fillStyle = `rgba(0,0,0,${0.015 + r() * 0.03})`; g.fillRect(r() * s, r() * s, 60 + r() * 180, 40 + r() * 140); }
      for (let i = 0; i < 4; i++) { g.fillStyle = `rgba(255,255,255,${0.01 + r() * 0.02})`; g.fillRect(r() * s, r() * s, 80 + r() * 160, 60 + r() * 120); }
      // 轍（タイヤの通る所が少し黒く、つるつる）
      for (const x0 of [s * 0.28, s * 0.72]) {
        const grd = g.createLinearGradient(x0 - 40, 0, x0 + 40, 0);
        grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(0.5, 'rgba(0,0,0,0.10)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd; g.fillRect(x0 - 40, 0, 80, s);
        P.r.fillStyle = gray(0.7); P.r.fillRect(x0 - 20, 0, 40, s);
      }
      g.strokeStyle = 'rgba(20,20,20,0.35)'; g.lineWidth = 1.2;
      for (let i = 0; i < 7; i++) { g.beginPath(); let x = r() * s, y = r() * s; g.moveTo(x, y); for (let k = 0; k < 7; k++) { x += (r() - 0.5) * 50; y += (r() - 0.5) * 50; g.lineTo(x, y); } g.stroke(); }
    }, renderer, 11),
    walk: surface('#b3ada3', 0.08, (P, s, r) => {
      const g = P.g;
      // インターロッキングの舗装
      const n = 10, c = s / n;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const v = (r() - 0.5) * 0.08;
        g.fillStyle = shade('#b3ada3', v); g.fillRect(i * c + 1, j * c + 1, c - 2, c / 2 - 1); g.fillRect(i * c + 1, j * c + c / 2 + 1, c - 2, c / 2 - 2);
      }
      g.fillStyle = 'rgba(60,55,50,0.35)';
      for (let k = 0; k <= s; k += c) { g.fillRect(k, 0, 1.5, s); g.fillRect(0, k, s, 1.5); g.fillRect(0, k + c / 2, s, 1); }
      P.b.fillStyle = gray(0.35); for (let k = 0; k <= s; k += c) { P.b.fillRect(k, 0, 2, s); P.b.fillRect(0, k, s, 2); }
    }, renderer, 12),
    plaza: surface('#a49e94', 0.07, (P, s) => {
      const g = P.g; g.fillStyle = 'rgba(60,55,50,0.18)';
      for (let k = 0; k <= s; k += s / 4) { g.fillRect(k, 0, 1.5, s); g.fillRect(0, k, s, 1.5); }
    }, renderer, 13),
    green: surface('#6c7356', 0.14, null, renderer, 14),
    roof: surface('#8d8a84', 0.10, (P, s, r) => {
      for (let i = 0; i < 10; i++) { P.g.fillStyle = `rgba(0,0,0,${0.04 + r() * 0.06})`; P.g.fillRect(r() * s, r() * s, 40 + r() * 120, 40 + r() * 120); }
    }, renderer, 15),
    curb: surface('#c9c4ba', 0.08, null, renderer, 16, 128),
  };
}

// 看板（袖看板・屋上看板）。文字は読めない四角の並びで、特定の店や会社を表さない
export function makeSignTextures(renderer) {
  const pals = [
    ['#d23c32', '#ffffff'], ['#f2c230', '#2a2a2a'], ['#2d63b4', '#ffffff'], ['#1f1f1f', '#f6e27a'],
    ['#f4f1e8', '#c8352b'], ['#2f8f5b', '#ffffff'], ['#7b3f8c', '#ffe8f6'], ['#ef7d2d', '#ffffff'],
  ];
  return pals.map(([bg, fg], i) => {
    const r = rnd(9000 + i * 13);
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 256, 512);
    grd.addColorStop(0, shade(bg, 0.12)); grd.addColorStop(1, shade(bg, -0.12));
    g.fillStyle = grd; g.fillRect(0, 0, 256, 512);
    g.strokeStyle = shade(bg, -0.35); g.lineWidth = 10; g.strokeRect(5, 5, 246, 502);
    g.fillStyle = fg;
    // 縦書きの文字らしき塊
    const n = 3 + Math.floor(r() * 4), ch = 400 / n;
    for (let k = 0; k < n; k++) {
      const y = 50 + k * ch, w = 110 + r() * 50;
      g.fillRect(128 - w / 2, y, w, ch * 0.18);
      g.fillRect(128 - w / 2 + r() * 20, y + ch * 0.3, w * 0.25, ch * 0.45);
      g.fillRect(128 + r() * 30, y + ch * 0.28, w * 0.3, ch * 0.5);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  });
}
