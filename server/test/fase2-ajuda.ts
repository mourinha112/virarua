/* Ajudantes dos testes da Fase 2 (dados sintéticos). */
import { cliente } from './ajuda';
import { sessaoTeste } from './fixtures';
import { q1 } from '../src/db/db';

export const VITORIA = 3205309, CAXIAS = 3301702, RECIFE = 2611606;

/** cliente HTTP já autenticado como `userId` (cookie de sessão + CSRF) */
export async function logado(userId: string) {
  const c = cliente(); await c.aquecer();
  c.jar.set('smn_sess', await sessaoTeste(userId));
  return { ...c, put: (p: string, b?: unknown) => c.req('PUT', p, b) };
}

export async function ruaDe(houseId: string) {
  return (await q1<{ street_id: string }>(`select street_id from street_memberships where house_id = $1 and saiu_em is null`, [houseId]))?.street_id ?? null;
}
export async function ocupadas(streetId: string) {
  return (await q1<{ ocupadas: number; capacidade: number }>(`select ocupadas, capacidade from virtual_streets where id = $1`, [streetId]))!;
}
/** invariantes que nunca podem quebrar: casa existe e reivindicada, exatamente uma membership atual, ocupadas = memberships atuais */
export async function invariantes(houseIds: string[]) {
  for (const h of houseIds) {
    const r = (await q1<{ status: string; n: number; plot: string | null }>(`select h.status, h.plot_id plot, (select count(*)::int from street_memberships m where m.house_id = h.id and m.saiu_em is null) n from houses h where h.id = $1`, [h]))!;
    if (r.status !== 'reivindicada' || r.n !== 1 || !r.plot) throw new Error(`casa ${h} quebrada: ${JSON.stringify(r)}`);
  }
  const ruim = await q1(`select s.id, s.ocupadas, (select count(*)::int from street_memberships m where m.street_id = s.id and m.saiu_em is null) reais
                           from virtual_streets s where s.ocupadas <> (select count(*) from street_memberships m where m.street_id = s.id and m.saiu_em is null) limit 1`);
  if (ruim) throw new Error('contador de ocupadas divergente: ' + JSON.stringify(ruim));
  const lotes = await q1(`select plot_id from houses where status in ('reservada','reivindicada') group by plot_id having count(*) > 1 limit 1`);
  if (lotes) throw new Error('duas casas no mesmo lote');
}
