/* CLI administrativa (fora do painel, de propósito: o painel não concede papéis).
   npx tsx server/src/modulos/admin/cli.ts conceder <userId> <papel> "<motivo>"
   npx tsx server/src/modulos/admin/cli.ts revogar  <userId> <papel> "<motivo>"
   npx tsx server/src/modulos/admin/cli.ts papeis
   npx tsx server/src/modulos/admin/cli.ts criar-admin <login>              (pede a senha sem mostrar; dá todos os papéis)
   npx tsx server/src/modulos/admin/cli.ts casa <@handle> <ibge> "<motivo>"   (casa reivindicada sem passar pelo Instagram)
   npx tsx server/src/modulos/admin/cli.ts sessao-dev <userId>     (só fora de produção: imprime cookie smn_sess para testar o painel)
   Toda concessão/revogação vai para admin_audit_logs (ator = null: operação de servidor). */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, q1, tx, auditar, fecharDb } from '../../db/db';
import { config } from '../../config';
import { tokenForte, sha256 } from '../../seguranca/cripto';
import { PAPEIS, type Papel } from './auth';
import { hashSenha, senhaFraca } from './login';
import { provisionar } from '../mundo/provisionar';

/** lê uma linha do terminal sem ecoar (senha) */
let _linhas: Promise<string[]> | null = null;
function linhasStdin() { return (_linhas ??= new Promise((ok) => { let buf = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', (d) => (buf += d)); process.stdin.on('end', () => ok(buf.split(/\r?\n/))); })); }
function perguntarOculto(rotulo: string): Promise<string> {
  return new Promise((ok) => {
    const ent = process.stdin; process.stdout.write(rotulo); let v = '';
    if (!ent.isTTY) { linhasStdin().then((l) => { process.stdout.write(String.fromCharCode(10)); ok(l.shift() ?? ''); }); return; }
    ent.setRawMode(true); ent.resume(); ent.setEncoding('utf8');
    const ler = (ch: string) => {
      for (const c of ch) {
        if (c === '\r' || c === '\n') { ent.setRawMode(false); ent.pause(); ent.off('data', ler); process.stdout.write('\n'); ok(v); return; }
        if (c === '\u0003') process.exit(130);
        if (c === '\u007f' || c === '\b') v = v.slice(0, -1); else v += c;
      }
    };
    ent.on('data', ler);
  });
}

export async function criarAdmin(login: string, senha: string) {
  login = login.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(login)) throw new Error('login: 3 a 40 letras minúsculas, números, ponto, _ ou -');
  if (senhaFraca(senha)) throw new Error('senha fraca: mínimo 10 caracteres, com letras e números');
  const h = await hashSenha(senha);
  return tx(async (c) => {
    const ja = await q1<{ user_id: string }>(`select user_id from admin_logins where login = $1`, [login], c);
    let uid = ja?.user_id;
    if (uid) await q(`update admin_logins set senha_hash = $2, falhas = 0, bloqueado_ate = null where login = $1`, [login, h], c);
    else {
      uid = (await q1<{ id: string }>(`insert into users (nome_publico, verificado_em, faixa_etaria) values ($1, now(), 'adulto') returning id`, ['admin ' + login], c))!.id;
      await q(`insert into admin_logins (login, user_id, senha_hash) values ($1, $2, $3)`, [login, uid, h], c);
    }
    for (const p of PAPEIS) await q(`insert into admin_roles (user_id, papel) values ($1, $2) on conflict do nothing`, [uid, p], c);
    await auditar(c, null, ja ? 'admin.senha_trocar' : 'admin.login_criar', 'login:' + login, 'CLI criar-admin', {});
    return uid!;
  });
}

export async function casaManual(handle: string, ibge: number, motivo: string) {
  const h = handle.replace(/^@/, '').trim().toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h)) throw new Error('@ inválido');
  if (!motivo || motivo.length < 5) throw new Error('motivo obrigatório');
  return tx(async (c) => {
    const m = await q1<{ nome: string; uf: string }>(`select nome, uf from municipios where ibge = $1`, [ibge], c);
    if (!m) throw new Error('município não encontrado: ' + ibge);
    const r = await provisionar(c, { escopo: 'manual', externalId: 'manual:' + h, username: h, ibge, origem: 'admin', provedor: 'instagram' });
    if (r.resultado === 'revoked') throw new Error('identidade revogada');
    const idt = (await q1<{ user_id: string | null }>(`select user_id from external_identities where id = $1`, [r.identityId], c))!;
    let uid = idt.user_id;
    if (!uid) { uid = (await q1<{ id: string }>(`insert into users (nome_publico, verificado_em, faixa_etaria) values ($1, now(), 'adulto') returning id`, [h], c))!.id; await q(`update external_identities set user_id = $2 where id = $1`, [r.identityId, uid], c); }
    await q(`update houses set dono_user_id = $2, status = 'reivindicada', reivindicada_em = coalesce(reivindicada_em, now()), expira_em = null where dono_identity_id = $1 and principal and status in ('reservada','reivindicada')`, [r.identityId, uid], c);
    await q(`insert into onboarding (identity_id, estado) values ($1, 'onboarding_complete') on conflict (identity_id) do update set estado = 'onboarding_complete', atualizado_em = now()`, [r.identityId], c);
    await auditar(c, null, 'casa.manual', 'identity:' + r.identityId, motivo, { handle: h, ibge });
    const lote = await q1<{ lote_index: number }>(`select p.lote_index from houses h join plots p on p.id = h.plot_id where h.dono_identity_id = $1 and h.principal`, [r.identityId], c);
    return { cidade: `${m.nome} - ${m.uf}`, lote: lote?.lote_index, nova: r.resultado === 'provisioned', userId: uid };
  });
}

export async function concederPapel(userId: string, papel: Papel, motivo: string) {
  if (!PAPEIS.includes(papel)) throw new Error('papel inválido: ' + PAPEIS.join(', '));
  if (!motivo || motivo.length < 5) throw new Error('motivo obrigatório');
  await tx(async (c) => {
    if (!(await q1(`select 1 from users where id = $1`, [userId], c))) throw new Error('usuário não encontrado');
    await q(`insert into admin_roles (user_id, papel) values ($1, $2) on conflict do nothing`, [userId, papel], c);
    await auditar(c, null, 'admin.papel_conceder', 'user:' + userId, motivo, { papel });
  });
}
export async function revogarPapel(userId: string, papel: Papel, motivo: string) {
  await tx(async (c) => {
    await q(`delete from admin_roles where user_id = $1 and papel = $2`, [userId, papel], c);
    await auditar(c, null, 'admin.papel_revogar', 'user:' + userId, motivo, { papel });
  });
}

async function main(a: string[]) {
  const [cmd, user, papel, motivo] = a;
  if (cmd === 'conceder') await concederPapel(user, papel as Papel, motivo);
  else if (cmd === 'revogar') await revogarPapel(user, papel as Papel, motivo);
  else if (cmd === 'criar-admin') {
    if (!user) throw new Error('uso: criar-admin <login>');
    const s1 = await perguntarOculto('senha do painel: '); const s2 = await perguntarOculto('repita a senha: ');
    if (s1 !== s2) throw new Error('as senhas não conferem');
    await criarAdmin(user, s1); console.log(`admin pronto: entre em /admin.html com o usuário "${user.trim().toLowerCase()}"`);
  } else if (cmd === 'casa') {
    const r = await casaManual(user, Number(papel), motivo || 'casa criada pelo operador');
    console.log(`${r.nova ? 'casa criada' : 'a casa já existia'}: @${user.replace(/^@/, '').toLowerCase()} em ${r.cidade}, lote ${r.lote}`);
  }
  else if (cmd === 'papeis') console.table(await q(`select r.user_id, u.nome_publico, r.papel, r.concedido_em from admin_roles r join users u on u.id = r.user_id order by r.concedido_em`));
  else if (cmd === 'sessao-dev') {
    if (config.ambiente === 'producao') throw new Error('sessao-dev não existe em produção');
    const t = tokenForte(32);
    await q(`insert into sessions (user_id, token_hash, expira_em, ua) values ($1, $2, now() + interval '2 hours', 'cli sessao-dev')`, [user, sha256(t)]);
    console.log(`document.cookie = "smn_sess=${t}; path=/"   (cole no console do navegador em http://localhost:5173/admin.html)`);
  } else { console.log('uso: conceder|revogar <userId> <papel> "<motivo>" · papeis · criar-admin <login> · casa <@handle> <ibge> "<motivo>" · sessao-dev <userId>'); return; }
  console.log('ok');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(() => fecharDb(), (e) => { console.error(e.message || e); process.exitCode = 1; return fecharDb(); });
}
