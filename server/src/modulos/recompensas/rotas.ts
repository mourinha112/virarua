/* módulo recompensas (Fase 3): missões diárias, obra comunitária, competição de ruas e ledger.
   Nenhuma rota aceita pontos do cliente: o corpo traz só a prova (id do desafio + resposta). */
import type { App } from '../../http/app';
import { exigirLogin, ErroHttp, limite } from '../../http/app';
import { tx, db } from '../../db/db';
import { registrarJob } from '../../jobs/fila';
import { missoesDoDia, desafioMissao, concluirMissao } from './missoes';
import { obraParaUI, moradia } from './obras';
import { competicaoDaRua, garantirTemporada, recalcularLideres, apurarTemporada } from './competicao';
import { resumoUsuario } from './ledger';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MISSAO = /^[a-z]+\.[a-z]+$/;
const corpo = async (c: any) => { try { return (await c.req.json()) || {}; } catch { return {}; } };

async function ruaExiste(id: string) {
  if (!UUID.test(id)) throw new ErroHttp(404, 'rua não encontrada');
  const r = (await db().query(`select id, nome, ibge from virtual_streets where id = $1`, [id])).rows[0];
  if (!r) throw new ErroHttp(404, 'rua não encontrada');
  return r;
}

export function registrar(app: App) {
  app.get('/api/missoes', async (c) => {
    const u = exigirLogin(c);
    return c.json({ ok: true, ...(await tx((t) => missoesDoDia(t, u.id))) });
  });
  app.post('/api/missoes/:id/desafio', limite(30), async (c) => {
    const u = exigirLogin(c); const id = String(c.req.param('id')); if (!MISSAO.test(id)) throw new ErroHttp(404, 'missão não encontrada');
    return c.json({ ok: true, desafio: await tx((t) => desafioMissao(t, u.id, id)) });
  });
  app.post('/api/missoes/:id/concluir', limite(30), async (c) => {
    const u = exigirLogin(c); const id = String(c.req.param('id')); if (!MISSAO.test(id)) throw new ErroHttp(404, 'missão não encontrada');
    const b = await corpo(c);
    // só a prova é lida do corpo; qualquer "pontos"/"xp" enviado é ignorado
    const r: any = await tx((t) => concluirMissao(t, u.id, id, { desafio_id: b.desafio_id, resposta: b.resposta }));
    if (r.erro) return c.json({ ok: false, erro: r.erro }, 422);
    return c.json({ ok: true, ...r });
  });
  app.get('/api/recompensas/eu', async (c) => {
    const u = exigirLogin(c);
    return c.json({ ok: true, resumo: await resumoUsuario(db(), u.id) });
  });

  app.get('/api/ruas/:id/competicao', async (c) => {
    const rua = await ruaExiste(String(c.req.param('id')));
    const u = c.get('usuario');
    return c.json({ ok: true, rua: { id: rua.id, nome: rua.nome }, ...(await tx((t) => competicaoDaRua(t, rua.id, u?.id ?? null))) });
  });
  app.get('/api/ruas/:id/obra', async (c) => {
    const rua = await ruaExiste(String(c.req.param('id')));
    const u = c.get('usuario');
    return c.json({ ok: true, rua: { id: rua.id, nome: rua.nome }, obra: await tx((t) => obraParaUI(t, rua.id, u?.id ?? null)) });
  });
  /** etapa interativa da obra = missão 'obra.etapa' na rua do próprio morador */
  app.post('/api/ruas/:id/obra/desafio', limite(30), async (c) => {
    const u = exigirLogin(c); const rua = await ruaExiste(String(c.req.param('id')));
    return c.json({ ok: true, desafio: await tx(async (t) => {
      const mor = await moradia(t, u.id); if (mor?.streetId !== rua.id) throw new ErroHttp(403, 'só moradores da rua ajudam a obra');
      return desafioMissao(t, u.id, 'obra.etapa');
    }) });
  });
  app.post('/api/ruas/:id/obra', limite(30), async (c) => {
    const u = exigirLogin(c); const rua = await ruaExiste(String(c.req.param('id'))); const b = await corpo(c);
    const r: any = await tx(async (t) => {
      const mor = await moradia(t, u.id); if (mor?.streetId !== rua.id) throw new ErroHttp(403, 'só moradores da rua ajudam a obra');
      const m = await concluirMissao(t, u.id, 'obra.etapa', { desafio_id: b.desafio_id, resposta: b.resposta });
      return { ...m, obra_atual: 'erro' in m ? undefined : await obraParaUI(t, rua.id, u.id) };
    });
    if (r.erro) return c.json({ ok: false, erro: r.erro }, 422);
    return c.json({ ok: true, ...r });
  });

  // jobs da competição (enfileirados pelo relógio do módulo eventos; idempotentes)
  registrarJob('competicao.abrir', async () => { await tx((t) => garantirTemporada(t)); });
  registrarJob('competicao.placar', async () => {
    const s = await tx((t) => garantirTemporada(t));
    await tx((t) => recalcularLideres(t, s.id));
  });
  registrarJob('competicao.apurar', async () => {
    const abertas = (await db().query(`select id from competition_seasons where estado = 'aberta' and fim <= now()`)).rows;
    for (const s of abertas) await tx((t) => apurarTemporada(t, s.id));
  });
}
