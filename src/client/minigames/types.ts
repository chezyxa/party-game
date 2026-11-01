import type { GameState, MinigameInfo } from '../../core/types';

export interface MgEnv {
  me: string | null;
  mg: MinigameInfo;
  state: GameState;
  /** Участвует ли этот клиент. */
  playing: boolean;
  name(pid: string): string;
  char(pid: string): string;
  color(pid: string): string;
}

export interface MgUI {
  root: HTMLElement;
  /** Хост ждёт ответа: respond можно вызвать один раз. */
  ask(data: any, respond: (v: unknown) => void, timeout: number): void;
  /** Публичное обновление (результаты раунда и т. п.). */
  show(data: any): void;
  /** Хост перестал ждать ответ (таймаут). */
  cancel(): void;
  destroy(): void;
}
