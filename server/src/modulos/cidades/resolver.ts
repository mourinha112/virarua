/* Resolve "Duque de Caxias - RJ", "vitoria/es", "sou de Recife PE!!" → código IBGE.
   Regras: menções (@x) e links são descartados (nunca decidem nada); com UF válida procura o nome naquela UF;
   sem UF só resolve se o nome existir em UMA única UF; nome ambíguo fica pendente (nunca escolhe o primeiro). */
import { q, type Exec } from '../../db/db';
import { normNome } from '../../db/semear';

export const UFS: Record<string, string> = {
  AC: 'acre', AL: 'alagoas', AP: 'amapa', AM: 'amazonas', BA: 'bahia', CE: 'ceara', DF: 'distrito federal', ES: 'espirito santo', GO: 'goias',
  MA: 'maranhao', MT: 'mato grosso', MS: 'mato grosso do sul', MG: 'minas gerais', PA: 'para', PB: 'paraiba', PR: 'parana', PE: 'pernambuco',
  PI: 'piaui', RJ: 'rio de janeiro', RN: 'rio grande do norte', RS: 'rio grande do sul', RO: 'rondonia', RR: 'roraima', SC: 'santa catarina',
  SP: 'sao paulo', SE: 'sergipe', TO: 'tocantins',
};
const UF_POR_NOME = new Map(Object.entries(UFS).map(([k, v]) => [v, k]));

export type Resolucao =
  | { tipo: 'ok'; ibge: number; nome: string; uf: string; via: 'nome_uf' | 'nome_unico' | 'alias' }
  | { tipo: 'ambigua'; candidatos: { ibge: number; nome: string; uf: string }[] }
  | { tipo: 'nao_encontrada' };

/** limpa o texto: tira menções, links, emojis e pontuação; mantém letras, números e espaços */
export function limparTexto(t: string) {
  return normNome(String(t || '').replace(/https?:\/\/\S+/g, ' ').replace(/@[\w.]+/g, ' ').replace(/[\/\-–—,;:|()]/g, ' '));
}

export async function resolverCidade(texto: string, ex?: Exec): Promise<Resolucao> {
  const limpo = limparTexto(texto); if (!limpo) return { tipo: 'nao_encontrada' };
  const tk = limpo.split(' ').filter(Boolean).slice(0, 24);
  // UF: sigla de 2 letras isolada ou nome do estado; a última ocorrência vale
  let uf: string | null = null, fimCidade = tk.length, ufPorNome = false;
  for (let i = tk.length - 1; i >= 0 && !uf; i--) {
    const s = tk[i].toUpperCase(); if (s.length === 2 && UFS[s]) { uf = s; fimCidade = i; break; }
    for (let n = 4; n >= 2 && !uf; n--) { if (i - n + 1 < 0) continue; const nome = tk.slice(i - n + 1, i + 1).join(' '); const sig = UF_POR_NOME.get(nome); if (sig) { uf = sig; fimCidade = i - n + 1; ufPorNome = true; } }
  }
  const r = await buscar(uf ? tk.slice(0, fimCidade) : tk, uf, ex);
  // "São Paulo", "Rio de Janeiro": o nome do estado também é o nome da cidade. Sem cidade antes do estado,
  // tenta o texto inteiro como cidade DENTRO desse estado.
  if (r.tipo === 'nao_encontrada' && uf && ufPorNome) return buscar(tk, uf, ex);
  return r;
}

async function buscar(fonte: string[], uf: string | null, ex?: Exec): Promise<Resolucao> {
  // n-gramas candidatos (mais longos primeiro)
  const grams: string[] = [];
  for (let n = Math.min(6, fonte.length); n >= 1; n--) for (let i = 0; i + n <= fonte.length; i++) grams.push(fonte.slice(i, i + n).join(' '));
  if (!grams.length) return { tipo: 'nao_encontrada' };
  // nomes curtos demais (1–2 letras) não contam
  const validos = grams.filter((g) => g.replace(/ /g, '').length >= 3);
  const muns = await q<{ ibge: number; nome: string; uf: string; nome_norm: string }>(`select ibge, nome, uf, nome_norm from municipios where nome_norm = any($1)`, [validos], ex);
  const ali = await q<{ alias_norm: string; ibge: number; nome: string; uf: string }>(`select a.alias_norm, m.ibge, m.nome, m.uf from municipio_aliases a join municipios m on m.ibge = a.ibge where a.alias_norm = any($1) and (a.uf is null or a.uf = coalesce($2, a.uf))`, [validos, uf], ex);
  for (const g of validos) {           // o n-grama mais longo que casa vence
    const ms = muns.filter((m) => m.nome_norm === g), as = ali.filter((a) => a.alias_norm === g);
    if (!ms.length && !as.length) continue;
    if (uf) {
      const m = ms.find((x) => x.uf === uf); if (m) return { tipo: 'ok', ibge: m.ibge, nome: m.nome, uf: m.uf, via: 'nome_uf' };
      const a = as.find((x) => x.uf === uf); if (a) return { tipo: 'ok', ibge: a.ibge, nome: a.nome, uf: a.uf, via: 'alias' };
      continue;
    }
    const todos = [...ms, ...as.map((a) => ({ ...a, nome_norm: a.alias_norm }))];
    const ufsDistintas = new Set(todos.map((m) => m.ibge));
    if (ufsDistintas.size === 1) { const m = todos[0]; return { tipo: 'ok', ibge: m.ibge, nome: m.nome, uf: m.uf, via: as.length && !ms.length ? 'alias' : 'nome_unico' }; }
    return { tipo: 'ambigua', candidatos: [...new Map(todos.map((m) => [m.ibge, { ibge: m.ibge, nome: m.nome, uf: m.uf }])).values()] };
  }
  return { tipo: 'nao_encontrada' };
}
