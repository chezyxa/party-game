import Phaser from 'phaser';
import { CHAR_BY_ID, faceLabel } from '../../core/characters';
import { ITEMS, type ItemId } from '../../core/items';
import type { Ask, GameEvent, GameState, HostMsg } from '../../core/types';
import type { App } from '../app';
import { charUrl, EMOJI, iconHtml, starUrl, coinUrl } from '../art';
import { isMusicOn, isMuted, setMusic, setMuted, sfx } from '../audio';
import { BoardScene, SPACE_NAMES } from '../board/BoardScene';
import { clear, esc, h, sleep, timerBar } from '../dom';
import { MinigameOverlay } from '../minigames/overlay';

type QItem = { kind: 'ev'; ev: GameEvent; state: GameState; dur: number } | { kind: 'state'; state: GameState } | { kind: 'ask'; ask: Ask; at: number };

const ROUTE_NAMES: Record<string, string> = {
  main: 'По побережью',
  jungle: 'Через джунгли',
  volcano: 'Тропа вулкана',
  pier: 'По причалу',
};

const PROMPT_TEXT: Record<string, string> = {
  turn: 'решает, что делать',
  branch: 'выбирает дорогу',
  buyStar: 'думает, купить ли звезду',
  shop: 'выбирает товар в лавке',
  thief: 'беседует с мартышкой-воришкой',
  target: 'выбирает цель',
  duel: 'выбирает соперника для дуэли',
  customDice: 'выбирает число на кубике',
};

export class GameScreen {
  state: GameState;
  private el: HTMLElement;
  private phaser: Phaser.Game;
  board!: BoardScene;
  private boardReady: Promise<void>;
  private queue: QItem[] = [];
  private pumping = false;
  private hud!: HTMLElement;
  private topBar!: HTMLElement;
  private status!: HTMLElement;
  private actions!: HTMLElement;
  private overlay!: HTMLElement;
  private tooltip!: HTMLElement;
  private activeAsk: { id: number; close: () => void } | null = null;
  private mg: MinigameOverlay;
  private destroyed = false;
  private statusTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private app: App,
    state: GameState,
  ) {
    this.state = state;
    this.el = h('div', { class: 'screen game-screen' });
    app.root.append(this.el);
    const boardWrap = h('div', { class: 'board-wrap', id: 'board' });
    this.hud = h('div', { class: 'hud-players' });
    this.topBar = h('div', { class: 'hud-top' });
    this.status = h('div', { class: 'hud-status' });
    this.actions = h('div', { class: 'hud-actions' });
    this.overlay = h('div', { class: 'overlay-layer' });
    this.tooltip = h('div', { class: 'tooltip hidden' });
    const tools = h(
      'div',
      { class: 'hud-tools' },
      h('button', { class: 'btn icon', title: 'Весь остров', onclick: () => this.board.fitAll() }, '🗺'),
      h('button', { class: 'btn icon', title: 'К текущему игроку', onclick: () => this.board.focus(this.state.current ?? this.app.pid) }, '🎯'),
      this.toggleBtn('🎵', 'Музыка', isMusicOn, setMusic),
      this.toggleBtn('🔊', 'Звук', () => !isMuted(), (v) => setMuted(!v)),
      h(
        'button',
        {
          class: 'btn icon',
          title: 'Выйти в меню',
          onclick: () => {
            if (confirm(this.app.isHost ? 'Выйти? Игра прервётся для всех (её можно будет продолжить из меню).' : 'Выйти из игры?')) this.app.showMenu();
          },
        },
        '🚪',
      ),
    );
    const emotes = h(
      'div',
      { class: 'emotes' },
      ['👍', '😂', '😱', '😡', '🎉', '🙏'].map((e) => h('button', { class: 'btn icon emote', onclick: () => this.app.send({ t: 'chat', text: e }) }, e)),
    );
    const mgLayer = h('div', { class: 'mg-layer hidden' });
    this.el.append(boardWrap, this.topBar, this.hud, tools, this.status, this.actions, emotes, this.tooltip, this.overlay, mgLayer);
    this.mg = new MinigameOverlay(mgLayer, () => this.app.pid, (id, v) => this.answer(id, v));

    const scene = new BoardScene();
    this.board = scene;
    this.phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent: boardWrap,
      backgroundColor: '#1d8fc7',
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      scene: [scene],
      render: { antialias: true },
      banner: false,
    });
    this.boardReady = scene.whenReady().then(() => {
      scene.sync(this.state);
      scene.onHoverNode = (n) => {
        if (!n) return this.tooltip.classList.add('hidden');
        this.tooltip.textContent = SPACE_NAMES[n.type] + (n.id === this.state.starNode ? ' · ⭐ Здесь звезда!' : '');
        this.tooltip.classList.remove('hidden');
      };
    });
    this.renderHud();
    this.statusTimer = setInterval(() => this.renderStatus(), 500);
  }

  private toggleBtn(icon: string, title: string, get: () => boolean, set: (v: boolean) => void) {
    const b = h('button', { class: 'btn icon' + (get() ? '' : ' off'), title }, icon);
    b.addEventListener('click', () => {
      set(!get());
      b.classList.toggle('off', !get());
    });
    return b;
  }

  destroy() {
    this.destroyed = true;
    if (this.statusTimer) clearInterval(this.statusTimer);
    this.mg.destroy();
    this.phaser.destroy(true);
    this.el.remove();
  }

  // ================= Очередь сообщений =================
  onHostMsg(msg: HostMsg) {
    switch (msg.t) {
      case 'state':
        this.queue.push({ kind: 'state', state: msg.state });
        break;
      case 'ev':
        this.queue.push({ kind: 'ev', ev: msg.ev, state: msg.state, dur: msg.dur });
        break;
      case 'ask':
        this.queue.push({ kind: 'ask', ask: msg.ask, at: Date.now() });
        break;
      case 'cancelAsk':
        this.queue = this.queue.filter((q) => !(q.kind === 'ask' && q.ask.id === msg.id));
        if (this.activeAsk?.id === msg.id) this.closeAsk();
        this.mg.cancelAsk(msg.id);
        return;
      case 'chat':
        this.showChat(msg.pid, msg.text);
        return;
    }
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    await this.boardReady;
    while (this.queue.length && !this.destroyed) {
      const item = this.queue.shift()!;
      try {
        if (item.kind === 'state') {
          this.state = item.state;
          this.board.sync(item.state);
          this.renderHud();
          this.mg.update(item.state);
        } else if (item.kind === 'ask') {
          this.showAsk(item.ask, item.at);
        } else {
          await this.playEvent(item.ev, item.state, item.dur);
        }
      } catch (e) {
        console.error('event error', e);
      }
    }
    this.pumping = false;
  }

  private async playEvent(ev: GameEvent, state: GameState, dur: number) {
    const backlog = this.queue.filter((q) => q.kind === 'ev').length;
    const k = backlog > 4 ? 0.35 : backlog > 2 ? 0.7 : 1;
    const wait = dur * k;
    this.state = state;
    this.renderHud();
    const b = this.board;
    switch (ev.type) {
      case 'sync':
        if (!this.isAnimating) b.sync(state);
        break;
      case 'banner':
        this.banner(ev.text, ev.sub, ev.tone, wait);
        if (ev.tone === 'star') sfx.star();
        else if (ev.tone === 'bad') sfx.bad();
        break;
      case 'order':
        this.showOrder(ev.rolls, wait);
        break;
      case 'turnStart':
        sfx.turn();
        b.focus(ev.pid);
        this.banner(`Ходит ${state.players[ev.pid].name}`, ev.pid === this.app.pid ? 'Твой ход!' : undefined, 'info', wait, ev.pid);
        break;
      case 'roll':
        this.showDice(ev, wait);
        break;
      case 'move':
        this.isAnimating = true;
        void b.move(ev.pid, ev.path, (280 * k) | 0).then(() => (this.isAnimating = false));
        break;
      case 'teleport':
        void b.teleport(ev.pid, ev.node);
        break;
      case 'swap':
        void b.swap(ev.a, ev.b);
        break;
      case 'coins':
        b.popup(ev.pid, (ev.delta > 0 ? '+' : '') + ev.delta, ev.delta > 0 ? '#ffe14d' : '#ff6b6b', 'coin');
        if (ev.delta > 0) sfx.coinUp();
        else sfx.coinDown();
        this.pulseCard(ev.pid);
        break;
      case 'stars':
        b.popup(ev.pid, (ev.delta > 0 ? '+' : '') + ev.delta, ev.delta > 0 ? '#fff36b' : '#ff6b6b', 'starfish');
        if (ev.delta > 0) {
          sfx.star();
          this.banner(`${state.players[ev.pid].name} получает звезду!`, undefined, 'star', wait, ev.pid);
        } else sfx.bad();
        this.pulseCard(ev.pid);
        break;
      case 'land':
        b.flashNode(ev.node, b.spaceColor(ev.space as never));
        break;
      case 'starMove':
        void b.moveStar(ev.node, state.starPrice);
        this.banner('Звезда переместилась!', 'Ищите её на острове', 'star', wait);
        break;
      case 'item':
        sfx.item();
        b.popup(ev.pid, `${EMOJI[ev.item]} ${ITEMS[ev.item].name}`, '#ffffff');
        break;
      case 'card':
        this.showCard(ev.title, ev.text, ev.icon, ev.tone, wait);
        if (ev.tone === 'good') sfx.good();
        else if (ev.tone === 'bad') sfx.bad();
        break;
      case 'trap':
        break;
      case 'mg':
      case 'mgShow':
        this.mg.update(state);
        if (ev.type === 'mgShow') this.mg.show(ev.data);
        break;
      case 'bonus':
        this.showBonus(ev.award, wait);
        break;
      case 'final':
        this.showFinal(state);
        break;
    }
    b.syncExtras(state);
    if (ev.type !== 'mg' && ev.type !== 'mgShow') this.mg.update(state);
    if (wait > 0) await sleep(wait);
  }

  private isAnimating = false;

  // ================= HUD =================
  private renderHud() {
    const s = this.state;
    const rank = [...s.order].sort((a, b) => s.players[b].stars - s.players[a].stars || s.players[b].coins - s.players[a].coins);
    clear(this.hud);
    for (const pid of s.order) {
      const p = s.players[pid];
      const ch = CHAR_BY_ID[p.charId];
      const place = rank.findIndex((r) => s.players[r].stars === p.stars && s.players[r].coins === p.coins) + 1;
      this.hud.append(
        h(
          'div',
          {
            class: 'pcard' + (s.current === pid ? ' current' : '') + (pid === this.app.pid ? ' me' : '') + (!p.online ? ' offline' : ''),
            style: `--pc:${ch.color}`,
            'data-pid': pid,
          },
          h('div', { class: 'pcard-place' }, String(place)),
          h('img', { class: 'pcard-img', src: charUrl(p.charId, 96) }),
          h(
            'div',
            { class: 'pcard-body' },
            h('div', { class: 'pcard-name' }, p.name, p.isBot ? ' 🤖' : '', !p.online && !p.isBot ? ' 📴' : ''),
            h(
              'div',
              { class: 'pcard-stats' },
              h('span', { class: 'stat star' }, h('img', { src: starUrl(40) }), String(p.stars)),
              h('span', { class: 'stat coin' }, h('img', { src: coinUrl(40) }), String(p.coins)),
              h('span', { class: `side side-${p.color}`, title: 'Цвет для мини-игры' }),
            ),
            h(
              'div',
              { class: 'pcard-items' },
              p.items.map((it) => h('span', { class: 'item-chip', title: `${ITEMS[it].name}: ${ITEMS[it].desc}`, html: iconHtml(it, 20) })),
            ),
          ),
        ),
      );
    }
    clear(this.topBar);
    this.topBar.append(
      h('div', { class: 'turn' }, s.phase === 'final' ? 'Финал' : `Ход ${Math.min(s.turn, s.maxTurns)} / ${s.maxTurns}`),
      s.lastFive ? h('div', { class: 'last5' }, '🔥 Последние 5 ходов') : '',
      h('div', { class: 'chip', title: 'Цена звезды', html: `${iconHtml('star', 20)} ${s.starPrice}` }),
      h('div', { class: 'chip', title: 'Монеты в банке черепахи', html: `🐢 ${s.bank}` }),
    );
    this.renderStatus();
  }

  private renderStatus() {
    const s = this.state;
    const pr = s.prompt;
    if (!pr || pr.pid === this.app.pid || s.phase !== 'board') {
      this.status.classList.add('hidden');
      return;
    }
    const p = s.players[pr.pid];
    this.status.classList.remove('hidden');
    this.status.innerHTML = `<img src="${charUrl(p.charId, 64)}"> <b>${esc(p.name)}</b> ${PROMPT_TEXT[pr.kind] ?? 'думает'}…`;
  }

  private pulseCard(pid: string) {
    const el = this.hud.querySelector(`[data-pid="${pid}"]`);
    el?.classList.remove('pulse');
    void (el as HTMLElement | null)?.offsetWidth;
    el?.classList.add('pulse');
  }

  private showChat(pid: string, text: string) {
    const card = this.hud.querySelector(`[data-pid="${pid}"]`);
    if (!card) return;
    const bubble = h('div', { class: 'chat-bubble' }, text);
    card.append(bubble);
    setTimeout(() => bubble.remove(), 3000);
  }

  // ================= Всплывающие окна =================
  private banner(text: string, sub: string | undefined, tone: string | undefined, ms: number, pid?: string) {
    const el = h(
      'div',
      { class: `banner tone-${tone ?? 'info'}` },
      pid ? h('img', { src: charUrl(this.state.players[pid].charId, 128) }) : null,
      h('div', {}, h('div', { class: 'banner-text' }, text), sub ? h('div', { class: 'banner-sub' }, sub) : null),
    );
    this.overlay.append(el);
    setTimeout(() => el.classList.add('out'), Math.max(600, ms - 300));
    setTimeout(() => el.remove(), Math.max(900, ms));
  }

  private showCard(title: string, text: string, icon: string, tone: string | undefined, ms: number) {
    const el = h('div', { class: `event-card tone-${tone ?? 'info'}` }, h('div', { class: 'event-icon', html: iconHtml(icon, 64) }), h('div', { class: 'event-title' }, title), h('div', { class: 'event-text' }, text));
    this.overlay.append(el);
    setTimeout(() => el.classList.add('out'), Math.max(600, ms - 250));
    setTimeout(() => el.remove(), Math.max(800, ms));
  }

  private showDice(ev: Extract<GameEvent, { type: 'roll' }>, ms: number) {
    const p = this.state.players[ev.pid];
    const dice = ev.values.map(() => h('div', { class: 'die' }, '?'));
    const total = h('div', { class: 'dice-total' }, '');
    const label = ev.kind === 'char' ? `Кубик ${CHAR_BY_ID[p.charId].name}` : ev.kind === 'item' ? 'Кубик-предмет' : 'Обычный кубик';
    const el = h('div', { class: 'dice-pop' }, h('div', { class: 'dice-label' }, `${p.name}: ${label}`), h('div', { class: 'dice-row' }, dice), total);
    this.overlay.append(el);
    const spin = Math.min(900, ms * 0.5);
    const t0 = performance.now();
    const charFaces = CHAR_BY_ID[p.charId].dice;
    const iv = setInterval(() => {
      sfx.diceTick();
      dice.forEach((d) => (d.textContent = ev.kind === 'char' ? faceLabel(charFaces[Math.floor(Math.random() * charFaces.length)]) : String(1 + Math.floor(Math.random() * 10))));
      if (performance.now() - t0 > spin) {
        clearInterval(iv);
        dice.forEach((d, i) => {
          d.textContent = ev.face ? faceLabel(ev.face) : String(ev.values[i]);
          d.classList.add('final');
        });
        if (ev.values.length > 1) total.textContent = `= ${ev.total}`;
        sfx.diceStop();
      }
    }, 70);
    setTimeout(() => el.classList.add('out'), Math.max(700, ms - 200));
    setTimeout(() => {
      clearInterval(iv);
      el.remove();
    }, Math.max(900, ms + 100));
  }

  private showOrder(rolls: Record<string, number>, ms: number) {
    const s = this.state;
    const el = h(
      'div',
      { class: 'modal-pop order-pop' },
      h('h2', {}, 'Кто ходит первым?'),
      h('p', {}, 'Все бросают кубик — у кого больше, тот и начинает.'),
      h(
        'div',
        { class: 'order-list' },
        s.order.map((pid, i) =>
          h(
            'div',
            { class: 'order-row', style: `animation-delay:${i * 250}ms` },
            h('span', { class: 'order-place' }, `${i + 1}.`),
            h('img', { src: charUrl(s.players[pid].charId, 64) }),
            h('span', { class: 'order-name' }, s.players[pid].name),
            h('span', { class: 'die small final' }, String(rolls[pid])),
          ),
        ),
      ),
    );
    this.overlay.append(el);
    sfx.diceStop();
    setTimeout(() => el.remove(), ms);
  }

  private showBonus(a: { name: string; desc: string; winners: string[] }, ms: number) {
    const s = this.state;
    sfx.star();
    const el = h(
      'div',
      { class: 'modal-pop bonus-pop' },
      h('img', { class: 'bonus-star', src: starUrl(160) }),
      h('h2', {}, a.name),
      h('p', {}, `За то, что ${a.desc}`),
      h(
        'div',
        { class: 'bonus-winners' },
        a.winners.length
          ? a.winners.map((w) => h('div', { class: 'bonus-winner' }, h('img', { src: charUrl(s.players[w].charId, 96) }), h('div', {}, s.players[w].name)))
          : h('div', {}, 'Никто не заслужил…'),
      ),
    );
    this.overlay.append(el);
    setTimeout(() => el.remove(), ms);
  }

  private showFinal(s: GameState) {
    sfx.win();
    this.closeAsk();
    const medals = ['🥇', '🥈', '🥉'];
    const top = s.ranking[0];
    const el = h(
      'div',
      { class: 'final-screen' },
      h(
        'div',
        { class: 'panel final' },
        h('h1', { html: `${iconHtml('trophy', 56)} Победитель` }),
        h('img', { class: 'final-winner', src: charUrl(s.players[top].charId, 256) }),
        h('h2', {}, s.players[top].name),
        h(
          'table',
          { class: 'final-table' },
          h('tr', {}, h('th', {}, ''), h('th', {}, 'Игрок'), h('th', {}, '⭐'), h('th', {}, '💰'), h('th', {}, 'Мини-игры'), h('th', {}, 'Шагов')),
          s.ranking.map((pid, i) => {
            const p = s.players[pid];
            return h(
              'tr',
              { class: pid === this.app.pid ? 'me' : '' },
              h('td', {}, medals[i] ?? String(i + 1)),
              h('td', {}, h('img', { src: charUrl(p.charId, 48) }), ' ', p.name),
              h('td', {}, String(p.stars)),
              h('td', {}, String(p.coins)),
              h('td', {}, `+${p.stats.mgCoins}`),
              h('td', {}, String(p.stats.steps)),
            );
          }),
        ),
        h('div', { class: 'final-bonus' }, s.bonus.map((b) => h('div', {}, `⭐ ${b.name}: ${b.winners.map((w) => s.players[w].name).join(', ') || '—'}`))),
        h('button', { class: 'btn primary big', onclick: () => this.app.showMenu() }, 'В главное меню'),
      ),
    );
    this.overlay.append(el);
  }

  // ================= Вопросы игроку =================
  private answer(id: number, value: unknown) {
    sfx.click();
    this.app.send({ t: 'answer', id, value });
  }

  private closeAsk() {
    this.activeAsk?.close();
    this.activeAsk = null;
    clear(this.actions);
    this.actions.classList.remove('show');
    this.board?.clearBranch();
  }

  private showAsk(ask: Ask, receivedAt: number) {
    if (ask.kind === 'mg' || ask.kind === 'mgReady') {
      this.mg.update(this.state);
      this.mg.ask(ask, receivedAt);
      return;
    }
    this.closeAsk();
    const left = Math.max(1000, ask.timeout - (Date.now() - receivedAt));
    const done = (v: unknown) => {
      this.answer(ask.id, v);
      this.closeAsk();
    };
    const panel = h('div', { class: 'ask-panel' });
    this.actions.append(panel);
    this.actions.classList.add('show');
    this.activeAsk = { id: ask.id, close: () => panel.remove() };
    const me = this.state.players[this.app.pid!];
    const d = ask.data;
    const title = (t: string) => h('div', { class: 'ask-title' }, t);
    const row = (...kids: (HTMLElement | null | false)[]) => h('div', { class: 'ask-row' }, ...kids);
    const btn = (label: string | HTMLElement, onclick: () => void, cls = '', disabled = false, tip = '') =>
      h('button', { class: 'btn ' + cls, onclick, disabled, title: tip }, label);
    const playerBtn = (pid: string, onclick: () => void, extra = '', disabled = false) => {
      const p = this.state.players[pid];
      return h(
        'button',
        { class: 'btn player-btn', onclick, disabled, style: `--pc:${CHAR_BY_ID[p.charId].color}` },
        h('img', { src: charUrl(p.charId, 64) }),
        h('span', {}, p.name),
        h('small', {}, `⭐${p.stars} 💰${p.coins}${extra}`),
      );
    };

    switch (ask.kind) {
      case 'turn': {
        const ch = CHAR_BY_ID[me.charId];
        sfx.turn();
        panel.append(
          title(d.usedItem ? 'Теперь бросай кубик!' : 'Твой ход! Что делаем?'),
          row(
            btn(h('span', {}, '🎲 Обычный кубик ', h('small', {}, '1–10')), () => done({ roll: 'normal' }), 'primary big'),
            btn(
              h('span', { class: 'char-dice-btn' }, h('img', { src: charUrl(me.charId, 48) }), `Кубик ${ch.name} `, h('small', {}, ch.dice.map(faceLabel).join(' · '))),
              () => done({ roll: 'char' }),
              'big',
              false,
              ch.diceDesc,
            ),
          ),
          (d.items as ItemId[]).length
            ? row(
                ...(d.items as ItemId[]).map((it, i) =>
                  btn(
                    h('span', { html: `${iconHtml(it, 22)} ${ITEMS[it].name}` }),
                    () => done({ item: i }),
                    'item-btn',
                    !d.usable[i],
                    ITEMS[it].desc + (d.usable[i] ? '' : ' (сейчас нельзя)'),
                  ),
                ),
              )
            : '',
        );
        break;
      }
      case 'branch': {
        const opts = d.options as number[];
        panel.append(
          title('Развилка! Куда идём?'),
          row(...opts.map((node, i) => btn(ROUTE_NAMES[this.board.board.nodes[node].route] ?? `Путь ${i + 1}`, () => done(i), 'big'))),
          h('div', { class: 'ask-hint' }, 'Можно кликнуть по подсвеченной клетке на карте.'),
        );
        this.board.showBranch(opts, (i) => done(i));
        break;
      }
      case 'buyStar':
        sfx.star();
        panel.append(
          h('div', { class: 'ask-star' }, h('img', { src: starUrl(96) })),
          title(`Купить звезду за ${d.price} монет?`),
          row(btn('⭐ Да, беру!', () => done(true), 'primary big'), btn('Нет', () => done(false), 'big')),
        );
        break;
      case 'shop': {
        panel.append(
          title(`🦜 Лавка попугая. У тебя ${me.coins} монет`),
          row(
            ...(d.offer as { id: ItemId; price: number }[]).map((o) =>
              btn(
                h('span', { class: 'shop-item', html: `${iconHtml(o.id, 30)}<b>${ITEMS[o.id].name}</b><small>${ITEMS[o.id].desc}</small><span class="price">${o.price} 💰</span>` }),
                () => done(o.id),
                'shop-btn',
                o.price > me.coins,
              ),
            ),
          ),
          row(btn('Ничего не нужно', () => done(null))),
        );
        break;
      }
      case 'thief': {
        const others = d.others as { pid: string; coins: number; stars: number }[];
        const pickTarget = (mode: 'coins' | 'star') => {
          clear(panel);
          panel.append(
            title(mode === 'coins' ? 'У кого украсть монеты?' : 'У кого украсть звезду?'),
            row(...others.map((o) => playerBtn(o.pid, () => done({ mode, target: o.pid }), '', mode === 'star' && o.stars === 0))),
            row(btn('← Назад', () => render())),
            timerBar(left),
          );
        };
        const render = () => {
          clear(panel);
          panel.append(
            title('🐒 Мартышка-воришка: «Чего изволите?»'),
            row(
              btn(`Украсть монеты (${d.coinCost} 💰)`, () => pickTarget('coins'), 'big', me.coins < d.coinCost),
              btn(`Украсть звезду (${d.starCost} 💰)`, () => pickTarget('star'), 'big gold', me.coins < d.starCost || !others.some((o) => o.stars > 0)),
              btn('Уйти', () => done(null), 'big'),
            ),
            timerBar(left),
          );
        };
        render();
        return;
      }
      case 'target': {
        const reason = d.reason as string;
        const t = reason === 'swap' ? 'С кем поменяться местами?' : reason === 'paw' ? 'У кого украсть монеты?' : 'Выбери игрока';
        panel.append(title(t), row(...(d.options as string[]).map((pid) => playerBtn(pid, () => done(pid)))));
        break;
      }
      case 'duel': {
        let wager = (d.wagers as number[])[0];
        const wRow = row(
          h('span', {}, 'Ставка: '),
          ...(d.wagers as number[]).map((w) => {
            const b = btn(w ? `${w} 💰` : 'без ставки', () => {
              wager = w;
              wRow.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
              b.classList.add('active');
            });
            if (w === wager) b.classList.add('active');
            return b;
          }),
        );
        panel.append(title('⚔ Дуэль! Выбери соперника и ставку'), wRow, row(...(d.opponents as string[]).map((pid) => playerBtn(pid, () => done({ target: pid, wager })))));
        break;
      }
      case 'customDice':
        panel.append(title('🎯 Сколько шагов пройти?'), row(...Array.from({ length: 10 }, (_, i) => btn(String(i + 1), () => done(i + 1), 'num'))));
        break;
    }
    panel.append(timerBar(left));
  }
}

