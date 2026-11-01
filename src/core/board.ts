/**
 * Карта «Остров Тики». Граф клеток генерируется из контрольных точек,
 * чтобы координаты были ровными и легко правились.
 */

export type SpaceType =
  | 'blue' // +3 монеты
  | 'red' // −3 монеты
  | 'event' // «?» — событие острова
  | 'lucky' // клевер — предмет или монеты
  | 'villain' // капитан Барракуда
  | 'duel' // дуэль
  | 'bank' // банк: проходя — кладёшь 5, вставая — забираешь всё
  | 'shop' // лавка (проходная, не считается шагом)
  | 'thief'; // хижина воришки (проходная, не считается шагом)

export type Route = 'main' | 'jungle' | 'volcano' | 'pier';

export interface BoardNode {
  id: number;
  x: number;
  y: number;
  type: SpaceType;
  next: number[];
  route: Route;
  /** Проходные клетки не тратят шаг и на них нельзя остановиться. */
  passThrough: boolean;
}

export interface Board {
  name: string;
  width: number;
  height: number;
  nodes: BoardNode[];
  start: number;
  starSpots: number[];
  volcano: { x: number; y: number };
  /** Полигон берега острова (для отрисовки). */
  coast: { x: number; y: number }[];
}

interface Pt {
  x: number;
  y: number;
}

function catmull(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const c = (a: number, b: number, cc: number, d: number) =>
    0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
  return { x: c(p0.x, p1.x, p2.x, p3.x), y: c(p0.y, p1.y, p2.y, p3.y) };
}

function densify(pts: Pt[], closed: boolean): Pt[] {
  const out: Pt[] = [];
  const n = pts.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[closed ? (i + 2) % n : Math.min(n - 1, i + 2)];
    for (let k = 0; k < 40; k++) out.push(catmull(p0, p1, p2, p3, k / 40));
  }
  if (!closed) out.push(pts[n - 1]);
  else out.push(pts[0]);
  return out;
}

function resample(dense: Pt[], count: number, includeEnd: boolean): Pt[] {
  const lens = [0];
  for (let i = 1; i < dense.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  }
  const total = lens[lens.length - 1];
  const out: Pt[] = [];
  const steps = includeEnd ? count - 1 : count;
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = (total * i) / steps;
    while (j < lens.length - 2 && lens[j + 1] < target) j++;
    const seg = lens[j + 1] - lens[j] || 1;
    const t = (target - lens[j]) / seg;
    out.push({
      x: Math.round(dense[j].x + (dense[j + 1].x - dense[j].x) * t),
      y: Math.round(dense[j].y + (dense[j + 1].y - dense[j].y) * t),
    });
  }
  return out;
}

const CODE: Record<string, SpaceType> = {
  B: 'blue',
  R: 'red',
  Q: 'event',
  L: 'lucky',
  V: 'villain',
  D: 'duel',
  K: 'bank',
  S: 'shop',
  T: 'thief',
};

/** Во сколько раз карта крупнее исходной разметки. */
export const BOARD_SCALE = 1.3;

function buildIsland(): Board {
  const nodes: BoardNode[] = [];
  const add = (p: Pt, code: string, route: Route): number => {
    const type = CODE[code] ?? 'blue';
    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y, type, next: [], route, passThrough: type === 'shop' || type === 'thief' });
    return id;
  };

  // Основное кольцо по побережью (по часовой стрелке).
  const ring: Pt[] = [
    { x: 520, y: 560 },
    { x: 760, y: 360 },
    { x: 1100, y: 270 },
    { x: 1450, y: 285 },
    { x: 1790, y: 380 },
    { x: 2010, y: 620 },
    { x: 2020, y: 960 },
    { x: 1810, y: 1230 },
    { x: 1420, y: 1335 },
    { x: 1010, y: 1325 },
    { x: 660, y: 1225 },
    { x: 430, y: 980 },
  ];
  const MAIN = 'BBBSBQBRBBLBQKDRBBQBRBTBBVQBLBRBBQBDBBRB';
  const mainPts = resample(densify(ring, true), MAIN.length, false);
  const main = mainPts.map((p, i) => add(p, MAIN[i], 'main'));
  for (let i = 0; i < main.length; i++) nodes[main[i]].next.push(main[(i + 1) % main.length]);

  const nearestMain = (p: Pt) =>
    main.reduce((best, id) =>
      Math.hypot(nodes[id].x - p.x, nodes[id].y - p.y) < Math.hypot(nodes[best].x - p.x, nodes[best].y - p.y) ? id : best,
    );

  const branch = (from: Pt, via: Pt[], to: Pt, pattern: string, route: Route) => {
    const a = nearestMain(from);
    const b = nearestMain(to);
    const ctrl = [nodes[a], ...via, nodes[b]].map((n) => ({ x: n.x, y: n.y }));
    const pts = resample(densify(ctrl, false), pattern.length + 2, true).slice(1, -1);
    const ids = pts.map((p, i) => add(p, pattern[i], route));
    nodes[a].next.push(ids[0]);
    for (let i = 0; i < ids.length - 1; i++) nodes[ids[i]].next.push(ids[i + 1]);
    nodes[ids[ids.length - 1]].next.push(b);
  };

  // Джунгли: короткий, но опасный срез справа.
  branch({ x: 1790, y: 380 }, [{ x: 1700, y: 640 }], { x: 2020, y: 960 }, 'RQV', 'jungle');
  // Тропа у вулкана: большой срез через центр острова.
  branch({ x: 1100, y: 270 }, [{ x: 1240, y: 520 }, { x: 1440, y: 800 }, { x: 1300, y: 1080 }], { x: 1010, y: 1325 }, 'RBQVBRDV', 'volcano');
  // Причал: длинный крюк по воде, зато удачливый.
  branch({ x: 660, y: 1225 }, [{ x: 560, y: 1450 }, { x: 290, y: 1400 }, { x: 210, y: 1170 }], { x: 430, y: 980 }, 'BLQBLB', 'pier');

  // Места, где может появиться звезда: ближайшая синяя клетка к якорю.
  const anchors: Pt[] = [
    { x: 1250, y: 260 },
    { x: 2020, y: 800 },
    { x: 1600, y: 1300 },
    { x: 800, y: 1280 },
    { x: 300, y: 1450 },
    { x: 1400, y: 900 },
    { x: 450, y: 800 },
    { x: 1720, y: 640 },
  ];
  const starSpots: number[] = [];
  for (const a of anchors) {
    let best = -1;
    let bestD = Infinity;
    for (const n of nodes) {
      if (n.type !== 'blue' || n.id === main[0] || starSpots.includes(n.id)) continue;
      const d = Math.hypot(n.x - a.x, n.y - a.y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    if (best >= 0) starSpots.push(best);
  }

  // Берег: раздутый контур кольца.
  const cx = 1220;
  const cy = 820;
  const coastSrc = densify(ring, true).filter((_, i) => i % 6 === 0);
  const coast = coastSrc.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const d = Math.hypot(dx, dy) || 1;
    const grow = 110 + 25 * Math.sin(p.x * 0.013 + p.y * 0.007);
    return { x: Math.round(p.x + (dx / d) * grow), y: Math.round(p.y + (dy / d) * grow) };
  });

  // Растягиваем всю карту, чтобы клетки можно было рисовать крупнее.
  const K = BOARD_SCALE;
  for (const n of nodes) {
    n.x = Math.round(n.x * K);
    n.y = Math.round(n.y * K);
  }
  return {
    name: 'Остров Тики',
    width: Math.round(2440 * K),
    height: Math.round(1640 * K),
    nodes,
    start: main[0],
    starSpots,
    volcano: { x: Math.round(1130 * K), y: Math.round(790 * K) },
    coast: coast.map((p) => ({ x: Math.round(p.x * K), y: Math.round(p.y * K) })),
  };
}

export const ISLAND: Board = buildIsland();

/** Сколько считаемых шагов от узла до цели (BFS). */
export function stepsTo(board: Board, from: number, to: number): number {
  const dist = new Map<number, number>([[from, 0]]);
  // 0-1 BFS: проходные клетки не тратят шаг.
  const dq: number[] = [from];
  while (dq.length) {
    const u = dq.shift()!;
    const du = dist.get(u)!;
    if (u === to) return du;
    for (const v of board.nodes[u].next) {
      const w = board.nodes[v].passThrough ? 0 : 1;
      const nd = du + w;
      if (!dist.has(v) || nd < dist.get(v)!) {
        dist.set(v, nd);
        if (w === 0) dq.unshift(v);
        else dq.push(v);
      }
    }
  }
  return 999;
}
