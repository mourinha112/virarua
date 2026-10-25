/* módulo avatares: rotas HTTP (Fase 2).
   GET  /api/avatar/catalogo          catálogo ativo (+ possui, se logado)
   GET  /api/avatar/eu                meu avatar (editavel=false enquanto a casa não for reivindicada)
   PUT  /api/avatar/eu                salvar { config, versao? } — valida catálogo e inventário
   GET  /api/avatares/:houseId        avatar público de uma casa (somente leitura)
   PUT  /api/avatares/:houseId        só aceita a PRÓPRIA casa (403 para casa alheia) */
import type { App } from '../../http/app';
import { exigirLogin, limite, ErroHttp } from '../../http/app';
import { db, tx } from '../../db/db';
import { corpo, idValido } from '../social/comum';
import { catalogo, meuAvatar, salvarAvatar, avatarDaCasa } from './avatar';
import { casaPrincipal } from '../social/comum';

export function registrar(app: App) {
  app.get('/api/avatar/catalogo', async (c) => c.json({ ok: true, itens: await catalogo(c.get('usuario')?.id ?? null, db()) }));
  app.get('/api/avatar/eu', async (c) => { const u = exigirLogin(c); return c.json({ ok: true, ...(await meuAvatar(u.id, db())) }); });
  app.put('/api/avatar/eu', limite(30), async (c) => {
    const u = exigirLogin(c); const b = await corpo(c);
    const r = await tx((t) => salvarAvatar(t, u.id, b.config, b.versao));
    return c.json({ ok: true, ...r });
  });
  app.get('/api/avatares/:houseId', async (c) => c.json({ ok: true, ...(await avatarDaCasa(idValido(c.req.param('houseId'), 'avatar'), db())) }));
  app.put('/api/avatares/:houseId', limite(30), async (c) => {
    const u = exigirLogin(c); const id = idValido(c.req.param('houseId'), 'avatar');
    const minha = await casaPrincipal(u.id, db());
    if (!minha || minha.id !== id) throw new ErroHttp(403, 'você só pode editar o seu próprio avatar');
    const b = await corpo(c);
    return c.json({ ok: true, ...(await tx((t) => salvarAvatar(t, u.id, b.config, b.versao))) });
  });
}
