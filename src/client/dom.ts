type Attrs = Record<string, unknown> & { class?: string; style?: string };
type Child = Node | string | number | null | undefined | false;

/** Мини-хелпер для создания DOM. Обработчики: onclick и т. п. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k in el && k !== 'style' && k !== 'class') (el as any)[k] = v;
    else el.setAttribute(k === 'class' ? 'class' : k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement) {
  while (el.firstChild) el.firstChild.remove();
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

let toastBox: HTMLElement | null = null;
export function toast(text: string, kind: 'info' | 'error' = 'info', ms = 3500) {
  if (!toastBox) {
    toastBox = h('div', { class: 'toasts' });
    document.body.append(toastBox);
  }
  const t = h('div', { class: `toast ${kind}` }, text);
  toastBox.append(t);
  setTimeout(() => t.classList.add('hide'), ms);
  setTimeout(() => t.remove(), ms + 500);
}

/** Таймер-полоска обратного отсчёта. */
export function timerBar(ms: number): HTMLElement {
  const bar = h('div', { class: 'timer' }, h('div', { class: 'timer-fill' }));
  const fill = bar.firstElementChild as HTMLElement;
  fill.style.animationDuration = `${ms}ms`;
  return bar;
}
