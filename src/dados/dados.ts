/* Carrega o pacote do mapa e monta os índices usados pela UI e pelo 3D. */
import munJson from '../data/municipios.json';
import type { PacoteMundo } from './formato';
import { nivelDe, type LetraCargo } from '../jogo/regras';
import { UF_POR_SIGLA } from '../mundo/terreno';

export type Municipio = { ibge: number; nome: string; uf: string; x: number; y: number; pop: number; capital: boolean; k: string };
export const MUNICIPIOS: Municipio[] = (munJson as [number, string, string, number, number, number, number][]).map((m) => ({ ibge: m[0], nome: m[1], uf: m[2], x: m[3], y: m[4], pop: m[5], capital: !!m[6], k: semAcento(m[1]) }));
export const MUN = new Map(MUNICIPIOS.map((m) => [m.ibge, m]));

export function semAcento(s: string) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
/** @ normalizado: minúsculas, sem @, aceita link do Instagram colado, só [a-z0-9._], até 30. */
export function normHandle(s: string) {
  s = String(s ?? '').trim().toLowerCase();
  const i = s.indexOf('instagram.com/'); if (i >= 0) s = s.slice(i + 14);
  s = s.replace(/^@+/, '').split(/[/?#]/)[0].replace(/^@+/, '');
  return s.replace(/[^a-z0-9._]/g, '').slice(0, 30);
}

export type Cidade = { ibge: number; nome: string; uf: string; x: number; y: number; pop: number; capital: boolean; ini: number; n: number; fund: number; pts: number; k: string; prefeito: number };

export type Dados = ReturnType<typeof indexar>;

export function indexar(p: PacoteMundo) {
  const USR = p.n > 0 ? p.u.split(String.fromCharCode(10)) : [];
  const POR_HANDLE = new Map(USR.map((h, i) => [h, i]));
  const CID: Cidade[] = [];
  const CID_DE = new Int32Array(p.n).fill(-1);
  const POR_IBGE = new Map<number, Cidade>();
  for (const [ibge, ini, n, fund] of p.cidades) {
    const m = MUN.get(ibge); if (!m) continue;
    let pts = 0, prefeito = -1; for (let g = ini; g < ini + n; g++) { pts += p.pts[g]; if (p.cg[g] === 'M' || (prefeito < 0 && 'PSGD'.includes(p.cg[g]))) { if (p.cg[g] === 'M') prefeito = g; } }
    const c: Cidade = { ibge, nome: m.nome, uf: m.uf, x: m.x, y: m.y, pop: m.pop, capital: m.capital, ini, n, fund, pts, k: m.k, prefeito };
    for (let g = ini; g < ini + n; g++) CID_DE[g] = CID.length;
    CID.push(c); POR_IBGE.set(ibge, c);
  }
  const ORDEM = [...CID].sort((a, b) => b.n - a.n || a.ibge - b.ibge);
  const NV = Uint8Array.from(p.tot, (t) => nivelDe(t));
  const cargo = (g: number) => (p.cg[g] === ' ' ? null : (p.cg[g] as LetraCargo));
  const ESTADOS = new Map<string, { uf: string; nome: string; casas: number; cidades: Cidade[]; pts: number; gov: number }>();
  for (const c of CID) {
    let e = ESTADOS.get(c.uf); if (!e) { e = { uf: c.uf, nome: UF_POR_SIGLA.get(c.uf)?.nome || c.uf, casas: 0, cidades: [], pts: 0, gov: -1 }; ESTADOS.set(c.uf, e); }
    e.casas += c.n; e.cidades.push(c); e.pts += c.pts;
    for (let g = c.ini; g < c.ini + c.n; g++) if (p.cg[g] === 'G') e.gov = g;
  }
  let presidente = -1; for (let g = 0; g < p.n; g++) if (p.cg[g] === 'P') presidente = g;
  return { p, USR, POR_HANDLE, CID, CID_DE, POR_IBGE, ORDEM, NV, cargo, ESTADOS, presidente };
}

/** produção lê o mapa do banco (/api/mundo/pacote); dev usa o pacote de demonstração. ?mundo=api ou ?mundo=demo força. */
export function urlDoMundo() {
  const f = new URLSearchParams(location.search).get('mundo') || (import.meta as any).env?.VITE_MUNDO;
  const api = f ? f === 'api' : !(import.meta as any).env?.DEV;
  return api ? '/api/mundo/pacote' : '/dados/mundo.json';
}
export async function carregarDados(url = urlDoMundo()): Promise<Dados> {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error('não consegui carregar os dados do mapa (' + r.status + ')');
  return indexar(await r.json());
}

export const fmtN = (n: number) => Math.round(n).toLocaleString('pt-BR');
