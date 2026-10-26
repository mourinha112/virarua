/* "Lembrar este aparelho": guarda um token no navegador para reabrir a sessão se o cookie sumir
   (o navegador de dentro do Instagram costuma apagar cookies). Sem conta logada, tenta restaurar;
   logado e sem token guardado, pede um. */
const LS = 'smn_aparelho';
const ler = () => { try { return localStorage.getItem(LS); } catch { return null; } };
const gravar = (v: string | null) => { try { if (v) localStorage.setItem(LS, v); else localStorage.removeItem(LS); } catch { /* sem storage */ } };
function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function post(url: string, corpo: unknown) {
  const r = await fetch('/api' + url, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': csrf() }, body: JSON.stringify(corpo) });
  return { status: r.status, j: await r.json().catch(() => null) };
}

/** chame antes de carregar a conta; devolve true se a sessão foi restaurada agora */
export async function lembrarAparelho(): Promise<boolean> {
  try {
    const s = await fetch('/api/sessao', { credentials: 'same-origin' }).then((r) => r.json());
    const token = ler();
    if (s?.usuario) {
      if (!token) { const r = await post('/sessao/lembrar', {}); if (r.j?.ok && r.j.token) gravar(r.j.token); }
      return false;
    }
    if (!token) return false;
    const r = await post('/sessao/restaurar', { token });
    if (r.j?.ok) return true;
    if (r.status === 401 || r.status === 400) gravar(null);
  } catch { /* offline: segue sem conta */ }
  return false;
}
