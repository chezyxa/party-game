import { CHAR_BY_ID } from '../../core/characters';
import { FORMAT_NAMES, MG_BY_ID } from '../../core/minigames';
import type { Ask, GameState, MinigameInfo } from '../../core/types';
import { charUrl, iconHtml } from '../art';
import { sfx } from '../audio';
import { clear, h, timerBar } from '../dom';
import { CHOICE_UIS } from './choiceUi';
import { SKILL_UIS } from './skillUi';
import type { MgEnv, MgUI } from './types';

const FACTORIES: Record<string, (env: MgEnv) => MgUI> = { ...CHOICE_UIS, ...SKILL_UIS };

export class MinigameOverlay {
  private key = '';
  private stage = '';
  private ui: MgUI | null = null;
  private state: GameState | null = null;
  private readyAsk: number | null = null;
  private readyBtn: HTMLButtonElement | null = null;
  private readyList: HTMLElement | null = null;
  private body!: HTMLElement;

  constructor(
    private layer: HTMLElement,
    private me: () => string | null,
    private answer: (id: number, v: unknown) => void,
  ) {}

  private env(mg: MinigameInfo): MgEnv {
    const s = this.state!;
    const me = this.me();
    return {
      me,
      mg,
      state: s,
      playing: !!me && mg.players.includes(me),
      name: (pid) => s.players[pid]?.name ?? '?',
      char: (pid) => s.players[pid]?.charId ?? 'kapi',
      color: (pid) => CHAR_BY_ID[s.players[pid]?.charId]?.color ?? '#888',
    };
  }

  update(s: GameState) {
    this.state = s;
    const mg = s.mg;
    if (s.phase !== 'minigame' || !mg) {
      if (this.key) this.close();
      return;
    }
    const key = `${mg.id}|${mg.players.join(',')}|${s.turn}`;
    if (key !== this.key) {
      this.close();
      this.key = key;
      this.layer.classList.remove('hidden');
    }
    if (mg.stage === this.stage) return;
    this.stage = mg.stage;
    if (mg.stage === 'intro') this.renderIntro(mg);
    else if (mg.stage === 'play') this.renderPlay(mg);
    else this.renderResults(mg);
  }

  private frame(mg: MinigameInfo, sub: string) {
    const def = MG_BY_ID[mg.id];
    clear(this.layer);
    this.body = h('div', { class: 'mg-body' });
    this.layer.append(
      h(
        'div',
        { class: 'mg-panel' },
        h(
          'div',
          { class: 'mg-head' },
          h('div', { class: 'mg-icon', html: iconHtml(def.icon, 44) }),
          h('div', {}, h('div', { class: 'mg-title' }, def.name), h('div', { class: 'mg-sub' }, `${FORMAT_NAMES[mg.format]}${mg.wager ? ` · ставка ${mg.wager} 💰` : ''} · ${sub}`)),
        ),
        this.body,
      ),
    );
  }

  private teamsView(mg: MinigameInfo) {
    const env = this.env(mg);
    const chip = (pid: string) => h('div', { class: 'mg-chip', style: `--pc:${env.color(pid)}`, 'data-pid': pid }, h('img', { src: charUrl(env.char(pid), 64) }), h('span', {}, env.name(pid)));
    if (mg.teams) {
      const a = mg.format === '1v' ? 'Одиночка' : 'Синие';
      const b = mg.format === '1v' ? 'Команда' : 'Красные';
      return h(
        'div',
        { class: 'mg-teams' },
        h('div', { class: 'team team-a' }, h('div', { class: 'team-name' }, a), mg.teams.a.map(chip)),
        h('div', { class: 'vs' }, 'VS'),
        h('div', { class: 'team team-b' }, h('div', { class: 'team-name' }, b), mg.teams.b.map(chip)),
      );
    }
    return h('div', { class: 'mg-teams ffa' }, mg.players.map(chip));
  }

  private renderIntro(mg: MinigameInfo) {
    const def = MG_BY_ID[mg.id];
    sfx.star();
    this.frame(mg, 'правила');
    this.readyList = this.teamsView(mg);
    this.readyBtn = h('button', { class: 'btn primary big', disabled: true }, 'Готов!');
    this.readyBtn.addEventListener('click', () => {
      if (this.readyAsk === null) return;
      this.answer(this.readyAsk, true);
      this.readyAsk = null;
      this.readyBtn!.disabled = true;
      this.readyBtn!.textContent = 'Ждём остальных…';
    });
    const playing = this.env(mg).playing;
    this.body.append(
      this.readyList,
      h('div', { class: 'mg-rules' }, def.rules),
      h('div', { class: 'mg-controls' }, '🎮 ', def.controls),
      def.kind === 'skill' ? h('div', { class: 'mg-note' }, 'Каждый играет у себя — пинг не влияет на результат.') : '',
      playing ? this.readyBtn : h('div', { class: 'mg-note' }, 'Вы наблюдаете за этой мини-игрой.'),
    );
    if (this.readyAsk !== null) this.enableReady();
  }

  private enableReady() {
    if (!this.readyBtn) return;
    this.readyBtn.disabled = false;
    this.readyBtn.textContent = 'Готов!';
    this.readyBtn.parentElement?.append(timerBar(20000));
  }

  private renderPlay(mg: MinigameInfo) {
    this.frame(mg, 'игра');
    const factory = FACTORIES[mg.id];
    this.ui = factory(this.env(mg));
    this.body.append(this.ui.root);
  }

  private renderResults(mg: MinigameInfo) {
    this.ui?.destroy();
    this.ui = null;
    const r = mg.results!;
    const env = this.env(mg);
    this.frame(mg, 'итоги');
    const me = this.me();
    if (me && r.winners.includes(me)) sfx.win();
    else sfx.good();
    const sorted = [...mg.players].sort((a, b) => r.scores[b] - r.scores[a]);
    this.body.append(
      h('div', { class: 'mg-result-text' }, r.text),
      h(
        'div',
        { class: 'mg-results' },
        sorted.map((pid) =>
          h(
            'div',
            { class: 'mg-res-row' + (r.winners.includes(pid) ? ' win' : ''), style: `--pc:${env.color(pid)}` },
            h('img', { src: charUrl(env.char(pid), 64) }),
            h('span', { class: 'n' }, env.name(pid)),
            h('span', { class: 's' }, `${formatScore(mg.id, r.scores[pid])}`),
            h('span', { class: 'c' + ((r.coins[pid] ?? 0) < 0 ? ' neg' : '') }, `${(r.coins[pid] ?? 0) >= 0 ? '+' : ''}${r.coins[pid] ?? 0} 💰`),
          ),
        ),
      ),
    );
  }

  ask(ask: Ask, receivedAt: number) {
    const left = Math.max(1000, ask.timeout - (Date.now() - receivedAt));
    if (ask.kind === 'mgReady') {
      this.readyAsk = ask.id;
      this.enableReady();
      return;
    }
    if (!this.ui) return;
    let answered = false;
    this.ui.ask(
      ask.data,
      (v) => {
        if (answered) return;
        answered = true;
        this.answer(ask.id, v);
      },
      left,
    );
  }

  cancelAsk(id: number) {
    if (this.readyAsk === id) {
      this.readyAsk = null;
      if (this.readyBtn) {
        this.readyBtn.disabled = true;
        this.readyBtn.textContent = 'Начинаем!';
      }
      return;
    }
    this.ui?.cancel();
  }

  show(data: any) {
    if (data?.stage === 'ready' && this.readyList) {
      for (const pid of data.ready as string[]) this.readyList.querySelector(`[data-pid="${pid}"]`)?.classList.add('ready');
      return;
    }
    this.ui?.show(data);
  }

  private close() {
    this.ui?.destroy();
    this.ui = null;
    this.key = '';
    this.stage = '';
    this.readyAsk = null;
    this.readyBtn = null;
    this.readyList = null;
    clear(this.layer);
    this.layer.classList.add('hidden');
  }

  destroy() {
    this.close();
  }
}

function formatScore(id: string, s: number): string {
  if (id === 'auction') return `${Math.floor(s / 100)} очк. (ост. ${s % 100})`;
  if (id === 'hide') return s ? 'победа' : '—';
  return `${s} очк.`;
}
