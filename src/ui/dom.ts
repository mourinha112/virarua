/* Utilitários de DOM (sem framework). */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', txt?: string | number): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined && txt !== null) e.textContent = String(txt); return e;
}
export function botao(cls: string, txt: string, onclick?: (ev: MouseEvent) => void, aria?: string) {
  const b = el('button', cls, txt); b.type = 'button'; if (onclick) b.onclick = onclick; if (aria) b.setAttribute('aria-label', aria); return b;
}
export const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

let toastT = 0;
/** um pop-up por vez: espera os outros (.pop-fundo, .nv-fundo) fecharem antes de abrir */
export function quandoLivre(abrir: () => void) {
  const t = setInterval(() => { if (!document.querySelector('.pop-fundo, .nv-fundo')) { clearInterval(t); abrir(); } }, 400);
}
export function toast(t: string, ms = 2600) {
  const e = $('toast'); e.textContent = t; e.hidden = false;
  clearTimeout(toastT); toastT = window.setTimeout(() => { e.hidden = true; }, ms);
}

export const X_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
export function botaoFechar(onclick: () => void, aria = 'fechar') {
  const b = botao('fechar', '', onclick, aria); b.innerHTML = X_SVG; return b;
}

export const ICONES: Record<string, string> = {
  casa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-6.5L20 11"/><path d="M6 10v9.5h12V10"/><path d="M12 17.2s-2.7-1.6-2.7-3.4a1.5 1.5 0 0 1 2.7-.9 1.5 1.5 0 0 1 2.7.9c0 1.8-2.7 3.4-2.7 3.4z"/></svg>',
  cidade: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20.5h18"/><path d="M5 20.5V11h5v9.5"/><path d="M10 20.5V4.5h6v16"/><path d="M16 20.5V9h3.5v11.5"/><path d="M12.2 8h1.6M12.2 11.5h1.6M12.2 15h1.6M6.8 14h1.4M6.8 17h1.4"/></svg>',
  urna: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="9" width="16" height="11" rx="3"/><path d="M8 9V5.5h8V9"/><path d="M9 14.5l2.2 2.2L15.5 12"/></svg>',
  ranking: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20v-6h4.5v6M9.8 20V6h4.4v14M15.5 20v-9H20v9"/><path d="M3 20h18"/></svg>',
  loja: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5l1.4-4.5h13.2L20 9.5"/><path d="M4 9.5a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0 2.7 2.7 0 0 0 5.3 0"/><path d="M5.5 12.5V20h13v-7.5"/><path d="M10 20v-4.5h4V20"/></svg>',
  rua: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 21L10 3M17 21L14 3"/><path d="M12 5v2M12 10v2M12 15v2"/></svg>',
  fogo: '<svg viewBox="0 0 64 80" aria-hidden="true"><path d="M32 4c7 14 24 22 24 44 0 16-11 28-24 28S8 64 8 48c0-10 6-16 10-24 2 10 8 12 8 6 0-10 4-18 6-26Z" fill="#ff8a1f" stroke="#1e2430" stroke-width="4" stroke-linejoin="round"/><path d="M32 30c6 10 14 14 14 24 0 9-6 16-14 16s-14-7-14-16c0-6 4-10 6-14 2 6 6 6 6 0 0-4 1-6 2-10Z" fill="#ffc83d"/></svg>',
};
