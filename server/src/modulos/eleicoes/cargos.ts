/* Mandatos e poderes dos cargos virtuais. Poder = comando de domínio com allowlist (catálogo aprovado), prazo,
   quota e auditoria. NÃO existe caminho para moderar, expulsar/despejar, mexer em votos, regras, ranking ou moedas. */
import { tx, q, q1, emitir, auditar, type Exec, type Tx } from '../../db/db';
import { ErroHttp } from '../../http/app';
import { type Cargo, carregarRegras, CARGO_NOME } from './regras';
import { escoposDoUsuario, exigirAdmin, UUID } from './dominio';

const erro = (s: number, m: string) => new ErroHttp(s, m);

export type Termo = { id: string; election_id: string; cargo: Cargo; escopo_id: string; escopo_nome: string; user_id: string; inicio: Date; fim: Date; estado: string };

/** poderes explicitamente negados (resposta clara em vez de "não encontrado") */
export const PODERES_PROIBIDOS = ['moderar', 'expulsar', 'despejar', 'remover_morador', 'tomar_casa', 'alterar_voto', 'alterar_regra', 'alterar_ranking',
  'dar_moedas', 'cancelar_eleicao', 'remover_prefeito', 'suspender', 'banir', 'ver_dados_privados'];

export async function termoAtivoDoUsuario(c: Exec, userId: string, agora: Date) {
  return q1<Termo>(`select * from office_terms where user_id = $1 and estado = 'ativo' and inicio <= $2 and fim > $2 order by inicio desc limit 1`, [userId, agora], c);
}
export async function mandatoVigente(c: Exec, cargo: Cargo, escopoId: string, agora: Date) {
  return q1<Termo>(`select * from office_terms where cargo = $1 and escopo_id = $2 and estado = 'ativo' and inicio <= $3 and fim > $3 limit 1`, [cargo, escopoId, agora], c);
}
export async function catalogo(c: Exec, cargo: Cargo) {
  return q<{ id: string; tipo: string; nome: string; descricao: string; duracao_horas: number; neutra: boolean }>(
    `select id, tipo, nome, descricao, duracao_horas, neutra from office_action_catalog where cargo = $1 and ativo order by tipo, neutra desc, id`, [cargo], c);
}

async function aindaNoEscopo(c: Exec, t: Termo, agora: Date): Promise<'ok' | 'vago_suspensao' | 'vago_saiu_escopo'> {
  const u = await q1<{ status: string; suspenso_ate: Date | null }>(`select status, suspenso_ate from users where id = $1`, [t.user_id], c);
  if (!u || u.status !== 'ativo' || (u.suspenso_ate && u.suspenso_ate > agora)) return 'vago_suspensao';
  const esc = await escoposDoUsuario(c, t.user_id);
  if (!esc) return 'vago_saiu_escopo';
  if (t.cargo === 'lider' && esc.streetId !== t.escopo_id) return 'vago_saiu_escopo';
  if (t.cargo === 'prefeito' && String(esc.ibge) !== t.escopo_id) return 'vago_saiu_escopo';
  return 'ok';
}

/** vacância: preserva histórico, não inventa sucessor; o calendário neutro assume até a próxima eleição */
export async function vagar(c: Exec, t: Termo, estado: 'vago_renuncia' | 'vago_suspensao' | 'vago_saiu_escopo', motivo: string, agora: Date) {
  const r = await q1(`update office_terms set estado = $2, encerrado_em = $3, motivo = $4 where id = $1 and estado = 'ativo' returning id`, [t.id, estado, agora, motivo], c);
  if (r) await emitir(c, 'mandato.vago', { termoId: t.id, cargo: t.cargo, escopoId: t.escopo_id, escopoNome: t.escopo_nome, userId: t.user_id, motivo: estado, calendarioNeutro: true, virtual: true }, `vago:${t.id}`);
  return !!r;
}

export async function executarAcao(userId: string, corpo: { tipo?: unknown; opcao?: unknown; escopoId?: unknown }, agora: Date) {
  const tipo = typeof corpo.tipo === 'string' ? corpo.tipo : '', opcao = typeof corpo.opcao === 'string' ? corpo.opcao : '';
  if (PODERES_PROIBIDOS.includes(tipo)) throw erro(403, 'cargo virtual não tem esse poder: só escolhas do catálogo aprovado (sem moderar, expulsar, mexer em votos, regras ou moedas)');
  return tx(async (c) => {
    const t0 = await termoAtivoDoUsuario(c, userId, agora);
    if (!t0) throw erro(403, 'você não ocupa cargo virtual ativo agora');
    const t = (await q1<Termo>(`select * from office_terms where id = $1 for update`, [t0.id], c))!;
    if (t.estado !== 'ativo') throw erro(403, 'seu mandato virtual não está ativo');
    if (corpo.escopoId !== undefined && String(corpo.escopoId) !== t.escopo_id)
      throw erro(403, `seu cargo de ${CARGO_NOME[t.cargo]} vale só para ${t.escopo_nome}`);
    const esc = await aindaNoEscopo(c, t, agora);
    if (esc !== 'ok') { await vagar(c, t, esc, 'verificado ao usar poder do cargo', agora); throw erro(403, 'mandato vago: o ocupante saiu do escopo ou foi suspenso'); }
    const item = await q1<{ id: string; tipo: string; nome: string; duracao_horas: number }>(
      `select id, tipo, nome, duracao_horas from office_action_catalog where id = $1 and cargo = $2 and tipo = $3 and ativo`, [opcao, t.cargo, tipo], c);
    if (!item) throw erro(400, 'ação fora do catálogo aprovado para este cargo virtual');
    const regras = await carregarRegras(c, (await q1<{ regra_id: string }>(`select regra_id from elections where id = $1`, [t.election_id], c))!.regra_id);
    const usadas = (await q1<{ n: number }>(`select count(*)::int n from office_actions where term_id = $1 and tipo = $2 and estado <> 'cancelada'`, [t.id, tipo], c))!.n;
    if (usadas >= regras.quotaAcoesPorTipo) throw erro(429, `quota do mandato atingida para "${tipo}" (${regras.quotaAcoesPorTipo} por mandato)`);
    const expira = new Date(Math.min(t.fim.getTime(), agora.getTime() + item.duracao_horas * 3600_000));
    const a = (await q1<{ id: string }>(
      `insert into office_actions (term_id, user_id, cargo, escopo_id, tipo, opcao_id, aplica_em, expira_em, criado_em) values ($1,$2,$3,$4,$5,$6,$7,$8,$7) returning id`,
      [t.id, userId, t.cargo, t.escopo_id, tipo, item.id, agora, expira], c))!;
    await auditar(c, userId, 'cargo.acao', t.id, null, { acaoId: a.id, cargo: t.cargo, escopoId: t.escopo_id, tipo, opcao: item.id });
    await emitir(c, 'cargo.acao', { acaoId: a.id, termoId: t.id, cargo: t.cargo, escopoId: t.escopo_id, escopoNome: t.escopo_nome, tipo, opcao: item.id, nome: item.nome, expiraEm: expira.toISOString(), virtual: true }, `acao:${a.id}`);
    return { acaoId: a.id, opcao: item.id, nome: item.nome, expiraEm: expira.toISOString() };
  });
}

/** escolha em vigor para um tipo (do cargo, se houver; senão a opção neutra do calendário do sistema) */
export async function escolhaVigente(c: Exec, cargo: Cargo, escopoId: string, tipo: string, agora: Date) {
  const a = await q1<{ opcao_id: string; nome: string; expira_em: Date }>(
    `select a.opcao_id, k.nome, a.expira_em from office_actions a join office_action_catalog k on k.id = a.opcao_id
      where a.cargo = $1 and a.escopo_id = $2 and a.tipo = $3 and a.estado = 'ativa' and a.aplica_em <= $4 and a.expira_em > $4 order by a.aplica_em desc limit 1`, [cargo, escopoId, tipo, agora], c);
  if (a) return { fonte: 'cargo' as const, opcao: a.opcao_id, nome: a.nome, ate: a.expira_em };
  const n = await q1<{ id: string; nome: string }>(`select id, nome from office_action_catalog where cargo = $1 and tipo = $2 and neutra and ativo limit 1`, [cargo, tipo], c);
  return n ? { fonte: 'calendario_neutro' as const, opcao: n.id, nome: n.nome, ate: null } : null;
}

export async function renunciar(userId: string, agora: Date) {
  return tx(async (c) => {
    const t = await termoAtivoDoUsuario(c, userId, agora);
    if (!t) throw erro(404, 'você não ocupa cargo virtual ativo');
    await vagar(c, t, 'vago_renuncia', 'renúncia do ocupante', agora);
    return { termoId: t.id, cargo: t.cargo, escopoNome: t.escopo_nome };
  });
}

export async function vagarPorAdmin(adminId: string, termoId: string, motivo: string, agora: Date) {
  if (!motivo || motivo.trim().length < 10) throw erro(400, 'descreva o motivo (mínimo 10 caracteres)');
  if (!UUID.test(termoId)) throw erro(404, 'mandato não encontrado');
  return tx(async (c) => {
    await exigirAdmin(c, adminId);
    const t = await q1<Termo>(`select * from office_terms where id = $1 for update`, [termoId], c);
    if (!t || t.estado !== 'ativo') throw erro(404, 'mandato ativo não encontrado');
    await vagar(c, t, 'vago_suspensao', motivo.trim(), agora);
    await auditar(c, adminId, 'cargo.vacancia', t.id, motivo.trim(), { cargo: t.cargo, escopoId: t.escopo_id, userId: t.user_id });
    return { termoId: t.id };
  });
}

/** fim fixo do mandato */
export async function expirarMandatos(agora: Date) {
  return tx(async (c: Tx) => {
    const r = await q<Termo>(`update office_terms set estado = 'encerrado', encerrado_em = fim, motivo = 'fim do mandato' where estado = 'ativo' and fim <= $1 returning *`, [agora], c);
    for (const t of r) await emitir(c, 'mandato.encerrado', { termoId: t.id, cargo: t.cargo, escopoId: t.escopo_id, userId: t.user_id, virtual: true }, `encerrado:${t.id}`);
    return r.length;
  });
}

/** ocupante suspenso ou que saiu do escopo → vacância (sem sucessor inventado) */
export async function verificarOcupantes(agora: Date) {
  const ativos = await q<Termo>(`select * from office_terms where estado = 'ativo'`);
  let n = 0;
  for (const t of ativos) {
    await tx(async (c) => {
      const st = await aindaNoEscopo(c, t, agora);
      if (st !== 'ok' && (await vagar(c, t, st, st === 'vago_suspensao' ? 'ocupante suspenso' : 'ocupante saiu do escopo', agora))) n++;
    });
  }
  return n;
}
