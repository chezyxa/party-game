import Phaser from 'phaser';
import { ISLAND, type Board, type BoardNode, type SpaceType } from '../../core/board';
import { CHAR_BY_ID } from '../../core/characters';
import type { GameState } from '../../core/types';
import { charCanvas, coinCanvas, spriteCanvas, starCanvas } from '../art';
import { sfx } from '../audio';

const SPACE_STYLE: Record<SpaceType, { fill: number; edge: number; glyph: string; r: number }> = {
  blue: { fill: 0x3d8bfd, edge: 0x1d4fa8, glyph: '+', r: 27 },
  red: { fill: 0xe5484d, edge: 0x8f1d22, glyph: '−', r: 27 },
  event: { fill: 0x2fb36b, edge: 0x16663a, glyph: '?', r: 27 },
  lucky: { fill: 0x9be15d, edge: 0x3f7f1d, glyph: '🍀', r: 27 },
  villain: { fill: 0x3a2147, edge: 0x14081a, glyph: '☠', r: 29 },
  duel: { fill: 0xf59e0b, edge: 0x8a4b00, glyph: '⚔', r: 27 },
  bank: { fill: 0x14b8a6, edge: 0x0b5e55, glyph: '🐢', r: 29 },
  shop: { fill: 0xfbbf24, edge: 0x92400e, glyph: '🛒', r: 34 },
  thief: { fill: 0x8b5a2b, edge: 0x3d220c, glyph: '🐒', r: 34 },
};

/** Спрайты для особых клеток (если загружен лист спрайтов). */
const SPACE_SPRITE: Partial<Record<SpaceType, string>> = {
  lucky: 'icon_clover',
  villain: 'icon_villain',
  bank: 'icon_bank',
  shop: 'icon_shop',
  thief: 'icon_thief',
};

export const SPACE_NAMES: Record<SpaceType, string> = {
  blue: 'Синяя клетка: +3 монеты',
  red: 'Красная клетка: −3 монеты',
  event: 'Клетка «?»: событие острова',
  lucky: 'Клевер: предмет или монеты',
  villain: 'Капитан Барракуда: пиратские пакости',
  duel: 'Дуэль: вызови соперника на мини-игру',
  bank: 'Банк: проходя, платишь 5; встав — забираешь всё',
  shop: 'Лавка попугая (проходная)',
  thief: 'Хижина воришки (проходная)',
};

export class BoardScene extends Phaser.Scene {
  board: Board = ISLAND;
  private tokens = new Map<string, Phaser.GameObjects.Container>();
  private tokenNode = new Map<string, number>();
  private star!: Phaser.GameObjects.Container;
  private starPrice!: Phaser.GameObjects.Text;
  private traps = new Map<number, Phaser.GameObjects.Text | Phaser.GameObjects.Image>();
  private arrows: Phaser.GameObjects.GameObject[] = [];
  private follow: string | null = null;
  private dragging = false;
  private userPanUntil = 0;
  private ready!: Promise<void>;
  private readyResolve!: () => void;
  onHoverNode?: (n: BoardNode | null) => void;

  constructor() {
    super('board');
    this.ready = new Promise((r) => (this.readyResolve = r));
  }

  whenReady() {
    return this.ready;
  }

  create() {
    const b = this.board;
    const cam = this.cameras.main;
    cam.setBounds(-400, -300, b.width + 800, b.height + 600);
    cam.setBackgroundColor('#1d8fc7');
    this.drawOcean();
    this.drawIsland();
    this.drawPaths();
    this.drawSpaces();
    this.drawDecor();
    this.createStar();
    this.fitAll(true);
    this.setupInput();
    this.scale.on('resize', () => this.fitAll(true));
    this.readyResolve();
  }

  // ---------- Отрисовка мира ----------
  private drawOcean() {
    const b = this.board;
    const g = this.add.graphics();
    g.fillGradientStyle(0x2bb3e0, 0x2bb3e0, 0x0e5f9e, 0x0e5f9e, 1);
    g.fillRect(-600, -500, b.width + 1200, b.height + 1000);
    const waves = this.add.graphics();
    waves.lineStyle(3, 0xffffff, 0.18);
    const rnd = new Phaser.Math.RandomDataGenerator(['waves']);
    for (let i = 0; i < 160; i++) {
      const x = rnd.between(-500, b.width + 500);
      const y = rnd.between(-400, b.height + 400);
      waves.beginPath();
      waves.arc(x, y, 18, Math.PI * 1.15, Math.PI * 1.85);
      waves.strokePath();
      waves.beginPath();
      waves.arc(x + 30, y, 18, Math.PI * 1.15, Math.PI * 1.85);
      waves.strokePath();
    }
    this.tweens.add({ targets: waves, x: 30, y: 8, duration: 3500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private scaled(pts: { x: number; y: number }[], k: number, cx: number, cy: number) {
    return pts.map((p) => new Phaser.Math.Vector2(cx + (p.x - cx) * k, cy + (p.y - cy) * k));
  }

  private smooth(pts: Phaser.Math.Vector2[]) {
    const spline = new Phaser.Curves.Spline([...pts, pts[0], pts[1]]);
    return spline.getPoints(pts.length * 8).slice(0, -8);
  }

  private drawIsland() {
    const b = this.board;
    const cx = 1220;
    const cy = 820;
    const coast = b.coast.map((p) => new Phaser.Math.Vector2(p.x, p.y));
    const g = this.add.graphics();
    // Отмель.
    g.fillStyle(0x6fe3e8, 0.55);
    g.fillPoints(this.smooth(this.scaled(coast, 1.09, cx, cy)), true);
    g.fillStyle(0x9ff0ea, 0.6);
    g.fillPoints(this.smooth(this.scaled(coast, 1.04, cx, cy)), true);
    // Песок.
    g.fillStyle(0xf5dca0, 1);
    g.fillPoints(this.smooth(coast), true);
    // Трава.
    g.fillStyle(0x6cc24a, 1);
    g.fillPoints(this.smooth(this.scaled(coast, 0.8, cx, cy)), true);
    g.fillStyle(0x56a83b, 1);
    g.fillPoints(this.smooth(this.scaled(coast, 0.55, cx, cy)), true);
    // Вулкан.
    const v = b.volcano;
    const vg = this.add.graphics();
    vg.fillStyle(0x7a5a46, 1);
    vg.fillPoints(
      [
        new Phaser.Math.Vector2(v.x - 230, v.y + 120),
        new Phaser.Math.Vector2(v.x - 70, v.y - 120),
        new Phaser.Math.Vector2(v.x + 70, v.y - 120),
        new Phaser.Math.Vector2(v.x + 230, v.y + 120),
      ],
      true,
    );
    vg.fillStyle(0x5d4334, 1);
    vg.fillPoints(
      [new Phaser.Math.Vector2(v.x + 10, v.y - 120), new Phaser.Math.Vector2(v.x + 70, v.y - 120), new Phaser.Math.Vector2(v.x + 230, v.y + 120), new Phaser.Math.Vector2(v.x + 60, v.y + 120)],
      true,
    );
    vg.fillStyle(0xff5a1f, 1);
    vg.fillEllipse(v.x, v.y - 120, 150, 34);
    vg.fillStyle(0xffc23d, 1);
    vg.fillEllipse(v.x, v.y - 118, 100, 18);
    vg.lineStyle(10, 0xff6a1f, 0.9);
    vg.beginPath();
    vg.moveTo(v.x - 30, v.y - 108);
    vg.lineTo(v.x - 60, v.y - 30);
    vg.lineTo(v.x - 50, v.y + 30);
    vg.strokePath();
    // Дым.
    for (let i = 0; i < 4; i++) {
      const puff = this.add.circle(v.x, v.y - 140, 26, 0xdddddd, 0.6);
      this.tweens.add({
        targets: puff,
        y: v.y - 320,
        x: v.x + 40 + i * 10,
        scale: 2.4,
        alpha: 0,
        duration: 4200,
        delay: i * 1050,
        repeat: -1,
      });
    }
    this.add.text(v.x, v.y + 140, 'Вулкан Бум-Бум', { fontFamily: 'Rubik, sans-serif', fontSize: '26px', color: '#fff', stroke: '#3d2a1e', strokeThickness: 6 }).setOrigin(0.5);
    // Причал.
    const pier = b.nodes.filter((n) => n.route === 'pier');
    const pg = this.add.graphics();
    const chain = [b.nodes.find((n) => n.next.includes(pier[0].id))!, ...pier, b.nodes[pier[pier.length - 1].next[0]]];
    pg.lineStyle(70, 0x8b5a2b, 1);
    for (let i = 0; i < chain.length - 1; i++) pg.lineBetween(chain[i].x, chain[i].y, chain[i + 1].x, chain[i + 1].y);
    pg.lineStyle(58, 0xb07a45, 1);
    for (let i = 0; i < chain.length - 1; i++) pg.lineBetween(chain[i].x, chain[i].y, chain[i + 1].x, chain[i + 1].y);
    pg.fillStyle(0x5d3a1a, 1);
    for (const n of pier) {
      pg.fillCircle(n.x - 40, n.y + 30, 8);
      pg.fillCircle(n.x + 40, n.y + 30, 8);
    }
  }

  private drawPaths() {
    const g = this.add.graphics();
    const draw = (w: number, color: number, alpha: number) => {
      g.lineStyle(w, color, alpha);
      for (const n of this.board.nodes) for (const m of n.next) g.lineBetween(n.x, n.y, this.board.nodes[m].x, this.board.nodes[m].y);
    };
    draw(24, 0x8a6a3a, 0.35);
    draw(16, 0xfff1c9, 0.95);
    // Стрелки направления на развилках.
    for (const n of this.board.nodes) {
      if (n.next.length < 2) continue;
      for (const m of n.next) {
        const t = this.board.nodes[m];
        const a = Math.atan2(t.y - n.y, t.x - n.x);
        const x = n.x + Math.cos(a) * 52;
        const y = n.y + Math.sin(a) * 52;
        this.add.triangle(x, y, 0, -9, 16, 0, 0, 9, 0xfff1c9).setRotation(a).setStrokeStyle(2, 0x8a6a3a);
      }
    }
  }

  private drawSpaces() {
    for (const n of this.board.nodes) {
      const st = SPACE_STYLE[n.type];
      const c = this.add.container(n.x, n.y);
      const shadow = this.add.ellipse(0, 6, st.r * 2.1, st.r * 1.5, 0x000000, 0.25);
      const base = this.add.circle(0, 0, st.r, st.fill).setStrokeStyle(5, 0xffffff);
      const inner = this.add.circle(0, 0, st.r - 7, st.fill).setStrokeStyle(2, st.edge, 0.6);
      const txt = this.add
        .text(0, 1, st.glyph, {
          fontFamily: 'Rubik, "Segoe UI Emoji", "Apple Color Emoji", sans-serif',
          fontSize: st.glyph.length > 1 || /\p{Extended_Pictographic}/u.test(st.glyph) ? `${st.r}px` : `${st.r + 6}px`,
          color: '#ffffff',
          fontStyle: 'bold',
          stroke: '#00000055',
          strokeThickness: 3,
        })
        .setOrigin(0.5);
      const spr = SPACE_SPRITE[n.type] ? this.spriteTexture(SPACE_SPRITE[n.type]!) : null;
      if (spr) {
        txt.setVisible(false);
        const icon = this.add.image(0, n.passThrough ? -6 : -2, spr);
        icon.setScale((st.r * (n.passThrough ? 2.3 : 1.9)) / 128);
        c.add([shadow, base, inner, icon]);
      } else c.add([shadow, base, inner, txt]);
      c.setSize(st.r * 2, st.r * 2);
      c.setInteractive({ useHandCursor: false });
      c.on('pointerover', () => this.onHoverNode?.(n));
      c.on('pointerout', () => this.onHoverNode?.(null));
      if (n.id === this.board.start) {
        this.add
          .text(n.x, n.y - 52, 'СТАРТ', { fontFamily: 'Rubik, sans-serif', fontSize: '20px', color: '#fff', fontStyle: 'bold', stroke: '#1d4fa8', strokeThickness: 6 })
          .setOrigin(0.5);
      }
      if (n.passThrough || n.type === 'bank') {
        const label = n.type === 'shop' ? 'Лавка' : n.type === 'thief' ? 'Воришка' : 'Банк';
        this.add
          .text(n.x, n.y + st.r + 16, label, { fontFamily: 'Rubik, sans-serif', fontSize: '18px', color: '#fff', fontStyle: 'bold', stroke: '#3d220c', strokeThickness: 5 })
          .setOrigin(0.5);
      }
    }
  }

  /** Текстура из листа спрайтов (128×128) или null. */
  private spriteTexture(frame: string): string | null {
    const key = 'spr_' + frame;
    if (this.textures.exists(key)) return key;
    const c = spriteCanvas(frame, 128);
    if (!c) return null;
    this.textures.addCanvas(key, c);
    return key;
  }

  private makePalmTexture() {
    if (this.textures.exists('palm')) return;
    const sprPalm = spriteCanvas('icon_palm', 170);
    if (sprPalm) {
      this.textures.addCanvas('palm', sprPalm);
      return;
    }
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x8b5a2b, 1);
    for (let i = 0; i < 7; i++) g.fillEllipse(60 + i * 2, 150 - i * 15, 18 - i, 16);
    g.fillStyle(0x2e8b3a, 1);
    const leaves = [
      [-1, -0.2],
      [1, -0.2],
      [-0.7, 0.5],
      [0.7, 0.5],
      [0, -1],
      [-0.4, -0.8],
      [0.4, -0.8],
    ];
    for (const [dx, dy] of leaves) {
      for (let k = 1; k <= 4; k++) g.fillEllipse(72 + dx * k * 12, 56 + dy * k * 10 + k * k * 1.4, 26 - k * 3, 14 - k);
    }
    g.fillStyle(0x6b3f1d, 1);
    g.fillCircle(66, 62, 6);
    g.fillCircle(78, 64, 6);
    g.generateTexture('palm', 150, 170);
    g.destroy();
  }

  private drawDecor() {
    this.makePalmTexture();
    const rnd = new Phaser.Math.RandomDataGenerator(['palms']);
    const b = this.board;
    const cx = 1220;
    const cy = 820;
    const placed: { x: number; y: number }[] = [];
    const segDist = (x: number, y: number) => {
      let best = Infinity;
      for (const n of b.nodes)
        for (const m of n.next) {
          const o = b.nodes[m];
          const dx = o.x - n.x;
          const dy = o.y - n.y;
          const t = Math.max(0, Math.min(1, ((x - n.x) * dx + (y - n.y) * dy) / (dx * dx + dy * dy || 1)));
          best = Math.min(best, Math.hypot(n.x + dx * t - x, n.y + dy * t - y));
        }
      return best;
    };
    const free = (x: number, y: number, d: number) =>
      segDist(x, y) > d * 0.8 &&
      b.nodes.every((n) => Math.hypot(n.x - x, n.y - y) > d) &&
      placed.every((p) => Math.hypot(p.x - x, p.y - y) > 70) &&
      Math.hypot(x - b.volcano.x, y - b.volcano.y + 40) > 260;
    const insideCoast = (x: number, y: number) => {
      // Луч от центра: точка внутри, если ближе к центру, чем берег (с запасом).
      const a = Math.atan2(y - cy, x - cx);
      let best = b.coast[0];
      let bd = Infinity;
      for (const p of b.coast) {
        const d = Math.abs(Math.atan2(p.y - cy, p.x - cx) - a);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return Math.hypot(x - cx, y - cy) < Math.hypot(best.x - cx, best.y - cy) * 0.9;
    };
    const palms: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < 400 && placed.length < 34; i++) {
      const x = rnd.between(200, b.width - 200);
      const y = rnd.between(150, b.height - 150);
      if (!insideCoast(x, y) || !free(x, y, 75)) continue;
      placed.push({ x, y });
      const k = spriteCanvas('icon_palm', 8) ? 0.62 : 1;
      const img = this.add.image(x, y, 'palm').setOrigin(0.5, 0.9).setScale(rnd.realInRange(0.6, 1) * k).setFlipX(rnd.frac() < 0.5);
      palms.push(img);
    }
    palms.sort((a, c) => a.y - c.y).forEach((p, i) => p.setDepth(5 + i * 0.001));
    for (const p of palms) this.tweens.add({ targets: p, angle: { from: -2, to: 2 }, duration: rnd.between(1800, 2800), yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    // Цветы и камни.
    for (let i = 0; i < 70; i++) {
      const x = rnd.between(200, b.width - 200);
      const y = rnd.between(150, b.height - 150);
      if (!insideCoast(x, y) || !free(x, y, 45)) continue;
      const col = rnd.pick([0xff5fa2, 0xffd23f, 0xffffff, 0xff8c42]);
      for (let k = 0; k < 5; k++) {
        const a = (Math.PI * 2 * k) / 5;
        this.add.circle(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 5, col);
      }
      this.add.circle(x, y, 4, 0xffe14d);
    }
    // Табличка с названием.
    this.add
      .text(b.width / 2, 70, '🌴 Остров Тики 🌴', { fontFamily: 'Rubik, "Segoe UI Emoji", sans-serif', fontSize: '54px', color: '#fff', fontStyle: 'bold', stroke: '#0e5f9e', strokeThickness: 10 })
      .setOrigin(0.5);
  }

  private createStar() {
    if (!this.textures.exists('starfish')) this.textures.addCanvas('starfish', starCanvas(128));
    if (!this.textures.exists('coin')) this.textures.addCanvas('coin', coinCanvas(48));
    const glow = this.add.circle(0, 0, 50, 0xfff3a0, 0.45);
    const img = this.add.image(0, -10, 'starfish').setScale(0.62);
    this.starPrice = this.add
      .text(0, 38, '20', { fontFamily: 'Rubik, sans-serif', fontSize: '20px', color: '#fff', fontStyle: 'bold', stroke: '#9a4b00', strokeThickness: 5 })
      .setOrigin(0.5);
    this.star = this.add.container(-1000, -1000, [glow, img, this.starPrice]).setDepth(20);
    this.tweens.add({ targets: img, y: -22, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    this.tweens.add({ targets: glow, scale: 1.25, alpha: 0.2, duration: 900, yoyo: true, repeat: -1 });
  }

  // ---------- Камера и ввод ----------
  private setupInput() {
    const cam = this.cameras.main;
    this.input.on('pointerdown', () => (this.dragging = false));
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const dx = p.x - p.prevPosition.x;
      const dy = p.y - p.prevPosition.y;
      if (Math.abs(dx) + Math.abs(dy) > 1) this.dragging = true;
      cam.scrollX -= dx / cam.zoom;
      cam.scrollY -= dy / cam.zoom;
      this.userPanUntil = this.time.now + 4000;
    });
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      const z = Phaser.Math.Clamp(cam.zoom * (dy > 0 ? 0.9 : 1.1), this.minZoom(), 1.6);
      cam.setZoom(z);
      this.userPanUntil = this.time.now + 4000;
    });
  }

  private minZoom() {
    const { width, height } = this.scale;
    return Math.min(width / (this.board.width + 100), height / (this.board.height + 100));
  }

  fitAll(instant = false) {
    const cam = this.cameras.main;
    const z = this.minZoom();
    if (instant) {
      cam.setZoom(z);
      cam.centerOn(this.board.width / 2, this.board.height / 2);
    } else {
      cam.zoomTo(z, 600);
      cam.pan(this.board.width / 2, this.board.height / 2, 600, 'Sine.easeInOut');
    }
    this.follow = null;
  }

  focus(pid: string | null, instant = false) {
    this.follow = pid;
    if (!pid) return;
    const t = this.tokens.get(pid);
    if (!t) return;
    const cam = this.cameras.main;
    const z = Math.max(this.minZoom(), Math.min(1, this.scale.height / 950));
    if (instant) {
      cam.setZoom(z);
      cam.centerOn(t.x, t.y);
    } else {
      cam.zoomTo(z, 500);
      cam.pan(t.x, t.y, 500, 'Sine.easeInOut');
    }
    this.userPanUntil = 0;
  }

  update() {
    if (!this.follow || this.time.now < this.userPanUntil) return;
    const t = this.tokens.get(this.follow);
    if (!t) return;
    const cam = this.cameras.main;
    if (cam.panEffect.isRunning) return;
    const mid = cam.midPoint;
    cam.centerOn(mid.x + (t.x - mid.x) * 0.08, mid.y + (t.y - mid.y) * 0.08);
  }

  // ---------- Состояние ----------
  sync(s: GameState) {
    for (const pid of s.order) {
      const p = s.players[pid];
      if (!this.tokens.has(pid)) this.createToken(pid, p.charId, p.name);
      this.tokenNode.set(pid, p.node);
    }
    this.layoutTokens(false);
    this.placeStar(s.starNode, s.starPrice, false);
    this.syncTraps(s.traps);
  }

  private createToken(pid: string, charId: string, name: string) {
    const key = 'tok_' + charId;
    if (!this.textures.exists(key)) this.textures.addCanvas(key, charCanvas(charId, 128));
    const shadow = this.add.ellipse(0, 26, 50, 16, 0x000000, 0.3);
    const img = this.add.image(0, 0, key).setScale(0.5);
    const label = this.add
      .text(0, -46, name, {
        fontFamily: 'Rubik, sans-serif',
        fontSize: '16px',
        color: '#fff',
        fontStyle: 'bold',
        stroke: CHAR_BY_ID[charId]?.color ?? '#000',
        strokeThickness: 5,
      })
      .setOrigin(0.5);
    const c = this.add.container(0, 0, [shadow, img, label]).setDepth(30);
    c.setData('img', img);
    c.setData('label', label);
    this.tokens.set(pid, c);
  }

  private nodePos(node: number) {
    const n = this.board.nodes[node];
    return { x: n.x, y: n.y };
  }

  private layoutTokens(animate: boolean, except?: string) {
    const groups = new Map<number, string[]>();
    for (const [pid, node] of this.tokenNode) {
      if (!groups.has(node)) groups.set(node, []);
      groups.get(node)!.push(pid);
    }
    for (const [node, pids] of groups) {
      const base = this.nodePos(node);
      pids.forEach((pid, i) => {
        if (pid === except) return;
        const t = this.tokens.get(pid)!;
        let x = base.x;
        let y = base.y - 8;
        if (pids.length > 1) {
          const a = (Math.PI * 2 * i) / pids.length - Math.PI / 2;
          x += Math.cos(a) * 26;
          y += Math.sin(a) * 20;
        }
        t.setDepth(30 + y * 0.001 + (pid === this.follow ? 1 : 0));
        (t.getData('label') as Phaser.GameObjects.Text).setVisible(pids.length === 1 || pid === this.follow);
        if (animate) this.tweens.add({ targets: t, x, y, duration: 250 });
        else t.setPosition(x, y);
      });
    }
  }

  private placeStar(node: number, price: number, animate: boolean) {
    this.starPrice.setText(price === 20 ? '' : String(price));
    if (node < 0) {
      this.star.setPosition(-1000, -1000);
      return;
    }
    const p = this.nodePos(node);
    if (animate) this.tweens.add({ targets: this.star, x: p.x, y: p.y - 30, duration: 1400, ease: 'Cubic.easeInOut' });
    else this.star.setPosition(p.x, p.y - 30);
  }

  /** Капканы и цена звезды — безопасно обновлять в любой момент. */
  syncExtras(s: GameState) {
    this.syncTraps(s.traps);
    this.starPrice.setText(s.starPrice === 20 ? '' : String(s.starPrice));
  }

  private syncTraps(traps: Record<number, string>) {
    for (const [node, t] of this.traps) {
      if (traps[node] === undefined) {
        t.destroy();
        this.traps.delete(node);
      }
    }
    for (const k of Object.keys(traps)) {
      const node = Number(k);
      if (this.traps.has(node)) continue;
      const p = this.nodePos(node);
      const trapTex = this.spriteTexture('icon_trap');
      const t = trapTex
        ? this.add.image(p.x + 22, p.y + 16, trapTex).setScale(0.32).setDepth(25)
        : this.add.text(p.x + 22, p.y + 16, '🪤', { fontSize: '26px' }).setOrigin(0.5).setDepth(25);
      this.traps.set(node, t);
    }
  }

  // ---------- Анимации событий ----------
  private hop(t: Phaser.GameObjects.Container, x: number, y: number, dur: number) {
    return new Promise<void>((resolve) => {
      const img = t.getData('img') as Phaser.GameObjects.Image;
      this.tweens.add({ targets: t, x, y, duration: dur, ease: 'Sine.easeInOut', onComplete: () => resolve() });
      this.tweens.add({ targets: img, y: -18, duration: dur / 2, yoyo: true, ease: 'Quad.easeOut' });
    });
  }

  async move(pid: string, path: number[], stepMs: number) {
    const t = this.tokens.get(pid);
    if (!t) return;
    this.follow = pid;
    this.userPanUntil = 0;
    for (const node of path) {
      const p = this.nodePos(node);
      sfx.step();
      await this.hop(t, p.x, p.y - 8, stepMs);
      this.tokenNode.set(pid, node);
    }
    this.layoutTokens(true);
  }

  async teleport(pid: string, node: number) {
    const t = this.tokens.get(pid);
    if (!t) return;
    sfx.whoosh();
    await new Promise<void>((r) => this.tweens.add({ targets: t, scale: 0, angle: 360, duration: 500, onComplete: () => r() }));
    this.tokenNode.set(pid, node);
    const p = this.nodePos(node);
    t.setPosition(p.x, p.y - 8);
    this.focus(pid);
    await new Promise<void>((r) => this.tweens.add({ targets: t, scale: 1, angle: 0, duration: 500, delay: 300, onComplete: () => r() }));
    this.layoutTokens(true);
  }

  async swap(a: string, b: string) {
    const ta = this.tokens.get(a);
    const tb = this.tokens.get(b);
    if (!ta || !tb) return;
    sfx.whoosh();
    const na = this.tokenNode.get(a)!;
    const nb = this.tokenNode.get(b)!;
    this.fitAll();
    await Promise.all([
      new Promise<void>((r) => this.tweens.add({ targets: ta, x: tb.x, y: tb.y, duration: 1000, ease: 'Cubic.easeInOut', onComplete: () => r() })),
      new Promise<void>((r) => this.tweens.add({ targets: tb, x: ta.x, y: ta.y, duration: 1000, ease: 'Cubic.easeInOut', onComplete: () => r() })),
    ]);
    this.tokenNode.set(a, nb);
    this.tokenNode.set(b, na);
    this.layoutTokens(true);
  }

  async moveStar(node: number, price: number) {
    sfx.star();
    const p = this.nodePos(node);
    this.cameras.main.pan(p.x, p.y, 900, 'Sine.easeInOut');
    this.follow = null;
    this.placeStar(node, price, true);
  }

  popup(pid: string, text: string, color: string, icon?: 'coin' | 'starfish') {
    const t = this.tokens.get(pid);
    if (!t) return;
    const c = this.add.container(t.x, t.y - 60).setDepth(100);
    const txt = this.add
      .text(icon ? 14 : 0, 0, text, { fontFamily: 'Rubik, sans-serif', fontSize: '30px', color, fontStyle: 'bold', stroke: '#000', strokeThickness: 6 })
      .setOrigin(0.5);
    c.add(txt);
    if (icon) c.add(this.add.image(-txt.width / 2 - 4, 0, icon).setScale(icon === 'coin' ? 0.6 : 0.3));
    this.tweens.add({ targets: c, y: c.y - 70, alpha: { from: 1, to: 0 }, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => c.destroy() });
  }

  flashNode(node: number, color: number) {
    const p = this.nodePos(node);
    const ring = this.add.circle(p.x, p.y, 30, color, 0.5).setDepth(15);
    this.tweens.add({ targets: ring, scale: 2.4, alpha: 0, duration: 600, onComplete: () => ring.destroy() });
  }

  spaceColor(type: SpaceType) {
    return SPACE_STYLE[type].fill;
  }

  /** Стрелки выбора на развилке. */
  showBranch(options: number[], onPick: (i: number) => void) {
    this.clearBranch();
    options.forEach((node, i) => {
      const p = this.nodePos(node);
      const ring = this.add.circle(p.x, p.y, 40, 0xffffff, 0.001).setStrokeStyle(6, 0xffe14d).setDepth(60);
      const lbl = this.add
        .text(p.x, p.y - 62, '👉 сюда', { fontFamily: 'Rubik, "Segoe UI Emoji", sans-serif', fontSize: '22px', color: '#fff', fontStyle: 'bold', stroke: '#000', strokeThickness: 5 })
        .setOrigin(0.5)
        .setDepth(60);
      ring.setInteractive({ useHandCursor: true });
      ring.on('pointerup', () => {
        if (this.dragging) return;
        this.clearBranch();
        onPick(i);
      });
      this.tweens.add({ targets: ring, scale: 1.2, duration: 500, yoyo: true, repeat: -1 });
      this.arrows.push(ring, lbl);
    });
  }

  clearBranch() {
    this.arrows.forEach((a) => a.destroy());
    this.arrows = [];
  }
}
