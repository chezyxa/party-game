/**
 * Навыковые мини-игры: каждый играет у себя локально с одинаковым seed,
 * хосту отправляется только итоговый счёт. Поэтому пинг не влияет на результат.
 */
import { Rng } from '../rng';
import { clampNum, LEVEL_K, type MgDef } from './types';

// ---------- Генераторы уровней (общие для клиента и хоста) ----------
export type FruitKind = 'banana' | 'mango' | 'pineapple' | 'rotten';
export const FRUIT_POINTS: Record<FruitKind, number> = { banana: 1, mango: 2, pineapple: 5, rotten: -3 };
export interface FruitSpawn {
  t: number;
  x: number;
  kind: FruitKind;
  speed: number;
}
export const CATCH_DURATION = 25;
export function catchLevel(seed: number): FruitSpawn[] {
  const r = new Rng(seed);
  const out: FruitSpawn[] = [];
  let t = 0.6;
  while (t < CATCH_DURATION - 1.2) {
    const p = r.next();
    const kind: FruitKind = p < 0.45 ? 'banana' : p < 0.72 ? 'mango' : p < 0.8 ? 'pineapple' : 'rotten';
    out.push({ t, x: 0.06 + r.next() * 0.88, kind, speed: 0.32 + (t / CATCH_DURATION) * 0.3 + r.next() * 0.1 });
    t += 0.38 + r.next() * 0.32;
  }
  return out;
}

export const TIMING_THROWS = 6;
export interface TimingThrow {
  speed: number;
  target: number;
  width: number;
}
export function timingLevel(seed: number): TimingThrow[] {
  const r = new Rng(seed);
  return Array.from({ length: TIMING_THROWS }, (_, i) => ({
    speed: 0.7 + i * 0.22 + r.next() * 0.2,
    target: 0.2 + r.next() * 0.6,
    width: 0.12 - i * 0.012,
  }));
}
export function timingScore(pos: number, th: TimingThrow): number {
  const d = Math.abs(pos - th.target);
  return Math.max(0, Math.round(100 - (d / th.width) * 45));
}

export const MEMORY_PAIRS = 8;
export const MEMORY_TIME = 45;
export const MEMORY_SYMBOLS = ['🐚', '🦀', '🐠', '🌺', '🥥', '🍍', '🐙', '🐢', '🌴', '🦜'];
export function memoryLevel(seed: number): number[] {
  const r = new Rng(seed);
  const syms = r.shuffle(MEMORY_SYMBOLS.map((_, i) => i)).slice(0, MEMORY_PAIRS);
  return r.shuffle([...syms, ...syms]);
}

export interface CountRound {
  crabs: number;
  actors: { kind: 'crab' | 'fish'; y: number; delay: number; speed: number; dir: 1 | -1 }[];
}
export const COUNT_ROUNDS = 3;
export const COUNT_ROUND_TIME = 6.5;
export function countLevel(seed: number): CountRound[] {
  const r = new Rng(seed);
  return Array.from({ length: COUNT_ROUNDS }, (_, i) => {
    const crabs = r.int(6 + i * 2, 11 + i * 3);
    const fish = r.int(3, 6 + i * 2);
    const actors: CountRound['actors'] = [];
    for (let k = 0; k < crabs + fish; k++) {
      actors.push({
        kind: k < crabs ? 'crab' : 'fish',
        y: 0.1 + r.next() * 0.8,
        delay: r.next() * (COUNT_ROUND_TIME - 2.8),
        speed: 0.35 + r.next() * 0.35 + i * 0.08,
        dir: r.chance(0.5) ? 1 : -1,
      });
    }
    return { crabs, actors };
  });
}
export const countRoundScore = (err: number) => Math.max(0, 10 - 3 * Math.abs(err));

export const SIMON_MAX = 20;
export const SIMON_TIME = 75;
export function simonLevel(seed: number): number[] {
  const r = new Rng(seed);
  return Array.from({ length: SIMON_MAX }, () => r.int(0, 3));
}

// ---------- Описание игр для хоста ----------
interface SkillSpec {
  id: string;
  name: string;
  icon: string;
  rules: string;
  controls: string;
  duration: number;
  maxScore: (seed: number) => number;
  bot: (rng: Rng, k: number, seed: number) => number;
}

function skill(spec: SkillSpec): MgDef {
  return {
    id: spec.id,
    name: spec.name,
    icon: spec.icon,
    rules: spec.rules,
    controls: spec.controls,
    kind: 'skill',
    formats: ['ffa', 'team', '1v', 'duel'],
    async run(ctx) {
      const seed = ctx.rng.int(1, 2 ** 30);
      const max = spec.maxScore(seed);
      const done: string[] = [];
      const scores = await ctx.askAll<number>(ctx.players, () => ({ seed, duration: spec.duration }), {
        timeout: (spec.duration + 25) * 1000,
        botDelay: () => spec.duration * 1000 * (0.85 + Math.random() * 0.15),
        validate: (v) => clampNum(v, -1000, max),
        bot: () => Math.max(0, Math.min(max, Math.round(spec.bot(ctx.rng, LEVEL_K[ctx.level], seed)))),
        onAnswer: (pid) => {
          done.push(pid);
          void ctx.show({ stage: 'progress', done: [...done] }, 0);
        },
      });
      await ctx.show({ stage: 'scores', scores }, 1500);
      return scores;
    },
  };
}

export const catchGame = skill({
  id: 'catch',
  name: 'Фруктопад',
  icon: 'banana',
  duration: CATCH_DURATION,
  rules:
    'С пальм падают фрукты. Лови их корзиной! Банан — 1 очко, манго — 2, ананас — 5. ' +
    'Гнилые фрукты отнимают 3 очка — уворачивайся. У всех одинаковый «дождь».',
  controls: '← → или A/D — двигать корзину (можно мышью).',
  maxScore: (seed) => catchLevel(seed).reduce((s, f) => s + Math.max(0, FRUIT_POINTS[f.kind]), 0),
  bot: (r, k, seed) => {
    const lvl = catchLevel(seed);
    let s = 0;
    for (const f of lvl) {
      const p = FRUIT_POINTS[f.kind];
      if (p > 0 ? r.chance(k * 0.95) : r.chance((1 - k) * 0.6)) s += p;
    }
    return s;
  },
});

export const timingGame = skill({
  id: 'timing',
  name: 'Меткий кокос',
  icon: 'coconut',
  duration: 30,
  rules:
    'Над мишенью качается прицел. Останови его как можно ближе к центру зелёной зоны. ' +
    `${TIMING_THROWS} бросков, каждый быстрее предыдущего. До 100 очков за бросок.`,
  controls: 'Пробел или клик — бросить кокос.',
  maxScore: () => TIMING_THROWS * 100,
  bot: (r, k) => {
    let s = 0;
    for (let i = 0; i < TIMING_THROWS; i++) s += Math.max(0, Math.min(100, r.gauss(k * 92, 14)));
    return s;
  },
});

export const memoryGame = skill({
  id: 'memory',
  name: 'Парные ракушки',
  icon: 'shell',
  duration: MEMORY_TIME,
  rules:
    'Под ракушками спрятаны картинки. Открывай по две и находи пары. ' +
    'За каждую пару 10 очков, а если найдёшь все — ещё бонус за оставшиеся секунды.',
  controls: 'Мышь: кликай по ракушкам.',
  maxScore: () => MEMORY_PAIRS * 10 + MEMORY_TIME,
  bot: (r, k) => {
    const pairs = Math.max(1, Math.min(MEMORY_PAIRS, Math.round(r.gauss(k * 9.2, 1.1))));
    return pairs * 10 + (pairs === MEMORY_PAIRS ? Math.max(0, Math.round(r.gauss((k - 0.5) * 30, 5))) : 0);
  },
});

export const countGame = skill({
  id: 'count',
  name: 'Перепись крабов',
  icon: 'crab',
  duration: COUNT_ROUNDS * (COUNT_ROUND_TIME + 6),
  rules:
    'По пляжу пробегают крабы и проплывают рыбы. Считай только крабов! ' +
    'После каждого забега введи число. Точный ответ — 10 очков, каждая ошибка на одного краба −3. Три забега.',
  controls: 'Смотри внимательно, потом введи число и нажми Enter.',
  maxScore: () => COUNT_ROUNDS * 10,
  bot: (r, k) => {
    let s = 0;
    for (let i = 0; i < COUNT_ROUNDS; i++) s += countRoundScore(Math.round(r.gauss(0, (1 - k) * 3.2 + 0.3)));
    return s;
  },
});

export const simonGame = skill({
  id: 'simon',
  name: 'Барабаны тики',
  icon: 'drum',
  duration: SIMON_TIME,
  rules:
    'Шаман стучит в барабаны. Повтори мелодию! Каждый раз она становится на один удар длиннее. ' +
    'Очки — длина самой длинной правильно повторённой мелодии. Ошибся — игра окончена.',
  controls: 'Мышь или клавиши 1–4.',
  maxScore: () => SIMON_MAX,
  bot: (r, k) => Math.round(r.gauss(3 + k * 7, 1.6)),
});
