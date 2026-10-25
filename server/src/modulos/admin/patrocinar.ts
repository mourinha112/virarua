/* Cadastro de loja patrocinada pela CLI, a partir de um arquivo JSON (deploy/lojas/*.json).
   Cria ou atualiza o estabelecimento (já verificado pelo operador), os links e um patrocínio ATIVO por N dias.
   Idempotente pelo slug: rodar de novo atualiza os dados e só cria patrocínio novo se não houver um vigente. */
import { readFileSync } from 'node:fs';
import { q, q1, tx, auditar } from '../../db/db';

export type FichaLoja = {
  slug: string; nome: string; categoria: 'cafeteria' | 'restaurante' | 'loja' | 'pet' | 'eventos';
  ibge: number; descricao: string; cor: string;
  endereco?: string; horario?: string; telefone?: string;
  logo?: { arquivo: string; licenca: string; declarado_por: string };
  links?: { tipo: 'site' | 'instagram' | 'whatsapp' | 'cardapio' | 'mapa'; url: string; rotulo: string }[];
  dias: number; contrato: string;
};

export async function patrocinarDeArquivo(caminho: string) {
  const f = JSON.parse(readFileSync(caminho, 'utf8')) as FichaLoja;
  if (!/^[a-z0-9-]{3,60}$/.test(f.slug)) throw new Error('slug inválido');
  if (!/^#[0-9a-f]{6}$/.test(f.cor)) throw new Error('cor deve ser #rrggbb minúsculo');
  if (!(f.dias >= 1 && f.dias <= 365)) throw new Error('dias entre 1 e 365');
  const tel = f.telefone ? f.telefone.replace(/\D/g, '') : null;
  if (tel && !/^[0-9]{10,13}$/.test(tel)) throw new Error('telefone: 10 a 13 dígitos');
  return tx(async (c) => {
    const m = await q1<{ nome: string; uf: string }>(`select nome, uf from municipios where ibge = $1`, [f.ibge], c);
    if (!m) throw new Error('município não encontrado: ' + f.ibge);
    const v = (await q1<{ id: string }>(
      `insert into venues (slug, nome, categoria, ibge, descricao, cor, endereco_comercial, horario, contato_telefone,
                           logo_ref, logo_licenca, logo_declarado_por, logo_declarado_em, verificacao, verificado_em, nota_verificacao)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, case when $10::text is null then null else now() end, 'verificado', now(), 'cadastro do operador (CLI)')
       on conflict (slug) do update set nome = excluded.nome, categoria = excluded.categoria, ibge = excluded.ibge, descricao = excluded.descricao,
         cor = excluded.cor, endereco_comercial = excluded.endereco_comercial, horario = excluded.horario, contato_telefone = excluded.contato_telefone,
         logo_ref = excluded.logo_ref, logo_licenca = excluded.logo_licenca, logo_declarado_por = excluded.logo_declarado_por,
         logo_declarado_em = excluded.logo_declarado_em, verificacao = 'verificado', atualizado_em = now()
       returning id`,
      [f.slug, f.nome, f.categoria, f.ibge, f.descricao.slice(0, 280), f.cor, f.endereco || null, f.horario || null, tel,
       f.logo?.arquivo || null, f.logo?.licenca || null, f.logo?.declarado_por || null], c))!;
    for (const l of f.links || []) {
      const u = new URL(l.url); if (u.protocol !== 'https:') throw new Error('link precisa ser https: ' + l.url);
      await q(`insert into venue_links (venue_id, tipo, url, dominio, rotulo) values ($1,$2,$3,$4,$5)
               on conflict (venue_id, url) do update set tipo = excluded.tipo, rotulo = excluded.rotulo, ativo = true`,
        [v.id, l.tipo, u.toString(), u.hostname.replace(/^www\./, ''), l.rotulo], c);
    }
    const hoje = `(now() at time zone 'America/Sao_Paulo')::date`;
    const vig = await q1<{ fim: string }>(`select fim::text from sponsorships where venue_id = $1 and status = 'ativo' and ${hoje} between inicio and fim order by fim desc limit 1`, [v.id], c);
    let fim = vig?.fim;
    if (!vig) {
      fim = (await q1<{ fim: string }>(
        `insert into sponsorships (venue_id, modalidade, beneficios, contrato_ref, status, inicio, fim, aprovado_em, observacao)
         values ($1, 'presenca', array['presenca_mapa'], $2, 'ativo', ${hoje}, ${hoje} + ($3::int - 1), now(), 'CLI patrocinar')
         returning fim::text`, [v.id, f.contrato, f.dias], c))!.fim;
    }
    await auditar(c, null, 'estabelecimento.patrocinar_cli', 'venue:' + v.id, f.contrato, { slug: f.slug, dias: f.dias });
    return { id: v.id, cidade: `${m.nome} - ${m.uf}`, fim: fim!, novo: !vig };
  });
}
