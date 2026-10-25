/* módulo estabelecimentos (Fase 5): rotas públicas/jogador e job de métricas. As rotas administrativas ficam em
   modulos/admin/rotas.ts (área "patrocinadores") e chamam as funções de ./servico.

   POST /api/estabelecimentos/pedidos            {cidade,nome,ig,zap,tipo} → {ok, codigo: 'NEG-XXXXXX'}   (público, limitado)
   GET  /api/estabelecimentos?ibge=              lista vigentes visíveis para quem pede (política etária no servidor)
   GET  /api/estabelecimentos/:id                detalhe (fachada/interior, contato, links validados, cupons, eventos)
   POST /api/estabelecimentos/:id/visita         visita virtual (sessão; 1 por pessoa/local/dia)
   POST /api/estabelecimentos/:id/links/:link/clique → {url} revalidada (conta 1 por pessoa/link/dia se houver sessão)
   POST /api/estabelecimentos/cupons/:id/resgatar → {codigo, jaResgatado} (sessão; 1 por pessoa por cupom) */
import type { Context } from 'hono';
import { type App, limite, exigirLogin } from '../../http/app';
import { registrarJob } from '../../jobs/fila';
import { criarPedido, listarVigentes, detalhe, registrarVisita, registrarClique, resgatarCupom, agregarMetricas } from './servico';

const ipDe = (c: Context) => c.req.header('x-forwarded-for')?.split(',')[0].trim() || 'local';
async function corpo(c: Context): Promise<Record<string, unknown>> { try { const j = await c.req.json(); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } }

export function registrar(app: App) {
  app.post('/api/estabelecimentos/pedidos', limite(10), async (c) => {
    const b = await corpo(c);
    const r = await criarPedido({ cidade: b.cidade, nome: b.nome, ig: b.ig, zap: b.zap, tipo: b.tipo }, ipDe(c));
    return c.json({ ok: true, codigo: r.codigo, cidade: r.cidade });
  });

  app.get('/api/estabelecimentos', limite(120), async (c) => {
    const i = c.req.query('ibge'); const ibge = i && /^\d{7}$/.test(i) ? Number(i) : undefined;
    return c.json({ ok: true, estabelecimentos: await listarVigentes(c.get('usuario'), ibge) });
  });

  app.post('/api/estabelecimentos/cupons/:id/resgatar', limite(30), async (c) => {
    const u = exigirLogin(c);
    return c.json({ ok: true, ...(await resgatarCupom((c.req.param('id') ?? ''), u)) });
  });

  app.get('/api/estabelecimentos/:id', limite(120), async (c) => c.json({ ok: true, estabelecimento: await detalhe((c.req.param('id') ?? ''), c.get('usuario')) }));

  app.post('/api/estabelecimentos/:id/visita', limite(60), async (c) => {
    const u = exigirLogin(c);
    return c.json({ ok: true, ...(await registrarVisita((c.req.param('id') ?? ''), u)) });
  });

  app.post('/api/estabelecimentos/:id/links/:link/clique', limite(60), async (c) => c.json({ ok: true, ...(await registrarClique((c.req.param('id') ?? ''), (c.req.param('link') ?? ''), c.get('usuario'))) }));

  // agregado diário idempotente (o agendador da integração enfileira 1x/hora; rodar de novo só recalcula)
  registrarJob('estabelecimentos.agregar_metricas', async (d: { dia?: string }) => { await agregarMetricas(d?.dia); });
}
