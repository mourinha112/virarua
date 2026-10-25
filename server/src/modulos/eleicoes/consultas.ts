/* Leituras para a API (formato EleicaoUI do front). Nunca expõe escolha individual de terceiros: só totais, e só
   quando o eleitorado congelado atinge placarMinEleitorado. O próprio eleitor vê o próprio voto. */
import { tx, q, q1, db, type Exec } from '../../db/db';
import { type Cargo, CARGOS, CARGO_NOME, SELO, carregarRegras, resumoRegras } from './regras';
import { type Eleicao, garantirTemporada, garantirEleicao, escoposDoUsuario, escopoIdDe, avancarEleicao, contarVotos, UUID } from './dominio';
import { mandatoVigente, escolhaVigente, termoAtivoDoUsuario, catalogo } from './cargos';

export const STATUS_TEXTO: Record<string, string> = {
  inscricoes: 'inscrições abertas', congelada: 'eleitorado congelado; a votação abre em breve', votacao: 'votação aberta',
  apuracao: 'votação fechada; apurando', publicada: 'resultado publicado', segundo_turno: 'empate: segundo turno',
  sem_eleito: 'sem eleito: cargo vago e calendário neutro', fundacao: 'fase de fundação (eleitores insuficientes)', cancelada: 'cancelada',
};
const RESULTADO_TEXTO: Record<string, string> = {
  eleito: 'eleito(a) na eleição virtual', eleito_sem_concorrencia: 'eleito(a) sem concorrência', rejeitado: 'candidatura única rejeitada: cargo vago, calendário neutro',
  sem_candidato: 'nenhum candidato: cargo vago, calendário neutro do sistema', sem_quorum: 'quorum insuficiente: sem eleito, calendário neutro',
  segundo_turno: 'empate: segundo turno de 24h entre os empatados', empate_vago: 'novo empate: cargo vago neste ciclo',
  fundacao: 'fase de fundação: ainda não há eleitores suficientes', anulado: 'resultado anulado por revisão administrativa (pública)',
};
const PLACAR_ESTADOS = ['votacao', 'apuracao', 'publicada', 'segundo_turno', 'sem_eleito'];
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

export async function handles(c: Exec, ids: string[]) {
  const m = new Map<string, string>(); if (!ids.length) return m;
  const r = await q<{ id: string; h: string }>(
    `select distinct on (u.id) u.id, coalesce(case when coalesce(pp.mostrar_handle, true) then ei.username end, u.nome_publico) h
       from users u left join privacy_preferences pp on pp.user_id = u.id
       left join external_identities ei on ei.user_id = u.id and ei.revogado_em is null
      where u.id = any($1::uuid[]) order by u.id, ei.criado_em`, [ids], c);
  for (const x of r) m.set(x.id, x.h);
  return m;
}

export async function resumoEleicao(c: Exec, e: Eleicao, viewer: string | null, detalhe = false) {
  const regras = await carregarRegras(c, e.regra_id);
  const cands = await q<{ id: string; user_id: string; estado: string; apoios: number }>(
    `select k.id, k.user_id, k.estado, (select count(*)::int from nomination_supports s where s.candidate_id = k.id and s.invalidado_em is null) apoios
       from candidates k where k.election_id = $1 and (k.estado = 'inscrito' or $2) order by k.criado_em, k.id`, [e.id, detalhe], c);
  const visivel = e.eleitorado !== null && e.eleitorado >= regras.placarMinEleitorado && PLACAR_ESTADOS.includes(e.estado);
  const cont = visivel ? await contarVotos(c, e.id) : null;
  const hs = await handles(c, [...cands.map((k) => k.user_id), ...(e.vencedor_user_id ? [e.vencedor_user_id] : [])]);
  const tot = new Map((cont?.totais || []).map((t) => [t.candidatoId, t]));
  let meuVoto: any = null, souEleitor: boolean | null = null, minhaCandidatura: any = null;
  if (viewer) {
    const v = await q1<{ candidate_id: string; escolha: string; estado: string; atualizado_em: Date }>(
      `select v.candidate_id, v.escolha, k.estado, v.atualizado_em from votes v join candidates k on k.id = v.candidate_id where v.election_id = $1 and v.voter_id = $2`, [e.id, viewer], c);
    if (v) meuVoto = { candidato: v.escolha === 'rejeitar' ? 'rejeitar' : v.candidate_id, invalido: v.estado !== 'inscrito', em: iso(v.atualizado_em) };
    if (e.congelada_em) souEleitor = !!(await q1(`select 1 from eligibility_snapshots where election_id = $1 and user_id = $2`, [e.id, viewer], c));
    const mc = await q1<{ id: string; estado: string }>(`select id, estado from candidates where election_id = $1 and user_id = $2`, [e.id, viewer], c);
    if (mc) minhaCandidatura = mc;
  }
  const unico = e.modo === 'confirmacao' ? tot.values().next().value : undefined;
  const r = e.resultado || {};
  return {
    id: e.id, cargo: e.cargo, cargoNome: CARGO_NOME[e.cargo], escopo: e.escopo, escopoId: e.escopo_id, escopoNome: e.escopo_nome,
    status: e.estado, statusTexto: STATUS_TEXTO[e.estado] || e.estado, turno: e.turno, modo: e.modo, regraId: e.regra_id,
    prazos: { inscricoesFecham: iso(e.inscricoes_fecham), votacaoAbre: iso(e.votacao_abre), votacaoFecha: iso(e.votacao_fecha), publicaEm: iso(e.publica_em) },
    eleitorado: e.eleitorado, quorum: e.quorum,
    candidatos: cands.map((k) => ({
      id: k.id, handle: hs.get(k.user_id) || 'morador', votos: visivel ? (tot.get(k.id)?.votos ?? 0) : null, estado: k.estado,
      ...(e.cargo === 'presidente' ? { apoios: k.apoios, apoiosNecessarios: regras.apoiosPresidente } : {}),
    })),
    rejeicoes: e.modo === 'confirmacao' ? (visivel ? (unico?.nao ?? 0) : null) : undefined,
    placarVisivel: visivel, placarProvisorio: visivel && ['votacao', 'apuracao'].includes(e.estado), placarAtualizadoEm: visivel ? new Date().toISOString() : null,
    placarMinEleitorado: regras.placarMinEleitorado,
    resultado: e.resultado_tipo ? {
      tipo: e.resultado_tipo, texto: RESULTADO_TEXTO[e.resultado_tipo] || e.resultado_tipo,
      vencedor: e.vencedor_user_id ? hs.get(e.vencedor_user_id) || 'morador' : null,
      eleitorado: r.eleitorado ?? e.eleitorado, votosValidos: visivel ? r.votosValidos ?? null : null, corrigido: !!r.corrigido, apuradoEm: iso(e.apurada_em),
    } : null,
    meuVoto, souEleitor, minhaCandidatura, selo: SELO,
  };
}

const vencida = (e: Eleicao, agora: Date) =>
  (e.estado === 'inscricoes' && agora >= e.inscricoes_fecham) || (e.estado === 'congelada' && agora >= e.votacao_abre) ||
  (e.estado === 'votacao' && agora >= e.votacao_fecha) || (e.estado === 'apuracao' && agora >= e.publica_em);

/** eleições relevantes ao usuário: as três do seu lugar na temporada corrente (+ segundo turno), criadas sob demanda */
export async function listarParaUsuario(userId: string, agora: Date) {
  const base = await tx(async (c) => {
    const esc = await escoposDoUsuario(c, userId);
    if (!esc) return null;
    const out: Eleicao[] = [];
    for (const cargo of CARGOS) { const id = escopoIdDe(cargo, esc); if (id) out.push(await garantirEleicao(c, cargo, id, agora)); }
    return out;
  });
  if (!base) return listarPublicas(agora, userId);
  for (const e of base) if (vencida(e, agora)) await avancarEleicao(e.id, agora);
  const ids = base.map((e) => e.id);
  const rows = await q<Eleicao>(`select * from elections where id = any($1::uuid[]) or origem_id = any($1::uuid[]) order by case cargo when 'lider' then 1 when 'prefeito' then 2 else 3 end, turno desc`, [ids]);
  return Promise.all(rows.map((e) => resumoEleicao(db(), e, userId)));
}

/** resumo público (sem login): eleições em votação ou com resultado na temporada corrente */
export async function listarPublicas(agora: Date, viewer: string | null = null) {
  const s = await tx((c) => garantirTemporada(c, agora));
  const rows = await q<Eleicao>(
    `select * from elections where season_id = $1 and estado in ('votacao','apuracao','publicada','segundo_turno')
      order by case cargo when 'presidente' then 0 else 1 end, eleitorado desc nulls last limit 30`, [s.id]);
  return Promise.all(rows.map((e) => resumoEleicao(db(), e, viewer)));
}

export async function detalhe(id: string, viewer: string | null, agora: Date) {
  if (!UUID.test(id)) return null;
  const e0 = await q1<Eleicao>(`select * from elections where id = $1`, [id]);
  if (!e0) return null;
  if (vencida(e0, agora)) await avancarEleicao(id, agora);
  const e = (await q1<Eleicao>(`select * from elections where id = $1`, [id]))!;
  const regras = await carregarRegras(db(), e.regra_id);
  const res = await resumoEleicao(db(), e, viewer, true);
  const correcoes = await q<{ id: number; motivo: string; antes: any; depois: any; criado_em: Date }>(`select id, motivo, antes, depois, criado_em from election_corrections where election_id = $1 order by id`, [id]);
  const segundo = await q1<{ id: string }>(`select id from elections where origem_id = $1`, [id]);
  return {
    ...res, regras: resumoRegras(regras), regrasConfig: regras, origemId: e.origem_id, segundoTurnoId: segundo?.id ?? null,
    correcoes: correcoes.map((x) => ({ id: x.id, motivo: x.motivo, antes: { resultadoTipo: x.antes.resultadoTipo }, depois: { resultadoTipo: x.depois.resultadoTipo }, em: iso(x.criado_em) })),
  };
}

export async function calendario(viewer: string | null, agora: Date) {
  const s = await tx((c) => garantirTemporada(c, agora));
  const regras = await carregarRegras(db(), s.regra_id);
  const fase = agora < s.inscricoes_fecham ? 'inscricoes' : agora < s.votacao_abre ? 'eleitorado_congelado' : agora < s.votacao_fecha ? 'votacao' : agora < s.publica_em ? 'apuracao' : 'resultado';
  const esc = viewer ? await escoposDoUsuario(db(), viewer) : null;
  const alvos: { cargo: Cargo; id: string; nome: string }[] = [];
  if (esc?.streetId) alvos.push({ cargo: 'lider', id: esc.streetId, nome: `${esc.rua} · ${esc.cidade}` });
  if (esc) alvos.push({ cargo: 'prefeito', id: String(esc.ibge), nome: `${esc.cidade} · ${esc.uf}` });
  alvos.push({ cargo: 'presidente', id: 'BR', nome: 'Brasil virtual' });
  const mandatos = [];
  for (const a of alvos) {
    const t = await mandatoVigente(db(), a.cargo, a.id, agora);
    const h = t ? (await handles(db(), [t.user_id])).get(t.user_id) || 'morador' : null;
    mandatos.push({
      cargo: a.cargo, cargoNome: CARGO_NOME[a.cargo], escopoId: a.id, escopoNome: a.nome, ocupante: h, inicio: iso(t?.inicio), fim: iso(t?.fim), vago: !t,
      texto: t ? `mandato virtual até ${iso(t.fim)}` : 'cargo vago: o calendário neutro do sistema escolhe os eventos',
    });
  }
  const meu = viewer ? await termoAtivoDoUsuario(db(), viewer, agora) : null;
  return {
    fuso: regras.calendario.fuso, agoraServidor: agora.toISOString(), fase,
    temporada: { codigo: s.codigo, inscricoesAbrem: iso(s.inscricoes_abrem), inscricoesFecham: iso(s.inscricoes_fecham), votacaoAbre: iso(s.votacao_abre), votacaoFecha: iso(s.votacao_fecha), publicaEm: iso(s.publica_em), mandatoFim: iso(s.mandato_fim) },
    proximaPosse: iso(agora < s.publica_em ? s.publica_em : s.mandato_fim),
    regraId: s.regra_id, regras: resumoRegras(regras), mandatos,
    meuCargo: meu ? { termoId: meu.id, cargo: meu.cargo, cargoNome: CARGO_NOME[meu.cargo], escopoNome: meu.escopo_nome, fim: iso(meu.fim) } : null,
    selo: SELO,
  };
}

/** catálogo de poderes do cargo ativo do usuário + escolha vigente de cada tipo */
export async function meuCatalogo(userId: string, agora: Date) {
  const t = await termoAtivoDoUsuario(db(), userId, agora);
  if (!t) return { cargo: null, opcoes: [] as any[], vigentes: {} as Record<string, unknown> };
  const ops = await catalogo(db(), t.cargo);
  const vigentes: Record<string, unknown> = {};
  for (const tipo of new Set(ops.map((o) => o.tipo))) vigentes[tipo] = await escolhaVigente(db(), t.cargo, t.escopo_id, tipo, agora);
  return { cargo: t.cargo, cargoNome: CARGO_NOME[t.cargo], escopoNome: t.escopo_nome, fim: iso(t.fim), opcoes: ops, vigentes };
}
