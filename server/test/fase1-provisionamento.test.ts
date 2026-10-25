/* Fase 1 · processamento do comentário e provisionamento idempotente (capítulo 18). Fluxo real: webhook assinado → fila → banco. */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q, q1, tx } from '../src/db/db';
import { config } from '../src/config';
import { payloadComentario, postarWebhook, habilitarMidia, novoId, drenar, MIDIA, CONTA } from './fase1-meta';
import { processarComentario, enviarPrivateReply } from '../src/modulos/instagram/processar';
import { definirProvedor, ProvedorOficial, salvarConexao, aoEnvioDev } from '../src/modulos/instagram/provedor';
import { expirarReservas } from '../src/modulos/mundo/provisionar';
import { rodarFila } from '../src/jobs/fila';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);
afterEach(() => { definirProvedor(null); vi.unstubAllGlobals(); });

const n = async (sql: string, p: unknown[] = []) => (await q1<{ n: number }>(`select count(*)::int n from ${sql}`, p))!.n;
const idDe = (autor: string) => q1<{ id: string; username: string | null }>(`select id, username from external_identities where provedor = 'instagram' and escopo = $1 and external_id = $2`, [CONTA(), autor]);
const casasDe = (identityId: string) => q<{ id: string; status: string; ibge: number; lote_index: number; plot_id: string }>(
  `select h.id, h.status, p.ibge, p.lote_index, h.plot_id from houses h join plots p on p.id = h.plot_id where h.dono_identity_id = $1`, [identityId]);
const comentario = (o: Parameters<typeof payloadComentario>[0]) => {
  const p = payloadComentario(o); const e: any = p.entry[0];
  return { conta_id: e.id, field: 'comments', time: e.time, value: e.changes[0].value };
};

describe('fase1 · provisionamento', () => {
  it('mesmo comentário entregue 10x → 1 identidade, 1 casa, 1 lote, 1 avatar, 1 private reply (dry-run)', async () => {
    const c = cliente(); const autor = novoId('2400'), cid = novoId('1795');
    const p = payloadComentario({ commentId: cid, fromId: autor, username: 'sintetico_dez', text: 'Duque de Caxias - RJ' });
    for (let i = 0; i < 10; i++) expect((await postarWebhook(c, p)).status).toBe(200);
    await drenar();
    for (let i = 0; i < 3; i++) await postarWebhook(c, p);        // reentregas tardias, depois do processamento
    await drenar();
    const idt = (await idDe(autor))!;
    expect(await n(`external_identities where external_id = $1`, [autor])).toBe(1);
    const casas = await casasDe(idt.id);
    expect(casas).toHaveLength(1);
    expect(casas[0]).toMatchObject({ status: 'reservada', ibge: 3301702 });
    expect(await n(`plots where id = $1`, [casas[0].plot_id])).toBe(1);
    expect(await n(`avatars where house_id = $1 and ativo`, [casas[0].id])).toBe(1);
    expect(await n(`street_memberships where house_id = $1 and saiu_em is null`, [casas[0].id])).toBe(1);
    expect(await n(`outbound_messages where identity_id = $1`, [idt.id])).toBe(1);
    expect(await n(`identity_claims where identity_id = $1`, [idt.id])).toBe(1);
    const om = await q1<any>(`select modo, estado, texto_redigido from outbound_messages where identity_id = $1`, [idt.id]);
    expect(om).toMatchObject({ modo: 'dry_run', estado: 'dry_run' });
    expect(om.texto_redigido).toContain('t=[redigido]');           // o token nunca vai para o banco
    expect(await q1(`select estado, entrega from onboarding where identity_id = $1`, [idt.id])).toEqual({ estado: 'claim_pending', entrega: 'dry_run' });
    expect(await n(`domain_events where tipo = 'casa.provisionada' and dados->>'identity_id' = $1`, [idt.id])).toBe(1);
  });

  it('lote k da cidade = próximo índice do contador (gerador atual), sem buracos', async () => {
    cliente(); const ibge = 2611606; // Recife
    const lotes: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await processarComentario(comentario({ fromId: novoId('2400'), text: 'Recife - PE' }));
      expect(r.estado).toBe('provisioned');
      lotes.push((await casasDe(r.identityId!))[0].lote_index);
    }
    expect(lotes).toEqual([lotes[0], lotes[0] + 1, lotes[0] + 2]);
    expect((await q1<{ proximo: number }>(`select proximo from city_lot_counters where ibge = $1`, [ibge]))!.proximo).toBe(lotes[0] + 3);
  });

  it('dois comentários simultâneos do mesmo autor (Promise.all) não duplicam a casa', async () => {
    cliente(); const autor = novoId('2400');
    const rs = await Promise.all([
      processarComentario(comentario({ fromId: autor, text: 'Recife - PE' })),
      processarComentario(comentario({ fromId: autor, text: 'Olinda - PE' })),
      processarComentario(comentario({ fromId: autor, text: 'Recife PE' })),
    ]);
    expect(rs.map((r) => r.estado).sort()).toEqual(['duplicate', 'duplicate', 'provisioned']);
    const idt = (await idDe(autor))!;
    expect(await casasDe(idt.id)).toHaveLength(1);
    expect(await n(`outbound_messages where identity_id = $1`, [idt.id])).toBe(1);   // uma só private reply
    // também pela fila, com workers concorrentes
    const c = cliente(); const autor2 = novoId('2400');
    await postarWebhook(c, payloadComentario({ fromId: autor2, text: 'Caruaru - PE' }));
    await postarWebhook(c, payloadComentario({ fromId: autor2, text: 'Caruaru - PE' }));
    await Promise.all([rodarFila(1), rodarFila(1), rodarFila(5)]); await drenar();
    expect(await casasDe((await idDe(autor2))!.id)).toHaveLength(1);
  });

  it('@ de terceiro no texto não cria casa para o terceiro; a casa é do AUTOR (from.id)', async () => {
    cliente(); const autor = novoId('2400');
    const r = await processarComentario(comentario({ fromId: autor, username: 'sintetico_autor_x', text: '@sintetico_terceiro Recife - PE @outro_sintetico' }));
    expect(r.estado).toBe('provisioned');
    expect(await n(`external_identities where username in ('sintetico_terceiro','outro_sintetico')`)).toBe(0);
    expect((await idDe(autor))!.username).toBe('sintetico_autor_x');
    // só o @ de outra pessoa, sem cidade → nada para ninguém além do autor (pendente)
    const autor2 = novoId('2400');
    const r2 = await processarComentario(comentario({ fromId: autor2, text: '@sintetico_terceiro_2' }));
    expect(r2.estado).toBe('pending_city_resolution');
    expect(await n(`external_identities where username = 'sintetico_terceiro_2'`)).toBe(0);
    expect(await n(`houses h join external_identities e on e.id = h.dono_identity_id where e.external_id = $1`, [autor2])).toBe(0);
  });

  it('cidade ambígua fica pendente com motivo e candidatos (nunca escolhe a primeira); UF correta resolve o IBGE esperado', async () => {
    cliente(); const autor = novoId('2400'), cid = novoId('1795');
    const r = await processarComentario(comentario({ commentId: cid, fromId: autor, text: 'Bom Jesus' }));
    expect(r.estado).toBe('pending_city_resolution');
    expect(r.motivo).toMatch(/ambígua/);
    const ic = await q1<any>(`select candidatos from instagram_comments where comment_id = $1`, [cid]);
    expect(ic.candidatos.length).toBeGreaterThan(1);
    const idt = (await idDe(autor))!;
    expect(await casasDe(idt.id)).toHaveLength(0);
    expect(await q1(`select estado from onboarding where identity_id = $1`, [idt.id])).toEqual({ estado: 'pending_city_resolution' });
    // o mesmo autor corrige com a UF → resolve para o IBGE esperado e provisiona
    const r2 = await processarComentario(comentario({ fromId: autor, text: 'Bom Jesus - PI' }));
    expect(r2.estado).toBe('provisioned');
    const m = await q1<{ ibge: number; uf: string }>(`select ibge, uf from municipios where ibge = $1`, [r2.ibge]);
    expect(m!.uf).toBe('PI');
    expect(r2.ibge).toBe(2201903);
    // não encontrada
    const r3 = await processarComentario(comentario({ fromId: novoId('2400'), text: 'amei o jogo!!' }));
    expect(r3).toMatchObject({ estado: 'pending_city_resolution' });
    expect(r3.motivo).toMatch(/não encontrada/);
  });

  it('comentar outra cidade depois não muda a residência', async () => {
    cliente(); const autor = novoId('2400');
    const a = await processarComentario(comentario({ fromId: autor, text: 'Vitória - ES' }));
    const b = await processarComentario(comentario({ fromId: autor, text: 'Manaus - AM' }));
    expect(a.estado).toBe('provisioned'); expect(b.estado).toBe('duplicate');
    expect(b.motivo).toMatch(/outra cidade/);
    const casas = await casasDe(a.identityId!); expect(casas).toHaveLength(1); expect(casas[0].ibge).toBe(3205309);
  });

  it('mídia não habilitada, sem from.id e comentário da própria conta', async () => {
    cliente();
    expect((await processarComentario(comentario({ fromId: novoId('2400'), text: 'Recife - PE', mediaId: '18000000000000999' }))).estado).toBe('ignored');
    await habilitarMidia('18000000000000777', { status: 'pausada' });
    expect((await processarComentario(comentario({ fromId: novoId('2400'), text: 'Recife - PE', mediaId: '18000000000000777' }))).estado).toBe('ignored');
    const sem = await processarComentario(comentario({ fromId: null, username: 'x', text: 'Recife - PE' }));
    expect(sem.estado).toBe('needs_review');
    expect((await processarComentario(comentario({ fromId: CONTA(), text: 'Recife - PE' }))).estado).toBe('ignored');
  });

  it('username alterado atualiza só a exibição; username reciclado não transfere a casa', async () => {
    cliente(); const a = novoId('2400'), b = novoId('2400');
    const t0 = Math.floor(Date.now() / 1000);
    const ra = await processarComentario(comentario({ fromId: a, username: 'sintetico_reciclado', text: 'Natal - RN', time: t0 }));
    // A troca de @; B passa a usar o @ antigo de A
    await processarComentario(comentario({ fromId: a, username: 'sintetico_novo_a', text: 'Natal - RN', time: t0 + 10 }));
    const rb = await processarComentario(comentario({ fromId: b, username: 'sintetico_reciclado', text: 'Natal - RN', time: t0 + 20 }));
    expect(rb.estado).toBe('provisioned');                    // B ganha a PRÓPRIA casa, não a de A
    expect(rb.houseId).not.toBe(ra.houseId);
    expect((await idDe(a))!.username).toBe('sintetico_novo_a');
    expect((await idDe(b))!.username).toBe('sintetico_reciclado');
    const ca = await casasDe(ra.identityId!); expect(ca).toHaveLength(1); expect(ca[0].id).toBe(ra.houseId);
    // evento antigo fora de ordem não volta o username
    await processarComentario(comentario({ fromId: a, username: 'sintetico_velho', text: 'Natal - RN', time: t0 - 100 }));
    expect((await idDe(a))!.username).toBe('sintetico_novo_a');
  });

  it('falha na private reply não duplica nem desfaz a casa e deixa status útil (adaptador oficial com rede simulada)', async () => {
    const c = cliente(); await drenar();             // esvazia envios pendentes de testes anteriores (dev)
    config.instagram.adaptador = 'oficial';
    await salvarConexao(CONTA(), 'IGQ-token-sintetico-de-teste-0000000000');
    const chamadas: any[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      chamadas.push({ url, init });
      return new Response(JSON.stringify({ error: { message: 'sintético: usuário indisponível', code: 10 } }), { status: 400, headers: { 'content-type': 'application/json' } });
    });
    try {
      const autor = novoId('2400'), cid = novoId('1795');
      const p = payloadComentario({ commentId: cid, fromId: autor, text: 'Fortaleza - CE' });
      await postarWebhook(c, p); await drenar(); await postarWebhook(c, p); await drenar();
      const idt = (await idDe(autor))!;
      expect(await casasDe(idt.id)).toHaveLength(1);
      expect((await casasDe(idt.id))[0].status).toBe('reservada');
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0].url).toBe(`https://graph.instagram.com/${config.instagram.graphVersao}/${CONTA()}/messages`);
      const body = JSON.parse(chamadas[0].init.body);
      expect(body.recipient).toEqual({ comment_id: cid });
      expect(chamadas[0].init.headers.authorization).toBe('Bearer IGQ-token-sintetico-de-teste-0000000000');
      expect(await q1(`select modo, estado from outbound_messages where identity_id = $1`, [idt.id])).toEqual({ modo: 'oficial', estado: 'falhou' });
      const ob = await q1<any>(`select estado, entrega, detalhe from onboarding where identity_id = $1`, [idt.id]);
      expect(ob).toMatchObject({ estado: 'delivery_failed', entrega: 'delivery_failed' });
      expect(ob.detalhe).toMatch(/código de verificação/);
      // o link da tentativa que falhou não vale
      expect(await n(`identity_claims where identity_id = $1 and consumido_em is null and expira_em > now()`, [idt.id])).toBe(0);
      // reexecutar o job não reenvia
      const om = await q1<{ id: string }>(`select id from outbound_messages where identity_id = $1`, [idt.id]);
      await enviarPrivateReply(om!.id); expect(chamadas).toHaveLength(1);
      // o token fica cifrado em repouso
      const con = await q1<{ token_cifrado: Buffer }>(`select token_cifrado from instagram_connections where conta_id = $1`, [CONTA()]);
      expect(con!.token_cifrado.toString('latin1')).not.toContain('IGQ-token');
      // um NOVO comentário do mesmo autor (casa ainda reservada, sem link válido) permite nova private reply, sem nova casa
      vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ recipient_id: '1', message_id: 'm.sintetico' }), { status: 200 }));
      await processarComentario(comentario({ fromId: autor, text: 'Fortaleza - CE' })); await drenar();
      expect(await casasDe(idt.id)).toHaveLength(1);
      expect(await n(`outbound_messages where identity_id = $1 and estado = 'enviada'`, [idt.id])).toBe(1);
      expect(await q1(`select estado, entrega from onboarding where identity_id = $1`, [idt.id])).toEqual({ estado: 'claim_pending', entrega: 'enviada' });
    } finally { config.instagram.adaptador = 'dev'; }
  });

  it('falha transitória (500) repete com backoff e, esgotada, marca delivery_failed sem duplicar', async () => {
    cliente(); await drenar(); config.instagram.adaptador = 'oficial';
    let k = 0; vi.stubGlobal('fetch', async () => { k++; return new Response('{}', { status: 503 }); });
    try {
      const autor = novoId('2400');
      const r = await processarComentario(comentario({ fromId: autor, text: 'Maceió - AL' }));
      const om = await q1<{ id: string }>(`select id from outbound_messages where identity_id = $1`, [r.identityId]);
      await expect(enviarPrivateReply(om!.id, 1)).rejects.toThrow();
      await expect(enviarPrivateReply(om!.id, 2)).rejects.toThrow();
      await enviarPrivateReply(om!.id, 3);
      expect(k).toBe(3);
      expect(await q1(`select estado from outbound_messages where id = $1`, [om!.id])).toEqual({ estado: 'falhou' });
      expect(await casasDe(r.identityId!)).toHaveLength(1);
    } finally { config.instagram.adaptador = 'dev'; }
  });

  it('adaptador dev nunca chama a rede', async () => {
    cliente(); let rede = 0; vi.stubGlobal('fetch', async () => { rede++; return new Response('{}'); });
    const vistos: string[] = []; const off = aoEnvioDev((m) => vistos.push(m.texto));
    await processarComentario(comentario({ fromId: novoId('2400'), text: 'Aracaju - SE' })); await drenar(); off();
    expect(rede).toBe(0); expect(vistos).toHaveLength(1); expect(vistos[0]).toMatch(/reivindicar\.html\?t=[\w-]{40,}/);
  });

  it('reserva não reivindicada expira: libera lote e vaga, invalida o link e o lote é reaproveitado', async () => {
    cliente(); const ibge = 2408102; // Natal
    const r = await processarComentario(comentario({ fromId: novoId('2400'), text: 'Natal - RN' })); await drenar();
    const casa = (await casasDe(r.identityId!))[0];
    const rua = await q1<{ street_id: string }>(`select street_id from street_memberships where house_id = $1`, [casa.id]);
    const ocAntes = (await q1<{ ocupadas: number }>(`select ocupadas from virtual_streets where id = $1`, [rua!.street_id]))!.ocupadas;
    await q(`update houses set expira_em = now() - interval '1 minute' where id = $1`, [casa.id]);
    expect(await tx((c) => expirarReservas(c))).toBe(1);
    expect(await q1(`select status from houses where id = $1`, [casa.id])).toEqual({ status: 'expirada' });
    expect((await q1<{ ocupadas: number }>(`select ocupadas from virtual_streets where id = $1`, [rua!.street_id]))!.ocupadas).toBe(ocAntes - 1);
    expect(await n(`identity_claims where identity_id = $1 and consumido_em is null and expira_em > now()`, [r.identityId])).toBe(0);
    expect(await q1(`select estado from onboarding where identity_id = $1`, [r.identityId])).toEqual({ estado: 'expired' });
    const proxAntes = (await q1<{ proximo: number }>(`select proximo from city_lot_counters where ibge = $1`, [ibge]))!.proximo;
    const r2 = await processarComentario(comentario({ fromId: novoId('2400'), text: 'Natal - RN' }));
    expect((await casasDe(r2.identityId!))[0].plot_id).toBe(casa.plot_id);      // mesmo lote (mesma posição do gerador)
    expect((await q1<{ proximo: number }>(`select proximo from city_lot_counters where ibge = $1`, [ibge]))!.proximo).toBe(proxAntes);
    // dedupe mínimo: a identidade continua e o mesmo comentário não reprocessa
    expect(await n(`external_identities where id = $1`, [r.identityId])).toBe(1);
  });

  it('rua lotada: cria "Rua N" nova na cidade com capacidade configurada', async () => {
    cliente(); const ibge = 2800308; // Aracaju (já tem 1 casa)
    const cap = config.ruas.capacidadeInicial; config.ruas.capacidadeInicial = 2;
    try {
      await q(`update virtual_streets set capacidade = greatest(ocupadas, 1) where ibge = $1`, [ibge]);
      const rs = await Promise.all([0, 1, 2].map(() => processarComentario(comentario({ fromId: novoId('2400'), text: 'Aracaju - SE' }))));
      expect(rs.every((r) => r.estado === 'provisioned')).toBe(true);
      const ruas = await q<{ nome: string; ocupadas: number; capacidade: number }>(`select nome, ocupadas, capacidade from virtual_streets where ibge = $1 order by criada_em`, [ibge]);
      expect(ruas.length).toBeGreaterThanOrEqual(2);
      for (const r of ruas) expect(r.ocupadas).toBeLessThanOrEqual(r.capacidade);
      expect(ruas.reduce((s, r) => s + r.ocupadas, 0)).toBe(4);
      expect(await n(`houses h join plots p on p.id = h.plot_id where p.ibge = $1 and h.status = 'reservada'`, [ibge])).toBe(4);
    } finally { config.ruas.capacidadeInicial = cap; }
  });
});
