/** Звуки, сгенерированные Web Audio API — никаких файлов. */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let musicGain: GainNode | null = null;
let muted = localStorageGet('tiki-muted') === '1';
let musicOn = localStorageGet('tiki-music') !== '0';
let musicTimer: ReturnType<typeof setInterval> | null = null;

function localStorageGet(k: string): string | null {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}
function localStorageSet(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
}

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.5;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = musicOn ? 0.18 : 0;
      musicGain.connect(master);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  ac();
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.3, at = 0, slide?: number, dest?: AudioNode) {
  const c = ac();
  if (!c || !master) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest ?? master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol = 0.2, at = 0, freq = 1200) {
  const c = ac();
  if (!c || !master) return;
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(c.currentTime + at);
}

export const sfx = {
  click: () => tone(660, 0.06, 'square', 0.08),
  hover: () => tone(880, 0.03, 'sine', 0.04),
  step: () => tone(420 + Math.random() * 60, 0.08, 'triangle', 0.15, 0, 620),
  diceTick: () => noise(0.04, 0.15, 0, 2500),
  diceStop: () => {
    tone(523, 0.1, 'square', 0.12);
    tone(784, 0.18, 'square', 0.12, 0.08);
  },
  coinUp: () => {
    tone(988, 0.08, 'square', 0.1);
    tone(1319, 0.2, 'square', 0.1, 0.07);
  },
  coinDown: () => {
    tone(440, 0.12, 'sawtooth', 0.08, 0, 300);
    tone(330, 0.2, 'sawtooth', 0.08, 0.1, 200);
  },
  star: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.35, 'triangle', 0.18, i * 0.09)),
  bad: () => {
    tone(220, 0.3, 'sawtooth', 0.12, 0, 110);
    noise(0.3, 0.1, 0, 300);
  },
  good: () => [659, 880, 1175].forEach((f, i) => tone(f, 0.2, 'triangle', 0.15, i * 0.07)),
  item: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.12, 'sine', 0.15, i * 0.05)),
  whoosh: () => noise(0.5, 0.25, 0, 700),
  turn: () => {
    tone(587, 0.12, 'triangle', 0.15);
    tone(880, 0.2, 'triangle', 0.15, 0.1);
  },
  win: () => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'square', 0.1, i * 0.12)),
  drum: (n: number) => {
    tone([130, 175, 220, 290][n] ?? 150, 0.25, 'sine', 0.4, 0, ([130, 175, 220, 290][n] ?? 150) * 0.6);
    noise(0.08, 0.2, 0, 800 + n * 300);
  },
  catch: () => tone(1046 + Math.random() * 200, 0.08, 'sine', 0.15),
  splat: () => noise(0.15, 0.25, 0, 400),
  erupt: () => {
    noise(1.2, 0.4, 0, 150);
    tone(80, 1, 'sawtooth', 0.2, 0, 40);
  },
  tick: () => tone(1500, 0.03, 'square', 0.05),
};

// ----- Фоновая музыка: простой луп на маримбе -----
const SCALE = [0, 2, 4, 7, 9, 12, 14, 16];
const MELODY = [0, 2, 4, 2, 5, 4, 2, -1, 3, 4, 5, 7, 5, 4, 2, -1, 0, 2, 4, 5, 4, 2, 1, -1, 2, 4, 2, 1, 0, -1, 0, -1];
const BASS = [0, 0, 5, 5, 3, 3, 4, 4];

export function startMusic() {
  const c = ac();
  if (!c || musicTimer) return;
  let step = 0;
  const beat = 0.22;
  musicTimer = setInterval(() => {
    if (!musicGain || musicGain.gain.value === 0) {
      step++;
      return;
    }
    const n = MELODY[step % MELODY.length];
    if (n >= 0) tone(392 * Math.pow(2, SCALE[n] / 12), beat * 1.6, 'sine', 0.5, 0, undefined, musicGain);
    if (step % 4 === 0) {
      const b = BASS[Math.floor(step / 4) % BASS.length];
      tone(98 * Math.pow(2, SCALE[b] / 12), beat * 3.5, 'triangle', 0.6, 0, undefined, musicGain);
    }
    if (step % 2 === 1) noise(0.03, 0.05, 0, 6000);
    step++;
  }, beat * 1000);
}

export function isMuted() {
  return muted;
}
export function setMuted(v: boolean) {
  muted = v;
  localStorageSet('tiki-muted', v ? '1' : '0');
  if (master) master.gain.value = v ? 0 : 0.5;
}
export function isMusicOn() {
  return musicOn;
}
export function setMusic(v: boolean) {
  musicOn = v;
  localStorageSet('tiki-music', v ? '1' : '0');
  if (musicGain) musicGain.gain.value = v ? 0.18 : 0;
}
