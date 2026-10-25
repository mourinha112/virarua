/* Cliente HTTP das rotas da Fase 2 (ruas, avatar, destinos/slots, presença, amizade, convites, emotes, lembranças).
   Mesmo padrão de src/api/cliente.ts: cookie de sessão same-origin, CSRF no cabeçalho x-csrf (cookie smn_csrf) e
   NUNCA lança — toda função devolve {ok:false, erro} para a UI mostrar o estado real. Respostas 409 de "sala cheia"
   chegam como {ok:false, motivo, alternativas}. */
export type Res<T> = ({ ok: true } & T) | ({ ok: false; erro: string; status?: number } & Partial<T>);

const BASE = (import.meta as any).env?.VITE_API || '/api';
function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch(BASE + caminho, {
      method: metodo, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-csrf': csrf() },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let j: any = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok || !j || j.ok === false) {
      const erro = (j && j.erro) || (r.status === 404 || r.status === 502 || r.status === 504 ? 'servidor do jogo fora do ar (rode npm run server)' : 'erro ' + r.status);
      return { ...(j || {}), ok: false, erro, status: r.status };
    }
    return j;
  } catch { return { ok: false, erro: 'servidor do jogo fora do ar (rode npm run server)' } as Res<T>; }
}

/* ---------- tipos ---------- */
export type SlotAvatar = 'pele' | 'cabelo' | 'cor_cabelo' | 'roupa' | 'cor_roupa' | 'acessorio' | 'calcado';
export type ConfigAvatar = Record<SlotAvatar, string>;
export type ItemCatalogo = { id: string; slot: SlotAvatar; nome: string; gratuito: boolean; possui: boolean };
export type EstadoPresenca = 'online' | 'away' | 'offline' | 'invisible';

export type RuaResumo = { id: string; nome: string; emblema: string | null; descricao: string | null; status: string; ocupadas: number; capacidade: number; publica: boolean; minha: boolean; souFundador: boolean };
export type Morador = { houseId: string; userId: string | null; nivel: number; lote: number; entrouEm: string; handle: string | null; avatar: ConfigAvatar | null; estado: EstadoPresenca };
export type Disponivel<T> = ({ disponivel: true } & T) | { disponivel: false; erro?: string };
export type RuaDetalhe = {
  rua: { id: string; nome: string; emblema: string | null; descricao: string | null; status: string; publica: boolean; capacidade: number; ocupadas: number; ibge: number; cidade: string; uf: string; criadaEm: string; listaEspera: number };
  fundador: { handle: string | null } | null;
  moradores: Morador[];
  lider: Disponivel<{ lider: { userId: string; handle: string | null; desde: string; ate: string | null } | null }>;
  competicao: Disponivel<{ temporada: string; posicao: number | null; pontos: number; modo: 'competitiva' | 'cooperativa'; fechaEm: string }>;
  obra: Disponivel<{ nome: string; progresso: number; meta: number; estado: string }>;
  eu: null | {
    temCasa: boolean; souMembro: boolean; minhaRua: string | null; souFundador: boolean; possoModerar: boolean;
    listaEspera: { estado: string; posicao: number } | null; pedidoPendente: string | null;
    pedidos: { id: string; mensagem: string; criadoEm: string; handle: string | null }[];
    convites: { id: string; tipo: string; maxUsos: number; usos: number; expiraEm: string }[];
  };
  regras: { vinculoCompetitivo: string };
};
export type ResultadoTroca = { tipo: 'mudou'; ruaId: string; anterior: string | null; loteNovo: boolean; competicaoAPartirDe: string | null } | { tipo: 'mesma'; ruaId: string } | { tipo: 'lista_espera'; ruaId: string; posicao: number };
export type Convite = { id: string; codigo: string; tipo: 'rua' | 'visita'; expiraEm: string; maxUsos: number; link: string };
export type PreviaConvite = { id: string; tipo: 'rua' | 'visita'; situacao: 'valido' | 'expirado' | 'revogado' | 'esgotado' | 'de_outra_pessoa'; aviso: string | null; expiraEm: string; de: { nome: string; handle: string | null } | null; rua: any; destino: any };

export type TipoDestino = 'house' | 'street' | 'city_square' | 'venue' | 'event';
export type Destino = { id: string; tipo: TipoDestino; nome: string; capacidade: number; porSala: number; ocupacao: number; salas: number; acessivel: boolean; motivo: string | null };
export type Presente = { slot: number; userId: string; nome: string; handle: string | null; avatar: ConfigAvatar | null; estado: string; eu: boolean };
export type Entrada = { destino: { id: string; tipo: TipoDestino; nome: string; ibge: number }; instancia: { id: string; numero: number; capacidade: number }; slot: number; jaEstava: boolean; ocupados: number; presentes: Presente[] };
export type FalhaEntrada = { motivo: 'cheio' | 'slot_ocupado'; alternativas?: { id: string; tipo: TipoDestino; nome: string }[]; slotsLivres?: number[] };
export type EmoteEvento = { id: number; userId: string; emote: string; animacao: string | null; rotulo: string; alvoUserId: string | null; criadoEm: string };
export type Amigo = { pedidoId: string; userId: string; nome: string; handle: string | null; desde: string; estado?: EstadoPresenca; destinoId?: string | null; destinoNome?: string | null; houseId: string | null; ibge: number | null };

/* ---------- chamadas ---------- */
export const social = {
  // ruas
  ruasDaCidade: (ibge: number) => req<{ ruas: RuaResumo[]; minha: string | null }>('GET', `/cidades/${ibge}/ruas`),
  minhaRua: () => req<Partial<RuaDetalhe> & { rua: RuaDetalhe['rua'] | null }>('GET', '/ruas/minha'),
  rua: (id: string) => req<RuaDetalhe>('GET', `/ruas/${id}`),
  criarRua: (d: { nome: string; emblema?: string; descricao?: string; publica?: boolean; mudar?: boolean }) => req<{ id: string; troca: ResultadoTroca | null }>('POST', '/ruas', d),
  entrarRua: (id: string) => req<{ troca: ResultadoTroca }>('POST', `/ruas/${id}/entrar`),
  pedirEntrada: (id: string, frase = 'oi') => req<{ pedidoId: string }>('POST', `/ruas/${id}/pedidos`, { frase }),
  responderPedido: (pedidoId: string, aprovar: boolean) => req<{ estado: string; troca: ResultadoTroca | null }>('POST', `/ruas/pedidos/${pedidoId}/${aprovar ? 'aprovar' : 'recusar'}`),
  sairDaEspera: (id: string) => req<{}>('POST', `/ruas/${id}/espera/sair`),
  arquivarRua: (id: string) => req<{ arquivada: boolean }>('POST', `/ruas/${id}/arquivar`),
  // convites
  criarConvite: (d: { tipo: 'rua' | 'visita'; ruaId?: string; destinoId?: string; maxUsos?: number; validadeHoras?: number; paraUserId?: string }) => req<{ convite: Convite }>('POST', '/convites', d),
  meusConvites: () => req<{ convites: any[] }>('GET', '/convites'),
  verConvite: (codigo: string) => req<{ convite: PreviaConvite }>('GET', `/convites/${encodeURIComponent(codigo)}`),
  aceitarConvite: (codigo: string) => req<{ tipo: 'rua'; troca: ResultadoTroca } | { tipo: 'visita'; destinoId: string }>('POST', `/convites/${encodeURIComponent(codigo)}/aceitar`),
  revogarConvite: (id: string) => req<{}>('POST', `/convites/${id}/revogar`),
  // avatar
  catalogo: () => req<{ itens: ItemCatalogo[] }>('GET', '/avatar/catalogo'),
  meuAvatar: () => req<{ editavel: boolean; motivo: string | null; houseId: string | null; config: ConfigAvatar; versao: number }>('GET', '/avatar/eu'),
  salvarAvatar: (config: Partial<ConfigAvatar>, versao?: number) => req<{ houseId: string; config: ConfigAvatar; versao: number }>('PUT', '/avatar/eu', { config, versao }),
  avatarDaCasa: (houseId: string) => req<{ houseId: string; config: ConfigAvatar; versao: number }>('GET', `/avatares/${houseId}`),
  // destinos e presença
  destinosDaCidade: (ibge: number) => req<{ cidade: { ibge: number; nome: string; uf: string }; destinos: Destino[] }>('GET', `/cidades/${ibge}/destinos`),
  destinoDaCasa: (houseId: string) => req<{ destino: { id: string; tipo: TipoDestino; nome: string; ibge: number } }>('GET', `/casas/${houseId}/destino`),
  destino: (id: string) => req<{ destino: any; salas: { id: string; numero: number; capacidade: number; ocupados: number }[]; acessivel: boolean; motivo: string | null }>('GET', `/destinos/${id}`),
  entrar: (id: string, escolha?: { instanciaId: string; slot: number }) => req<Entrada & FalhaEntrada>('POST', `/destinos/${id}/entrar`, escolha || {}),
  sair: () => req<{}>('POST', '/destinos/sair'),
  sala: (instanciaId: string, desde = 0) => req<{ ocupados: number; presentes: Presente[]; emotes: EmoteEvento[] }>('GET', `/destinos/salas/${instanciaId}?desde=${desde}`),
  heartbeat: (aba: string, estado: 'online' | 'away' = 'online') => req<{ estado: EstadoPresenca; abaPrincipal: string | null; estaAbaPrincipal: boolean; local: { destinoId: string; instanciaId: string; slot: number } | null; expiraSeg: number }>('POST', '/presenca/heartbeat', { aba, estado }),
  sairDoJogo: () => req<{}>('POST', '/presenca/sair'),
  invisivel: (invisivel: boolean) => req<{ invisivel: boolean }>('PUT', '/presenca/preferencia', { invisivel }),
  presencaDe: (userId: string) => req<{ estado: EstadoPresenca; local: { destinoId: string; nome: string; tipo: string } | null }>('GET', `/presenca/${userId}`),
  // amizade
  amigos: () => req<{ amigos: Amigo[]; recebidos: Amigo[]; enviados: Amigo[]; bloqueados: { userId: string; nome: string }[] }>('GET', '/amigos'),
  pedirAmizade: (alvo: { userId?: string; handle?: string }) => req<{ id: string; estado: 'pendente' | 'aceita' }>('POST', '/amigos/pedidos', alvo),
  responderAmizade: (pedidoId: string, aceitar: boolean) => req<{ estado: string }>('POST', `/amigos/pedidos/${pedidoId}/${aceitar ? 'aceitar' : 'recusar'}`),
  removerAmigo: (userId: string) => req<{ removido: boolean }>('POST', `/amigos/${userId}/remover`),
  bloquear: (userId: string) => req<{}>('POST', `/amigos/${userId}/bloquear`),
  desbloquear: (userId: string) => req<{}>('POST', `/amigos/${userId}/desbloquear`),
  // emotes, reações, lembranças
  emotes: () => req<{ emotes: { id: string; tipo: 'emote' | 'frase'; rotulo: string; animacao: string | null }[] }>('GET', '/emotes'),
  emote: (emote: string, alvoUserId?: string) => req<{ id: number; instanciaId: string; emote: string; animacao: string | null }>('POST', '/emotes', { emote, alvoUserId }),
  reagir: (alvoTipo: 'casa' | 'lembranca', alvoId: string, emote: string) => req<{ reacoes: { emote: string; n: number; minha: boolean }[] }>('POST', '/reacoes', { alvoTipo, alvoId, emote }),
  lembrancas: () => req<{ lembrancas: { id: string; tipo: string; titulo: string; ibge: number | null; cidade: string | null; uf: string | null; dados: any; criadoEm: string }[] }>('GET', '/lembrancas'),
  guardarLembranca: (titulo?: string) => req<{ id: string }>('POST', '/lembrancas', { titulo }),
};

/** id estável desta aba (para o heartbeat saber qual aba é a principal) */
export const ABA_ID = (() => { try { const k = 'smn_aba'; let v = sessionStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2, 10); sessionStorage.setItem(k, v); } return v; } catch { return Math.random().toString(36).slice(2, 10); } })();

/** heartbeat periódico (a cada 1/3 da expiração); 'away' quando a aba fica oculta. Devolve a função que para. */
export function iniciarPresenca(aoMudar?: (r: Awaited<ReturnType<typeof social.heartbeat>>) => void) {
  let t = 0, parado = false;
  const bater = async () => {
    if (parado) return;
    const r = await social.heartbeat(ABA_ID, document.visibilityState === 'hidden' ? 'away' : 'online');
    aoMudar?.(r);
    const seg = r.ok ? Math.max(10, Math.floor(r.expiraSeg / 3)) : 30;
    t = window.setTimeout(bater, seg * 1000);
  };
  const vis = () => { clearTimeout(t); void bater(); };
  document.addEventListener('visibilitychange', vis);
  void bater();
  return () => { parado = true; clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
}
