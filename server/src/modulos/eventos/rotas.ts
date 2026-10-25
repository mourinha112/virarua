/* módulo eventos (Fase 3): agenda, inscrição/participação, catálogo, operação (modo/planejar/aprovar/cancelar)
   e o relógio que enfileira os ciclos do orquestrador (planejador da madrugada, fatos de hora em hora, avanço). */
import type { App } from '../../http/app';
import { exigirLogin, ErroHttp, limite } from '../../http/app';
import { tx, db, auditar } from '../../db/db';
import { config } from '../../config';
import { registrarJob, enfileirar } from '../../jobs/fila';
import { diaJogo, horaJogo, semanaJogo } from '../recompensas/regras';
import { CATALOGO } from './catalogo';
import { agenda, inscrever, desafioEvento, participar } from './participacao';
import { planejar, avancar, consolidarFatos, sincronizarCatalogo, motivoIndisponivel, transitar, configuracao } from './orquestrador';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const corpo = async (c: any) => { try { return (await c.req.json()) || {}; } catch { return {}; } };
const idOk = (id: string) => { if (!UUID.test(id)) throw new ErroHttp(404, 'evento não encontrado'); return id; };

async function exigirOperador(userId: string) {
  const r = (await db().query(`select 1 from admin_roles where user_id = $1 and papel in ('editor_conteudo','admin_tecnico')`, [userId])).rows[0];
  if (!r) throw new ErroHttp(403, 'apenas a operação pode fazer isso');
}

/** relógio: a cada minuto avança estados; enfileira fatos (1/hora), planejador (1/dia, a partir das 3h) e jobs da competição */
export async function tickRelogio(agora = new Date()) {
  const ex = db(); const dia = diaJogo(agora); const hora = agora.toISOString().slice(0, 13);
  await enfileirar(ex, 'eventos.avancar', {}, 'eventos.avancar:' + agora.toISOString().slice(0, 16));
  await enfileirar(ex, 'eventos.fatos', {}, 'eventos.fatos:' + hora);
  if (horaJogo(agora) >= 3) await enfileirar(ex, 'eventos.planejar', { dia }, 'eventos.planejar:' + dia);
  await enfileirar(ex, 'competicao.abrir', {}, 'competicao.abrir:' + semanaJogo(agora));
  await enfileirar(ex, 'competicao.placar', {}, 'competicao.placar:' + hora);
  await enfileirar(ex, 'competicao.apurar', {}, 'competicao.apurar:' + hora);
}

let relogioIniciado = false;
export function registrar(app: App) {
  app.get('/api/eventos', async (c) => {
    const u = c.get('usuario'); const ib = Number(c.req.query('ibge'));
    const lista = await tx((t) => agenda(t, u?.id ?? null, Number.isInteger(ib) && ib > 0 ? ib : null));
    return c.json({ ok: true, pausado: config.kill.eventos, eventos: lista });
  });
  app.get('/api/eventos/catalogo', async (c) => {
    const itens = await tx(async (t) => {
      const out = [];
      for (const d of CATALOGO) { const motivo = await motivoIndisponivel(t, d); out.push({ id: d.id, version: d.version, categoria: d.category, titulo: d.title, motor: d.mechanic.motor, escopo: d.scope, habilitado: !motivo, motivo }); }
      return out;
    });
    return c.json({ ok: true, eventos: itens });
  });
  app.post('/api/eventos/:id/inscrever', limite(30), async (c) => {
    const u = exigirLogin(c); const id = idOk(String(c.req.param('id')));
    return c.json({ ok: true, ...(await tx((t) => inscrever(t, u.id, id))) });
  });
  app.post('/api/eventos/:id/desafio', limite(30), async (c) => {
    const u = exigirLogin(c); const id = idOk(String(c.req.param('id'))); const b = await corpo(c);
    const d: any = await tx((t) => desafioEvento(t, u.id, id, b.acao));
    if (d?.erro) return c.json({ ok: false, erro: d.erro }, 422);
    return c.json({ ok: true, desafio: d });
  });
  app.post('/api/eventos/:id/participar', limite(60), async (c) => {
    const u = exigirLogin(c); const id = idOk(String(c.req.param('id'))); const b = await corpo(c);
    const r: any = await tx((t) => participar(t, u.id, id, b.acao));
    if (r.erro) return c.json({ ok: false, erro: r.erro }, 422);
    return c.json({ ok: true, ...r });
  });

  // ---------- operação (auditada) ----------
  app.get('/api/eventos/admin/estado', async (c) => {
    const u = exigirLogin(c); await exigirOperador(u.id);
    const r = await tx(async (t) => ({
      config: await configuracao(t), kill: config.kill.eventos, ia: !!(config.ia.provedor && config.ia.chave),
      instancias: (await t.query(`select estado, count(*)::int n from event_instances group by estado`)).rows,
      execucoes: (await t.query(`select * from event_planner_runs order by iniciado_em desc limit 10`)).rows,
      propostas: (await t.query(`select id, definicao_id, ibge, inicio, textos from event_instances where estado = 'proposed' order by inicio limit 50`)).rows,
    }));
    return c.json({ ok: true, ...r });
  });
  app.post('/api/eventos/admin/modo', async (c) => {
    const u = exigirLogin(c); await exigirOperador(u.id); const b = await corpo(c);
    if (!['manual', 'assistido', 'automatico'].includes(b.modo)) throw new ErroHttp(400, 'modo inválido');
    await tx(async (t) => { await t.query(`update event_orchestrator_settings set modo = $1, atualizado_em = now() where id = 1`, [b.modo]); await auditar(t, u.id, 'eventos.modo', 'orquestrador', b.motivo || null, { modo: b.modo }); });
    return c.json({ ok: true, modo: b.modo });
  });
  app.post('/api/eventos/admin/planejar', async (c) => {
    const u = exigirLogin(c); await exigirOperador(u.id);
    const r = await planejar();
    await tx((t) => auditar(t, u.id, 'eventos.planejar', 'orquestrador', null, r as any));
    return c.json({ ok: true, resumo: r });
  });
  app.post('/api/eventos/admin/:id/aprovar', async (c) => {
    const u = exigirLogin(c); await exigirOperador(u.id); const id = idOk(String(c.req.param('id')));
    const ok = await tx(async (t) => {
      const a = await transitar(t, id, 'proposed', 'validated', 'aprovado pela operação', u.id);
      const b2 = a && await transitar(t, id, 'validated', 'scheduled', 'agendado pela operação', u.id);
      await auditar(t, u.id, 'eventos.aprovar', id, null);
      return !!b2;
    });
    if (!ok) throw new ErroHttp(409, 'só propostas podem ser aprovadas');
    return c.json({ ok: true });
  });
  app.post('/api/eventos/admin/:id/cancelar', async (c) => {
    const u = exigirLogin(c); await exigirOperador(u.id); const id = idOk(String(c.req.param('id'))); const b = await corpo(c);
    const ok = await tx(async (t) => {
      const i = (await t.query(`select estado from event_instances where id = $1 for update`, [id])).rows[0];
      if (!i) return false;
      const r = await transitar(t, id, i.estado, 'cancelled', String(b.motivo || 'cancelado pela operação').slice(0, 200), u.id).catch(() => false);
      if (r) await auditar(t, u.id, 'eventos.cancelar', id, b.motivo || null);
      return r;
    });
    if (!ok) throw new ErroHttp(409, 'não dá para cancelar neste estado');
    return c.json({ ok: true });
  });

  // ---------- jobs ----------
  registrarJob('eventos.planejar', async () => { await planejar(); });
  registrarJob('eventos.fatos', async () => { await consolidarFatos(); });
  registrarJob('eventos.avancar', async () => { await avancar(); });
  registrarJob('eventos.sincronizar', async () => { await tx((t) => sincronizarCatalogo(t)); });
  registrarJob('eventos.relogio', async () => {
    // reagenda primeiro: se o tick falhar, o relógio não morre
    const prox = new Date(Date.now() + 60_000);
    await enfileirar(db(), 'eventos.relogio', {}, 'eventos.relogio:' + prox.toISOString().slice(0, 16), 60);
    await tickRelogio();
  });
  // inicia o relógio uma vez por processo (fora dos testes; idempotente pela chave do minuto)
  if (!relogioIniciado && config.ambiente !== 'teste') {
    relogioIniciado = true;
    setTimeout(() => { enfileirar(db(), 'eventos.relogio', {}, 'eventos.relogio:' + new Date().toISOString().slice(0, 16)).catch((e) => console.error('[eventos] relógio', e?.message)); }, 0);
  }
}
