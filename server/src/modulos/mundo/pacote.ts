/* Pacote do mapa montado do BANCO (produção): casas reivindicadas/reservadas + lojas patrocinadas vigentes.
   Uma casa criada por comentário no Instagram aparece aqui no próximo ciclo do cache (lote = plots.lote_index,
   a mesma posição usada pela empresa do dono e pelo avatar). Sem casas → mapa vazio (lançamento do zero). */
import type { App } from '../../http/app';
import { q } from '../../db/db';
import { montarPacote, type Morador } from '../../../../scripts/build-dados';
import { lojasParaMapa } from '../estabelecimentos/exportar';
import { proximoFechamento } from '../../../../src/jogo/regras';

const TTL_MS = 30_000;
let cache: { em: number; json: string } | null = null;

function corDe(id: string, cfg: any) {
  if (Number.isInteger(cfg?.cor)) return cfg.cor;
  let h = 0; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 10) * 10 + ((h >>> 8) % 8);
}

export async function pacoteDoBanco() {
  const ini = new Date(proximoFechamento() - 7 * 86400_000).toISOString();
  const rows = await q<any>(
    `select h.id, h.config, p.ibge, p.lote_index, coalesce(ei.username, '') handle,
            coalesce(sum(r.quantidade) filter (where r.sistema = 'xp' and r.criado_em >= $1), 0)::int pts,
            coalesce(sum(r.quantidade) filter (where r.sistema = 'xp'), 0)::int tot,
            (select case when bool_or(ot.cargo = 'presidente') then 'P' when bool_or(ot.cargo = 'prefeito') then 'M' end
               from office_terms ot where ot.user_id = h.dono_user_id and ot.estado = 'ativo' and now() between ot.inicio and ot.fim) eleito
       from houses h
       join plots p on p.id = h.plot_id
       left join external_identities ei on ei.id = h.dono_identity_id and ei.revogado_em is null
       left join reward_ledger r on r.user_id = h.dono_user_id and h.dono_user_id is not null
      where h.status in ('reivindicada', 'reservada')
      group by h.id, p.ibge, p.lote_index, ei.username`, [ini]);
  const mor: Morador[] = rows.filter((r) => r.handle).map((r) => ({ h: r.handle, ibge: r.ibge, pts: r.pts, tot: r.tot, cor: corDe(r.id, r.config), entrada: r.lote_index, eleito: r.eleito || undefined }));
  // presidente e prefeito do mapa = mandato da eleição virtual (sem voto não tem palácio)
  return montarPacote(mor, false, {}, await lojasParaMapa(), true);
}

export function registrarPacote(app: App) {
  app.get('/api/mundo/pacote', async (c) => {
    if (!cache || Date.now() - cache.em > TTL_MS) cache = { em: Date.now(), json: JSON.stringify(await pacoteDoBanco()) };
    c.header('cache-control', 'public, max-age=15');
    return c.body(cache.json, 200, { 'content-type': 'application/json; charset=utf-8' });
  });
}
