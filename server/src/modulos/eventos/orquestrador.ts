/* Orquestrador de eventos (seção 21): sincroniza o catálogo, planeja os próximos 7 dias (madrugada), avança a
   máquina de estados das instâncias (job idempotente, retomável após reinício) e consolida fatos novos de hora em
   hora em eventos de domínio 'conteudo.fato' (a fila editorial content_candidates é da Fase 6).
   Garantias: chave única por instância (definição+alvo+janela) — rodar de novo nunca duplica; transições por
   UPDATE condicionado ao estado anterior; kill switch config.kill.eventos pausa tudo sem derrubar o jogo;
   eleição prevalece (eventos de eleição usam os horários do fato e nunca são movidos; os demais não começam nas
   últimas 24h de votação da cidade); cidade pequena não recebe evento coletivo nem adversário inventado. */
import { createHash } from 'node:crypto';
import type { Exec } from '../../db/db';
import { tx, emitir, q } from '../../db/db';
import { config } from '../../config';
import { diaJogo, instanteLocal, somarDias, semanaJogo, REGRAS } from '../recompensas/regras';
import { conceder } from '../recompensas/ledger';
import { CATALOGO } from './catalogo';
import { validarCatalogo } from './validador';
import { TRANSICOES, type Estado, type EventDefinition } from './tipos';
import { textosEvento, iaConfigurada } from './ia';
import { amizadesDisponiveis } from './motores';

const HORA = 3600_000;
export type Config = { modo: 'manual' | 'assistido' | 'automatico'; max_simultaneos_cidade: number; max_novos_dia_cidade: number; janela_categoria_horas: number; max_inscricoes_usuario: number; max_fatos_hora: number; cursor_fatos: number };

export async function configuracao(c: Exec): Promise<Config> { return (await c.query(`select * from event_orchestrator_settings where id = 1`)).rows[0]; }

/** grava o catálogo versionado (recusa catálogo inválido). Idempotente. */
export async function sincronizarCatalogo(c: Exec) {
  const erros = validarCatalogo(CATALOGO);
  if (erros.length) throw new Error('catálogo de eventos inválido:\n' + erros.join('\n'));
  for (const d of CATALOGO) {
    await c.query(
      `insert into event_definitions (id, version, categoria, motor, definicao, habilitado, motivo_desabilitado) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (id, version) do update set definicao = excluded.definicao, habilitado = excluded.habilitado, motivo_desabilitado = excluded.motivo_desabilitado, sincronizado_em = now()`,
      [d.id, d.version, d.category, d.mechanic.motor, JSON.stringify(d), d.enabled, d.enabled ? null : d.disabled_reason]);
  }
  return CATALOGO.length;
}

/** motivo de indisponibilidade em tempo de execução (além do enabled estático) */
export async function motivoIndisponivel(c: Exec, d: EventDefinition): Promise<string | null> {
  if (!d.enabled) return d.disabled_reason || 'desabilitado';
  if (d.prerequisites.some((p) => p.tipo === 'amizades_disponiveis') && !(await amizadesDisponiveis(c))) return 'depende de amizades (Fase 2) ainda não instaladas neste banco';
  return null;
}

/* ---------- máquina de estados ---------- */
export async function transitar(c: Exec, id: string, de: Estado, para: Estado, motivo: string | null = null, ator = 'sistema') {
  if (!TRANSICOES[de].includes(para)) throw new Error(`transição inválida ${de} → ${para}`);
  const r = (await c.query(`update event_instances set estado = $3, motivo = coalesce($4, motivo), atualizado_em = now() where id = $1 and estado = $2 returning id`, [id, de, para, motivo])).rows[0];
  if (r) await c.query(`insert into event_transitions (instance_id, de, para, motivo, ator) values ($1,$2,$3,$4,$5)`, [id, de, para, motivo, ator]);
  return !!r;
}

export type NovaInstancia = { def: EventDefinition; escopo: EventDefinition['scope']; ibge: number | null; uf: string | null; chave: string; inicio: Date | null; fim: Date | null; modo: Config['modo']; criado_por?: string; progresso?: Record<string, unknown>; cidade?: string | null; usarIA?: boolean; permanente?: boolean };
/** cria instância com snapshot da definição; no modo automático avança até 'scheduled' (permanentes até 'active') */
export async function criarInstancia(c: Exec, n: NovaInstancia) {
  const textos = await textosEvento(c, n.def, { cidade: n.cidade, usarIA: n.usarIA });
  const anuncio = n.inicio ? new Date(n.inicio.getTime() - 12 * HORA) : null;
  const r = (await c.query(
    `insert into event_instances (definicao_id, definicao_versao, regras, categoria, escopo, ibge, uf, chave, estado, modo, permanente, anuncio_em, inicio, fim, progresso, textos, criado_por)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'proposed',$9,$10,$11,$12,$13,$14,$15,$16) on conflict (chave) do nothing returning id`,
    [n.def.id, n.def.version, JSON.stringify(n.def), n.def.category, n.escopo, n.ibge, n.uf, n.chave, n.modo, !!n.permanente, anuncio, n.inicio, n.fim, JSON.stringify(n.progresso || {}), JSON.stringify(textos), n.criado_por || 'planejador'])).rows[0];
  if (!r) return { id: null as string | null, criado: false };
  await c.query(`insert into event_transitions (instance_id, de, para, motivo, ator) values ($1, null, 'proposed', $2, $3)`, [r.id, 'planejado', n.criado_por || 'planejador']);
  if (n.modo === 'automatico' || n.permanente) {
    await transitar(c, r.id, 'proposed', 'validated', 'regras do catálogo aprovado');
    await transitar(c, r.id, 'validated', 'scheduled', 'agenda automática');
    if (n.permanente) for (const [de, para] of [['scheduled', 'announced'], ['announced', 'enrolling'], ['enrolling', 'active']] as [Estado, Estado][]) await transitar(c, r.id, de, para, 'permanente');
  }
  return { id: r.id as string, criado: true };
}

/* ---------- planejamento ---------- */
type Cidade = { ibge: number; uf: string; nome: string; ativos: number; ruas: number };
const hashNum = (s: string) => createHash('sha256').update(s).digest().readUInt32LE(0) / 4294967296;

async function cidadesAtivas(c: Exec): Promise<Cidade[]> {
  return (await c.query(
    `select p.ibge, m.uf, m.nome, count(distinct h.dono_user_id)::int ativos, count(distinct sm.street_id)::int ruas
       from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge join users u on u.id = h.dono_user_id
       left join street_memberships sm on sm.house_id = h.id and sm.saiu_em is null
      where h.status = 'reivindicada' and u.status = 'ativo' group by p.ibge, m.uf, m.nome order by p.ibge`)).rows;
}

/** janelas de votação que atingem a cidade (tabela da Fase 4, se instalada) */
export async function janelasEleitorais(c: Exec, ibge: number, de: Date, ate: Date): Promise<{ abre: Date; fecha: Date }[]> {
  if (!(await c.query(`select to_regclass('public.elections') r`)).rows[0].r) return [];
  return (await c.query(`select votacao_abre abre, votacao_fecha fecha from elections where (ibge = $1 or escopo = 'brasil') and estado <> 'cancelada' and votacao_abre < $3 and votacao_fecha > $2`, [ibge, de, ate])).rows;
}

async function fatosDaCidade(c: Exec, tipo: string, ibge: number, desde: Date) {
  return (await c.query(`select id, dados, criado_em from domain_events where tipo = $1 and (dados->>'ibge' = $2 or dados->>'escopoId' = $2) and criado_em >= $3 order by id desc limit 5`, [tipo, String(ibge), desde])).rows;
}

async function prereqInstancia(c: Exec, d: EventDefinition, cid: Cidade, inicio: Date): Promise<boolean> {
  for (const p of d.prerequisites) {
    if (p.tipo === 'competicao_ativa') {
      const r = (await c.query(`select 1 from competition_entries e join competition_seasons s on s.id = e.season_id where e.ibge = $1 and e.modo = 'competitivo' and s.estado = 'aberta' and s.fim > $2 limit 1`, [cid.ibge, inicio])).rows[0];
      if (!r) return false;
    } else if (p.tipo === 'rua_aniversario') {
      const dia = diaJogo(inicio).slice(5);
      const r = (await c.query(`select 1 from virtual_streets where ibge = $1 and status in ('ativa','fundacao') and to_char(criada_em at time zone 'America/Sao_Paulo', 'MM-DD') = $2 and criada_em < $3::timestamptz - interval '360 days' limit 1`, [cid.ibge, dia, inicio])).rows[0];
      if (!r) return false;
    } else if (p.tipo === 'obra_concluida_na_cidade') {
      const r = (await c.query(`select 1 from community_projects cp join virtual_streets vs on vs.id = cp.street_id where vs.ibge = $1 and cp.status = 'concluida' and cp.concluida_em > $2::timestamptz - interval '7 days' limit 1`, [cid.ibge, inicio])).rows[0];
      if (!r) return false;
    } else if (p.tipo === 'fato' || p.tipo === 'duas_cidades_ativas') return false; // tratados em caminhos próprios
  }
  // cidade pequena: nada de evento coletivo acima da população; interação entre ruas exige duas ruas reais
  if (d.min_participants > cid.ativos) return false;
  if (d.mechanic.params.mesma_cidade_rua_diferente && cid.ruas < 2) return false;
  return true;
}

function janelaDe(d: EventDefinition, dia: string): { inicio: Date; fim: Date } | null {
  if (d.duration.tipo !== 'janela') return null;
  if (d.duration.horas >= 168 && new Date(dia + 'T12:00:00Z').getUTCDay() !== 1) return null; // semanais começam na segunda
  const inicio = instanteLocal(dia, d.duration.hora_local ?? 10);
  return { inicio, fim: new Date(inicio.getTime() + d.duration.horas * HORA) };
}

export type ResumoPlano = { pausado?: boolean; modo?: string; permanentes: number; criadas: number; por_fato: number; sugestoes: { def: string; ibge: number | null; inicio: string | null }[]; ia: boolean };

/** planejador da madrugada: revisa os próximos `dias` dias. Seguro para rodar de novo (inclusive após queda no meio). */
export async function planejar(agora = new Date(), opts: { dias?: number; falharAposCidades?: number } = {}): Promise<ResumoPlano> {
  const resumo: ResumoPlano = { permanentes: 0, criadas: 0, por_fato: 0, sugestoes: [], ia: iaConfigurada() };
  if (config.kill.eventos) return { ...resumo, pausado: true };
  const chaveRun = 'madrugada:' + diaJogo(agora);
  await q(`insert into event_planner_runs (chave, tipo) values ($1, 'madrugada') on conflict (chave) do update set execucoes = event_planner_runs.execucoes + 1, iniciado_em = now(), concluido_em = null`, [chaveRun]);
  await tx((c) => sincronizarCatalogo(c));
  const cfg = await tx((c) => configuracao(c)); resumo.modo = cfg.modo;
  const ativas: EventDefinition[] = [];
  await tx(async (c) => { for (const d of CATALOGO) if (!(await motivoIndisponivel(c, d))) ativas.push(d); });

  // 1) permanentes (jornada de boas-vindas): uma instância nacional por definição/versão
  for (const d of ativas.filter((x) => x.duration.tipo === 'permanente')) {
    const r = await tx((c) => criarInstancia(c, { def: d, escopo: d.scope, ibge: null, uf: null, chave: `${d.id}@${d.version}:permanente`, inicio: agora, fim: null, modo: cfg.modo, permanente: true, criado_por: 'planejador' }));
    if (r.criado) resumo.permanentes++;
  }
  const persistir = cfg.modo !== 'manual';
  let iaOrcamento = 20; // teto de chamadas de IA por rodada (custo)
  const cidades = await tx((c) => cidadesAtivas(c));
  const hoje = diaJogo(agora); const dias = opts.dias ?? 7;
  let n = 0;
  for (const cid of cidades) {
    if (opts.falharAposCidades !== undefined && n++ >= opts.falharAposCidades) throw new Error('queda simulada do planejador');
    await tx(async (c) => {
      // 2) eventos ancorados em fatos reais (eleição, competição): horários do fato, sem mover calendário eleitoral
      for (const d of ativas.filter((x) => x.prerequisites.some((p) => p.tipo === 'fato'))) {
        const pr = d.prerequisites.find((p) => p.tipo === 'fato')!;
        for (const f of await fatosDaCidade(c, pr.fato!, cid.ibge, new Date(agora.getTime() - 7 * 24 * HORA))) {
          if (pr.exige === 'campeas' && !(f.dados.campeas || []).length) continue;
          const p = d.mechanic.params; let inicio = new Date(Math.max(agora.getTime(), new Date(f.criado_em).getTime()));
          if (p.ancora && f.dados[p.ancora]) inicio = new Date(new Date(f.dados[p.ancora]).getTime() - (p.horas_antes || 24) * HORA);
          const fim = new Date(inicio.getTime() + (d.duration.tipo === 'janela' ? d.duration.horas : 24) * HORA);
          if (fim <= agora) continue;
          if (d.category !== 'eleicao_editorial' && !(await respeitaJanelas(c, cfg, d, cid, inicio, fim))) continue;
          if (!persistir) { resumo.sugestoes.push({ def: d.id, ibge: cid.ibge, inicio: inicio.toISOString() }); continue; }
          const r = await criarInstancia(c, { def: d, escopo: d.scope, ibge: cid.ibge, uf: cid.uf, chave: `${d.id}:${cid.ibge}:fato:${f.id}`, inicio, fim, modo: cfg.modo, cidade: cid.nome, usarIA: iaOrcamento-- > 0 });
          if (r.criado) resumo.por_fato++;
          break; // um por fato mais recente
        }
      }
      // 3) agenda ordinária dos próximos dias
      for (let k = 1; k <= dias; k++) {
        const dia = somarDias(hoje, k);
        const candidatas: { d: EventDefinition; inicio: Date; fim: Date; nota: number }[] = [];
        for (const d of ativas) {
          if (d.duration.tipo !== 'janela' || d.prerequisites.some((p) => p.tipo === 'fato' || p.tipo === 'duas_cidades_ativas')) continue;
          if (d.scope !== 'cidade' && d.scope !== 'rua') continue;
          const j = janelaDe(d, dia); if (!j) continue;
          if (!(await prereqInstancia(c, d, cid, j.inicio))) continue;
          if (!(await respeitaJanelas(c, cfg, d, cid, j.inicio, j.fim))) continue;
          candidatas.push({ ...j, d, nota: await nota(c, d, cid, j.inicio, dia) });
        }
        candidatas.sort((a, b) => b.nota - a.nota);
        const doDia = (await c.query(`select count(*)::int n from event_instances where ibge = $1 and not permanente and estado not in ('cancelled') and categoria <> 'eleicao_editorial' and (inicio at time zone 'America/Sao_Paulo')::date = $2::date`, [cid.ibge, dia])).rows[0].n;
        for (const cand of candidatas.slice(0, Math.max(0, cfg.max_novos_dia_cidade - doDia))) {
          if (!persistir) { resumo.sugestoes.push({ def: cand.d.id, ibge: cid.ibge, inicio: cand.inicio.toISOString() }); continue; }
          const r = await criarInstancia(c, { def: cand.d, escopo: cand.d.scope, ibge: cid.ibge, uf: cid.uf, chave: `${cand.d.id}:${cid.ibge}:${dia}`, inicio: cand.inicio, fim: cand.fim, modo: cfg.modo, cidade: cid.nome, usarIA: iaOrcamento-- > 0, progresso: metaInicial(cand.d, cid.ativos) });
          if (r.criado) resumo.criadas++;
        }
      }
    });
  }
  // 4) nacionais/regionais semanais (uma edição por semana; regional só com cidades reais participantes)
  await tx(async (c) => {
    const segunda = semanaJogo(new Date(instanteLocal(somarDias(hoje, 7)).getTime()));
    const inicio = instanteLocal(segunda), fim = new Date(inicio.getTime() + 168 * HORA);
    for (const d of ativas.filter((x) => (x.scope === 'nacional' || x.scope === 'regional') && x.duration.tipo === 'janela')) {
      const alvos: { uf: string | null; chave: string }[] = [];
      if (d.scope === 'nacional') alvos.push({ uf: null, chave: `${d.id}:BR:${segunda}` });
      else {
        const ufs = new Map<string, number>(); for (const cd of cidades) ufs.set(cd.uf, (ufs.get(cd.uf) || 0) + 1);
        for (const [uf, ncid] of ufs) if (!d.prerequisites.some((p) => p.tipo === 'duas_cidades_ativas') || ncid >= 2) alvos.push({ uf, chave: `${d.id}:${uf}:${segunda}` });
      }
      for (const a of alvos) {
        if (!persistir) { resumo.sugestoes.push({ def: d.id, ibge: null, inicio: inicio.toISOString() }); continue; }
        const dur = d.duration.tipo === 'janela' ? d.duration.horas : 168;
        const ini = dur < 168 ? instanteLocal(somarDias(segunda, 5), d.duration.tipo === 'janela' ? d.duration.hora_local ?? 19 : 19) : inicio;
        const r = await criarInstancia(c, { def: d, escopo: d.scope, ibge: null, uf: a.uf, chave: a.chave, inicio: ini, fim: dur < 168 ? new Date(ini.getTime() + dur * HORA) : fim, modo: cfg.modo, progresso: metaInicial(d, cidades.reduce((s, x) => s + x.ativos, 0)) });
        if (r.criado) resumo.criadas++;
      }
    }
  });
  await q(`update event_planner_runs set concluido_em = now(), resumo = $2 where chave = $1`, [chaveRun, JSON.stringify(resumo)]);
  return resumo;
}

function metaInicial(d: EventDefinition, ativos: number) {
  const p = d.mechanic.params;
  if (d.mechanic.motor !== 'contribuicao' || p.alvo !== 'meta_instancia') return {};
  return { meta: Number(p.meta_fixa || Math.max(30, Math.ceil(ativos * (p.meta_por_ativo || 20)))), total: 0, ativos_snapshot: ativos };
}

/** limites de sobreposição, 48h por categoria na cidade, cooldown e precedência da eleição */
async function respeitaJanelas(c: Exec, cfg: Config, d: EventDefinition, cid: Cidade, inicio: Date, fim: Date) {
  const sobre = (await c.query(`select count(*)::int n from event_instances where ibge = $1 and not permanente and estado not in ('cancelled','completed','archived') and inicio < $3 and fim > $2`, [cid.ibge, inicio, fim])).rows[0].n;
  if (sobre >= cfg.max_simultaneos_cidade) return false;
  const h = cfg.janela_categoria_horas;
  const cat = (await c.query(`select 1 from event_instances where ibge = $1 and categoria = $2 and estado <> 'cancelled' and inicio > $3::timestamptz - make_interval(hours => $4) and inicio < $3::timestamptz + make_interval(hours => $4) limit 1`, [cid.ibge, d.category, inicio, h])).rows[0];
  if (cat) return false;
  if (d.cooldown.tipo === 'horas') {
    const cd = (await c.query(`select 1 from event_instances where ibge = $1 and definicao_id = $2 and estado <> 'cancelled' and inicio > $3::timestamptz - make_interval(hours => $4) and inicio < $3::timestamptz + make_interval(hours => $4) limit 1`, [cid.ibge, d.id, inicio, d.cooldown.horas])).rows[0];
    if (cd) return false;
  }
  // eleição prevalece: nada de evento comum começando nas últimas 24h de uma votação que atinge a cidade
  for (const j of await janelasEleitorais(c, cid.ibge, new Date(inicio.getTime() - 24 * HORA), new Date(fim.getTime() + 24 * HORA))) {
    const reta = new Date(new Date(j.fecha).getTime() - 24 * HORA);
    if (inicio < new Date(j.fecha) && fim > reta) return false;
  }
  return true;
}

/** prioridade determinística: diversidade (tempo desde a última aparição), cidade pequena prefere motores individuais/cooperativos */
async function nota(c: Exec, d: EventDefinition, cid: Cidade, inicio: Date, dia: string) {
  const ult = (await c.query(`select max(inicio) u from event_instances where ibge = $1 and definicao_id = $2 and estado <> 'cancelled' and inicio < $3`, [cid.ibge, d.id, inicio])).rows[0].u;
  const diasDesde = ult ? Math.min(30, (inicio.getTime() - new Date(ult).getTime()) / (24 * HORA)) : 30;
  const pequena = cid.ativos < 10 && ['exploracao', 'decoracao', 'contribuicao', 'quiz'].includes(d.mechanic.motor) ? 5 : 0;
  return diasDesde + pequena + hashNum(`${dia}:${cid.ibge}:${d.id}`);
}

/* ---------- avanço dos estados (tick idempotente) ---------- */
export async function avancar(agora = new Date()) {
  if (config.kill.eventos) return { pausado: true, transicoes: 0 };
  let n = 0;
  const due = await q<{ id: string; estado: Estado }>(
    `select id, estado from event_instances where not permanente and (
        (estado = 'scheduled' and anuncio_em <= $1) or (estado = 'announced') or (estado = 'enrolling' and inicio <= $1)
        or (estado = 'active' and fim <= $1) or (estado = 'resolving') or (estado in ('completed','cancelled') and fim + interval '7 days' <= $1))
      order by inicio limit 500`, [agora]);
  for (const i of due) n += await tx((c) => avancarUma(c, i.id, agora));
  return { transicoes: n };
}

async function avancarUma(c: Exec, id: string, agora: Date): Promise<number> {
  const inst = (await c.query(`select * from event_instances where id = $1 for update`, [id])).rows[0];
  if (!inst) return 0;
  const def: EventDefinition = inst.regras; let n = 0;
  const passo = async (de: Estado, para: Estado, motivo?: string) => { if (await transitar(c, id, de, para, motivo ?? null)) { n++; inst.estado = para; return true; } return false; };
  if (inst.estado === 'scheduled' && new Date(inst.anuncio_em) <= agora) await passo('scheduled', 'announced');
  if (inst.estado === 'announced') await passo('announced', 'enrolling', 'inscrições abertas');
  if (inst.estado === 'enrolling' && new Date(inst.inicio) <= agora) {
    const insc = (await c.query(`select count(*)::int n from event_participants where instance_id = $1`, [id])).rows[0].n;
    if (def.cancellation_rule.tipo === 'min_participantes_no_inicio' && insc < def.min_participants) await passo('enrolling', 'cancelled', 'inscritos insuficientes no início');
    else await passo('enrolling', 'active');
  }
  if (inst.estado === 'active' && inst.fim && new Date(inst.fim) <= agora) await passo('active', 'resolving');
  if (inst.estado === 'resolving') {
    const conc = (await c.query(`select user_id, progresso from event_participants where instance_id = $1 and estado = 'concluido'`, [id])).rows;
    const cidadesPart = new Set(conc.map((p) => p.progresso?.ibge).filter(Boolean));
    let cancelar: string | null = null;
    if (def.cancellation_rule.tipo === 'min_participantes_no_fim' && conc.length < def.min_participants) cancelar = `participantes insuficientes (${conc.length}/${def.min_participants})`;
    if (def.mechanic.params.min_cidades_participantes && cidadesPart.size < def.mechanic.params.min_cidades_participantes) cancelar = 'menos de duas cidades participantes reais';
    if (cancelar) await passo('resolving', 'cancelled', cancelar); // cancelado não publica vitória nem paga recompensa coletiva
    else {
      // recompensas coletivas são pagas só aqui, quando a edição vale (chave idempotente: retry não duplica)
      if (def.min_participants > 1) for (const p of conc) await conceder(c, { userId: p.user_id, regraId: def.reward_rule_id, eventoRef: refRecompensa(def, inst, agora), origem: 'evento', agora, dados: { evento: def.id } });
      const votos = inst.progresso?.votos || null;
      const resultado = { concluidos: conc.length, cidades: cidadesPart.size, escolha: votos ? vencedoras(votos) : null };
      await c.query(`update event_instances set resultado = $2 where id = $1`, [id, JSON.stringify(resultado)]);
      await passo('resolving', 'completed');
      if (conc.length > 0) await emitir(c, 'evento.concluido', { instancia: id, evento: def.id, categoria: def.category, ibge: inst.ibge, uf: inst.uf, titulo: inst.textos?.titulo, ...resultado }, `evento:${id}:concluido`);
    }
  }
  if ((inst.estado === 'completed' || inst.estado === 'cancelled') && inst.fim && new Date(inst.fim).getTime() + 7 * 24 * HORA <= agora.getTime()) await passo(inst.estado, 'archived');
  return n;
}

/** opções mais escolhidas (empate = todas as empatadas; sem critério secreto) */
function vencedoras(votos: Record<string, number>) {
  const max = Math.max(...Object.values(votos)); return { opcoes: Object.keys(votos).filter((k) => votos[k] === max).sort(), votos };
}

export function refRecompensa(def: EventDefinition, inst: { id: string }, agora: Date) {
  const r = REGRAS[def.reward_rule_id];
  return r?.escopo === 'conta' ? def.id : r?.escopo === 'dia' ? `${def.id}:${diaJogo(agora)}` : `evento:${inst.id}`;
}

/* ---------- consolidação horária de fatos → 'conteudo.fato' (pautas candidatas ficam na Fase 6) ---------- */
export const FATOS_RELEVANTES: Record<string, number> = {
  'evento.concluido': 5, 'obra.concluida': 8, 'obra.etapa_concluida': 4, 'competicao.temporada_aberta': 3, 'competicao.virada': 7,
  'competicao.apurada': 9, 'eleicao.resultado': 10, 'mandato.posse': 9, 'eleicao.votacao_aberta': 6, 'rua.criada': 3, 'casa.reivindicada': 2,
};
export async function consolidarFatos(agora = new Date()) {
  if (config.kill.eventos) return { pausado: true, lidos: 0, emitidos: 0 };
  const hora = new Date(agora); hora.setUTCMinutes(0, 0, 0);
  return tx(async (c) => {
    const cfg = (await c.query(`select * from event_orchestrator_settings where id = 1 for update`)).rows[0] as Config;
    const evs = (await c.query(`select id, tipo, dados, criado_em from domain_events where id > $1 and tipo = any($2) order by id limit 500`, [cfg.cursor_fatos, Object.keys(FATOS_RELEVANTES)])).rows;
    // dentro do limite por hora: mais relevantes primeiro (rodízio: no máximo 3 fatos por cidade por rodada)
    const porCidade = new Map<string, number>(); const escolhidos: any[] = [];
    for (const ev of [...evs].sort((a, b) => FATOS_RELEVANTES[b.tipo] - FATOS_RELEVANTES[a.tipo] || a.id - b.id)) {
      const cid = String(ev.dados.ibge ?? ev.dados.escopoId ?? 'BR'); const k = porCidade.get(cid) || 0;
      if (k >= 3 || escolhidos.length >= cfg.max_fatos_hora) continue;
      porCidade.set(cid, k + 1); escolhidos.push(ev);
    }
    for (const ev of escolhidos) await emitir(c, 'conteudo.fato', { origem_tipo: ev.tipo, origem_id: ev.id, ibge: ev.dados.ibge ?? (/^\d{7}$/.test(String(ev.dados.escopoId)) ? Number(ev.dados.escopoId) : null), relevancia: FATOS_RELEVANTES[ev.tipo], ocorrido_em: ev.criado_em, dados: ev.dados }, `fato:${ev.id}`);
    if (evs.length) await c.query(`update event_orchestrator_settings set cursor_fatos = $1, atualizado_em = now() where id = 1`, [evs[evs.length - 1].id]);
    const chave = 'fatos:' + hora.toISOString().slice(0, 13);
    await c.query(`insert into event_planner_runs (chave, tipo, concluido_em, resumo) values ($1, 'fatos', now(), $2) on conflict (chave) do update set execucoes = event_planner_runs.execucoes + 1, concluido_em = now(), resumo = excluded.resumo`, [chave, JSON.stringify({ lidos: evs.length, emitidos: escolhidos.length })]);
    return { lidos: evs.length, emitidos: escolhidos.length };
  });
}
