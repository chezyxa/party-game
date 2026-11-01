import {
  catchLevel,
  CATCH_DURATION,
  countLevel,
  countRoundScore,
  COUNT_ROUND_TIME,
  FRUIT_POINTS,
  MEMORY_PAIRS,
  MEMORY_SYMBOLS,
  MEMORY_TIME,
  memoryLevel,
  simonLevel,
  SIMON_MAX,
  SIMON_TIME,
  timingLevel,
  timingScore,
  TIMING_THROWS,
} from '../../core/minigames/skill';
import { charUrl, EMOJI, iconHtml } from '../art';
import { sfx } from '../audio';
import { clear, h, sleep } from '../dom';
import type { MgEnv, MgUI } from './types';

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/** Общая заготовка навыковой игры: отсчёт, локальная игра, отправка счёта. */
abstract class SkillUI implements MgUI {
  root = h('div', { class: 'mg-game skill' });
  protected stage = h('div', { class: 'mg-stage' });
  protected hud = h('div', { class: 'mg-skill-hud' });
  protected foot = h('div', { class: 'mg-foot' });
  protected alive = true;
  private cleanups: (() => void)[] = [];
  private respond: ((v: unknown) => void) | null = null;

  constructor(protected env: MgEnv) {
    this.root.append(this.hud, this.stage, this.foot);
    clear(this.foot);
    this.foot.append(h('div', { class: 'mg-wait' }, env.playing ? 'Приготовься…' : 'Игроки проходят испытание. Вы наблюдаете.'));
    this.progress([]);
  }

  protected on<K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) {
    window.addEventListener(type, fn);
    this.cleanups.push(() => window.removeEventListener(type, fn));
  }

  protected loop(fn: (dt: number, t: number) => boolean) {
    let last = performance.now();
    const t0 = last;
    const step = (now: number) => {
      if (!this.alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (fn(dt, (now - t0) / 1000)) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  protected canvas(w: number, hh: number) {
    const c = h('canvas', { width: w, height: hh, class: 'mg-canvas' });
    return [c, c.getContext('2d')!] as const;
  }

  private progress(done: string[]) {
    clear(this.hud);
    this.hud.append(
      h(
        'div',
        { class: 'mg-progress' },
        this.env.mg.players.map((p) =>
          h(
            'span',
            { class: 'mg-chip small' + (done.includes(p) ? ' ready' : ''), style: `--pc:${this.env.color(p)}` },
            h('img', { src: charUrl(this.env.char(p), 48) }),
            this.env.name(p),
            done.includes(p) ? ' ✔' : '',
          ),
        ),
      ),
    );
  }

  async ask(d: any, respond: (v: unknown) => void, _timeout: number) {
    this.respond = respond;
    clear(this.foot);
    const cd = h('div', { class: 'countdown' }, '3');
    this.stage.append(cd);
    for (const n of ['3', '2', '1']) {
      cd.textContent = n;
      sfx.tick();
      await sleep(700);
      if (!this.alive) return;
    }
    cd.remove();
    sfx.good();
    const score = await this.play(d.seed);
    if (!this.alive) return;
    this.finish(score);
  }

  protected finish(score: number) {
    if (!this.respond) return;
    this.respond(Math.round(score));
    this.respond = null;
    clear(this.foot);
    this.foot.append(h('div', { class: 'mg-wait' }, `Твой результат: ${Math.round(score)}. Ждём остальных…`));
  }

  protected abstract play(seed: number): Promise<number>;

  show(d: any) {
    if (d.stage === 'progress') this.progress(d.done);
  }

  cancel() {
    this.respond = null;
  }

  destroy() {
    this.alive = false;
    this.cleanups.forEach((c) => c());
  }
}

// ------------------------------------------------------------
class CatchUI extends SkillUI {
  protected play(seed: number): Promise<number> {
    return new Promise((resolve) => {
      const W = 760;
      const H = 460;
      const [c, ctx] = this.canvas(W, H);
      this.stage.append(c);
      const level = catchLevel(seed).map((f) => ({ ...f, done: false }));
      let x = W / 2;
      let score = 0;
      const keys = { l: false, r: false };
      this.on('keydown', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'ф') keys.l = true;
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'в') keys.r = true;
      });
      this.on('keyup', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'ф') keys.l = false;
        if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'в') keys.r = false;
      });
      c.addEventListener('mousemove', (e) => {
        const r = c.getBoundingClientRect();
        x = ((e.clientX - r.left) / r.width) * W;
      });
      const pops: { x: number; y: number; t: string; life: number }[] = [];
      this.loop((dt, t) => {
        if (keys.l) x -= 560 * dt;
        if (keys.r) x += 560 * dt;
        x = Math.max(55, Math.min(W - 55, x));
        const g = ctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, '#8fd8ff');
        g.addColorStop(1, '#ffe7a8');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.font = `64px ${EMOJI_FONT}`;
        for (let i = 0; i < 6; i++) ctx.fillText('🌴', i * 140 - 20, 60);
        ctx.font = `40px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        for (const f of level) {
          if (f.done || t < f.t) continue;
          const y = (t - f.t) * f.speed * H - 30;
          if (y > H + 40) {
            f.done = true;
            continue;
          }
          const fx = f.x * W;
          if (y > H - 80 && y < H - 30 && Math.abs(fx - x) < 62) {
            f.done = true;
            const p = FRUIT_POINTS[f.kind];
            score += p;
            pops.push({ x: fx, y: H - 100, t: (p > 0 ? '+' : '') + p, life: 0.8 });
            if (p > 0) sfx.catch();
            else sfx.splat();
            continue;
          }
          ctx.fillText(EMOJI[f.kind], fx, y);
        }
        // Корзина.
        ctx.fillStyle = '#8b5a2b';
        ctx.beginPath();
        ctx.moveTo(x - 60, H - 70);
        ctx.lineTo(x + 60, H - 70);
        ctx.lineTo(x + 45, H - 20);
        ctx.lineTo(x - 45, H - 20);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = '#5d3a1a';
        ctx.lineWidth = 4;
        ctx.stroke();
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(x + i * 22, H - 70);
          ctx.lineTo(x + i * 17, H - 20);
          ctx.stroke();
        }
        ctx.font = 'bold 26px Rubik, sans-serif';
        for (const p of pops) {
          p.life -= dt;
          p.y -= 60 * dt;
          ctx.fillStyle = p.t.startsWith('-') ? `rgba(220,40,40,${p.life})` : `rgba(30,130,30,${p.life})`;
          ctx.fillText(p.t, p.x, p.y);
        }
        ctx.textAlign = 'left';
        ctx.fillStyle = '#123';
        ctx.font = 'bold 26px Rubik, sans-serif';
        ctx.fillText(`Очки: ${score}`, 16, H - 430 + 30);
        ctx.textAlign = 'right';
        ctx.fillText(`⏱ ${Math.max(0, Math.ceil(CATCH_DURATION - t))}`, W - 16, 30);
        ctx.textAlign = 'left';
        if (t >= CATCH_DURATION) {
          resolve(score);
          return false;
        }
        return true;
      });
    });
  }
}

// ------------------------------------------------------------
class TimingUI extends SkillUI {
  protected play(seed: number): Promise<number> {
    return new Promise((resolve) => {
      const W = 760;
      const H = 300;
      const [c, ctx] = this.canvas(W, H);
      this.stage.append(c);
      const throws = timingLevel(seed);
      let i = 0;
      let total = 0;
      let phase = 0;
      let frozen = -1;
      let lastScore: number | null = null;
      let pauseUntil = 0;
      let now = 0;
      const results: number[] = [];
      const fire = () => {
        if (i >= TIMING_THROWS || now < pauseUntil) return;
        const pos = (Math.sin(phase) + 1) / 2;
        const s = timingScore(pos, throws[i]);
        total += s;
        results.push(s);
        lastScore = s;
        frozen = pos;
        if (s >= 80) sfx.good();
        else if (s > 0) sfx.catch();
        else sfx.splat();
        i++;
        pauseUntil = now + 0.9;
        phase = 0;
      };
      this.on('keydown', (e) => {
        if (e.code === 'Space' || e.key === 'Enter') {
          e.preventDefault();
          fire();
        }
      });
      c.addEventListener('mousedown', fire);
      this.loop((dt, t) => {
        now = t;
        const th = throws[Math.min(i, TIMING_THROWS - 1)];
        if (now >= pauseUntil) {
          frozen = -1;
          phase += dt * th.speed * Math.PI;
        }
        ctx.fillStyle = '#163b56';
        ctx.fillRect(0, 0, W, H);
        const bx = 60;
        const bw = W - 120;
        const by = 150;
        ctx.fillStyle = '#e8d7b0';
        ctx.fillRect(bx, by - 25, bw, 50);
        if (i < TIMING_THROWS || frozen >= 0) {
          const tt = throws[Math.min(frozen >= 0 ? i - 1 : i, TIMING_THROWS - 1)];
          ctx.fillStyle = '#7ccf5a';
          ctx.fillRect(bx + (tt.target - tt.width) * bw, by - 25, tt.width * 2 * bw, 50);
          ctx.fillStyle = '#2e8b3a';
          ctx.fillRect(bx + (tt.target - tt.width * 0.25) * bw, by - 25, tt.width * 0.5 * bw, 50);
        }
        const pos = frozen >= 0 ? frozen : (Math.sin(phase) + 1) / 2;
        const mx = bx + pos * bw;
        ctx.font = `44px ${EMOJI_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('🥥', mx, by - 40);
        ctx.fillStyle = '#ff4f4f';
        ctx.fillRect(mx - 2, by - 30, 4, 60);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 26px Rubik, sans-serif';
        ctx.fillText(`Бросок ${Math.min(i + 1, TIMING_THROWS)} / ${TIMING_THROWS} · Очки: ${total}`, W / 2, 40);
        if (lastScore !== null && now < pauseUntil) {
          ctx.fillStyle = lastScore >= 80 ? '#7CFC00' : lastScore > 0 ? '#ffe14d' : '#ff6b6b';
          ctx.font = 'bold 40px Rubik, sans-serif';
          ctx.fillText(lastScore >= 95 ? `Идеально! +${lastScore}` : `+${lastScore}`, W / 2, 250);
        } else {
          ctx.fillStyle = '#cde';
          ctx.font = '20px Rubik, sans-serif';
          ctx.fillText('Пробел или клик — бросить!', W / 2, 250);
        }
        ctx.font = '20px Rubik, sans-serif';
        ctx.fillStyle = '#9bd';
        ctx.fillText(results.join('  ·  '), W / 2, 285);
        ctx.textAlign = 'left';
        const timeUp = t > 30;
        if ((i >= TIMING_THROWS && now >= pauseUntil) || timeUp) {
          resolve(total);
          return false;
        }
        return true;
      });
    });
  }
}

// ------------------------------------------------------------
class MemoryUI extends SkillUI {
  protected play(seed: number): Promise<number> {
    return new Promise((resolve) => {
      const cards = memoryLevel(seed);
      const timer = h('div', { class: 'mem-timer' }, '');
      const btns = cards.map((sym, i) => {
        const b = h('button', { class: 'mem-card' }, h('span', { class: 'back' }, '🐚'), h('span', { class: 'front' }, MEMORY_SYMBOLS[sym]));
        b.addEventListener('click', () => flip(i));
        return b;
      });
      this.stage.append(timer, h('div', { class: 'mem-grid' }, btns));
      const matched = new Set<number>();
      let open: number[] = [];
      let lock = false;
      let pairs = 0;
      let finished = false;
      const t0 = performance.now();
      const end = () => {
        if (finished) return;
        finished = true;
        const left = Math.max(0, Math.floor(MEMORY_TIME - (performance.now() - t0) / 1000));
        resolve(pairs * 10 + (pairs === MEMORY_PAIRS ? left : 0));
      };
      const flip = (i: number) => {
        if (lock || finished || matched.has(i) || open.includes(i)) return;
        sfx.click();
        btns[i].classList.add('up');
        open.push(i);
        if (open.length === 2) {
          const [a, b] = open;
          if (cards[a] === cards[b]) {
            matched.add(a);
            matched.add(b);
            btns[a].classList.add('done');
            btns[b].classList.add('done');
            open = [];
            pairs++;
            sfx.good();
            if (pairs === MEMORY_PAIRS) end();
          } else {
            lock = true;
            setTimeout(() => {
              btns[a].classList.remove('up');
              btns[b].classList.remove('up');
              open = [];
              lock = false;
            }, 650);
          }
        }
      };
      this.loop((_dt, t) => {
        timer.textContent = `⏱ ${Math.max(0, Math.ceil(MEMORY_TIME - t))} · Пар: ${pairs}/${MEMORY_PAIRS}`;
        if (finished) return false;
        if (t >= MEMORY_TIME) {
          end();
          return false;
        }
        return true;
      });
    });
  }
}

// ------------------------------------------------------------
class CountUI extends SkillUI {
  protected async play(seed: number): Promise<number> {
    const rounds = countLevel(seed);
    let total = 0;
    for (let r = 0; r < rounds.length && this.alive; r++) {
      clear(this.stage);
      const W = 760;
      const H = 400;
      const [c, ctx] = this.canvas(W, H);
      this.stage.append(h('div', { class: 'mg-round' }, `Забег ${r + 1} из ${rounds.length} — считай крабов 🦀!`), c);
      const round = rounds[r];
      await new Promise<void>((resolve) => {
        this.loop((_dt, t) => {
          const g = ctx.createLinearGradient(0, 0, 0, H);
          g.addColorStop(0, '#5fc8e8');
          g.addColorStop(0.45, '#5fc8e8');
          g.addColorStop(0.46, '#f5dca0');
          g.addColorStop(1, '#eac67a');
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, W, H);
          ctx.font = `38px ${EMOJI_FONT}`;
          ctx.textAlign = 'center';
          for (const a of round.actors) {
            const tt = t - a.delay;
            if (tt < 0) continue;
            const p = tt * a.speed;
            const x = a.dir > 0 ? -0.08 + p : 1.08 - p;
            if (x < -0.1 || x > 1.1) continue;
            const y = a.kind === 'crab' ? H * (0.5 + a.y * 0.45) : H * (0.05 + a.y * 0.38);
            ctx.save();
            ctx.translate(x * W, y);
            if (a.kind === 'fish' && a.dir > 0) ctx.scale(-1, 1);
            ctx.fillText(a.kind === 'crab' ? '🦀' : '🐟', 0, 12);
            ctx.restore();
          }
          ctx.textAlign = 'left';
          if (t >= COUNT_ROUND_TIME) {
            resolve();
            return false;
          }
          return true;
        });
      });
      if (!this.alive) break;
      clear(this.stage);
      const input = h('input', { class: 'input count-input', type: 'number', min: 0, max: 50, placeholder: '?' });
      const answer = await new Promise<number>((resolve) => {
        let done = false;
        const submit = () => {
          if (done) return;
          done = true;
          resolve(Number(input.value) || 0);
        };
        input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
        this.stage.append(
          h('div', { class: 'count-ask' }, h('div', {}, 'Сколько было крабов?'), input, h('button', { class: 'btn primary big', onclick: submit }, 'Ответить')),
        );
        input.focus();
        setTimeout(submit, 12000);
      });
      const pts = countRoundScore(answer - round.crabs);
      total += pts;
      if (pts === 10) sfx.good();
      else sfx.splat();
      clear(this.stage);
      this.stage.append(
        h('div', { class: 'mg-result-text' }, `Крабов было: ${round.crabs}. Твой ответ: ${answer}. +${pts} очк.`),
        h('div', { class: 'mg-round' }, `Всего: ${total}`),
      );
      await sleep(1800);
    }
    return total;
  }
}

// ------------------------------------------------------------
class SimonUI extends SkillUI {
  protected async play(seed: number): Promise<number> {
    const seq = simonLevel(seed);
    const colors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];
    const info = h('div', { class: 'mg-round' }, '');
    const drums = colors.map((col, i) => h('button', { class: 'drum', style: `--dc:${col}` }, h('span', { html: iconHtml('drum', 64) }), h('small', {}, String(i + 1))));
    this.stage.append(info, h('div', { class: 'drum-row' }, drums));
    const t0 = performance.now();
    const timeLeft = () => SIMON_TIME - (performance.now() - t0) / 1000;
    const hit = async (i: number, ms = 300) => {
      sfx.drum(i);
      drums[i].classList.add('lit');
      await sleep(ms);
      drums[i].classList.remove('lit');
    };
    let input: ((i: number) => void) | null = null;
    drums.forEach((d, i) => d.addEventListener('mousedown', () => input?.(i)));
    this.on('keydown', (e) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) input?.(n - 1);
    });
    let best = 0;
    for (let len = 3; len <= SIMON_MAX && this.alive; len++) {
      if (timeLeft() <= 0) break;
      info.textContent = `Слушай! Длина мелодии: ${len}`;
      await sleep(600);
      const beat = Math.max(220, 480 - len * 15);
      for (let k = 0; k < len && this.alive; k++) {
        await hit(seq[k], beat * 0.7);
        await sleep(beat * 0.35);
      }
      info.textContent = `Повтори! (${len} ударов) · ⏱ ${Math.ceil(timeLeft())}`;
      const ok = await new Promise<boolean>((resolve) => {
        let pos = 0;
        const timer = setTimeout(() => {
          input = null;
          resolve(false);
        }, Math.max(1000, Math.min(timeLeft() * 1000, 4000 + len * 900)));
        input = (i) => {
          void hit(i, 160);
          if (i !== seq[pos]) {
            clearTimeout(timer);
            input = null;
            resolve(false);
            return;
          }
          pos++;
          if (pos === len) {
            clearTimeout(timer);
            input = null;
            resolve(true);
          }
        };
      });
      if (!ok) {
        sfx.bad();
        info.textContent = `Ошибка! Лучший результат: ${best}`;
        await sleep(1000);
        break;
      }
      best = len;
      sfx.good();
      await sleep(350);
    }
    return best;
  }
}

export const SKILL_UIS: Record<string, (env: MgEnv) => MgUI> = {
  catch: (e) => new CatchUI(e),
  timing: (e) => new TimingUI(e),
  memory: (e) => new MemoryUI(e),
  count: (e) => new CountUI(e),
  simon: (e) => new SimonUI(e),
};
