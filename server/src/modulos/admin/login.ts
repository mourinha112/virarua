/* Login do painel admin por usuário e senha (separado do login do jogo). Senha só como hash scrypt.
   5 erros seguidos bloqueiam o login por 15 min; cada tentativa é auditada. */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { App } from '../../http/app';
import { criarSessao, encerrarSessao, ErroHttp, limite } from '../../http/app';
import { q1, tx, auditar } from '../../db/db';

const scrypt = promisify(_scrypt) as (s: string, sal: Buffer, n: number) => Promise<Buffer>;

export async function hashSenha(senha: string) {
  const sal = randomBytes(16); const h = await scrypt(senha, sal, 64);
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}
export async function conferirSenha(senha: string, guardado: string) {
  const [tipo, salHex, hHex] = guardado.split('$'); if (tipo !== 'scrypt' || !salHex || !hHex) return false;
  const h = await scrypt(senha, Buffer.from(salHex, 'hex'), 64); const e = Buffer.from(hHex, 'hex');
  return e.length === h.length && timingSafeEqual(e, h);
}
export function senhaFraca(s: string) { return s.length < 10 || !/[a-z]/i.test(s) || !/[0-9]/.test(s); }

export function registrarLoginAdmin(app: App) {
  app.post('/api/admin/login', limite(10), async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    const login = String(b.login || '').trim().toLowerCase().slice(0, 40), senha = String(b.senha || '').slice(0, 200);
    const r = await q1<{ user_id: string; senha_hash: string; bloqueado: boolean }>(`select user_id, senha_hash, coalesce(bloqueado_ate > now(), false) bloqueado from admin_logins where login = $1`, [login]);
    if (r?.bloqueado) throw new ErroHttp(429, 'muitas tentativas: espere 15 minutos');
    const ok = !!r && (await conferirSenha(senha, r.senha_hash));
    await tx(async (t) => {
      if (r && ok) await t.query(`update admin_logins set falhas = 0, bloqueado_ate = null, ultimo_login_em = now() where login = $1`, [login]);
      else if (r) await t.query(`update admin_logins set falhas = falhas + 1, bloqueado_ate = case when falhas + 1 >= 5 then now() + interval '15 minutes' end where login = $1`, [login]);
      await auditar(t, r && ok ? r.user_id : null, ok ? 'admin.login' : 'admin.login_falhou', 'login:' + login, 'login do painel', { ip: c.req.header('x-real-ip') || '' });
    });
    if (!r || !ok) throw new ErroHttp(401, 'usuário ou senha incorretos');
    await encerrarSessao(c, { admin: true });
    await criarSessao(c, r.user_id, { admin: true });
    return c.json({ ok: true });
  });
  app.post('/api/admin/sair', async (c) => { await encerrarSessao(c, { admin: true }); return c.json({ ok: true }); });
}
