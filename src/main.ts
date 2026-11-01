import './styles.css';
import { App } from './client/app';
import { loadSpriteSheet } from './client/art';

await loadSpriteSheet();
const app = new App();
app.start();
if (import.meta.env.DEV) (window as unknown as { __app: App }).__app = app;
