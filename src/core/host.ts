/**
 * Хост — единственный источник правды. Ведёт лобби и всю партию,
 * рассылает клиентам события и снимки состояния, задаёт вопросы игрокам.
 * Не зависит от DOM, поэтому может работать и в node (симуляция).
 */
import { ISLAND, type Board, type BoardNode } from './board';
import { BotBrain } from './bots';
import { CHARACTERS, CHAR_BY_ID } from './characters';
import type { Conn } from './conn';
import { ITEMS, ITEM_IDS, MAX_ITEMS, type ItemId } from './items';
import { award, FORMAT_NAMES, MG_BY_ID, pickMinigame } from './minigames';
import type { MgCtx, MgDef } from './minigames/types';
import { Rng, randomSeed } from './rng';
import type {
  AskKind,
  BonusAward,
  ClientMsg,
  Format,
  GameEvent,
  GameState,
  HostMsg,
  LobbyState,
  PlayerState,
  Settings,
} from './types';

export interface SaveData {
  version: 1;
  code: string;
  state: GameState;
  recentMg: string[];
}

export interface HostOptions {
  code: string;
  /** Множитель задержек (0 — мгновенно, для симуляции). */
  speed?: number;
  seed?: number;
  save?: SaveData;
  onSave?: (save: SaveData | null) => void;
  onLog?: (text: string) => void;
}

interface ConnInfo {
  conn: Conn;
  pid: string | null;
  clientId: string | null;
  isHost: boolean;
}

interface LobbyEntry {
  pid: string;
  clientId: string | null;
  name: string;
  charId: string;
  isBot: boolean;
  isHost: boolean;
}

interface Pending {
  id: number;
  pid: string;
  kind: AskKind;
  data: unknown;
  started: number;
  timeout: number;
  done: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (v: unknown) => void;
  bot: () => unknown;
  validate: (v: unknown) => unknown;
}

const BOT_NAMES = ['Бот Бодя', 'Бот Луна', 'Бот Пиксель', 'Бот Кокос', 'Бот Ириска', 'Бот Шторм'];

export class GameHost {
  readonly code: string;
  readonly board: Board = ISLAND;
  private conns = new Set<ConnInfo>();
  private lobby: LobbyEntry[] = [];
  private settings: Settings = { turns: 15, botLevel: 'normal' };
  state: GameState | null = null;
  private started = false;
  private finished = false;
  private rng: Rng;
  private brain: BotBrain;
  private speed: number;
  private pending = new Map<number, Pending>();
  private askSeq = 1;
  private pidSeq = 1;
  private recentMg: string[] = [];
  private starTouched = -1;

  constructor(private opts: HostOptions) {
    this.code = opts.code;
    this.speed = opts.speed ?? 1;
    this.rng = new Rng(opts.seed ?? randomSeed());
    this.brain = new BotBrain(this.board, this.rng);
    if (opts.save) {
      this.state = opts.save.state;
      this.recentMg = opts.save.recentMg;
      this.settings = this.state.settings;
      for (const p of Object.values(this.state.players)) {
        p.online = p.isBot;
        this.pidSeq = Math.max(this.pidSeq, Number(p.id.slice(1)) + 1);
      }
      this.state.prompt = null;
      this.state.mg = null;
      this.state.phase = 'board';
    }
  }

  // ================= Соединения и лобби =================

  addConn(conn: Conn, isHost = false): void {
    const info: ConnInfo = { conn, pid: null, clientId: null, isHost };
    this.conns.add(info);
    conn.onMessage((m) => {
      try {
        this.onMessage(info, m as ClientMsg);
      } catch (e) {
        console.error('host: bad message', e);
      }
    });
    conn.onClose(() => this.onClose(info));
  }

  private send(info: ConnInfo, msg: HostMsg) {
    info.conn.send(msg);
  }

  private broadcast(msg: HostMsg) {
    for (const c of this.conns) if (c.clientId) c.conn.send(msg);
  }

  private sendTo(pid: string, msg: HostMsg) {
    for (const c of this.conns) if (c.pid === pid) c.conn.send(msg);
  }

  private isConnected(pid: string) {
    for (const c of this.conns) if (c.pid === pid) return true;
    return false;
  }

  private onMessage(info: ConnInfo, msg: ClientMsg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') return this.onHello(info, msg.clientId, msg.name);
    if (!info.clientId) return;
    switch (msg.t) {
      case 'setChar': {
        const me = this.lobby.find((l) => l.pid === info.pid);
        if (!me || this.state) return;
        if (CHAR_BY_ID[msg.charId] && !this.lobby.some((l) => l.charId === msg.charId)) me.charId = msg.charId;
        this.broadcastLobby();
        return;
      }
      case 'setName': {
        const me = this.lobby.find((l) => l.pid === info.pid);
        if (!me || this.state) return;
        me.name = cleanName(msg.name) || me.name;
        this.broadcastLobby();
        return;
      }
      case 'answer': {
        const p = this.pending.get(msg.id);
        if (!p || p.done || p.pid !== info.pid) return;
        const v = p.validate(msg.value);
        if (v !== undefined) p.resolve(v);
        return;
      }
      case 'chat': {
        if (!info.pid) return;
        const text = String(msg.text ?? '').slice(0, 120).trim();
        if (text) this.broadcast({ t: 'chat', pid: info.pid, text });
        return;
      }
      case 'host':
        if (info.isHost) this.onHostCmd(msg);
        return;
    }
  }

  private onHello(info: ConnInfo, clientId: string, name: string) {
    info.clientId = String(clientId).slice(0, 64);
    if (this.state) {
      const p = Object.values(this.state.players).find((x) => x.clientId === info.clientId);
      info.pid = p ? p.id : null;
      this.send(info, { t: 'welcome', pid: info.pid ?? '', isHost: info.isHost });
      if (p) {
        p.online = true;
        if (!this.started) {
          this.broadcastLobby();
          return;
        }
        this.send(info, { t: 'state', state: this.state });
        // Повторно отправляем незакрытые вопросы.
        for (const pend of this.pending.values()) {
          if (pend.pid !== p.id || pend.done) continue;
          const left = Math.max(3000, pend.timeout - (Date.now() - pend.started));
          if (pend.timer) clearTimeout(pend.timer);
          pend.timer = setTimeout(() => pend.resolve(pend.bot()), left * this.speedAsk());
          this.send(info, { t: 'ask', ask: { id: pend.id, kind: pend.kind, data: pend.data, timeout: left } });
        }
        this.log(`${p.name} вернулся(-ась) в игру`);
        this.emitNow({ type: 'sync' });
      } else {
        if (!this.started) this.send(info, { t: 'lobby', lobby: this.lobbyState() });
        else this.send(info, { t: 'state', state: this.state });
      }
      return;
    }
    let me = this.lobby.find((l) => l.clientId === info.clientId);
    if (!me) {
      if (this.lobby.length >= 6) {
        this.send(info, { t: 'error', text: 'Комната заполнена (максимум 6 игроков).' });
        return;
      }
      me = {
        pid: 'p' + this.pidSeq++,
        clientId: info.clientId,
        name: cleanName(name) || 'Игрок',
        charId: this.freeChar(),
        isBot: false,
        isHost: info.isHost,
      };
      this.lobby.push(me);
    }
    info.pid = me.pid;
    this.send(info, { t: 'welcome', pid: me.pid, isHost: info.isHost });
    this.broadcastLobby();
  }

  private onClose(info: ConnInfo) {
    this.conns.delete(info);
    const pid = info.pid;
    if (!pid || this.isConnected(pid)) return;
    if (!this.state) {
      this.lobby = this.lobby.filter((l) => l.pid !== pid);
      this.broadcastLobby();
      return;
    }
    const p = this.state.players[pid];
    if (!p) return;
    p.online = false;
    if (!this.started) {
      this.broadcastLobby();
      return;
    }
    this.log(`${p.name} отключился(-ась) — за него(неё) походит бот`);
    for (const pend of this.pending.values()) {
      if (pend.pid !== pid || pend.done) continue;
      if (pend.timer) clearTimeout(pend.timer);
      pend.timer = setTimeout(() => pend.resolve(pend.bot()), 1500 * this.speed);
    }
    this.emitNow({ type: 'sync' });
  }

  private onHostCmd(msg: Extract<ClientMsg, { t: 'host' }>) {
    if (msg.cmd === 'resume') {
      if (this.state && !this.started) {
        this.started = true;
        void this.runLoop();
      }
      return;
    }
    if (this.state) return;
    switch (msg.cmd) {
      case 'addBot': {
        if (this.lobby.length >= 6) return;
        const used = new Set(this.lobby.map((l) => l.name));
        this.lobby.push({
          pid: 'p' + this.pidSeq++,
          clientId: null,
          name: BOT_NAMES.find((n) => !used.has(n)) ?? 'Бот',
          charId: this.freeChar(),
          isBot: true,
          isHost: false,
        });
        break;
      }
      case 'remove': {
        const target = this.lobby.find((l) => l.pid === msg.pid);
        if (!target || target.isHost) return;
        this.lobby = this.lobby.filter((l) => l !== target);
        for (const c of this.conns) {
          if (c.pid === target.pid) {
            this.send(c, { t: 'error', text: 'Хост удалил вас из комнаты.' });
            c.pid = null;
            c.clientId = null;
          }
        }
        break;
      }
      case 'settings': {
        const s = msg.settings;
        if (s.turns && [5, 10, 15, 20, 25].includes(s.turns)) this.settings.turns = s.turns;
        if (s.botLevel && ['easy', 'normal', 'hard'].includes(s.botLevel)) this.settings.botLevel = s.botLevel;
        break;
      }
      case 'botChar': {
        const bot = this.lobby.find((l) => l.pid === msg.pid && l.isBot);
        if (bot && CHAR_BY_ID[msg.charId] && !this.lobby.some((l) => l.charId === msg.charId)) bot.charId = msg.charId;
        break;
      }
      case 'start': {
        if (this.lobby.length < 2) {
          this.broadcast({ t: 'error', text: 'Нужно минимум 2 участника (можно добавить ботов).' });
          return;
        }
        this.startGame();
        return;
      }
    }
    this.broadcastLobby();
  }

  private freeChar(): string {
    const used = new Set(this.lobby.map((l) => l.charId));
    return CHARACTERS.find((c) => !used.has(c.id))?.id ?? CHARACTERS[0].id;
  }

  lobbyState(): LobbyState {
    if (this.state) {
      return {
        code: this.code,
        resuming: true,
        settings: this.settings,
        players: this.state.order.map((pid) => {
          const p = this.state!.players[pid];
          return { pid, name: p.name, charId: p.charId, isBot: p.isBot, online: p.isBot || this.isConnected(pid), isHost: false };
        }),
      };
    }
    return {
      code: this.code,
      resuming: false,
      settings: this.settings,
      players: this.lobby.map((l) => ({
        pid: l.pid,
        name: l.name,
        charId: l.charId,
        isBot: l.isBot,
        online: l.isBot || this.isConnected(l.pid),
        isHost: l.isHost,
      })),
    };
  }

  private broadcastLobby() {
    this.broadcast({ t: 'lobby', lobby: this.lobbyState() });
  }

  // ================= Утилиты партии =================

  private speedAsk() {
    return this.speed === 0 ? 0 : 1;
  }

  private sleep(ms: number) {
    return new Promise<void>((r) => setTimeout(r, ms * this.speed));
  }

  private emitNow(ev: GameEvent, dur = 0) {
    if (!this.state) return;
    this.broadcast({ t: 'ev', ev, state: this.state, dur });
  }

  private async emit(ev: GameEvent, dur = 0) {
    this.emitNow(ev, dur);
    if (dur) await this.sleep(dur);
  }

  private log(text: string) {
    if (!this.state) return;
    this.state.log.push(text);
    if (this.state.log.length > 40) this.state.log.shift();
    this.opts.onLog?.(text);
  }

  private P(pid: string): PlayerState {
    return this.state!.players[pid];
  }

  private name(pid: string) {
    return this.P(pid).name;
  }

  private names(): Record<string, string> {
    return Object.fromEntries(Object.values(this.state!.players).map((p) => [p.id, p.name]));
  }

  private ask<T>(
    pid: string,
    kind: AskKind,
    data: unknown,
    o: { timeout: number; bot: () => T; validate: (v: unknown) => T | undefined; botDelay?: number; prompt?: boolean },
  ): Promise<T> {
    return new Promise<T>((resolve) => {
      const s = this.state!;
      const p = s.players[pid];
      const id = this.askSeq++;
      const showPrompt = o.prompt !== false;
      const pend: Pending = {
        id,
        pid,
        kind,
        data,
        started: Date.now(),
        timeout: o.timeout,
        done: false,
        timer: null,
        bot: o.bot,
        validate: o.validate as (v: unknown) => unknown,
        resolve: (v) => {
          if (pend.done) return;
          pend.done = true;
          if (pend.timer) clearTimeout(pend.timer);
          this.pending.delete(id);
          if (!p.isBot) this.sendTo(pid, { t: 'cancelAsk', id });
          if (showPrompt && s.prompt?.pid === pid) s.prompt = null;
          resolve(v as T);
        },
      };
      this.pending.set(id, pend);
      if (showPrompt) {
        s.prompt = { pid, kind, timeout: p.isBot || !p.online ? 0 : o.timeout };
        this.emitNow({ type: 'sync' });
      }
      if (p.isBot || !p.online) {
        const delay = o.botDelay ?? 500 + Math.random() * 900;
        pend.timer = setTimeout(() => pend.resolve(o.bot()), delay * this.speed);
      } else {
        pend.timer = setTimeout(() => pend.resolve(o.bot()), o.timeout * this.speedAsk());
        this.sendTo(pid, { t: 'ask', ask: { id, kind, data, timeout: o.timeout } });
      }
    });
  }

  private async addCoins(pid: string, delta: number, show = true, dur = 900): Promise<number> {
    const p = this.P(pid);
    const actual = Math.max(-p.coins, delta);
    p.coins += actual;
    p.stats.maxCoins = Math.max(p.stats.maxCoins, p.coins);
    if (show && actual !== 0) await this.emit({ type: 'coins', pid, delta: actual }, dur);
    return actual;
  }

  private async card(title: string, text: string, icon: string, tone: 'good' | 'bad' | 'info' = 'info', dur = 2600) {
    this.log(`${title}: ${text}`);
    await this.emit({ type: 'card', title, text, icon, tone }, dur);
  }

  // ================= Ход партии =================

  private startGame() {
    const players: Record<string, PlayerState> = {};
    for (const l of this.lobby) {
      players[l.pid] = {
        id: l.pid,
        clientId: l.clientId,
        name: l.name,
        charId: l.charId,
        isBot: l.isBot,
        online: l.isBot || this.isConnected(l.pid),
        coins: 10,
        stars: 0,
        items: [],
        node: this.board.start,
        color: 'blue',
        stats: { steps: 0, mgCoins: 0, maxCoins: 10, events: 0, reds: 0, spent: 0 },
      };
    }
    this.state = {
      phase: 'board',
      turn: 1,
      maxTurns: this.settings.turns,
      order: this.lobby.map((l) => l.pid),
      current: null,
      players,
      starNode: -1,
      starPrice: 20,
      bank: 0,
      traps: {},
      lastFive: false,
      settings: { ...this.settings },
      prompt: null,
      stepsLeft: 0,
      mg: null,
      bonus: [],
      ranking: [],
      log: [],
    };
    this.started = true;
    void this.runIntro().then(() => this.runLoop());
  }

  private async runIntro() {
    const s = this.state!;
    this.broadcast({ t: 'state', state: s });
    await this.sleep(400);
    await this.emit({ type: 'banner', text: 'Добро пожаловать на Остров Тики!', sub: `${s.maxTurns} ходов. Собери больше всех звёзд!`, tone: 'info' }, 3000);
    // Порядок ходов: каждый «бросает» кубик, значения не повторяются.
    const vals = this.rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const rolls: Record<string, number> = {};
    s.order.forEach((pid, i) => (rolls[pid] = vals[i]));
    s.order.sort((a, b) => rolls[b] - rolls[a]);
    await this.emit({ type: 'order', rolls }, 4200);
    this.log(`Порядок ходов: ${s.order.map((p) => this.name(p)).join(' → ')}`);
    await this.moveStar(true);
  }

  private async runLoop() {
    const s = this.state!;
    if (s.starNode < 0) await this.moveStar(true);
    while (s.turn <= s.maxTurns) {
      this.save();
      await this.roundStart();
      for (const pid of s.order) await this.playerTurn(pid);
      s.current = null;
      await this.minigameRound();
      s.turn++;
    }
    await this.finale();
  }

  private save() {
    if (!this.opts.onSave || !this.state) return;
    this.opts.onSave({ version: 1, code: this.code, state: JSON.parse(JSON.stringify(this.state)), recentMg: [...this.recentMg] });
  }

  private async roundStart() {
    const s = this.state!;
    s.current = null;
    await this.emit({ type: 'banner', text: `Ход ${s.turn} из ${s.maxTurns}`, tone: 'info' }, 1700);
    if (s.maxTurns >= 10 && s.turn === s.maxTurns - 4 && !s.lastFive) {
      s.lastFive = true;
      await this.emit(
        { type: 'banner', text: 'Последние 5 ходов!', sub: 'Синие и красные клетки теперь дают и отнимают по 6 монет', tone: 'star' },
        3200,
      );
      const last = this.ranking().at(-1)!;
      await this.card('Помощь отстающему', `${this.name(last)} на последнем месте и получает 10 монет!`, 'coin', 'good');
      await this.addCoins(last, 10);
    }
  }

  ranking(): string[] {
    const s = this.state!;
    return [...s.order].sort((a, b) => s.players[b].stars - s.players[a].stars || s.players[b].coins - s.players[a].coins);
  }

  private itemUsable(pid: string, id: ItemId): boolean {
    const s = this.state!;
    const p = s.players[pid];
    switch (id) {
      case 'trap':
        return s.traps[p.node] === undefined && p.node !== s.starNode;
      case 'shell':
        return s.starNode >= 0 && p.node !== s.starNode;
      case 'swap':
      case 'paw':
        return s.order.length > 1;
      default:
        return true;
    }
  }

  private async playerTurn(pid: string) {
    const s = this.state!;
    const p = this.P(pid);
    s.current = pid;
    this.starTouched = -1;
    await this.emit({ type: 'turnStart', pid, turn: s.turn }, 1300);
    let usedItem = false;
    let total: number | null = null;
    while (total === null) {
      const usable = p.items.map((id) => !usedItem && this.itemUsable(pid, id));
      type TurnAns = { roll: 'normal' | 'char' } | { item: number };
      const ans = await this.ask<TurnAns>(
        pid,
        'turn',
        { items: [...p.items], usable, usedItem },
        {
          timeout: 60000,
          bot: () => this.brain.turn(s, pid, { items: p.items, usable, usedItem }, s.settings.botLevel) as TurnAns,
          validate: (v: any) => {
            if (v && (v.roll === 'normal' || v.roll === 'char')) return { roll: v.roll };
            if (v && Number.isInteger(v.item) && usable[v.item]) return { item: v.item };
            return undefined;
          },
          botDelay: 900,
        },
      );
      if ('item' in ans) {
        const id = p.items.splice(ans.item, 1)[0];
        usedItem = true;
        this.log(`${p.name} использует «${ITEMS[id].name}»`);
        await this.emit({ type: 'item', pid, item: id }, 1500);
        total = await this.useItem(pid, id);
      } else {
        total = await this.roll(pid, ans.roll);
      }
    }
    await this.move(pid, total);
    s.stepsLeft = 0;
  }

  private async roll(pid: string, kind: 'normal' | 'char'): Promise<number> {
    const p = this.P(pid);
    if (kind === 'normal') {
      const v = this.rng.int(1, 10);
      await this.emit({ type: 'roll', pid, values: [v], total: v, kind }, 1700);
      return v;
    }
    const face = this.rng.pick(CHAR_BY_ID[p.charId].dice);
    await this.emit({ type: 'roll', pid, values: [face.move], total: face.move, face, kind }, 1700);
    if (face.coins) await this.addCoins(pid, face.coins);
    return face.move;
  }

  private others(pid: string) {
    return this.state!.order.filter((p) => p !== pid);
  }

  private chooseTarget(pid: string, reason: string, options: string[]) {
    const s = this.state!;
    return this.ask<string>(pid, 'target', { reason, options }, {
      timeout: 30000,
      bot: () => this.brain.target(s, pid, options, reason),
      validate: (v) => (typeof v === 'string' && options.includes(v) ? v : undefined),
    });
  }

  private async useItem(pid: string, id: ItemId): Promise<number | null> {
    const s = this.state!;
    const p = this.P(pid);
    switch (id) {
      case 'double':
      case 'triple': {
        const values = Array.from({ length: id === 'double' ? 2 : 3 }, () => this.rng.int(1, 10));
        const total = values.reduce((a, b) => a + b, 0);
        await this.emit({ type: 'roll', pid, values, total, kind: 'item' }, 2000);
        return total;
      }
      case 'custom': {
        const v = await this.ask<number>(pid, 'customDice', {}, {
          timeout: 30000,
          bot: () => this.brain.customDice(s, pid),
          validate: (x) => (Number.isInteger(x) && (x as number) >= 1 && (x as number) <= 10 ? (x as number) : undefined),
        });
        await this.emit({ type: 'roll', pid, values: [v], total: v, kind: 'item' }, 1300);
        return v;
      }
      case 'shell': {
        p.node = s.starNode;
        await this.emit({ type: 'teleport', pid, node: s.starNode }, 1600);
        await this.offerStar(pid);
        return null;
      }
      case 'swap': {
        const t = await this.chooseTarget(pid, 'swap', this.others(pid));
        const q = this.P(t);
        [p.node, q.node] = [q.node, p.node];
        this.log(`${p.name} меняется местами с ${q.name}`);
        await this.emit({ type: 'swap', a: pid, b: t }, 1900);
        return null;
      }
      case 'paw': {
        const t = await this.chooseTarget(pid, 'paw', this.others(pid));
        const amount = Math.min(this.P(t).coins, this.rng.int(5, 15));
        if (amount === 0) {
          await this.card('Лапа воришки', `У ${this.name(t)} нечего красть!`, 'paw', 'info', 1800);
          return null;
        }
        await this.addCoins(t, -amount);
        await this.addCoins(pid, amount);
        this.log(`${p.name} крадёт ${amount} монет у ${this.name(t)}`);
        return null;
      }
      case 'trap': {
        s.traps[p.node] = pid;
        await this.emit({ type: 'trap', node: p.node, owner: pid }, 1200);
        return null;
      }
    }
  }

  private async move(pid: string, total: number) {
    const s = this.state!;
    const p = this.P(pid);
    let left = total;
    s.stepsLeft = left;
    if (left <= 0) {
      await this.emit({ type: 'banner', text: `${p.name} остаётся на месте`, tone: 'info' }, 1200);
      return;
    }
    let node = p.node;
    let path: number[] = [];
    const flush = async () => {
      if (!path.length) return;
      const steps = path;
      path = [];
      await this.emit({ type: 'move', pid, path: steps }, steps.length * 280 + 150);
    };
    while (left > 0) {
      const nexts = this.board.nodes[node].next;
      let nxt = nexts[0];
      if (nexts.length > 1) {
        await flush();
        const idx = await this.ask<number>(pid, 'branch', { from: node, options: nexts }, {
          timeout: 30000,
          bot: () => this.brain.branch(s, pid, nexts, s.settings.botLevel),
          validate: (v) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < nexts.length ? (v as number) : undefined),
        });
        nxt = nexts[idx];
      }
      node = nxt;
      p.node = node;
      path.push(node);
      const n = this.board.nodes[node];
      if (n.passThrough) {
        await flush();
        await this.passSpecial(pid, n);
        continue;
      }
      left--;
      s.stepsLeft = left;
      p.stats.steps++;
      if (node === s.starNode) {
        await flush();
        await this.offerStar(pid);
        continue;
      }
      if (n.type === 'bank' && left > 0) {
        await flush();
        await this.bankDeposit(pid);
      }
    }
    await flush();
    s.stepsLeft = 0;
    await this.land(pid, node);
  }

  private async moveStar(first = false) {
    const s = this.state!;
    const occupied = new Set(Object.values(s.players).map((p) => p.node));
    let spots = this.board.starSpots.filter((n) => n !== s.starNode && !occupied.has(n));
    if (!spots.length) spots = this.board.starSpots.filter((n) => n !== s.starNode);
    s.starNode = this.rng.pick(spots);
    s.starPrice = 20;
    delete s.traps[s.starNode];
    await this.emit({ type: 'starMove', node: s.starNode }, 2600);
    if (first) this.log('Звезда появилась на острове!');
  }

  private async offerStar(pid: string) {
    const s = this.state!;
    const p = this.P(pid);
    this.starTouched = p.node;
    const price = s.starPrice;
    if (p.coins < price) {
      await this.card('Звезда', `Звезда стоит ${price} монет, а у ${p.name} только ${p.coins}.`, 'star', 'info', 1900);
      return;
    }
    const yes = await this.ask<boolean>(pid, 'buyStar', { price }, {
      timeout: 30000,
      bot: () => this.brain.buyStar(s, pid),
      validate: (v) => (typeof v === 'boolean' ? v : undefined),
    });
    if (!yes) return;
    await this.addCoins(pid, -price, true, 600);
    p.stars++;
    this.log(`${p.name} получает звезду!`);
    await this.emit({ type: 'stars', pid, delta: 1 }, 2600);
    await this.moveStar();
  }

  private async bankDeposit(pid: string) {
    const s = this.state!;
    const amount = Math.min(5, this.P(pid).coins);
    if (!amount) return;
    s.bank += amount;
    await this.card('Банк черепахи', `${this.name(pid)} проходит мимо банка и платит ${amount} монет. В банке: ${s.bank}.`, 'bank', 'bad', 1500);
    await this.addCoins(pid, -amount, true, 600);
  }

  private async passSpecial(pid: string, n: BoardNode) {
    const s = this.state!;
    const p = this.P(pid);
    if (n.type === 'shop') {
      const offer = ITEM_IDS.map((id) => ({ id, price: ITEMS[id].price }));
      const cheapest = Math.min(...offer.map((o) => o.price));
      if (p.items.length >= MAX_ITEMS || p.coins < cheapest) {
        await this.card('Лавка попугая', p.items.length >= MAX_ITEMS ? 'Рюкзак полон — покупать некуда.' : 'Не хватает монет даже на самое дешёвое.', 'shop', 'info', 1500);
        return;
      }
      const choice = await this.ask<ItemId | null>(pid, 'shop', { offer, coins: p.coins }, {
        timeout: 30000,
        bot: () => this.brain.shop(s, pid, offer, s.settings.botLevel),
        validate: (v) =>
          v === null ? null : typeof v === 'string' && ITEMS[v as ItemId] && ITEMS[v as ItemId].price <= p.coins ? (v as ItemId) : undefined,
      });
      if (!choice) return;
      p.items.push(choice);
      p.stats.spent += ITEMS[choice].price;
      this.log(`${p.name} покупает «${ITEMS[choice].name}»`);
      await this.addCoins(pid, -ITEMS[choice].price, true, 500);
      await this.emit({ type: 'item', pid, item: choice }, 1300);
      return;
    }
    if (n.type === 'thief') {
      const coinCost = 5;
      const starCost = 40;
      if (p.coins < coinCost) {
        await this.card('Хижина воришки', 'Мартышка-воришка работает только за монеты.', 'thief', 'info', 1400);
        return;
      }
      const others = this.others(pid).map((o) => ({ pid: o, coins: this.P(o).coins, stars: this.P(o).stars }));
      type ThiefAns = { mode: 'coins' | 'star'; target: string } | null;
      const ans = await this.ask<ThiefAns>(pid, 'thief', { coinCost, starCost, others }, {
        timeout: 30000,
        bot: () => this.brain.thief(s, pid, { coinCost, starCost }),
        validate: (v: any) => {
          if (v === null) return null;
          if (!v || !this.others(pid).includes(v.target)) return undefined;
          if (v.mode === 'coins' && p.coins >= coinCost) return { mode: 'coins', target: v.target };
          if (v.mode === 'star' && p.coins >= starCost && this.P(v.target).stars > 0) return { mode: 'star', target: v.target };
          return undefined;
        },
      });
      if (!ans) return;
      const t = ans.target;
      if (ans.mode === 'coins') {
        await this.addCoins(pid, -coinCost, true, 500);
        p.stats.spent += coinCost;
        const amount = Math.min(this.P(t).coins, this.rng.int(5, 15));
        await this.card('Мартышка-воришка', `Ловко утащила у ${this.name(t)} ${amount} монет для ${p.name}!`, 'thief', 'good', 2000);
        await this.addCoins(t, -amount, true, 500);
        await this.addCoins(pid, amount);
      } else {
        await this.addCoins(pid, -starCost, true, 500);
        p.stats.spent += starCost;
        this.P(t).stars--;
        p.stars++;
        await this.card('Мартышка-воришка', `Украла звезду у ${this.name(t)} для ${p.name}!`, 'thief', 'good', 2200);
        await this.emit({ type: 'stars', pid: t, delta: -1 }, 900);
        await this.emit({ type: 'stars', pid, delta: 1 }, 1800);
      }
    }
  }

  private async land(pid: string, node: number) {
    const s = this.state!;
    const p = this.P(pid);
    const n = this.board.nodes[node];
    await this.emit({ type: 'land', pid, node, space: n.type }, 650);

    const trapOwner = s.traps[node];
    if (trapOwner !== undefined && trapOwner !== pid) {
      delete s.traps[node];
      await this.emit({ type: 'trap', node, owner: null }, 300);
      const amount = Math.min(10, p.coins);
      await this.card('Капкан!', `${p.name} попадает в капкан ${this.name(trapOwner)} и отдаёт ${amount} монет.`, 'trap', 'bad', 2000);
      await this.addCoins(pid, -amount, true, 500);
      await this.addCoins(trapOwner, amount);
    }

    if (this.starTouched === node) {
      p.color = 'blue';
      return;
    }
    const mult = s.lastFive ? 2 : 1;
    switch (n.type) {
      case 'blue':
        p.color = 'blue';
        await this.addCoins(pid, 3 * mult);
        break;
      case 'red':
        p.color = 'red';
        p.stats.reds++;
        await this.addCoins(pid, -3 * mult);
        break;
      case 'event':
        p.color = 'green';
        p.stats.events++;
        await this.islandEvent(pid);
        break;
      case 'lucky':
        p.color = 'green';
        await this.luckyEvent(pid);
        break;
      case 'villain':
        p.color = 'red';
        await this.villainEvent(pid);
        break;
      case 'duel':
        p.color = 'green';
        await this.duel(pid);
        break;
      case 'bank': {
        p.color = 'green';
        if (s.bank > 0) {
          const amount = s.bank;
          s.bank = 0;
          await this.card('Банк черепахи', `${p.name} забирает все накопления банка: ${amount} монет!`, 'bank', 'good', 2000);
          await this.addCoins(pid, amount);
        } else {
          await this.card('Банк черепахи', 'Банк пока пуст.', 'bank', 'info', 1500);
        }
        break;
      }
      default:
        p.color = 'blue';
    }
  }

  private async giveRandomItem(pid: string): Promise<boolean> {
    const p = this.P(pid);
    if (p.items.length >= MAX_ITEMS) return false;
    const pool: ItemId[] = ['double', 'double', 'custom', 'custom', 'triple', 'swap', 'paw', 'trap', 'shell'];
    const it = this.rng.pick(pool);
    p.items.push(it);
    await this.emit({ type: 'item', pid, item: it }, 1500);
    this.log(`${p.name} получает «${ITEMS[it].name}»`);
    return true;
  }

  private async islandEvent(pid: string) {
    const s = this.state!;
    const p = this.P(pid);
    const roll = this.rng.int(0, 6);
    switch (roll) {
      case 0: {
        const v = this.rng.int(5, 10);
        await this.card('Кокосовый дождь', `С пальмы падают кокосы с монетами: +${v}!`, 'coconut', 'good');
        await this.addCoins(pid, v);
        break;
      }
      case 1: {
        const options = this.board.nodes.filter((n) => !n.passThrough && n.id !== s.starNode && n.id !== p.node);
        const dest = this.rng.pick(options).id;
        await this.card('Попутное течение', `Течение подхватывает ${p.name} и уносит в другую часть острова!`, 'wave', 'info');
        p.node = dest;
        await this.emit({ type: 'teleport', pid, node: dest }, 1600);
        break;
      }
      case 2: {
        const others = this.others(pid);
        const t = this.rng.pick(others);
        await this.card('Попугай-шутник', `Попугай меняет местами ${p.name} и ${this.name(t)}!`, 'parrot', 'info');
        const q = this.P(t);
        [p.node, q.node] = [q.node, p.node];
        await this.emit({ type: 'swap', a: pid, b: t }, 1900);
        break;
      }
      case 3: {
        await this.card('Вулкан чихнул', 'Все игроки роняют по 5 монет в лаву!', 'volcano', 'bad');
        for (const o of s.order) await this.addCoins(o, -5, true, 350);
        break;
      }
      case 4: {
        await this.card('Подарок дельфина', `Дельфин приносит ${p.name} подарок!`, 'dolphin', 'good', 2000);
        if (!(await this.giveRandomItem(pid))) await this.addCoins(pid, 8);
        break;
      }
      case 5: {
        await this.card('Шторм!', 'Ветер срывает звезду и уносит её в другое место!', 'storm', 'info');
        await this.moveStar();
        break;
      }
      default: {
        await this.card('Прилив щедрости', `Каждый игрок дарит ${p.name} по 3 монеты!`, 'wave', 'good');
        for (const o of this.others(pid)) {
          const got = -(await this.addCoins(o, -3, true, 350));
          await this.addCoins(pid, got, true, 350);
        }
      }
    }
  }

  private async luckyEvent(pid: string) {
    const p = this.P(pid);
    if (this.rng.chance(0.65) && p.items.length < MAX_ITEMS) {
      await this.card('Счастливый клевер', `${p.name} находит предмет!`, 'clover', 'good', 1800);
      await this.giveRandomItem(pid);
    } else {
      const v = this.rng.int(6, 12);
      await this.card('Счастливый клевер', `${p.name} находит клад: +${v} монет!`, 'clover', 'good', 1800);
      await this.addCoins(pid, v);
    }
  }

  private async villainEvent(pid: string) {
    const s = this.state!;
    const p = this.P(pid);
    await this.emit({ type: 'banner', text: 'Капитан Барракуда!', sub: 'Пират всплывает из глубин…', tone: 'bad' }, 2000);
    const roll = this.rng.int(0, 9);
    if (roll <= 2) {
      const v = Math.min(p.coins, 10);
      await this.card('Пиратский налог', `Барракуда отбирает у ${p.name} ${v} монет.`, 'villain', 'bad');
      await this.addCoins(pid, -v);
    } else if (roll === 3) {
      await this.card('Казна пирата', 'Все платят по 5 монет в банк острова!', 'villain', 'bad');
      for (const o of s.order) {
        const paid = -(await this.addCoins(o, -5, true, 350));
        s.bank += paid;
      }
    } else if (roll === 4) {
      await this.card('Похищение звезды', 'Барракуда перепрятывает звезду!', 'villain', 'bad');
      await this.moveStar();
    } else if (roll === 5) {
      s.starPrice = 30;
      await this.card('Пиратская наценка', 'До следующей покупки звезда стоит 30 монет!', 'villain', 'bad');
    } else if (roll === 6) {
      const total = s.order.reduce((a, o) => a + this.P(o).coins, 0);
      const each = Math.floor(total / s.order.length);
      await this.card('Пиратская революция', `Все монеты делятся поровну: каждому по ${each}!`, 'villain', 'info', 3000);
      for (const o of s.order) await this.addCoins(o, each - this.P(o).coins, true, 400);
    } else if (roll === 7) {
      const t = this.rng.pick(this.others(pid));
      await this.card('Обмен кошельками', `${p.name} и ${this.name(t)} меняются всеми монетами!`, 'villain', 'info', 2800);
      const a = p.coins;
      const b = this.P(t).coins;
      await this.addCoins(pid, b - a, true, 500);
      await this.addCoins(t, a - b, true, 500);
    } else if (roll === 8) {
      await this.card('Щедрый капитан', `У Барракуды хорошее настроение: ${p.name} получает 10 монет!`, 'villain', 'good');
      await this.addCoins(pid, 10);
    } else {
      const lost = p.items.length;
      if (lost) {
        p.items = [];
        await this.card('Обыск', `Барракуда отбирает все предметы ${p.name}!`, 'villain', 'bad');
      } else {
        const v = Math.min(p.coins, 5);
        await this.card('Обыск', `Предметов нет — Барракуда берёт ${v} монет.`, 'villain', 'bad');
        await this.addCoins(pid, -v);
      }
    }
  }

  private async duel(pid: string) {
    const s = this.state!;
    const p = this.P(pid);
    const others = this.others(pid);
    const wagers = [5, 10, 20].filter((w) => w <= p.coins);
    if (!wagers.length) wagers.push(0);
    await this.emit({ type: 'banner', text: 'Дуэль!', sub: `${p.name} вызывает соперника`, tone: 'info' }, 1500);
    const ans = await this.ask<{ target: string; wager: number }>(pid, 'duel', { opponents: others, wagers }, {
      timeout: 30000,
      bot: () => ({ target: this.brain.target(s, pid, others, 'duel'), wager: this.brain.wager(wagers) }),
      validate: (v: any) => (v && others.includes(v.target) && wagers.includes(v.wager) ? { target: v.target, wager: v.wager } : undefined),
    });
    const wager = Math.min(ans.wager, this.P(ans.target).coins, p.coins);
    this.log(`${p.name} вызывает на дуэль ${this.name(ans.target)} (ставка ${wager})`);
    const def = pickMinigame(this.rng, 'duel', this.recentMg);
    await this.runMinigame(def, [pid, ans.target], 'duel', undefined, wager);
  }

  private async minigameRound() {
    const s = this.state!;
    for (const pid of s.order) {
      const p = this.P(pid);
      if (p.color === 'green') p.color = this.rng.chance(0.5) ? 'blue' : 'red';
    }
    const blues = s.order.filter((p) => this.P(p).color === 'blue');
    const reds = s.order.filter((p) => this.P(p).color === 'red');
    const n = s.order.length;
    let format: Format = 'ffa';
    let teams: { a: string[]; b: string[] } | undefined;
    if (n >= 3 && (blues.length === 1 || reds.length === 1)) {
      format = '1v';
      teams = blues.length === 1 ? { a: blues, b: reds } : { a: reds, b: blues };
    } else if (n >= 4 && blues.length === reds.length) {
      format = 'team';
      teams = { a: blues, b: reds };
    }
    const def = pickMinigame(this.rng, format, this.recentMg);
    await this.emit({ type: 'banner', text: 'Мини-игра!', sub: FORMAT_NAMES[format], tone: 'star' }, 2200);
    await this.runMinigame(def, [...s.order], format, teams);
  }

  private async runMinigame(def: MgDef, players: string[], format: Format, teams?: { a: string[]; b: string[] }, wager = 0) {
    const s = this.state!;
    s.phase = 'minigame';
    s.mg = { id: def.id, format, players, teams, stage: 'intro', wager: format === 'duel' ? wager : undefined };
    s.prompt = null;
    await this.emit({ type: 'mg' }, 300);
    const ready: string[] = [];
    await Promise.all(
      players.map((pid) =>
        this.ask<boolean>(pid, 'mgReady', {}, { timeout: 25000, bot: () => true, validate: () => true, botDelay: 1500 + Math.random() * 2000, prompt: false }).then(
          () => {
            ready.push(pid);
            this.emitNow({ type: 'mgShow', data: { stage: 'ready', ready: [...ready] } });
          },
        ),
      ),
    );
    s.mg.stage = 'play';
    await this.emit({ type: 'mg' }, 600);

    const ctx: MgCtx = {
      rng: this.rng,
      players,
      format,
      teams,
      level: s.settings.botLevel,
      askAll: async (pids, data, o) => {
        const out: Record<string, any> = {};
        await Promise.all(
          pids.map((pid) =>
            this.ask(pid, 'mg', data(pid), {
              timeout: o.timeout,
              bot: () => o.bot(pid),
              validate: (v) => o.validate(v, pid),
              botDelay: o.botDelay?.(),
              prompt: false,
            }).then((v) => {
              out[pid] = v;
              o.onAnswer?.(pid, v as any);
            }),
          ),
        );
        return out;
      },
      show: (data, dur) => this.emit({ type: 'mgShow', data }, dur),
    };
    const scores = await def.run(ctx);
    const result = award(format, players, teams, scores, this.names());
    if (format === 'duel') {
      const [a, b] = players;
      result.coins = { [a]: 0, [b]: 0 };
      if (result.winners.length === 1 && wager > 0) {
        const w = result.winners[0];
        const l = w === a ? b : a;
        const moved = Math.min(wager, this.P(l).coins);
        result.coins[w] = moved;
        result.coins[l] = -moved;
        result.text += ` Забирает ${moved} монет.`;
      }
    }
    for (const pid of players) {
      const got = await this.addCoins(pid, result.coins[pid] ?? 0, false);
      if (got > 0) this.P(pid).stats.mgCoins += got;
    }
    this.log(`${def.name}: ${result.text}`);
    s.mg.stage = 'results';
    s.mg.results = result;
    await this.emit({ type: 'mg' }, 6500);
    this.recentMg.push(def.id);
    if (this.recentMg.length > 4) this.recentMg.shift();
    s.phase = 'board';
    s.mg = null;
    await this.emit({ type: 'sync' }, 400);
  }

  private async finale() {
    const s = this.state!;
    s.current = null;
    await this.emit({ type: 'banner', text: 'Игра окончена!', sub: 'Пора раздать бонусные звёзды…', tone: 'star' }, 3000);
    const defs: { id: string; name: string; desc: string; stat: (p: PlayerState) => number }[] = [
      { id: 'mg', name: 'Звезда мини-игр', desc: 'больше всех монет в мини-играх', stat: (p) => p.stats.mgCoins },
      { id: 'rich', name: 'Звезда богача', desc: 'больше всех монет за игру одновременно', stat: (p) => p.stats.maxCoins },
      { id: 'event', name: 'Звезда приключений', desc: 'больше всех клеток «?»', stat: (p) => p.stats.events },
      { id: 'red', name: 'Звезда невезения', desc: 'больше всех красных клеток', stat: (p) => p.stats.reds },
      { id: 'shop', name: 'Звезда транжиры', desc: 'больше всех потратил(а) на покупки', stat: (p) => p.stats.spent },
      { id: 'run', name: 'Звезда путешественника', desc: 'больше всех шагов', stat: (p) => p.stats.steps },
    ];
    const chosen = this.rng.shuffle([...defs]).slice(0, 3);
    for (const d of chosen) {
      const best = Math.max(...s.order.map((p) => d.stat(this.P(p))));
      let winners = best > 0 ? s.order.filter((p) => d.stat(this.P(p)) === best) : [];
      // Если «отличились» все сразу — звезду не получает никто.
      if (winners.length === s.order.length && winners.length > 1) winners = [];
      for (const w of winners) this.P(w).stars++;
      const a: BonusAward = { id: d.id, name: d.name, desc: d.desc, winners };
      s.bonus.push(a);
      await this.emit({ type: 'bonus', award: a }, 4500);
    }
    s.ranking = this.ranking();
    s.phase = 'final';
    this.finished = true;
    this.log(`Победитель: ${this.name(s.ranking[0])}!`);
    await this.emit({ type: 'final' }, 0);
    this.opts.onSave?.(null);
  }

  get isFinished() {
    return this.finished;
  }

  /** Используется симуляцией: имя мини-игры по id. */
  static mgName(id: string) {
    return MG_BY_ID[id]?.name ?? id;
  }
}

function cleanName(s: unknown): string {
  return String(s ?? '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 16);
}
