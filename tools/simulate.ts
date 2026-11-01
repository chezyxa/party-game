/** Прогон целых партий ботами без графики: npm run sim [игр] [игроков] */
import { GameHost } from '../src/core/host';
import { loopbackPair } from '../src/core/conn';
import type { HostMsg } from '../src/core/types';

declare const process: { argv: string[]; exit(code: number): void };

async function play(players: number, turns: number, seed: number) {
  const host = new GameHost({ code: 'SIM', speed: 0, seed });
  const [a, b] = loopbackPair();
  host.addConn(a, true);
  const mgCount: Record<string, number> = {};
  const evCount: Record<string, number> = {};
  let done!: () => void;
  const finished = new Promise<void>((r) => (done = r));
  b.onMessage((m) => {
    const msg = m as HostMsg;
    if (msg.t === 'ev') {
      evCount[msg.ev.type] = (evCount[msg.ev.type] ?? 0) + 1;
      if (msg.ev.type === 'mg' && msg.state.mg?.stage === 'intro') {
        const k = `${msg.state.mg.id}/${msg.state.mg.format}`;
        mgCount[k] = (mgCount[k] ?? 0) + 1;
      }
      if (msg.ev.type === 'final') done();
    }
    if (msg.t === 'error') console.log('ERR', msg.text);
  });
  b.send({ t: 'hello', clientId: 'sim-host', name: 'Хост' });
  await new Promise((r) => setTimeout(r, 5));
  for (let i = 1; i < players; i++) b.send({ t: 'host', cmd: 'addBot' });
  b.send({ t: 'host', cmd: 'settings', settings: { turns } });
  await new Promise((r) => setTimeout(r, 5));
  b.send({ t: 'host', cmd: 'start' });
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 60000));
  await Promise.race([finished, timeout]);
  const s = host.state!;
  return { s, mgCount, evCount };
}

const games = Number(process.argv[2] ?? 6);
const total: Record<string, number> = {};
for (let g = 0; g < games; g++) {
  const n = 2 + (g % 5);
  const { s, mgCount, evCount } = await play(n, 15, 1000 + g);
  for (const [k, v] of Object.entries(mgCount)) total[k] = (total[k] ?? 0) + v;
  const line = s.ranking.map((p) => `${s.players[p].name}(${s.players[p].charId}) ★${s.players[p].stars} 💰${s.players[p].coins}`).join(' | ');
  console.log(`Игра ${g + 1}, игроков ${n}: ${line}`);
  console.log('   события:', JSON.stringify(evCount));
}
console.log('Мини-игры:', total);
process.exit(0);
