import type { Rng } from '../rng';
import type { BotLevel, Format } from '../types';

export interface MgCtx {
  rng: Rng;
  players: string[];
  format: Format;
  teams?: { a: string[]; b: string[] };
  level: BotLevel;
  /** Спросить нескольких игроков одновременно. */
  askAll<T>(
    pids: string[],
    data: (pid: string) => unknown,
    opts: {
      timeout: number;
      bot: (pid: string) => T;
      validate: (v: unknown, pid: string) => T | undefined;
      botDelay?: () => number;
      onAnswer?: (pid: string, v: T) => void;
    },
  ): Promise<Record<string, T>>;
  /** Показать всем обновление мини-игры и подождать dur мс. */
  show(data: unknown, dur: number): Promise<void>;
}

export interface MgDef {
  id: string;
  name: string;
  icon: string;
  rules: string;
  controls: string;
  kind: 'choice' | 'skill';
  formats: Format[];
  /** Больше очков — лучше. */
  run(ctx: MgCtx): Promise<Record<string, number>>;
}

export const LEVEL_K: Record<BotLevel, number> = { easy: 0.55, normal: 0.75, hard: 0.92 };

export const isInt = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : undefined;

export const clampNum = (v: unknown, min: number, max: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : undefined;
