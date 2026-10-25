/* Ajudantes de teste: banco limpo com todas as migrações + semente; app HTTP com cookies e CSRF. */
import pg from 'pg';
import { config } from '../src/config';
import { migrar } from '../src/db/migrar';
import { semear } from '../src/db/semear';
import { criarApp } from '../src/http/app';

export async function bancoLimpo() {
  const c = new pg.Client({ connectionString: config.databaseUrl }); await c.connect();
  await c.query('drop schema public cascade; create schema public;'); await c.end();
  await migrar(config.databaseUrl, () => {});
  await semear();
}

/** cliente HTTP de teste que guarda cookies e manda o CSRF */
export function cliente() {
  const app = criarApp(); const jar = new Map<string, string>();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function req(metodo: string, caminho: string, corpo?: unknown, headers: Record<string, string> = {}) {
    const r = await app.request(caminho, { method: metodo, headers: { 'content-type': 'application/json', cookie: cookieHeader(), 'x-csrf': jar.get('smn_csrf') || '', ...headers }, body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo) });
    for (const sc of r.headers.getSetCookie?.() || []) { const [kv] = sc.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(sc)) jar.delete(k); else jar.set(k, v); }
    let json: any = null; try { json = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, json, headers: r.headers };
  }
  return { app, jar, req, get: (p: string) => req('GET', p), post: (p: string, b?: unknown, h?: Record<string, string>) => req('POST', p, b, h), aquecer: () => req('GET', '/api/saude') };
}
