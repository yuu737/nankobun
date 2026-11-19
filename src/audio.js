// 効果音はその場で合成する（音のファイルは使わない）。最初は鳴らさない。
let ctx = null, master = null;
export let soundOn = false;

export function setSound(on) {
  soundOn = on;
  if (on && !ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
  }
  if (ctx) (on ? ctx.resume() : ctx.suspend());
}

function noiseBuf(sec) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

// どすん
export function thump(power = 1) {
  if (!soundOn) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.5);
  g.gain.setValueAtTime(0.9 * power, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.75);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(0.5);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500;
  const gn = ctx.createGain(); gn.gain.setValueAtTime(0.5 * power, t); gn.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  n.connect(f).connect(gn).connect(master); n.start(t);
}

// ひゅー（落ちてくる）
export function whoosh(sec = 1.0) {
  if (!soundOn) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(sec);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
  f.frequency.setValueAtTime(1800, t); f.frequency.exponentialRampToValueAtTime(300, t + sec);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.001, t); g.gain.linearRampToValueAtTime(0.25, t + sec * 0.8); g.gain.linearRampToValueAtTime(0.0, t + sec);
  n.connect(f).connect(g).connect(master); n.start(t);
}

// ギュッ
export function squeeze() {
  if (!soundOn) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'sawtooth'; o.frequency.setValueAtTime(220, t); o.frequency.exponentialRampToValueAtTime(900, t + 0.35);
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
  g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
  o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 0.5);
}

// スパッ（切る）
export function slice() {
  if (!soundOn) return;
  const t = ctx.currentTime;
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(0.3);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
  f.frequency.setValueAtTime(5200, t); f.frequency.exponentialRampToValueAtTime(1600, t + 0.18);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0, t); g.gain.linearRampToValueAtTime(0.32, t + 0.012); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  n.connect(f).connect(g).connect(master); n.start(t); n.stop(t + 0.3);
  const o = ctx.createOscillator(), go = ctx.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(1900, t); o.frequency.exponentialRampToValueAtTime(1200, t + 0.12);
  go.gain.setValueAtTime(0.06, t); go.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(go).connect(master); o.start(t); o.stop(t + 0.16);
}

// 数え上げの小さな音
export function tick(i) {
  if (!soundOn) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = 660 * Math.pow(1.06, Math.min(i, 24));
  g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
  o.connect(g).connect(master); o.start(t); o.stop(t + 0.2);
}
