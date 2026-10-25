/* módulo eleicoes (Fase 4): rotas HTTP, jobs ('eleicoes.ciclo', 'eleicoes.apurar') e relógio do servidor.
   O cliente nunca escolhe eleitor, escopo, peso ou horário efetivo: tudo vem da sessão e do relógio do servidor. */
import type { Context } from 'hono';
import type { App, Vars } from '../../http/app';
import { exigirLogin, limite, ErroHttp } from '../../http/app';
import { db, q1 } from '../../db/db';
import { config } from '../../config';
import { registrarJob, enfileirar } from '../../jobs/fila';
import { regraVigente, resumoRegras, SELO, type Cargo } from './regras';
import { candidatar, retirarCandidatura, apoiar, votar, avancarEleicao, suspenderCandidato, corrigirResultado, publicarRegras } from './dominio';
import { executarAcao, renunciar, vagarPorAdmin } from './cargos';
import { listarParaUsuario, listarPublicas, detalhe, calendario, meuCatalogo } from './consultas';
import { ciclo } from './ciclo';

/** relógio do servidor (injetável nos testes) */
export const relogio = { agora: () => new Date() };
export function usarRelogio(f: (() => Date) | null) { relogio.agora = f || (() => new Date()); }

const CICLO_SEG = 300;
const chaveCiclo = (ms: number) => `eleicoes.ciclo:${Math.floor(ms / (CICLO_SEG * 1000))}`;
let agendado = false;

type C = Context<{ Variables: Vars }>;
const corpo = async (c: C): Promise<Record<string, unknown>> => { try { const j = await c.req.json(); return j && typeof j === 'object' ? j : {}; } catch { return {}; } };

async function exigirFlag() {
  const f = await q1<{ ligada: boolean }>(`select ligada from feature_flags where chave = 'eleicoes'`);
  if (f && !f.ligada) throw new ErroHttp(503, 'eleições virtuais desligadas no momento');
}

export function registrar(app: App) {
  registrarJob('eleicoes.apurar', async (d: { eleicaoId: string }) => { await avancarEleicao(d.eleicaoId, relogio.agora()); });
  registrarJob('eleicoes.ciclo', async () => {
    await ciclo(relogio.agora());
    const prox = (Math.floor(Date.now() / (CICLO_SEG * 1000)) + 1) * CICLO_SEG * 1000;
    await enfileirar(db(), 'eleicoes.ciclo', {}, chaveCiclo(prox), Math.max(1, Math.ceil((prox - Date.now()) / 1000)));
  });
  if (!agendado && config.ambiente !== 'teste') {
    agendado = true; // semente do ciclo (o job se reagenda a cada 5 min; chave por janela evita duplicar entre réplicas)
    setTimeout(() => { enfileirar(db(), 'eleicoes.ciclo', {}, chaveCiclo(Date.now())).catch(() => {}); }, 2000).unref?.();
  }

  // ---- leituras ----
  app.get('/api/eleicoes/calendario', async (c) => {
    await exigirFlag();
    return c.json({ ok: true, ...(await calendario(c.get('usuario')?.id ?? null, relogio.agora())) });
  });
  app.get('/api/eleicoes/regras', async (c) => {
    const rv = await regraVigente(db(), relogio.agora());
    return c.json({ ok: true, regraId: rv.id, regras: resumoRegras(rv.regras), config: rv.regras, selo: SELO, nota: 'mudanças de regra valem a partir da próxima temporada' });
  });
  app.get('/api/eleicoes/cargo/catalogo', async (c) => {
    const u = exigirLogin(c);
    return c.json({ ok: true, ...(await meuCatalogo(u.id, relogio.agora())) });
  });
  app.get('/api/eleicoes', async (c) => {
    await exigirFlag();
    const u = c.get('usuario'), agora = relogio.agora();
    const eleicoes = u ? await listarParaUsuario(u.id, agora) : await listarPublicas(agora);
    return c.json({ ok: true, eleicoes, publico: !u, selo: SELO, agoraServidor: agora.toISOString() });
  });
  app.get('/api/eleicoes/:id', async (c) => {
    await exigirFlag();
    const d = await detalhe((c.req.param('id') || ''), c.get('usuario')?.id ?? null, relogio.agora());
    if (!d) return c.json({ ok: false, erro: 'eleição virtual não encontrada' }, 404);
    return c.json({ ok: true, eleicao: d });
  });

  // ---- poderes do cargo (comandos com catálogo, quota e auditoria) ----
  app.post('/api/eleicoes/cargo/acao', limite(20), async (c) => {
    await exigirFlag(); const u = exigirLogin(c); const b = await corpo(c);
    const r = await executarAcao(u.id, { tipo: b.tipo, opcao: b.opcao, escopoId: b.escopoId }, relogio.agora());
    return c.json({ ok: true, ...r, mensagem: 'escolha registrada no cargo da eleição virtual' });
  });
  app.post('/api/eleicoes/cargo/renuncia', limite(5), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    if (b.confirmar !== true) throw new ErroHttp(400, 'confirme a renúncia ao cargo virtual');
    return c.json({ ok: true, ...(await renunciar(u.id, relogio.agora())), mensagem: 'renúncia registrada: cargo vago até a próxima eleição virtual' });
  });

  // ---- administração (auditada) ----
  app.post('/api/eleicoes/admin/candidatos/:id/suspender', limite(20), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    return c.json({ ok: true, ...(await suspenderCandidato(u.id, (c.req.param('id') || ''), String(b.motivo || ''), relogio.agora())) });
  });
  app.post('/api/eleicoes/admin/mandatos/:id/vacancia', limite(20), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    return c.json({ ok: true, ...(await vagarPorAdmin(u.id, (c.req.param('id') || ''), String(b.motivo || ''), relogio.agora())) });
  });
  app.post('/api/eleicoes/admin/regras', limite(10), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    return c.json({ ok: true, ...(await publicarRegras(u.id, b.regras, String(b.motivo || ''), relogio.agora())) });
  });
  app.post('/api/eleicoes/admin/:id/correcao', limite(10), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    return c.json({ ok: true, ...(await corrigirResultado(u.id, (c.req.param('id') || ''), { vencedorUserId: b.vencedorUserId, motivo: b.motivo }, relogio.agora())) });
  });

  // ---- participação ----
  app.post('/api/eleicoes/:id/candidatura', limite(10), async (c) => {
    await exigirFlag(); const u = exigirLogin(c); const b = await corpo(c);
    if (b.confirmar !== true) throw new ErroHttp(400, 'confirme a intenção de concorrer nesta eleição virtual');
    const r = await candidatar(u.id, (c.req.param('id') || ''), { cargo: b.cargo as Cargo, trocar: b.trocar }, relogio.agora());
    return c.json({ ok: true, ...r, mensagem: r.jaInscrito ? 'você já está inscrito nesta eleição virtual' : 'candidatura registrada na eleição virtual' });
  });
  app.post('/api/eleicoes/:id/candidatura/retirar', limite(10), async (c) => {
    await exigirFlag(); const u = exigirLogin(c);
    return c.json({ ok: true, ...(await retirarCandidatura(u.id, (c.req.param('id') || ''), relogio.agora())), mensagem: 'candidatura retirada da eleição virtual' });
  });
  app.post('/api/eleicoes/:id/apoio', limite(20), async (c) => {
    await exigirFlag(); const u = exigirLogin(c); const b = await corpo(c);
    return c.json({ ok: true, ...(await apoiar(u.id, (c.req.param('id') || ''), b.candidato, relogio.agora())), mensagem: 'apoio registrado (apoio não é voto)' });
  });
  app.post('/api/eleicoes/:id/voto', limite(30), async (c) => {
    await exigirFlag(); const u = exigirLogin(c); const b = await corpo(c);
    const r = await votar(u.id, (c.req.param('id') || ''), b.candidato, relogio.agora());
    return c.json({ ok: true, ...r, mensagem: r.trocou ? 'voto trocado na eleição virtual (continua valendo 1)' : 'voto registrado na eleição virtual (pode trocar até o fechamento)' });
  });
}
