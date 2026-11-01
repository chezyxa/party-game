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
  // Мир доски; координаты ниже заданы в долях картинки острова (sprites/island.webp),
  // замеренных по ней: кольцо идёт посередине пляжа, срезы — по просекам.
  const W = Math.round(2440 * BOARD_SCALE);
  const H = Math.round(1640 * BOARD_SCALE);
  const P = (u: number, v: number): Pt => ({ x: Math.round(u * W), y: Math.round(v * H) });

  const nodes: BoardNode[] = [];
  const add = (p: Pt, code: string, route: Route): number => {
    const type = CODE[code] ?? 'blue';
    const id = nodes.length;
    nodes.push({ id, x: p.x, y: p.y, type, next: [], route, passThrough: type === 'shop' || type === 'thief' });
    return id;
  };

  // Основное кольцо по пляжу (по часовой стрелке, старт — северо-запад).
  const ring: Pt[] = [
    P(0.211, 0.23),
    P(0.293, 0.169),
    P(0.361, 0.12),
    P(0.433, 0.105),
    P(0.5, 0.1),
    P(0.571, 0.088),
    P(0.648, 0.097),
    P(0.732, 0.132),
    P(0.823, 0.201),
    P(0.866, 0.28),
    P(0.912, 0.42),
    P(0.925, 0.537),
    P(0.9, 0.642),
    P(0.859, 0.731),
    P(0.794, 0.792),
    P(0.69, 0.828),
    P(0.594, 0.866),
    P(0.5, 0.853),
    P(0.4, 0.83),
    P(0.33, 0.812),
    P(0.267, 0.748),
    P(0.199, 0.691),
    P(0.14, 0.585),
    P(0.13, 0.48),
    P(0.15, 0.388),
    P(0.177, 0.306),
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

  // Джунгли: короткий, но опасный срез справа от водопада.
  branch(P(0.8, 0.18), [P(0.755, 0.35), P(0.75, 0.48), P(0.8, 0.6)], P(0.88, 0.69), 'RQVR', 'jungle');
  // Тропа у вулкана: большой срез по просеке через центр острова.
  branch(P(0.46, 0.1), [P(0.49, 0.22), P(0.56, 0.34), P(0.61, 0.47), P(0.575, 0.6), P(0.5, 0.72)], P(0.47, 0.85), 'RBQVBRDV', 'volcano');
  // Причал: длинный крюк по воде у юго-западного берега, зато удачливый.
  branch(P(0.27, 0.75), [P(0.18, 0.88), P(0.085, 0.865), P(0.045, 0.72)], P(0.135, 0.575), 'BLQBLB', 'pier');

  // Места, где может появиться звезда: ближайшая синяя клетка к якорю.
  const anchors: Pt[] = [P(0.5, 0.1), P(0.93, 0.5), P(0.7, 0.82), P(0.32, 0.8), P(0.06, 0.8), P(0.6, 0.46), P(0.13, 0.45), P(0.75, 0.45)];
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

  // Берег — для запасной отрисовки, если картинки острова нет.
  const cx = W / 2;
  const cy = H * 0.48;
  const coast = densify(ring, true)
    .filter((_, i) => i % 6 === 0)
    .map((p) => {
      const dx = p.x - cx;
      const dy = p.y - cy;
      const d = Math.hypot(dx, dy) || 1;
      const grow = 90 + 25 * Math.sin(p.x * 0.01 + p.y * 0.005);
      return { x: Math.round(p.x + (dx / d) * grow), y: Math.round(p.y + (dy / d) * grow) };
    });

  return {
    name: 'Остров Тики',
    width: W,
    height: H,
    nodes,
    start: main[0],
    starSpots,
    volcano: P(0.46, 0.43),
    coast,
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
