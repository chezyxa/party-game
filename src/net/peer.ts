import Peer, { type DataConnection, type PeerOptions } from 'peerjs';
import type { Conn } from '../core/conn';

const PREFIX = 'tiki-party-v1-';

/** Опции PeerJS. Для локальных тестов: ?peer=localhost:9000 */
function peerOptions(): PeerOptions {
  const params = new URLSearchParams(location.search);
  const custom = params.get('peer');
  const opts: PeerOptions = { debug: 1 };
  if (custom) {
    const [host, port] = custom.split(':');
    opts.host = host;
    opts.port = Number(port || 9000);
    opts.path = '/';
    opts.secure = location.protocol === 'https:' && host !== 'localhost';
  }
  return opts;
}

function wrap(dc: DataConnection): Conn {
  const msgCbs: ((m: unknown) => void)[] = [];
  const closeCbs: (() => void)[] = [];
  let closed = false;
  const fireClose = () => {
    if (closed) return;
    closed = true;
    closeCbs.forEach((cb) => cb());
  };
  dc.on('data', (d) => {
    let m: unknown = d;
    if (typeof d === 'string') {
      try {
        m = JSON.parse(d);
      } catch {
        return;
      }
    }
    msgCbs.forEach((cb) => cb(m));
  });
  dc.on('close', fireClose);
  dc.on('error', fireClose);
  // Отслеживаем «тихий» обрыв ICE.
  dc.on('iceStateChanged', (st) => {
    if (st === 'disconnected' || st === 'failed' || st === 'closed') fireClose();
  });
  return {
    send(m) {
      if (!closed && dc.open) dc.send(JSON.stringify(m));
    },
    onMessage(cb) {
      msgCbs.push(cb);
    },
    onClose(cb) {
      closeCbs.push(cb);
    },
    close() {
      dc.close();
      fireClose();
    },
  };
}

function errText(e: any): string {
  const type = e?.type as string | undefined;
  switch (type) {
    case 'unavailable-id':
      return 'Комната с таким кодом уже существует.';
    case 'peer-unavailable':
      return 'Комната не найдена. Проверьте код или попросите хоста создать комнату.';
    case 'network':
    case 'server-error':
    case 'socket-error':
      return 'Нет связи с сервером соединений PeerJS. Проверьте интернет.';
    case 'browser-incompatible':
      return 'Браузер не поддерживает WebRTC.';
    default:
      return 'Ошибка соединения: ' + (e?.message ?? String(e));
  }
}

export interface HostPeer {
  peer: Peer;
  destroy(): void;
}

/** Создать комнату с кодом. onConn вызывается на каждое входящее подключение. */
export function hostRoom(code: string, onConn: (c: Conn) => void): Promise<HostPeer> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, peerOptions());
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({ peer, destroy: () => peer.destroy() });
    });
    peer.on('connection', (dc) => {
      dc.on('open', () => onConn(wrap(dc)));
    });
    peer.on('disconnected', () => {
      // Потеряли сигнальный сервер — пробуем переподключиться (P2P-соединения живут дальше).
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 2000);
    });
    peer.on('error', (e) => {
      if (!opened) {
        peer.destroy();
        reject(new Error(errText(e)));
      } else console.warn('peer error', e);
    });
  });
}

/** Подключиться к комнате. */
export function joinRoom(code: string): Promise<{ conn: Conn; destroy(): void }> {
  return new Promise((resolve, reject) => {
    const peer = new Peer(peerOptions());
    let done = false;
    const fail = (e: any) => {
      if (done) return;
      done = true;
      peer.destroy();
      reject(new Error(errText(e)));
    };
    const timer = setTimeout(() => fail({ message: 'Хост не отвечает (таймаут 15 с).' }), 15000);
    peer.on('open', () => {
      const dc = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
      dc.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ conn: wrap(dc), destroy: () => peer.destroy() });
      });
      dc.on('error', fail);
    });
    peer.on('error', (e) => {
      clearTimeout(timer);
      fail(e);
    });
  });
}

export function makeRoomCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return s;
}
