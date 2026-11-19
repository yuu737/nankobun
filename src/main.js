// それって身近なもの何個分？：PLATEAU のデータをもとに、東京ドーム・自分の家・いつもの道で街を比べる
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildCity, buildBuilding, Builder, SINK, makeBuildingMaker } from './city.js';
import { DropKit, fitDome, makeDomeMaker } from './dome.js';
import { domeShape, prismShape } from './cut.js';
import { TOWERS, towerKit } from './tower.js';
import * as SND from './audio.js';

const $ = (id) => document.getElementById(id);
const say = (t) => { $('loadmsg').textContent = t; };

const USAGE = {
  '401': '業務施設', '402': '商業施設', '403': '宿泊施設', '404': '商業系複合施設', '411': '住宅', '412': '共同住宅',
  '413': '店舗等併用住宅', '414': '店舗等併用共同住宅', '415': '作業所併用住宅', '421': '官公庁施設', '422': '文教厚生施設',
  '431': '運輸倉庫施設', '441': '工場', '452': '農林漁業用施設', '453': '供給処理施設', '454': '防衛施設', '461': 'その他',
};
const MODE_NAME = { h: '高さ', area: '面積（足元）', vol: '体積', dist: '距離' };

// ---------- 描画の土台 ----------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
// スマホなど（指で触る・画面が小さい）は軽くする：画素比 1、影を粗く、接地の陰りとぼかしを切る
const LITE = matchMedia('(pointer: coarse)').matches || Math.min(innerWidth, innerHeight) < 600;
renderer.setPixelRatio(Math.min(devicePixelRatio, LITE ? 1 : 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const HAZE = new THREE.Color('#e4dccd');
scene.fog = new THREE.FogExp2(HAZE, 0.00052);
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.5, 14000);

// 空（午後、南西から日が差す）
const sky = new Sky();
sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 9; su.rayleigh.value = 0.75; su.mieCoefficient.value = 0.009; su.mieDirectionalG.value = 0.82;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 30), THREE.MathUtils.degToRad(218));
su.sunPosition.value.copy(sunDir);
scene.add(sky);
{
  const pm = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const s2 = new Sky(); s2.scale.setScalar(1000); s2.material.uniforms.sunPosition.value.copy(sunDir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) s2.material.uniforms[k].value = su[k].value;
  envScene.add(s2);
  scene.environment = pm.fromScene(envScene, 0, 1, 2000).texture;
}

const hemi = new THREE.HemisphereLight('#f1ede6', '#9a8b74', 0.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#ffdcb5', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(LITE ? 2048 : 4096, LITE ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -520, right: 520, top: 520, bottom: -520, near: 10, far: 3500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.8; sun.shadow.radius = 3;
scene.add(sun, sun.target);

// 後処理：接地の陰り（GTAO）・被写界深度・にじみ → トーン → 色づくり（表示の色の上で）・粒 → アンチエイリアス
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
gtao.updateGtaoMaterial({ radius: 3.0, distanceExponent: 1.4, thickness: 3.0, scale: 1.25, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
gtao.blendIntensity = 0.85;
composer.addPass(gtao);
const bokeh = new BokehPass(scene, camera, { focus: 40, aperture: 0.000016, maxblur: 0.0065 });
composer.addPass(bokeh);
composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.12, 0.35, 0.92));
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(innerWidth, innerHeight) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 d = vUv - 0.5;
      float ca = dot(d,d) * 0.004;
      vec3 c = vec3(texture2D(tDiffuse, vUv + d*ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - d*ca).b);
      float l = dot(c, vec3(0.299,0.587,0.114));
      // 暗部はわずかに青緑、明部は暖かく（写真の色づくり）
      c = mix(c * vec3(1.0, 0.99, 0.98), c * vec3(1.06, 1.0, 0.91), smoothstep(0.2, 0.85, l));
      // 黒を持ち上げ、ハイライトをやわらかく
      c = 0.02 + c * 0.97;
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.4);
      c = mix(vec3(dot(c, vec3(0.299,0.587,0.114))), c, 0.88);
      c *= 1.0 - dot(d,d) * 0.45;
      c += (h(vUv * uRes + uTime) - 0.5) * 0.03;
      gl_FragColor = vec4(c, 1.0);
    }`,
});
composer.addPass(grade);
const smaa = new SMAAPass(innerWidth * renderer.getPixelRatio(), innerHeight * renderer.getPixelRatio());
composer.addPass(smaa);

let recording = false;   // 書き出し中は画面の大きさを変えない（読み込み中の resize より先に宣言する）
addEventListener('resize', () => {
  if (recording) return;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); gtao.setSize(innerWidth, innerHeight);
  grade.uniforms.uRes.value.set(innerWidth, innerHeight);
});

// ---------- 街と物差し ----------
say('PLATEAU を読み込み中…');
const data = await (await fetch('./data/city.json')).json();
say('建物を組み立て中…');
await new Promise((r) => setTimeout(r, 30));
const domeRec = data.buildings.find((b) => b.name === '東京ドームシティー') ?? data.buildings.reduce((a, b) => (b.area > a.area ? b : a));
const city = buildCity(data, renderer, domeRec.id);
scene.add(city.group);
const ground3 = (X, Z) => city.ground(X, -Z);

const fit = fitDome(domeRec);
const makeDome = makeDomeMaker(fit);
const realDome = makeDome();
realDome.position.set(fit.cx, domeRec.z0 - 0.5, fit.cz);
scene.add(realDome);
const kit = new DropKit(scene);

// 物差し：東京ドーム（PLATEAU 基準）か、選んだ建物
const DOME = {
  kind: 'dome', rec: domeRec, name: '東京ドーム', full: '東京ドーム（PLATEAU 基準）', ctr: '個',
  h: domeRec.h, area: domeRec.area, vol: domeRec.vol, R: Math.max(fit.ax, fit.az), depth: 2 * Math.min(fit.ax, fit.az), make: makeDome,
};
let unit = DOME;
DOME.shape = (() => { let sh = null; return () => (sh ??= domeShape()); })();
// 1 個に満たない分の見せ方：'cut'（切る・既定）か 'shrink'（縮める）
let fracMode = 'cut';
try { const v = localStorage.getItem('nankobun.frac'); if (v === 'cut' || v === 'shrink') fracMode = v; } catch {}
const fracSound = () => (fracMode === 'cut' ? SND.slice() : SND.squeeze());
const nameOf = (rec) => (rec === domeRec ? '東京ドーム' : rec.name ?? (USAGE[rec.usage] ?? '建物'));
function unitFromRec(rec) {
  if (rec === domeRec) return DOME;
  const mk = makeBuildingMaker(rec, city.mats);
  const h = rec.h ?? rec.H;
  const sy = h / Math.max(mk.vis, 0.5);   // LOD1 の箱は計測高さより低いので、物差しの形は計測高さまで縦に伸ばす
  const ctr = ['411', '413', '415'].includes(rec.usage) ? '軒' : '棟';
  const nm = nameOf(rec);
  return {
    kind: 'bldg', rec, name: nm, full: `${nm}（PLATEAU）`, ctr, h, area: rec.area, vol: rec.vol, R: mk.R, depth: mk.depth,
    make: () => { const g = mk.make(); g.scale.y = sy; return g; },
    shape: (() => { let sh = null; return () => (sh ??= prismShape(mk.ring, mk.vis)); })(),
  };
}

// ---------- 視点 ----------
const view = { mode: 'eye', x: 0, z: 0, yaw: 0, pitch: 0, eye: 1.6 };
const orbit = new OrbitControls(camera, canvas);
orbit.enabled = false; orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.49; orbit.minDistance = 30; orbit.maxDistance = 3000;

function lookAtFrom(x, z, tx, ty, tz) {
  const y = ground3(x, z) + view.eye;
  view.x = x; view.z = z;
  view.yaw = Math.atan2(-(tx - x), -(tz - z));
  view.pitch = Math.atan2(ty - y, Math.hypot(tx - x, tz - z));
}

{
  // 最初の立ち位置：白山通りの南（水道橋の先）から北を見ると、通りの突き当たりにドームが見える
  const fav = [-9, -460];
  const p = !city.blockedAt(fav[0], -fav[1]) ? fav : [fit.cx - 350, fit.cz + 300];
  lookAtFrom(p[0], p[1], fit.cx, domeRec.z0 + 22, fit.cz);
}

// 目の高さ：ドラッグで見回す、WASD で歩く
const keys = new Set();
const typing = () => document.activeElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
addEventListener('keydown', (e) => { if (!typing()) keys.add(e.key.toLowerCase()); });
addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY }; canvas.classList.add('drag'); });
addEventListener('pointerup', (e) => {
  canvas.classList.remove('drag');
  if (drag && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5 && e.target === canvas) pick(e);
  drag = null;
});
addEventListener('pointermove', (e) => {
  if (!drag || view.mode !== 'eye' || tween) return;
  view.yaw -= (e.clientX - drag.x) * 0.0035;
  view.pitch = THREE.MathUtils.clamp(view.pitch - (e.clientY - drag.y) * 0.0035, -1.2, 1.3);
  drag.x = e.clientX; drag.y = e.clientY;
});
canvas.addEventListener('wheel', (e) => {
  if (view.mode !== 'eye') return;
  const s = -Math.sign(e.deltaY) * 12;
  view.x += -Math.sin(view.yaw) * s; view.z += -Math.cos(view.yaw) * s;
}, { passive: true });

function setMode(m) {
  view.mode = m;
  $('tEye').classList.toggle('on', m === 'eye');
  $('tSky').classList.toggle('on', m === 'sky');
  orbit.enabled = m === 'sky';
  if (m === 'sky') {
    const t = focus.clone();
    orbit.target.copy(t);
    const dir = new THREE.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    camera.position.copy(t).addScaledVector(dir, -650).add(new THREE.Vector3(0, 420, 0));
    orbit.update();
  } else {
    lookAtFrom(view.x, view.z, focus.x, focus.y, focus.z);
  }
}
$('tEye').onclick = () => setMode('eye');
$('tSky').onclick = () => setMode('sky');
$('tSound').onclick = () => { SND.setSound(!SND.soundOn); $('tSound').classList.toggle('on', SND.soundOn); };

// ---------- 比べる ----------
let mode = 'h';
let selected = null;   // { rec } または { dome: true }
let effect = null;
let destName = null;   // 距離を測る行き先の駅
const focus = new THREE.Vector3(fit.cx, domeRec.z0 + 25, fit.cz);
let highlight = null;

function setCompareMode(m) {
  if (m === 'trace') { startTrace(); return; }
  mode = m;
  for (const o of document.querySelectorAll('#modes button')) o.classList.toggle('on', o.dataset.m === m);
  if (selected) compare(selected);
}
for (const b of document.querySelectorAll('#modes button')) b.onclick = () => setCompareMode(b.dataset.m);

const ray = new THREE.Raycaster();
function pick(e) {
  if (trace.on) { addTracePoint(e); return; }
  if (tween) return;
  const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(p, camera);
  if (sinkTarget < 1) {
    // 周りを沈めている間：ドームを押したらドームを測り直す、それ以外は街を戻す
    if (ray.intersectObject(realDome, false).length) compare({ dome: true });
    else restore();
    return;
  }
  const hits = ray.intersectObjects([...city.pickables, realDome], false);
  if (!hits.length) return;
  const h = hits[0];
  if (h.object === realDome) { compare({ dome: true }); return; }
  const bid = h.object.geometry.userData.faceBid[h.faceIndex];
  if (bid >= 0) compare({ rec: data.buildings[bid] });
}

function showHighlight(rec) {
  if (highlight) { scene.remove(highlight); highlight = null; }
  if (!rec) return;
  const W = new Builder(), R = new Builder();
  buildBuilding(rec, 0, W, R, rec.style ?? 0);
  const g = new THREE.Group();
  for (const B of [W, R]) {
    if (!B.pos.length) continue;
    const geo = B.geometry();
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })));
    g.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), new THREE.LineBasicMaterial({ color: '#fff3d6' })));
  }
  highlight = g;
  scene.add(g);
}

const fmt = (v) => (v >= 100 ? Math.round(v).toLocaleString('ja-JP') : v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.1 ? v.toFixed(2) : v.toFixed(3));
const num = (v) => v.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
const man = (v) => (v >= 1e4 ? `${(v / 1e4).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}万` : num(v));

function centroid(rec) {
  const r = rec.rings[0];
  let x = 0, y = 0;
  for (const p of r) { x += p[0] / r.length; y += p[1] / r.length; }
  return [x, -y];
}

// 周りの建物を沈める・戻す
let sinkTarget = 1;
const AUTO_RETURN = 3.0;   // 結果が出てから街が戻るまで [秒]
function restore() {
  sinkTarget = 1;
  kit.clear();
  effect = null; selected = null;
  showHighlight(null);
  for (const id of ['label', 'blabel', 'slabel', 'card']) $(id).style.display = 'none';
}
addEventListener('keydown', (e) => {
  if (typing()) return;
  if (e.key === 'Escape' && trace.on) { endTrace(true); return; }
  if (e.key === 'Escape' && (sinkTarget < 1 || effect)) restore();
  if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase()) && sinkTarget < 1 && !tween) restore();
  if (e.key.toLowerCase() === 'h') document.body.classList.toggle('clean');
});

// 収めたい点が画面に入る距離を探し、建物の外に立って、そこへカメラを動かす
function frameView(pts, midX, midZ, lookY, lift0 = 0, dirOverride = null) {
  let lift = lift0;
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * camera.aspect);
  if (view.mode !== 'eye') { orbit.target.set(midX, lookY, midZ); focus.set(midX, lookY, midZ); return; }
  const camDir = [camera.position.x - midX, camera.position.z - midZ];
  const L = Math.hypot(...camDir) || 1;
  const [ux, uz] = dirOverride ?? [camDir[0] / L, camDir[1] / L];
  const cam2 = camera.clone();
  let Dd = 300, cx = 0, cz = 0;
  // 画面の文字で隠れていない所（NDC の四角）。スマホは上の帯と下の札の間、広い画面は右下のカードを避けて左寄り。動画は全体
  const safe = { cx: 0, cy: 0, hx: 0.86, hy: 0.8 };
  if (!recording) {
    if (innerWidth <= 700) {
      const top = Math.max(...['brand', 'finder'].map((id) => $(id).getBoundingClientRect().bottom)) + 30;
      const bot = Math.min(...['card', 'modes'].map((id) => { const r = $(id).getBoundingClientRect(); return r.height ? r.top : innerHeight; })) - 8;
      const y0 = 1 - 2 * top / innerHeight, y1 = 1 - 2 * bot / innerHeight;   // 上端・下端の NDC
      if ((y0 - y1) / 2 > 0.3) { safe.cy = (y0 + y1) / 2; safe.hy = (y0 - y1) / 2 * 0.92; safe.hx = 0.9; }   // 画面が低すぎる時は文字の裏も使う
    } else if (innerWidth > 900) { safe.cx = -0.22; safe.hx = 0.64; }
  }
  for (let it = 0; it < 8; it++) {
    cx = midX + ux * Dd; cz = midZ + uz * Dd;
    cam2.position.set(cx, ground3(cx, cz) + 1.6 + lift, cz);
    cam2.lookAt(midX, lookY, midZ);
    cam2.updateMatrixWorld();
    let mx = 0, my = 0;
    for (const p of pts) { const q = p.clone().project(cam2); if (q.z > 1) { mx = 9; break; } mx = Math.max(mx, Math.abs(q.x)); my = Math.max(my, Math.abs(q.y)); }
    const m = Math.max(mx / safe.hx, my / safe.hy);
    Dd = THREE.MathUtils.clamp(Dd * (0.35 + 0.65 * m), 120, 2600);
  }
  // 読み込んだ範囲（±1.4 km）の外に出ないよう、向きを少しずつ回して範囲の中に立つ所を探す。無ければ近づく
  if (Math.max(Math.abs(cx), Math.abs(cz)) > 1300) {
    const base = Math.atan2(uz, ux);
    let ok = false;
    for (const da of [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
      const x = midX + Math.cos(base + da) * Dd, z = midZ + Math.sin(base + da) * Dd;
      if (Math.max(Math.abs(x), Math.abs(z)) <= 1300) { cx = x; cz = z; ok = true; break; }
    }
    if (!ok) { const k = 1250 / Math.max(Math.abs(cx), Math.abs(cz)); cx *= k; cz *= k; }
  }
  // 街が戻った時に建物の中にいないよう、建物の外（周り 3 m も空いている所）へ
  const inDome = (x, z) => Math.hypot(x - fit.cx, z - fit.cz) < Math.max(fit.ax, fit.az) * 1.15;   // 東京ドームの中に立たない
  const free = (x, z) => !inDome(x, z) && [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]].every(([a, b]) => !city.blockedAt(x + a, -(z + b)));
  if (!free(cx, cz)) {
    search: for (let extra = 0; extra <= 300; extra += 6) {
      for (const da of [0, 0.12, -0.12, 0.25, -0.25]) {
        const c = Math.cos(da), s2 = Math.sin(da);
        const vx = ux * c - uz * s2, vz = ux * s2 + uz * c;
        const x = midX + vx * (Dd + extra), z = midZ + vz * (Dd + extra);
        if (free(x, z)) { cx = x; cz = z; break search; }
      }
    }
  }
  // それでも範囲の外なら、範囲の端まで近づき、近づいた分だけ上がる
  if (Math.max(Math.abs(cx), Math.abs(cz)) > 1300) {
    let lo = 0, hi = 1;
    for (let k = 0; k < 24; k++) { const t = (lo + hi) / 2; if (Math.max(Math.abs(midX + (cx - midX) * t), Math.abs(midZ + (cz - midZ) * t)) <= 1300) lo = t; else hi = t; }
    const lost = Math.hypot(cx - midX, cz - midZ) * (1 - lo);
    cx = midX + (cx - midX) * lo; cz = midZ + (cz - midZ) * lo; lift += lost * 0.5;
  }
  // 見せたい物が安全な四角の真ん中に来るよう、狙う点を横・縦にずらす
  const dl2 = Math.hypot(midX - cx, midZ - cz) || 1, fx2 = (midX - cx) / dl2, fz2 = (midZ - cz) / dl2;
  const sh = dl2 * Math.tan(hf) * -safe.cx, sv = dl2 * Math.tan(vf) * safe.cy;
  startTween(cx, cz, lift, midX - fz2 * sh, lookY - sv, midZ + fx2 * sh);
  focus.set(midX, lookY, midZ);
}

// 物差しの数え方の言葉（「個分」「棟分」「倍」）
const ctrOf = (u = unit) => (u.kind === 'route' ? (effect && (effect.view === 'straight' || effect.view === 'stack') ? '本分' : '倍') : `${u.ctr}分`);
const short = (town) => town.replace(/^(東京都)?[^区市]+[区市]/, '');

function compare(sel) {
  if (trace.on) endTrace(false);
  selected = sel;
  kit.clear();
  if (sel.town) return measureTown(sel.town);
  if (sel.tower) return measureTower(sel.tower);
  const isDome = !!sel.dome;
  const rec = isDome ? domeRec : sel.rec;
  SINK.select(isDome ? [] : [data.buildings.indexOf(rec)]);
  sinkTarget = 0;
  showHighlight(isDome ? null : rec);
  if (mode === 'dist') return measureDistance(rec, isDome);
  return measureSize(rec, isDome);
}

// 物差しを降らせる並べ方。高さ：積む／面積：地面に並べる／体積：積み木のように積む。端数は最後の 1 個を切る（または縮める）
function dropPlan(m, ratio, ox, oz, right, back) {
  const n = Math.floor(ratio + 1e-9), f = ratio - n;
  const drops = [];
  const MAXN = m === 'h' ? 60 : 200;
  let height = unit.h, width = 2 * unit.R;
  if (m === 'h') {
    const cnt = Math.min(n, MAXN);
    const yL = ground3(ox, oz);
    for (let i = 0; i < cnt; i++) drops.push({ x: ox, z: oz, y: yL + i * unit.h });
    if (f > 0.005 || n === 0) {
      const q = ratio < 1 ? ratio : f;
      drops.push(fracMode === 'cut'
        ? { x: ox, z: oz, y: yL + cnt * unit.h, cut: { n: new THREE.Vector3(0, 1, 0), d: q * unit.h, sep: Math.max(10, unit.h * 0.35) } }
        : { x: ox, z: oz, y: yL + cnt * unit.h, final: [1, q, 1] });
    }
    height = Math.max(ratio, 1) * unit.h;
  } else {
    const total = Math.min(n, MAXN) + (f > 0.005 || n === 0 ? 1 : 0);
    const cols = m === 'area' ? Math.ceil(Math.sqrt(total)) : Math.ceil(Math.cbrt(total));
    const perLayer = m === 'area' ? total : cols * cols;
    const sp = 2.08 * unit.R;
    for (let i = 0; i < total; i++) {
      const layer = Math.floor(i / perLayer), k = i % perLayer;
      const c = k % cols, r = Math.floor(k / cols);
      const x = ox + right.x * (c * sp) + back.x * (r * sp), z = oz + right.z * (c * sp) + back.z * (r * sp);
      const last = i === total - 1 && (f > 0.005 || n === 0);
      const q = ratio < 1 ? ratio : f;
      const fin = last && fracMode !== 'cut' ? (m === 'area' ? [Math.sqrt(q), 1, Math.sqrt(q)] : [Math.cbrt(q), Math.cbrt(q), Math.cbrt(q)]) : null;
      const cut = last && fracMode === 'cut' ? { n: right.clone(), q, byVolume: m === 'vol', sep: Math.max(10, unit.R * 0.7) } : null;
      drops.push({ x, z, y: ground3(x, z) + layer * unit.h, final: fin, cut });
    }
    width = cols * sp;
    height = unit.h * Math.ceil(total / perLayer);
  }
  return { drops, height, width, n, shown: n > MAXN ? MAXN : null };
}
function runDrops(plan, m) {
  const interval = THREE.MathUtils.clamp(5 / plan.drops.length, 0.05, m === 'h' ? 0.55 : 0.35);
  let landed = 0;
  plan.drops.forEach((d, i) => {
    kit.drop({
      unit, x: d.x, z: d.z, yLand: d.y, delay: 1.2 + i * interval, final: d.final, cut: d.cut,
      onLand: () => { landed++; if (landed < 40 || landed % 10 === 0) { SND.thump(i === 0 ? 1 : 0.7); SND.tick(landed); } effect.count = Math.min(landed, Math.max(plan.n, 0)); },
      onSquash: () => { fracSound(); effect.squeezing = true; },
    });
  });
  setTimeout(() => SND.whoosh(1.1), 1200);
  return 1.2 + plan.drops.length * interval + 1.4 + 1.4;   // 最後の 1 個が落ちる時間（約 1.4 秒）も足す
}
// 演出の場所：対象の横の、画面の真ん中に近い側
function sideOf(bx, by, bz) {
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  if (new THREE.Vector3(bx, by, bz).project(camera).x > 0) right.negate();
  return { right, back: new THREE.Vector3(fwd.x, 0, fwd.z) };
}
function boxPoints(list) {
  const pts = [];
  for (const [x, z, r, y0, y1] of list) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const y of [y0, y1]) pts.push(new THREE.Vector3(x + a * r, y, z + b * r));
  return pts;
}

// 高さ・面積・体積：物差しを降らせて積む・並べる
function measureSize(rec, isDome) {
  if (unit.kind === 'tower') forceHeight();   // タワーは高さだけ（足元・体積は PLATEAU に無い）
  if (unit.kind === 'route') return measureHeightByRoute(rec, isDome);
  const val = { h: rec.h ?? rec.H, area: rec.area, vol: rec.vol }[mode];
  const ratio = val / unit[mode];
  const [bx, bz] = isDome ? [fit.cx, fit.cz] : centroid(rec);
  const rB = Math.sqrt(rec.area / Math.PI);
  const { right, back } = sideOf(bx, (rec.z0 ?? 0) + 10, bz);
  const off = (isDome ? fit.ax : rB) + unit.R + 14;
  const ox = bx + right.x * off, oz = bz + right.z * off;
  const yL = ground3(ox, oz);
  const plan = dropPlan(mode, ratio, ox, oz, right, back);
  const dur = runDrops(plan, mode);
  // 1 個に満たない高さを切る時は、切った後の高さに合わせて見せる（大きなタワーを物差しにした時など）
  if (mode === 'h' && fracMode === 'cut' && ratio < 1) plan.height = Math.max(ratio * unit.h, 1);
  const C = new THREE.Vector3(ox + (mode === 'h' ? 0 : (plan.width / 2 - unit.R) * right.x), yL + Math.min(plan.height, 400) / 2, oz + (mode === 'h' ? 0 : (plan.width / 2 - unit.R) * right.z));
  const bh = rec.h ?? rec.H;
  effect = {
    kind: 'size', C, top: yL + plan.height, x: ox, z: oz, count: 0, ratio, n: plan.n, t: 0, val, rec, isDome,
    bx, bz, btop: isDome ? domeRec.z0 + domeRec.h : rec.z0 + bh, bname: isDome ? null : `${nameOf(rec)}  ${num(bh)} m`, dur, shown: plan.shown,
  };
  const showH = Math.min(Math.max(plan.height, bh), 700);
  const midX = mode === 'h' ? (ox + bx) / 2 : (C.x + bx) / 2, midZ = mode === 'h' ? (oz + bz) / 2 : (C.z + bz) / 2;
  const boxes = [[bx, bz, isDome ? fit.ax : rB, rec.z0 ?? yL, (rec.z0 ?? yL) + bh]];
  if (mode === 'h') boxes.push([ox, oz, unit.R, yL, yL + Math.min(plan.height, 700)]);
  else for (const d of plan.drops) boxes.push([d.x, d.z, unit.R, d.y, d.y + unit.h]);
  renderCard();
  frameView(boxPoints(boxes), midX, midZ, yL + showH * 0.42, 0);
}

// 物差しが「いつもの道」の時の高さ：道を立てて、建物の横に柱にする
function measureHeightByRoute(rec, isDome) {
  if (mode !== 'h') { mode = 'h'; for (const o of document.querySelectorAll('#modes button')) o.classList.toggle('on', o.dataset.m === 'h'); }
  const bh = rec.h ?? rec.H, L = unit.len;
  const ratio = bh / L;
  const [bx, bz] = isDome ? [fit.cx, fit.cz] : centroid(rec);
  const rB = Math.sqrt(rec.area / Math.PI);
  const { right } = sideOf(bx, (rec.z0 ?? 0) + 10, bz);
  const ox = bx + right.x * (rB + 20), oz = bz + right.z * (rB + 20), yL = ground3(ox, oz);
  const pw = Math.max(8, L / 40);
  const g = new THREE.BoxGeometry(pw, L, pw); g.translate(0, L / 2, 0);
  const pillar = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: stripeTexture(L), roughness: 0.6, emissive: '#5a2a10', emissiveIntensity: 0.15 }));
  pillar.position.set(ox, yL, oz); pillar.scale.y = 0.001; pillar.castShadow = true;
  scene.add(pillar);
  kit.live.push({ kind: 'grow', root: pillar, t: -0.8, dur: 2.2, onLand: () => { SND.thump(0.8); effect.squeezing = true; } });
  effect = {
    kind: 'size', C: new THREE.Vector3(ox, yL + Math.min(L, 500) / 2, oz), top: yL + Math.min(L, 600), x: ox, z: oz, count: 0, ratio, n: 0, t: 0, val: bh, rec, isDome,
    bx, bz, btop: (isDome ? domeRec.z0 + domeRec.h : rec.z0 + bh), bname: isDome ? null : `${nameOf(rec)}  ${num(bh)} m`, dur: 3.2,
  };
  renderCard();
  const topV = Math.max(L, bh);
  frameView(boxPoints([[bx, bz, rB, yL, yL + bh], [ox, oz, pw, yL, yL + topV]]), (ox + bx) / 2, (oz + bz) / 2, yL + topV * 0.45, THREE.MathUtils.clamp(topV * 0.35, 0, 450));
}
// 道の長さを 50 m ごとの縞にした絵（立てた柱に貼る）
function stripeTexture(L) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 512;
  const g = c.getContext('2d');
  const n = Math.max(1, Math.round(L / 50));
  for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#f4efe4' : '#C8372B'; g.fillRect(0, 512 - (i + 1) * 512 / n, 8, 512 / n); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}

// ---------- 道（線）：長さ・位置・帯 ----------
function pathLen(P) { let L = 0; for (let i = 1; i < P.length; i++) L += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); return L; }
function pathAt(P, s) {
  for (let i = 1; i < P.length; i++) {
    const [x0, z0] = P[i - 1], [x1, z1] = P[i], L = Math.hypot(x1 - x0, z1 - z0);
    if (s <= L || i === P.length - 1) { const f = L ? Math.min(s / L, 1) : 0; return { x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f, dx: (x1 - x0) / (L || 1), dz: (z1 - z0) / (L || 1) }; }
    s -= L;
  }
  return { x: P[0][0], z: P[0][1], dx: 1, dz: 0 };
}
// s0〜s1 の区間を帯（平らな細長い面）にする
function ribbon(P, s0, s1, w, lift, mat) {
  const pts = [];
  const step = 4;
  for (let s = s0; s < s1; s += step) pts.push(pathAt(P, s));
  pts.push(pathAt(P, s1));
  const pos = [], idx = [];
  pts.forEach((p, i) => {
    const nx = -p.dz, nz = p.dx, y = ground3(p.x, p.z) + lift;
    pos.push(p.x + nx * w / 2, y, p.z + nz * w / 2, p.x - nx * w / 2, y, p.z - nz * w / 2);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return new THREE.Mesh(g, mat);
}
const lineMat = new THREE.MeshBasicMaterial({ color: '#ffcf6b', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6 });
const bandMats = ['#F1C232', '#2B2E33'].map((c) => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8 }));

// 道に沿って測る。いつもの道が物差しなら、いつもの道の長さごとの帯を敷く。建物・ドームが物差しなら、倒して並べる
function layPath(P, meta) {
  kit.clear();
  sinkTarget = 0;
  SINK.select(meta.keep ?? []);
  if (unit.kind === 'route' && !meta.straight && meta.view !== 'along') return straightenPath(P, meta);
  if (unit.kind === 'tower') return standPath(P, meta);
  const len = pathLen(P);
  let ratio, items = 0, dur, n;
  const line = ribbon(P, 0, len, 1.6, 0.35, lineMat);
  scene.add(line); kit.live.push({ kind: 'static', root: line, t: 0 });
  let landed = 0;
  if (unit.kind === 'route') {
    ratio = len / unit.len;
    n = Math.floor(ratio + 1e-9);
    const pieces = Math.min(Math.ceil(ratio - 1e-9), 200);
    const interval = THREE.MathUtils.clamp(4 / pieces, 0.08, 0.6);
    for (let k = 0; k < pieces; k++) {
      const m = ribbon(P, k * unit.len, Math.min((k + 1) * unit.len, len), 11, 0.6, bandMats[k % 2]);
      m.visible = false; scene.add(m);
      kit.live.push({ kind: 'reveal', root: m, t: -(1.0 + k * interval), onLand: () => { landed++; SND.tick(landed); effect.count = Math.min(landed, n); if (k === pieces - 1 && ratio % 1 > 0.005) effect.squeezing = true; } });
    }
    items = pieces; dur = 1.0 + pieces * interval + 1.0;
  } else {
    ratio = len / unit.h;
    n = Math.floor(ratio + 1e-9);
    const f = ratio - n, cnt = Math.min(n, 150);
    const list = [];
    for (let i = 0; i < cnt; i++) list.push({ i, final: 1 });
    if (f > 0.005 || n === 0) list.push({ i: cnt, final: ratio < 1 ? ratio : f });
    const interval = THREE.MathUtils.clamp(6 / list.length, 0.06, 0.5);
    for (const it of list) {
      const s = it.i * unit.h, p = pathAt(P, s), q = pathAt(P, Math.min(s + unit.h * 0.5, len));
      kit.topple({
        unit, x: p.x, y: ground3(p.x, p.z), z: p.z, dir: new THREE.Vector3(q.dx, 0, q.dz), delay: 1.0 + it.i * interval,
        final: fracMode === 'cut' ? 1 : it.final,
        cut: fracMode === 'cut' && it.final < 0.999 ? { n: new THREE.Vector3(0, 1, 0), d: it.final * unit.h, sep: Math.max(10, unit.h * 0.35) } : null,
        onLand: () => { landed++; if (landed < 40 || landed % 10 === 0) { SND.thump(0.6); SND.tick(landed); } effect.count = Math.min(landed, n); },
        onSquash: () => { fracSound(); effect.squeezing = true; },
      });
    }
    items = list.length; dur = 1.0 + list.length * interval + 1.3;
  }
  // 駅の光の柱
  const end = P[P.length - 1];
  if (meta.station) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 120, 24, 1, true), new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
    pillar.position.set(end[0], ground3(end[0], end[1]) + 60, end[1]);
    scene.add(pillar); kit.live.push({ kind: 'static', root: pillar, t: 0 });
  }
  const mid = pathAt(P, len / 2);
  const yM = ground3(mid.x, mid.z), th = unit.kind === 'route' ? 6 : Math.max(unit.depth, 6);
  effect = {
    kind: 'path', C: new THREE.Vector3(mid.x, yM, mid.z), top: yM + th, x: mid.x, z: mid.z, count: 0, ratio, n, t: 0, val: len, dur,
    title: meta.title, from: meta.from, to: meta.to, straight: !!meta.straight, list: meta.list, rec: meta.rec, isDome: meta.isDome, path: P, view: 'along',
    bx: meta.bx ?? P[0][0], bz: meta.bz ?? P[0][1], btop: meta.btop ?? (ground3(P[0][0], P[0][1]) + 10), bname: meta.bname ?? (meta.from ? null : '出発'),
    sx: end[0], sz: end[1], sy: ground3(end[0], end[1]) + (meta.station ? 125 : 12), sname: meta.to ?? '到着',
    shown: items < n ? items : null,
  };
  // 道の全体が見えるよう、道の向きの横から、上がって見下ろす
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const [x, z] of P) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
  const diag = Math.hypot(maxx - minx, maxz - minz);
  const pts = [];
  for (const [x, z] of P) { const y = ground3(x, z); pts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + th + 8, z)); }
  const ch = [end[0] - P[0][0], end[1] - P[0][1]], cl = Math.hypot(...ch) || 1;
  let px = -ch[1] / cl, pz = ch[0] / cl;
  if ((camera.position.x - mid.x) * px + (camera.position.z - mid.z) * pz < 0) { px = -px; pz = -pz; }
  renderCard();
  frameView(pts, (minx + maxx) / 2, (minz + maxz) / 2, yM + th * 0.5, THREE.MathUtils.clamp(diag * (meta.straight ? 0.3 : 0.45), 40, 420), [px, pz]);
}


// ---------- なぞった道を「まっすぐ」にして、いつもの道の赤い矢印が何本分かで見せる ----------
const redMat = new THREE.MeshBasicMaterial({ color: '#C8372B', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -10 });
const tapeMat = new THREE.MeshBasicMaterial({ color: '#F1C232', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -8 });
const inkMat = new THREE.MeshBasicMaterial({ color: '#2B2E33', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -9 });
// 両端に矢じりのある赤い矢印（地面に沿う）。a→b、太さ w
function dimArrow(a, b, w, mat) {
  const g = new THREE.Group();
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, nx = -uz, nz = ux;
  const h = Math.min(w * 4, L / 3);
  g.add(ribbon([[a[0] + ux * h * 0.9, a[1] + uz * h * 0.9], [b[0] - ux * h * 0.9, b[1] - uz * h * 0.9]], 0, L - h * 1.8, w, 1.4, mat));
  for (const [p, sgn] of [[a, 1], [b, -1]]) {
    const y = ground3(p[0], p[1]) + 1.5;
    const tip = [p[0], y, p[1]];
    const bx = p[0] + ux * h * sgn, bz = p[1] + uz * h * sgn;
    const l = [bx + nx * w * 1.6, y, bz + nz * w * 1.6], r = [bx - nx * w * 1.6, y, bz - nz * w * 1.6];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([...tip, ...l, ...r], 3));
    g.add(new THREE.Mesh(geo, mat));
  }
  return g;
}
// 地面の上に浮かぶ文字の札
function labelSprite(text, size, fg = '#C8372B') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.font = '900 120px "Zen Kaku Gothic New", "Yu Gothic", sans-serif';
  const tw = Math.min(980, g.measureText(text).width + 80);
  g.fillStyle = 'rgba(250,248,243,0.94)'; g.fillRect((1024 - tw) / 2, 40, tw, 176);
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  sp.scale.set(size, size / 4, 1);
  sp.renderOrder = 10;
  return sp;
}
function straightenPath(P, meta) {
  const len = pathLen(P), L = unit.len;
  const ratio = len / L, n = Math.floor(ratio + 1e-9), pieces = Math.min(Math.max(1, Math.ceil(ratio - 1e-9)), 60);
  // まっすぐにする向き：出発から到着の向き。範囲（±1.35 km）からはみ出すなら、少しずつ回す
  const O = P[0], end = P[P.length - 1];
  let ang = Math.atan2(end[1] - O[1], end[0] - O[0]);
  for (const da of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.2, -1.2, 1.6, -1.6, 2.2, -2.2, Math.PI]) {
    const ex = O[0] + Math.cos(ang + da) * len, ez = O[1] + Math.sin(ang + da) * len;
    if (Math.max(Math.abs(ex), Math.abs(ez)) < 1350) { ang += da; break; }
  }
  const dx = Math.cos(ang), dz = Math.sin(ang), nx = -dz, nz = dx;
  const S = (s) => [O[0] + dx * s, O[1] + dz * s];
  const N = Math.max(2, Math.ceil(len / 4));
  const curved = [], straight = [];
  for (let k = 0; k <= N; k++) { const s = len * k / N, p = pathAt(P, s); curved.push([p.x, p.z]); straight.push(S(s)); }
  // 黄色い帯（なぞった道）：曲がった形から、まっすぐへ
  const tape = new THREE.Group(); scene.add(tape);
  const w = THREE.MathUtils.clamp(len / 90, 6, 16);
  let morph = -1;
  const drawTape = (f) => {
    tape.clear();
    const Q = curved.map((c, k) => [c[0] + (straight[k][0] - c[0]) * f, c[1] + (straight[k][1] - c[1]) * f]);
    tape.add(ribbon(Q, 0, pathLen(Q), w, 0.8, tapeMat));
  };
  drawTape(0);
  const parts = [];
  let shown = 0, refDone = false;
  const off = w * 3.2;   // 赤い矢印は帯の横に並べる
  const T0 = 0.6, T1 = 2.2, T2 = 2.6, step = THREE.MathUtils.clamp(3.5 / pieces, 0.25, 0.6);
  kit.live.push({
    kind: 'custom', root: tape, t: 0,
    update(t) {
      // 1) 曲がった道を、ゆっくり引っぱってまっすぐに
      const f = THREE.MathUtils.clamp((t - T0) / (T1 - T0), 0, 1), e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;
      if (Math.abs(e - morph) > 1e-3) { drawTape(e); morph = e; }
      // 2) 基準：いつもの道の赤い矢印（1 本）を帯の向こう側に
      if (t >= T2 && !refDone) {
        refDone = true;
        const a = [O[0] - nx * off * 2.2, O[1] - nz * off * 2.2], b = [a[0] + dx * L, a[1] + dz * L];
        const ref = dimArrow(a, b, w * 0.7, redMat); scene.add(ref);
        const lb = labelSprite(`いつもの道 ${num(Math.round(L))} m`, THREE.MathUtils.clamp(len * 0.2, 110, 320)); const m = S(L / 2);
        lb.position.set(m[0] - nx * off * 2.2, ground3(m[0], m[1]) + lb.scale.y * 0.9, m[1] - nz * off * 2.2); scene.add(lb);
        parts.push(ref, lb); SND.tick(1);
      }
      // 3) なぞった道の横に、同じ長さの赤い矢印を 1 本ずつ
      const want = Math.min(pieces, Math.max(0, Math.floor((t - T2 - 0.6) / step) + 1));
      while (shown < want) {
        const k = shown, s0 = k * L, s1 = Math.min((k + 1) * L, len);
        const a = S(s0), b = S(s1);
        const ar = dimArrow([a[0] + nx * off, a[1] + nz * off], [b[0] + nx * off, b[1] + nz * off], w * 0.7, redMat); scene.add(ar);
        // 区切りの目盛り
        const tick = ribbon([[b[0] - nx * (w * 0.6), b[1] - nz * (w * 0.6)], [b[0] + nx * off * 1.4, b[1] + nz * off * 1.4]], 0, off * 1.4 + w * 0.6, 2.2, 1.0, inkMat); scene.add(tick);
        const last = k === pieces - 1;
        const txt = last && ratio % 1 > 0.005 ? `${fmt(ratio)} 本分` : `${k + 1} 本`;
        const lb = labelSprite(txt, THREE.MathUtils.clamp(len * 0.15, 90, 260)); const m = S((s0 + s1) / 2);
        lb.position.set(m[0] + nx * off * 2.6, ground3(m[0], m[1]) + lb.scale.y * 0.9, m[1] + nz * off * 2.6); scene.add(lb);
        parts.push(ar, tick, lb);
        shown++;
        SND.tick(shown + 1);
        effect.count = Math.min(shown, n);
        if (last && ratio % 1 > 0.005) effect.squeezing = true;
      }
    },
    dispose() { for (const p of parts) if (p && p.isObject3D) scene.remove(p); },
  });
  const sEnd = S(len), mid = S(len / 2), yM = ground3(mid[0], mid[1]);
  effect = {
    kind: 'path', view: 'straight', C: new THREE.Vector3(mid[0], yM, mid[1]), top: yM + 30, x: sEnd[0], z: sEnd[1], count: 0, ratio, n, t: 0, val: len,
    dur: T2 + 0.6 + pieces * step + 1.0, title: meta.title, path: P,
    bx: O[0], bz: O[1], btop: ground3(O[0], O[1]) + 12, bname: '出発', sx: end[0], sz: end[1], sy: ground3(end[0], end[1]) + 12, sname: '到着',
  };
  // 曲がった道とまっすぐの線の両方が入るよう、まっすぐの線の横から見下ろす
  const pts = [];
  for (const [x, z] of [...curved.filter((_, k) => k % 8 === 0), straight[0], straight[N], [O[0] - nx * off * 3, O[1] - nz * off * 3], [sEnd[0] + nx * off * 3, sEnd[1] + nz * off * 3]]) {
    const y = ground3(x, z); pts.push(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + 25, z));
  }
  let px = nx, pz = nz;
  if ((camera.position.x - mid[0]) * px + (camera.position.z - mid[1]) * pz < 0) { px = -px; pz = -pz; }
  let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
  for (const v of pts) { minx = Math.min(minx, v.x); maxx = Math.max(maxx, v.x); minz = Math.min(minz, v.z); maxz = Math.max(maxz, v.z); }
  renderCard();
  frameView(pts, (minx + maxx) / 2, (minz + maxz) / 2, yM + 10, THREE.MathUtils.clamp(len * 0.5, 80, 480), [px, pz]);
}

// ---------- タワー（東京スカイツリー・東京タワー）：範囲の外なので、近くの空き地に模型を立てて比べる ----------
function towerUnit(T) {
  const mk = towerKit(T);
  return { kind: 'tower', tower: T, name: T.short, full: `${T.name}（公式 ${num(T.h)} m）`, ctr: '本', h: T.h, area: null, vol: null, R: mk.R, depth: mk.depth, make: mk.make, shape: () => mk.shape };
}
function forceHeight() {
  if (mode === 'h') return;
  mode = 'h';
  for (const o of document.querySelectorAll('#modes button')) o.classList.toggle('on', o.dataset.m === 'h');
}
// 建物の無い所（半径 r）を、(x, z) の近くから探す
function freeSpot(x, z, r) {
  const ok = (cx, cz) => {
    if (Math.max(Math.abs(cx), Math.abs(cz)) > 1150) return false;
    if (Math.hypot(cx - fit.cx, cz - fit.cz) < Math.max(fit.ax, fit.az) + r) return false;
    if (city.blockedAt(cx, -cz)) return false;
    for (let a = 0; a < 12; a++) for (const k of [0.5, 1]) {
      const px = cx + Math.cos((a * Math.PI) / 6) * r * k, pz = cz + Math.sin((a * Math.PI) / 6) * r * k;
      if (city.blockedAt(px, -pz)) return false;
    }
    return true;
  };
  if (ok(x, z)) return [x, z];
  for (let d = 15; d < 900; d += 15) for (let a = 0; a < 24; a++) {
    const cx = x + Math.cos((a * Math.PI) / 12) * d, cz = z + Math.sin((a * Math.PI) / 12) * d;
    if (ok(cx, cz)) return [cx, cz];
  }
  return [x, z];
}
// 模型を地面からにゅっと立てる
function placeTower(T, x, z) {
  const mk = towerKit(T);
  const obj = mk.make();
  obj.position.set(x, ground3(x, z) - 0.3, z);
  obj.scale.y = 0.001;
  scene.add(obj);
  kit.live.push({ kind: 'grow', root: obj, t: 0, dur: 1.1 });
  return mk;
}
const vRedMat = new THREE.MeshBasicMaterial({ color: '#C8372B', side: THREE.DoubleSide });
// 縦の両矢印（高さ len、太さ w）。足元が原点、+z の面
function vArrow(len, w) {
  const hd = Math.min(w * 3.2, len / 3), hw = w * 1.7;
  const s = new THREE.Shape();
  s.moveTo(-w / 2, hd); s.lineTo(-hw, hd); s.lineTo(0, 0); s.lineTo(hw, hd); s.lineTo(w / 2, hd);
  s.lineTo(w / 2, len - hd); s.lineTo(hw, len - hd); s.lineTo(0, len); s.lineTo(-hw, len - hd); s.lineTo(-w / 2, len - hd);
  s.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(s), vRedMat);
}
// 縦に赤い矢印を積む：1 本 seg の長さで、total の高さまで（最後の 1 本は切る）。face：こちらに向ける水平の向き
function arrowStack({ x, z, seg, total, face, delay = 1.0, unitWord }) {
  const y0 = ground3(x, z);
  const ratio = total / seg, n = Math.floor(ratio + 1e-9);
  const pieces = Math.min(Math.max(1, Math.ceil(ratio - 1e-9)), 60);
  const frac = ratio % 1 > 0.005;
  const step = THREE.MathUtils.clamp(3.2 / pieces, 0.22, 0.6);
  const w = THREE.MathUtils.clamp(total / 70, 4, 14), gap = Math.min(seg * 0.012, 2.5);
  const rx = face[1], rz = -face[0];          // 見ている人の右
  const ang = Math.atan2(face[0], face[1]);
  const size = THREE.MathUtils.clamp(total * 0.25, 60, 420);
  const labelEvery = pieces <= 10 ? 1 : 5;
  const parts = [];
  let shown = 0;
  kit.live.push({
    kind: 'custom', root: new THREE.Group(), t: 0,
    update(t) {
      const want = Math.min(pieces, Math.max(0, Math.floor((t - delay) / step) + 1));
      while (shown < want) {
        const k = shown, last = k === pieces - 1;
        const a = k * seg, b = Math.min((k + 1) * seg, total);
        const ar = vArrow(Math.max(b - a - gap * 2, 1), w);
        ar.position.set(x, y0 + a + gap, z); ar.rotation.y = ang;
        scene.add(ar); parts.push(ar);
        // 区切りの目盛り（墨の短い横線）
        const tk = new THREE.Mesh(new THREE.PlaneGeometry(w * 6, Math.max(1.2, w * 0.25)), inkMat);
        tk.position.set(x, y0 + b, z); tk.rotation.y = ang; scene.add(tk); parts.push(tk);
        if (last || (k + 1) % labelEvery === 0) {
          const lb = labelSprite(last && frac ? `${fmt(ratio)} ${unitWord}分` : `${k + 1} ${unitWord}`, size);
          lb.position.set(x + rx * (w * 3 + size * 0.55), y0 + (a + b) / 2, z + rz * (w * 3 + size * 0.55));
          scene.add(lb); parts.push(lb);
        }
        shown++;
        SND.tick(shown + 1);
        effect.count = Math.min(shown, n);
        if (last && frac) { effect.squeezing = true; SND.slice(); }
      }
    },
    dispose() { for (const p of parts) scene.remove(p); },
  });
  return { ratio, n, pieces, dur: delay + pieces * step + 1.0, w, size };
}
// 見る向き（物から今のカメラへ）
function faceTo(x, z) {
  const dx = camera.position.x - x, dz = camera.position.z - z, L = Math.hypot(dx, dz) || 1;
  return [dx / L, dz / L];
}
// タワーを測る：物差しが道なら道を立てて積む、ドーム・建物なら積む（高さだけ）
function measureTower(T) {
  forceHeight();
  SINK.select([]);
  sinkTarget = 0;
  showHighlight(null);
  // 今見ている所の少し先の空き地
  const fwd = new THREE.Vector3(); camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
  // 634 m の塔を収めるとカメラは 1 km ほど下がるので、範囲の真ん中寄りに立てる
  const want = [camera.position.x + fwd.x * 320, camera.position.z + fwd.z * 320].map((v) => THREE.MathUtils.clamp(v, -420, 420));
  const mk0 = towerKit(T);
  const [tx, tz] = freeSpot(want[0], want[1], mk0.R + 6);
  placeTower(T, tx, tz);
  const y0 = ground3(tx, tz);
  const ring = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * 2 * Math.PI; ring.push([tx + Math.cos(a) * mk0.R, -(tz + Math.sin(a) * mk0.R)]); }
  const rec = { name: T.name, h: T.h, H: T.h, area: Math.PI * mk0.R * mk0.R, vol: null, z0: y0, rings: [ring], usage: null, fl: null, p: null, tower: null, towerT: T };
  if (unit.kind !== 'route') { measureSize(rec, false); if (effect) effect.labUp = Math.max(12, T.h * 0.2); return; }
  // いつもの道を立てて、タワーの高さまで積む
  const face = faceTo(tx, tz), rx = face[1], rz = -face[0];
  const ax = tx + rx * (mk0.R + 40), az = tz + rz * (mk0.R + 40);
  const st = arrowStack({ x: ax, z: az, seg: unit.len, total: T.h, face, unitWord: '本' });
  effect = {
    kind: 'size', view: 'stack', C: new THREE.Vector3((ax + tx) / 2, y0 + T.h / 2, (az + tz) / 2), top: y0 + T.h, x: ax, z: az, count: 0, ratio: st.ratio, n: st.n, t: 0, val: T.h, rec, isDome: false,
    bx: tx, bz: tz, btop: y0 + T.h, bname: `${T.name}  ${num(T.h)} m`, dur: st.dur, labUp: Math.max(12, T.h * 0.2),
  };
  renderCard();
  const lx = ax + rx * (st.w * 3 + st.size * 1.1), lz = az + rz * (st.w * 3 + st.size * 1.1);
  frameView(boxPoints([[tx, tz, mk0.R, y0, y0 + T.h], [ax, az, st.w * 2, y0, y0 + T.h * 1.3], [lx, lz, 4, y0, y0 + T.h]]), (lx + tx) / 2, (lz + tz) / 2, y0 + T.h * 0.5, THREE.MathUtils.clamp(T.h * 0.35, 0, 450));   // 上の 30%：数字（labUp）まで入れる
}
// 物差しがタワーの時の道：道を立てて、タワーの高さの赤い矢印が何本分かを積む
function standPath(P, meta) {
  const T = unit.tower, len = pathLen(P);
  const line = ribbon(P, 0, len, 2.2, 0.35, lineMat);
  scene.add(line); kit.live.push({ kind: 'static', root: line, t: 0 });
  // 道の出発の近くの空き地にタワー、その横に立てた道
  const mk0 = towerKit(T);
  const [tx, tz] = freeSpot(THREE.MathUtils.clamp(P[0][0], -420, 420), THREE.MathUtils.clamp(P[0][1], -420, 420), mk0.R + 6);
  placeTower(T, tx, tz);
  const y0 = ground3(tx, tz);
  const face = faceTo(tx, tz), rx = face[1], rz = -face[0];
  const ax = tx + rx * (mk0.R + 40), az = tz + rz * (mk0.R + 40);
  const st = arrowStack({ x: ax, z: az, seg: T.h, total: len, face, unitWord: '本' });
  const top = Math.max(len, T.h);
  effect = {
    kind: 'path', view: 'stack', C: new THREE.Vector3((ax + tx) / 2, y0 + top / 2, (az + tz) / 2), top: y0 + Math.max(len, 30), x: ax, z: az, count: 0, ratio: st.ratio, n: st.n, t: 0, val: len,
    dur: st.dur, title: meta.title, from: meta.from, to: meta.to, straight: !!meta.straight, list: meta.list, rec: meta.rec, isDome: meta.isDome, path: P,
    bx: tx, bz: tz, btop: y0 + T.h, bname: `${T.name}  ${num(T.h)} m`, labUp: Math.max(12, top * 0.2),
  };
  renderCard();
  const lx = ax + rx * (st.w * 3 + st.size * 1.1), lz = az + rz * (st.w * 3 + st.size * 1.1);
  frameView(boxPoints([[tx, tz, mk0.R, y0, y0 + T.h], [ax, az, st.w * 2, y0, y0 + top * 1.3], [lx, lz, 4, y0, y0 + top]]), (lx + tx) / 2, (lz + tz) / 2, y0 + top * 0.5, THREE.MathUtils.clamp(top * 0.35, 0, 600));
}

// 駅まで：建物の端から駅まで直線
const stations = data.stations.map((s) => ({ ...s, X: s.x, Z: -s.y }));
function nearestStations(x, z) {
  return stations.map((s) => ({ s, d: Math.hypot(s.X - x, s.Z - z) })).sort((a, b) => a.d - b.d);
}
function measureDistance(rec, isDome) {
  const [ax, az] = isDome ? [fit.cx, fit.cz] : centroid(rec);
  const list = nearestStations(ax, az);
  const dest = list.find((o) => o.s.name === destName) ?? list[0];
  destName = dest.s.name;
  const rB = isDome ? Math.max(fit.ax, fit.az) * 0.95 : Math.sqrt(rec.area / Math.PI);
  const dx = dest.s.X - ax, dz = dest.s.Z - az, D = Math.hypot(dx, dz);
  const sx = ax + dx / D * rB, sz = az + dz / D * rB;     // 建物の端から
  const nm = isDome ? '東京ドーム' : nameOf(rec);
  layPath([[sx, sz], [dest.s.X, dest.s.Z]], {
    title: `${nm} → ${dest.s.name}`, from: nm, to: dest.s.name, straight: true, station: true, list, rec, isDome,
    keep: isDome ? [] : [data.buildings.indexOf(rec)], bx: ax, bz: az, btop: isDome ? domeRec.z0 + domeRec.h : rec.z0 + (rec.h ?? rec.H), bname: isDome ? null : nm,
  });
}

// ---------- 町・丁目ごと：建物を全部足す ----------
const towns = new Map();
data.buildings.forEach((b, i) => {
  if (!b.town) return;
  const t = towns.get(b.town) ?? { name: b.town, ids: [], vol: 0, area: 0, minx: 1e9, maxx: -1e9, miny: 1e9, maxy: -1e9 };
  t.ids.push(i); t.vol += b.vol; t.area += b.area;
  for (const [x, y] of b.rings[0]) { t.minx = Math.min(t.minx, x); t.maxx = Math.max(t.maxx, x); t.miny = Math.min(t.miny, y); t.maxy = Math.max(t.maxy, y); }
  towns.set(b.town, t);
});
// 読み込んだ範囲の端で切れている町は外す（全部の建物が揃っていないため）
for (const [k, t] of towns) if (t.ids.length < 8 || t.minx < -1330 || t.maxx > 1330 || t.miny < -1330 || t.maxy > 1330) towns.delete(k);
function measureTown(name) {
  const t = towns.get(name);
  if (!t) return;
  if (mode === 'h' || mode === 'dist') { mode = 'vol'; for (const o of document.querySelectorAll('#modes button')) o.classList.toggle('on', o.dataset.m === 'vol'); }
  if (unit.kind === 'route' || unit.kind === 'tower') { unit = DOME; renderUnitChip(); }
  SINK.select(t.ids);
  sinkTarget = 0;
  showHighlight(null);
  const val = mode === 'area' ? t.area : t.vol;
  const ratio = val / unit[mode];
  const cx = (t.minx + t.maxx) / 2, cz = -(t.miny + t.maxy) / 2, rT = Math.max(t.maxx - t.minx, t.maxy - t.miny) / 2;
  const { right, back } = sideOf(cx, ground3(cx, cz) + 10, cz);
  const off = rT + unit.R + 20;
  const ox = cx + right.x * off, oz = cz + right.z * off, yL = ground3(ox, oz);
  const plan = dropPlan(mode, ratio, ox, oz, right, back);
  const dur = runDrops(plan, mode);
  const C = new THREE.Vector3(ox + (plan.width / 2 - unit.R) * right.x, yL + Math.min(plan.height, 400) / 2, oz + (plan.width / 2 - unit.R) * right.z);
  let topH = 0;
  for (const i of t.ids) topH = Math.max(topH, data.buildings[i].z0 + (data.buildings[i].h ?? data.buildings[i].H));
  effect = {
    kind: 'town', town: t, C, top: yL + plan.height, x: C.x, z: C.z, count: 0, ratio, n: plan.n, t: 0, val, dur, shown: plan.shown,
    bx: cx, bz: cz, btop: topH, bname: short(t.name),
  };
  const boxes = [[cx, cz, rT, yL, topH]];
  for (const d of plan.drops) boxes.push([d.x, d.z, unit.R, d.y, d.y + unit.h]);
  renderCard();
  frameView(boxPoints(boxes), (cx + C.x) / 2, (cz + C.z) / 2, yL + Math.min(Math.max(plan.height, topH - yL), 400) * 0.42, 60);
}

// ---------- カード・一言・物差しの切り替え ----------
function sentence() {
  if (!effect) return '';
  const e = effect, r = fmt(e.ratio);
  if (e.kind === 'town') return `${e.town.name}の建物の${MODE_NAME[mode]}を全部足すと、${unit.full} ${r}${ctrOf()}。`;
  if (e.kind === 'path') {
    const what = e.straight ? `${e.from}から${e.to}まで（直線 ${num(Math.round(e.val))} m）` : `${e.title}（${num(Math.round(e.val))} m）`;
    if (unit.kind === 'route' && e.view === 'straight') return `${what}は、まっすぐにすると ${unit.full}の ${r}本分。`;
    if (unit.kind === 'tower') return `${what}は、立てると ${unit.full}の ${r}本分。`;
    return unit.kind === 'route' ? `${what}は、${unit.full}の ${r}倍。` : `${what}は、${unit.name}を倒して並べると ${r}${ctrOf()}。`;
  }
  const nm = e.isDome ? '東京ドーム' : nameOf(e.rec);
  if (unit.kind === 'route' && e.view === 'stack') return `${nm}（${num(e.val)} m）の高さは、${unit.full}を立てて積むと ${r}本分。`;
  if (unit.kind === 'route') return `${nm}の高さは、${unit.full}の ${r}倍。`;
  return `${nm}の${MODE_NAME[mode]}は、${unit.full} ${r}${ctrOf()}。`;
}
function unitNote() {
  if (unit.kind === 'dome') return `物差しは PLATEAU の東京ドーム（計測高さ ${num(domeRec.h)} m、足元 ${num(domeRec.area)} m²、LOD1 の箱 ${man(domeRec.vol)} m³）。いつもの東京ドーム（公式：高さ 56.19 m、建築面積 46,755 m²、容積 約124万 m³）とは少し違います。`;
  if (unit.kind === 'tower') return `物差しは ${unit.tower.name}（高さ ${num(unit.h)} m、公式の値）。PLATEAU の読み込んだ範囲の外なので、形は見た目のための簡単な模型です。高さと長さだけと比べます。`;
  if (unit.kind === 'route') return `物差しは、なぞった「いつもの道」（${num(Math.round(unit.len))} m、点 ${unit.pts.length} 個を結んだ線の長さ）。`;
  return `物差しは ${unit.full}（計測高さ ${num(unit.h)} m、足元 ${num(unit.area)} m²、体積 ${man(unit.vol)} m³）。`;
}
function renderCard() {
  const e = effect;
  const unitVal = unit.kind === 'route' ? `${num(Math.round(unit.len))} m` : unit.kind === 'tower' ? `高さ ${num(unit.h)} m` : { h: `${num(unit.h)} m`, area: `${num(unit.area)} m²`, vol: `${man(unit.vol)} m³`, dist: `高さ ${num(unit.h)} m` }[mode];
  let title, meta, what, rows, extra = '', btn1 = '', destSel = '';
  if (e.kind === 'town') {
    title = e.town.name;
    meta = `建物 ${e.town.ids.length} 棟（PLATEAU の住所で集計）`;
    what = `建物の${MODE_NAME[mode]}を全部足すと`;
    rows = [[`${MODE_NAME[mode]}の合計`, mode === 'area' ? `${num(Math.round(e.val))} m²` : `${man(e.val)} m³`]];
    extra = `<div class="note">町の土地の広さではなく、町にある建物を全部足した値です。${e.town.name === domeRec.town ? '東京ドーム自身も含みます。' : ''}読み込んだ範囲で建物が全部そろう町だけを選べます。</div>`;
  } else if (e.kind === 'path') {
    title = e.title;
    meta = e.straight ? '直線（駅はホームの中心、国土数値情報）' : `なぞった道（点 ${e.path.length} 個）`;
    what = unit.kind === 'route' ? (e.view === 'straight' ? `まっすぐにすると、${unit.full}の` : `${unit.full}と比べると`) : unit.kind === 'tower' ? `道を立てると、${unit.name}の高さの` : `${unit.name}を倒して並べると`;
    if (unit.kind === 'tower') extra += `<div class="note">${unit.tower.name}は PLATEAU の読み込んだ範囲の外なので、高さは公式の値を使い、近くの空き地に見た目のための模型を立てています。</div>`;
    rows = [['長さ', `${e.straight ? '直線 ' : ''}${num(Math.round(e.val))} m`]];
    if (e.list) destSel = `<div class="rowsel"><span>行き先</span><select id="dest">${e.list.slice(0, 8).map((o) => `<option ${o.s.name === e.to ? 'selected' : ''}>${o.s.name}</option>`).join('')}</select></div>`;
    if (!e.straight && !(unit.kind === 'route' && unit.pts === e.path)) btn1 = '<button id="bRoute">この道を物差しにする</button>';
    if (!e.straight && unit.kind === 'route') btn1 += `<button id="bView">${e.view === 'straight' ? '道に沿って見る' : 'まっすぐにして見る'}</button>`;
    if (e.straight) extra = '<div class="note">建物の端から駅までの直線です。道なりで測るなら「なぞる」で道をなぞってください。</div>';
  } else {
    const rec = e.rec, isDome = e.isDome, TT = rec.towerT;
    title = isDome ? '東京ドーム（PLATEAU）' : nameOf(rec);
    meta = TT ? '高さは公式の値（PLATEAU の範囲の外）' : `${USAGE[rec.usage] ?? ''}${rec.fl ? ` ・ 地上${rec.fl}階` : ''}${rec.p ? ' ・ LOD2' : ' ・ LOD1'}`;
    what = unit.kind === 'route' ? (e.view === 'stack' ? `${unit.full}を立てて積むと` : `${unit.full}を立てると`) : `${unit.name}の${MODE_NAME[mode]}で測ると`;
    rows = [[TT ? 'このタワーの高さ' : `この建物の${MODE_NAME[mode]}`, { h: `${num(e.val)} m`, area: `${num(e.val)} m²`, vol: `${man(e.val)} m³` }[mode]]];
    if (unit.kind !== 'route' && e.ratio > 0 && e.ratio < 1) extra += `<div class="what">逆に言うと、${unit.name}はこの建物の <b>${fmt(1 / e.ratio)}</b> 個分</div>`;
    if (rec.tower && !isDome) extra += '<div class="note warn">この建物は PLATEAU に塔の形（LOD2）が無く、LOD1 の箱は低層部の高さです。塔は見た目のための仮の形で、体積は LOD1 の箱で数えています。</div>';
    if (mode === 'vol') extra += `<div class="note">${rec.p ? '体積は LOD2 の屋根の下を足し上げた値。' : '体積は LOD1 の箱（足元の面積×箱の高さ）。'}</div>`;
    if (unit.kind === 'route') extra += '<div class="note">いつもの道は長さの物差しなので、高さだけと比べます。</div>';
    if (TT) {
      extra += `<div class="note">${TT.name}は PLATEAU の読み込んだ範囲（文京区・千代田区）の外にあるので、高さは公式の値（${num(TT.h)} m）を使い、形は見た目のための簡単な模型を近くの空き地に立てています。足元の広さ・体積は比べません。</div>`;
      if (!(unit.kind === 'tower' && unit.tower === TT)) btn1 = '<button id="bTower">このタワーを物差しにする</button>';
    } else if (!isDome && unit.rec !== rec) btn1 = '<button id="bUnit">この建物を物差しにする</button>';
    if (!isDome && rec.town && towns.has(rec.town)) btn1 += `<button id="bTown">${short(rec.town)}を全部足す</button>`;
  }
  rows.push([unit.full, unitVal]);
  const shown = e.shown ? `<div class="note">多いので、並べて見せるのは ${e.shown} までです。</div>` : '';
  const hasFrac = unit.kind !== 'route' && e.view !== 'stack' && (e.kind === 'size' || e.kind === 'path' || e.kind === 'town') && e.ratio % 1 > 0.005;
  const frac = hasFrac ? `<div class="frac">1 ${ctrOf().replace('分', '')}に満たない分は <button data-f="cut" class="${fracMode === 'cut' ? 'on' : ''}">切る</button><button data-f="shrink" class="${fracMode === 'shrink' ? 'on' : ''}">縮める</button></div>` : '';
  $('card').innerHTML = `
    <div class="name">${title}</div>
    <div class="meta">${meta}</div>
    <div class="big"><span id="bignum">0</span><small>${ctrOf()}</small></div>
    <div class="what">${what}</div>
    ${frac}
    ${destSel}
    <div class="say" id="say"></div>
    <div class="btns">
      ${btn1}
      <button id="bCopy">文をコピー</button>
      <button id="bSave">画像を保存</button>
      <button id="bMore" class="more-toggle">詳しく</button>
    </div>
    <div class="more">
      <div class="rows">${rows.map(([a, b]) => `<div><span>${a}</span><span>${b}</span></div>`).join('')}</div>
      ${extra}${shown}
      <div class="note">${unitNote()}</div>
      <div class="note code">周りの建物は数秒で戻ります。Esc で比べるのをやめる</div>
    </div>`;
  $('card').style.display = 'block';
  $('hint').style.display = 'none';
  $('card').classList.remove('open');
  $('bMore').onclick = () => { const o = $('card').classList.toggle('open'); $('bMore').textContent = o ? '閉じる' : '詳しく'; };
  if ($('dest')) $('dest').onchange = (ev) => { destName = ev.target.value; compare(selected); };
  if ($('bUnit')) $('bUnit').onclick = () => setUnit(unitFromRec(e.rec));
  if ($('bTower')) $('bTower').onclick = () => setUnit(towerUnit(e.rec.towerT));
  if ($('bTown')) $('bTown').onclick = () => compare({ town: e.rec.town });
  if ($('bRoute')) $('bRoute').onclick = () => setUnit(routeUnit(e.path));
  if ($('bView')) $('bView').onclick = () => layPath(e.path, { title: e.title, view: e.view === 'straight' ? 'along' : 'straight' });
  $('bCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(sentence()); $('bCopy').textContent = 'コピーしました'; }
    catch {   // コピーできない所では、文を選んだ状態にして手でコピーしてもらう
      const r = document.createRange(); r.selectNodeContents($('say'));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      $('bCopy').textContent = '文を選びました（手でコピー）';
    }
  };
  $('bSave').onclick = () => saveImage();
  for (const b of $('card').querySelectorAll('.frac button')) b.onclick = () => setFracMode(b.dataset.f);
}
function setFracMode(f) {
  if (f === fracMode) return;
  fracMode = f;
  try { localStorage.setItem('nankobun.frac', f); } catch {}
  if (selected) compare(selected);
  else if (lastPath && effect && effect.kind === 'path' && !effect.straight) layPath(lastPath, { title: effect.title });
}
function renderUnitChip() {
  $('unit').innerHTML = unit.kind === 'dome'
    ? `物差し：<b>${unit.full}</b>`
    : `物差し：<b>${unit.full}</b> <button id="bDome">東京ドームに戻す</button>`;
  if ($('bDome')) $('bDome').onclick = () => setUnit(DOME);
}
let unitLine = null;   // 物差しにした「いつもの道」を地図に薄く残す
function setUnit(u) {
  unit = u;
  if (unitLine) { scene.remove(unitLine); unitLine = null; }
  if (u.kind === 'route') {
    unitLine = ribbon(u.pts, 0, u.len, 3, 0.3, new THREE.MeshBasicMaterial({ color: '#C8372B', transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5 }));
    scene.add(unitLine);
  }
  renderUnitChip();
  if (selected) compare(selected);
  else if (lastPath && effect && effect.kind === 'path' && !effect.straight) layPath(lastPath, { title: 'なぞった道' });
}
function routeUnit(P) {
  const len = pathLen(P);
  return { kind: 'route', name: 'いつもの道', full: `いつもの道（${num(Math.round(len))} m）`, ctr: '倍', len, pts: P, h: len, R: 4, depth: 6 };
}
renderUnitChip();

// ---------- 道をなぞる ----------
const trace = { on: false, pts: [], mesh: null, save: null };
let lastPath = null;
const groundMesh = city.group.children[0];
function startTrace() {
  restore();
  trace.on = true; trace.pts = [];
  trace.save = { ...view };
  // 今見ている少し先を、真上から見る
  const tx = view.x - Math.sin(view.yaw) * 120, tz = view.z - Math.cos(view.yaw) * 120;
  view.mode = 'sky';
  $('tEye').classList.remove('on'); $('tSky').classList.add('on');
  orbit.enabled = true; orbit.enableRotate = false;
  orbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  orbit.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
  orbit.target.set(tx, ground3(tx, tz), tz);
  camera.position.set(tx, ground3(tx, tz) + 700, tz + 0.01);
  camera.up.set(0, 1, 0);
  orbit.update();
  $('trace').hidden = false; $('modes').style.visibility = 'hidden';
  drawTrace();
}
function endTrace(backToEye = true) {
  trace.on = false;
  $('trace').hidden = true; $('modes').style.visibility = '';
  if (trace.mesh) { scene.remove(trace.mesh); trace.mesh = null; }
  orbit.enableRotate = true;
  orbit.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  orbit.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  if (backToEye) {
    Object.assign(view, trace.save ?? {});
    view.mode = 'sky'; setMode('eye');
    if (trace.save) Object.assign(view, { x: trace.save.x, z: trace.save.z, yaw: trace.save.yaw, pitch: trace.save.pitch, eye: 1.6 });
  }
}
function addTracePoint(e) {
  const p = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(p, camera);
  const hit = ray.intersectObject(groundMesh, false)[0];
  if (!hit) return;
  trace.pts.push([hit.point.x, hit.point.z]);
  SND.tick(trace.pts.length);
  drawTrace();
}
function drawTrace() {
  if (trace.mesh) { scene.remove(trace.mesh); trace.mesh = null; }
  const P = trace.pts, g = new THREE.Group();
  const h = Math.max(camera.position.y - orbit.target.y, 60);
  const w = Math.max(2.5, h / 110);
  if (P.length >= 2) g.add(ribbon(P, 0, pathLen(P), w, 1.0, lineMat));
  const dotG = new THREE.CircleGeometry(w * 1.2, 20); dotG.rotateX(-Math.PI / 2);
  P.forEach(([x, z], i) => {
    const d = new THREE.Mesh(dotG, new THREE.MeshBasicMaterial({ color: i === 0 ? '#2f8f5b' : '#c8553d', depthWrite: false, polygonOffset: true, polygonOffsetFactor: -10 }));
    d.position.set(x, ground3(x, z) + 1.2, z); g.add(d);
  });
  trace.mesh = g; scene.add(g);
  const L = pathLen(P);
  $('tlen').textContent = `${num(Math.round(L))} m`;
  $('tpts').textContent = P.length ? `点 ${P.length} 個` : '';
  $('tUnit').disabled = $('tGo').disabled = P.length < 2;
  $('tUndo').disabled = $('tClear').disabled = !P.length;
  $('tunit').textContent = unit.kind === 'route' && P.length >= 2 ? `いつもの道の ${fmt(L / unit.len)} 倍` : '';
}
$('tUndo').onclick = () => { trace.pts.pop(); drawTrace(); };
$('tClear').onclick = () => { trace.pts = []; drawTrace(); };
$('tExit').onclick = () => endTrace(true);
$('tUnit').onclick = () => {
  const P = trace.pts.slice();
  endTrace(true);
  setUnit(routeUnit(P));
};
$('tGo').onclick = () => {
  const P = trace.pts.slice();
  endTrace(true);
  lastPath = P; selected = null;
  showHighlight(null);
  layPath(P, { title: 'なぞった道' });
};

// ---------- 名前で探す ----------
{
  const names = new Map();
  data.buildings.forEach((b) => { if (b.name && b !== domeRec && !names.has(b.name)) names.set(b.name, { rec: b }); });
  names.set('東京ドーム', { dome: true });
  names.set('東京スカイツリー', { tower: TOWERS.skytree }); names.set('スカイツリー', { tower: TOWERS.skytree });
  names.set('東京タワー', { tower: TOWERS.tokyotower });
  for (const s of stations) names.set(s.name, { station: s });
  for (const t of towns.keys()) names.set(t, { town: t });
  $('qlist').innerHTML = [...names.keys()].sort((a, b) => a.localeCompare(b, 'ja')).map((n) => `<option value="${n}"></option>`).join('');
  const go = () => {
    const v = $('q').value.trim();
    const hit = names.get(v) ?? [...names.entries()].find(([k]) => k.includes(v))?.[1];
    if (!v || !hit) return;
    $('q').blur();
    if (hit.station) {
      destName = hit.station.name;
      if (mode !== 'dist') setCompareMode('dist');
      if (selected && !selected.town) compare(selected);
      else { $('q').value = ''; $('q').placeholder = `行き先：${destName}（建物を選ぶと距離を測る）`; }
      return;
    }
    compare(hit.town ? { town: hit.town } : hit.tower ? { tower: hit.tower } : hit.dome ? { dome: true } : { rec: hit.rec });
    $('q').value = '';
  };
  $('q').addEventListener('change', go);
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}

// ---------- 視点の移動 ----------
let tween = null;
function startTween(x, z, lift, tx, ty, tz) {
  const from = { x: view.x, z: view.z, yaw: view.yaw, pitch: view.pitch, eye: view.eye };
  const saveEye = view.eye;
  view.eye = 1.6 + lift;
  lookAtFrom(x, z, tx, ty, tz);
  const to = { x: view.x, z: view.z, yaw: view.yaw, pitch: view.pitch, eye: view.eye };
  Object.assign(view, from); view.eye = saveEye;
  let dy = to.yaw - from.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  to.yaw = from.yaw + dy;
  tween = { from, to, t: 0, T: 2.2 };
}

// ---------- 毎フレーム ----------
const clock = new THREE.Clock();
const tmp = new THREE.Vector3();
let curFocus = 350;
const RS = new THREE.Vector2();   // 描画の大きさ（動画の書き出し中は画面と違う）
const toScreen = (x, y, z) => { renderer.getSize(RS); const q = new THREE.Vector3(x, y, z).project(camera); return { x: (q.x * 0.5 + 0.5) * RS.x, y: (-q.y * 0.5 + 0.5) * RS.y, ok: q.z < 1 && Math.abs(q.x) < 1.1 && Math.abs(q.y) < 1.1 }; };
// 描画の大きさを変える（動画は 16:9 で書き出すため）。引数なしで画面の大きさに戻す
function setRenderSize(w, h) {
  const screen = !w;
  if (screen) { w = innerWidth; h = innerHeight; }
  renderer.setSize(w, h, screen);
  composer.setSize(w, h); gtao.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  grade.uniforms.uRes.value.set(w, h);
}
function step(dt) {
  grade.uniforms.uTime.value = (grade.uniforms.uTime.value + 1.37) % 1000;

  if (view.mode === 'eye') {
    if (tween) {
      tween.t += dt;
      const f = Math.min(tween.t / tween.T, 1), e = f < 0.5 ? 4 * f * f * f : 1 - Math.pow(-2 * f + 2, 3) / 2;
      for (const k of ['x', 'z', 'yaw', 'pitch', 'eye']) view[k] = tween.from[k] + (tween.to[k] - tween.from[k]) * e;
      if (f >= 1) tween = null;
    } else if (!typing()) {
      const sp = (keys.has('shift') ? 30 : 9) * dt;
      const fx = -Math.sin(view.yaw), fz = -Math.cos(view.yaw);
      if (keys.has('w') || keys.has('arrowup')) { view.x += fx * sp; view.z += fz * sp; }
      if (keys.has('s') || keys.has('arrowdown')) { view.x -= fx * sp; view.z -= fz * sp; }
      if (keys.has('a') || keys.has('arrowleft')) { view.x += fz * sp; view.z -= fx * sp; }
      if (keys.has('d') || keys.has('arrowright')) { view.x -= fz * sp; view.z += fx * sp; }
    }
    const y = ground3(view.x, view.z) + view.eye;
    camera.position.set(view.x, y, view.z);
    camera.rotation.set(view.pitch, view.yaw, 0, 'YXZ');
  } else {
    orbit.update();
  }
  if (kit.shake > 0) {
    camera.position.x += (Math.random() - 0.5) * kit.shake * 0.35;
    camera.position.y += (Math.random() - 0.5) * kit.shake * 0.35;
  }

  kit.update(dt);
  {
    const u = SINK.uSink.value, k = sinkTarget < u ? 2.2 : 1.4;
    SINK.uSink.value = sinkTarget < u ? Math.max(sinkTarget, u - dt * k) : Math.min(sinkTarget, u + dt * k);
    gtao.enabled = bokeh.enabled = !LITE && SINK.uSink.value > 0.995;
  }

  // ピントは見ている対象へ。歩いている時は少し先（通りの中ほど）に合わせ、遠くの街はやわらかくぼかす
  const want = effect ? camera.position.distanceTo(effect.C) : (view.mode === 'eye' ? 40 : camera.position.distanceTo(focus));
  curFocus += (want - curFocus) * Math.min(1, dt * 3);
  // 遠くから見下ろす時に街が霞で白く飛ばないよう、見ている物までの距離で霞を薄める
  scene.fog.density = 0.00052 * THREE.MathUtils.clamp(450 / Math.max(want, 1), 0.12, 1);
  bokeh.uniforms.focus.value = curFocus;

  // 影の範囲を視点の前に合わせる
  camera.getWorldDirection(tmp);
  const fp = camera.position.clone().addScaledVector(tmp.setY(0).normalize(), 280);
  sun.target.position.copy(fp);
  sun.position.copy(fp).addScaledVector(sunDir, 1600);
  sky.position.copy(camera.position);

  // 数字の表示
  const lab = $('label'), bl = $('blabel'), sl = $('slabel');
  if (effect) {
    effect.t += dt;
    if (sinkTarget < 1 && effect.t > effect.dur + AUTO_RETURN) sinkTarget = 1;   // 結果を見せたら、数秒で周りの建物を戻す（物差しと数字は残す）
    const doneAll = effect.t > effect.dur;
    const txt = doneAll || effect.squeezing ? fmt(effect.ratio) : String(effect.count);
    effect.txt = txt;
    const big = $('bignum');
    if (big) big.textContent = txt;
    if ($('say')) $('say').textContent = doneAll ? sentence() : '';
    const p = toScreen(effect.x, Math.min(effect.top, effect.C.y * 2) + (effect.labUp ?? 12), effect.z);   // labUp：塔の名札と重ならないよう、数字を上げる高さ [m]
    if (p.ok && effect.t > 1.0) { lab.style.display = 'block'; lab.style.left = `${p.x}px`; lab.style.top = `${p.y}px`; lab.textContent = `${txt} ${ctrOf()}`; } else lab.style.display = 'none';
    const q = toScreen(effect.bx, effect.btop + 4, effect.bz);
    if (effect.bname && q.ok) { bl.style.display = 'block'; bl.style.left = `${q.x}px`; bl.style.top = `${q.y - 26}px`; bl.textContent = effect.bname; } else bl.style.display = 'none';
    if (effect.kind === 'dist') {
      const r = toScreen(effect.sx, effect.sy, effect.sz);
      if (r.ok) { sl.style.display = 'block'; sl.style.left = `${r.x}px`; sl.style.top = `${r.y - 26}px`; sl.textContent = effect.sname; } else sl.style.display = 'none';
    } else sl.style.display = 'none';
  }
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (recording) { requestAnimationFrame(frame); return; }   // 書き出し中は、書き出す側だけが時間を進める
  step(dt);
  composer.render(dt);
  requestAnimationFrame(frame);
}
// 確かめ用・動画の書き出し用：時間を sec 秒進めて 1 枚描く（画面が隠れていて描画が止まる時にも使える）
function advance(sec, fps = 30) {
  for (let t = 0; t < sec; t += 1 / fps) step(1 / fps);
  composer.render(1 / fps);
}

// ---------- 画像・動画の書き出し ----------
// 3D の絵に、数字・名札・字幕を描き足した 1 枚を作る（画面の文字は絵に含まれないため）
function compose(w, caption = '', withSentence = false) {
  const src = renderer.domElement, c = document.createElement('canvas');
  c.width = w; c.height = Math.round(w * src.height / src.width);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  renderer.getSize(RS);
  const k = c.width / RS.x;
  const tag = (el, size, bg, fg) => {
    if (el.style.display !== 'block') return;
    const x = parseFloat(el.style.left) * k, y = parseFloat(el.style.top) * k;
    g.font = `700 ${size}px "M PLUS 1 Code", "Zen Kaku Gothic New", sans-serif`;
    const tw = g.measureText(el.textContent).width;
    if (bg) {
      g.fillStyle = bg; g.fillRect(x - tw / 2 - 8, y - size - 4, tw + 16, size + 12);
      g.fillStyle = bg; g.fillRect(x - 0.5, y + 8, 1.5, 26 * k);
    }
    g.fillStyle = fg; g.textAlign = 'center';
    if (!bg) { g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 12 * k; }
    g.fillText(el.textContent, x, y + (bg ? 2 : -size * 0.1));
    g.shadowBlur = 0;
  };
  tag($('label'), Math.round(34 * k), null, '#ffffff');
  tag($('blabel'), Math.round(14 * k), 'rgba(255,236,200,0.92)', '#1d1f22');
  tag($('slabel'), Math.round(14 * k), 'rgba(255,226,150,0.95)', '#1d1f22');
  const text = withSentence && effect ? sentence() : caption;
  if (text) {
    const size = Math.round(c.width / 42);
    g.font = `700 ${size}px "Zen Kaku Gothic New", sans-serif`;
    g.textAlign = 'center';
    const tw = g.measureText(text).width;
    g.fillStyle = 'rgba(250,248,243,0.88)';
    g.fillRect((c.width - tw) / 2 - size, c.height - size * 3.2, tw + size * 2, size * 2);
    g.fillStyle = '#1d1f22';
    g.fillText(text, c.width / 2, c.height - size * 1.75);
  }
  return c;
}
function saveImage() {
  composer.render(1 / 30);
  const c = compose(1600, '', true);
  $('shotimg').src = c.toDataURL('image/png');
  $('shot').hidden = false;
}
// 確かめ用：今の絵を開発サーバーへ送って保存する
async function capture(name, w = 960, caption = '') {
  composer.render(1 / 30);
  const c = compose(w, caption);
  const r = await fetch(`/__capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: c.toDataURL('image/jpeg', 0.85) });
  return r.text();
}
// 動画用：sec 秒ぶんを 1 コマずつ描いて開発サーバーへ送る（captures/rec_<name>/）。opts.yawRate [rad/s] でゆっくり見回す
const recIndex = {};
async function record(name, sec, opts = {}) {
  const fps = opts.fps ?? 30, w = opts.width ?? 1920;
  let i = recIndex[name] ?? 0;
  for (let t = 0; t < sec; t += 1 / fps) {
    if (opts.yawRate) view.yaw += opts.yawRate / fps;
    if (opts.walk) { view.x += -Math.sin(view.yaw) * opts.walk / fps; view.z += -Math.cos(view.yaw) * opts.walk / fps; }
    step(1 / fps);
    composer.render(1 / fps);
    const c = compose(w, typeof opts.caption === 'function' ? opts.caption(t) : (opts.caption ?? ''));
    const body = c.toDataURL('image/jpeg', 0.92), url = `/__frame?name=${encodeURIComponent(name)}&i=${i++}`;
    for (let k = 0; ; k++) {   // 送り損ねたら少し待って送り直す
      try { const r = await fetch(url, { method: 'POST', body }); if (r.ok) break; } catch (err) { if (k >= 4) throw err; }
      await new Promise((res) => setTimeout(res, 200));
    }
  }
  recIndex[name] = i;
  return i;
}

$('shotclose').onclick = () => { $('shot').hidden = true; };
$('loading').style.display = 'none';
frame();
window.__dome = {
  data, compare, view, camera, setMode, scene, advance, capture, record, lookAtFrom, city, setRenderSize, startTween, composer,
  setRecording: (v) => { recording = v; document.body.classList.toggle('clean', v); }, get tween() { return tween; },
  setUnit, unitFromRec, DOME, TOWERS, towerUnit, setFracMode, setCompareMode, trace, startTrace, endTrace, layPath, routeUnit, towns, setDest: (n) => { destName = n; }, get unit() { return unit; }, get effect() { return effect; }, restore,
  pickAt: (x, y) => pick({ clientX: x, clientY: y }),
};
