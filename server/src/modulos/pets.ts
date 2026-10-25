/* Pet da casa: gato ou cachorro na frente da casa. Um por pessoa, liberado quando os pontos totais
   (XP das missões + pontos da casa, o mesmo número do perfil) chegam na meta. O servidor confere a meta.
   Rotas: GET /api/pets/eu (estado + meta), POST /api/pets/eu (adotar/trocar), GET /api/pets?ibge=1,2 (público, para o mapa). */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp, limite } from '../http/app';
import { q, q1 } from '../db/db';
import { moderarTexto } from './social/moderacao';

export const META_PET = 50;
export const CORES_PET = { gato: ['laranja', 'cinza', 'preto', 'branco', 'siames'], cachorro: ['caramelo', 'marrom', 'preto', 'branco', 'malhado'] } as const;
type Especie = keyof typeof CORES_PET;

async function pontosDe(userId: string) {
  const r = await q1<{ pts: number; casa: boolean }>(
    `select (coalesce((select sum(quantidade) from reward_ledger where user_id = $1 and sistema = 'xp'), 0)
           + coalesce(max(h.xp), 0))::int pts, count(h.id) > 0 casa
       from houses h where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada'`, [userId]);
  return { pts: r?.pts ?? 0, casa: !!r?.casa };
}

export function registrarPets(app: App) {
  app.get('/api/pets/eu', async (c) => {
    const u = exigirLogin(c);
    const [{ pts, casa }, pet] = await Promise.all([pontosDe(u.id), q1(`select especie, cor, nome from pets where user_id = $1`, [u.id])]);
    return c.json({ ok: true, pet, pontos: pts, meta: META_PET, liberado: casa && pts >= META_PET, temCasa: casa, cores: CORES_PET });
  });

  app.post('/api/pets/eu', limite(20), async (c) => {
    const u = exigirLogin(c);
    const b = await c.req.json().catch(() => ({} as any));
    const especie = b.especie as Especie;
    if (!(especie in CORES_PET)) throw new ErroHttp(400, 'escolha gato ou cachorro');
    const cor = (CORES_PET[especie] as readonly string[]).includes(b.cor) ? String(b.cor) : CORES_PET[especie][0];
    const nome = moderarTexto(b.nome, 'nome do pet', 1, 20);
    if (!nome.ok) throw new ErroHttp(400, nome.erro);
    const { pts, casa } = await pontosDe(u.id);
    if (!casa) throw new ErroHttp(403, 'confirme a sua casa primeiro');
    if (pts < META_PET) throw new ErroHttp(403, `faltam ${META_PET - pts} pontos para adotar um pet`);
    const pet = await q1(
      `insert into pets (user_id, especie, cor, nome) values ($1, $2, $3, $4)
       on conflict (user_id) do update set especie = excluded.especie, cor = excluded.cor, nome = excluded.nome, atualizado_em = now()
       returning especie, cor, nome`, [u.id, especie, cor, nome.texto]);
    return c.json({ ok: true, pet });
  });

  // público: pets das casas das cidades pedidas (o mapa mostra na frente de cada casa)
  app.get('/api/pets', limite(120), async (c) => {
    const ibges = String(c.req.query('ibge') || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0).slice(0, 30);
    if (!ibges.length) return c.json({ ok: true, pets: [] });
    const pets = await q(
      `select p.ibge, p.lote_index lote, pt.especie, pt.cor, pt.nome
         from pets pt join houses h on h.dono_user_id = pt.user_id and h.principal and h.status = 'reivindicada'
         join plots p on p.id = h.plot_id
        where p.ibge = any($1::int[]) limit 3000`, [ibges]);
    return c.json({ ok: true, pets });
  });
}
