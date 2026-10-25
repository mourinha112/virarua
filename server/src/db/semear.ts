/* Semente idempotente: municípios (IBGE, mesma projeção do mapa) e catálogo inicial de avatar. */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, type Tx } from './db';

const here = dirname(fileURLToPath(import.meta.url));
export const normNome = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export const AVATAR_CATALOGO: [string, string, string][] = [
  ['pele.1', 'pele', 'tom 1'], ['pele.2', 'pele', 'tom 2'], ['pele.3', 'pele', 'tom 3'], ['pele.4', 'pele', 'tom 4'], ['pele.5', 'pele', 'tom 5'], ['pele.6', 'pele', 'tom 6'],
  ['cabelo.curto', 'cabelo', 'curto'], ['cabelo.longo', 'cabelo', 'longo'], ['cabelo.cacheado', 'cabelo', 'cacheado'], ['cabelo.crespo', 'cabelo', 'crespo'], ['cabelo.raspado', 'cabelo', 'raspado'], ['cabelo.coque', 'cabelo', 'coque'], ['cabelo.trancas', 'cabelo', 'tranças'],
  ['cor_cabelo.preto', 'cor_cabelo', 'preto'], ['cor_cabelo.castanho', 'cor_cabelo', 'castanho'], ['cor_cabelo.loiro', 'cor_cabelo', 'loiro'], ['cor_cabelo.ruivo', 'cor_cabelo', 'ruivo'], ['cor_cabelo.colorido', 'cor_cabelo', 'colorido'],
  ['roupa.camiseta', 'roupa', 'camiseta'], ['roupa.moletom', 'roupa', 'moletom'], ['roupa.vestido', 'roupa', 'vestido'], ['roupa.camisa', 'roupa', 'camisa'], ['roupa.regata', 'roupa', 'regata'],
  ['cor_roupa.amarelo', 'cor_roupa', 'amarelo'], ['cor_roupa.azul', 'cor_roupa', 'azul'], ['cor_roupa.verde', 'cor_roupa', 'verde'], ['cor_roupa.vermelho', 'cor_roupa', 'vermelho'], ['cor_roupa.preto', 'cor_roupa', 'preto'], ['cor_roupa.branco', 'cor_roupa', 'branco'],
  ['acessorio.nenhum', 'acessorio', 'nenhum'], ['acessorio.bone', 'acessorio', 'boné'], ['acessorio.oculos', 'acessorio', 'óculos'], ['acessorio.fone', 'acessorio', 'fone'],
  ['calcado.tenis', 'calcado', 'tênis'], ['calcado.chinelo', 'calcado', 'chinelo'], ['calcado.bota', 'calcado', 'bota'],
];
export const AVATAR_PADRAO = { pele: 'pele.3', cabelo: 'cabelo.curto', cor_cabelo: 'cor_cabelo.castanho', roupa: 'roupa.camiseta', cor_roupa: 'cor_roupa.amarelo', acessorio: 'acessorio.nenhum', calcado: 'calcado.tenis' };

export async function semear(c?: Tx) {
  const fazer = async (t: Tx) => {
    const muns: [number, string, string, number, number, number, number][] = JSON.parse(readFileSync(resolve(here, '../../../src/data/municipios.json'), 'utf8'));
    const n = (await t.query('select count(*)::int n from municipios')).rows[0].n;
    if (n < muns.length) {
      for (let i = 0; i < muns.length; i += 500) {
        const lote = muns.slice(i, i + 500); const vals: unknown[] = []; const ph: string[] = [];
        lote.forEach((m, k) => { ph.push(`($${k * 7 + 1},$${k * 7 + 2},$${k * 7 + 3},$${k * 7 + 4},$${k * 7 + 5},$${k * 7 + 6},$${k * 7 + 7})`); vals.push(m[0], m[1], m[2], m[5], m[3], m[4], normNome(m[1])); });
        await t.query(`insert into municipios (ibge, nome, uf, pop, x, y, nome_norm) values ${ph.join(',')} on conflict (ibge) do nothing`, vals);
      }
    }
    for (const [id, slot, nome] of AVATAR_CATALOGO) await t.query(`insert into avatar_catalog (item_id, slot, nome) values ($1,$2,$3) on conflict (item_id) do nothing`, [id, slot, nome]);
    // aliases revisados mais comuns (exemplos; o painel adiciona outros)
    for (const [alias, uf, ibge] of [['caxias', 'RJ', 3301702], ['duque de caxias', 'RJ', 3301702], ['sampa', 'SP', 3550308], ['bh', 'MG', 3106200], ['rio', 'RJ', 3304557], ['poa', 'RS', 4314902]] as const)
      await t.query(`insert into municipio_aliases (alias_norm, uf, ibge) values ($1,$2,$3) on conflict do nothing`, [alias, uf, ibge]);
  };
  if (c) await fazer(c); else await tx(fazer);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) semear().then(() => { console.log('semente ok'); process.exit(0); }, (e) => { console.error(e); process.exit(1); });
