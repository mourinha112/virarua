/* Cliente HTTP do servidor do jogo (server/). Sessão por cookie HttpOnly; CSRF por cabeçalho x-csrf (double submit).
   Toda função devolve {ok:false, erro} em vez de lançar, para a UI mostrar o estado real. */
export type Res<T> = ({ ok: true } & T) | { ok: false; erro: string };

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
    if (!r.ok || !j || j.ok === false) return { ok: false, erro: (j && j.erro) || (r.status === 404 || r.status === 502 || r.status === 504 ? 'servidor do jogo fora do ar (rode npm run server)' : 'erro ' + r.status) };
    return j;
  } catch { return { ok: false, erro: 'servidor do jogo fora do ar (rode npm run server)' }; }
}

export type EleicaoUI = { id: string; cargo: string; escopoNome: string; status: string; candidatos: { id: string; handle: string; votos: number | null }[] };
export type RuaUI = { id: string; nome: string; status: string; ocupadas: number; capacidade: number; publica: boolean };

export const api = {
  sessao: () => req<{ usuario: { id: string; nome: string } | null }>('GET', '/sessao'),
  eleicoesAbertas: (_h: string) => req<{ eleicoes: EleicaoUI[] }>('GET', '/eleicoes'),
  votar: (eleicao: string, candidato: string) => req<{}>('POST', `/eleicoes/${eleicao}/voto`, { candidato }),
  pedidoNegocio: (d: Record<string, string>) => req<{ codigo: string }>('POST', '/estabelecimentos/pedidos', d),
  desafio: (handle: string) => req<{ codigo: string; validadeMin: number }>('POST', '/reivindicacao/desafio', { handle }),
  devEntrar: (ibge: number, apelido = 'voce_teste') => req<{ aviso: string; cidade: string }>('POST', '/dev/entrar', { ibge, apelido }),
  eu: () => req<{ usuario: any; casa: null | { id: string; nivel: number; lote_index: number; cidade: { ibge: number; nome: string; uf: string } }; rua: null | { id: string; nome: string; ocupadas: number; capacidade: number }; avatar: null | { config: any } }>('GET', '/eu'),
  recompensas: () => req<{ resumo: { xp_total: number; xp_hoje: number; teto_xp_dia: number } }>('GET', '/recompensas/eu'),
  ruasDaCidade: (ibge: number) => req<{ ruas: RuaUI[] }>('GET', `/cidades/${ibge}/ruas`),
};

export type Especie = 'gato' | 'cachorro';
export type HumorPet = 'feliz' | 'fome' | 'triste';
export type PetUI = { especie: Especie; cor: string; nome: string; humor?: HumorPet; comeuHoje?: boolean };
export type PetMapa = PetUI & { ibge: number; lote: number };
export const petsApi = {
  eu: () => req<{ pet: PetUI | null; pontos: number; meta: number; liberado: boolean; temCasa: boolean; cores: Record<Especie, string[]> }>('GET', '/pets/eu'),
  adotar: (d: PetUI) => req<{ pet: PetUI }>('POST', '/pets/eu', d),
  daCidade: (ibges: number[]) => req<{ pets: PetMapa[] }>('GET', '/pets?ibge=' + ibges.join(',')),
};
