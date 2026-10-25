/* Notificações: ouvintes da outbox transformam fatos em avisos para quem importa (moradores da rua/cidade do fato).
   Idempotente por (usuário, chave). Pessoa pode silenciar tipos. Rotas: listar, marcar lidas, preferências. */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp } from '../http/app';
import { q, type Exec, db } from '../db/db';
import { aoEvento } from '../jobs/fila';

export async function notificar(ex: Exec, userIds: string[], n: { tipo: string; titulo: string; texto: string; acao?: string; chave: string }) {
  if (!userIds.length) return;
  await ex.query(
    `insert into notifications (user_id, tipo, titulo, texto, acao, chave)
     select u, $2, $3, $4, $5, $6 from unnest($1::uuid[]) u
      where not exists (select 1 from notification_prefs p where p.user_id = u and $2 = any(p.silenciar))
     on conflict (user_id, chave) do nothing`, [userIds, n.tipo, n.titulo, n.texto, n.acao ?? null, n.chave]);
}
const moradoresDaRua = async (streetId: string) => (await q<{ id: string }>(`select h.dono_user_id id from street_memberships sm join houses h on h.id = sm.house_id where sm.street_id = $1 and sm.saiu_em is null and h.status = 'reivindicada' and h.dono_user_id is not null`, [streetId])).map((r) => r.id);
const moradoresDaCidade = async (ibge: number) => (await q<{ id: string }>(`select h.dono_user_id id from houses h join plots p on p.id = h.plot_id where p.ibge = $1 and h.status = 'reivindicada' and h.dono_user_id is not null limit 5000`, [ibge])).map((r) => r.id);
const handle = async (userId: string) => (await q<{ u: string }>(`select coalesce(username, '') u from external_identities where user_id = $1 and revogado_em is null limit 1`, [userId]))[0]?.u || 'morador';

let feito = false;
export function registrarNotificacoes(app: App) {
  if (!feito) {
    feito = true;
    aoEvento('mandato.posse', async (d) => {
      const h = await handle(d.userId);
      if (d.cargo === 'lider') await notificar(db(), await moradoresDaRua(d.escopoId), { tipo: 'eleicao', titulo: 'sua rua elegeu um líder', texto: `@${h} é o novo líder da rua (eleição virtual).`, acao: 'ruas', chave: 'posse:' + d.termoId });
      else if (d.cargo === 'prefeito') await notificar(db(), await moradoresDaCidade(Number(d.escopoId)), { tipo: 'eleicao', titulo: 'sua cidade tem prefeito virtual', texto: `@${h} assumiu a prefeitura virtual de ${d.escopoNome}.`, acao: 'eleicoes', chave: 'posse:' + d.termoId });
      await notificar(db(), [d.userId], { tipo: 'eleicao', titulo: 'você venceu! 🎉', texto: `você assumiu o cargo de ${d.cargo} (eleição virtual). Escolha a primeira ação do mandato.`, acao: 'eleicoes', chave: 'posse-eu:' + d.termoId });
    });
    aoEvento('eleicao.votacao_aberta', async (d) => {
      if (d.cargo !== 'lider' || !d.escopoId) return;
      await notificar(db(), await moradoresDaRua(d.escopoId), { tipo: 'eleicao', titulo: 'votação aberta na sua rua', texto: 'a eleição virtual de líder da rua começou. Seu voto vale 1, pode trocar até domingo 20h.', acao: 'casa', chave: 'votacao:' + (d.eleicaoId || d.id) });
    });
    aoEvento('obra.concluida', async (d) => {
      await notificar(db(), await moradoresDaRua(d.street_id), { tipo: 'obra', titulo: 'a obra da sua rua ficou pronta 🏗️', texto: `${d.titulo} foi inaugurada. Obrigado a quem ajudou!`, acao: 'ruas', chave: 'obra:' + d.project_id });
    });
    aoEvento('obra.etapa_concluida', async (d) => {
      await notificar(db(), await moradoresDaRua(d.street_id), { tipo: 'obra', titulo: 'a obra avançou', texto: `etapa "${d.nome}" concluída na sua rua.`, acao: 'ruas', chave: `obra:${d.project_id}:${d.etapa}` });
    });
    aoEvento('competicao.apurada', async (d) => {
      for (const x of (d.campeas || []) as any[]) { const s = typeof x === 'string' ? x : x.street_id || x.streetId; if (!s) continue; await notificar(db(), await moradoresDaRua(s), { tipo: 'rua', titulo: 'sua rua é campeã! 🏆', texto: 'a rua venceu a competição da semana e ganhou troféu e faixa.', acao: 'ruas', chave: `campea:${d.seasonId || d.season_id}:${s}` }); }
    });
  }

  app.get('/api/notificacoes', async (c) => {
    const u = exigirLogin(c);
    const itens = await q(`select id, tipo, titulo, texto, acao, criado_em, lida_em is not null lida from notifications where user_id = $1 order by id desc limit 40`, [u.id]);
    const nao = (await q<{ n: number }>(`select count(*)::int n from notifications where user_id = $1 and lida_em is null`, [u.id]))[0].n;
    return c.json({ ok: true, naoLidas: nao, itens });
  });
  app.post('/api/notificacoes/lidas', async (c) => { const u = exigirLogin(c); await q(`update notifications set lida_em = now() where user_id = $1 and lida_em is null`, [u.id]); return c.json({ ok: true }); });
  app.put('/api/notificacoes/preferencias', async (c) => {
    const u = exigirLogin(c); const b = await c.req.json().catch(() => ({} as any));
    const s = Array.isArray(b.silenciar) ? b.silenciar.filter((x: unknown) => typeof x === 'string' && ['eleicao', 'obra', 'rua', 'trabalho'].includes(x as string)) : null;
    if (!s) throw new ErroHttp(400, 'silenciar deve ser uma lista');
    await q(`insert into notification_prefs (user_id, silenciar) values ($1, $2) on conflict (user_id) do update set silenciar = excluded.silenciar, atualizado_em = now()`, [u.id, s]);
    return c.json({ ok: true, silenciar: s });
  });
}
