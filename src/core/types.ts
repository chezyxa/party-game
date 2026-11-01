import type { ItemId } from './items';
import type { DieFace } from './characters';

export type BotLevel = 'easy' | 'normal' | 'hard';
export type SideColor = 'blue' | 'red' | 'green';
export type Format = 'ffa' | 'team' | '1v' | 'duel';

export interface PlayerStats {
  steps: number;
  mgCoins: number;
  maxCoins: number;
  events: number;
  reds: number;
  spent: number;
}

export interface PlayerState {
  id: string;
  clientId: string | null;
  name: string;
  charId: string;
  isBot: boolean;
  online: boolean;
  coins: number;
  stars: number;
  items: ItemId[];
  node: number;
  color: SideColor;
  stats: PlayerStats;
}

export interface Settings {
  turns: number;
  botLevel: BotLevel;
}

export interface Prompt {
  pid: string;
  kind: AskKind;
  /** Мс до автохода на момент отправки. */
  timeout: number;
}

export interface MinigameInfo {
  id: string;
  format: Format;
  players: string[];
  /** Для командных форматов: два лагеря. Для 1v — solo в a[0]. */
  teams?: { a: string[]; b: string[] };
  stage: 'intro' | 'play' | 'results';
  results?: MinigameResult;
  wager?: number;
}

export interface MinigameResult {
  scores: Record<string, number>;
  coins: Record<string, number>;
  winners: string[];
  text: string;
}

export interface BonusAward {
  id: string;
  name: string;
  desc: string;
  winners: string[];
}

export interface GameState {
  phase: 'board' | 'minigame' | 'final';
  turn: number;
  maxTurns: number;
  order: string[];
  current: string | null;
  players: Record<string, PlayerState>;
  starNode: number;
  starPrice: number;
  bank: number;
  traps: Record<number, string>;
  lastFive: boolean;
  settings: Settings;
  prompt: Prompt | null;
  stepsLeft: number;
  mg: MinigameInfo | null;
  bonus: BonusAward[];
  ranking: string[];
  log: string[];
}

export interface LobbyPlayer {
  pid: string;
  name: string;
  charId: string;
  isBot: boolean;
  online: boolean;
  isHost: boolean;
}

export interface LobbyState {
  code: string;
  players: LobbyPlayer[];
  settings: Settings;
  resuming: boolean;
}

// ---------- События (для анимаций на клиентах) ----------
export type GameEvent =
  | { type: 'sync' }
  | { type: 'banner'; text: string; sub?: string; tone?: 'good' | 'bad' | 'info' | 'star' }
  | { type: 'order'; rolls: Record<string, number> }
  | { type: 'turnStart'; pid: string; turn: number }
  | { type: 'roll'; pid: string; values: number[]; total: number; face?: DieFace; kind: 'normal' | 'char' | 'item' }
  | { type: 'move'; pid: string; path: number[] }
  | { type: 'teleport'; pid: string; node: number }
  | { type: 'swap'; a: string; b: string }
  | { type: 'coins'; pid: string; delta: number }
  | { type: 'stars'; pid: string; delta: number }
  | { type: 'land'; pid: string; node: number; space: string }
  | { type: 'starMove'; node: number }
  | { type: 'item'; pid: string; item: ItemId; target?: string }
  | { type: 'card'; title: string; text: string; icon: string; tone?: 'good' | 'bad' | 'info' }
  | { type: 'trap'; node: number; owner: string | null }
  | { type: 'mg' }
  | { type: 'mgShow'; data: unknown }
  | { type: 'bonus'; award: BonusAward }
  | { type: 'final' };

// ---------- Вопросы игрокам ----------
export type AskKind =
  | 'turn'
  | 'branch'
  | 'buyStar'
  | 'shop'
  | 'thief'
  | 'target'
  | 'duel'
  | 'customDice'
  | 'mgReady'
  | 'mg';

export interface Ask {
  id: number;
  kind: AskKind;
  data: any;
  timeout: number;
}

// ---------- Протокол ----------
export type ClientMsg =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'setChar'; charId: string }
  | { t: 'setName'; name: string }
  | { t: 'answer'; id: number; value: unknown }
  | { t: 'host'; cmd: 'addBot' | 'start' | 'resume' }
  | { t: 'host'; cmd: 'remove'; pid: string }
  | { t: 'host'; cmd: 'settings'; settings: Partial<Settings> }
  | { t: 'host'; cmd: 'botChar'; pid: string; charId: string }
  | { t: 'chat'; text: string };

export type HostMsg =
  | { t: 'welcome'; pid: string; isHost: boolean }
  | { t: 'lobby'; lobby: LobbyState }
  | { t: 'state'; state: GameState }
  | { t: 'ev'; ev: GameEvent; state: GameState; dur: number }
  | { t: 'ask'; ask: Ask }
  | { t: 'cancelAsk'; id: number }
  | { t: 'chat'; pid: string; text: string }
  | { t: 'error'; text: string };
