import { isInt, LEVEL_K, type MgDef } from './types';

const zero = (pids: string[]) => Object.fromEntries(pids.map((p) => [p, 0])) as Record<string, number>;
const think = () => 600 + Math.random() * 1800;

// ------------------------------------------------------------
// Сундуки пирата: выбираешь сундук, совпавшие делят добычу.
// ------------------------------------------------------------
export const chests: MgDef = {
  id: 'chests',
  name: 'Сундуки пирата',
  icon: 'chest',
  kind: 'choice',
  formats: ['ffa', 'team', 'duel'],
  rules:
    'На берегу стоят сундуки с монетами — их цена видна всем. Все одновременно выбирают сундук. ' +
    'Если сундук выбрали несколько игроков, добыча делится поровну. В сундуке «?» может быть 0 или 12. Три раунда.',
  controls: 'Мышь: кликни по сундуку.',
  async run(ctx) {
    const score = zero(ctx.players);
    for (let round = 1; round <= 3; round++) {
      const count = Math.max(3, ctx.players.length + 1);
      const values: (number | null)[] = Array.from({ length: count }, () => ctx.rng.int(1, 9));
      const mystery = ctx.rng.int(0, count - 1);
      values[mystery] = null;
      const hidden = ctx.rng.chance(0.5) ? 12 : 0;
      const real = values.map((v) => (v === null ? hidden : v));
      const picks = await ctx.askAll(ctx.players, () => ({ round, values, score }), {
        timeout: 20000,
        botDelay: think,
        validate: (v) => isInt(v, 0, count - 1),
        bot: () => {
          const k = LEVEL_K[ctx.level];
          const w = values.map((v) => {
            const val = v === null ? 6 : v;
            return k > 0.9 ? val / (1 + val / 4) : Math.pow(val, k * 2);
          });
          let r = ctx.rng.next() * w.reduce((a, b) => a + b, 0);
          for (let i = 0; i < w.length; i++) if ((r -= w[i]) <= 0) return i;
          return 0;
        },
      });
      const gains: Record<string, number> = {};
      for (let i = 0; i < count; i++) {
        const who = ctx.players.filter((p) => picks[p] === i);
        for (const p of who) {
          gains[p] = Math.floor(real[i] / who.length);
          score[p] += gains[p];
        }
      }
      await ctx.show({ stage: 'reveal', round, values: real, picks, gains, score: { ...score } }, 4200);
    }
    return score;
  },
};

// ------------------------------------------------------------
// Аукцион попугая: тайные ставки за лоты.
// ------------------------------------------------------------
export const auction: MgDef = {
  id: 'auction',
  name: 'Аукцион попугая',
  icon: 'parrot',
  kind: 'choice',
  formats: ['ffa', 'duel'],
  rules:
    'У каждого 15 ракушек. Попугай продаёт 4 лота разной ценности. Все тайно делают ставку. ' +
    'Лот забирает самая высокая ставка и платит её. Если лидеры поставили поровну, лот сгорает и никто не платит. ' +
    'Побеждает тот, у кого больше очков за лоты. При равенстве выше тот, у кого осталось больше ракушек.',
  controls: 'Мышь: выбери ставку и нажми «Ставлю».',
  async run(ctx) {
    const budget = Object.fromEntries(ctx.players.map((p) => [p, 15])) as Record<string, number>;
    const pts = zero(ctx.players);
    const lots = Array.from({ length: 4 }, () => ctx.rng.int(2, 9));
    for (let i = 0; i < lots.length; i++) {
      const bids = await ctx.askAll(
        ctx.players,
        (pid) => ({ lot: i, lots, budget: budget[pid], points: pts[pid] }),
        {
          timeout: 25000,
          botDelay: think,
          validate: (v, pid) => isInt(v, 0, budget[pid]),
          bot: (pid) => {
            const rest = lots.slice(i).reduce((a, b) => a + b, 0);
            const base = (budget[pid] * lots[i]) / rest;
            const k = LEVEL_K[ctx.level];
            const bid = Math.round(base * (0.6 + k * 0.6) + ctx.rng.gauss(0, 1.5));
            return Math.max(0, Math.min(budget[pid], bid));
          },
        },
      );
      const max = Math.max(...ctx.players.map((p) => bids[p]));
      const top = ctx.players.filter((p) => bids[p] === max);
      let winner: string | null = null;
      if (max > 0 && top.length === 1) {
        winner = top[0];
        budget[winner] -= max;
        pts[winner] += lots[i];
      }
      await ctx.show({ stage: 'reveal', lot: i, lots, bids, winner, points: { ...pts }, budget: { ...budget } }, 4200);
    }
    const score: Record<string, number> = {};
    for (const p of ctx.players) score[p] = pts[p] * 100 + budget[p];
    return score;
  },
};

// ------------------------------------------------------------
// Сокровища вулкана: копать дальше или уйти с добычей.
// ------------------------------------------------------------
const ERUPT = [0, 0.1, 0.16, 0.22, 0.3, 0.4, 0.5, 0.62];
export const volcano: MgDef = {
  id: 'volcano',
  name: 'Сокровища вулкана',
  icon: 'volcano',
  kind: 'choice',
  formats: ['ffa', 'team', 'duel'],
  rules:
    'Каждый раунд все одновременно решают: копать дальше или уйти с добычей. Ушедшие сохраняют свои самоцветы. ' +
    'Оставшиеся получают новые самоцветы, но с каждым раундом растёт шанс извержения. ' +
    'Если вулкан взорвётся, все, кто ещё копает, теряют несохранённую добычу. Максимум 8 раундов.',
  controls: 'Мышь: «Копать» или «Уйти».',
  async run(ctx) {
    const banked = zero(ctx.players);
    const bag = zero(ctx.players);
    let inside = [...ctx.players];
    for (let round = 0; round < ERUPT.length && inside.length; round++) {
      const risk = ERUPT[round];
      const choice = await ctx.askAll(inside, (pid) => ({ round: round + 1, risk, bag: bag[pid], banked: banked[pid] }), {
        timeout: 20000,
        botDelay: think,
        validate: (v) => (v === 'dig' || v === 'leave' ? v : undefined),
        bot: (pid) => {
          const b = bag[pid];
          if (ctx.level === 'easy') return ctx.rng.chance(0.25 + risk) ? 'leave' : 'dig';
          if (ctx.level === 'normal') return b >= 12 && ctx.rng.chance(0.4 + risk) ? 'leave' : 'dig';
          return risk * b > (1 - risk) * 5 ? 'leave' : 'dig';
        },
      });
      const leavers = inside.filter((p) => choice[p] === 'leave');
      for (const p of leavers) {
        banked[p] += bag[p];
        bag[p] = 0;
      }
      inside = inside.filter((p) => choice[p] === 'dig');
      let erupted = false;
      let gem = 0;
      if (inside.length) {
        erupted = ctx.rng.chance(risk);
        if (erupted) {
          for (const p of inside) bag[p] = 0;
        } else {
          gem = ctx.rng.int(2, 8);
          for (const p of inside) bag[p] += gem;
        }
      }
      await ctx.show(
        { stage: 'reveal', round: round + 1, leavers, diggers: [...inside], erupted, gem, bag: { ...bag }, banked: { ...banked } },
        3600,
      );
      if (erupted) inside = [];
    }
    for (const p of inside) banked[p] += bag[p];
    return banked;
  },
};

// ------------------------------------------------------------
// Ракушки на песке: число очков засчитывается, только если уникально.
// ------------------------------------------------------------
export const unique: MgDef = {
  id: 'unique',
  name: 'Ракушки на песке',
  icon: 'shell',
  kind: 'choice',
  formats: ['ffa', 'duel'],
  rules:
    'Каждый раунд все тайно выкладывают от 1 до 5 ракушек. ' +
    'Если твоё число никто больше не выбрал, получаешь столько очков, сколько выложил. При совпадении — ноль. 4 раунда.',
  controls: 'Мышь: выбери число от 1 до 5.',
  async run(ctx) {
    const score = zero(ctx.players);
    for (let round = 1; round <= 4; round++) {
      const picks = await ctx.askAll(ctx.players, () => ({ round, score }), {
        timeout: 15000,
        botDelay: think,
        validate: (v) => isInt(v, 1, 5),
        bot: () => {
          const w = ctx.level === 'easy' ? [1, 1, 1, 1, 1] : [0.5, 0.8, 1.1, 1.3, 1.4];
          let r = ctx.rng.next() * w.reduce((a, b) => a + b, 0);
          for (let i = 0; i < 5; i++) if ((r -= w[i]) <= 0) return i + 1;
          return 5;
        },
      });
      const gains: Record<string, number> = {};
      for (const p of ctx.players) {
        const same = ctx.players.filter((q) => picks[q] === picks[p]).length;
        gains[p] = same === 1 ? picks[p] : 0;
        score[p] += gains[p];
      }
      await ctx.show({ stage: 'reveal', round, picks, gains, score: { ...score } }, 3800);
    }
    return score;
  },
};

// ------------------------------------------------------------
// Прятки в джунглях (1 против всех).
// ------------------------------------------------------------
export const hide: MgDef = {
  id: 'hide',
  name: 'Прятки в джунглях',
  icon: 'bush',
  kind: 'choice',
  formats: ['1v'],
  rules:
    'Одиночка прячется в одном из кустов, команда ищет — каждый проверяет один куст. ' +
    'Два раунда, перед вторым одиночка может перепрятаться. Нашли хоть раз — побеждает команда, иначе одиночка.',
  controls: 'Мышь: кликни по кусту.',
  async run(ctx) {
    const solo = ctx.teams!.a[0];
    const team = ctx.teams!.b;
    const bushes = team.length * 3 + 2;
    let found = false;
    for (let round = 1; round <= 2 && !found; round++) {
      const picks = await ctx.askAll(
        ctx.players,
        (pid) => ({ round, bushes, role: pid === solo ? 'hide' : 'seek' }),
        {
          timeout: 20000,
          botDelay: think,
          validate: (v) => isInt(v, 0, bushes - 1),
          bot: () => ctx.rng.int(0, bushes - 1),
        },
      );
      found = team.some((p) => picks[p] === picks[solo]);
      await ctx.show({ stage: 'reveal', round, bushes, picks, solo, found }, 4200);
    }
    const score: Record<string, number> = {};
    score[solo] = found ? 0 : 1;
    for (const p of team) score[p] = found ? 1 : 0;
    return score;
  },
};
