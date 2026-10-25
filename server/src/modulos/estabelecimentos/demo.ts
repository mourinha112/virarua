/* Semente de DEMONSTRAÇÃO isolada: um café e um pet shop FICTÍCIOS (marcados demo = true).
   - recusa rodar em produção;
   - demo nunca entra em contadoresProducao() nem em lojasParaMapa() sem { incluirDemo: true };
   - sem links externos, sem logo de terceiros, sem contrato real (contrato_ref deixa claro que é demonstração).
   Uso: npx tsx server/src/modulos/estabelecimentos/demo.ts */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tx, q, q1, type Tx } from '../../db/db';
import { config } from '../../config';

export const DEMO_LOJAS = [
  { slug: 'demo-cafe-grao-da-praca', nome: 'Café Grão da Praça', categoria: 'cafeteria', ibge: 3205309, cor: '#8b5a2b', descricao: 'Cafeteria fictícia de demonstração: mesas na calçada e pão de queijo quentinho.', horario: 'todo dia 7h–19h (fictício)', mesas: 5, lugares: 4, capacidade: 20, cupom: { titulo: 'cafezinho em dobro', regras: 'Demonstração: cupom fictício, não vale em loja real.' } },
  { slug: 'demo-pet-patinha-feliz', nome: 'Pet Patinha Feliz', categoria: 'pet', ibge: 3301702, cor: '#2a9db0', descricao: 'Pet shop fictício de demonstração: banho, tosa e cantinho de adoção virtual.', horario: 'seg–sáb 8h–18h (fictício)', mesas: 3, lugares: 2, capacidade: 12, cupom: { titulo: 'petisco de boas-vindas', regras: 'Demonstração: cupom fictício, não vale em loja real.' } },
] as const;

export async function semearDemoEstabelecimentos(c?: Tx) {
  if (config.ambiente === 'producao') throw new Error('semente de demonstração não roda em produção');
  const fazer = async (t: Tx) => {
    const ids: string[] = [];
    for (const d of DEMO_LOJAS) {
      let v = await q1<{ id: string }>(`select id from venues where slug = $1`, [d.slug], t);
      if (!v) {
        v = await q1<{ id: string }>(
          `insert into venues (slug, nome, categoria, ibge, descricao, cor, horario, interior, capacidade, verificacao, verificado_em, nota_verificacao, demo)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'verificado', now(), 'demonstração fictícia', true) returning id`,
          [d.slug, d.nome, d.categoria, d.ibge, d.descricao, d.cor, d.horario, JSON.stringify({ mesas: d.mesas, lugares_por_mesa: d.lugares }), d.capacidade], t);
        await q(`insert into sponsorships (venue_id, modalidade, beneficios, contrato_ref, status, inicio, fim, observacao)
                 values ($1, 'demonstracao', array['presenca_mapa','cupom'], 'DEMO — sem contrato e sem cobrança', 'ativo', (now() at time zone 'America/Sao_Paulo')::date, (now() at time zone 'America/Sao_Paulo')::date + 365, 'dados de demonstração')`, [v!.id], t);
        await q(`insert into coupons (venue_id, titulo, regras, fim, limite_total) values ($1, $2, $3, now() + interval '365 days', 1000)`, [v!.id, d.cupom.titulo, d.cupom.regras], t);
      }
      ids.push(v!.id);
    }
    return ids;
  };
  return c ? fazer(c) : tx(fazer);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  semearDemoEstabelecimentos().then((ids) => { console.log('demo ok:', ids.join(', ')); process.exit(0); }, (e) => { console.error(e.message || e); process.exit(1); });
}
