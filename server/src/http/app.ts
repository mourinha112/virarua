/* Aplicação HTTP (Hono). Sessão por cookie HttpOnly; CSRF double-submit (cookie smn_csrf + cabeçalho x-csrf) em
   toda requisição que muda estado, exceto webhooks assinados. Cada módulo registra suas rotas em modulos/index.ts. */
import { Hono, type Context, type Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { config } from '../config';
import { q1 } from '../db/db';
import { sha256, tokenForte, iguais } from '../seguranca/cripto';
import { registrarModulos } from '../modulos';

export type Usuario = { id: string; nome_publico: string; status: string; faixa_etaria: string; verificado_em: string | null };
export type Vars = { usuario: Usuario | null; sessaoId: string | null };
export type App = Hono<{ Variables: Vars }>;

const COOKIE_SESSAO = 'smn_sess', COOKIE_CSRF = 'smn_csrf';
/** cookie Secure só quando a requisição chegou por HTTPS (nginx manda X-Forwarded-Proto); em HTTP puro o navegador descartaria o cookie */
export const seguro = (c: Context) => (c.req.header('x-forwarded-proto') || new URL(c.req.url).protocol.replace(':', '')) === 'https';

export async function criarSessao(c: Context, userId: string) {
  const token = tokenForte(32);
  const r = await q1<{ id: string }>(`insert into sessions (user_id, token_hash, expira_em, ua) values ($1, $2, now() + interval '30 days', $3) returning id`, [userId, sha256(token), (c.req.header('user-agent') || '').slice(0, 200)]);
  setCookie(c, COOKIE_SESSAO, token, { httpOnly: true, secure: seguro(c), sameSite: 'Lax', path: '/', maxAge: 30 * 86400 });
  return r!.id;
}
export async function encerrarSessao(c: Context) {
  const t = getCookie(c, COOKIE_SESSAO); if (t) await q1(`update sessions set revogada_em = now() where token_hash = $1`, [sha256(t)]);
  deleteCookie(c, COOKIE_SESSAO, { path: '/' });
}

async function sessao(c: Context<{ Variables: Vars }>, next: Next) {
  c.set('usuario', null); c.set('sessaoId', null);
  const t = getCookie(c, COOKIE_SESSAO);
  if (t) {
    const r = await q1<Usuario & { sid: string }>(`select u.id, u.nome_publico, u.status, u.faixa_etaria, u.verificado_em, s.id sid from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.revogada_em is null and s.expira_em > now()`, [sha256(t)]);
    if (r && r.status === 'ativo') { c.set('usuario', r); c.set('sessaoId', r.sid); }
  }
  if (!getCookie(c, COOKIE_CSRF)) setCookie(c, COOKIE_CSRF, tokenForte(18), { httpOnly: false, secure: seguro(c), sameSite: 'Lax', path: '/' });
  await next();
}

async function csrf(c: Context, next: Next) {
  const m = c.req.method;
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS' || c.req.path.startsWith('/api/webhooks/')) return next();
  const k = getCookie(c, COOKIE_CSRF), h = c.req.header('x-csrf');
  if (!k || !h || !iguais(Buffer.from(k), Buffer.from(h))) return c.json({ ok: false, erro: 'sessão expirada: recarregue a página' }, 403);
  return next();
}

/** limite simples por IP+rota em memória (o servidor de produção deve somar o do proxy) */
const baldes = new Map<string, { n: number; t: number }>();
export function limite(porMinuto: number) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
    const k = ip + '|' + c.req.routePath, agora = Date.now(); const b = baldes.get(k);
    if (!b || agora - b.t > 60_000) baldes.set(k, { n: 1, t: agora });
    else if (++b.n > porMinuto) return c.json({ ok: false, erro: 'muitas tentativas, espere um minuto' }, 429);
    return next();
  };
}

export function exigirLogin(c: Context<{ Variables: Vars }>) {
  const u = c.get('usuario'); if (!u) throw new ErroHttp(401, 'entre na sua conta para fazer isso'); return u;
}
export class ErroHttp extends Error { constructor(public status: number, msg: string) { super(msg); } }

export function criarApp(): App {
  const app = new Hono<{ Variables: Vars }>();
  app.use('/api/*', sessao);
  app.use('/api/*', csrf);
  app.onError((e, c) => {
    if (e instanceof ErroHttp) return c.json({ ok: false, erro: e.message }, e.status as any);
    console.error('[http]', c.req.method, c.req.path, e);
    return c.json({ ok: false, erro: 'erro interno' }, 500);
  });
  app.get('/api/saude', (c) => c.json({ ok: true, ambiente: config.ambiente }));
  app.get('/api/sessao', (c) => { const u = c.get('usuario'); return c.json({ ok: true, usuario: u ? { id: u.id, nome: u.nome_publico } : null }); });
  app.post('/api/sair', async (c) => { await encerrarSessao(c); return c.json({ ok: true }); });
  registrarModulos(app);
  return app;
}
