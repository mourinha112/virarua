/* Regras versionadas das eleições virtuais (rule_versions 'eleicoes@N') e calendário semanal em America/Sao_Paulo.
   Tudo que é número de produto mora aqui (com defaults do capítulo 9) e é exibido aos participantes. */
import { q1, q, type Exec } from '../../db/db';

export type Cargo = 'lider' | 'prefeito' | 'presidente';
export type Escopo = 'rua' | 'cidade' | 'brasil';
export const ESCOPO_DO_CARGO: Record<Cargo, Escopo> = { lider: 'rua', prefeito: 'cidade', presidente: 'brasil' };
export const CARGO_NOME: Record<Cargo, string> = { lider: 'líder da rua', prefeito: 'prefeito', presidente: 'presidente' };
export const CARGOS: Cargo[] = ['lider', 'prefeito', 'presidente'];
export const SELO = 'eleição virtual — jogo, sem vínculo com eleições reais';

/** marco do calendário: dia da semana local (1 = segunda … 7 = domingo) + hora/minuto locais */
export type Marco = { dia: number; hora: number; minuto?: number };
export type Regras = {
  versao: number;
  verificadoHoras: number;
  limiares: Record<Cargo, number>;
  apoiosPresidente: number;
  quorumPct: number;
  unicaExigeMaisConfirmacoes: boolean;
  segundoTurnoHoras: number;
  /** abaixo deste eleitorado, contagens não são exibidas (protege o voto individual em grupos pequenos) */
  placarMinEleitorado: number;
  votoEmCandidatoInativo: 'invalido_com_aviso';
  quotaAcoesPorTipo: number;
  calendario: { fuso: string; inscricoesAbrem: Marco; inscricoesFecham: Marco; votacaoAbre: Marco; votacaoFecha: Marco; publica: Marco };
};

export const REGRAS_PADRAO: Regras = {
  versao: 1, verificadoHoras: 24, limiares: { lider: 3, prefeito: 5, presidente: 50 }, apoiosPresidente: 5, quorumPct: 30,
  unicaExigeMaisConfirmacoes: true, segundoTurnoHoras: 24, placarMinEleitorado: 10, votoEmCandidatoInativo: 'invalido_com_aviso', quotaAcoesPorTipo: 1,
  calendario: {
    fuso: 'America/Sao_Paulo',
    inscricoesAbrem: { dia: 1, hora: 0 }, inscricoesFecham: { dia: 4, hora: 20 },
    votacaoAbre: { dia: 5, hora: 0 }, votacaoFecha: { dia: 7, hora: 20 }, publica: { dia: 7, hora: 21 },
  },
};

export function normalizarRegras(r: any): Regras {
  const base = REGRAS_PADRAO;
  const out: Regras = {
    ...base, ...(r || {}),
    limiares: { ...base.limiares, ...(r?.limiares || {}) },
    calendario: { ...base.calendario, ...(r?.calendario || {}) },
  };
  return out;
}

/** valida antes de publicar uma versão nova (evita regra que quebre o calendário ou zere o quorum) */
export function validarRegras(r: Regras): string[] {
  const erros: string[] = [];
  const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  if (!int(r.verificadoHoras, 0, 24 * 30)) erros.push('verificadoHoras inválido');
  for (const k of CARGOS) if (!int(r.limiares[k], 2, 1_000_000)) erros.push(`limiar de ${k} inválido`);
  if (!int(r.apoiosPresidente, 0, 1000)) erros.push('apoiosPresidente inválido');
  if (!int(r.quorumPct, 1, 100)) erros.push('quorumPct inválido');
  if (!int(r.segundoTurnoHoras, 1, 72)) erros.push('segundoTurnoHoras inválido');
  if (!int(r.placarMinEleitorado, 0, 100_000)) erros.push('placarMinEleitorado inválido');
  if (!int(r.quotaAcoesPorTipo, 1, 10)) erros.push('quotaAcoesPorTipo inválido');
  const cal = r.calendario; const ordem = [cal.inscricoesAbrem, cal.inscricoesFecham, cal.votacaoAbre, cal.votacaoFecha, cal.publica];
  for (const m of ordem) if (!m || !int(m.dia, 1, 7) || !int(m.hora, 0, 23) || !int(m.minuto ?? 0, 0, 59)) erros.push('marco de calendário inválido');
  if (!erros.length) {
    const min = ordem.map((m) => (m.dia - 1) * 1440 + m.hora * 60 + (m.minuto ?? 0));
    if (!(min[0] < min[1] && min[1] <= min[2] && min[2] < min[3] && min[3] <= min[4])) erros.push('ordem do calendário inválida');
  }
  return erros;
}

export const versaoDe = (id: string) => Number(id.split('@')[1] || 0);

export async function carregarRegras(c: Exec, regraId: string): Promise<Regras> {
  const r = await q1<{ regras: any }>(`select regras from rule_versions where id = $1`, [regraId], c);
  if (!r) throw new Error('regra inexistente: ' + regraId);
  return normalizarRegras(r.regras);
}

/** regra vigente num instante (a mais recente com vigente_desde <= instante) */
export async function regraVigente(c: Exec, instante: Date): Promise<{ id: string; regras: Regras }> {
  const rows = await q<{ id: string; regras: any }>(
    `select id, regras from rule_versions where dominio = 'eleicoes' and vigente_desde <= $1
     order by vigente_desde desc, (split_part(id, '@', 2))::int desc limit 1`, [instante], c);
  if (!rows[0]) return { id: 'eleicoes@1', regras: REGRAS_PADRAO };
  return { id: rows[0].id, regras: normalizarRegras(rows[0].regras) };
}

/* ---------- fuso horário (sem dependências: Intl) ---------- */
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }); fmtCache.set(tz, f); }
  return f;
}
export function partesLocais(tz: string, d: Date) {
  const p: Record<string, string> = {};
  for (const x of fmt(tz).formatToParts(d)) p[x.type] = x.value;
  const dow = ({ Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as Record<string, number>)[p.weekday];
  return { y: +p.year, m: +p.month - 1, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second, dow };
}
function offsetMin(tz: string, d: Date) {
  const p = partesLocais(tz, d);
  return (Date.UTC(p.y, p.m, p.d, p.h, p.min, p.s) - Math.floor(d.getTime() / 1000) * 1000) / 60000;
}
/** instante UTC de uma data/hora de parede no fuso (Date.UTC normaliza dia/mês fora do intervalo) */
export function localParaUtc(tz: string, y: number, m: number, d: number, h = 0, min = 0): Date {
  const palpite = Date.UTC(y, m, d, h, min);
  const o1 = offsetMin(tz, new Date(palpite));
  let t = palpite - o1 * 60000;
  const o2 = offsetMin(tz, new Date(t));
  if (o2 !== o1) t = palpite - o2 * 60000;
  return new Date(t);
}

export type Calendario = { codigo: string; inscricoesAbrem: Date; inscricoesFecham: Date; votacaoAbre: Date; votacaoFecha: Date; publicaEm: Date; mandatoFim: Date };

/** segunda-feira local (y, m, d) da semana que contém o instante */
export function segundaDaSemana(tz: string, agora: Date) {
  const p = partesLocais(tz, agora);
  const base = new Date(Date.UTC(p.y, p.m, p.d - (p.dow - 1)));
  return { y: base.getUTCFullYear(), m: base.getUTCMonth(), d: base.getUTCDate() };
}

export function calcularCalendario(regras: Regras, seg: { y: number; m: number; d: number }): Calendario {
  const cal = regras.calendario, tz = cal.fuso;
  const at = (mk: Marco, semanas = 0) => localParaUtc(tz, seg.y, seg.m, seg.d + semanas * 7 + (mk.dia - 1), mk.hora, mk.minuto ?? 0);
  const codigo = `T${seg.y}-${String(seg.m + 1).padStart(2, '0')}-${String(seg.d).padStart(2, '0')}`;
  return {
    codigo, inscricoesAbrem: at(cal.inscricoesAbrem), inscricoesFecham: at(cal.inscricoesFecham), votacaoAbre: at(cal.votacaoAbre),
    votacaoFecha: at(cal.votacaoFecha), publicaEm: at(cal.publica), mandatoFim: at(cal.publica, 1),
  };
}

/** quorum = pct do eleitorado congelado, arredondado para cima (aritmética inteira) */
export const calcularQuorum = (eleitorado: number, pct: number) => Math.floor((eleitorado * pct + 99) / 100);

/** regras em linguagem simples, para exibir junto da eleição */
export function resumoRegras(r: Regras): string[] {
  const c = r.calendario; const dias = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
  const h = (m: Marco) => `${dias[m.dia]} ${String(m.hora).padStart(2, '0')}h${m.minuto ? String(m.minuto).padStart(2, '0') : ''}`;
  return [
    `eleição virtual: cargos do jogo, sem vínculo com eleições reais (regras versão ${r.versao})`,
    `vota quem tem conta verificada há pelo menos ${r.verificadoHoras}h e mora no lugar quando o eleitorado é congelado`,
    `inscrições até ${h(c.inscricoesFecham)}; votação de ${h(c.votacaoAbre)} a ${h(c.votacaoFecha)}; resultado ${h(c.publica)} (horário de Brasília)`,
    `mínimo de eleitores: líder ${r.limiares.lider}, prefeito ${r.limiares.prefeito}, presidente ${r.limiares.presidente} (abaixo disso, fase de fundação)`,
    `quorum: ${r.quorumPct}% do eleitorado congelado, arredondado para cima`,
    `candidatura única precisa de mais confirmações que rejeições, além do quorum`,
    `vence quem tiver mais votos; empate vai para segundo turno de ${r.segundoTurnoHoras}h; novo empate deixa o cargo vago`,
    `presidente precisa de ${r.apoiosPresidente} apoios de contas elegíveis (apoio não é voto)`,
    `um cargo por pessoa por temporada; troca só durante as inscrições (apoios antigos caem)`,
    `voto vale 1 para todo mundo; pontos, XP ou compras não mudam o peso; dá para trocar o voto até o fechamento`,
    `voto em candidatura retirada ou suspensa fica inválido; se ainda houver prazo, você recebe aviso para escolher de novo`,
    `placar só aparece quando o eleitorado tem ${r.placarMinEleitorado} pessoas ou mais`,
  ];
}
