/* Fase 5 — estabelecimentos patrocinados: identificação, política etária no servidor, URL externa, cupom, métricas,
   demonstração isolada, pedidos de cadastro e exportação para o mapa. Dados sintéticos. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste, sessaoTeste } from './fixtures';
import { fecharDb, q, q1 } from '../src/db/db';
import * as est from '../src/modulos/estabelecimentos/servico';
import { validarUrlExterna, podeVerRestrito } from '../src/modulos/estabelecimentos/regras';
import { lojasParaMapa } from '../src/modulos/estabelecimentos/exportar';
import { semearDemoEstabelecimentos } from '../src/modulos/estabelecimentos/demo';

const VIX = 3205309, CAXIAS = 3301702;
let ator: string;

async function logado(userId: string) {
  const c = cliente(); await c.aquecer(); c.jar.set('smn_sess', await sessaoTeste(userId)); return c;
}
/** estabelecimento verificado + patrocínio ativo (vigente hoje) */
async function lojaVigente(d: Partial<est.VenueEntrada> = {}) {
  const v = await est.criarVenue(ator, { nome: 'Café Teste ' + Math.random().toString(36).slice(2, 6), categoria: 'cafeteria', ibge: VIX, descricao: 'café sintético', ...d });
  await est.mudarVerificacao(ator, v.id, 'verificado', 'documentos conferidos (teste)');
  const hoje = new Date().toISOString().slice(0, 10), fim = new Date(Date.now() + 30 * 86400e3).toISOString().slice(0, 10);
  const ini = new Date(Date.now() - 2 * 86400e3).toISOString().slice(0, 10);
  const p = await est.criarPatrocinio(ator, v.id, { modalidade: 'presenca', contrato_ref: 'contrato teste 001', inicio: ini, fim });
  await est.mudarStatusPatrocinio(ator, p.id, 'ativo', 'contrato assinado (teste)');
  void hoje;
  return v.id;
}

beforeAll(async () => {
  await bancoLimpo();
  ator = (await q1<{ id: string }>(`insert into users (nome_publico) values ('Admin Teste') returning id`))!.id;
});
afterAll(fecharDb);

describe('fase 5 · estabelecimentos', () => {
  it('estabelecimento vigente aparece identificado como patrocinado (lista e detalhe); não vigente não aparece', async () => {
    const id = await lojaVigente({ nome: 'Café Identificado' });
    const rascunho = await est.criarVenue(ator, { nome: 'Sem Patrocínio', categoria: 'loja', ibge: VIX });
    await est.mudarVerificacao(ator, rascunho.id, 'verificado', 'ok teste ok');
    const c = cliente(); await c.aquecer();
    const l = await c.get(`/api/estabelecimentos?ibge=${VIX}`);
    expect(l.status).toBe(200);
    const item = l.json.estabelecimentos.find((x: any) => x.id === id);
    expect(item).toMatchObject({ patrocinado: true, selo: 'patrocinado', nome: 'Café Identificado' });
    expect(l.json.estabelecimentos.some((x: any) => x.id === rascunho.id)).toBe(false);
    const d = await c.get(`/api/estabelecimentos/${id}`);
    expect(d.json.estabelecimento).toMatchObject({ patrocinado: true, selo: 'patrocinado' });
    expect(d.json.estabelecimento.avisoVirtual).toMatch(/virtual/);
    expect(d.json.estabelecimento.patrocinio.modalidade).toBe('presenca');
    expect((await c.get(`/api/estabelecimentos/${rascunho.id}`)).status).toBe(404);
  });

  it('patrocínio pausado tira do ar; ativar sem verificação é recusado; benefício "voto" é recusado', async () => {
    const id = await lojaVigente();
    const p = (await q1<{ id: string }>(`select id from sponsorships where venue_id = $1`, [id]))!.id;
    await est.mudarStatusPatrocinio(ator, p, 'pausado', 'pausa a pedido (teste)');
    expect((await est.listarVigentes(null, VIX)).some((x) => x.id === id)).toBe(false);
    const nv = await est.criarVenue(ator, { nome: 'Não Verificado', categoria: 'pet', ibge: VIX });
    const p2 = await est.criarPatrocinio(ator, nv.id, { modalidade: 'presenca', contrato_ref: 'c-002', inicio: '2026-01-01', fim: '2027-01-01' });
    await expect(est.mudarStatusPatrocinio(ator, p2.id, 'ativo', 'tentativa (teste)')).rejects.toThrow(/verifique/);
    await expect(est.criarPatrocinio(ator, nv.id, { modalidade: 'presenca', beneficios: ['voto'], contrato_ref: 'c-003', inicio: '2026-01-01', fim: '2027-01-01' })).rejects.toThrow(/não permitido/);
    await expect(q(`insert into sponsorships (venue_id, modalidade, beneficios, contrato_ref, inicio, fim) values ($1, 'presenca', array['cargo'], 'x-sql', '2026-01-01', '2026-02-01')`, [nv.id])).rejects.toThrow();
  });

  it('política etária no servidor: bar some para menor, faixa desconhecida e anônimo; só adulto com flag ligada vê', async () => {
    const bar = await lojaVigente({ nome: 'Bar do Teste', categoria: 'bar' });
    const menor = await moradorTeste(VIX); await q(`update users set faixa_etaria = 'menor' where id = $1`, [menor.userId]);
    const desconhecida = await moradorTeste(VIX);
    const adulto = await moradorTeste(VIX, { adulto: true });
    expect(podeVerRestrito('adulto', false)).toBe(false);
    // flag 'bares' desligada (padrão): ninguém vê, nem adulto
    for (const uid of [menor.userId, desconhecida.userId, adulto.userId]) {
      const c = await logado(uid);
      expect((await c.get(`/api/estabelecimentos/${bar}`)).status).toBe(403);
      expect((await c.get(`/api/estabelecimentos?ibge=${VIX}`)).json.estabelecimentos.some((x: any) => x.id === bar)).toBe(false);
    }
    await q(`update feature_flags set ligada = true where chave = 'bares'`);
    try {
      const anon = cliente(); await anon.aquecer();
      expect((await anon.get(`/api/estabelecimentos/${bar}`)).status).toBe(403);
      for (const uid of [menor.userId, desconhecida.userId]) {
        const c = await logado(uid);
        expect((await c.get(`/api/estabelecimentos/${bar}`)).status).toBe(403);
        expect((await c.post(`/api/estabelecimentos/${bar}/visita`)).status).toBe(403);
      }
      const ca = await logado(adulto.userId);
      expect((await ca.get(`/api/estabelecimentos/${bar}`)).status).toBe(200);
      expect((await ca.get(`/api/estabelecimentos?ibge=${VIX}`)).json.estabelecimentos.some((x: any) => x.id === bar)).toBe(true);
      // cupom de álcool num café: menor não resgata nem vê
      const cafe = await lojaVigente();
      const cp = await est.criarCupom(ator, cafe, { titulo: 'chope em dobro', regras: 'teste de cupom alcoólico', fim: new Date(Date.now() + 86400e3).toISOString(), alcool: true });
      const cm = await logado(menor.userId);
      expect((await cm.get(`/api/estabelecimentos/${cafe}`)).json.estabelecimento.cupons.some((x: any) => x.id === cp.id)).toBe(false);
      expect((await cm.post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`)).status).toBe(403);
      expect((await ca.post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`)).status).toBe(200);
    } finally { await q(`update feature_flags set ligada = false where chave = 'bares'`); }
    // o mapa estático (público, sem idade) nunca leva bar
    expect((await lojasParaMapa()).some((l) => l.id === bar)).toBe(false);
  });

  it('URL externa inválida é rejeitada (http, IP, credenciais, porta, domínio fora da allowlist, javascript:)', async () => {
    const allow = ['instagram.com', 'wa.me'];
    for (const u of ['http://instagram.com/x', 'https://1.2.3.4/x', 'https://user:pw@instagram.com/x', 'https://instagram.com:8443/x', 'https://evil.com/x', 'https://instagram.com.evil.com/x', 'javascript:alert(1)', 'https://localhost/x', 'https://insta gram.com', 'https://xinstagram.com/'])
      expect(validarUrlExterna(u, allow).ok, u).toBe(false);
    expect(validarUrlExterna('https://www.instagram.com/cafe_teste/', allow)).toMatchObject({ ok: true, dominio: 'instagram.com' });
    const id = await lojaVigente();
    await expect(est.adicionarLink(ator, id, { tipo: 'site', url: 'https://golpe.example/promo', rotulo: 'site' })).rejects.toThrow(/lista de domínios/);
    await expect(est.adicionarLink(ator, id, { tipo: 'site', url: 'http://instagram.com/x', rotulo: 'site' })).rejects.toThrow(/https/);
    await expect(q(`insert into venue_links (venue_id, tipo, url, dominio, rotulo) values ($1, 'site', 'http://x.com', 'x.com', 'xx')`, [id])).rejects.toThrow();
    const ok = await est.adicionarLink(ator, id, { tipo: 'instagram', url: 'https://www.instagram.com/cafe_teste/', rotulo: 'Instagram do café' });
    // link que saiu da allowlist some do detalhe e o clique devolve 410
    const c = cliente(); await c.aquecer();
    expect((await c.get(`/api/estabelecimentos/${id}`)).json.estabelecimento.links.map((l: any) => l.id)).toContain(ok.id);
    const clk = await c.post(`/api/estabelecimentos/${id}/links/${ok.id}/clique`);
    expect(clk.json).toMatchObject({ ok: true, url: 'https://www.instagram.com/cafe_teste/', contado: false });
    await q(`delete from link_domain_allowlist where dominio = 'instagram.com'`);
    try {
      expect((await c.get(`/api/estabelecimentos/${id}`)).json.estabelecimento.links.length).toBe(0);
      expect((await c.post(`/api/estabelecimentos/${id}/links/${ok.id}/clique`)).status).toBe(410);
    } finally { await q(`insert into link_domain_allowlist (dominio) values ('instagram.com')`); }
  });

  it('cupom não resgata duas vezes (sequencial e concorrente) e respeita o limite total', async () => {
    const id = await lojaVigente();
    const cp = await est.criarCupom(ator, id, { titulo: 'pão de queijo', regras: 'um por pessoa (teste)', fim: new Date(Date.now() + 86400e3).toISOString(), limite_total: 2 });
    const a = await moradorTeste(VIX), b = await moradorTeste(VIX), d = await moradorTeste(VIX);
    const anon = cliente(); await anon.aquecer();
    expect((await anon.post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`)).status).toBe(401);
    const ca = await logado(a.userId);
    const [r1, r2, r3] = await Promise.all([1, 2, 3].map(() => ca.post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`)));
    const cods = new Set([r1, r2, r3].map((r) => r.json.codigo));
    expect(cods.size).toBe(1);
    expect([r1, r2, r3].filter((r) => r.json.jaResgatado === false).length).toBe(1);
    expect((await q1<{ n: number }>(`select count(*)::int n from coupon_redemptions where coupon_id = $1`, [cp.id]))!.n).toBe(1);
    expect((await q1<{ n: number }>(`select resgatados n from coupons where id = $1`, [cp.id]))!.n).toBe(1);
    expect((await (await logado(b.userId)).post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`)).json.jaResgatado).toBe(false);
    const esg = await (await logado(d.userId)).post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`);
    expect(esg.status).toBe(409); expect(esg.json.erro).toMatch(/esgotado/);
  });

  it('métricas deduplicadas: visitas e cliques repetidos contam uma vez por pessoa/dia; agregado é idempotente', async () => {
    const id = await lojaVigente();
    const link = await est.adicionarLink(ator, id, { tipo: 'cardapio', url: 'https://www.ifood.com.br/delivery/teste', rotulo: 'cardápio' });
    const a = await moradorTeste(VIX), b = await moradorTeste(VIX);
    const ca = await logado(a.userId), cb = await logado(b.userId);
    for (let i = 0; i < 4; i++) { await ca.post(`/api/estabelecimentos/${id}/visita`); await ca.post(`/api/estabelecimentos/${id}/links/${link.id}/clique`); }
    await cb.post(`/api/estabelecimentos/${id}/visita`);
    const anon = cliente(); await anon.aquecer();
    expect((await anon.post(`/api/estabelecimentos/${id}/visita`)).status).toBe(401);       // só autenticado conta
    await anon.post(`/api/estabelecimentos/${id}/links/${link.id}/clique`);                  // anônimo recebe URL, não conta
    await est.agregarMetricas(); await est.agregarMetricas();
    const m = await q1<any>(`select visitantes_unicos, cliques, resgates from aggregated_venue_metrics where venue_id = $1`, [id]);
    expect(m).toEqual({ visitantes_unicos: 2, cliques: 1, resgates: 0 });
    const hoje = (await q1<{ d: string }>(`select ${est.HOJE}::text d`))!.d;
    expect(await est.metricasVenue(id, hoje, hoje)).toMatchObject({ visitantes_unicos: 2, cliques: 1, resgates: 0 });
  });

  it('dados de demonstração não entram em contadores de produção nem no mapa de produção', async () => {
    const antes = await est.contadoresProducao();
    const ids = await semearDemoEstabelecimentos();
    await semearDemoEstabelecimentos();                                                        // idempotente
    expect((await q1<{ n: number }>(`select count(*)::int n from venues where demo`))!.n).toBe(2);
    const u = await moradorTeste(CAXIAS);
    const c = await logado(u.userId);
    for (const id of ids) {
      expect((await c.get(`/api/estabelecimentos/${id}`)).json.estabelecimento).toMatchObject({ patrocinado: true, demo: true });
      await c.post(`/api/estabelecimentos/${id}/visita`);
      const cp = (await c.get(`/api/estabelecimentos/${id}`)).json.estabelecimento.cupons[0];
      expect((await c.post(`/api/estabelecimentos/cupons/${cp.id}/resgatar`)).status).toBe(200);
    }
    await est.agregarMetricas();
    const depois = await est.contadoresProducao();
    expect(depois).toEqual(antes);
    expect((await q1<{ n: number }>(`select count(*)::int n from aggregated_venue_metrics where demo`))!.n).toBe(2);
    const prod = await lojasParaMapa();
    expect(prod.some((l) => ids.includes(l.id))).toBe(false);
    const demo = await lojasParaMapa({ incluirDemo: true });
    expect(demo.filter((l) => ids.includes(l.id)).map((l) => l.tipo).sort()).toEqual(['cafe', 'pet']);
  });

  it('exportação para o mapa segue o formato Loja (id, nome, tipo, ibge, cor, desc, ate, ig?, site?, patrocinado)', async () => {
    const id = await lojaVigente({ nome: 'Padaria Export', cor: '#aa3322', descricao: 'pão quentinho' });
    await est.adicionarLink(ator, id, { tipo: 'instagram', url: 'https://instagram.com/padaria_export', rotulo: 'Instagram' });
    const l = (await lojasParaMapa()).find((x) => x.id === id)!;
    expect(l).toMatchObject({ id, nome: 'Padaria Export', tipo: 'cafe', ibge: VIX, cor: '#aa3322', desc: 'pão quentinho', ig: 'padaria_export', patrocinado: true });
    expect(l.ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('pedido de cadastro: valida, resolve cidade e devolve NEG-XXXXXX; bar e cidade ambígua são recusados; limite por origem', async () => {
    const c = cliente(); await c.aquecer();
    const h = { 'x-forwarded-for': '10.9.0.1' };
    const r = await c.post('/api/estabelecimentos/pedidos', { cidade: 'Vitória - ES', nome: 'Padaria do Teste', ig: '@padaria_teste', zap: '(27) 99999-0000', tipo: 'cafe' }, h);
    expect(r.status).toBe(200); expect(r.json.codigo).toMatch(/^NEG-[A-Z2-9]{6}$/);
    const salvo = await q1<any>(`select ibge, categoria, instagram, whatsapp, status from venue_requests where codigo = $1`, [r.json.codigo]);
    expect(salvo).toEqual({ ibge: VIX, categoria: 'cafeteria', instagram: 'padaria_teste', whatsapp: '27999990000', status: 'novo' });
    expect((await c.post('/api/estabelecimentos/pedidos', { cidade: 'Vitória - ES', nome: 'Bar X', tipo: 'bar' }, h)).status).toBe(400);
    expect((await c.post('/api/estabelecimentos/pedidos', { cidade: 'Bom Jesus', nome: 'Loja Y', tipo: 'loja' }, h)).json.erro).toMatch(/UF/);
    expect((await c.post('/api/estabelecimentos/pedidos', { cidade: 'Vitória - ES', nome: 'Loja Z', tipo: 'loja', ig: 'nome com espaço' }, h)).status).toBe(400);
    expect((await c.post('/api/estabelecimentos/pedidos', { cidade: 'Vitória - ES', nome: 'x', tipo: 'loja' }, h)).status).toBe(400);
    const h2 = { 'x-forwarded-for': '10.9.0.2' };
    const st: number[] = [];
    for (let i = 0; i < 6; i++) st.push((await c.post('/api/estabelecimentos/pedidos', { cidade: 'Vitória - ES', nome: 'Loja Repetida ' + i, tipo: 'loja' }, h2)).status);
    expect(st.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(st[5]).toBe(429);
  });
});
