/* Profissões e empresas virtuais.
   - Escolher profissão (catálogo do jogo). "Ir trabalhar": 1 turno por dia do jogo, dura TURNO_MIN minutos;
     ao terminar, o XP vem do ledger (regra xp10_dia@1, idempotente, respeita o teto diário). Sem aba aberta valendo ponto:
     o turno só paga se a pessoa voltar e "encerrar o expediente" depois do tempo.
   - Abrir empresa virtual: nome, ramo e cidade; registro fictício do jogo (não é CNPJ). Uma por pessoa.
     Moradores podem trabalhar na empresa de alguém (vagas limitadas). */
import type { App } from '../http/app';
import { exigirLogin, ErroHttp, limite } from '../http/app';
import { q, q1, tx } from '../db/db';
import { conceder } from './recompensas/ledger';
import { diaJogo } from './recompensas/regras';
import { randomBytes } from 'node:crypto';
import { notificar } from './notificacoes';
import { db } from '../db/db';

export const TURNO_MIN = 8;
export const PROFISSOES: { id: string; nome: string; icone: string; local: 'prefeitura' | 'loja' | 'empresa' | 'casa'; desc: string }[] = [
  { id: 'professor', nome: 'Professor(a)', icone: '📚', local: 'prefeitura', desc: 'dá aula na escola da cidade' },
  { id: 'medico', nome: 'Médico(a)', icone: '🩺', local: 'prefeitura', desc: 'atende no posto de saúde' },
  { id: 'bombeiro', nome: 'Bombeiro(a)', icone: '🚒', local: 'prefeitura', desc: 'cuida da segurança da cidade' },
  { id: 'vendedor', nome: 'Vendedor(a)', icone: '🛍️', local: 'loja', desc: 'trabalha numa loja do mapa' },
  { id: 'barista', nome: 'Barista', icone: '☕', local: 'loja', desc: 'trabalha num café do mapa' },
  { id: 'personal', nome: 'Personal trainer', icone: '🏋️', local: 'loja', desc: 'trabalha numa academia' },
  { id: 'programador', nome: 'Programador(a)', icone: '💻', local: 'empresa', desc: 'trabalha numa empresa de moradores' },
  { id: 'empreendedor', nome: 'Empreendedor(a)', icone: '🏢', local: 'empresa', desc: 'toca a própria empresa virtual' },
  { id: 'criador', nome: 'Criador(a) de conteúdo', icone: '🎥', local: 'casa', desc: 'grava de casa' },
];
const RAMOS = ['tecnologia', 'alimentação', 'moda', 'construção', 'saúde', 'educação', 'serviços', 'entretenimento'];

async function casa(userId: string) {
  return q1<{ ibge: number; uf: string; lote_index: number }>(`select p.ibge, m.uf, p.lote_index from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge where h.dono_user_id = $1 and h.principal and h.status = 'reivindicada'`, [userId]);
}

export function registrarTrabalho(app: App) {
  // empresas no mapa (públicas: nome, ramo, cor, cidade)
  app.get('/api/empresas/mapa', async (c) => c.json({ ok: true, empresas: await q(`select vc.id, vc.nome, vc.ramo, vc.ibge, vc.cor, p.lote_index dono_lote from virtual_companies vc left join houses h on h.dono_user_id = vc.dono_user_id and h.principal and h.status = 'reivindicada' left join plots p on p.id = h.plot_id and p.ibge = vc.ibge where vc.encerrada_em is null order by vc.criada_em`) }));
  // painel do dono: funcionários, vagas, demitir
  app.get('/api/empresas/minha', async (c) => {
    const u = exigirLogin(c);
    const e = await q1<any>(`select id, nome, ramo, ibge, registro, vagas, cor from virtual_companies where dono_user_id = $1 and encerrada_em is null`, [u.id]);
    if (!e) return c.json({ ok: true, empresa: null });
    const func = await q(`select j.user_id, j.profissao, j.desde, coalesce(ei.username, '') handle,
        (select count(*)::int from work_shifts w where w.user_id = j.user_id and w.recompensado and w.inicio > now() - interval '7 days') turnos_semana
       from user_jobs j left join external_identities ei on ei.user_id = j.user_id and ei.revogado_em is null
      where j.local_tipo = 'empresa' and j.local_ref = $1 and j.user_id <> $2 order by j.desde`, [e.id, u.id]);
    return c.json({ ok: true, empresa: e, funcionarios: func });
  });
  app.post('/api/empresas/minha/vagas', limite(20), async (c) => {
    const u = exigirLogin(c); const b = await c.req.json().catch(() => ({} as any)); const n = Math.round(Number(b.vagas));
    if (!(n >= 1 && n <= 20)) throw new ErroHttp(400, 'vagas entre 1 e 20');
    const r = await q1(`update virtual_companies set vagas = $2 where dono_user_id = $1 and encerrada_em is null returning id`, [u.id, n]);
    if (!r) throw new ErroHttp(404, 'você não tem empresa'); return c.json({ ok: true, vagas: n });
  });
  app.post('/api/empresas/minha/demitir', limite(20), async (c) => {
    const u = exigirLogin(c); const b = await c.req.json().catch(() => ({} as any));
    const e = await q1<{ id: string; nome: string }>(`select id, nome from virtual_companies where dono_user_id = $1 and encerrada_em is null`, [u.id]);
    if (!e) throw new ErroHttp(404, 'você não tem empresa');
    const r = await q1(`delete from user_jobs where user_id = $1 and local_tipo = 'empresa' and local_ref = $2 returning user_id`, [String(b.userId || ''), e.id]);
    if (!r) throw new ErroHttp(404, 'essa pessoa não trabalha na sua empresa');
    await notificar(db(), [String(b.userId)], { tipo: 'trabalho', titulo: 'seu emprego terminou', texto: `você não trabalha mais na ${e.nome}. Escolha outra profissão em Minha Casa.`, acao: 'casa', chave: `demitido:${e.id}:${b.userId}:${Date.now()}` });
    return c.json({ ok: true });
  });

  app.get('/api/trabalho', async (c) => {
    const u = exigirLogin(c);
    const job = await q1<any>(`select profissao, local_tipo, local_ref, desde from user_jobs where user_id = $1`, [u.id]);
    const turno = await q1<any>(`select inicio, fim, recompensado from work_shifts where user_id = $1 and dia = $2`, [u.id, diaJogo()]);
    const emp = await q1<any>(`select id, nome, ramo, ibge, registro, vagas, criada_em from virtual_companies where dono_user_id = $1 and encerrada_em is null`, [u.id]);
    const ca = await casa(u.id);
    const empresas = ca ? await q<any>(`select vc.id, vc.nome, vc.ramo, vc.vagas, (select count(*)::int from user_jobs j where j.local_tipo = 'empresa' and j.local_ref = vc.id::text) ocupadas from virtual_companies vc where vc.ibge = $1 and vc.encerrada_em is null order by vc.criada_em limit 20`, [ca.ibge]) : [];
    return c.json({ ok: true, profissoes: PROFISSOES, ramos: RAMOS, turnoMin: TURNO_MIN, emprego: job, turno, minhaEmpresa: emp, empresasDaCidade: empresas, agora: new Date().toISOString() });
  });

  app.post('/api/trabalho/profissao', limite(20), async (c) => {
    const u = exigirLogin(c); const b = await c.req.json().catch(() => ({} as any));
    const p = PROFISSOES.find((x) => x.id === b.profissao); if (!p) throw new ErroHttp(400, 'profissão inválida');
    if (!(await casa(u.id))) throw new ErroHttp(403, 'reivindique sua casa para ter uma profissão');
    let ref: string | null = null;
    if (p.local === 'empresa' && p.id !== 'empreendedor') {
      if (!b.empresa) throw new ErroHttp(400, 'escolha a empresa onde vai trabalhar');
      const e = await q1<{ vagas: number; ocupadas: number }>(`select vc.vagas, (select count(*)::int from user_jobs j where j.local_tipo = 'empresa' and j.local_ref = vc.id::text and j.user_id <> $2) ocupadas from virtual_companies vc where vc.id = $1 and vc.encerrada_em is null`, [b.empresa, u.id]);
      if (!e) throw new ErroHttp(404, 'empresa não encontrada'); if (e.ocupadas >= e.vagas) throw new ErroHttp(409, 'essa empresa está sem vagas');
      ref = String(b.empresa);
    }
    if (p.id === 'empreendedor') { const e = await q1<{ id: string }>(`select id from virtual_companies where dono_user_id = $1 and encerrada_em is null`, [u.id]); if (!e) throw new ErroHttp(400, 'abra sua empresa virtual primeiro'); ref = e.id; }
    await q(`insert into user_jobs (user_id, profissao, local_tipo, local_ref) values ($1, $2, $3, $4) on conflict (user_id) do update set profissao = excluded.profissao, local_tipo = excluded.local_tipo, local_ref = excluded.local_ref, desde = now()`, [u.id, p.id, p.local, ref]);
    if (p.local === 'empresa' && p.id !== 'empreendedor' && ref) { const dono = await q1<{ dono_user_id: string; nome: string }>(`select dono_user_id, nome from virtual_companies where id = $1`, [ref]); if (dono) await notificar(db(), [dono.dono_user_id], { tipo: 'trabalho', titulo: 'novo funcionário', texto: `um morador começou a trabalhar na ${dono.nome}.`, acao: 'casa', chave: `contratado:${ref}:${u.id}:${Date.now()}` }); }
    return c.json({ ok: true, profissao: p });
  });

  app.post('/api/trabalho/ir', limite(20), async (c) => {
    const u = exigirLogin(c);
    const job = await q1<{ profissao: string }>(`select profissao from user_jobs where user_id = $1`, [u.id]);
    if (!job) throw new ErroHttp(400, 'escolha uma profissão primeiro');
    const r = await q1<any>(`insert into work_shifts (user_id, dia, profissao, fim) values ($1, $2, $3, now() + make_interval(mins => $4)) on conflict (user_id, dia) do nothing returning inicio, fim`, [u.id, diaJogo(), job.profissao, TURNO_MIN]);
    if (!r) throw new ErroHttp(409, 'você já trabalhou hoje: volte amanhã');
    return c.json({ ok: true, turno: r });
  });

  app.post('/api/trabalho/encerrar', limite(20), async (c) => {
    const u = exigirLogin(c);
    const r = await tx(async (t) => {
      const s = await q1<any>(`select id, fim, recompensado from work_shifts where user_id = $1 and dia = $2 for update`, [u.id, diaJogo()], t);
      if (!s) throw new ErroHttp(400, 'você não começou um turno hoje');
      if (s.recompensado) return { jaPago: true, xp: 0 };
      if (new Date(s.fim).getTime() > Date.now()) throw new ErroHttp(409, 'o expediente ainda não terminou');
      const g = await conceder(t, { userId: u.id, regraId: 'xp10_dia@1', eventoRef: 'trabalho', origem: 'missao' });
      await t.query(`update work_shifts set recompensado = true where id = $1`, [s.id]);
      return { jaPago: false, xp: g.quantidade, limitado: g.limitado };
    });
    return c.json({ ok: true, ...r });
  });

  app.post('/api/empresas', limite(10), async (c) => {
    const u = exigirLogin(c); const b = await c.req.json().catch(() => ({} as any));
    const ca = await casa(u.id); if (!ca) throw new ErroHttp(403, 'reivindique sua casa para abrir uma empresa');
    const nome = String(b.nome || '').trim().replace(/\s+/g, ' ');
    if (nome.length < 3 || nome.length > 40 || /https?:|www\.|@/i.test(nome)) throw new ErroHttp(400, 'nome entre 3 e 40 letras, sem links nem @');
    const ramo = RAMOS.includes(b.ramo) ? b.ramo : null; if (!ramo) throw new ErroHttp(400, 'escolha o ramo');
    const registro = `EMP-${ca.uf}-${randomBytes(3).toString('hex').toUpperCase()}`;
    try {
      const cor = /^#[0-9a-f]{6}$/.test(String(b.cor || '')) ? String(b.cor) : '#3a86ff';
      const e = await q1<any>(`insert into virtual_companies (dono_user_id, nome, ramo, ibge, registro, cor) values ($1, $2, $3, $4, $5, $6) returning id, nome, ramo, registro`, [u.id, nome, ramo, ca.ibge, registro, cor]);
      return c.json({ ok: true, empresa: e, aviso: 'empresa VIRTUAL do jogo; o registro não é um CNPJ' });
    } catch (e: any) { if (e?.code === '23505') throw new ErroHttp(409, 'você já tem uma empresa ou esse nome já existe na cidade'); throw e; }
  });
}
