/* Exportação dos estabelecimentos vigentes para o pacote estático do mapa (public/dados/mundo.json → PacoteMundo.lojas).
   Uso no build do mundo: `const lojas = await lojasParaMapa();` (server/src/build/exportar.ts, frente de integração).
   Regras:
   - só verificado + patrocínio ATIVO dentro da vigência (data de São Paulo);
   - o pacote é público e estático (não sabe a idade de quem vê): bar/álcool NUNCA vai para ele;
   - demonstração só entra com { incluirDemo: true } (pacote demo); o pacote de produção nunca leva demo;
   - ig/site só de links ativos que ainda passam na allowlist atual;
   - patrocinado: true sempre (o mapa mostra o selo). */
import type { Loja } from '../../../../src/dados/formato';
import { q, type Exec } from '../../db/db';
import { TIPO_MAPA, validarUrlExterna, type Categoria } from './regras';
import { HOJE, VIGENTE, dominiosPermitidos, flagLigada } from './servico';

export async function lojasParaMapa(opts: { incluirDemo?: boolean; ex?: Exec } = {}): Promise<Loja[]> {
  const ex = opts.ex;
  if (!(await flagLigada('estabelecimentos', ex))) return [];
  const rows = await q<any>(
    `select v.id, v.nome, v.categoria, v.ibge, v.cor, v.descricao, v.logo_ref, v.endereco_comercial, v.horario, v.contato_telefone,
            (select max(s.fim) from sponsorships s where s.venue_id = v.id and s.status = 'ativo' and ${HOJE} between s.inicio and s.fim)::text ate
       from venues v
      where ${VIGENTE} and v.categoria <> 'bar' and not v.alcool and ($1 or not v.demo)
      order by v.ibge, v.nome`, [!!opts.incluirDemo], ex);
  if (!rows.length) return [];
  const links = await q<{ venue_id: string; tipo: string; url: string }>(`select venue_id, tipo, url from venue_links where ativo and venue_id = any($1) and tipo in ('instagram','site') order by criado_em`, [rows.map((r) => r.id)], ex);
  const allow = await dominiosPermitidos(ex);
  return rows.map((r) => {
    const l: Loja = { id: r.id, nome: r.nome, tipo: TIPO_MAPA[r.categoria as Categoria] || 'loja', ibge: r.ibge, cor: r.cor, desc: r.descricao || '', ate: r.ate, patrocinado: true };
    if (r.logo_ref && /^[a-z0-9-]+\.(png|webp|jpg)$/.test(r.logo_ref)) l.logo = '/logos/' + r.logo_ref;
    if (r.endereco_comercial) l.end = r.endereco_comercial;
    if (r.horario) l.hor = r.horario;
    if (r.contato_telefone) l.zap = r.contato_telefone.length <= 11 ? '55' + r.contato_telefone : r.contato_telefone;
    for (const k of links.filter((x) => x.venue_id === r.id)) {
      const v = validarUrlExterna(k.url, allow); if (!v.ok) continue;
      if (k.tipo === 'instagram' && !l.ig) { const m = new URL(v.url).pathname.match(/^\/([a-z0-9._]{1,30})\/?$/i); if (m) l.ig = m[1].toLowerCase(); }
      if (k.tipo === 'site' && !l.site) l.site = v.url;
    }
    return l;
  });
}
