import type { Format, MinigameResult } from '../types';
import type { Rng } from '../rng';
import type { MgDef } from './types';
import { auction, chests, hide, unique, volcano } from './choice';
import { catchGame, countGame, memoryGame, simonGame, timingGame } from './skill';

export const MINIGAMES: MgDef[] = [chests, auction, volcano, unique, hide, catchGame, timingGame, memoryGame, countGame, simonGame];
export const MG_BY_ID: Record<string, MgDef> = Object.fromEntries(MINIGAMES.map((m) => [m.id, m]));

export const FORMAT_NAMES: Record<Format, string> = {
  ffa: 'Каждый сам за себя',
  team: 'Команда на команду',
  '1v': 'Один против всех',
  duel: 'Дуэль',
};

export function pickMinigame(rng: Rng, format: Format, recent: string[]): MgDef {
  const all = MINIGAMES.filter((m) => m.formats.includes(format));
  const fresh = all.filter((m) => !recent.includes(m.id));
  return rng.pick(fresh.length ? fresh : all);
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/** Превращает очки мини-игры в монеты с учётом формата. */
export function award(
  format: Format,
  players: string[],
  teams: { a: string[]; b: string[] } | undefined,
  scores: Record<string, number>,
  names: Record<string, string>,
): MinigameResult {
  const coins: Record<string, number> = Object.fromEntries(players.map((p) => [p, 0]));
  let winners: string[] = [];
  let text = '';

  if (format === 'ffa' || format === 'duel') {
    const sorted = [...new Set(players.map((p) => scores[p]))].sort((a, b) => b - a);
    const prizes = format === 'duel' ? [0] : players.length === 2 ? [10, 0] : players.length === 3 ? [10, 4, 0] : [10, 5, 2];
    let place = 0;
    for (const s of sorted) {
      const group = players.filter((p) => scores[p] === s);
      for (const p of group) coins[p] = prizes[place] ?? 0;
      if (place === 0) winners = group;
      place += group.length;
    }
    if (players.every((p) => scores[p] === scores[players[0]])) {
      winners = [];
      text = 'Ничья!';
      if (format !== 'duel') for (const p of players) coins[p] = 3;
    } else {
      text = winners.length > 1 ? `Победители: ${winners.map((w) => names[w]).join(', ')}` : `Победил(а) ${names[winners[0]]}!`;
    }
  } else {
    const a = teams!.a;
    const b = teams!.b;
    const sa = avg(a.map((p) => scores[p]));
    const sb = avg(b.map((p) => scores[p]));
    if (sa === sb) {
      for (const p of players) coins[p] = 3;
      text = 'Ничья!';
    } else {
      winners = sa > sb ? a : b;
      const prize = format === '1v' ? (winners.length === 1 ? 15 : 6) : 10;
      for (const p of winners) coins[p] = prize;
      text =
        format === '1v'
          ? winners.length === 1
            ? `${names[winners[0]]} одолел(а) всех!`
            : 'Команда победила одиночку!'
          : `Победила команда: ${winners.map((w) => names[w]).join(', ')}`;
    }
  }
  return { scores, coins, winners, text };
}
