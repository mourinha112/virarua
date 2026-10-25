/* Cliente HTTP dos estabelecimentos patrocinados (server/src/modulos/estabelecimentos/rotas.ts).
   Mesmo contrato de src/api/cliente.ts: nunca lança, devolve {ok:false, erro, status}. */
export type ResE<T> = ({ ok: true } & T) | { ok: false; erro: string; status: number };

const BASE = (import.meta as any).env?.VITE_API || '/api';
function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }

async function req<T>(metodo: string, caminho: string, corpo?: unknown, keepalive = false): Promise<ResE<T>> {
  try {
    const r = await fetch(BASE + caminho, {
      method: metodo, credentials: 'same-origin', keepalive,
      headers: { 'content-type': 'application/json', 'x-csrf': csrf() },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let j: any = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok || !j || j.ok === false) return { ok: false, status: r.status, erro: (j && j.erro) || (r.status === 502 || r.status === 504 ? 'servidor do jogo fora do ar (rode npm run server)' : 'erro ' + r.status) };
    return j;
  } catch { return { ok: false, status: 0, erro: 'servidor do jogo fora do ar (rode npm run server)' }; }
}

export type LinkUI = { id: string; tipo: 'site' | 'instagram' | 'whatsapp' | 'cardapio' | 'mapa'; rotulo: string; dominio: string; url: string };
export type CupomUI = { id: string; titulo: string; regras: string; ate: string; esgotado: boolean; meuCodigo: string | null };
export type EventoUI = { id: string; titulo: string; descricao: string; inicio: string; fim: string; capacidade: number | null; patrocinado: true };
export type EstabelecimentoUI = {
  id: string; nome: string; categoria: 'cafeteria' | 'restaurante' | 'loja' | 'pet' | 'eventos' | 'bar'; ibge: number; cor: string; descricao: string; demo: boolean;
  patrocinado: true; selo: string; patrocinio: { modalidade: string; ate: string } | null; avisoVirtual: string;
  endereco: string | null; horario: string | null; telefone: string | null;
  logo: { ref: string; licenca: string } | null; fotos: string[];
  interior: { mesas: number; lugaresPorMesa: number; capacidade: number };
  links: LinkUI[]; cupons: CupomUI[]; eventos: EventoUI[];
};
export type ItemListaUI = { id: string; nome: string; categoria: string; ibge: number; cor: string; desc: string; ate: string; demo: boolean; patrocinado: true; selo: string };

const ID = (s: string) => encodeURIComponent(s);
export const apiEstabelecimentos = {
  listar: (ibge?: number) => req<{ estabelecimentos: ItemListaUI[] }>('GET', '/estabelecimentos' + (ibge ? `?ibge=${ibge}` : '')),
  detalhe: (id: string) => req<{ estabelecimento: EstabelecimentoUI }>('GET', `/estabelecimentos/${ID(id)}`),
  visita: (id: string) => req<{ nova: boolean }>('POST', `/estabelecimentos/${ID(id)}/visita`),
  /** registra o clique (keepalive: sobrevive à troca de aba) e devolve a URL revalidada pelo servidor */
  clique: (id: string, link: string) => req<{ url: string; dominio: string; contado: boolean }>('POST', `/estabelecimentos/${ID(id)}/links/${ID(link)}/clique`, undefined, true),
  resgatar: (cupom: string) => req<{ codigo: string; jaResgatado: boolean }>('POST', `/estabelecimentos/cupons/${ID(cupom)}/resgatar`),
  pedido: (d: { cidade: string; nome: string; ig?: string; zap?: string; tipo: string }) => req<{ codigo: string; cidade: string }>('POST', '/estabelecimentos/pedidos', d),
  denunciar: (alvoId: string, categoria: string, texto?: string) => req<{ nova: boolean }>('POST', '/denuncias', { alvo_tipo: 'venue', alvo_id: alvoId, categoria, texto }),
};

/** confere no cliente também (defesa extra): só https com host nomeado, sem credenciais nem porta */
export function urlExternaSegura(u: string): URL | null {
  try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && !x.port && /[a-z]/i.test(x.hostname) ? x : null; } catch { return null; }
}
