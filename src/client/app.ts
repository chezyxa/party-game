import { CHARACTERS, CHAR_BY_ID, faceLabel } from '../core/characters';
import { loopbackPair, type Conn } from '../core/conn';
import { GameHost, type SaveData } from '../core/host';
import type { GameState, HostMsg, LobbyState } from '../core/types';
import { hostRoom, joinRoom, makeRoomCode, type HostPeer } from '../net/peer';
import { charUrl } from './art';
import { sfx, startMusic, unlockAudio } from './audio';
import { clear, h, toast } from './dom';
import { GameScreen } from './ui/game';

const SAVE_KEY = 'tiki-save';

function ls(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* ignore */
  }
}

export class App {
  root = document.getElementById('app')!;
  clientId: string;
  name: string;
  conn: Conn | null = null;
  pid: string | null = null;
  isHost = false;
  code = '';
  host: GameHost | null = null;
  hostPeer: HostPeer | null = null;
  joinDestroy: (() => void) | null = null;
  game: GameScreen | null = null;
  lobby: LobbyState | null = null;
  private reconnecting = false;
  private leaving = false;

  constructor() {
    let id = ls('tiki-client');
    if (!id) {
      id = Math.random().toString(36).slice(2) + Date.now().toString(36);
      lsSet('tiki-client', id);
    }
    this.clientId = id;
    // Отдельная вкладка = отдельный игрок (удобно для тестов): ?tab=2
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab) this.clientId += '-' + tab;
    this.name = ls('tiki-name') ?? '';
  }

  start() {
    const room = new URLSearchParams(location.search).get('room');
    this.showMenu(room?.toUpperCase() ?? '');
  }

  // ================= Меню =================
  showMenu(prefill = '') {
    this.reset();
    clear(this.root);
    const nameInput = h('input', { class: 'input', maxLength: 16, placeholder: 'Твоё имя', value: this.name });
    const codeInput = h('input', { class: 'input code', maxLength: 5, placeholder: 'КОД', value: prefill });
    codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));
    const getName = () => {
      const n = nameInput.value.trim().slice(0, 16);
      if (!n) {
        toast('Введи имя', 'error');
        nameInput.focus();
        return null;
      }
      this.name = n;
      lsSet('tiki-name', n);
      unlockAudio();
      startMusic();
      sfx.click();
      return n;
    };
    let save: SaveData | null = null;
    try {
      save = JSON.parse(ls(SAVE_KEY) ?? 'null');
    } catch {
      save = null;
    }
    const busy = (b: boolean) => this.root.querySelectorAll('button').forEach((x) => ((x as HTMLButtonElement).disabled = b));

    const charsRow = h(
      'div',
      { class: 'menu-chars' },
      CHARACTERS.map((c) => h('img', { src: charUrl(c.id, 128), title: `${c.name} — ${c.species}`, class: 'menu-char' })),
    );

    const panel = h(
      'div',
      { class: 'menu panel' },
      h('h1', { class: 'logo' }, 'Тики-Пати'),
      h('div', { class: 'subtitle' }, 'Настольная вечеринка на тропическом острове · 2–6 игроков'),
      charsRow,
      h('label', { class: 'label' }, 'Имя'),
      nameInput,
      h(
        'div',
        { class: 'menu-actions' },
        h(
          'button',
          {
            class: 'btn primary big',
            onclick: async () => {
              if (!getName()) return;
              busy(true);
              await this.createRoom(true).catch((e) => toast(e.message, 'error', 6000));
              busy(false);
            },
          },
          '🌐 Создать онлайн-комнату',
        ),
        h(
          'div',
          { class: 'join-row' },
          codeInput,
          h(
            'button',
            {
              class: 'btn big',
              onclick: async () => {
                if (!getName()) return;
                const code = codeInput.value.trim();
                if (code.length !== 5) return toast('Код комнаты — 5 символов', 'error');
                busy(true);
                await this.join(code).catch((e) => toast(e.message, 'error', 6000));
                busy(false);
              },
            },
            '🚪 Войти',
          ),
        ),
        h(
          'button',
          {
            class: 'btn big',
            onclick: async () => {
              if (!getName()) return;
              await this.createRoom(false);
            },
          },
          '🤖 Играть с ботами (офлайн)',
        ),
        save &&
          h(
            'button',
            {
              class: 'btn big gold',
              onclick: async () => {
                if (!getName()) return;
                busy(true);
                await this.createRoom(true, save!).catch((e) => toast(e.message, 'error', 6000));
                busy(false);
              },
            },
            `💾 Продолжить сохранённую игру (ход ${save.state.turn}/${save.state.maxTurns}, комната ${save.code})`,
          ),
      ),
      h(
        'details',
        { class: 'rules' },
        h('summary', {}, 'Как играть'),
        h('div', {
          html: `<p>Ходите по острову, собирайте монеты и покупайте <b>звёзды</b> (20 монет). Побеждает тот, у кого больше всех звёзд, при равенстве — больше монет.</p>
<p><b>Синие</b> клетки дают 3 монеты, <b>красные</b> отнимают 3. «?» — события острова, клевер — подарки, череп — капитан Барракуда, мечи — дуэль. Лавка и хижина воришки срабатывают, когда проходишь мимо.</p>
<p>У каждого персонажа есть свой кубик — им можно бросить вместо обычного (1–10).</p>
<p>После каждого хода все играют в мини-игру. В них важны стратегия, удача и внимательность, а не скорость интернета.</p>
<p>В конце раздаются 3 бонусные звезды. За последние 5 ходов синие и красные клетки удваиваются.</p>`,
        }),
      ),
    );
    this.root.append(h('div', { class: 'screen menu-screen' }, panel));
    nameInput.focus();
  }

  private reset() {
    this.leaving = true;
    this.game?.destroy();
    this.game = null;
    this.conn?.close();
    this.conn = null;
    this.hostPeer?.destroy();
    this.hostPeer = null;
    this.joinDestroy?.();
    this.joinDestroy = null;
    this.host = null;
    this.pid = null;
    this.lobby = null;
    this.leaving = false;
  }

  // ================= Подключение =================
  async createRoom(online: boolean, save?: SaveData) {
    this.reset();
    const code = save?.code ?? (online ? makeRoomCode() : 'LOCAL');
    const speedParam = Number(new URLSearchParams(location.search).get('speed'));
    const host = new GameHost({
      code,
      save,
      speed: speedParam > 0 ? speedParam : 1,
      onSave: online || save ? (s) => lsSet(SAVE_KEY, s ? JSON.stringify(s) : null) : undefined,
    });
    if (online) {
      let tries = save ? 5 : 1;
      for (;;) {
        try {
          this.hostPeer = await hostRoom(code, (c) => host.addConn(c));
          break;
        } catch (e) {
          // После перезагрузки старый ID может быть ещё занят на сервере.
          if (--tries <= 0) throw e;
          toast('Освобождаем код комнаты…');
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    this.host = host;
    this.code = code;
    const [a, b] = loopbackPair();
    host.addConn(a, true);
    this.attach(b);
    if (!online) {
      // Офлайн: сразу добавляем ботов.
      setTimeout(() => {
        for (let i = 0; i < 3; i++) this.send({ t: 'host', cmd: 'addBot' });
      }, 50);
    }
  }

  async join(code: string) {
    this.reset();
    const { conn, destroy } = await joinRoom(code);
    this.code = code;
    this.joinDestroy = destroy;
    this.attach(conn);
  }

  private attach(conn: Conn) {
    this.conn = conn;
    conn.onMessage((m) => this.onMsg(m as HostMsg));
    conn.onClose(() => {
      if (this.leaving || this.conn !== conn) return;
      this.conn = null;
      if (!this.host) void this.reconnect();
    });
    conn.send({ t: 'hello', clientId: this.clientId, name: this.name });
  }

  private async reconnect() {
    if (this.reconnecting) return;
    this.reconnecting = true;
    const banner = h('div', { class: 'reconnect' }, '📡 Связь с хостом потеряна. Переподключаемся…');
    document.body.append(banner);
    for (let i = 0; i < 40 && !this.conn && !this.leaving; i++) {
      try {
        this.joinDestroy?.();
        const { conn, destroy } = await joinRoom(this.code);
        this.joinDestroy = destroy;
        this.attach(conn);
        toast('Снова в игре!');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
    banner.remove();
    this.reconnecting = false;
    if (!this.conn && !this.leaving) {
      toast('Не удалось переподключиться к хосту.', 'error', 8000);
      this.showMenu(this.code);
    }
  }

  send(msg: unknown) {
    this.conn?.send(msg);
  }

  private onMsg(msg: HostMsg) {
    switch (msg.t) {
      case 'welcome':
        this.pid = msg.pid || null;
        this.isHost = msg.isHost;
        break;
      case 'lobby':
        this.lobby = msg.lobby;
        if (this.game) {
          this.game.destroy();
          this.game = null;
        }
        this.renderLobby();
        break;
      case 'state':
      case 'ev':
        this.ensureGame(msg.state).onHostMsg(msg);
        break;
      case 'ask':
      case 'cancelAsk':
      case 'chat':
        this.game?.onHostMsg(msg);
        if (msg.t === 'chat' && !this.game) this.lobbyChat(msg.pid, msg.text);
        break;
      case 'error':
        toast(msg.text, 'error', 6000);
        if (msg.text.includes('удалил') || msg.text.includes('заполнена')) this.showMenu();
        break;
    }
  }

  private ensureGame(state: GameState): GameScreen {
    if (!this.game) {
      clear(this.root);
      this.game = new GameScreen(this, state);
    }
    return this.game;
  }

  // ================= Лобби =================
  private lobbyChat(pid: string, text: string) {
    const p = this.lobby?.players.find((x) => x.pid === pid);
    toast(`${p?.name ?? '?'}: ${text}`);
  }

  renderLobby() {
    const L = this.lobby!;
    clear(this.root);
    const me = L.players.find((p) => p.pid === this.pid);
    const online = this.code !== 'LOCAL';
    const link = `${location.origin}${location.pathname}?room=${L.code}`;

    const seats = h(
      'div',
      { class: 'seats' },
      L.players.map((p) => {
        const ch = CHAR_BY_ID[p.charId];
        return h(
          'div',
          { class: 'seat' + (p.pid === this.pid ? ' me' : ''), style: `--pc:${ch.color}` },
          h('img', { src: charUrl(p.charId, 128), class: 'seat-img' }),
          h(
            'div',
            { class: 'seat-info' },
            h('div', { class: 'seat-name' }, p.name, p.isHost ? ' 👑' : '', p.isBot ? ' 🤖' : '', !p.online ? ' (не в сети)' : ''),
            h('div', { class: 'seat-char' }, `${ch.name}, ${ch.species}`),
          ),
          this.isHost &&
            !L.resuming &&
            !p.isHost &&
            h(
              'button',
              { class: 'btn small danger', title: 'Убрать', onclick: () => this.send({ t: 'host', cmd: 'remove', pid: p.pid }) },
              '✕',
            ),
        );
      }),
      !L.resuming &&
        Array.from({ length: 6 - L.players.length }, () =>
          h('div', { class: 'seat empty' }, h('div', { class: 'seat-name' }, online ? 'Свободно — ждём игрока' : 'Свободно')),
        ),
    );

    const taken = new Set(L.players.map((p) => p.charId));
    const chars = h(
      'div',
      { class: 'char-grid' },
      CHARACTERS.map((c) => {
        const mine = me?.charId === c.id;
        const busy = taken.has(c.id) && !mine;
        return h(
          'button',
          {
            class: 'char-card' + (mine ? ' selected' : '') + (busy ? ' busy' : ''),
            style: `--pc:${c.color}`,
            disabled: busy || L.resuming,
            onclick: () => {
              sfx.click();
              this.send({ t: 'setChar', charId: c.id });
            },
          },
          h('img', { src: charUrl(c.id, 128) }),
          h('div', { class: 'char-name' }, c.name),
          h('div', { class: 'char-species' }, c.species),
          h('div', { class: 'char-dice' }, c.dice.map((f) => h('span', { class: 'face' + (f.coins ? (f.coins > 0 ? ' plus' : ' minus') : '') }, faceLabel(f)))),
          h('div', { class: 'char-desc' }, c.diceDesc),
        );
      }),
    );

    const hostControls = this.isHost
      ? L.resuming
        ? h(
            'div',
            { class: 'host-controls' },
            h('p', {}, 'Продолжаем сохранённую игру. Дождитесь, пока игроки переподключатся по коду комнаты (кто не вернётся — за них сыграет бот).'),
            h('button', { class: 'btn primary big', onclick: () => this.send({ t: 'host', cmd: 'resume' }) }, '▶ Продолжить игру'),
          )
        : h(
            'div',
            { class: 'host-controls' },
            h(
              'div',
              { class: 'setting' },
              h('span', {}, 'Ходов:'),
              [10, 15, 20, 25].map((n) =>
                h('button', { class: 'btn small' + (L.settings.turns === n ? ' active' : ''), onclick: () => this.send({ t: 'host', cmd: 'settings', settings: { turns: n } }) }, String(n)),
              ),
            ),
            h(
              'div',
              { class: 'setting' },
              h('span', {}, 'Боты:'),
              (
                [
                  ['easy', 'Лёгкие'],
                  ['normal', 'Обычные'],
                  ['hard', 'Сильные'],
                ] as const
              ).map(([k, label]) =>
                h(
                  'button',
                  { class: 'btn small' + (L.settings.botLevel === k ? ' active' : ''), onclick: () => this.send({ t: 'host', cmd: 'settings', settings: { botLevel: k } }) },
                  label,
                ),
              ),
            ),
            h(
              'div',
              { class: 'setting' },
              h('button', { class: 'btn', disabled: L.players.length >= 6, onclick: () => this.send({ t: 'host', cmd: 'addBot' }) }, '＋ Добавить бота'),
              h(
                'button',
                {
                  class: 'btn primary big',
                  disabled: L.players.length < 2,
                  onclick: () => {
                    sfx.good();
                    this.send({ t: 'host', cmd: 'start' });
                  },
                },
                '▶ Начать игру',
              ),
            ),
          )
      : h('div', { class: 'host-controls' }, h('p', {}, L.resuming ? 'Ждём, пока хост продолжит игру…' : `Ждём, пока хост начнёт игру… (ходов: ${L.settings.turns})`));

    const nameEdit =
      me && !L.resuming
        ? h('input', {
            class: 'input',
            value: me.name,
            maxLength: 16,
            onchange: (e: Event) => {
              const v = (e.target as HTMLInputElement).value.trim();
              if (v) {
                this.name = v;
                lsSet('tiki-name', v);
                this.send({ t: 'setName', name: v });
              }
            },
          })
        : null;

    this.root.append(
      h(
        'div',
        { class: 'screen lobby-screen' },
        h(
          'div',
          { class: 'panel lobby' },
          h(
            'div',
            { class: 'lobby-head' },
            h('h2', {}, online ? 'Комната ' : 'Игра с ботами', online ? h('span', { class: 'room-code' }, L.code) : null),
            online &&
              h(
                'button',
                {
                  class: 'btn small',
                  onclick: () => {
                    void navigator.clipboard?.writeText(link).then(() => toast('Ссылка скопирована!'));
                  },
                },
                '📋 Скопировать ссылку-приглашение',
              ),
            h('button', { class: 'btn small', onclick: () => this.showMenu() }, '← Выйти'),
          ),
          h('div', { class: 'lobby-body' }, h('div', { class: 'lobby-left' }, h('h3', {}, `Игроки (${L.players.length}/6)`), seats), h('div', { class: 'lobby-right' }, nameEdit && h('label', { class: 'label' }, 'Имя'), nameEdit, h('h3', {}, 'Выбери персонажа'), chars)),
          hostControls,
        ),
      ),
    );
  }
}
