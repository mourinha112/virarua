/* Integração entre frentes, registrada depois de todos os módulos:
   - provedores da rua (Fase 2) alimentados por eleições (Fase 4), recompensas (Fase 3) e estabelecimentos (Fase 5);
   - job do painel admin "cidade escolhida" → provisionamento da Fase 1 (mesmo gerador, mesma idempotência). */
import { registrarProvedor } from './social/provedores';
import { mandatoVigente } from './eleicoes/cargos';
import { competicaoDaRua } from './recompensas/competicao';
import { obraParaUI } from './recompensas/obras';
import { VIGENTE } from './estabelecimentos/servico';
import { JOB_CIDADE_ESCOLHIDA } from './admin/rotas';
import { provisionar } from './mundo/provisionar';
import { enfileirarPrivateReply } from './instagram/processar';
import { registrarJob } from '../jobs/fila';
import { q, q1, tx } from '../db/db';

let feito = false;
export function registrarIntegracao() {
  if (feito) return; feito = true;

  registrarProvedor('liderDaRua', async (streetId, ex) => {
    const t = await mandatoVigente(ex, 'lider' as any, streetId, new Date());
    if (!t) return null;
    const h = await q1<{ username: string | null }>(`select username from external_identities where user_id = $1 and revogado_em is null limit 1`, [t.user_id], ex);
    return { userId: t.user_id, handle: h?.username ?? null, desde: new Date(t.inicio).toISOString(), ate: t.fim ? new Date(t.fim).toISOString() : null };
  });
  registrarProvedor('podeModerarRua', async (streetId, userId, ex) => {
    const t = await mandatoVigente(ex, 'lider' as any, streetId, new Date());
    return !!t && t.user_id === userId;
  });
  registrarProvedor('competicaoDaRua', async (streetId, ex) => {
    const r: any = await competicaoDaRua(ex, streetId, null);
    const e = r.entrada;
    return {
      disponivel: true, temporada: String(r.temporada?.semana ?? r.temporada?.id ?? ''),
      posicao: e?.colocacao_final ?? (r.ranking ? r.ranking.find((x: any) => x.street_id === streetId)?.colocacao_atual ?? null : null),
      pontos: e?.pontos ?? 0, modo: e?.modo === 'competitivo' ? 'competitiva' : 'cooperativa',
      fechaEm: r.temporada?.fim ? new Date(r.temporada.fim).toISOString() : '', detalhes: r,
    };
  });
  registrarProvedor('obraDaRua', async (streetId, ex) => {
    const o: any = await obraParaUI(ex, streetId, null);
    return { disponivel: true, nome: o.titulo, progresso: o.progresso, meta: o.meta, estado: o.status, detalhes: o };
  });
  registrarProvedor('destinosDaCidade', async (ibge, ex) => {
    const vs = await q<{ id: string; nome: string; categoria: string }>(`select v.id, v.nome, v.categoria from venues v where v.ibge = $1 and v.categoria <> 'bar' and ${VIGENTE}`, [ibge], ex);
    return vs.map((v) => ({ tipo: 'venue' as const, refId: v.id, nome: v.nome, capacidade: 12, patrocinado: true, detalhes: { categoria: v.categoria } }));
  });

  // painel admin escolheu a cidade de um comentário pendente → provisiona pelo mesmo serviço da Fase 1
  registrarJob(JOB_CIDADE_ESCOLHIDA, async (d: { identityId: string; ibge: number }) => {
    await tx(async (c) => {
      const idt = await q1<{ escopo: string; external_id: string; username: string | null; provedor: string }>(`select escopo, external_id, username, provedor from external_identities where id = $1`, [d.identityId], c);
      if (!idt) throw new Error('identidade não encontrada');
      const r = await provisionar(c, { escopo: idt.escopo, externalId: idt.external_id, username: idt.username, ibge: d.ibge, origem: 'admin', provedor: idt.provedor });
      if (r.resultado === 'provisioned') {
        const com = await q1<{ comment_id: string }>(`select comment_id from instagram_comments where identity_id = $1 order by recebido_em desc limit 1`, [d.identityId], c);
        if (com) await enfileirarPrivateReply(c, d.identityId, com.comment_id);
      }
    });
  });
}
