import { charUrl } from '../art';
import { sfx } from '../audio';
import { clear, h, timerBar } from '../dom';
import type { MgEnv, MgUI } from './types';

/** Общая заготовка для игр с одновременным выбором. */
abstract class ChoiceUI implements MgUI {
  root = h('div', { class: 'mg-game choice' });
  protected stage = h('div', { class: 'mg-stage' });
  protected info = h('div', { class: 'mg-info' });
  protected foot = h('div', { class: 'mg-foot' });
  protected respond: ((v: unknown) => void) | null = null;

  constructor(protected env: MgEnv) {
    this.root.append(this.info, this.stage, this.foot);
    this.waiting();
  }

  protected waiting(text = 'Ждём ход остальных…') {
    clear(this.foot);
    this.foot.append(h('div', { class: 'mg-wait' }, this.env.playing ? text : 'Вы наблюдаете. Игроки делают выбор…'));
  }

  protected prompt(text: string, timeout: number) {
    clear(this.foot);
    this.foot.append(h('div', { class: 'mg-prompt' }, text), timerBar(timeout));
  }

  protected choose(v: unknown) {
    if (!this.respond) return;
    sfx.click();
    this.respond(v);
    this.respond = null;
    this.waiting();
  }

  protected face(pid: string, size = 40) {
    return h('img', { class: 'face-mini', src: charUrl(this.env.char(pid), 64), width: size, height: size, title: this.env.name(pid), style: `--pc:${this.env.color(pid)}` });
  }

  protected scoreTable(score: Record<string, number>, label = 'очк.') {
    const pids = [...this.env.mg.players].sort((a, b) => score[b] - score[a]);
    return h(
      'div',
      { class: 'mg-score' },
      pids.map((p) => h('div', { class: 'mg-score-row', style: `--pc:${this.env.color(p)}` }, this.face(p, 28), h('span', {}, this.env.name(p)), h('b', {}, `${score[p]} ${label}`))),
    );
  }

  abstract ask(data: any, respond: (v: unknown) => void, timeout: number): void;
  abstract show(data: any): void;

  cancel() {
    this.respond = null;
    this.waiting('Время вышло — выбор сделан автоматически.');
  }

  destroy() {
    this.respond = null;
  }
}

// ------------------------------------------------------------
class ChestsUI extends ChoiceUI {
  private buttons: HTMLButtonElement[] = [];

  private render(values: (number | null)[], round: number, clickable: boolean) {
    clear(this.stage);
    clear(this.info);
    this.info.append(h('div', { class: 'mg-round' }, `Раунд ${round} из 3`));
    this.buttons = values.map((v, i) =>
      h(
        'button',
        { class: 'chest' + (v === null ? ' mystery' : ''), disabled: !clickable, onclick: () => this.pick(i) },
        h('div', { class: 'chest-icon' }, '🧰'),
        h('div', { class: 'chest-val' }, v === null ? '?' : `${v} 💰`),
        h('div', { class: 'chest-who' }),
      ),
    );
    this.stage.append(h('div', { class: 'chest-row' }, this.buttons));
  }

  private pick(i: number) {
    this.buttons.forEach((b, j) => {
      b.disabled = true;
      b.classList.toggle('picked', i === j);
    });
    this.choose(i);
  }

  ask(d: any, respond: (v: unknown) => void, timeout: number) {
    this.respond = respond;
    this.render(d.values, d.round, true);
    this.info.append(this.scoreTable(d.score, '💰'));
    this.prompt('Выбери сундук!', timeout);
  }

  show(d: any) {
    if (d.stage !== 'reveal') return;
    sfx.coinUp();
    this.render(d.values, d.round, false);
    this.buttons.forEach((b, i) => {
      b.classList.add('open');
      const who = b.querySelector('.chest-who')!;
      for (const p of this.env.mg.players) if (d.picks[p] === i) who.append(this.face(p, 32));
    });
    clear(this.foot);
    this.foot.append(
      h(
        'div',
        { class: 'mg-gains' },
        this.env.mg.players.map((p) => h('span', { class: 'gain' }, this.face(p, 24), ` +${d.gains[p] ?? 0}`)),
      ),
    );
    this.info.append(this.scoreTable(d.score, '💰'));
  }
}

// ------------------------------------------------------------
class AuctionUI extends ChoiceUI {
  private lotsView(lots: number[], current: number) {
    return h(
      'div',
      { class: 'lots' },
      lots.map((v, i) => h('div', { class: 'lot' + (i === current ? ' current' : i < current ? ' done' : '') }, h('div', { class: 'lot-n' }, `Лот ${i + 1}`), h('div', { class: 'lot-v' }, `${v} очк.`))),
    );
  }

  ask(d: any, respond: (v: unknown) => void, timeout: number) {
    this.respond = respond;
    clear(this.info);
    clear(this.stage);
    this.info.append(this.lotsView(d.lots, d.lot), h('div', { class: 'mg-round' }, `У тебя: ${d.budget} 🐚 · очков: ${d.points}`));
    let bid = 0;
    const val = h('div', { class: 'bid-val' }, '0');
    const range = h('input', { type: 'range', min: 0, max: d.budget, value: 0, class: 'bid-range' });
    range.addEventListener('input', () => {
      bid = Number(range.value);
      val.textContent = String(bid);
    });
    const quick = h(
      'div',
      { class: 'ask-row' },
      [0, 1, 2, 3, 5, 8].filter((x) => x <= d.budget).map((x) =>
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              bid = x;
              range.value = String(x);
              val.textContent = String(x);
            },
          },
          String(x),
        ),
      ),
    );
    const go = h('button', { class: 'btn primary big', onclick: () => this.choose(bid) }, 'Ставлю!');
    this.stage.append(h('div', { class: 'bid-box' }, h('div', {}, `Сколько ракушек ставишь за лот ${d.lot + 1} (${d.lots[d.lot]} очк.)?`), val, range, quick, go));
    this.prompt('Тайная ставка', timeout);
  }

  show(d: any) {
    if (d.stage !== 'reveal') return;
    sfx.coinUp();
    clear(this.info);
    clear(this.stage);
    this.info.append(this.lotsView(d.lots, d.lot));
    const max = Math.max(...this.env.mg.players.map((p) => d.bids[p]));
    this.stage.append(
      h(
        'div',
        { class: 'bids' },
        this.env.mg.players.map((p) =>
          h('div', { class: 'bid' + (d.winner === p ? ' win' : d.bids[p] === max && max > 0 ? ' tie' : '') }, this.face(p, 40), h('div', {}, this.env.name(p)), h('b', {}, `${d.bids[p]} 🐚`)),
        ),
      ),
      h('div', { class: 'mg-result-text small' }, d.winner ? `Лот забирает ${this.env.name(d.winner)}!` : 'Ничья — лот сгорает!'),
    );
    clear(this.foot);
    const tbl: Record<string, number> = {};
    for (const p of this.env.mg.players) tbl[p] = d.points[p];
    this.foot.append(this.scoreTable(tbl));
  }
}

// ------------------------------------------------------------
class VolcanoUI extends ChoiceUI {
  ask(d: any, respond: (v: unknown) => void, timeout: number) {
    this.respond = respond;
    clear(this.info);
    clear(this.stage);
    this.info.append(h('div', { class: 'mg-round' }, `Раунд ${d.round} из 8 · Риск извержения: ${Math.round(d.risk * 100)}%`));
    this.stage.append(
      h(
        'div',
        { class: 'volcano-box' },
        h('div', { class: 'volcano-emoji', style: `--shake:${d.risk}` }, '🌋'),
        h('div', {}, `В мешке: ${d.bag} 💎 · Спрятано: ${d.banked} 💎`),
        h(
          'div',
          { class: 'ask-row' },
          h('button', { class: 'btn primary big', onclick: () => this.choose('dig') }, '⛏ Копать дальше'),
          h('button', { class: 'btn big gold', onclick: () => this.choose('leave') }, '🏃 Уйти с добычей'),
        ),
      ),
    );
    this.prompt('Рискнёшь?', timeout);
  }

  show(d: any) {
    if (d.stage !== 'reveal') return;
    clear(this.info);
    clear(this.stage);
    this.info.append(h('div', { class: 'mg-round' }, `Раунд ${d.round}`));
    if (d.erupted) sfx.erupt();
    else if (d.diggers.length) sfx.coinUp();
    this.stage.append(
      h(
        'div',
        { class: 'volcano-box' + (d.erupted ? ' erupted' : '') },
        h('div', { class: 'volcano-emoji' }, d.erupted ? '💥' : '🌋'),
        h(
          'div',
          { class: 'mg-result-text small' },
          d.erupted ? 'ИЗВЕРЖЕНИЕ! Копавшие теряют добычу!' : d.diggers.length ? `Нашли по ${d.gem} 💎!` : 'Все ушли.',
        ),
        d.leavers.length ? h('div', {}, 'Ушли: ', d.leavers.map((p: string) => this.face(p, 28))) : null,
        d.diggers.length ? h('div', {}, 'Копают: ', d.diggers.map((p: string) => this.face(p, 28))) : null,
      ),
    );
    clear(this.foot);
    this.foot.append(
      h(
        'div',
        { class: 'mg-score' },
        this.env.mg.players.map((p) =>
          h('div', { class: 'mg-score-row', style: `--pc:${this.env.color(p)}` }, this.face(p, 28), h('span', {}, this.env.name(p)), h('b', {}, `спрятано ${d.banked[p]} 💎 · в мешке ${d.bag[p]}`)),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------
class UniqueUI extends ChoiceUI {
  ask(d: any, respond: (v: unknown) => void, timeout: number) {
    this.respond = respond;
    clear(this.info);
    clear(this.stage);
    this.info.append(h('div', { class: 'mg-round' }, `Раунд ${d.round} из 4`), this.scoreTable(d.score));
    const btns = [1, 2, 3, 4, 5].map((n) =>
      h(
        'button',
        {
          class: 'shell-btn',
          onclick: () => {
            btns.forEach((b) => (b.disabled = true));
            btns[n - 1].classList.add('picked');
            this.choose(n);
          },
        },
        h('div', {}, '🐚'.repeat(Math.min(n, 3)) + (n > 3 ? '…' : '')),
        h('b', {}, String(n)),
      ),
    );
    this.stage.append(h('div', { class: 'shell-row' }, btns));
    this.prompt('Сколько ракушек выложишь? Уникальное число приносит очки.', timeout);
  }

  show(d: any) {
    if (d.stage !== 'reveal') return;
    sfx.coinUp();
    clear(this.info);
    clear(this.stage);
    this.info.append(h('div', { class: 'mg-round' }, `Раунд ${d.round}`));
    this.stage.append(
      h(
        'div',
        { class: 'shell-row' },
        [1, 2, 3, 4, 5].map((n) => {
          const who = this.env.mg.players.filter((p) => d.picks[p] === n);
          return h('div', { class: 'shell-col' + (who.length === 1 ? ' uniq' : who.length > 1 ? ' clash' : '') }, h('b', {}, String(n)), who.map((p) => this.face(p, 32)));
        }),
      ),
    );
    clear(this.foot);
    this.foot.append(this.scoreTable(d.score));
  }
}

// ------------------------------------------------------------
class HideUI extends ChoiceUI {
  ask(d: any, respond: (v: unknown) => void, timeout: number) {
    this.respond = respond;
    clear(this.info);
    clear(this.stage);
    const hider = d.role === 'hide';
    this.info.append(h('div', { class: 'mg-round' }, `Раунд ${d.round} из 2 · ${hider ? 'Ты прячешься!' : 'Ты ищешь!'}`));
    const btns: HTMLButtonElement[] = [];
    for (let i = 0; i < d.bushes; i++) {
      const b = h(
        'button',
        {
          class: 'bush',
          onclick: () => {
            btns.forEach((x) => (x.disabled = true));
            b.classList.add('picked');
            this.choose(i);
          },
        },
        '🌿',
      );
      btns.push(b);
    }
    this.stage.append(h('div', { class: 'bush-grid' }, btns));
    this.prompt(hider ? 'Выбери куст, в котором спрячешься' : 'Выбери куст, который проверишь', timeout);
  }

  show(d: any) {
    if (d.stage !== 'reveal') return;
    if (d.found) sfx.good();
    else sfx.whoosh();
    clear(this.stage);
    const cells = [];
    for (let i = 0; i < d.bushes; i++) {
      const seekers = this.env.mg.players.filter((p) => p !== d.solo && d.picks[p] === i);
      const hidden = d.picks[d.solo] === i;
      cells.push(h('div', { class: 'bush open' + (hidden ? ' hidden-here' : '') + (hidden && seekers.length ? ' found' : '') }, hidden ? this.face(d.solo, 40) : '🌿', h('div', { class: 'seekers' }, seekers.map((p) => this.face(p, 24)))));
    }
    this.stage.append(h('div', { class: 'bush-grid' }, cells));
    clear(this.foot);
    this.foot.append(h('div', { class: 'mg-result-text small' }, d.found ? 'Нашли!' : d.round < 2 ? 'Не нашли… ещё раунд!' : 'Не нашли!'));
  }
}

export const CHOICE_UIS: Record<string, (env: MgEnv) => MgUI> = {
  chests: (e) => new ChestsUI(e),
  auction: (e) => new AuctionUI(e),
  volcano: (e) => new VolcanoUI(e),
  unique: (e) => new UniqueUI(e),
  hide: (e) => new HideUI(e),
};
