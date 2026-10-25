/* CLI administrativa (fora do painel, de propósito: o painel não concede papéis).
   npx tsx server/src/modulos/admin/cli.ts conceder <userId> <papel> "<motivo>"
   npx tsx server/src/modulos/admin/cli.ts revogar  <userId> <papel> "<motivo>"
   npx tsx server/src/modulos/admin/cli.ts papeis
   npx tsx server/src/modulos/admin/cli.ts sessao-dev <userId>     (só fora de produção: imprime cookie smn_sess para testar o painel)
   Toda concessão/revogação vai para admin_audit_logs (ator = null: operação de servidor). */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, q1, tx, auditar, fecharDb } from '../../db/db';
import { config } from '../../config';
import { tokenForte, sha256 } from '../../seguranca/cripto';
import { PAPEIS, type Papel } from './auth';

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
  else if (cmd === 'papeis') console.table(await q(`select r.user_id, u.nome_publico, r.papel, r.concedido_em from admin_roles r join users u on u.id = r.user_id order by r.concedido_em`));
  else if (cmd === 'sessao-dev') {
    if (config.ambiente === 'producao') throw new Error('sessao-dev não existe em produção');
    const t = tokenForte(32);
    await q(`insert into sessions (user_id, token_hash, expira_em, ua) values ($1, $2, now() + interval '2 hours', 'cli sessao-dev')`, [user, sha256(t)]);
    console.log(`document.cookie = "smn_sess=${t}; path=/"   (cole no console do navegador em http://localhost:5173/admin.html)`);
  } else { console.log('uso: conceder|revogar <userId> <papel> "<motivo>" · papeis · sessao-dev <userId>'); return; }
  console.log('ok');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).then(() => fecharDb(), (e) => { console.error(e.message || e); process.exitCode = 1; return fecharDb(); });
}
