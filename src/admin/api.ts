/* Cliente HTTP do painel (/api/admin/*). Mesmo esquema de sessão/CSRF do jogo. Nunca lança. */
export type R<T> = ({ ok: true } & T) | { ok: false; erro: string; status: number };
const BASE = (import.meta as any).env?.VITE_API || '/api';
function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

export async function req<T = any>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<R<T>> {
  try {
    const r = await fetch(BASE + caminho, { method: metodo, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': csrf() }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    let j: any = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok || !j || j.ok === false) return { ok: false, status: r.status, erro: (j && j.erro) || 'erro ' + r.status };
    return j;
  } catch { return { ok: false, status: 0, erro: 'servidor fora do ar (npm run server)' }; }
}
export const get = <T = any>(p: string) => req<T>('GET', '/admin' + p);
export const post = <T = any>(p: string, b?: unknown) => req<T>('POST', '/admin' + p, b ?? {});
/** garante o cookie CSRF antes do primeiro POST */
export async function aquecer() { await req('GET', '/saude'); }
