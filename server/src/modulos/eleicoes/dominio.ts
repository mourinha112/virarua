/* Domínio das eleições virtuais: temporada, eleição, candidatura, apoio, voto, congelamento do eleitorado,
   apuração idempotente, segundo turno, posse, retirada/suspensão e correção administrativa.
   Toda função que depende de prazo recebe `agora` (relógio injetável; em produção é o relógio do SERVIDOR).
   Peso de voto é sempre 1: nenhuma consulta daqui lê XP, pontos, ledger ou pagamentos. */
import { tx, q, q1, emitir, auditar, type Exec, type Tx } from '../../db/db';
import { enfileirar } from '../../jobs/fila';
import { ErroHttp } from '../../http/app';
import { config } from '../../config';
import {
  type Cargo, type Regras, ESCOPO_DO_CARGO, CARGO_NOME, REGRAS_PADRAO, carregarRegras, regraVigente, segundaDaSemana,
  localParaUtc, calcularCalendario, calcularQuorum, normalizarRegras, validarRegras, versaoDe,
} from './regras';

export const FUSO = config.fusoJogo;
const erro = (s: number, m: string) => new ErroHttp(s, m);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Temporada = { id: string; codigo: string; regra_id: string; inscricoes_abrem: Date; inscricoes_fecham: Date; votacao_abre: Date; votacao_fecha: Date; publica_em: Date; mandato_fim: Date };
export type Eleicao = {
  id: string; season_id: string; regra_id: string; cargo: Cargo; escopo: string; escopo_id: string; escopo_nome: string; ibge: number | null; street_id: string | null;
  turno: number; origem_id: string | null; estado: string; modo: 'disputa' | 'confirmacao' | null;
  inscricoes_fecham: Date; votacao_abre: Date; votacao_fecha: Date; publica_em: Date; congelada_em: Date | null;
  eleitorado: number | null; quorum: number | null; resultado_tipo: string | null; resultado: any; vencedor_user_id: string | null; apurada_em: Date | null;
  lider_provisorio: string | null; placar_atualizado_em: Date | null;
};

/* ---------- temporada e eleição ---------- */

/** temporada da semana que contém `agora` (criada sob demanda; a regra fica congelada nela) */
export async function garantirTemporada(c: Exec, agora: Date): Promise<Temporada> {
  const seg = segundaDaSemana(FUSO, agora);
  const codigo = calcularCalendario(REGRAS_PADRAO, seg).codigo;
  const ex = await q1<Temporada>(`select * from seasons where codigo = $1`, [codigo], c);
  if (ex) return ex;
  const rv = await regraVigente(c, localParaUtc(FUSO, seg.y, seg.m, seg.d));
  const cal = calcularCalendario(rv.regras, seg);
  await q(`insert into seasons (codigo, regra_id, inscricoes_abrem, inscricoes_fecham, votacao_abre, votacao_fecha, publica_em, mandato_fim)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (codigo) do nothing`,
    [codigo, rv.id, cal.inscricoesAbrem, cal.inscricoesFecham, cal.votacaoAbre, cal.votacaoFecha, cal.publicaEm, cal.mandatoFim], c);
  return (await q1<Temporada>(`select * from seasons where codigo = $1`, [codigo], c))!;
}

/** eleição (turno 1) de um cargo/escopo na temporada corrente, criada sob demanda (idempotente) */
export async function garantirEleicao(c: Exec, cargo: Cargo, escopoId: string, agora: Date): Promise<Eleicao> {
  const s = await garantirTemporada(c, agora);
  let nome: string, ibge: number | null = null, rua: string | null = null;
  if (cargo === 'lider') {
    if (!UUID.test(escopoId)) throw erro(404, 'rua não encontrada');
    const r = await q1<{ nome: string; ibge: number; cidade: string; uf: string }>(`select v.nome, v.ibge, m.nome cidade, m.uf from virtual_streets v join municipios m on m.ibge = v.ibge where v.id = $1`, [escopoId], c);
    if (!r) throw erro(404, 'rua não encontrada');
    nome = `${r.nome} · ${r.cidade}`; ibge = r.ibge; rua = escopoId;
  } else if (cargo === 'prefeito') {
    const m = /^\d{7}$/.test(escopoId) ? await q1<{ nome: string; uf: string }>(`select nome, uf from municipios where ibge = $1`, [Number(escopoId)], c) : null;
    if (!m) throw erro(404, 'cidade não encontrada');
    nome = `${m.nome} · ${m.uf}`; ibge = Number(escopoId);
  } else {
    if (escopoId !== 'BR') throw erro(404, 'escopo nacional é BR');
    nome = 'Brasil virtual';
  }
  await q(`insert into elections (season_id, regra_id, cargo, escopo, escopo_id, escopo_nome, ibge, street_id, inscricoes_fecham, votacao_abre, votacao_fecha, publica_em)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) on conflict (season_id, cargo, escopo_id, turno) do nothing`,
    [s.id, s.regra_id, cargo, ESCOPO_DO_CARGO[cargo], escopoId, nome, ibge, rua, s.inscricoes_fecham, s.votacao_abre, s.votacao_fecha, s.publica_em], c);
  return (await q1<Eleicao>(`select * from elections where season_id = $1 and cargo = $2 and escopo_id = $3 and turno = 1`, [s.id, cargo, escopoId], c))!;
}

/* ---------- residência e elegibilidade ---------- */

export type Escopos = { houseId: string; ibge: number; cidade: string; uf: string; streetId: string | null; rua: string | null };
export async function escoposDoUsuario(c: Exec, userId: string): Promise<Escopos | null> {
  return q1<Escopos>(
    `select h.id "houseId", p.ibge, m.nome cidade, m.uf, sm.street_id "streetId", vs.nome rua
       from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge
       left join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null
       left join virtual_streets vs on vs.id = sm.street_id
      where h.dono_user_id = $1 and h.status = 'reivindicada' and h.principal limit 1`, [userId], c);
}
export function escopoIdDe(cargo: Cargo, e: Escopos): string | null {
  return cargo === 'lider' ? e.streetId : cargo === 'prefeito' ? String(e.ibge) : 'BR';
}

/** elegível AGORA (para inscrição e apoio). O voto usa o snapshot congelado, não esta função. */
export async function elegivelNoEscopo(c: Exec, userId: string, cargo: Cargo, escopoId: string, instante: Date, regras: Regras): Promise<{ ok: true } | { ok: false; motivo: string }> {
  const u = await q1<{ status: string; suspenso_ate: Date | null; verificado_em: Date | null }>(`select status, suspenso_ate, verificado_em from users where id = $1`, [userId], c);
  if (!u || u.status !== 'ativo' || (u.suspenso_ate && u.suspenso_ate > instante)) return { ok: false, motivo: 'conta suspensa ou inativa não participa da eleição virtual' };
  if (!u.verificado_em || u.verificado_em.getTime() > instante.getTime() - regras.verificadoHoras * 3600_000)
    return { ok: false, motivo: `a conta precisa estar verificada há pelo menos ${regras.verificadoHoras}h` };
  const esc = await escoposDoUsuario(c, userId);
  if (!esc) return { ok: false, motivo: 'é preciso ter uma casa reivindicada' };
  if (escopoIdDe(cargo, esc) !== escopoId) return { ok: false, motivo: 'você não mora neste lugar' };
  return { ok: true };
}

async function lerEleicao(c: Exec, id: string, trava: '' | 'for update' | 'for share' = ''): Promise<Eleicao> {
  if (!UUID.test(id)) throw erro(404, 'eleição virtual não encontrada');
  const e = await q1<Eleicao>(`select * from elections where id = $1 ${trava}`, [id], c);
  if (!e) throw erro(404, 'eleição virtual não encontrada');
  return e;
}

/* ---------- candidatura ---------- */

export async function candidatar(userId: string, eleicaoId: string, opts: { cargo?: unknown; trocar?: unknown }, agora: Date) {
  return tx(async (c) => {
    const e = await lerEleicao(c, eleicaoId, 'for update');
    const s = (await q1<Temporada>(`select * from seasons where id = $1`, [e.season_id], c))!;
    if (e.turno !== 1 || e.estado !== 'inscricoes' || agora < s.inscricoes_abrem || agora >= e.inscricoes_fecham)
      throw erro(409, 'as inscrições desta eleição virtual estão fechadas');
    if (opts.cargo !== e.cargo) throw erro(400, `confirme a intenção: esta eleição virtual é para ${CARGO_NOME[e.cargo]} de ${e.escopo_nome}`);
    const regras = await carregarRegras(c, e.regra_id);
    const el = await elegivelNoEscopo(c, userId, e.cargo, e.escopo_id, agora, regras);
    if (!el.ok) throw erro(403, el.motivo);
    await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`cand:${e.season_id}:${userId}`]);
    const atual = await q1<{ id: string; election_id: string; estado: string }>(
      `select id, election_id, estado from candidates where season_id = $1 and user_id = $2 and turno = 1 and estado in ('inscrito','suspenso')`, [e.season_id, userId], c);
    if (atual?.estado === 'suspenso') throw erro(403, 'sua candidatura foi suspensa nesta temporada (regra publicada)');
    if (atual && atual.election_id === e.id) return { candidatoId: atual.id, jaInscrito: true, trocou: false };
    if (atual) {
      const outra = (await q1<{ cargo: Cargo; escopo_nome: string }>(`select cargo, escopo_nome from elections where id = $1`, [atual.election_id], c))!;
      if (opts.trocar !== true) throw erro(409, `você já é candidato a ${CARGO_NOME[outra.cargo]} de ${outra.escopo_nome} nesta temporada (um cargo só). Para trocar, confirme a troca: os apoios antigos serão invalidados.`);
      await q(`update candidates set estado = 'trocou', motivo = 'trocou de cargo', atualizado_em = $2 where id = $1`, [atual.id, agora], c);
      await q(`update nomination_supports set invalidado_em = $2, motivo_invalidacao = 'candidato trocou de cargo' where candidate_id = $1 and invalidado_em is null`, [atual.id, agora], c);
      await emitir(c, 'eleicao.candidatura_trocada', { candidatoAnterior: atual.id, eleicaoAnterior: atual.election_id, eleicaoNova: e.id }, `troca:${atual.id}`);
    }
    const intencao = `quero concorrer a ${CARGO_NOME[e.cargo]} de ${e.escopo_nome} na eleição virtual ${s.codigo}`;
    const r = await q1<{ id: string }>(
      `insert into candidates (season_id, election_id, user_id, cargo, intencao, criado_em, atualizado_em) values ($1,$2,$3,$4,$5,$6,$6)
       on conflict (election_id, user_id) do update set estado = 'inscrito', intencao = excluded.intencao, motivo = null, atualizado_em = excluded.atualizado_em
         where candidates.estado in ('retirado','trocou') returning id`, [e.season_id, e.id, userId, e.cargo, intencao, agora], c);
    if (!r) throw erro(409, 'não foi possível reativar esta candidatura');
    await emitir(c, 'eleicao.candidatura', { eleicaoId: e.id, candidatoId: r.id, cargo: e.cargo, escopoId: e.escopo_id }, `candidatura:${r.id}:${agora.getTime()}`);
    return { candidatoId: r.id, jaInscrito: false, trocou: !!atual, intencao };
  });
}

/** torna o candidato inelegível (retirada ou suspensão) seguindo a regra publicada "invalido_com_aviso" */
async function inativarCandidato(c: Tx, cand: { id: string }, e: Eleicao, estado: 'retirado' | 'suspenso', motivo: string, agora: Date) {
  await q(`update candidates set estado = $2, motivo = $3, atualizado_em = $4 where id = $1`, [cand.id, estado, motivo, agora], c);
  await q(`update nomination_supports set invalidado_em = $2, motivo_invalidacao = $3 where candidate_id = $1 and invalidado_em is null`, [cand.id, agora, 'candidatura ' + estado], c);
  const inv = await q<{ voter_id: string }>(
    `insert into vote_audit (election_id, voter_id, candidate_id, escolha, acao, motivo, criado_em)
     select election_id, voter_id, candidate_id, escolha, 'invalidado', $2, $3 from votes where candidate_id = $1 returning voter_id`, [cand.id, `candidatura ${estado}: ${motivo}`, agora], c);
  await emitir(c, 'eleicao.candidato_inativo', {
    eleicaoId: e.id, candidatoId: cand.id, estado, votosInvalidados: inv.length, aindaHaPrazo: agora < e.votacao_fecha,
    avisar: agora < e.votacao_fecha ? inv.map((v) => v.voter_id) : [],   // notificação privada (não é pública)
  }, `inativo:${cand.id}:${estado}`);
  return inv.length;
}

export async function retirarCandidatura(userId: string, eleicaoId: string, agora: Date) {
  return tx(async (c) => {
    const e = await lerEleicao(c, eleicaoId, 'for update');
    if (!['inscricoes', 'congelada', 'votacao'].includes(e.estado) || agora >= e.votacao_fecha) throw erro(409, 'não dá mais para retirar: a votação desta eleição virtual fechou');
    const cand = await q1<{ id: string }>(`select id from candidates where election_id = $1 and user_id = $2 and estado = 'inscrito'`, [e.id, userId], c);
    if (!cand) throw erro(404, 'você não é candidato nesta eleição virtual');
    const n = await inativarCandidato(c, cand, e, 'retirado', 'retirada voluntária', agora);
    return { votosInvalidados: n };
  });
}

export async function exigirAdmin(c: Exec, userId: string) {
  const r = await q1(`select 1 from admin_roles where user_id = $1 and papel in ('admin_tecnico','moderador')`, [userId], c);
  if (!r) throw erro(403, 'ação administrativa: só a equipe da plataforma');
}

export async function suspenderCandidato(adminId: string, candidatoId: string, motivo: string, agora: Date) {
  if (!motivo || motivo.trim().length < 10) throw erro(400, 'descreva o motivo (mínimo 10 caracteres): fica na auditoria');
  if (!UUID.test(candidatoId)) throw erro(404, 'candidatura não encontrada');
  return tx(async (c) => {
    await exigirAdmin(c, adminId);
    const k = await q1<{ id: string; election_id: string; estado: string; user_id: string }>(`select id, election_id, estado, user_id from candidates where id = $1`, [candidatoId], c);
    if (!k) throw erro(404, 'candidatura não encontrada');
    const e = await lerEleicao(c, k.election_id, 'for update');
    if (k.estado !== 'inscrito') throw erro(409, 'candidatura já não está ativa');
    if (['publicada', 'sem_eleito', 'segundo_turno', 'fundacao', 'cancelada'].includes(e.estado)) throw erro(409, 'resultado já publicado: use a correção administrativa');
    const n = await inativarCandidato(c, k, e, 'suspenso', motivo.trim(), agora);
    await auditar(c, adminId, 'eleicao.suspender_candidato', candidatoId, motivo.trim(), { eleicaoId: e.id, userId: k.user_id, votosInvalidados: n });
    return { votosInvalidados: n };
  });
}

/* ---------- apoio (≠ voto) ---------- */

export async function apoiar(userId: string, eleicaoId: string, candidatoId: unknown, agora: Date) {
  return tx(async (c) => {
    const e = await lerEleicao(c, eleicaoId, 'for share');
    if (e.cargo !== 'presidente') throw erro(400, 'só a candidatura a presidente usa apoios nesta eleição virtual');
    if (e.estado !== 'inscricoes' || agora >= e.inscricoes_fecham) throw erro(409, 'apoios só durante as inscrições');
    if (typeof candidatoId !== 'string' || !UUID.test(candidatoId)) throw erro(400, 'candidatura inválida');
    const cand = await q1<{ id: string; user_id: string }>(`select id, user_id from candidates where id = $1 and election_id = $2 and estado = 'inscrito'`, [candidatoId, e.id], c);
    if (!cand) throw erro(404, 'candidatura não encontrada');
    if (cand.user_id === userId) throw erro(400, 'o apoio precisa vir de outra conta');
    const regras = await carregarRegras(c, e.regra_id);
    const el = await elegivelNoEscopo(c, userId, 'presidente', 'BR', agora, regras);
    if (!el.ok) throw erro(403, el.motivo);
    const r = await q1(`insert into nomination_supports (election_id, candidate_id, apoiador_user_id, criado_em) values ($1,$2,$3,$4)
                        on conflict (election_id, apoiador_user_id) where invalidado_em is null do nothing returning id`, [e.id, cand.id, userId, agora], c);
    if (!r) {
      const ex = await q1<{ candidate_id: string }>(`select candidate_id from nomination_supports where election_id = $1 and apoiador_user_id = $2 and invalidado_em is null`, [e.id, userId], c);
      if (ex?.candidate_id !== cand.id) throw erro(409, 'você já apoia outra candidatura nesta eleição virtual (apoio não é voto)');
    }
    const n = (await q1<{ n: number }>(`select count(*)::int n from nomination_supports where candidate_id = $1 and invalidado_em is null`, [cand.id], c))!.n;
    return { apoios: n, necessarios: regras.apoiosPresidente };
  });
}

/* ---------- voto ---------- */

export async function votar(userId: string, eleicaoId: string, candidatoRef: unknown, agora: Date) {
  if (!UUID.test(eleicaoId)) throw erro(404, 'eleição virtual não encontrada');
  await avancarEleicao(eleicaoId, agora); // se o worker atrasou, congela/abre aqui (mesma lógica, com trava)
  return tx(async (c) => {
    const e = await lerEleicao(c, eleicaoId, 'for share');
    if (agora < e.votacao_abre) throw erro(409, 'a votação desta eleição virtual ainda não abriu');
    if (agora >= e.votacao_fecha) throw erro(409, 'a votação desta eleição virtual já fechou (horário do servidor)');
    if (e.estado !== 'votacao') throw erro(409, 'esta eleição virtual não está em votação');
    const snap = await q1(`select 1 from eligibility_snapshots where election_id = $1 and user_id = $2`, [e.id, userId], c);
    if (!snap) throw erro(403, 'você não está no eleitorado congelado desta eleição virtual (novos moradores votam na próxima)');
    const u = await q1<{ status: string; suspenso_ate: Date | null }>(`select status, suspenso_ate from users where id = $1`, [userId], c);
    if (!u || u.status !== 'ativo' || (u.suspenso_ate && u.suspenso_ate > agora)) throw erro(403, 'conta suspensa não vota');
    let candId: string, escolha: 'voto' | 'confirmar' | 'rejeitar';
    if (candidatoRef === 'rejeitar') {
      if (e.modo !== 'confirmacao') throw erro(400, 'rejeitar só existe em candidatura única');
      const unico = await q1<{ id: string }>(`select id from candidates where election_id = $1 and estado = 'inscrito' limit 1`, [e.id], c);
      if (!unico) throw erro(409, 'não há candidatura ativa nesta eleição virtual');
      candId = unico.id; escolha = 'rejeitar';
    } else {
      if (typeof candidatoRef !== 'string' || !UUID.test(candidatoRef)) throw erro(400, 'escolha uma candidatura');
      const k = await q1<{ id: string }>(`select id from candidates where id = $1 and election_id = $2 and estado = 'inscrito'`, [candidatoRef, e.id], c);
      if (!k) throw erro(400, 'candidatura inválida, retirada ou suspensa: escolha outra');
      candId = k.id; escolha = e.modo === 'confirmacao' ? 'confirmar' : 'voto';
    }
    const r = (await q1<{ novo: boolean; mudou: boolean }>(
      `insert into votes (election_id, voter_id, candidate_id, escolha, criado_em, atualizado_em) values ($1,$2,$3,$4,$5,$5)
       on conflict (election_id, voter_id) do update set candidate_id = excluded.candidate_id, escolha = excluded.escolha, atualizado_em = excluded.atualizado_em,
         trocas = votes.trocas + case when votes.candidate_id <> excluded.candidate_id or votes.escolha <> excluded.escolha then 1 else 0 end
       returning (xmax = 0) novo, true mudou`, [e.id, userId, candId, escolha, agora], c))!;
    await q(`insert into vote_audit (election_id, voter_id, candidate_id, escolha, acao, criado_em) values ($1,$2,$3,$4,$5,$6)`,
      [e.id, userId, candId, escolha, r.novo ? 'votou' : 'trocou', agora], c);
    return { novo: r.novo, trocou: !r.novo };
  });
}

/* ---------- máquina de estados (congelar → abrir → fechar → apurar) ---------- */

/** avança a eleição em todos os passos vencidos. Trava a linha (FOR UPDATE): dois workers nunca apuram juntos. */
export async function avancarEleicao(eleicaoId: string, agora: Date): Promise<string | null> {
  return tx(async (c) => {
    const e = await q1<Eleicao>(`select * from elections where id = $1 for update`, [eleicaoId], c);
    if (!e) return null;
    const regras = await carregarRegras(c, e.regra_id);
    for (let i = 0; i < 8; i++) {
      if (e.estado === 'inscricoes' && agora >= e.inscricoes_fecham) await congelar(c, e, regras, agora);
      else if (e.estado === 'congelada' && agora >= e.votacao_abre) await abrirVotacao(c, e);
      else if (e.estado === 'votacao' && agora >= e.votacao_fecha) await fecharVotacao(c, e, agora);
      else if (e.estado === 'apuracao' && agora >= e.publica_em) await apurar(c, e, regras, agora);
      else break;
    }
    return e.estado;
  });
}

async function setEstado(c: Tx, e: Eleicao, campos: Partial<Eleicao>) {
  const ks = Object.keys(campos) as (keyof Eleicao)[];
  await q(`update elections set ${ks.map((k, i) => `${k} = $${i + 2}`).join(', ')} where id = $1`, [e.id, ...ks.map((k) => (k === 'resultado' ? JSON.stringify(campos[k]) : campos[k]))], c);
  Object.assign(e, campos);
}

async function congelar(c: Tx, e: Eleicao, regras: Regras, agora: Date) {
  const corte = e.inscricoes_fecham;
  const corteVerif = new Date(corte.getTime() - regras.verificadoHoras * 3600_000);
  if (e.cargo === 'presidente') {
    await q(`update candidates k set estado = 'sem_apoios', motivo = $3, atualizado_em = $4 where k.election_id = $1 and k.estado = 'inscrito'
             and (select count(*) from nomination_supports s where s.candidate_id = k.id and s.invalidado_em is null) < $2`,
      [e.id, regras.apoiosPresidente, `menos de ${regras.apoiosPresidente} apoios no fechamento das inscrições`, agora], c);
  }
  const filtro = e.escopo === 'rua' ? `and sm.street_id = $5::uuid` : e.escopo === 'cidade' ? `and p.ibge = $5::int` : `and $5::text = 'BR'`;
  await q(`insert into eligibility_snapshots (election_id, user_id, house_id, street_id, ibge, verificado_em, congelado_em)
           select $1, u.id, h.id, sm.street_id, p.ibge, u.verificado_em, $2
             from users u join houses h on h.dono_user_id = u.id and h.status = 'reivindicada' and h.principal
             join plots p on p.id = h.plot_id
             left join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null
            where u.status = 'ativo' and (u.suspenso_ate is null or u.suspenso_ate <= $3) and u.verificado_em is not null and u.verificado_em <= $4 ${filtro}
           on conflict do nothing`, [e.id, agora, corte, corteVerif, e.escopo_id], c);
  await q(`update candidates k set estado = 'inelegivel', motivo = 'fora do eleitorado congelado (residência/verificação)', atualizado_em = $2
           where k.election_id = $1 and k.estado = 'inscrito' and not exists (select 1 from eligibility_snapshots s where s.election_id = $1 and s.user_id = k.user_id)`, [e.id, agora], c);
  const eleitorado = (await q1<{ n: number }>(`select count(*)::int n from eligibility_snapshots where election_id = $1`, [e.id], c))!.n;
  const quorum = calcularQuorum(eleitorado, regras.quorumPct);
  const ativos = (await q1<{ n: number }>(`select count(*)::int n from candidates where election_id = $1 and estado = 'inscrito'`, [e.id], c))!.n;
  const base = { congelada_em: agora, eleitorado, quorum };
  if (eleitorado < regras.limiares[e.cargo]) {
    await setEstado(c, e, { ...base, estado: 'fundacao', resultado_tipo: 'fundacao', apurada_em: agora, resultado: { eleitorado, limiar: regras.limiares[e.cargo], provisorio: false } });
    await emitirResultado(c, e);
  } else if (ativos === 0) {
    await setEstado(c, e, { ...base, estado: 'sem_eleito', resultado_tipo: 'sem_candidato', apurada_em: agora, resultado: { eleitorado, quorum, provisorio: false } });
    await emitirResultado(c, e);
  } else {
    await setEstado(c, e, { ...base, estado: 'congelada', modo: ativos === 1 ? 'confirmacao' : 'disputa' });
    await emitir(c, 'eleicao.eleitorado_congelado', { eleicaoId: e.id, cargo: e.cargo, escopoId: e.escopo_id, eleitorado, candidatos: ativos }, `congelada:${e.id}`);
  }
}

async function abrirVotacao(c: Tx, e: Eleicao) {
  await setEstado(c, e, { estado: 'votacao' });
  await emitir(c, 'eleicao.votacao_aberta', { eleicaoId: e.id, cargo: e.cargo, escopoId: e.escopo_id, escopoNome: e.escopo_nome, turno: e.turno, fechaEm: e.votacao_fecha.toISOString(), virtual: true }, `aberta:${e.id}`);
}

async function fecharVotacao(c: Tx, e: Eleicao, agora: Date) {
  await setEstado(c, e, { estado: 'apuracao' });
  await emitir(c, 'eleicao.votacao_fechada', { eleicaoId: e.id, cargo: e.cargo, escopoId: e.escopo_id, turno: e.turno, virtual: true }, `fechada:${e.id}`);
  await enfileirar(c, 'eleicoes.apurar', { eleicaoId: e.id }, `apurar:${e.id}`, Math.max(0, Math.ceil((e.publica_em.getTime() - agora.getTime()) / 1000)));
}

/** contagem de votos VÁLIDOS (candidato ativo, eleitor no snapshot). Cada linha de votes vale exatamente 1. */
export async function contarVotos(c: Exec, eleicaoId: string) {
  const rows = await q<{ candidate_id: string; user_id: string; escolha: string; n: number }>(
    `select k.id candidate_id, k.user_id, v.escolha, count(v.voter_id)::int n
       from candidates k left join votes v on v.candidate_id = k.id and v.election_id = k.election_id
        and exists (select 1 from eligibility_snapshots s where s.election_id = k.election_id and s.user_id = v.voter_id)
      where k.election_id = $1 and k.estado = 'inscrito' group by 1, 2, 3`, [eleicaoId], c);
  const por = new Map<string, { candidatoId: string; userId: string; votos: number; sim: number; nao: number }>();
  for (const r of rows) {
    const t = por.get(r.candidate_id) || { candidatoId: r.candidate_id, userId: r.user_id, votos: 0, sim: 0, nao: 0 }; por.set(r.candidate_id, t);
    if (r.escolha === 'rejeitar') t.nao += r.n; else if (r.escolha === 'confirmar') { t.sim += r.n; t.votos += r.n; } else if (r.escolha) t.votos += r.n;
  }
  const totais = [...por.values()].sort((a, b) => b.votos - a.votos);
  const validos = totais.reduce((s, t) => s + t.votos + t.nao, 0);
  return { totais, validos };
}

async function apurar(c: Tx, e: Eleicao, regras: Regras, agora: Date) {
  const { totais, validos } = await contarVotos(c, e.id);
  const eleitorado = e.eleitorado ?? 0, quorum = e.quorum ?? calcularQuorum(eleitorado, regras.quorumPct);
  const res: any = { eleitorado, quorum, votosValidos: validos, totais: totais.map((t) => ({ candidatoId: t.candidatoId, userId: t.userId, votos: t.votos, sim: t.sim, nao: t.nao })), provisorio: false, apuradoEm: agora.toISOString() };
  let tipo: string, vencedor: string | null = null, empatados: typeof totais = [];
  if (totais.length === 0) tipo = 'sem_candidato';
  else if (validos < quorum) tipo = 'sem_quorum';
  else if (e.modo === 'confirmacao' && totais.length === 1) {
    const t = totais[0];
    const passa = regras.unicaExigeMaisConfirmacoes ? t.sim > t.nao : t.sim >= t.nao;
    tipo = passa ? 'eleito_sem_concorrencia' : 'rejeitado'; if (passa) vencedor = t.userId;
  } else {
    const max = totais[0].votos; empatados = totais.filter((t) => t.votos === max);
    if (max === 0) tipo = 'sem_quorum';
    else if (empatados.length === 1) { tipo = 'eleito'; vencedor = empatados[0].userId; }
    else tipo = e.turno === 1 ? 'segundo_turno' : 'empate_vago';
  }
  const estado = vencedor ? 'publicada' : tipo === 'segundo_turno' ? 'segundo_turno' : 'sem_eleito';
  await setEstado(c, e, { estado, resultado_tipo: tipo, resultado: res, vencedor_user_id: vencedor, apurada_em: agora });
  if (tipo === 'segundo_turno') await criarSegundoTurno(c, e, regras, empatados.map((t) => t.candidatoId), agora);
  await emitirResultado(c, e);
  if (vencedor) await posse(c, e, vencedor, agora);
}

async function emitirResultado(c: Exec, e: Eleicao) {
  const r = e.resultado || {};
  await emitir(c, 'eleicao.resultado', {
    eleicaoId: e.id, cargo: e.cargo, escopo: e.escopo, escopoId: e.escopo_id, escopoNome: e.escopo_nome, turno: e.turno, tipo: e.resultado_tipo,
    vencedorUserId: e.vencedor_user_id, eleitorado: r.eleitorado ?? e.eleitorado, votosValidos: r.votosValidos ?? 0, provisorio: false, virtual: true,
  }, `resultado:${e.id}`);
}

async function criarSegundoTurno(c: Tx, e: Eleicao, regras: Regras, candidatos: string[], agora: Date) {
  const fecha = new Date(agora.getTime() + regras.segundoTurnoHoras * 3600_000);
  const novo = await q1<{ id: string }>(
    `insert into elections (season_id, regra_id, cargo, escopo, escopo_id, escopo_nome, ibge, street_id, turno, origem_id, estado, modo,
                            inscricoes_fecham, votacao_abre, votacao_fecha, publica_em, congelada_em, eleitorado, quorum)
     values ($1,$2,$3,$4,$5,$6,$7,$8,2,$9,'votacao','disputa',$10,$11,$12,$12,$11,$13,$14)
     on conflict (season_id, cargo, escopo_id, turno) do nothing returning id`,
    [e.season_id, e.regra_id, e.cargo, e.escopo, e.escopo_id, e.escopo_nome, e.ibge, e.street_id, e.id, e.inscricoes_fecham, agora, fecha, e.eleitorado, e.quorum], c);
  if (!novo) return;
  // mesmo eleitorado congelado do primeiro turno; apenas os empatados concorrem
  await q(`insert into eligibility_snapshots (election_id, user_id, house_id, street_id, ibge, verificado_em, congelado_em)
           select $1, user_id, house_id, street_id, ibge, verificado_em, congelado_em from eligibility_snapshots where election_id = $2`, [novo.id, e.id], c);
  await q(`insert into candidates (season_id, election_id, user_id, cargo, turno, origem_candidate_id, intencao, criado_em, atualizado_em)
           select season_id, $1, user_id, cargo, 2, id, intencao, $3, $3 from candidates where id = any($2::uuid[])`, [novo.id, candidatos, agora], c);
  await emitir(c, 'eleicao.votacao_aberta', { eleicaoId: novo.id, cargo: e.cargo, escopoId: e.escopo_id, escopoNome: e.escopo_nome, turno: 2, fechaEm: fecha.toISOString(), virtual: true }, `aberta:${novo.id}`);
  await enfileirar(c, 'eleicoes.apurar', { eleicaoId: novo.id }, `apurar:${novo.id}`, regras.segundoTurnoHoras * 3600);
}

/** posse idempotente: índice único por eleição + um ativo por cargo/escopo. Mandato termina na data fixa da temporada. */
export async function posse(c: Tx, e: Eleicao, vencedor: string, agora: Date) {
  const s = (await q1<{ mandato_fim: Date }>(`select mandato_fim from seasons where id = $1`, [e.season_id], c))!;
  if (agora >= s.mandato_fim) return null; // período do mandato já passou: resultado fica no histórico, sem posse
  const ja = await q1(`select 1 from office_terms where election_id = $1 and estado <> 'corrigido'`, [e.id], c);
  if (ja) return null;
  await q(`update office_terms set estado = 'encerrado', encerrado_em = $3, motivo = 'fim do mandato (nova posse)' where cargo = $1 and escopo_id = $2 and estado = 'ativo'`, [e.cargo, e.escopo_id, agora], c);
  const t = await q1<{ id: string }>(
    `insert into office_terms (election_id, cargo, escopo_id, escopo_nome, user_id, inicio, fim) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (election_id) where estado <> 'corrigido' do nothing returning id`, [e.id, e.cargo, e.escopo_id, e.escopo_nome, vencedor, agora, s.mandato_fim], c);
  if (t) await emitir(c, 'mandato.posse', { termoId: t.id, eleicaoId: e.id, cargo: e.cargo, escopoId: e.escopo_id, escopoNome: e.escopo_nome, userId: vencedor, inicio: agora.toISOString(), fim: s.mandato_fim.toISOString(), virtual: true }, `posse:${t.id}`);
  return t?.id ?? null;
}

/* ---------- correção pós-resultado (administrativa, auditada, transparente) ---------- */

export async function corrigirResultado(adminId: string, eleicaoId: string, d: { vencedorUserId?: unknown; motivo?: unknown }, agora: Date) {
  const motivo = typeof d.motivo === 'string' ? d.motivo.trim() : '';
  if (motivo.length < 10) throw erro(400, 'descreva o motivo da correção (mínimo 10 caracteres): ela é pública');
  return tx(async (c) => {
    await exigirAdmin(c, adminId);
    const e = await lerEleicao(c, eleicaoId, 'for update');
    if (!['publicada', 'sem_eleito'].includes(e.estado)) throw erro(409, 'só resultado publicado pode ser corrigido');
    const antes = { estado: e.estado, resultadoTipo: e.resultado_tipo, vencedorUserId: e.vencedor_user_id };
    let novoVenc: string | null = null;
    if (d.vencedorUserId !== undefined && d.vencedorUserId !== null) {
      if (typeof d.vencedorUserId !== 'string' || !UUID.test(d.vencedorUserId)) throw erro(400, 'vencedor inválido');
      const k = await q1(`select 1 from candidates where election_id = $1 and user_id = $2 and estado = 'inscrito'`, [e.id, d.vencedorUserId], c);
      if (!k) throw erro(400, 'o vencedor corrigido precisa ser candidatura ativa desta eleição virtual');
      novoVenc = d.vencedorUserId;
    }
    await q(`update office_terms set estado = 'corrigido', encerrado_em = $2, motivo = $3 where election_id = $1 and estado <> 'corrigido'`, [e.id, agora, 'correção administrativa: ' + motivo], c);
    const resultado = { ...(e.resultado || {}), corrigido: true, correcao: { motivo, em: agora.toISOString(), antes } };
    await setEstado(c, e, novoVenc
      ? { estado: 'publicada', resultado_tipo: 'eleito', vencedor_user_id: novoVenc, resultado }
      : { estado: 'sem_eleito', resultado_tipo: 'anulado', vencedor_user_id: null, resultado });
    const depois = { estado: e.estado, resultadoTipo: e.resultado_tipo, vencedorUserId: e.vencedor_user_id };
    const cor = (await q1<{ id: number }>(`insert into election_corrections (election_id, ator_user_id, motivo, antes, depois, criado_em) values ($1,$2,$3,$4,$5,$6) returning id`,
      [e.id, adminId, motivo, JSON.stringify(antes), JSON.stringify(depois), agora], c))!;
    await auditar(c, adminId, 'eleicao.corrigir_resultado', e.id, motivo, { antes, depois, correcaoId: cor.id });
    await emitir(c, 'eleicao.corrigida', { eleicaoId: e.id, cargo: e.cargo, escopoId: e.escopo_id, antes, depois, motivo, virtual: true }, `correcao:${e.id}:${cor.id}`);
    if (novoVenc) await posse(c, e, novoVenc, agora);
    return { correcaoId: cor.id, depois };
  });
}

/* ---------- publicação de regras (vale para a próxima temporada) ---------- */

export async function publicarRegras(adminId: string, parcial: unknown, motivo: string, agora: Date) {
  if (!motivo || motivo.trim().length < 10) throw erro(400, 'descreva o motivo da mudança de regra');
  if (!parcial || typeof parcial !== 'object') throw erro(400, 'regras inválidas');
  return tx(async (c) => {
    await exigirAdmin(c, adminId);
    await c.query(`select pg_advisory_xact_lock(hashtext('regras:eleicoes'))`);
    const ult = await q1<{ id: string; regras: any }>(`select id, regras from rule_versions where dominio = 'eleicoes' order by (split_part(id, '@', 2))::int desc limit 1`, [], c);
    const v = (ult ? versaoDe(ult.id) : 0) + 1;
    const p = parcial as any;
    const novas = normalizarRegras({ ...(ult?.regras || {}), ...p, limiares: { ...(ult?.regras?.limiares || {}), ...(p.limiares || {}) }, calendario: { ...(ult?.regras?.calendario || {}), ...(p.calendario || {}) }, versao: v });
    const errs = validarRegras(novas); if (errs.length) throw erro(400, 'regras inválidas: ' + errs.join('; '));
    const id = `eleicoes@${v}`;
    await q(`insert into rule_versions (id, dominio, regras, vigente_desde) values ($1, 'eleicoes', $2, $3)`, [id, JSON.stringify(novas), agora], c);
    await auditar(c, adminId, 'eleicao.publicar_regras', id, motivo.trim(), { regras: novas });
    await emitir(c, 'eleicao.regras_publicadas', { regraId: id, vigenteDesde: agora.toISOString() }, `regras:${id}`);
    return { regraId: id, regras: novas, valeAPartirDe: 'próxima temporada' };
  });
}
