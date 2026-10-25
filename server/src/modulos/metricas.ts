/* Métricas: registro anônimo de visita (id aleatório por aparelho, sem IP) e a série por dia para o painel admin. */
import type { App } from '../http/app';
import { limite } from '../http/app';
import { q, q1 } from '../db/db';
import { exigirArea } from './admin/auth';

const ORIGENS = ['instagram', 'whatsapp', 'facebook', 'google', 'tiktok', 'direto', 'outro'];
const DIA = `(now() at time zone 'America/Sao_Paulo')::date`;
const diaDe = (col: string) => `(${col} at time zone 'America/Sao_Paulo')::date`;

export function registrarMetricas(app: App) {
  app.post('/api/metricas/visita', limite(30), async (c) => {
    const b = await c.req.json().catch(() => ({} as any));
    const v = String(b.v || '').toLowerCase();
    if (!/^[a-z0-9]{16,40}$/.test(v)) return c.json({ ok: true });
    const origem = ORIGENS.includes(b.origem) ? b.origem : 'outro', disp = b.cel ? 'cel' : 'pc';
    await q(`insert into site_visits (dia, visitante, logado, novo, dispositivo, origem)
             values (${DIA}, $1, $2, not exists (select 1 from site_visits where visitante = $1), $3, $4)
             on conflict (dia, visitante) do update set paginas = site_visits.paginas + 1, logado = site_visits.logado or excluded.logado`, [v, !!c.get('usuario'), disp, origem]);
    return c.json({ ok: true });
  });

  app.get('/api/admin/metricas', async (c) => {
    await exigirArea(c, 'metricas');
    const dias = Math.min(90, Math.max(7, Number(c.req.query('dias')) || 30));
    const serie = await q(
      `with d as (select generate_series(${DIA} - ($1::int - 1), ${DIA}, interval '1 day')::date dia)
       select to_char(d.dia, 'DD/MM') dia, (array['dom','seg','ter','qua','qui','sex','sáb'])[extract(dow from d.dia)::int + 1] sem,
         (select count(*) from site_visits v where v.dia = d.dia)::int visitantes,
         (select count(*) from site_visits v where v.dia = d.dia and v.novo)::int novos,
         (select count(*) from site_visits v where v.dia = d.dia and not v.novo)::int voltaram,
         (select count(*) from site_visits v where v.dia = d.dia and v.dispositivo = 'cel')::int celular,
         (select count(*) from site_visits v where v.dia = d.dia and v.logado)::int logados,
         (select coalesce(sum(paginas), 0) from site_visits v where v.dia = d.dia)::int aberturas,
         (select count(*) from instagram_comments x where ${diaDe('x.recebido_em')} = d.dia)::int comentarios,
         (select count(*) from houses h where ${diaDe('h.criada_em')} = d.dia)::int casas_novas,
         (select count(*) from houses h where h.reivindicada_em is not null and ${diaDe('h.reivindicada_em')} = d.dia)::int confirmadas,
         (select count(distinct user_id) from sessions s where ${diaDe('s.criado_em')} = d.dia)::int logins,
         (select count(*) from mission_completions m where m.dia = d.dia)::int missoes,
         (select count(*) from votes vt where ${diaDe('vt.criado_em')} = d.dia)::int votos,
         (select count(*) from pets p where ${diaDe('p.criado_em')} = d.dia)::int pets
       from d order by d.dia desc`, [dias]);
    const totais = await q1(
      `select (select count(*) from houses where status in ('reservada','reivindicada'))::int casas,
              (select count(*) from houses where status = 'reivindicada')::int confirmadas,
              (select count(distinct p.ibge) from houses h join plots p on p.id = h.plot_id where h.status in ('reservada','reivindicada'))::int cidades,
              (select count(*) from users where status = 'ativo')::int contas,
              (select count(*) from pets)::int pets,
              (select count(*) from virtual_streets where status in ('ativa','fundacao'))::int ruas,
              (select count(*) from site_visits where dia = ${DIA})::int visitantes_hoje,
              (select count(distinct visitante) from site_visits where dia > ${DIA} - 7)::int visitantes_7d,
              (select count(distinct visitante) from site_visits where dia > ${DIA} - 30)::int visitantes_30d`);
    const origens = await q(`select origem, count(*)::int visitas, count(distinct visitante)::int pessoas from site_visits where dia > ${DIA} - $1::int group by origem order by visitas desc`, [dias]);
    const horas = await q(`select extract(hour from primeira_em at time zone 'America/Sao_Paulo')::int hora, count(*)::int visitas from site_visits where dia > ${DIA} - $1::int group by 1 order by 1`, [dias]);
    const cidades = await q(
      `select m.nome || ' - ' || m.uf cidade, count(*)::int casas, count(*) filter (where h.status = 'reivindicada')::int confirmadas
         from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge
        where h.status in ('reservada','reivindicada') group by m.nome, m.uf order by casas desc limit 15`);
    return c.json({ ok: true, dias, serie, totais, cidades, origens, horas });
  });
}
