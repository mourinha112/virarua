import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bancoLimpo, cliente } from './ajuda';
import { moradorTeste } from './fixtures';
import { fecharDb, q1 } from '../src/db/db';
import { resolverCidade } from '../src/modulos/cidades/resolver';
import { reverter, migrar } from '../src/db/migrar';
import { config } from '../src/config';

beforeAll(bancoLimpo);
afterAll(fecharDb);

describe('base', () => {
  it('saúde e CSRF', async () => {
    const c = cliente(); await c.aquecer();
    expect((await c.get('/api/saude')).json.ok).toBe(true);
    const sem = await c.app.request('/api/sair', { method: 'POST' });
    expect(sem.status).toBe(403);
  });
  it('resolve cidade com UF e marca ambiguidade', async () => {
    const r1 = await resolverCidade('Duque de Caxias - RJ'); expect(r1).toMatchObject({ tipo: 'ok', ibge: 3301702 });
    const r2 = await resolverCidade('sou de vitória/es @fulano'); expect(r2).toMatchObject({ tipo: 'ok', ibge: 3205309 });
    const r3 = await resolverCidade('Bom Jesus'); expect(r3.tipo).toBe('ambigua');
    const r4 = await resolverCidade('@fulano de tal'); expect(r4.tipo).toBe('nao_encontrada');
    const r5 = await resolverCidade('Caxias RJ'); expect(r5).toMatchObject({ tipo: 'ok', ibge: 3301702 });
  });
  it('fixture de morador respeita unicidade de lote', async () => {
    const a = await moradorTeste(3205309), b = await moradorTeste(3205309, { rua: a.streetId });
    const n = await q1<{ n: number }>(`select count(distinct plot_id)::int n from houses where plot_id in ($1, $2)`, [a.plotId, b.plotId]);
    expect(n!.n).toBe(2);
  });
  it('migração 001 é reversível', async () => {
    await reverter(99, config.databaseUrl, () => {});
    expect(await q1(`select to_regclass('public.houses') r`)).toEqual({ r: null });
    await migrar(config.databaseUrl, () => {});
    expect((await q1<{ r: string }>(`select to_regclass('public.houses')::text r`))!.r).toBe('houses');
  });
});
