/* Reivindicação: prova de controle da identidade externa. Duas provas aceitas:
   1) link de uso único da private reply (token forte; só o sha256 no banco; GET não consome; POST consome atomicamente);
   2) desafio por código publicado pelo PRÓPRIO autor em mídia habilitada, concluído só pelo navegador do cookie smn_pend.
   Digitar um @ nunca autentica. */
import { q1, emitir, tx, type Tx } from '../../db/db';
import { config } from '../../config';
import { codigoLegivel, sha256, tokenForte } from '../../seguranca/cripto';
import { marcarOnboarding } from '../mundo/provisionar';
import { pagarIndicacoes, isolado } from '../instagram/indicacoes';
import { ErroHttp } from '../../http/app';

/** nome público: 2–30 caracteres, letras/números/espaço e . _ ' - (sem @, sem HTML) */
export function limparNome(n: unknown) {
  const s = String(n ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!/^[\p{L}\p{N} ._'-]{2,30}$/u.test(s)) return null;
  return s;
}

export type DadosTela = { cidade: string; uf: string; ibge: number; rua: string | null; lote: number | null; usuario_instagram: string | null; status_casa: string | null; expira_em: string };

async function dadosIdentidade(identityId: string, ex?: Tx) {
  return q1<{ cidade: string; uf: string; ibge: number; rua: string | null; lote: number | null; username: string | null; status_casa: string | null }>(
    `select m.nome cidade, m.uf, m.ibge, vs.nome rua, p.lote_index lote, ei.username, h.status status_casa
       from external_identities ei
       left join houses h on h.dono_identity_id = ei.id and h.principal and h.status in ('reservada','reivindicada')
       left join plots p on p.id = h.plot_id left join municipios m on m.ibge = p.ibge
       left join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null left join virtual_streets vs on vs.id = sm.street_id
      where ei.id = $1`, [identityId], ex);
}

/** GET do link: só valida e devolve os dados da tela. NÃO consome. */
export async function lerLink(t: string): Promise<DadosTela | null> {
  if (!t || t.length < 20 || t.length > 100) return null;
  const cl = await q1<{ identity_id: string; expira_em: Date }>(
    `select ic.identity_id, ic.expira_em from identity_claims ic join external_identities ei on ei.id = ic.identity_id
      where ic.token_hash = $1 and ic.consumido_em is null and ic.expira_em > now() and ei.revogado_em is null`, [sha256(t)]);
  if (!cl) return null;
  const d = await dadosIdentidade(cl.identity_id);
  return { cidade: d?.cidade || '', uf: d?.uf || '', ibge: d?.ibge || 0, rua: d?.rua ?? null, lote: d?.lote ?? null, usuario_instagram: d?.username ?? null, status_casa: d?.status_casa ?? null, expira_em: cl.expira_em.toISOString() };
}

/** vincula/cria o usuário da identidade comprovada, reivindica a casa reservada e marca o onboarding. */
export async function concluirIdentidade(c: Tx, identityId: string, nomePublico: string) {
  const idt = await q1<{ id: string; user_id: string | null; revogado_em: Date | null }>(`select id, user_id, revogado_em from external_identities where id = $1 for update`, [identityId], c);
  if (!idt || idt.revogado_em) throw new ErroHttp(410, 'esta identidade foi removida');
  let userId = idt.user_id;
  if (!userId) {
    userId = (await q1<{ id: string }>(`insert into users (nome_publico, verificado_em) values ($1, now()) returning id`, [nomePublico], c))!.id;
    await c.query(`update external_identities set user_id = $2 where id = $1`, [identityId, userId]);
  } else {
    const u = await q1<{ status: string }>(`update users set verificado_em = coalesce(verificado_em, now()) where id = $1 returning status`, [userId], c);
    if (!u || u.status !== 'ativo') throw new ErroHttp(403, 'conta suspensa ou removida');
  }
  const h = await q1<{ id: string }>(
    `update houses set status = 'reivindicada', dono_user_id = $2, reivindicada_em = now(), expira_em = null
      where dono_identity_id = $1 and principal and status = 'reservada' returning id`, [identityId, userId], c);
  const ob = await q1<{ estado: string }>(`select estado from onboarding where identity_id = $1`, [identityId], c);
  if (h || !ob || !['claimed', 'onboarding_complete'].includes(ob.estado)) await marcarOnboarding(c, identityId, 'claimed', null, { forcar: true });
  await c.query(`insert into privacy_preferences (user_id) values ($1) on conflict (user_id) do nothing`, [userId]);
  if (h) await isolado(c, 'indicacoes', () => pagarIndicacoes(c, identityId));
  if (h) await emitir(c, 'casa.reivindicada', { house_id: h.id, user_id: userId, identity_id: identityId }, 'casa.reivindicada:' + h.id);
  return { userId, houseId: h?.id ?? null };
}

/** POST do link: consome atomicamente (uma única vez) e conclui. Devolve null se inválido/expirado/usado. */
export async function confirmarLink(t: string, nomePublico: string) {
  if (!t || t.length < 20 || t.length > 100) return null;
  return tx(async (c) => {
    const cl = await q1<{ id: string; identity_id: string }>(
      `update identity_claims set consumido_em = now() where token_hash = $1 and consumido_em is null and expira_em > now() returning id, identity_id`, [sha256(t)], c);
    if (!cl) return null;
    const r = await concluirIdentidade(c, cl.identity_id, nomePublico);
    return { ...r, claimId: cl.id, identityId: cl.identity_id };
  });
}

// ---------- desafio por código ----------
export async function criarDesafio(pendHash: Buffer, handleInformado: string | null) {
  const codigo = codigoLegivel(10);
  await q1(`insert into claim_challenges (codigo_hash, sessao_pendente_hash, handle_informado, expira_em) values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [sha256(codigo), pendHash, handleInformado, config.reivindicacao.validadeDesafioMin]);
  return { codigo, validadeMin: config.reivindicacao.validadeDesafioMin };
}
export const novoPendente = () => tokenForte(32);

/** estado do desafio deste navegador (pelo hash do cookie). Conclui quando verificado + aceite. */
export async function statusDesafio(pendHash: Buffer, conclusao: { nomePublico: string } | null) {
  const ch = await q1<{ id: string; verificado_identity_id: string | null }>(
    `select id, verificado_identity_id from claim_challenges
      where sessao_pendente_hash = $1 and consumido_em is null and expira_em > now()
      order by (verificado_identity_id is not null) desc, criado_em desc limit 1`, [pendHash]);
  if (!ch) return { estado: 'expirado' as const };
  if (!ch.verificado_identity_id) return { estado: 'aguardando' as const };
  const d = await dadosIdentidade(ch.verificado_identity_id);
  const tela = { usuario_instagram: d?.username ?? null, cidade: d?.cidade ?? null, uf: d?.uf ?? null, rua: d?.rua ?? null, status_casa: d?.status_casa ?? null };
  if (!conclusao) return { estado: 'verificado' as const, ...tela };
  const r = await tx(async (c) => {
    const ok = await q1<{ verificado_identity_id: string }>(
      `update claim_challenges set consumido_em = now() where id = $1 and sessao_pendente_hash = $2 and consumido_em is null and expira_em > now() and verificado_identity_id is not null
       returning verificado_identity_id`, [ch.id, pendHash], c);
    if (!ok) return null;
    return concluirIdentidade(c, ok.verificado_identity_id, conclusao.nomePublico);
  });
  if (!r) return { estado: 'expirado' as const };
  return { estado: 'concluido' as const, ...tela, userId: r.userId };
}
