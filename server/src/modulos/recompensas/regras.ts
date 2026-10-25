/* Regras versionadas de recompensa (Fase 3). Fonte única: o ledger só grava regras listadas aqui, e a migração 030
   registra o pacote 'recompensas@1' em rule_versions. Mudar uma quantidade = criar regra nova com @versão nova.

   Quatro sistemas separados (cap. 8 do mega prompt):
   1. XP individual (sistema 'xp')            — evolução permanente da casa/avatar; teto global 100/dia.
   2. Contribuição da rua ('contribuicao')    — competição semanal; 10 por missão válida, teto 30/dia/usuário.
   3. Voto eleitoral                          — NÃO existe aqui (Fase 4). Nenhuma regra concede ou pondera voto.
   4. Apoio de candidatura                    — NÃO existe aqui (Fase 4).
   'colecao' guarda emblemas/lembranças/cosméticos: não são pontos e não somam em ranking nenhum. */

export const TETO_XP_DIA = 100;
export const TETO_CONTRIBUICAO_DIA = 30;
export const PONTOS_POR_MISSAO = 10;
export const FUSO = 'America/Sao_Paulo';

/** escopo da chave idempotente: 'conta' = uma vez na vida; 'edicao' = uma vez por instância; 'dia' = uma vez por dia */
export type EscopoChave = 'conta' | 'edicao' | 'dia' | 'missao_dia';
export type Regra =
  | { id: string; sistema: 'xp'; quantidade: number; escopo: EscopoChave; descricao: string }
  | { id: string; sistema: 'contribuicao'; quantidade: number; escopo: EscopoChave; descricao: string }
  | { id: string; sistema: 'colecao'; item: 'emblema' | 'lembranca' | 'cosmetico'; escopo: EscopoChave; descricao: string }
  | { id: string; sistema: 'nenhum'; escopo: EscopoChave; descricao: string };

const lista: Regra[] = [
  { id: 'xp5_missao@1', sistema: 'xp', quantidade: 5, escopo: 'missao_dia', descricao: '5 XP por missão diária concluída (uma vez por missão/dia)' },
  { id: 'contrib10_missao@1', sistema: 'contribuicao', quantidade: PONTOS_POR_MISSAO, escopo: 'missao_dia', descricao: '10 pontos para a rua do elenco snapshot por missão válida' },
  { id: 'xp10@1', sistema: 'xp', quantidade: 10, escopo: 'edicao', descricao: '10 XP por conclusão única na edição' },
  { id: 'xp15@1', sistema: 'xp', quantidade: 15, escopo: 'edicao', descricao: '15 XP por conclusão única na edição' },
  { id: 'xp20@1', sistema: 'xp', quantidade: 20, escopo: 'edicao', descricao: '20 XP por conclusão única na edição' },
  { id: 'xp10_unica@1', sistema: 'xp', quantidade: 10, escopo: 'conta', descricao: '10 XP uma vez por conta' },
  { id: 'xp20_unica@1', sistema: 'xp', quantidade: 20, escopo: 'conta', descricao: '20 XP uma vez por conta' },
  { id: 'xp10_dia@1', sistema: 'xp', quantidade: 10, escopo: 'dia', descricao: '10 XP, teto de uma conclusão por dia' },
  { id: 'sem_xp@1', sistema: 'nenhum', escopo: 'edicao', descricao: 'participação registrada, sem XP' },
  { id: 'cosmetico_unico@1', sistema: 'colecao', item: 'cosmetico', escopo: 'conta', descricao: 'cosmético, uma vez por conta' },
  { id: 'emblema@1', sistema: 'colecao', item: 'emblema', escopo: 'edicao', descricao: 'emblema da edição, sem XP' },
  { id: 'emblema_anual@1', sistema: 'colecao', item: 'emblema', escopo: 'edicao', descricao: 'emblema anual (uma instância por ano)' },
  { id: 'lembranca@1', sistema: 'colecao', item: 'lembranca', escopo: 'edicao', descricao: 'lembrança voluntária, sem XP' },
  { id: 'premio_competicao@1', sistema: 'nenhum', escopo: 'edicao', descricao: 'prêmio do cap. 10 (troféu/faixa/decoração da rua), entregue pela apuração; sem duplicar' },
];
export const REGRAS: Record<string, Regra> = Object.fromEntries(lista.map((r) => [r.id, r]));

/** dia do jogo (America/Sao_Paulo) em YYYY-MM-DD */
export function diaJogo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
}
/** hora local (0–23) em America/Sao_Paulo */
export function horaJogo(agora: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', hourCycle: 'h23' }).format(agora));
}
/** instante UTC de uma data/hora local de São Paulo (sem horário de verão desde 2019: UTC−3) */
export function instanteLocal(dia: string, hora = 0, minuto = 0): Date {
  return new Date(`${dia}T${String(hora).padStart(2, '0')}:${String(minuto).padStart(2, '0')}:00-03:00`);
}
export function somarDias(dia: string, n: number): string {
  const d = new Date(dia + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}
/** segunda-feira da semana do jogo que contém `agora` */
export function semanaJogo(agora: Date = new Date()): string {
  const dia = diaJogo(agora); const dow = new Date(dia + 'T12:00:00Z').getUTCDay(); // 0 = domingo
  return somarDias(dia, -((dow + 6) % 7));
}
