/* Peças de UI do painel: tabela, formulário, pedido de motivo, resultado de ação. Visual do jogo (estilo.css + admin.css). */
import { el, botao, toast } from '../ui/dom';
import type { R } from './api';

export { el, botao, toast };

export function cartao(titulo: string, ...filhos: (Node | string)[]) {
  const b = el('section', 'cartao-b adm-cartao'); b.append(el('h2', '', titulo), ...filhos); return b;
}

export function tabela(cols: [string, string][], linhas: any[], acoes?: (l: any) => HTMLElement[]) {
  if (!linhas.length) return el('p', 'nota', 'nada por aqui.');
  const wrap = el('div', 'adm-tab-wrap'); const t = el('table', 'adm-tab');
  const th = el('tr'); for (const [, rot] of cols) th.append(el('th', '', rot)); if (acoes) th.append(el('th', '', ''));
  const thead = el('thead'); thead.append(th); t.append(thead);
  const tb = el('tbody');
  for (const l of linhas) {
    const tr = el('tr');
    for (const [k] of cols) { const v = l[k]; tr.append(el('td', '', v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v))); }
    if (acoes) { const td = el('td', 'adm-acoes'); td.append(...acoes(l)); tr.append(td); }
    tb.append(tr);
  }
  t.append(tb); wrap.append(t); return wrap;
}

export type Campo = { k: string; rot: string; tipo?: 'text' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select' | 'checkbox'; opcoes?: string[]; ph?: string; valor?: string };
/** formulário simples: devolve o elemento; ao enviar chama fn(valores) */
export function formulario(campos: Campo[], rotuloBotao: string, fn: (v: Record<string, any>) => Promise<R<any>>, aoOk?: (r: any) => void) {
  const f = el('form', 'adm-form'); const ins: Record<string, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement> = {};
  for (const c of campos) {
    const lb = el('label', 'form-campo'); lb.append(el('span', '', c.rot));
    let i: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
    if (c.tipo === 'textarea') i = el('textarea');
    else if (c.tipo === 'select') { const s = el('select'); for (const o of c.opcoes || []) { const op = el('option', '', o); op.value = o; s.append(op); } i = s; }
    else { const x = el('input'); x.type = c.tipo || 'text'; i = x; }
    if ('placeholder' in i && c.ph) (i as HTMLInputElement).placeholder = c.ph;
    if (c.valor !== undefined) i.value = c.valor;
    i.name = c.k; ins[c.k] = i; lb.append(i); f.append(lb);
  }
  const msg = el('p', 'msg'); const b = el('button', 'btn prim', rotuloBotao); b.type = 'submit';
  f.append(b, msg);
  f.onsubmit = async (ev) => {
    ev.preventDefault(); b.disabled = true;
    const v: Record<string, any> = {};
    for (const c of campos) { const i = ins[c.k]; v[c.k] = c.tipo === 'checkbox' ? (i as HTMLInputElement).checked : c.tipo === 'number' ? (i.value === '' ? undefined : Number(i.value)) : c.tipo === 'datetime-local' && i.value ? new Date(i.value).toISOString() : i.value; }
    const r = await fn(v); b.disabled = false;
    msg.className = 'msg ' + (r.ok ? 'ok' : 'erro'); msg.textContent = r.ok ? 'feito.' : r.erro;
    if (r.ok && aoOk) aoOk(r);
  };
  return f;
}

/** ações sensíveis sempre pedem motivo (vai para a auditoria) */
export function pedirMotivo(acao: string): string | null {
  const m = window.prompt(`Motivo para "${acao}" (fica registrado na auditoria):`, '');
  if (m === null) return null;
  if (m.trim().length < 5) { toast('motivo precisa de pelo menos 5 caracteres'); return null; }
  return m.trim();
}

export async function executar(r: Promise<R<any>>, ok = 'feito', depois?: () => void) {
  const x = await r; toast(x.ok ? ok : x.erro, 4000); if (x.ok && depois) depois(); return x;
}

export function erroArea(r: { erro: string; status: number }) {
  return cartao('Não consegui carregar', el('p', 'msg erro', r.erro), el('p', 'nota', r.status === 403 ? 'Seu papel não acessa esta área, ou a sessão ficou antiga.' : ''));
}
