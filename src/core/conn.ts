/** Абстрактное соединение (PeerJS, локальная петля и т. п.). */
export interface Conn {
  send(msg: unknown): void;
  onMessage(cb: (msg: unknown) => void): void;
  onClose(cb: () => void): void;
  close(): void;
}

/** Пара соединённых между собой концов в памяти. */
export function loopbackPair(): [Conn, Conn] {
  type Side = { msg: ((m: unknown) => void)[]; close: (() => void)[]; closed: boolean };
  const a: Side = { msg: [], close: [], closed: false };
  const b: Side = { msg: [], close: [], closed: false };
  const make = (self: Side, other: Side): Conn => ({
    send(m) {
      if (self.closed) return;
      const copy = JSON.parse(JSON.stringify(m));
      setTimeout(() => other.msg.forEach((cb) => cb(copy)), 0);
    },
    onMessage(cb) {
      self.msg.push(cb);
    },
    onClose(cb) {
      self.close.push(cb);
    },
    close() {
      if (self.closed) return;
      self.closed = other.closed = true;
      setTimeout(() => {
        self.close.forEach((cb) => cb());
        other.close.forEach((cb) => cb());
      }, 0);
    },
  });
  return [make(a, b), make(b, a)];
}
