/* módulo identidade: reivindicação (link de uso único e desafio por código), /api/eu e privacidade do titular. */
import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { type App, type Vars, criarSessao, encerrarSessao, exigirLogin, limite, ErroHttp, seguro } from '../../http/app';
import { config } from '../../config';
import { q, q1, tx, emitir } from '../../db/db';
import { sha256 } from '../../seguranca/cripto';
import { lerLink, confirmarLink, limparNome, criarDesafio, novoPendente, statusDesafio } from './reivindicacao';

const COOKIE_PEND = 'smn_pend';
type C = Context<{ Variables: Vars }>;

/** cabeçalhos das respostas com dados de reivindicação: sem cache, sem referrer */
function privado(c: C) { c.header('Cache-Control', 'no-store'); c.header('Referrer-Policy', 'no-referrer'); }
async function corpo(c: C): Promise<Record<string, unknown>> { try { const j = await c.req.json(); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }

export function registrar(app: App) {
  // ---------- link de uso único (private reply) ----------
  app.get('/api/reivindicacao/link', limite(60), async (c) => {
    privado(c);
    const d = await lerLink(c.req.query('t') || '');
    if (!d) return c.json({ ok: false, erro: 'link inválido, expirado ou já usado. Peça outro comentando de novo na campanha ou use o código de verificação.' }, 410);
    return c.json({ ok: true, ...d, validadeMin: config.reivindicacao.validadeLinkMin });
  });

  app.post('/api/reivindicacao/confirmar', limite(30), async (c) => {
    privado(c);
    const b = await corpo(c);
    if (b.aceite_regras !== true) throw new ErroHttp(400, 'é preciso aceitar as regras do jogo');
    const nome = limparNome(b.nome_publico);
    if (!nome) throw new ErroHttp(400, 'nome público: 2 a 30 letras, números, espaço, ponto, hífen ou sublinhado');
    const r = await confirmarLink(String(b.t || ''), nome);
    if (!r) return c.json({ ok: false, erro: 'link inválido, expirado ou já usado' }, 410);
    const sid = await criarSessao(c, r.userId);
    await q(`update identity_claims set consumido_por_sessao = $2 where id = $1`, [r.claimId, sid]);
    return c.json({ ok: true, casa: r.houseId ? 'reivindicada' : null });
  });

  // ---------- desafio por código (alternativa quando a private reply não chega) ----------
  app.post('/api/reivindicacao/desafio', limite(10), async (c) => {
    privado(c);
    const b = await corpo(c);
    // o @ informado é só dica de interface: não decide nada nem autentica
    const handle = typeof b.handle === 'string' ? b.handle.replace(/^@/, '').trim().slice(0, 30) || null : null;
    let pend = getCookie(c, COOKIE_PEND);
    if (!pend || !/^[\w-]{40,60}$/.test(pend)) pend = novoPendente();
    setCookie(c, COOKIE_PEND, pend, { httpOnly: true, secure: seguro(c), sameSite: 'Lax', path: '/api/reivindicacao', maxAge: config.reivindicacao.validadeDesafioMin * 60 + 300 });
    const d = await criarDesafio(sha256(pend), handle);
    return c.json({ ok: true, codigo: d.codigo, validadeMin: d.validadeMin, instrucao: 'Comente este código a partir da SUA conta num post de campanha do perfil oficial. Ele só vale neste navegador.' });
  });

  app.post('/api/reivindicacao/desafio/status', limite(60), async (c) => {
    privado(c);
    const pend = getCookie(c, COOKIE_PEND);
    if (!pend) return c.json({ ok: true, estado: 'sem_desafio' });
    const b = await corpo(c);
    let conclusao: { nomePublico: string } | null = null;
    if (b.aceite_regras === true) {
      const nome = limparNome(b.nome_publico);
      if (!nome) throw new ErroHttp(400, 'nome público: 2 a 30 letras, números, espaço, ponto, hífen ou sublinhado');
      conclusao = { nomePublico: nome };
    }
    const r = await statusDesafio(sha256(pend), conclusao);
    if (r.estado === 'concluido') {
      await criarSessao(c, r.userId);
      deleteCookie(c, COOKIE_PEND, { path: '/api/reivindicacao' });
      const { userId: _u, ...pub } = r; return c.json({ ok: true, ...pub });
    }
    return c.json({ ok: true, ...r });
  });

  // ---------- eu ----------
  app.get('/api/eu', async (c) => {
    const u = exigirLogin(c); privado(c);
    const idt = await q1<{ username: string | null }>(`select username from external_identities where user_id = $1 and provedor = 'instagram' and revogado_em is null`, [u.id]);
    const pref = await q1<{ mostrar_handle: boolean }>(`select mostrar_handle from privacy_preferences where user_id = $1`, [u.id]);
    const casa = await q1<any>(
      `select h.id, h.status, h.nivel, h.xp, h.config, p.lote_index, m.ibge, m.nome cidade, m.uf
         from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge
        where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada'`, [u.id]);
    const rua = casa ? await q1<any>(`select vs.id, vs.nome, vs.ocupadas, vs.capacidade, vs.status, vs.publica from street_memberships sm join virtual_streets vs on vs.id = sm.street_id where sm.house_id = $1 and sm.saiu_em is null`, [casa.id]) : null;
    const avatar = casa ? await q1<any>(`select config, versao from avatars where house_id = $1 and ativo`, [casa.id]) : null;
    return c.json({
      ok: true,
      usuario: { id: u.id, nome_publico: u.nome_publico, verificado_em: u.verificado_em, usuario_instagram: idt?.username ?? null, mostrar_handle: pref?.mostrar_handle ?? true },
      casa: casa ? { id: casa.id, status: casa.status, nivel: casa.nivel, xp: casa.xp, config: casa.config, lote_index: casa.lote_index, cidade: { ibge: casa.ibge, nome: casa.cidade, uf: casa.uf } } : null,
      rua, avatar,
    });
  });

  // ---------- privacidade do titular ----------
  app.post('/api/eu/privacidade', async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    if (typeof b.mostrar_handle !== 'boolean') throw new ErroHttp(400, 'mostrar_handle deve ser verdadeiro ou falso');
    await q(`insert into privacy_preferences (user_id, mostrar_handle) values ($1, $2) on conflict (user_id) do update set mostrar_handle = excluded.mostrar_handle, atualizado_em = now()`, [u.id, b.mostrar_handle]);
    return c.json({ ok: true, mostrar_handle: b.mostrar_handle });
  });

  app.get('/api/eu/dados', async (c) => {
    const u = exigirLogin(c); privado(c);
    const usuario = await q1(`select id, nome_publico, criado_em, verificado_em, faixa_etaria, status from users where id = $1`, [u.id]);
    const identidades = await q(`select provedor, external_id, username, criado_em, revogado_em from external_identities where user_id = $1`, [u.id]);
    const casas = await q(`select h.id, h.status, h.nivel, h.xp, h.config, h.criada_em, h.reivindicada_em, p.ibge, p.lote_index from houses h left join plots p on p.id = h.plot_id where h.dono_user_id = $1`, [u.id]);
    const ruas = await q(`select vs.nome, sm.entrou_em, sm.saiu_em from street_memberships sm join houses h on h.id = sm.house_id join virtual_streets vs on vs.id = sm.street_id where h.dono_user_id = $1`, [u.id]);
    const avatares = await q(`select a.config, a.versao, a.atualizado_em, a.ativo from avatars a join houses h on h.id = a.house_id where h.dono_user_id = $1`, [u.id]);
    const comentarios = await q(`select ic.comment_id, ic.media_id, ic.texto, ic.estado, ic.recebido_em from instagram_comments ic join external_identities ei on ei.id = ic.identity_id where ei.user_id = $1`, [u.id]);
    const privacidade = await q1(`select mostrar_handle, visita, presenca, aparecer_em_video from privacy_preferences where user_id = $1`, [u.id]);
    c.header('Content-Disposition', 'attachment; filename="meus-dados-seu-mundo-novo.json"');
    return c.json({ ok: true, exportado_em: new Date().toISOString(), usuario, identidades, casas, ruas, avatares, comentarios, privacidade });
  });

  app.post('/api/eu/remover', async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    if (b.confirmar !== 'REMOVER') throw new ErroHttp(400, 'para remover, envie confirmar: "REMOVER"');
    await tx(async (t) => {
      const hs = await q<{ id: string }>(`update houses set status = 'removida', expira_em = null where dono_user_id = $1 and status in ('reservada','reivindicada') returning id`, [u.id], t);
      for (const h of hs) {
        const sm = await q<{ street_id: string }>(`update street_memberships set saiu_em = now(), motivo_saida = 'remocao_titular' where house_id = $1 and saiu_em is null returning street_id`, [h.id], t);
        for (const s of sm) await t.query(`update virtual_streets set ocupadas = greatest(0, ocupadas - 1) where id = $1`, [s.street_id]);
        await t.query(`update avatars set ativo = false where house_id = $1 and ativo`, [h.id]);
      }
      // a identidade fica (revogada) para impedir que um novo comentário recrie o perfil; o @ e o texto somem
      const ids = await q<{ id: string; external_id: string }>(`update external_identities set username = null, revogado_em = coalesce(revogado_em, now()) where user_id = $1 returning id, external_id`, [u.id], t);
      for (const i of ids) {
        await t.query(`update webhook_events set payload = (payload #- '{value,text}') #- '{value,from,username}' where provedor = 'instagram' and payload->'value'->'from'->>'id' = $1`, [i.external_id]);
        await t.query(`update instagram_comments set texto = null, username = null where identity_id = $1`, [i.id]);
        await t.query(`update identity_claims set expira_em = now() where identity_id = $1 and consumido_em is null`, [i.id]);
        await t.query(`update onboarding set estado = 'revoked', detalhe = 'removido a pedido do titular', atualizado_em = now() where identity_id = $1`, [i.id]);
      }
      await t.query(`update users set status = 'removido', nome_publico = 'removido' where id = $1`, [u.id]);
      await t.query(`update sessions set revogada_em = now() where user_id = $1 and revogada_em is null`, [u.id]);
      await emitir(t, 'usuario.removido', { user_id: u.id }, 'usuario.removido:' + u.id);
    });
    await encerrarSessao(c);
    return c.json({ ok: true });
  });
}
