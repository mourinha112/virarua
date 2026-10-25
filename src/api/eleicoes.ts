/* Cliente das eleições virtuais (server/src/modulos/eleicoes). Mesmo padrão de src/api/cliente.ts:
   cookie de sessão HttpOnly, CSRF por cabeçalho, nunca lança (devolve {ok:false, erro}). */
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

export type CargoId = 'lider' | 'prefeito' | 'presidente';
export type CandidatoV = { id: string; handle: string; votos: number | null; estado: string; apoios?: number; apoiosNecessarios?: number };
export type EleicaoV = {
  id: string; cargo: CargoId; cargoNome: string; escopo: string; escopoId: string; escopoNome: string; status: string; statusTexto: string;
  turno: number; modo: 'disputa' | 'confirmacao' | null; regraId: string;
  prazos: { inscricoesFecham: string; votacaoAbre: string; votacaoFecha: string; publicaEm: string };
  eleitorado: number | null; quorum: number | null; candidatos: CandidatoV[]; rejeicoes?: number | null;
  placarVisivel: boolean; placarProvisorio: boolean; placarAtualizadoEm: string | null; placarMinEleitorado: number;
  resultado: { tipo: string; texto: string; vencedor: string | null; eleitorado: number | null; votosValidos: number | null; corrigido: boolean; apuradoEm: string | null } | null;
  meuVoto: { candidato: string; invalido: boolean; em: string } | null; souEleitor: boolean | null; minhaCandidatura: { id: string; estado: string } | null; selo: string;
};
export type EleicaoDetalheV = EleicaoV & { regras: string[]; origemId: string | null; segundoTurnoId: string | null; correcoes: { id: number; motivo: string; em: string }[] };
export type MandatoV = { cargo: CargoId; cargoNome: string; escopoNome: string; ocupante: string | null; inicio: string | null; fim: string | null; vago: boolean; texto: string };
export type CalendarioV = {
  fuso: string; agoraServidor: string; fase: string; proximaPosse: string; regraId: string; regras: string[]; mandatos: MandatoV[]; selo: string;
  temporada: { codigo: string; inscricoesAbrem: string; inscricoesFecham: string; votacaoAbre: string; votacaoFecha: string; publicaEm: string; mandatoFim: string };
  meuCargo: { termoId: string; cargo: CargoId; cargoNome: string; escopoNome: string; fim: string } | null;
};
export type OpcaoCargo = { id: string; tipo: string; nome: string; descricao: string; duracao_horas: number; neutra: boolean };

export const eleicoesApi = {
  listar: () => req<{ eleicoes: EleicaoV[]; publico: boolean; agoraServidor: string; selo: string }>('GET', '/eleicoes'),
  detalhe: (id: string) => req<{ eleicao: EleicaoDetalheV }>('GET', `/eleicoes/${id}`),
  calendario: () => req<CalendarioV>('GET', '/eleicoes/calendario'),
  candidatar: (id: string, cargo: CargoId, trocar = false) => req<{ candidatoId: string; trocou: boolean; mensagem: string }>('POST', `/eleicoes/${id}/candidatura`, { confirmar: true, cargo, trocar }),
  retirar: (id: string) => req<{ mensagem: string }>('POST', `/eleicoes/${id}/candidatura/retirar`, {}),
  apoiar: (id: string, candidato: string) => req<{ apoios: number; necessarios: number; mensagem: string }>('POST', `/eleicoes/${id}/apoio`, { candidato }),
  /** votar e trocar voto usam a mesma rota; 'rejeitar' só em candidatura única */
  votar: (id: string, candidato: string) => req<{ trocou: boolean; mensagem: string }>('POST', `/eleicoes/${id}/voto`, { candidato }),
  catalogo: () => req<{ cargo: CargoId | null; cargoNome?: string; escopoNome?: string; fim?: string; opcoes: OpcaoCargo[]; vigentes: Record<string, { fonte: string; opcao: string; nome: string } | null> }>('GET', '/eleicoes/cargo/catalogo'),
  acao: (tipo: string, opcao: string) => req<{ nome: string; expiraEm: string; mensagem: string }>('POST', '/eleicoes/cargo/acao', { tipo, opcao }),
  renunciar: () => req<{ mensagem: string }>('POST', '/eleicoes/cargo/renuncia', { confirmar: true }),
};
