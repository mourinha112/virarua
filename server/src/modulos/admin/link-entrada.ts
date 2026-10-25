/* Link de entrada de uso único, gerado pelo operador no servidor (CLI: link-entrada <@handle>).
   Serve enquanto o Instagram oficial não está ligado: entra no jogo como o dono de uma casa criada pela CLI.
   - o token vale 15 min e uma vez só (é uma sessão com ua 'link-entrada', revogada ao usar);
   - abrir o link (GET) só mostra um botão; a sessão nasce no POST com CSRF. Assim o preview do WhatsApp não gasta o link. */
import type { App } from '../../http/app';
import { criarSessao, encerrarSessao, ErroHttp, limite } from '../../http/app';
import { q, q1, tx, auditar } from '../../db/db';
import { tokenForte, sha256 } from '../../seguranca/cripto';

const UA = 'link-entrada';
const VALIDADE_MIN = 15;

/** cria o token para o usuário dono da identidade @handle; devolve o token cru (só aparece uma vez) */
export async function gerarLinkEntrada(handle: string) {
  const h = handle.replace(/^@/, '').trim().toLowerCase();
  const u = await q1<{ user_id: string }>(
    `select ei.user_id from external_identities ei
       join houses ho on ho.dono_identity_id = ei.id and ho.principal and ho.status = 'reivindicada'
      where lower(ei.username) = $1 and ei.user_id is not null and ei.revogado_em is null
      order by ho.reivindicada_em limit 1`, [h]);
  if (!u) throw new Error(`não achei casa reivindicada de @${h} (crie antes com: casa @${h} <ibge> "<motivo>")`);
  const t = tokenForte(32);
  await tx(async (c) => {
    await q(`update sessions set revogada_em = now() where user_id = $1 and ua = $2 and revogada_em is null`, [u.user_id, UA], c);
    await q(`insert into sessions (user_id, token_hash, expira_em, ua) values ($1, $2, now() + make_interval(mins => $3), $4)`, [u.user_id, sha256(t), VALIDADE_MIN, UA], c);
    await auditar(c, null, 'link_entrada.gerar', 'user:' + u.user_id, 'CLI link-entrada', { handle: h });
  });
  return t;
}

const PAGINA = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Entrar no jogo</title>
<style>body{font-family:system-ui,sans-serif;background:#b3d3ee;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;border:3px solid #1d2230;border-radius:20px;padding:24px;max-width:340px;text-align:center;box-shadow:0 4px 0 #1d2230}button{font:inherit;font-weight:800;background:#ffd23f;border:3px solid #1d2230;border-radius:999px;padding:12px 28px;cursor:pointer}p{color:#3a404c}</style></head>
<body><main><h2>Entrar no jogo</h2><p>Este link entra na sua conta e vale uma vez só.</p><button id="b">entrar</button><p id="m"></p></main>
<script>
document.getElementById('b').onclick = async function () {
  var m = document.getElementById('m'); this.disabled = true; m.textContent = 'entrando...';
  var c = (document.cookie.split('; ').find(function (x) { return x.indexOf('smn_csrf=') === 0; }) || '').slice(9);
  var t = new URLSearchParams(location.search).get('t') || '';
  var r = await fetch('/api/entrar-link', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': decodeURIComponent(c) }, body: JSON.stringify({ t: t }) });
  var j = {}; try { j = await r.json(); } catch (e) {}
  if (r.ok && j.ok) { location.href = '/'; return; }
  m.textContent = j.erro || 'link inválido ou vencido'; this.disabled = false;
};
</script></body></html>`;

export function registrarLinkEntrada(app: App) {
  app.get('/api/entrar-link', (c) => { c.header('cache-control', 'no-store'); c.header('referrer-policy', 'no-referrer'); return c.html(PAGINA); });
  app.post('/api/entrar-link', limite(10), async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    const t = String(b.t || '').slice(0, 100);
    if (!t) throw new ErroHttp(400, 'link incompleto');
    const s = await q1<{ id: string; user_id: string }>(
      `update sessions set revogada_em = now() where token_hash = $1 and ua = $2 and revogada_em is null and expira_em > now() returning id, user_id`, [sha256(t), UA]);
    if (!s) throw new ErroHttp(401, 'link inválido, já usado ou vencido. Gere outro no servidor.');
    await encerrarSessao(c);
    await criarSessao(c, s.user_id);
    await tx((x) => auditar(x, s.user_id, 'link_entrada.usar', 'user:' + s.user_id, null, {}));
    return c.json({ ok: true });
  });
}
