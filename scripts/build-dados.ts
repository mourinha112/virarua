/* Gera public/dados/mundo.json (pacote estático do mapa).
   --mock : moradores fictícios distribuídos pela população (dados de DEMONSTRAÇÃO, marcados demo:true)
   sem flag: lê do banco do servidor (server/) — ver server/src/build/exportar.ts */
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PacoteMundo, Loja } from '../src/dados/formato';
import { proximoFechamento, type LetraCargo } from '../src/jogo/regras';

const here = dirname(fileURLToPath(import.meta.url));
type Mun = [number, string, string, number, number, number, number];
const MUNS: Mun[] = JSON.parse(readFileSync(resolve(here, '../src/data/municipios.json'), 'utf8'));

export type Morador = { h: string; ibge: number; pts: number; tot: number; cor: number; entrada: number };

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------------- dados fictícios ---------------- */
const NOMES = ['ana', 'joao', 'maria', 'pedro', 'lucas', 'julia', 'gabriel', 'bia', 'rafa', 'leo', 'duda', 'enzo', 'malu', 'davi', 'lara', 'theo', 'cecilia', 'miguel', 'helena', 'arthur', 'alice', 'heitor', 'laura', 'bernardo', 'sofia', 'caio', 'livia', 'vitor', 'isa', 'nina', 'bruno', 'carol', 'diego', 'fernanda', 'gustavo', 'jessica', 'kaique', 'larissa', 'mateus', 'nicole', 'otavio', 'paula', 'renan', 'sara', 'tiago', 'vanessa', 'wesley', 'yasmin', 'zeca', 'iago'];
const SOBRE = ['silva', 'souza', 'lima', 'costa', 'rocha', 'alves', 'dias', 'melo', 'ramos', 'nunes', 'moura', 'pinto', 'reis', 'gomes', 'lopes', 'campos', 'teixeira', 'barros', 'freitas', 'vieira', 'cardoso', 'castro', 'araujo', 'ribeiro', 'mendes'];

/** quantidades fixas pedidas para a demonstração (IBGE → casas) */
export const CASAS_FIXAS: Record<number, number> = { 3304557: 680, 3550308: 400, 3301702: 460 };

export function gerarMock(total = 16000, seed = 20261024): Morador[] {
  const r = rng(seed);
  const usados = new Set<string>();
  const handle = () => {
    for (;;) {
      const a = NOMES[Math.floor(r() * NOMES.length)], b = SOBRE[Math.floor(r() * SOBRE.length)], n = Math.floor(r() * 990) + 10;
      const forma = Math.floor(r() * 5);
      const h = forma === 0 ? `${a}.${b}${n}` : forma === 1 ? `${a}_${b}` + (n % 100) : forma === 2 ? `${a}${b}.${n}` : forma === 3 ? `_${a}${n}` : `${a}.${b}_`;
      const hh = 'demo.' + h; // prefixo deixa explícito que é dado fictício
      if (!usados.has(hh)) { usados.add(hh); return hh; }
    }
  };
  const peso = MUNS.map((m) => (CASAS_FIXAS[m[0]] !== undefined ? 0 : Math.pow(Math.max(800, m[5]), 0.55)));
  const somaP = peso.reduce((a, b) => a + b, 0);
  const contagem = new Map<number, number>();
  // fundadores: ~88% das cidades têm ao menos uma casa
  for (const m of MUNS) if (r() < 0.7) contagem.set(m[0], 1);
  for (const [ib, n] of Object.entries(CASAS_FIXAS)) contagem.set(Number(ib), n);
  let resto = total - [...contagem.values()].reduce((a, b) => a + b, 0);
  // distribui o resto pela população (amostragem acumulada)
  const acc: number[] = []; let s = 0; for (const p of peso) { s += p; acc.push(s); }
  while (resto-- > 0) {
    const x = r() * somaP; let lo = 0, hi = acc.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (acc[mid] < x) lo = mid + 1; else hi = mid; }
    const ib = MUNS[lo][0]; contagem.set(ib, (contagem.get(ib) || 0) + 1);
  }
  const out: Morador[] = [];
  for (const m of MUNS) {
    const n = contagem.get(m[0]) || 0;
    for (let i = 0; i < n; i++) {
      const pts = 10 + Math.round(-Math.log(1 - r()) * 22) + (r() < 0.01 ? Math.round(r() * 2500) : 0);
      const u = r(); const legado = Math.round(u < 0.7 ? -Math.log(1 - r()) * 90 : u < 0.93 ? 200 + r() * 700 : u < 0.985 ? 900 + r() * 2200 : 3000 + r() * 12000);
      out.push({ h: handle(), ibge: m[0], pts, tot: pts + legado, cor: Math.floor(r() * 10) * 10 + Math.floor(r() * 8), entrada: i });
    }
  }
  return out;
}

/* ---------------- cargos (jogo clássico: pontos da semana) ---------------- */
export function calcularCargos(mor: Morador[]): LetraCargo[] {
  const cg: (LetraCargo | ' ')[] = mor.map(() => ' ');
  const ufDe = new Map(MUNS.map((m) => [m[0], m[2]]));
  const popUf = new Map<string, number>(); for (const m of MUNS) popUf.set(m[2], (popUf.get(m[2]) || 0) + m[5]);
  // desempate: mais pontos; depois casa mais antiga (índice menor)
  // só concorre a cargo quem fez pontos na semana (casa recém-criada, sem pontos, não vira presidente/senador)
  const ordem = mor.map((_, i) => i).filter((i) => mor[i].pts > 0).sort((a, b) => mor[b].pts - mor[a].pts || a - b);
  const livre = (i: number) => cg[i] === ' ';
  // Brasil
  const br = ordem.filter(livre); if (br[0] !== undefined) cg[br[0]] = 'P'; for (const i of br.slice(1, 50)) cg[i] = 'S';
  // estados
  const porUf = new Map<string, number[]>(); for (const i of ordem) { const uf = ufDe.get(mor[i].ibge)!; (porUf.get(uf) || porUf.set(uf, []).get(uf)!).push(i); }
  for (const [uf, l] of porUf) {
    const f = l.filter(livre); if (f[0] !== undefined) cg[f[0]] = 'G';
    const bancada = Math.max(8, Math.min(70, Math.round((popUf.get(uf) || 0) / 350000)));
    for (const i of f.slice(1, 1 + bancada)) cg[i] = 'D';
  }
  // cidades
  const porCid = new Map<number, number[]>(); for (const i of ordem) (porCid.get(mor[i].ibge) || porCid.set(mor[i].ibge, []).get(mor[i].ibge)!).push(i);
  for (const l of porCid.values()) { const f = l.filter(livre); if (f[0] !== undefined) cg[f[0]] = 'M'; for (const i of f.slice(1, 21)) cg[i] = 'V'; }
  return cg as LetraCargo[];
}

const LOJAS_DEMO: Loja[] = [
  { id: 'cafe-do-largo', nome: 'Café do Largo', tipo: 'cafe', ibge: 3550308, cor: '#8a5a3b', desc: 'Café de demonstração: mesas na praça virtual e cupom de exemplo.', ate: '2026-11-30', patrocinado: true },
  { id: 'pet-amigo', nome: 'Pet Amigo', tipo: 'pet', ibge: 3205309, cor: '#2a9d8f', desc: 'Pet shop de demonstração para eventos de pets virtuais.', ate: '2026-11-30', patrocinado: true },
  { id: 'lanche-da-esquina', nome: 'Lanche da Esquina', tipo: 'lanchonete', ibge: 3304557, cor: '#e63946', desc: 'Lanchonete de demonstração.', ate: '2026-11-30', patrocinado: true },
  { id: 'academia-forca-total', nome: 'Academia Força Total', tipo: 'academia', ibge: 3304557, cor: '#e63946', desc: 'Academia de demonstração: musculação, bike e funcional em 2 andares.', ate: '2026-11-30', ig: 'forcatotal.demo', patrocinado: true },
  { id: 'mercado-bom-preco', nome: 'Mercado Bom Preço', tipo: 'mercado', ibge: 3301702, cor: '#2a9d8f', desc: 'Mercado de demonstração: hortifrúti, padaria e ofertas da semana.', ate: '2026-11-30', patrocinado: true },
  { id: 'cell-tech', nome: 'Cell Tech', tipo: 'tech', ibge: 3550308, cor: '#3a86ff', desc: 'Assistência técnica de demonstração: celular, notebook e acessórios.', ate: '2026-11-30', patrocinado: true },
  { id: 'acai-tropical', nome: 'Açaí Tropical', tipo: 'acai', ibge: 1501402, cor: '#8338ec', desc: 'Açaiteria de demonstração.', ate: '2026-11-30', patrocinado: true },
];

export function montarPacote(mor: Morador[], demo: boolean, frases: Record<string, string> = {}, lojas: Loja[] = []): PacoteMundo {
  mor.sort((a, b) => a.ibge - b.ibge || a.entrada - b.entrada);
  const cg = calcularCargos(mor);
  const cidades: PacoteMundo['cidades'] = [];
  let i = 0;
  while (i < mor.length) { const ib = mor[i].ibge; let j = i; while (j < mor.length && mor[j].ibge === ib) j++; cidades.push([ib, i, j - i, i]); i = j; }
  const fim = proximoFechamento();
  return {
    v: 1, demo, geradoEm: new Date().toISOString(),
    temporada: { n: 1, inicio: fim - 7 * 86400_000, fim },
    n: mor.length, cidades,
    u: mor.map((m) => m.h).join('\n'),
    pts: mor.map((m) => m.pts), tot: mor.map((m) => m.tot), cg: cg.join(''), cor: mor.map((m) => m.cor),
    frases, lojas,
  };
}

/* ---------------- CLI ---------------- */
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const mock = process.argv.includes('--mock');
  if (!mock) { console.error('sem --mock: use `npm run server:exportar` (lê do banco). Para demonstração: npm run dados:mock'); process.exit(1); }
  const n = Number(process.argv.find((a) => a.startsWith('--n='))?.slice(4)) || 16000;
  const mor = gerarMock(n);
  const top = [...mor].sort((a, b) => b.pts - a.pts).slice(0, 12);
  const FR = ['bora fazer a cidade crescer!', 'vote em mim pra praça nova', 'aqui é trabalho e diversão', 'quero um parque no centro', 'mais árvores, menos buraco', 'minha rua é a melhor', 'juntos a gente constrói', 'café grátis na praça (virtual)', 'bora bater a meta da semana', 'cidade limpa, gente feliz', 'quero um estádio aqui', 'o futuro é verde'];
  const frases: Record<string, string> = {}; top.forEach((m, k) => (frases[m.h] = FR[k % FR.length]));
  const pac = montarPacote(mor, true, frases, LOJAS_DEMO);
  const dir = resolve(here, '../public/dados'); mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, 'mundo.json'), JSON.stringify(pac));
  console.log(`mundo.json: ${pac.n} moradores (DEMO) em ${pac.cidades.length} cidades · ${(JSON.stringify(pac).length / 1e6).toFixed(2)} MB`);
}
