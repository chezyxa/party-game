import './styles.css';
import { App } from './client/app';
import { loadSpriteSheet } from './client/art';

// Шрифт нужен до старта Phaser, иначе надписи на доске нарисуются запасным шрифтом.
const fonts = Promise.all([document.fonts.load('bold 20px Rubik'), document.fonts.load('20px Rubik')]).catch(() => undefined);
await Promise.all([loadSpriteSheet(), Promise.race([fonts, new Promise((r) => setTimeout(r, 3000))])]);
const app = new App();
app.start();
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
