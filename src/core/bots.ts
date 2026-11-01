import { stepsTo, type Board } from './board';
import { CHAR_BY_ID } from './characters';
import { MAX_ITEMS, type ItemId } from './items';
import type { Rng } from './rng';
import type { BotLevel, GameState } from './types';

/** Решения ботов (и автоход за отошедших игроков). */
export class BotBrain {
  constructor(
    private board: Board,
    private rng: Rng,
  ) {}

  private smart(level: BotLevel): number {
    return level === 'easy' ? 0.35 : level === 'normal' ? 0.7 : 0.95;
  }

  turn(s: GameState, pid: string, data: { items: ItemId[]; usable: boolean[]; usedItem: boolean }, level: BotLevel) {
    const me = s.players[pid];
    const dist = stepsTo(this.board, me.node, s.starNode);
    const smart = this.rng.chance(this.smart(level));
    if (!data.usedItem && smart) {
      const has = (id: ItemId) => data.items.findIndex((it, i) => it === id && data.usable[i]);
      if (me.coins >= s.starPrice && has('shell') >= 0 && dist > 6) return { item: has('shell') };
      if (has('custom') >= 0 && dist >= 1 && dist <= 10 && me.coins >= s.starPrice) return { item: has('custom') };
      if (has('paw') >= 0) return { item: has('paw') };
      if (has('triple') >= 0 && dist > 12) return { item: has('triple') };
      if (has('double') >= 0 && dist > 8) return { item: has('double') };
      if (has('trap') >= 0 && this.rng.chance(0.5)) return { item: has('trap') };
    }
    const ch = CHAR_BY_ID[me.charId];
    // Свой кубик: если он может точно довести до звезды.
    if (smart && me.coins >= s.starPrice && ch.dice.some((f) => f.move === dist)) return { roll: 'char' };
    if (smart && ch.dice.some((f) => (f.coins ?? 0) > 0) && me.coins < 10 && this.rng.chance(0.4)) return { roll: 'char' };
    return { roll: this.rng.chance(0.85) ? 'normal' : 'char' };
  }

  branch(s: GameState, pid: string, options: number[], level: BotLevel): number {
    if (!this.rng.chance(this.smart(level))) return this.rng.int(0, options.length - 1);
    const me = s.players[pid];
    const wantStar = me.coins >= s.starPrice - 5;
    let best = 0;
    let bestScore = -Infinity;
    options.forEach((node, i) => {
      const d = stepsTo(this.board, node, s.starNode);
      let score = wantStar ? -d : -d * 0.3;
      const route = this.board.nodes[node].route;
      if (route === 'pier') score += 2;
      if (route === 'volcano' || route === 'jungle') score -= me.coins > 20 ? 2 : 0;
      score += this.rng.next() * 1.5;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return best;
  }

  shop(s: GameState, pid: string, offer: { id: ItemId; price: number }[], level: BotLevel): ItemId | null {
    const me = s.players[pid];
    if (me.items.length >= MAX_ITEMS) return null;
    const reserve = me.coins >= s.starPrice + 8 ? s.starPrice : 0;
    const prefs: ItemId[] = ['shell', 'custom', 'double', 'paw', 'triple', 'swap', 'trap'];
    const affordable = offer.filter((o) => o.price <= me.coins - reserve);
    if (!affordable.length) return null;
    if (!this.rng.chance(this.smart(level))) return this.rng.chance(0.5) ? this.rng.pick(affordable).id : null;
    for (const p of prefs) if (affordable.some((o) => o.id === p)) return p;
    return null;
  }

  thief(s: GameState, pid: string, data: { starCost: number; coinCost: number }): { mode: 'coins' | 'star'; target: string } | null {
    const me = s.players[pid];
    const others = s.order.filter((p) => p !== pid);
    const starTarget = others.filter((p) => s.players[p].stars > 0).sort((a, b) => s.players[b].stars - s.players[a].stars)[0];
    if (starTarget && me.coins >= data.starCost + 5) return { mode: 'star', target: starTarget };
    const rich = [...others].sort((a, b) => s.players[b].coins - s.players[a].coins)[0];
    if (rich && s.players[rich].coins >= 15 && me.coins >= data.coinCost && me.coins < s.starPrice) return { mode: 'coins', target: rich };
    return null;
  }

  target(s: GameState, pid: string, options: string[], reason: string): string {
    const rank = (p: string) => s.players[p].stars * 1000 + s.players[p].coins;
    if (reason === 'swap') {
      // Меняемся с тем, кто ближе всех к звезде.
      return [...options].sort((a, b) => stepsTo(this.board, s.players[a].node, s.starNode) - stepsTo(this.board, s.players[b].node, s.starNode))[0];
    }
    if (reason === 'paw' || reason === 'duel') return [...options].sort((a, b) => s.players[b].coins - s.players[a].coins)[0];
    return [...options].sort((a, b) => rank(b) - rank(a))[0];
  }

  customDice(s: GameState, pid: string): number {
    const d = stepsTo(this.board, s.players[pid].node, s.starNode);
    return d >= 1 && d <= 10 ? d : 10;
  }

  buyStar(s: GameState, pid: string): boolean {
    return s.players[pid].coins >= s.starPrice;
  }

  wager(options: number[]): number {
    return options[Math.min(options.length - 1, this.rng.int(0, 1))];
  }
}

