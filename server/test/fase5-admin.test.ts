/* Painel administrativo: papéis separados, sessão recente, auditoria de ações sensíveis, export protegido,
   reenfileirar cidade de onboarding pendente e ausência de "editar votos"/"dar cargo". Dados sintéticos. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste, sessaoTeste } from './fixtures';
import { fecharDb, q, q1 } from '../src/db/db';
import { enfileirar } from '../src/jobs/fila';
import { protegerDados, protegerTexto } from '../src/modulos/admin/auditoria';
import { concederPapel } from '../src/modulos/admin/cli';

const VIX = 3205309;

async function usuario(nome: string, papeis: string[] = []) {
  const id = (await q1<{ id: string }>(`insert into users (nome_publico) values ($1) returning id`, [nome]))!.id;
  for (const p of papeis) await q(`insert into admin_roles (user_id, papel) values ($1, $2)`, [id, p]);
  return id;
}
async function logado(userId: string) { const c = cliente(); await c.aquecer(); c.jar.set('smn_sess', await sessaoTeste(userId)); return c; }
const auditoria = (acao: string) => q<any>(`select * from admin_audit_logs where acao = $1 order by id`, [acao]);

let tecnico: string, editor: string, moderador: string, operador: string;

beforeAll(async () => {
  await bancoLimpo();
  tecnico = await usuario('Tecnico Teste', ['admin_tecnico']);
  editor = await usuario('Editor Teste', ['editor_conteudo']);
  moderador = await usuario('Moderador Teste', ['moderador']);
  operador = await usuario('Operador Teste', ['operador_integracao']);
});
afterAll(fecharDb);

describe('fase 5 · painel administrativo', () => {
  it('sem sessão → 401; usuário sem papel → 403 em todas as áreas', async () => {
    const anon = cliente(); await anon.aquecer();
    expect((await anon.get('/api/admin/eu')).status).toBe(401);
    expect((await anon.get('/api/admin/saude')).status).toBe(401);
    const comum = await moradorTeste(VIX);
    const c = await logado(comum.userId);
    for (const p of ['/api/admin/eu', '/api/admin/saude', '/api/admin/midias', '/api/admin/comentarios', '/api/admin/reservas', '/api/admin/denuncias', '/api/admin/cidades?q=vit', '/api/admin/estabelecimentos', '/api/admin/flags', '/api/admin/fila', '/api/admin/auditoria', '/api/admin/auditoria/exportar'])
      expect((await c.get(p)).status, p).toBe(403);
    expect((await c.post('/api/admin/flags/bares', { ligada: true, motivo: 'tentativa sem papel', confirmo_politica_etaria: true })).status).toBe(403);
    expect((await q1<{ ligada: boolean }>(`select ligada from feature_flags where chave = 'bares'`))!.ligada).toBe(false);
  });

  it('papéis são separados: cada um só acessa as suas áreas', async () => {
    const ce = await logado(editor), cm = await logado(moderador), co = await logado(operador), ct = await logado(tecnico);
    expect((await ce.get('/api/admin/estabelecimentos')).status).toBe(200);
    expect((await ce.get('/api/admin/flags')).status).toBe(403);
    expect((await ce.get('/api/admin/denuncias')).status).toBe(403);
    expect((await cm.get('/api/admin/denuncias')).status).toBe(200);
    expect((await cm.get('/api/admin/estabelecimentos')).status).toBe(403);
    expect((await cm.get('/api/admin/fila')).status).toBe(403);
    expect((await co.get('/api/admin/saude')).status).toBe(200);
    expect((await co.get('/api/admin/fila')).status).toBe(200);
    expect((await co.get('/api/admin/auditoria')).status).toBe(403);
    expect((await ct.get('/api/admin/flags')).status).toBe(200);
    expect((await ct.get('/api/admin/denuncias')).status).toBe(403);
    expect((await ct.get('/api/admin/estabelecimentos')).status).toBe(403);
    const eu = await ce.get('/api/admin/eu');
    expect(eu.json).toMatchObject({ papeis: ['editor_conteudo'] }); expect(eu.json.areas).toContain('patrocinadores'); expect(eu.json.areas).not.toContain('flags');
  });

  it('sessão antiga (além de ADMIN_SESSAO_MIN) é recusada mesmo com papel', async () => {
    const c = await logado(tecnico);
    await q(`update sessions set criado_em = now() - interval '5 hours' where user_id = $1`, [tecnico]);
    const r = await c.get('/api/admin/flags'); expect(r.status).toBe(403); expect(r.json.erro).toMatch(/sessão antiga/);
  });

  it('não existe rota para editar votos ou dar cargo', async () => {
    const ct = await logado(tecnico), cm = await logado(moderador);
    for (const p of ['/api/admin/votos', '/api/admin/eleicoes/x/votos', '/api/admin/cargos', '/api/admin/cargos/dar', '/api/admin/presidencia'])
      for (const c of [ct, cm]) expect([404, 405]).toContain((await c.post(p, { motivo: 'tentativa' })).status);
  });

  it('flags/kill switch: alteração exige motivo e gera auditoria; bares exige confirmar política etária', async () => {
    const ct = await logado(tecnico);
    expect((await ct.post('/api/admin/flags/kill_eventos', { ligada: true })).status).toBe(400);
    expect((await ct.post('/api/admin/flags/bares', { ligada: true, motivo: 'teste sem confirmação' })).status).toBe(400);
    expect((await ct.post('/api/admin/flags/kill_eventos', { ligada: true, motivo: 'incidente simulado em teste' })).status).toBe(200);
    expect((await ct.post('/api/admin/flags/nao_existe', { ligada: true, motivo: 'flag inventada' })).status).toBe(404);
    const a = await auditoria('flag.alterar');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ ator_user_id: tecnico, alvo: 'flag:kill_eventos', motivo: 'incidente simulado em teste' });
    expect(a[0].dados).toEqual({ de: false, para: true });
  });

  it('patrocinadores: criar, verificar, aprovar e pausar patrocínio geram auditoria; sem cobrança', async () => {
    const ce = await logado(editor);
    const v = await ce.post('/api/admin/estabelecimentos', { nome: 'Café do Painel', categoria: 'cafeteria', ibge: VIX, descricao: 'teste' });
    expect(v.status).toBe(200);
    const id = v.json.id;
    expect((await ce.post(`/api/admin/estabelecimentos/${id}/verificacao`, { verificacao: 'verificado', nota: 'CNPJ conferido (teste)' })).status).toBe(200);
    const p = await ce.post(`/api/admin/estabelecimentos/${id}/patrocinios`, { modalidade: 'presenca', contrato_ref: 'contrato manual 77', inicio: '2026-01-01', fim: '2030-01-01' });
    expect(p.json.status).toBe('rascunho');
    expect((await ce.post(`/api/admin/patrocinios/${p.json.id}/status`, { status: 'ativo' })).status).toBe(400);   // sem motivo
    expect((await ce.post(`/api/admin/patrocinios/${p.json.id}/status`, { status: 'ativo', motivo: 'contrato assinado' })).status).toBe(200);
    expect((await ce.post(`/api/admin/patrocinios/${p.json.id}/status`, { status: 'pausado', motivo: 'pedido do cliente' })).status).toBe(200);
    expect((await ce.post(`/api/admin/estabelecimentos/${id}/links`, { tipo: 'site', url: 'https://site-nao-permitido.example', rotulo: 'site' })).status).toBe(400);
    const acoes = (await q<{ acao: string }>(`select acao from admin_audit_logs where ator_user_id = $1 order by id`, [editor])).map((r) => r.acao);
    expect(acoes).toEqual(['estabelecimento.criar', 'estabelecimento.verificacao', 'patrocinio.criar', 'patrocinio.status', 'patrocinio.status']);
    const cols = (await q<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'sponsorships'`)).map((r) => r.column_name);
    expect(cols.some((c) => /valor|preco|cobranca|pagamento|gateway/.test(c))).toBe(false);
  });

  it('fila: reprocessar job morto exige motivo e gera auditoria', async () => {
    const id = (await enfileirar((await import('../src/db/db')).db(), 'teste.qualquer', { a: 1 }, 'job-morto-teste'))!;
    await q(`update processing_jobs set estado = 'morto', tentativas = 6, erro = 'falhou' where id = $1`, [id]);
    const co = await logado(operador);
    expect((await co.get('/api/admin/fila')).json.mortos.map((j: any) => j.id)).toContain(id);
    expect((await co.post(`/api/admin/fila/${id}/reprocessar`, {})).status).toBe(400);
    expect((await co.post(`/api/admin/fila/${id}/reprocessar`, { motivo: 'handler corrigido' })).status).toBe(200);
    expect((await q1<{ estado: string }>(`select estado from processing_jobs where id = $1`, [id]))!.estado).toBe('pendente');
    expect((await co.post(`/api/admin/fila/${id}/reprocessar`, { motivo: 'de novo' })).status).toBe(409);
    expect(await auditoria('fila.reprocessar')).toHaveLength(1);
  });

  it('comentário com cidade pendente: escolher cidade reenfileira o job e audita', async () => {
    const m = await moradorTeste(VIX);
    await q(`update onboarding set estado = 'pending_city_resolution' where identity_id = $1`, [m.identityId]);
    const co = await logado(operador);
    const lista = await co.get('/api/admin/comentarios');
    expect(lista.json.itens.map((i: any) => i.identity_id)).toContain(m.identityId);
    expect((await co.post(`/api/admin/comentarios/${m.identityId}/cidade`, { ibge: 3301702 })).status).toBe(400);
    const r = await co.post(`/api/admin/comentarios/${m.identityId}/cidade`, { ibge: 3301702, motivo: 'comentário dizia Caxias RJ' });
    expect(r.status).toBe(200); expect(r.json.cidade).toBe('Duque de Caxias - RJ');
    const job = await q1<any>(`select tipo, dados from processing_jobs where id = $1`, [r.json.job]);
    expect(job).toMatchObject({ tipo: 'onboarding.cidade_escolhida', dados: { identityId: m.identityId, ibge: 3301702 } });
    expect(await auditoria('onboarding.escolher_cidade')).toHaveLength(1);
    await q(`update onboarding set estado = 'claimed' where identity_id = $1`, [m.identityId]);
    expect((await co.post(`/api/admin/comentarios/${m.identityId}/cidade`, { ibge: 3301702, motivo: 'já resolvido' })).status).toBe(409);
  });

  it('mídia habilitada exige texto de consentimento; criação e alteração auditadas', async () => {
    const co = await logado(operador);
    expect((await co.post('/api/admin/midias', { media_id: '1790000000001', campanha: 'campanha cidade', texto_consentimento: 'curto' })).status).toBe(400);
    const txt = 'Comente sua cidade: criamos sua casa no jogo usando o seu @ público. Ao comentar você concorda.';
    expect((await co.post('/api/admin/midias', { media_id: '1790000000001', campanha: 'campanha cidade', texto_consentimento: txt })).status).toBe(200);
    expect((await co.post('/api/admin/midias/1790000000001', { status: 'pausada', motivo: 'post arquivado' })).status).toBe(200);
    expect((await q1<{ status: string }>(`select status from enabled_media where media_id = '1790000000001'`))!.status).toBe('pausada');
    expect((await auditoria('midia.habilitar')).length + (await auditoria('midia.alterar')).length).toBe(2);
  });

  it('denúncia do jogador → ação do moderador suspende, revoga sessões e audita', async () => {
    const autor = await moradorTeste(VIX), alvo = await moradorTeste(VIX);
    const ca = await logado(autor.userId); const calvo = await logado(alvo.userId);
    const d = await ca.post('/api/denuncias', { alvo_tipo: 'user', alvo_id: alvo.userId, categoria: 'abuso', texto: 'xingou na rua' });
    expect(d.json).toMatchObject({ ok: true, nova: true });
    expect((await ca.post('/api/denuncias', { alvo_tipo: 'user', alvo_id: alvo.userId, categoria: 'abuso' })).json.nova).toBe(false);
    const cm = await logado(moderador);
    const rep = (await cm.get('/api/admin/denuncias')).json.itens.find((i: any) => i.alvo_id === alvo.userId);
    expect((await cm.post(`/api/admin/denuncias/${rep.id}/acao`, { acao: 'suspender_usuario', dias: 3 })).status).toBe(400);
    expect((await cm.post(`/api/admin/denuncias/${rep.id}/acao`, { acao: 'suspender_usuario', dias: 3, motivo: 'ofensas repetidas' })).status).toBe(200);
    expect((await q1<{ status: string }>(`select status from users where id = $1`, [alvo.userId]))!.status).toBe('suspenso');
    expect((await calvo.get('/api/sessao')).json.usuario).toBeNull();
    expect((await q1<{ estado: string }>(`select estado from reports where id = $1`, [rep.id]))!.estado).toBe('resolvida');
    expect(await auditoria('moderacao.suspender_usuario')).toHaveLength(1);
  });

  it('exportação de auditoria protege dados pessoais e é ela mesma auditada', async () => {
    await concederPapel(moderador, 'editor_conteudo', 'cobrir férias (teste)');
    await q(`insert into admin_audit_logs (ator_user_id, acao, alvo, motivo, dados) values ($1::uuid, 'teste.pii', 'user:' || $1::text, 'contato @fulano_real 27999990000 fulano@exemplo.com', '{"username":"fulano_real","ibge":3205309,"zap":"27999990000"}')`, [tecnico]);
    const ct = await logado(tecnico);
    const r = await ct.app.request('/api/admin/auditoria/exportar?formato=csv', { headers: { cookie: [...ct.jar].map(([k, v]) => `${k}=${v}`).join('; ') } });
    expect(r.status).toBe(200);
    const csv = await r.text();
    expect(r.headers.get('content-disposition')).toMatch(/attachment/);
    expect(csv).not.toContain('fulano_real'); expect(csv).not.toContain('27999990000'); expect(csv).not.toContain('fulano@exemplo.com');
    expect(csv).not.toContain(tecnico); expect(csv).not.toContain(moderador);
    expect(csv).toContain('admin.papel_conceder'); expect(csv).toContain('3205309');
    expect(await auditoria('auditoria.exportar')).toHaveLength(1);
    expect(protegerDados({ handle: 'x', n: 1, nested: { email: 'a@b.c' } })).toEqual({ handle: '[protegido]', n: 1, nested: { email: '[protegido]' } });
    expect(protegerTexto('fala com @joao_silva')).toBe('fala com @[protegido]');
  });
});
