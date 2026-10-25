/* Convites: código opaco (só o sha256 no banco), validade, limite de usos, revogação, convite nominal opcional.
   - 'rua': aceitar = confirmação do dono para mudar a casa de rua (transação de trocarRua). Rua lotada → lista de
     espera e o uso NÃO é consumido. Convite expirado/revogado/esgotado não mexe em nada.
   - 'visita': dá acesso a um destino (casa privada/amigos, rua privada) enquanto o convite valer. */
import { q, q1, emitir, type Exec, type Tx } from '../../db/db';
import { config } from '../../config';
import { ErroHttp } from '../../http/app';
import { sha256, tokenForte } from '../../seguranca/cripto';
import { exigirCasa, inteiro, casaPrincipal, SQL_HANDLE } from './comum';
import { trocarRua, ruaAtualDaCasa, type ResultadoTroca } from './ruas';
import { podeAcessar, type Location } from './destinos';
import { bloqueado } from './amizades';

type Convite = { id: string; tipo: 'rua' | 'visita'; criado_por: string; street_id: string | null; location_id: string | null; para_user_id: string | null; max_usos: number; usos: number; expira_em: string; revogado_em: string | null };

export async function criarConvite(c: Tx, userId: string, d: Record<string, unknown>) {
  const tipo = d.tipo === 'visita' ? 'visita' : 'rua';
  const maxUsos = inteiro(d.maxUsos, 1, tipo === 'rua' ? 24 : 50, tipo === 'rua' ? 5 : 10);
  const horas = inteiro(d.validadeHoras, 1, 24 * 7, tipo === 'rua' ? 72 : 24);
  const para = typeof d.paraUserId === 'string' && /^[0-9a-f-]{36}$/i.test(d.paraUserId) ? d.paraUserId : null;
  if (para && await bloqueado(userId, para, c)) throw new ErroHttp(403, 'não é possível convidar essa pessoa');
  const ativos = (await q1<{ n: number }>(`select count(*)::int n from invitations where criado_por = $1 and revogado_em is null and expira_em > now() and usos < max_usos`, [userId], c))!.n;
  if (ativos >= 20) throw new ErroHttp(429, 'você tem convites demais ativos: revogue algum');
  let streetId: string | null = null, locationId: string | null = null;
  if (tipo === 'rua') {
    const casa = await exigirCasa(userId, c);
    const atual = await ruaAtualDaCasa(casa.id, c);
    streetId = typeof d.ruaId === 'string' ? d.ruaId : atual?.street_id ?? null;
    if (!streetId || atual?.street_id !== streetId) throw new ErroHttp(403, 'só moradores convidam para a própria rua');
    const s = await q1<{ status: string }>(`select status from virtual_streets where id = $1`, [streetId], c);
    if (!s || s.status === 'arquivada' || s.status === 'pausada') throw new ErroHttp(409, 'essa rua não recebe convites agora');
  } else {
    if (typeof d.destinoId !== 'string' || !/^[0-9a-f-]{36}$/i.test(d.destinoId)) throw new ErroHttp(400, 'escolha o lugar da visita');
    const loc = await q1<Location>(`select * from locations where id = $1`, [d.destinoId], c);
    if (!loc) throw new ErroHttp(404, 'lugar não encontrado');
    if (loc.tipo === 'house') {
      const casa = await casaPrincipal(userId, c);
      if (!casa || casa.id !== loc.ref_id) throw new ErroHttp(403, 'só o dono convida para visitar a casa');
    } else if (!(await podeAcessar(userId, loc, c)).ok) throw new ErroHttp(403, 'você não tem acesso a esse lugar');
    locationId = loc.id;
  }
  const codigo = tokenForte(12);
  const r = (await q1<{ id: string; expira_em: string }>(
    `insert into invitations (tipo, codigo_hash, criado_por, street_id, location_id, para_user_id, max_usos, expira_em)
     values ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(hours => $8)) returning id, expira_em`, [tipo, sha256(codigo), userId, streetId, locationId, para, maxUsos, horas], c))!;
  await emitir(c, 'convite.criado', { id: r.id, tipo, userId, para });
  return { id: r.id, codigo, tipo, expiraEm: r.expira_em, maxUsos, link: `${config.urlPublica}/?convite=${encodeURIComponent(codigo)}` };
}

function situacao(i: Convite, userId: string | null) {
  if (i.revogado_em) return 'revogado';
  if (new Date(i.expira_em).getTime() <= Date.now()) return 'expirado';
  if (i.usos >= i.max_usos) return 'esgotado';
  if (i.para_user_id && userId && i.para_user_id !== userId) return 'de_outra_pessoa';
  return 'valido';
}
const MSG: Record<string, string> = { revogado: 'esse convite foi cancelado por quem enviou', expirado: 'esse convite expirou: peça um novo', esgotado: 'esse convite já foi usado o máximo de vezes', de_outra_pessoa: 'esse convite é para outra pessoa' };

async function porCodigo(codigo: unknown, ex: Exec, travar = false) {
  if (typeof codigo !== 'string' || codigo.length < 8 || codigo.length > 64) throw new ErroHttp(404, 'convite não encontrado');
  const i = await q1<Convite>(`select * from invitations where codigo_hash = $1 ${travar ? 'for update' : ''}`, [sha256(codigo)], ex);
  if (!i) throw new ErroHttp(404, 'convite não encontrado');
  return i;
}

/** prévia (GET): não consome nada */
export async function verConvite(codigo: unknown, userId: string | null, ex: Exec) {
  const i = await porCodigo(codigo, ex);
  const de = await q1<{ nome: string; handle: string | null }>(`select u.nome_publico nome, ${SQL_HANDLE} handle from users u left join privacy_preferences pp on pp.user_id = u.id left join lateral (select username from external_identities where user_id = u.id and revogado_em is null limit 1) ei on true where u.id = $1`, [i.criado_por], ex);
  const alvo = i.tipo === 'rua'
    ? await q1(`select s.id, s.nome, s.publica, s.ocupadas, s.capacidade, s.status, m.nome cidade, m.uf from virtual_streets s join municipios m on m.ibge = s.ibge where s.id = $1`, [i.street_id], ex)
    : await q1(`select l.id, l.tipo, l.nome, l.ibge, m.nome cidade, m.uf from locations l join municipios m on m.ibge = l.ibge where l.id = $1`, [i.location_id], ex);
  const sit = situacao(i, userId);
  return { id: i.id, tipo: i.tipo, situacao: sit, aviso: MSG[sit] ?? null, expiraEm: i.expira_em, de, rua: i.tipo === 'rua' ? alvo : null, destino: i.tipo === 'visita' ? alvo : null };
}

export async function aceitarConvite(c: Tx, userId: string, codigo: unknown): Promise<{ tipo: 'rua'; troca: ResultadoTroca } | { tipo: 'visita'; destinoId: string }> {
  const i = await porCodigo(codigo, c, true);   // trava o convite: aceites simultâneos não passam do limite
  const sit = situacao(i, userId);
  const jaUsou = !!(await q1(`select 1 from invitation_uses where invitation_id = $1 and user_id = $2`, [i.id, userId], c));
  if (i.tipo === 'visita' && jaUsou && sit !== 'revogado' && sit !== 'expirado') return { tipo: 'visita', destinoId: i.location_id! };
  if (sit !== 'valido') throw new ErroHttp(410, MSG[sit]);
  if (await bloqueado(userId, i.criado_por, c)) throw new ErroHttp(403, 'esse convite não pode ser usado');
  if (i.tipo === 'rua') {
    const troca = await trocarRua(c, userId, i.street_id!, 'convite');
    if (troca.tipo === 'mudou' && !jaUsou) {
      await c.query(`update invitations set usos = usos + 1 where id = $1`, [i.id]);
      await c.query(`insert into invitation_uses (invitation_id, user_id) values ($1, $2) on conflict do nothing`, [i.id, userId]);
      await emitir(c, 'convite.usado', { id: i.id, userId, tipo: 'rua' });
    }
    return { tipo: 'rua', troca };
  }
  await c.query(`update invitations set usos = usos + 1 where id = $1`, [i.id]);
  await c.query(`insert into invitation_uses (invitation_id, user_id) values ($1, $2) on conflict do nothing`, [i.id, userId]);
  await emitir(c, 'convite.usado', { id: i.id, userId, tipo: 'visita' });
  return { tipo: 'visita', destinoId: i.location_id! };
}

export async function revogarConvite(userId: string, id: string, ex: Exec) {
  const r = await q(`update invitations set revogado_em = coalesce(revogado_em, now()) where id = $1 and criado_por = $2 returning id`, [id, userId], ex);
  if (!r.length) throw new ErroHttp(404, 'convite não encontrado');
}

export async function meusConvites(userId: string, ex: Exec) {
  return q(`select i.id, i.tipo, i.max_usos "maxUsos", i.usos, i.expira_em "expiraEm", i.revogado_em "revogadoEm", s.nome rua, l.nome destino
              from invitations i left join virtual_streets s on s.id = i.street_id left join locations l on l.id = i.location_id
             where i.criado_por = $1 order by i.criado_em desc limit 50`, [userId], ex);
}
