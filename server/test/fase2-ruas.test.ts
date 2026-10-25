import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo } from './ajuda';
import { moradorTeste, ruaTeste } from './fixtures';
import { fecharDb, q, q1, tx } from '../src/db/db';
import { trocarRua, alocarRuaInicial } from '../src/modulos/social/ruas';
import { proximoFechamento } from '../src/modulos/social/comum';
import { logado, ruaDe, ocupadas, invariantes, VITORIA, CAXIAS, RECIFE } from './fase2-ajuda';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('fase 2 · ruas', () => {
  it('lista ruas da cidade com ocupadas/capacidade/status/publica e marca a minha', async () => {
    const m = await moradorTeste(VITORIA);
    const anon = await logado(m.userId);
    const r = await anon.get(`/api/cidades/${VITORIA}/ruas`);
    expect(r.status).toBe(200);
    const minha = r.json.ruas.find((x: any) => x.id === m.streetId);
    expect(minha).toMatchObject({ ocupadas: 1, capacidade: 24, status: 'ativa', publica: true, minha: true });
    expect(r.json.minha).toBe(m.streetId);
    expect((await anon.get('/api/cidades/123/ruas')).status).toBe(404);
  });

  it('cria rua moderada, uma ativa por pessoa, e o fundador se muda preservando casa/avatar/inventário', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    await q(`insert into user_inventory (user_id, item_id, origem) values ($1, 'acessorio.bone', 'teste')`, [m.userId]);
    expect((await c.post('/api/ruas', { nome: 'Rua do C4r4lho' })).status).toBe(400);
    expect((await c.post('/api/ruas', { nome: 'Rua www.golpe.com' })).status).toBe(400);
    expect((await c.post('/api/ruas', { nome: 'Rua das Mangueiras', descricao: 'chama no zap 27 99999-0000' })).status).toBe(400);
    const r = await c.post('/api/ruas', { nome: 'Rua das Mangueiras', emblema: 'folha', descricao: 'vizinhança tranquila', publica: true });
    expect(r.status).toBe(200);
    expect(r.json.troca.tipo).toBe('mudou');
    expect(await ruaDe(m.houseId)).toBe(r.json.id);
    expect((await q1<{ n: number }>(`select count(*)::int n from user_inventory where user_id = $1`, [m.userId]))!.n).toBe(1);
    expect(await q1(`select 1 from avatars where house_id = $1 and ativo`, [m.houseId])).not.toBeNull();
    expect((await c.post('/api/ruas', { nome: 'Rua Segunda Tentativa' })).status).toBe(409);
    const outro = await moradorTeste(VITORIA); const co = await logado(outro.userId);
    expect((await co.post('/api/ruas', { nome: 'rua das mangueiras' })).status).toBe(409);   // nome único por cidade
    // histórico: a membership antiga ficou fechada
    const hist = await q<{ street_id: string; saiu_em: string | null; origem: string }>(`select street_id, saiu_em, origem from street_memberships where house_id = $1 order by entrou_em`, [m.houseId]);
    expect(hist.length).toBe(2);
    expect(hist[0].saiu_em).not.toBeNull();
    expect(hist[1]).toMatchObject({ street_id: r.json.id, saiu_em: null, origem: 'criacao' });
    await invariantes([m.houseId, outro.houseId]);
  });

  it('criação concorrente de rua pela mesma pessoa só cria uma', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const rs = await Promise.all(['Rua Alfa Um', 'Rua Beta Dois', 'Rua Gama Tres', 'Rua Delta Quatro'].map((nome) => c.post('/api/ruas', { nome })));
    expect(rs.filter((r) => r.status === 200).length).toBe(1);
    expect((await q1<{ n: number }>(`select count(*)::int n from virtual_streets where fundador_user_id = $1`, [m.userId]))!.n).toBe(1);
    await invariantes([m.houseId]);
  });

  it('rua lotada → lista de espera e a casa continua intacta na rua antiga', async () => {
    const cheia = await ruaTeste(VITORIA, 'Rua Lotada', 1);
    const dono = await moradorTeste(VITORIA, { rua: cheia });
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const antes = await ruaDe(m.houseId);
    const r = await c.post(`/api/ruas/${cheia}/entrar`);
    expect(r.status).toBe(200);
    expect(r.json.troca).toMatchObject({ tipo: 'lista_espera', posicao: 1 });
    expect(await ruaDe(m.houseId)).toBe(antes);
    expect(await ocupadas(cheia)).toEqual({ ocupadas: 1, capacidade: 1 });
    const det = await c.get(`/api/ruas/${cheia}`);
    expect(det.json.eu.listaEspera).toMatchObject({ estado: 'aguardando', posicao: 1 });
    // a vaga abre quando o morador sai → o primeiro da fila é notificado e consegue entrar
    const cd = await logado(dono.userId);
    await cd.post(`/api/ruas/${antes}/entrar`);
    expect((await q1<{ estado: string }>(`select estado from street_waitlist where house_id = $1`, [m.houseId]))!.estado).toBe('notificada');
    const r2 = await c.post(`/api/ruas/${cheia}/entrar`);
    expect(r2.json.troca.tipo).toBe('mudou');
    expect((await q1<{ estado: string }>(`select estado from street_waitlist where house_id = $1`, [m.houseId]))!.estado).toBe('atendida');
    await invariantes([m.houseId, dono.houseId]);
  });

  it('muitos disputando a última vaga: um entra, os outros vão para a fila, ninguém perde casa', async () => {
    const vaga = await ruaTeste(CAXIAS, 'Rua Ultima Vaga', 3);
    await moradorTeste(CAXIAS, { rua: vaga }); await moradorTeste(CAXIAS, { rua: vaga });
    const ms = await Promise.all(Array.from({ length: 6 }, () => moradorTeste(CAXIAS)));
    const cs = await Promise.all(ms.map((m) => logado(m.userId)));
    const rs = await Promise.all(cs.map((c) => c.post(`/api/ruas/${vaga}/entrar`)));
    expect(rs.filter((r) => r.json.troca?.tipo === 'mudou').length).toBe(1);
    expect(rs.filter((r) => r.json.troca?.tipo === 'lista_espera').length).toBe(5);
    expect(await ocupadas(vaga)).toEqual({ ocupadas: 3, capacidade: 3 });
    await invariantes(ms.map((m) => m.houseId));
  });

  it('convite expirado (ou revogado/esgotado) não muda nada; convite válido muda e consome um uso', async () => {
    const privada = await ruaTeste(VITORIA, 'Rua Privada Convite', 24);
    await q(`update virtual_streets set publica = false where id = $1`, [privada]);
    const anfitriao = await moradorTeste(VITORIA, { rua: privada });
    const ca = await logado(anfitriao.userId);
    const conv = await ca.post('/api/convites', { tipo: 'rua', maxUsos: 1, validadeHoras: 1 });
    expect(conv.status).toBe(200);
    const cod = conv.json.convite.codigo;
    expect(await q1(`select 1 from invitations where codigo_hash::text like $1`, ['%' + cod + '%'])).toBeNull();   // só o hash fica no banco
    const conv2 = await ca.post('/api/convites', { tipo: 'rua', maxUsos: 2, validadeHoras: 1 });

    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const antes = await ruaDe(m.houseId);
    expect((await c.post(`/api/ruas/${privada}/entrar`)).status).toBe(403);   // privada: nem com rota pública
    await q(`update invitations set expira_em = now() - interval '1 minute' where id = $1`, [conv.json.convite.id]);
    const prev = await c.get(`/api/convites/${cod}`);
    expect(prev.json.convite.situacao).toBe('expirado');
    const exp = await c.post(`/api/convites/${cod}/aceitar`);
    expect(exp.status).toBe(410);
    expect(await ruaDe(m.houseId)).toBe(antes);
    await ca.post(`/api/convites/${conv2.json.convite.id}/revogar`);
    expect((await c.post(`/api/convites/${conv2.json.convite.codigo}/aceitar`)).status).toBe(410);
    expect(await ruaDe(m.houseId)).toBe(antes);
    // válido
    const conv3 = await ca.post('/api/convites', { tipo: 'rua', maxUsos: 1 });
    const prev3 = await c.get(`/api/convites/${conv3.json.convite.codigo}`);   // prévia não consome
    expect(prev3.json.convite).toMatchObject({ situacao: 'valido', tipo: 'rua' });
    const ok = await c.post(`/api/convites/${conv3.json.convite.codigo}/aceitar`);
    expect(ok.json.troca.tipo).toBe('mudou');
    expect(await ruaDe(m.houseId)).toBe(privada);
    const m2 = await moradorTeste(VITORIA); const c2 = await logado(m2.userId);
    expect((await c2.post(`/api/convites/${conv3.json.convite.codigo}/aceitar`)).status).toBe(410);   // esgotado
    await invariantes([m.houseId, m2.houseId, anfitriao.houseId]);
  });

  it('mudança simultânea da mesma casa para ruas diferentes: termina em exatamente uma rua', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const destinos = await Promise.all(Array.from({ length: 5 }, (_, i) => ruaTeste(VITORIA, `Rua Simultanea ${i}`, 24)));
    const rs = await Promise.all(destinos.map((d) => c.post(`/api/ruas/${d}/entrar`)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const final = await ruaDe(m.houseId);
    expect(destinos).toContain(final);
    const tot = (await q1<{ n: number }>(`select sum(ocupadas)::int n from virtual_streets where id = any($1::uuid[])`, [[...destinos, m.streetId]]))!.n;
    expect(tot).toBe(1);
    expect((await q1<{ n: number }>(`select count(*)::int n from street_memberships where house_id = $1`, [m.houseId]))!.n).toBe(6);
    await invariantes([m.houseId]);
  });

  it('criação concorrente de lote (mudança para outra cidade): lotes únicos, casas preservadas, lote antigo liberado', async () => {
    const destino = await ruaTeste(RECIFE, 'Rua Nova Recife', 24);
    const ms = await Promise.all(Array.from({ length: 8 }, () => moradorTeste(VITORIA)));
    const lotesAntigos = ms.map((m) => m.plotId);
    const rs = await Promise.all(ms.map((m) => tx((t) => trocarRua(t, m.userId, destino, 'troca'))));
    expect(rs.every((r) => r.tipo === 'mudou' && r.loteNovo)).toBe(true);
    const lotes = await q<{ lote_index: number; plot_id: string }>(`select p.lote_index, h.plot_id from houses h join plots p on p.id = h.plot_id where h.id = any($1::uuid[])`, [ms.map((m) => m.houseId)]);
    expect(new Set(lotes.map((l) => l.lote_index)).size).toBe(8);
    expect(lotes.every((l) => !lotesAntigos.includes(l.plot_id))).toBe(true);
    const ibges = await q<{ ibge: number }>(`select distinct p.ibge from houses h join plots p on p.id = h.plot_id where h.id = any($1::uuid[])`, [ms.map((m) => m.houseId)]);
    expect(ibges).toEqual([{ ibge: RECIFE }]);
    const livres = await q1<{ n: number }>(`select count(*)::int n from plots p where p.id = any($1::uuid[]) and not exists (select 1 from houses h where h.plot_id = p.id and h.status in ('reservada','reivindicada'))`, [lotesAntigos]);
    expect(livres!.n).toBe(8);
    const cont = await q1<{ proximo: number }>(`select proximo from city_lot_counters where ibge = $1`, [RECIFE]);
    expect(cont!.proximo).toBe(8);
    await invariantes(ms.map((m) => m.houseId));
  });

  it('vínculo competitivo não migra: membership nova só pontua após o fechamento', async () => {
    const m = await moradorTeste(VITORIA);
    const nova = await ruaTeste(VITORIA, 'Rua Competitiva Nova', 24);
    await q(`update street_memberships set entrou_em = now() - interval '2 days' where house_id = $1`, [m.houseId]);
    const r = await tx((t) => trocarRua(t, m.userId, nova, 'troca'));
    expect(r.tipo).toBe('mudou');
    const fech = proximoFechamento();
    expect((r as any).competicaoAPartirDe).toBe(fech.toISOString());
    expect(fech.getUTCDay()).toBe(1);            // domingo 21h BRT = segunda 00h UTC
    expect(fech.getUTCHours()).toBe(0);
    const agora = await q1<{ s: string | null }>(`select rua_competitiva($1, now()) s`, [m.houseId]);
    expect(agora!.s).toBeNull();                  // nem a antiga (já saiu) nem a nova (ainda não habilitada)
    const depois = await q1<{ s: string | null }>(`select rua_competitiva($1, $2::timestamptz + interval '1 second') s`, [m.houseId, fech.toISOString()]);
    expect(depois!.s).toBe(nova);
    const antes = await q1<{ s: string | null }>(`select rua_competitiva($1, now() - interval '1 hour') s`, [m.houseId]);
    expect(antes!.s).toBe(m.streetId);            // pontos de antes da troca continuam com a rua antiga
  });

  it('pedido de entrada em rua privada: fundador aprova e a casa muda; estranho não aprova', async () => {
    const fund = await moradorTeste(VITORIA); const cf = await logado(fund.userId);
    const rua = (await cf.post('/api/ruas', { nome: 'Rua Fechada Aprovacao', publica: false })).json.id;
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const p = await c.post(`/api/ruas/${rua}/pedidos`, { frase: 'vizinho' });
    expect(p.status).toBe(200);
    const estranho = await moradorTeste(VITORIA); const ce = await logado(estranho.userId);
    expect((await ce.post(`/api/ruas/pedidos/${p.json.pedidoId}/aprovar`)).status).toBe(403);
    const det = await cf.get(`/api/ruas/${rua}`);
    expect(det.json.eu.possoModerar).toBe(true);
    expect(det.json.eu.pedidos.length).toBe(1);
    const ap = await cf.post(`/api/ruas/pedidos/${p.json.pedidoId}/aprovar`);
    expect(ap.json).toMatchObject({ estado: 'aprovado', troca: { tipo: 'mudou' } });
    expect(await ruaDe(m.houseId)).toBe(rua);
    expect((await ocupadas(rua)).ocupadas).toBe(2);
    expect((await q1<{ status: string }>(`select status from virtual_streets where id = $1`, [rua]))!.status).toBe('ativa');
    await invariantes([m.houseId, fund.houseId]);
  });

  it('arquivar só rua vazia; rua com casas nunca é apagada', async () => {
    const fund = await moradorTeste(VITORIA); const cf = await logado(fund.userId);
    const rua = (await cf.post('/api/ruas', { nome: 'Rua Para Arquivar' })).json.id;
    expect((await cf.post(`/api/ruas/${rua}/arquivar`)).status).toBe(409);
    await cf.post(`/api/ruas/${fund.streetId}/entrar`);
    const ok = await cf.post(`/api/ruas/${rua}/arquivar`);
    expect(ok.json).toMatchObject({ ok: true, arquivada: true });
    expect((await q1<{ status: string }>(`select status from virtual_streets where id = $1`, [rua]))!.status).toBe('arquivada');
    expect((await q1<{ n: number }>(`select count(*)::int n from street_memberships where street_id = $1`, [rua]))!.n).toBe(1);   // histórico preservado
    expect((await cf.get(`/api/cidades/${VITORIA}/ruas`)).json.ruas.some((r: any) => r.id === rua)).toBe(false);
    // pode fundar outra depois de arquivar
    expect((await cf.post('/api/ruas', { nome: 'Rua Recomeco', mudar: false })).status).toBe(200);
  });

  it('detalhe da rua mostra moradores, líder/competição/obra no estado real (provedores) e alocação inicial', async () => {
    const m = await moradorTeste(VITORIA); const c = await logado(m.userId);
    const det = await c.get('/api/ruas/minha');
    expect(det.json.rua.id).toBe(m.streetId);
    expect(det.json.moradores.length).toBe(1);
    expect(det.json.moradores[0]).toMatchObject({ houseId: m.houseId, handle: m.handle });
    expect(det.json.lider).toHaveProperty('disponivel');
    expect(det.json.competicao).toHaveProperty('disponivel');
    // alocação inicial de casa sem rua (gancho para o provisionamento)
    const sem = await moradorTeste(RECIFE);
    await q(`update street_memberships set saiu_em = now() where house_id = $1`, [sem.houseId]);
    await q(`update virtual_streets set ocupadas = ocupadas - 1 where id = $1`, [sem.streetId]);
    const rid = await tx((t) => alocarRuaInicial(t, sem.houseId));
    expect(await ruaDe(sem.houseId)).toBe(rid);
    await invariantes([sem.houseId]);
  });
});
