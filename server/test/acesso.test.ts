/* Acesso: sessão longa que renova, "lembrar este aparelho", admin com cookie próprio (não derruba o jogador)
   e o código comentado por quem JÁ tem casa (resposta pública com passo a passo + link de acesso direto no direct). */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { fecharDb, q, q1 } from '../src/db/db';
import { habilitarMidia, novoId, drenar, payloadComentario } from './fase1-meta';
import { processarComentario } from '../src/modulos/instagram/processar';
import { aoEnvioDev } from '../src/modulos/instagram/provedor';
import { criarAdmin } from '../src/modulos/admin/cli';

beforeAll(async () => { await bancoLimpo(); await habilitarMidia(); });
afterAll(fecharDb);

const comentario = (o: Parameters<typeof payloadComentario>[0]) => {
  const p = payloadComentario(o); const e: any = p.entry[0];
  return { conta_id: e.id, field: 'comments', time: e.time, value: e.changes[0].value };
};
const linkDe = (texto: string) => new URL(texto.match(/https?:\/\/\S+/)![0]).searchParams.get('t')!;
async function navegador() { const c = cliente(); await c.aquecer(); return c; }

/** comenta a cidade, recebe o link no direct (adaptador dev) e confirma: jogador logado neste navegador */
async function jogador(username: string) {
  cliente(); const autor = novoId('2400'); let texto = '';   // cliente() registra os jobs da fila
  const off = aoEnvioDev((m) => { if (/https?:\/\//.test(m.texto)) texto = m.texto; });
  const pr = await processarComentario(comentario({ fromId: autor, username, text: 'Recife - PE' })); await drenar(); off();
  if (!texto) throw new Error('sem link: ' + JSON.stringify(pr) + ' ' + JSON.stringify(await q(`select canal, estado, resposta_provedor from outbound_messages where identity_id = $1`, [pr.identityId])));
  const c = await navegador();
  const r = await c.post('/api/reivindicacao/confirmar', { t: linkDe(texto), nome_publico: username, aceite_regras: true });
  expect(r.status).toBe(200);
  return { c, autor, username };
}

describe('sessão do jogador', () => {
  it('renova sozinha quando falta pouco e dura 180 dias', async () => {
    const { c } = await jogador('sintetico_renova');
    const sid = (await q1<{ id: string }>(`select id from sessions order by criado_em desc limit 1`))!.id;
    await q(`update sessions set expira_em = now() + interval '10 days' where id = $1`, [sid]);
    expect((await c.get('/api/eu')).status).toBe(200);
    const s = await q1<{ dias: number }>(`select extract(day from expira_em - now())::int dias from sessions where id = $1`, [sid]);
    expect(s!.dias).toBeGreaterThanOrEqual(179);
  });

  it('aparelho lembrado reabre a sessão se o cookie sumir; token inválido não entra', async () => {
    const { c } = await jogador('sintetico_aparelho');
    const l = await c.post('/api/sessao/lembrar', {});
    expect(l.status).toBe(200);
    const novo = await navegador();                       // mesmo aparelho, cookie apagado
    expect((await novo.get('/api/eu')).status).toBe(401);
    expect((await novo.post('/api/sessao/restaurar', { token: l.json.token })).status).toBe(200);
    expect((await novo.get('/api/eu')).status).toBe(200);
    expect((await (await navegador()).post('/api/sessao/restaurar', { token: 'x'.repeat(40) })).status).toBe(401);
    // sair da conta com o token revoga o aparelho
    await novo.post('/api/sair', { aparelho: l.json.token });
    expect((await (await navegador()).post('/api/sessao/restaurar', { token: l.json.token })).status).toBe(401);
  });

  it('entrar no admin NÃO derruba a conta de jogador no mesmo navegador', async () => {
    const { c } = await jogador('sintetico_dono_admin');
    await criarAdmin('sintetico.adm', 'senha-forte-123');
    expect((await c.post('/api/admin/login', { login: 'sintetico.adm', senha: 'senha-forte-123' })).status).toBe(200);
    const eu = await c.get('/api/eu');
    expect(eu.status).toBe(200);
    expect(eu.json.usuario.usuario_instagram).toBe('sintetico_dono_admin');
    const adm = await c.get('/api/admin/eu');
    expect(adm.status).toBe(200);
    expect(adm.json.usuario.nome).toBe('admin sintetico.adm');
    await c.post('/api/admin/sair', {});
    expect((await c.get('/api/eu')).status).toBe(200);
  });
});

describe('código comentado por quem já tem casa', () => {
  it('responde no comentário com o passo a passo, manda link de acesso direto no direct e o navegador entra', async () => {
    const { autor, username } = await jogador('sintetico_volta');
    const b = await navegador();                          // outro dia, desconectado
    const { codigo } = (await b.post('/api/reivindicacao/desafio', { handle: username })).json;
    const enviados: string[] = [];
    const off = aoEnvioDev((m) => { enviados.push(m.texto); });
    const cid = novoId('1795');
    const r = await processarComentario(comentario({ commentId: cid, fromId: autor, username, text: codigo })); await drenar(); off();
    expect(r.estado).toBe('challenge');
    const pub = await q1<{ texto_redigido: string }>(`select texto_redigido from outbound_messages where canal = 'ig_comment_reply' and referencia = $1`, [cid]);
    expect(pub!.texto_redigido).toMatch(/LIBERADO/); expect(pub!.texto_redigido).toMatch(/1️⃣/);   // resposta pública
    const dm = enviados.find((t) => /entrar direto/.test(t));
    expect(dm).toBeTruthy();                                                                    // direct com link
    // pelo navegador do código: verificado → entra
    const st = await b.post('/api/reivindicacao/desafio/status', {});
    expect(st.json).toMatchObject({ estado: 'verificado', status_casa: 'reivindicada' });
    expect((await b.post('/api/reivindicacao/desafio/status', { nome_publico: username, aceite_regras: true })).json.estado).toBe('concluido');
    expect((await b.get('/api/eu')).status).toBe(200);
    // pelo link do direct, em qualquer navegador: entra direto na mesma conta
    const c2 = await navegador();
    const t = linkDe(dm!);
    expect((await c2.get('/api/reivindicacao/link?t=' + encodeURIComponent(t))).json.status_casa).toBe('reivindicada');
    expect((await c2.post('/api/reivindicacao/confirmar', { t, nome_publico: username, aceite_regras: true })).status).toBe(200);
    expect((await c2.get('/api/eu')).json.usuario.usuario_instagram).toBe(username);
    expect(await q1(`select count(*)::int n from users u join external_identities e on e.user_id = u.id where e.username = $1`, [username])).toEqual({ n: 1 });
  });
});
