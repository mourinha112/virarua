/* Cliente da Fase 3: missões diárias, obra da rua, competição de ruas e eventos. O front só envia a PROVA
   (id do desafio + resposta); pontos e XP são sempre calculados no servidor. */
import type { Res } from './cliente';

const BASE = (import.meta as any).env?.VITE_API || '/api';
function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(BASE + caminho, { method: metodo, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': csrf() }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    let j: any = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok || !j || j.ok === false) return { ok: false, erro: (j && j.erro) || (r.status === 404 || r.status === 502 || r.status === 504 ? 'servidor do jogo fora do ar (rode npm run server)' : 'erro ' + r.status) };
    return j;
  } catch { return { ok: false, erro: 'servidor do jogo fora do ar (rode npm run server)' }; }
}

export type MissaoUI = { id: string; titulo: string; descricao: string; desafio: string; concluida: boolean; pontuou_rua: boolean; motivo_sem_ponto: string | null };
export type ResumoUI = { xp_total: number; xp_hoje: number; contribuicao_hoje: number; itens: number; dia: string; teto_xp_dia: number; teto_contribuicao_dia: number };
export type DesafioUI = { id: string; tipo: 'conta' | 'sequencia' | 'peca' | 'quiz' | 'simbolos'; enunciado: any; expira_em: string };
export type ObraUI = { id: string; modelo: string; titulo: string; status: string; progresso: number; meta: number; etapas: { nome: string; ate: number; concluida: boolean }[]; etapa_atual: number; ajudantes: number; minha_parte: number; meu_limite: number; limite_dia: number; regras: string; concluidas: { titulo: string; concluida_em: string }[] };
export type CompeticaoUI = {
  temporada: { semana: string; fim: string }; explicacao: string; regras: string[]; participa: boolean; motivo?: string;
  entrada?: { modo: 'competitivo' | 'cooperativo'; elegivel: boolean; divisao: string | null; elenco: number; pontos: number; participacao_pct: number };
  ranking?: { street_id: string; nome: string; pontos: number; colocacao_atual: number; elenco: number; participacao_pct: number }[];
  cooperativo?: { motivo: string; meta: number; pontos: number; pct: number };
  liga_regional?: { rotulo: string; ruas: { street_id: string; nome: string; cidade: string; pontos: number }[] } | null;
  trofeus: { tipo: string; semana: string }[]; eu: { no_elenco: boolean; pontua_agora: boolean; aviso: string | null } | null;
};
export type ConclusaoUI = { ja_concluida: boolean; contribuiu?: boolean; motivo_sem_ponto?: string | null; recompensas: { sistema: string; quantidade: number; limitado: boolean }[] };

export type ExtratoUI = { quando: string; regra_id: string; origem: string; evento_ref: string; quantidade: number; limitado: boolean; dados: any };
export type PontosUI = { resumo: ResumoUI; fontes: { fonte: string; xp: number; vezes: number }[]; extrato: ExtratoUI[]; amigos: { amigo: string; estado: 'pago' | 'esperando' }[] };
export const recompensasApi = {
  pontos: () => req<PontosUI>('GET', '/pontos/eu'),
  missoes: () => req<{ dia: string; morador: boolean; rua: string | null; missoes: MissaoUI[]; resumo: ResumoUI }>('GET', '/missoes'),
  desafio: (missao: string) => req<{ desafio: DesafioUI }>('POST', `/missoes/${missao}/desafio`),
  concluir: (missao: string, desafio_id: string, resposta: unknown) => req<ConclusaoUI>('POST', `/missoes/${missao}/concluir`, { desafio_id, resposta }),
  obra: (rua: string) => req<{ rua: { id: string; nome: string }; obra: ObraUI }>('GET', `/ruas/${rua}/obra`),
  competicao: (rua: string) => req<{ rua: { id: string; nome: string } } & CompeticaoUI>('GET', `/ruas/${rua}/competicao`),
  eventos: (ibge?: number) => req<{ pausado: boolean; eventos: any[] }>('GET', '/eventos' + (ibge ? `?ibge=${ibge}` : '')),
  participar: (evento: string, acao: unknown) => req<{ concluido: boolean; recompensa: any }>('POST', `/eventos/${evento}/participar`, { acao }),
};
