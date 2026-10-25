/* módulo social (Fase 2): ruas, convites, destinos/slots, presença, amizade, emotes, reações e lembranças.
   Todas as rotas que mudam estado usam o usuário da sessão (nunca um id do corpo) e passam pelo CSRF do app.

   Ruas
   GET  /api/cidades/:ibge/ruas                 lista (ocupadas/capacidade/status/publica/minha)
   GET  /api/ruas/minha                         detalhe da minha rua
   GET  /api/ruas/:id                           detalhe (moradores, líder, competição, obra, convites, pedidos)
   POST /api/ruas                               criar { nome, emblema?, descricao?, publica?, mudar? }
   POST /api/ruas/:id/entrar                    entrar/mudar para rua pública (lotada → lista de espera)
   POST /api/ruas/:id/pedidos                   pedir entrada em rua privada { frase? }
   POST /api/ruas/pedidos/:pid/aprovar|recusar  quem cuida da rua decide
   POST /api/ruas/:id/espera/sair               sair da lista de espera
   POST /api/ruas/:id/arquivar                  só rua vazia
   Convites
   POST /api/convites                           { tipo: 'rua'|'visita', ruaId?, destinoId?, maxUsos?, validadeHoras?, paraUserId? }
   GET  /api/convites                           meus convites
   GET  /api/convites/:codigo                   prévia (não consome)
   POST /api/convites/:codigo/aceitar           aceitar (rua: muda a casa de rua; visita: libera o destino)
   POST /api/convites/:id/revogar
   Destinos e presença
   GET  /api/cidades/:ibge/destinos             praça, ruas, estabelecimentos/eventos (provedores), minha casa, casas de amigos
   GET  /api/casas/:houseId/destino             destino "visitar casa" (cria sob demanda)
   GET  /api/destinos/:id                       salas e ocupação
   POST /api/destinos/:id/entrar                { instanciaId?, slot? } → slot atômico; cheio → outra sala ou alternativas
   POST /api/destinos/sair
   GET  /api/destinos/salas/:instanciaId        presentes + emotes recentes (?desde=idDoUltimoEmote)
   POST /api/presenca/heartbeat                 { aba?, estado?: 'online'|'away' }
   POST /api/presenca/sair                      limpa presença e slot
   PUT  /api/presenca/preferencia               { invisivel: boolean }
   GET  /api/presenca/:userId                   online | away | offline | invisible
   Amizade
   GET  /api/amigos                             amigos (+estado/lugar), pedidos recebidos/enviados, bloqueados
   POST /api/amigos/pedidos                     { userId? | handle? }
   POST /api/amigos/pedidos/:id/aceitar|recusar
   POST /api/amigos/:userId/remover|bloquear|desbloquear
   Emotes, reações e lembranças
   GET  /api/emotes                             catálogo predefinido
   POST /api/emotes                             { emote, alvoUserId? } na sala atual (limite por usuário)
   POST /api/reacoes                            { alvoTipo: 'casa'|'lembranca', alvoId, emote }
   GET  /api/reacoes/:tipo/:id
   POST /api/chat                               desligado (flag chat_livre)
   GET  /api/lembrancas | POST /api/lembrancas  álbum / guardar este momento */
import type { App } from '../../http/app';
import { exigirLogin, limite, ErroHttp } from '../../http/app';
import { db, q1, tx } from '../../db/db';
import { registrarJob } from '../../jobs/fila';
import { corpo, idValido, exigirCasa } from './comum';
import { listarRuas, detalheRua, criarRua, trocarRua, pedirEntrada, decidirPedido, arquivarRua, sairDaEspera, ruaAtualDaCasa } from './ruas';
import { criarConvite, verConvite, aceitarConvite, revogarConvite, meusConvites } from './convites';
import { destinosDaCidade, garantirDestinoCasa, detalheDestino, entrar, sair, presentes } from './destinos';
import { heartbeat, encerrarPresenca, estadoDe, definirInvisivel, expirarPresencas } from './presenca';
import { listarAmigos, pedirAmizade, responderPedido, removerAmizade, bloquear, desbloquear, resolverUsuario } from './amizades';
import { catalogoEmotes, enviarEmote, emotesDaSala, reagir, contarReacoes, minhasLembrancas, guardarLembranca } from './emotes';

const ibgeValido = (v: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 1000000 || n > 9999999) throw new ErroHttp(404, 'cidade não encontrada'); return n; };

export function registrar(app: App) {
  registrarJob('social.expirar_presencas', async () => { await expirarPresencas(); });

  /* ---------- ruas ---------- */
  app.get('/api/cidades/:ibge/ruas', async (c) => c.json({ ok: true, ...(await listarRuas(ibgeValido(c.req.param('ibge')), c.get('usuario')?.id ?? null, db())) }));
  app.get('/api/ruas/minha', async (c) => {
    const u = exigirLogin(c); const casa = await exigirCasa(u.id, db());
    const atual = await ruaAtualDaCasa(casa.id, db());
    if (!atual) return c.json({ ok: true, rua: null });
    return c.json({ ok: true, ...(await detalheRua(atual.street_id, u.id, db())) });
  });
  app.post('/api/ruas/pedidos/:pid/aprovar', async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('pid'), 'pedido'); return c.json({ ok: true, ...(await tx((t) => decidirPedido(t, u.id, id, true))) }); });
  app.post('/api/ruas/pedidos/:pid/recusar', async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('pid'), 'pedido'); return c.json({ ok: true, ...(await tx((t) => decidirPedido(t, u.id, id, false))) }); });
  app.get('/api/ruas/:id', async (c) => c.json({ ok: true, ...(await detalheRua(idValido(c.req.param('id'), 'rua'), c.get('usuario')?.id ?? null, db())) }));
  app.post('/api/ruas', limite(30), async (c) => { const u = exigirLogin(c); const b = await corpo(c); return c.json({ ok: true, ...(await tx((t) => criarRua(t, u.id, b))) }); });
  app.post('/api/ruas/:id/entrar', limite(30), async (c) => {
    const u = exigirLogin(c); const id = idValido(c.req.param('id'), 'rua');
    const troca = await tx(async (t) => {
      const r = await q1<{ publica: boolean; status: string }>(`select publica, status from virtual_streets where id = $1`, [id], t);
      if (!r || r.status === 'arquivada') throw new ErroHttp(404, 'rua não encontrada');
      if (!r.publica) throw new ErroHttp(403, 'rua privada: peça para entrar ou use um convite');
      return trocarRua(t, u.id, id, 'troca');
    });
    return c.json({ ok: true, troca });
  });
  app.post('/api/ruas/:id/pedidos', limite(20), async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('id'), 'rua'); const b = await corpo(c); return c.json({ ok: true, pedidoId: await tx((t) => pedirEntrada(t, u.id, id, b.frase)) }); });
  app.post('/api/ruas/:id/espera/sair', async (c) => { const u = exigirLogin(c); await sairDaEspera(u.id, idValido(c.req.param('id'), 'rua'), db()); return c.json({ ok: true }); });
  app.post('/api/ruas/:id/arquivar', async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('id'), 'rua'); const b = await corpo(c); return c.json({ ok: true, ...(await tx((t) => arquivarRua(t, u.id, id, typeof b.motivo === 'string' ? b.motivo.slice(0, 200) : undefined))) }); });

  /* ---------- convites ---------- */
  app.post('/api/convites', limite(20), async (c) => { const u = exigirLogin(c); const b = await corpo(c); return c.json({ ok: true, convite: await tx((t) => criarConvite(t, u.id, b)) }); });
  app.get('/api/convites', async (c) => { const u = exigirLogin(c); return c.json({ ok: true, convites: await meusConvites(u.id, db()) }); });
  app.post('/api/convites/:id/revogar', async (c) => { const u = exigirLogin(c); await revogarConvite(u.id, idValido(c.req.param('id'), 'convite'), db()); return c.json({ ok: true }); });
  app.get('/api/convites/:codigo', limite(60), async (c) => c.json({ ok: true, convite: await verConvite(c.req.param('codigo'), c.get('usuario')?.id ?? null, db()) }));
  app.post('/api/convites/:codigo/aceitar', limite(30), async (c) => { const u = exigirLogin(c); const cod = c.req.param('codigo'); return c.json({ ok: true, ...(await tx((t) => aceitarConvite(t, u.id, cod))) }); });

  /* ---------- destinos ---------- */
  app.get('/api/cidades/:ibge/destinos', async (c) => c.json({ ok: true, ...(await destinosDaCidade(ibgeValido(c.req.param('ibge')), c.get('usuario')?.id ?? null)) }));
  app.get('/api/casas/:houseId/destino', async (c) => { const l = await garantirDestinoCasa(idValido(c.req.param('houseId'), 'casa'), db()); return c.json({ ok: true, destino: { id: l.id, tipo: l.tipo, nome: l.nome, ibge: l.ibge } }); });
  app.post('/api/destinos/sair', async (c) => { const u = exigirLogin(c); await sair(u.id); return c.json({ ok: true }); });
  app.get('/api/destinos/salas/:instanciaId', async (c) => {
    const id = idValido(c.req.param('instanciaId'), 'sala'); const viewer = c.get('usuario')?.id ?? null;
    const desde = Math.max(0, Math.floor(Number(c.req.query('desde') || 0)) || 0);
    return c.json({ ok: true, ...(await presentes(id, viewer)), emotes: await emotesDaSala(id, desde, viewer, db()) });
  });
  app.get('/api/destinos/:id', async (c) => c.json({ ok: true, ...(await detalheDestino(idValido(c.req.param('id'), 'lugar'), c.get('usuario')?.id ?? null)) }));
  app.post('/api/destinos/:id/entrar', limite(60), async (c) => {
    const u = exigirLogin(c); const id = idValido(c.req.param('id'), 'lugar'); const b = await corpo(c);
    const instanciaId = typeof b.instanciaId === 'string' ? idValido(b.instanciaId, 'sala') : undefined;
    const slot = b.slot !== undefined && Number.isInteger(b.slot) && (b.slot as number) >= 0 ? (b.slot as number) : undefined;
    const r = await entrar(u.id, id, instanciaId !== undefined && slot !== undefined ? { instanciaId, slot } : {});
    return c.json(r.ok ? r : { ...r, ok: false }, r.ok ? 200 : 409);
  });

  /* ---------- presença ---------- */
  app.post('/api/presenca/heartbeat', limite(240), async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await heartbeat(u.id, await corpo(c))) }); });
  app.post('/api/presenca/sair', async (c) => { const u = exigirLogin(c); await encerrarPresenca(u.id); return c.json({ ok: true }); });
  app.put('/api/presenca/preferencia', async (c) => { const u = exigirLogin(c); const b = await corpo(c); await definirInvisivel(u.id, b.invisivel === true); return c.json({ ok: true, invisivel: b.invisivel === true }); });
  app.get('/api/presenca/:userId', async (c) => { const r = await estadoDe(idValido(c.req.param('userId'), 'pessoa'), c.get('usuario')?.id ?? null); if (!r) throw new ErroHttp(404, 'pessoa não encontrada'); return c.json({ ok: true, ...r }); });

  /* ---------- amizade ---------- */
  app.get('/api/amigos', async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await listarAmigos(u.id, db())) }); });
  app.post('/api/amigos/pedidos', limite(30), async (c) => { const u = exigirLogin(c); const b = await corpo(c); return c.json({ ok: true, ...(await tx(async (t) => pedirAmizade(t, u.id, await resolverUsuario(b, t)))) }); });
  app.post('/api/amigos/pedidos/:id/aceitar', async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('id'), 'pedido'); return c.json({ ok: true, ...(await tx((t) => responderPedido(t, u.id, id, true))) }); });
  app.post('/api/amigos/pedidos/:id/recusar', async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('id'), 'pedido'); return c.json({ ok: true, ...(await tx((t) => responderPedido(t, u.id, id, false))) }); });
  app.post('/api/amigos/:userId/remover', async (c) => { const u = exigirLogin(c); return c.json({ ok: true, removido: await removerAmizade(u.id, idValido(c.req.param('userId'), 'pessoa'), db()) }); });
  app.post('/api/amigos/:userId/bloquear', async (c) => { const u = exigirLogin(c); const id = idValido(c.req.param('userId'), 'pessoa'); await tx((t) => bloquear(t, u.id, id)); return c.json({ ok: true }); });
  app.post('/api/amigos/:userId/desbloquear', async (c) => { const u = exigirLogin(c); await desbloquear(u.id, idValido(c.req.param('userId'), 'pessoa'), db()); return c.json({ ok: true }); });

  /* ---------- emotes, reações, chat, lembranças ---------- */
  app.get('/api/emotes', async (c) => c.json({ ok: true, emotes: await catalogoEmotes(db()) }));
  app.post('/api/emotes', limite(120), async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await enviarEmote(u.id, await corpo(c), db())) }); });
  app.post('/api/reacoes', limite(60), async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await reagir(u.id, await corpo(c), db())) }); });
  app.get('/api/reacoes/:tipo/:id', async (c) => {
    const tipo = c.req.param('tipo'); if (tipo !== 'casa' && tipo !== 'lembranca') throw new ErroHttp(404, 'não encontrado');
    return c.json({ ok: true, ...(await contarReacoes(tipo, idValido(c.req.param('id')), c.get('usuario')?.id ?? null, db())) });
  });
  app.post('/api/chat', async (c) => {
    exigirLogin(c);
    const f = await q1<{ ligada: boolean }>(`select ligada from feature_flags where chave = 'chat_livre'`);
    if (!f?.ligada) throw new ErroHttp(403, 'chat livre desligado: use os emotes e frases prontas');
    throw new ErroHttp(501, 'chat livre exige bloqueio, denúncia, moderação e retenção antes de abrir');
  });
  app.get('/api/lembrancas', async (c) => { const u = exigirLogin(c); return c.json({ ok: true, lembrancas: await minhasLembrancas(u.id, db()) }); });
  app.post('/api/lembrancas', limite(30), async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await guardarLembranca(u.id, await corpo(c), db())) }); });
}
