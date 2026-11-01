/**
 * Процедурная графика: персонажи, звезда, монета. Если в public/sprites
 * лежит sheet.png + sheet.json, используются картинки оттуда.
 */
import { CHAR_BY_ID } from '../core/characters';

type Ctx = CanvasRenderingContext2D;

interface SheetFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Sheet {
  img: HTMLImageElement | HTMLCanvasElement;
  frames: Record<string, SheetFrame>;
}
const sheets: Sheet[] = [];
/** Картинка острова (фон всей доски), если есть. */
let islandImg: HTMLCanvasElement | null = null;

/** Порядок картинок в сетке 6×4 первого листа (docs/sprites-prompt.md). */
export const GRID_NAMES = [
  ['char_kapi', 'char_tiko', 'char_kvaka', 'char_tora', 'char_kleshnya', 'char_mimi'],
  ['star', 'coin', 'icon_villain', 'icon_thief', 'icon_shop', 'icon_bank'],
  ['icon_double', 'icon_triple', 'icon_custom', 'icon_shell', 'icon_swap', 'icon_paw'],
  ['icon_trap', 'icon_chest', 'icon_clover', 'icon_palm', 'icon_volcano', 'icon_drum'],
];

/** Порядок второго листа — клетки поля и элементы интерфейса (docs/sprites-prompt-2.md). */
export const GRID_UI = [
  ['tile_blue', 'tile_red', 'tile_event', 'tile_lucky', 'tile_villain', 'tile_duel'],
  ['tile_bank', 'tile_shop', 'tile_thief', 'ui_die', 'ui_trophy', 'ui_signpost'],
  ['fruit_banana', 'fruit_mango', 'fruit_pineapple', 'fruit_rotten', 'icon_coconut', 'icon_crab'],
  ['icon_fish', 'icon_bush', 'ui_cardback', 'icon_gem', 'ui_plank', 'ui_parchment'],
];

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Лист: name.json (+ картинка из него) либо name.webp / name.png, разложенный сеткой 6×4. */
async function loadSheet(name: string, grid: string[][]): Promise<void> {
  const json = await fetchJson<{ image: string; frames: Record<string, SheetFrame> }>(`sprites/${name}.json`);
  if (json) {
    const img = await loadImage('sprites/' + json.image);
    if (img) sheets.push({ img, frames: json.frames });
    return;
  }
  const img = (await loadImage(`sprites/${name}.webp`)) ?? (await loadImage(`sprites/${name}.png`));
  if (!img) return;
  const cw = img.naturalWidth / 6;
  const ch = img.naturalHeight / 4;
  const frames: Record<string, SheetFrame> = {};
  grid.forEach((row, r) => row.forEach((n, c) => (frames[n] = { x: c * cw, y: r * ch, w: cw, h: ch })));
  sheets.push({ img, frames });
}

/** Остров: края плавно растворяются, чтобы не было шва с океаном вокруг. */
async function loadIsland(): Promise<void> {
  const img = (await loadImage('sprites/island.webp')) ?? (await loadImage('sprites/island.png')) ?? (await loadImage('sprites/island.jpg'));
  if (!img) return;
  const w = img.naturalWidth;
  const hh = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hh;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  const f = Math.min(w, hh) * 0.06;
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(0,0,0,0)');
  gx.addColorStop(f / w, '#000');
  gx.addColorStop(1 - f / w, '#000');
  gx.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gx;
  ctx.fillRect(0, 0, w, hh);
  const gy = ctx.createLinearGradient(0, 0, 0, hh);
  gy.addColorStop(0, 'rgba(0,0,0,0)');
  gy.addColorStop(f / hh, '#000');
  gy.addColorStop(1 - f / hh, '#000');
  gy.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gy;
  ctx.fillRect(0, 0, w, hh);
  islandImg = c;
}

export async function loadSpriteSheet(): Promise<void> {
  await Promise.all([loadSheet('sheet', GRID_NAMES), loadSheet('ui', GRID_UI), loadIsland()]);
  applyCssSprites();
}

export function getIsland(): HTMLCanvasElement | null {
  return islandImg;
}

function findFrame(name: string): [Sheet, SheetFrame] | null {
  for (const sh of sheets) if (sh.frames[name]) return [sh, sh.frames[name]];
  return null;
}

function drawFrame(ctx: Ctx, name: string, x: number, y: number, w: number, h: number, stretch = false): boolean {
  const hit = findFrame(name);
  if (!hit) return false;
  const [sh, f] = hit;
  if (stretch) {
    ctx.drawImage(sh.img, f.x, f.y, f.w, f.h, x, y, w, h);
    return true;
  }
  const k = Math.min(w / f.w, h / f.h);
  const dw = f.w * k;
  const dh = f.h * k;
  ctx.drawImage(sh.img, f.x, f.y, f.w, f.h, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return true;
}

export function hasSprite(name: string) {
  return !!findFrame(name);
}

/** Кадр в его родных пропорциях (для фонов: доска-табличка, пергамент). */
function frameUrl(name: string, maxSide = 512): string | null {
  const hit = findFrame(name);
  if (!hit) return null;
  const f = hit[1];
  const k = Math.min(1, maxSide / Math.max(f.w, f.h));
  const c = document.createElement('canvas');
  c.width = Math.round(f.w * k);
  c.height = Math.round(f.h * k);
  drawFrame(c.getContext('2d')!, name, 0, 0, c.width, c.height, true);
  return c.toDataURL();
}

/** Пробрасываем спрайты интерфейса в CSS-переменные: --img-die, --img-plank и т. д. */
function applyCssSprites() {
  const root = document.documentElement;
  const map: Record<string, string> = {
    ui_die: '--img-die',
    ui_plank: '--img-plank',
    ui_parchment: '--img-parchment',
    ui_cardback: '--img-cardback',
    icon_bush: '--img-bush',
  };
  for (const [frame, prop] of Object.entries(map)) {
    const url = frameUrl(frame);
    if (url) {
      root.style.setProperty(prop, `url("${url}")`);
      root.classList.add('has' + prop.slice(5));
    }
  }
}

function canvas(size: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number, fill: string, stroke?: string, lw = 3) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function eye(ctx: Ctx, x: number, y: number, r: number, look = 0.3) {
  ellipse(ctx, x, y, r, r * 1.1, '#fff', '#222', 2);
  ellipse(ctx, x + r * look, y + r * 0.1, r * 0.55, r * 0.62, '#1d1d1d');
  ellipse(ctx, x + r * look + r * 0.2, y - r * 0.2, r * 0.18, r * 0.18, '#fff');
}

function smile(ctx: Ctx, x: number, y: number, w: number, color = '#3b1f12') {
  ctx.beginPath();
  ctx.arc(x, y - w * 0.6, w, Math.PI * 0.25, Math.PI * 0.75);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.stroke();
}

const OUT = '#2b1a10';

/** Портрет на холсте 100×100 (масштабируется снаружи). */
function drawPortrait(ctx: Ctx, id: string) {
  switch (id) {
    case 'kapi': {
      ellipse(ctx, 28, 30, 9, 8, '#8a5530', OUT);
      ellipse(ctx, 72, 30, 9, 8, '#8a5530', OUT);
      ellipse(ctx, 50, 56, 36, 32, '#b07444', OUT);
      ellipse(ctx, 50, 70, 22, 15, '#d39a68', OUT, 2);
      ellipse(ctx, 43, 67, 3, 2.5, '#3b1f12');
      ellipse(ctx, 57, 67, 3, 2.5, '#3b1f12');
      // Сонные глаза.
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#2b1a10';
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(36, 48, 6, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(64, 48, 6, Math.PI * 0.1, Math.PI * 0.9);
      ctx.stroke();
      smile(ctx, 50, 80, 6);
      // Мандаринка на голове.
      ellipse(ctx, 50, 22, 11, 10, '#ff9f1a', OUT, 2.5);
      ellipse(ctx, 54, 12, 6, 3, '#3fa34d', OUT, 1.5);
      break;
    }
    case 'tiko': {
      ellipse(ctx, 44, 54, 33, 34, '#1f1f2b', '#0c0c12');
      ellipse(ctx, 38, 70, 18, 14, '#fff3c4');
      ellipse(ctx, 34, 44, 11, 11, '#4fb3ff');
      eye(ctx, 34, 44, 7, 0.4);
      // Клюв.
      ctx.beginPath();
      ctx.moveTo(50, 36);
      ctx.quadraticCurveTo(100, 30, 98, 58);
      ctx.quadraticCurveTo(80, 70, 52, 62);
      ctx.closePath();
      const g = ctx.createLinearGradient(50, 0, 98, 0);
      g.addColorStop(0, '#ffd23f');
      g.addColorStop(0.65, '#ff8c1a');
      g.addColorStop(1, '#e8382e');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = OUT;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(52, 50);
      ctx.quadraticCurveTo(78, 52, 97, 56);
      ctx.lineWidth = 2;
      ctx.stroke();
      // Хохолок.
      ellipse(ctx, 40, 20, 5, 10, '#1f1f2b');
      break;
    }
    case 'kvaka': {
      ellipse(ctx, 50, 62, 40, 29, '#58c25a', '#1f5e22');
      ellipse(ctx, 31, 34, 14, 13, '#58c25a', '#1f5e22');
      ellipse(ctx, 69, 34, 14, 13, '#58c25a', '#1f5e22');
      eye(ctx, 31, 34, 9, 0.2);
      eye(ctx, 69, 34, 9, -0.2);
      ellipse(ctx, 24, 66, 7, 4, '#ff8fa3');
      ellipse(ctx, 76, 66, 7, 4, '#ff8fa3');
      ctx.beginPath();
      ctx.moveTo(30, 66);
      ctx.quadraticCurveTo(50, 84, 70, 66);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = '#1f5e22';
      ctx.lineCap = 'round';
      ctx.stroke();
      ellipse(ctx, 44, 54, 2, 1.5, '#1f5e22');
      ellipse(ctx, 56, 54, 2, 1.5, '#1f5e22');
      break;
    }
    case 'tora': {
      // Панцирь.
      ellipse(ctx, 50, 50, 44, 40, '#3c7d3a', '#1f3d1d');
      ctx.strokeStyle = '#a6d36b';
      ctx.lineWidth = 3;
      for (const [x, y] of [
        [28, 30],
        [72, 30],
        [20, 58],
        [80, 58],
        [50, 18],
      ]) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i;
          ctx.lineTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
        }
        ctx.closePath();
        ctx.stroke();
      }
      // Голова.
      ellipse(ctx, 50, 62, 25, 23, '#9fd36b', '#3b6b22');
      eye(ctx, 41, 57, 6, 0.3);
      eye(ctx, 59, 57, 6, 0.3);
      smile(ctx, 50, 76, 7, '#3b6b22');
      ellipse(ctx, 37, 68, 4, 2.5, '#ff9fb0');
      ellipse(ctx, 63, 68, 4, 2.5, '#ff9fb0');
      break;
    }
    case 'kleshnya': {
      // Клешни.
      for (const s of [-1, 1]) {
        ctx.save();
        ctx.translate(50 + s * 36, 34);
        ctx.rotate(s * 0.4);
        ellipse(ctx, 0, 0, 13, 15, '#ef4b3a', '#7a1a12');
        ctx.beginPath();
        ctx.moveTo(-s * 2, -14);
        ctx.lineTo(s * 4, 0);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#7a1a12';
        ctx.stroke();
        ctx.restore();
      }
      ellipse(ctx, 50, 66, 36, 26, '#ef4b3a', '#7a1a12');
      ctx.strokeStyle = '#7a1a12';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(40, 46);
      ctx.lineTo(38, 30);
      ctx.moveTo(60, 46);
      ctx.lineTo(62, 30);
      ctx.stroke();
      eye(ctx, 38, 26, 8, 0.2);
      eye(ctx, 62, 26, 8, -0.2);
      smile(ctx, 50, 76, 9, '#7a1a12');
      ellipse(ctx, 30, 70, 5, 3, '#ffa08a');
      ellipse(ctx, 70, 70, 5, 3, '#ffa08a');
      break;
    }
    case 'mimi': {
      ellipse(ctx, 16, 52, 13, 14, '#7a4a2a', OUT);
      ellipse(ctx, 84, 52, 13, 14, '#7a4a2a', OUT);
      ellipse(ctx, 16, 52, 7, 8, '#f2c9a0');
      ellipse(ctx, 84, 52, 7, 8, '#f2c9a0');
      ellipse(ctx, 50, 52, 36, 36, '#7a4a2a', OUT);
      ellipse(ctx, 40, 48, 13, 14, '#f2c9a0');
      ellipse(ctx, 60, 48, 13, 14, '#f2c9a0');
      ellipse(ctx, 50, 68, 22, 15, '#f2c9a0');
      eye(ctx, 40, 48, 6.5, 0.2);
      eye(ctx, 60, 48, 6.5, 0.2);
      ellipse(ctx, 46, 63, 2, 1.5, OUT);
      ellipse(ctx, 54, 63, 2, 1.5, OUT);
      smile(ctx, 50, 76, 8);
      // Цветок гибискуса.
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5;
        ellipse(ctx, 76 + Math.cos(a) * 7, 24 + Math.sin(a) * 7, 6, 6, '#ff4f9a', '#b0185d', 1.5);
      }
      ellipse(ctx, 76, 24, 4, 4, '#ffe14d');
      break;
    }
    default:
      ellipse(ctx, 50, 50, 40, 40, '#999');
  }
}

const cache = new Map<string, HTMLCanvasElement>();

/** Жетон персонажа: цветной круг игрока + портрет. */
export function charCanvas(charId: string, size: number, ring = true): HTMLCanvasElement {
  const key = `c:${charId}:${size}:${ring}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(size);
  const col = CHAR_BY_ID[charId]?.color ?? '#888';
  const s = size / 100;
  if (ring) {
    const g = ctx.createRadialGradient(size * 0.4, size * 0.35, size * 0.1, size / 2, size / 2, size / 2);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, col);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 3 * s, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 6 * s;
    ctx.strokeStyle = col;
    ctx.stroke();
    ctx.lineWidth = 2 * s;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }
  if (!drawFrame(ctx, 'char_' + charId, size * 0.06, size * 0.06, size * 0.88, size * 0.88)) {
    ctx.save();
    const k = ring ? 0.84 : 1;
    ctx.translate((size * (1 - k)) / 2, (size * (1 - k)) / 2);
    ctx.scale(s * k, s * k);
    drawPortrait(ctx, charId);
    ctx.restore();
  }
  cache.set(key, c);
  return c;
}

export function charUrl(charId: string, size = 96, ring = true): string {
  return charCanvas(charId, size, ring).toDataURL();
}

function starPath(ctx: Ctx, cx: number, cy: number, R: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (Math.PI / 5) * i;
    const rad = i % 2 === 0 ? R : r;
    ctx.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  ctx.closePath();
}

/** Звезда — золотая морская звёздочка. */
export function starCanvas(size: number): HTMLCanvasElement {
  const key = `star:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(size);
  if (!drawFrame(ctx, 'star', 0, 0, size, size)) {
    const s = size / 100;
    ctx.scale(s, s);
    ctx.lineJoin = 'round';
    starPath(ctx, 50, 54, 47, 22);
    const g = ctx.createRadialGradient(45, 45, 5, 50, 54, 50);
    g.addColorStop(0, '#fff6a8');
    g.addColorStop(0.5, '#ffcf2e');
    g.addColorStop(1, '#f08a12');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#9a4b00';
    ctx.stroke();
    for (const [x, y] of [
      [50, 22],
      [22, 46],
      [78, 46],
      [32, 80],
      [68, 80],
    ])
      ellipse(ctx, x, y, 3, 3, '#ffb000');
    ellipse(ctx, 42, 52, 4, 5, '#4a2500');
    ellipse(ctx, 58, 52, 4, 5, '#4a2500');
    ellipse(ctx, 43, 50, 1.5, 1.5, '#fff');
    ellipse(ctx, 59, 50, 1.5, 1.5, '#fff');
    smile(ctx, 50, 66, 5, '#4a2500');
  }
  cache.set(key, c);
  return c;
}

export function coinCanvas(size: number): HTMLCanvasElement {
  const key = `coin:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(size);
  if (!drawFrame(ctx, 'coin', 0, 0, size, size)) {
    const s = size / 100;
    ctx.scale(s, s);
    ellipse(ctx, 50, 50, 44, 44, '#f5b700', '#8a5a00', 5);
    ellipse(ctx, 50, 50, 32, 32, '#ffd84a', '#c98a00', 3);
    ctx.fillStyle = '#c98a00';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('T', 50, 53);
  }
  cache.set(key, c);
  return c;
}

export const starUrl = (size = 48) => starCanvas(size).toDataURL();
export const coinUrl = (size = 48) => coinCanvas(size).toDataURL();

/** Эмодзи-иконки для карточек, предметов и мини-игр. */
export const EMOJI: Record<string, string> = {
  double: '🎲',
  triple: '🎰',
  custom: '🎯',
  shell: '🐚',
  swap: '📜',
  paw: '🐾',
  trap: '🪤',
  trophy: '🏆',
  chest: '🧰',
  parrot: '🦜',
  volcano: '🌋',
  bush: '🌿',
  banana: '🍌',
  mango: '🥭',
  pineapple: '🍍',
  rotten: '🤢',
  coconut: '🥥',
  crab: '🦀',
  fish: '🐟',
  drum: '🥁',
  villain: '🏴‍☠️',
  thief: '🐒',
  shop: '🛒',
  bank: '🐢',
  clover: '🍀',
  wave: '🌊',
  dolphin: '🐬',
  storm: '🌪️',
  coin: '🪙',
  star: '⭐',
  gem: '💎',
};

/** Иконка предмета/события: спрайт, если есть, иначе эмодзи. */
/** Синонимы: какие спрайты подходят для иконок, у которых нет своей картинки. */
const ICON_ALIAS: Record<string, string> = { parrot: 'shop' };

/** Кадр спрайта как холст (или null, если спрайтов нет). */
export function spriteCanvas(frame: string, size: number): HTMLCanvasElement | null {
  if (!hasSprite(frame)) return null;
  const key = `s:${frame}:${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [c, ctx] = canvas(size);
  drawFrame(ctx, frame, 0, 0, size, size);
  cache.set(key, c);
  return c;
}

export function iconHtml(name: string, size = 32): string {
  const frame = ['icon_' + name, 'ui_' + name, 'fruit_' + name, 'icon_' + (ICON_ALIAS[name] ?? name)].find(hasSprite) ?? '';
  const c = spriteCanvas(frame, size * 2);
  if (c) return `<img src="${c.toDataURL()}" width="${size}" height="${size}" alt="">`;
  if (name === 'star') return `<img src="${starUrl(size * 2)}" width="${size}" height="${size}" alt="">`;
  if (name === 'coin') return `<img src="${coinUrl(size * 2)}" width="${size}" height="${size}" alt="">`;
  return `<span class="emoji" style="font-size:${Math.round(size * 0.85)}px">${EMOJI[name] ?? '❔'}</span>`;
}
