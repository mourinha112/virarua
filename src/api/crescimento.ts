/* Cliente das rotas de crescimento: guerra de cidades, caça ao tesouro, enfeites/ofensiva. */
import type { Res } from './cliente';

function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function req<T>(metodo: string, caminho: string, corpo?: unknown): Promise<Res<T>> {
  try {
    const r = await fetch('/api' + caminho, { method: metodo, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': csrf() }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    let j: any = null; try { j = await r.json(); } catch { /* sem corpo */ }
    if (!r.ok || !j || j.ok === false) return { ok: false, erro: (j && j.erro) || 'erro ' + r.status };
    return j;
  } catch { return { ok: false, erro: 'servidor fora do ar' }; }
}

export type CidadeGuerra = { ibge: number; nome: string; uf: string; pts: number; casas_novas: number; xp: number; moradores: number };
export type EventoGuerra = { tipo: 'cidade' | 'estado'; a: string; b: string; pos: number; quando: string };
export type Guerra = {
  semana: string; fecha: string; cidades: CidadeGuerra[]; total_cidades: number; estados: { uf: string; pts: number; cidades: number }[];
  minha: null | (CidadeGuerra & { pos: number; acima: CidadeGuerra | null; abaixo: CidadeGuerra | null; falta: number });
  meu_estado: null | { pos: number; uf: string; pts: number; cidades: number }; eventos: EventoGuerra[];
};
export type Cavada = { ibge: number; nome: string; uf: string; km: number; dia: string; calor: string };
export type Tesouro = {
  semana: string; fecha: string; dicas: string[]; total_dicas: number; achados: { ordem: number; nome: string }[]; max_dia: number; cidade?: string;
  eu: null | { cavadas: Cavada[]; restam: number; achou: boolean; ordem: number | null };
};
export type Enfeite = { id: string; nome: string; meta: number; liberado: boolean };
export type Decor = { xp: number; enfeites: Enfeite[]; escolhidos: string[]; bandeira: string | null; ofensiva: { dias: number; hoje: boolean; chama: number } };
export type EnfeiteMapa = { ibge: number; lote: number; itens: string[]; bandeira: string | null; chama: number };

export const crescimentoApi = {
  guerra: (ibge?: number) => req<Guerra>('GET', '/guerra' + (ibge ? '?ibge=' + ibge : '')),
  tesouro: () => req<Tesouro>('GET', '/tesouro'),
  cavar: (ibge: number) => req<{ cidade: string; km: number; calor: string; premio: null | { ordem: number; xp: number }; restam: number }>('POST', '/tesouro/cavar', { ibge }),
  decor: () => req<Decor>('GET', '/decor/eu'),
  salvarDecor: (itens: string[], bandeira: string | null) => req<{ escolhidos: string[] }>('POST', '/decor/eu', { itens, bandeira }),
  enfeites: (ibges: number[]) => req<{ casas: EnfeiteMapa[] }>('GET', '/enfeites?ibge=' + ibges.join(',')),
};

/* visita na casa: campainha com adesivo e curtir (+1 XP pro dono) · online agora */
export type CasaSocial = { casa: { handle: string; reivindicada: boolean; minha: boolean }; campainhaHoje: number; campainhaTotal: number; curtidas: number; adesivos: Record<string, number>; eu: { tocouHoje: boolean; curtiu: boolean } };
export const visitaApi = {
  estado: (h: string) => req<CasaSocial>('GET', '/casa-social/' + encodeURIComponent(h)),
  campainha: (h: string, adesivo: string) => req<CasaSocial & { xpDono: number }>('POST', '/casa-social/' + encodeURIComponent(h) + '/campainha', { adesivo }),
  curtir: (h: string) => req<CasaSocial & { xpDono: number }>('POST', '/casa-social/' + encodeURIComponent(h) + '/curtir', {}),
  online: (v: string) => req<{ online: number }>('POST', '/online', { v }),
};
