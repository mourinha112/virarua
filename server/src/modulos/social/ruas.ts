/* Ruas virtuais: agrupamento lógico sobre os lotes do gerador (nenhuma casa é movida no mapa).
   - trocarRua: transação única que preserva casa/avatar/inventário, libera a vaga lógica da rua antiga, ocupa a nova,
     fecha a membership antiga (histórico) e abre a nova. Rua lotada → lista de espera, sem tocar na casa.
     Rua de OUTRA cidade → aloca lote novo nessa cidade pelo mesmo contador (city_lot_counters) do provisionamento.
   - Vínculo competitivo NÃO migra: a membership nova só pontua a partir do próximo fechamento semanal
     (street_memberships.competicao_a_partir_de; função SQL rua_competitiva(house, instante) para a Fase 3). */
import { q, q1, emitir, auditar, type Exec, type Tx } from '../../db/db';
import { config } from '../../config';
import { ErroHttp } from '../../http/app';
import { exigirCasa, casaPrincipal, proximoFechamento, SQL_HANDLE } from './comum';
import { moderarTexto, moderarEmblema, limpar } from './moderacao';
import { provedor } from './provedores';
import { estadoPresencaSql } from './presenca';

export type OrigemMembership = 'alocacao' | 'criacao' | 'troca' | 'convite' | 'aprovacao';
export type ResultadoTroca =
  | { tipo: 'mudou'; ruaId: string; anterior: string | null; loteNovo: boolean; competicaoAPartirDe: string | null }
  | { tipo: 'mesma'; ruaId: string }
  | { tipo: 'lista_espera'; ruaId: string; posicao: number };

type RuaRow = { id: string; ibge: number; nome: string; status: string; capacidade: number; ocupadas: number; publica: boolean; fundador_user_id: string | null };

export async function ruaAtualDaCasa(houseId: string, ex: Exec) {
  return q1<{ id: string; street_id: string; entrou_em: string }>(`select id, street_id, entrou_em from street_memberships where house_id = $1 and saiu_em is null`, [houseId], ex);
}

/** núcleo transacional da mudança de rua. Chame dentro de tx(). Nunca apaga patrimônio. */
export async function trocarRua(c: Tx, userId: string, ruaId: string, origem: OrigemMembership): Promise<ResultadoTroca> {
  const casa = await exigirCasa(userId, c, true);                       // trava a casa: mudanças simultâneas serializam aqui
  const atual = await ruaAtualDaCasa(casa.id, c);
  if (atual?.street_id === ruaId) return { tipo: 'mesma', ruaId };
  const ids = atual ? [ruaId, atual.street_id] : [ruaId];
  const ruas = await q<RuaRow>(`select id, ibge, nome, status, capacidade, ocupadas, publica, fundador_user_id from virtual_streets where id = any($1::uuid[]) order by id for update`, [ids], c);
  const alvo = ruas.find((r) => r.id === ruaId);
  if (!alvo) throw new ErroHttp(404, 'rua não encontrada');
  if (alvo.status !== 'fundacao' && alvo.status !== 'ativa') throw new ErroHttp(409, `essa rua está ${alvo.status} e não recebe moradores agora`);

  if (alvo.ocupadas >= alvo.capacidade) {
    await c.query(`insert into street_waitlist (street_id, house_id, user_id) values ($1, $2, $3) on conflict do nothing`, [ruaId, casa.id, userId]);
    const pos = await q1<{ n: number }>(
      `select count(*)::int n from street_waitlist w where w.street_id = $1 and w.estado in ('aguardando','notificada')
          and w.criado_em <= (select criado_em from street_waitlist where street_id = $1 and house_id = $2 and estado in ('aguardando','notificada'))`, [ruaId, casa.id], c);
    await emitir(c, 'rua.lista_espera', { streetId: ruaId, houseId: casa.id, userId });
    return { tipo: 'lista_espera', ruaId, posicao: pos?.n ?? 1 };
  }

  let loteNovo = false;
  if (alvo.ibge !== casa.ibge) {
    // mudança para outra cidade: lote novo pelo contador da cidade (mesma regra do provisionamento: lote k = k-ésima posição do gerador)
    await c.query(`insert into city_lot_counters (ibge, proximo) values ($1, 0) on conflict (ibge) do nothing`, [alvo.ibge]);
    const k = (await q1<{ k: number }>(`update city_lot_counters set proximo = proximo + 1 where ibge = $1 returning proximo - 1 as k`, [alvo.ibge], c))!.k;
    const plot = (await q1<{ id: string }>(`insert into plots (ibge, lote_index, street_id) values ($1, $2, $3) returning id`, [alvo.ibge, k, ruaId], c))!.id;
    await c.query(`update houses set plot_id = $2 where id = $1`, [casa.id, plot]);   // o lote antigo fica livre (houses_lote_ocupado só conta casas ativas)
    loteNovo = true;
  } else {
    await c.query(`update plots set street_id = $2 where id = $1`, [casa.plot_id, ruaId]);
  }

  let aPartir: Date | null = null;
  if (atual) {
    await c.query(`update street_memberships set saiu_em = now(), motivo_saida = $2 where id = $1`, [atual.id, origem === 'troca' ? 'troca de rua' : origem]);
    await c.query(`update virtual_streets set ocupadas = ocupadas - 1 where id = $1 and ocupadas > 0`, [atual.street_id]);
    aPartir = proximoFechamento();
  }
  await c.query(`insert into street_memberships (street_id, house_id, origem, competicao_a_partir_de) values ($1, $2, $3, $4)`, [ruaId, casa.id, atual ? (origem === 'alocacao' ? 'troca' : origem) : origem, aPartir]);
  await c.query(`update virtual_streets set ocupadas = ocupadas + 1, status = case when status = 'fundacao' and ocupadas + 1 >= 2 then 'ativa' else status end where id = $1`, [ruaId]);
  await c.query(`update street_waitlist set estado = 'atendida', encerrada_em = now() where house_id = $1 and street_id = $2 and estado in ('aguardando','notificada')`, [casa.id, ruaId]);

  if (atual) {
    // abriu vaga na rua antiga: avisa o primeiro da fila (mover a casa continua exigindo o aceite do dono)
    const prox = await q1<{ id: string; user_id: string }>(
      `update street_waitlist set estado = 'notificada', notificada_em = now() where id = (
         select id from street_waitlist where street_id = $1 and estado = 'aguardando' order by criado_em limit 1 for update skip locked) returning id, user_id`, [atual.street_id], c);
    if (prox) await emitir(c, 'rua.vaga_aberta', { streetId: atual.street_id, userId: prox.user_id, waitlistId: prox.id });
  }
  await emitir(c, 'rua.trocada', { houseId: casa.id, userId, de: atual?.street_id ?? null, para: ruaId, origem, loteNovo, competicaoAPartirDe: aPartir?.toISOString() ?? null });
  return { tipo: 'mudou', ruaId, anterior: atual?.street_id ?? null, loteNovo, competicaoAPartirDe: aPartir?.toISOString() ?? null };
}

/** Entrada inicial (para o provisionamento da Fase 1): casa sem rua vai para rua pública com vaga; cria "Rua N" se preciso. */
export async function alocarRuaInicial(c: Tx, houseId: string): Promise<string> {
  const ja = await ruaAtualDaCasa(houseId, c); if (ja) return ja.street_id;
  const casa = (await q1<{ plot_id: string; ibge: number }>(`select h.plot_id, p.ibge from houses h join plots p on p.id = h.plot_id where h.id = $1 for update of h`, [houseId], c));
  if (!casa) throw new ErroHttp(404, 'casa não encontrada');
  let rua = await q1<{ id: string }>(
    `select id from virtual_streets where ibge = $1 and publica and status in ('fundacao','ativa') and ocupadas < capacidade
      order by ocupadas desc, criada_em limit 1 for update skip locked`, [casa.ibge], c);
  if (!rua) {
    const n0 = (await q1<{ n: number }>(`select count(*)::int n from virtual_streets where ibge = $1`, [casa.ibge], c))!.n;
    for (let n = n0 + 1; !rua && n < n0 + 50; n++) {
      rua = await q1<{ id: string }>(`insert into virtual_streets (ibge, nome, capacidade, status, publica) values ($1, $2, $3, 'ativa', true) on conflict do nothing returning id`, [casa.ibge, `Rua ${n}`, config.ruas.capacidadeInicial], c);
    }
    if (!rua) throw new Error('não consegui criar rua pública');
  }
  await c.query(`update plots set street_id = $2 where id = $1`, [casa.plot_id, rua.id]);
  await c.query(`insert into street_memberships (street_id, house_id, origem) values ($1, $2, 'alocacao')`, [rua.id, houseId]);
  await c.query(`update virtual_streets set ocupadas = ocupadas + 1 where id = $1`, [rua.id]);
  await emitir(c, 'rua.alocada', { houseId, streetId: rua.id });
  return rua.id;
}

export async function criarRua(c: Tx, userId: string, d: { nome?: unknown; emblema?: unknown; descricao?: unknown; publica?: unknown; mudar?: unknown }) {
  const casa = await exigirCasa(userId, c, true);
  const nome = moderarTexto(d.nome, 'nome', 3, 40); if (!nome.ok) throw new ErroHttp(400, nome.erro);
  let descricao: string | null = null;
  if (d.descricao !== undefined && d.descricao !== null && limpar(d.descricao, 200) !== '') { const v = moderarTexto(d.descricao, 'descrição', 3, 140); if (!v.ok) throw new ErroHttp(400, v.erro); descricao = v.texto; }
  const emblema = moderarEmblema(d.emblema);
  const publica = d.publica !== false;
  const ja = await q1(`select id from virtual_streets where fundador_user_id = $1 and status in ('fundacao','ativa','pausada')`, [userId], c);
  if (ja) throw new ErroHttp(409, 'você já fundou uma rua ativa (uma por pessoa)');
  const r = await q1<{ id: string }>(
    `insert into virtual_streets (ibge, nome, emblema, descricao, publica, capacidade, status, fundador_user_id)
     values ($1, $2, $3, $4, $5, $6, 'fundacao', $7) on conflict do nothing returning id`,
    [casa.ibge, nome.texto, emblema, descricao, publica, config.ruas.capacidadeInicial, userId], c);
  if (!r) {
    const outra = await q1(`select id from virtual_streets where fundador_user_id = $1 and status in ('fundacao','ativa','pausada')`, [userId], c);
    throw new ErroHttp(409, outra ? 'você já fundou uma rua ativa (uma por pessoa)' : 'já existe uma rua com esse nome nesta cidade');
  }
  await emitir(c, 'rua.criada', { streetId: r.id, ibge: casa.ibge, userId });
  const troca = d.mudar === false ? null : await trocarRua(c, userId, r.id, 'criacao');
  return { id: r.id, troca };
}

export async function podeModerarRua(rua: { id: string; fundador_user_id: string | null }, userId: string, ex: Exec) {
  if (rua.fundador_user_id === userId) return true;
  if (provedor.podeModerarRua) { try { if (await provedor.podeModerarRua(rua.id, userId, ex)) return true; } catch { /* provedor indisponível */ } }
  const adm = await q1(`select 1 from admin_roles where user_id = $1 and papel in ('moderador','admin_tecnico')`, [userId], ex);
  return !!adm;
}

export const FRASES_PEDIDO: Record<string, string> = { oi: 'oi! posso morar aqui?', amigo: 'sou amigo de quem mora aí', vizinho: 'quero ser vizinho de vocês', convite: 'me chamaram para essa rua' };

export async function pedirEntrada(c: Tx, userId: string, ruaId: string, frase?: unknown) {
  const casa = await exigirCasa(userId, c, true);
  const rua = await q1<RuaRow>(`select id, ibge, nome, status, capacidade, ocupadas, publica, fundador_user_id from virtual_streets where id = $1`, [ruaId], c);
  if (!rua || rua.status === 'arquivada') throw new ErroHttp(404, 'rua não encontrada');
  if (rua.publica) throw new ErroHttp(409, 'essa rua é pública: é só entrar');
  const atual = await ruaAtualDaCasa(casa.id, c);
  if (atual?.street_id === ruaId) throw new ErroHttp(409, 'você já mora nessa rua');
  const msg = typeof frase === 'string' && FRASES_PEDIDO[frase] ? frase : 'oi';
  await c.query(`insert into street_join_requests (street_id, house_id, user_id, mensagem) values ($1, $2, $3, $4) on conflict do nothing`, [ruaId, casa.id, userId, msg]);
  const p = (await q1<{ id: string }>(`select id from street_join_requests where street_id = $1 and house_id = $2 and estado = 'pendente'`, [ruaId, casa.id], c))!;
  await emitir(c, 'rua.pedido_entrada', { streetId: ruaId, pedidoId: p.id, userId });
  return p.id;
}

export async function decidirPedido(c: Tx, userId: string, pedidoId: string, aprovar: boolean) {
  const p = await q1<{ id: string; street_id: string; user_id: string; estado: string }>(`select id, street_id, user_id, estado from street_join_requests where id = $1 for update`, [pedidoId], c);
  if (!p) throw new ErroHttp(404, 'pedido não encontrado');
  if (p.estado !== 'pendente') throw new ErroHttp(409, 'esse pedido já foi respondido');
  const rua = (await q1<RuaRow>(`select id, fundador_user_id from virtual_streets where id = $1`, [p.street_id], c))!;
  if (!(await podeModerarRua(rua, userId, c))) throw new ErroHttp(403, 'só quem cuida da rua pode responder pedidos');
  await c.query(`update street_join_requests set estado = $2, decidido_por = $3, decidido_em = now() where id = $1`, [p.id, aprovar ? 'aprovado' : 'recusado', userId]);
  if (!aprovar) { await emitir(c, 'rua.pedido_recusado', { pedidoId: p.id, userId: p.user_id }); return { estado: 'recusado' as const, troca: null }; }
  // o próprio pedido é a confirmação do dono da casa; a mudança respeita capacidade (lotada → lista de espera)
  const troca = await trocarRua(c, p.user_id, p.street_id, 'aprovacao');
  return { estado: 'aprovado' as const, troca };
}

export async function arquivarRua(c: Tx, userId: string, ruaId: string, motivo?: string) {
  const rua = await q1<RuaRow>(`select id, ibge, nome, status, capacidade, ocupadas, publica, fundador_user_id from virtual_streets where id = $1 for update`, [ruaId], c);
  if (!rua) throw new ErroHttp(404, 'rua não encontrada');
  if (rua.status === 'arquivada') return { arquivada: true };
  const admin = rua.fundador_user_id !== userId;
  if (admin && !(await podeModerarRua(rua, userId, c))) throw new ErroHttp(403, 'só quem fundou a rua pode arquivar');
  const n = (await q1<{ n: number }>(`select count(*)::int n from street_memberships where street_id = $1 and saiu_em is null`, [ruaId], c))!.n;
  if (n > 0 || rua.ocupadas > 0) throw new ErroHttp(409, 'só dá para arquivar rua vazia: ruas com casas nunca são apagadas');
  await c.query(`update virtual_streets set status = 'arquivada', arquivada_em = now() where id = $1`, [ruaId]);
  await c.query(`update street_waitlist set estado = 'cancelada', encerrada_em = now() where street_id = $1 and estado in ('aguardando','notificada')`, [ruaId]);
  await c.query(`update street_join_requests set estado = 'cancelado', decidido_em = now() where street_id = $1 and estado = 'pendente'`, [ruaId]);
  await c.query(`update invitations set revogado_em = now() where street_id = $1 and revogado_em is null`, [ruaId]);
  if (admin) await auditar(c, userId, 'rua.arquivar', ruaId, motivo || null);
  await emitir(c, 'rua.arquivada', { streetId: ruaId, userId });
  return { arquivada: true };
}

export async function sairDaEspera(userId: string, ruaId: string, ex: Exec) {
  await q(`update street_waitlist set estado = 'cancelada', encerrada_em = now() where street_id = $1 and user_id = $2 and estado in ('aguardando','notificada')`, [ruaId, userId], ex);
}

export async function listarRuas(ibge: number, viewer: string | null, ex: Exec) {
  const ruas = await q(`select id, nome, emblema, descricao, status, ocupadas, capacidade, publica, (fundador_user_id is not distinct from $2::uuid and $2::uuid is not null) as "souFundador"
                          from virtual_streets where ibge = $1 and status <> 'arquivada' order by ocupadas desc, criada_em, id`, [ibge, viewer], ex);
  let minha: string | null = null;
  if (viewer) { const casa = await casaPrincipal(viewer, ex); if (casa) minha = (await ruaAtualDaCasa(casa.id, ex))?.street_id ?? null; }
  return { ruas: ruas.map((r) => ({ ...r, minha: r.id === minha })), minha };
}

export async function detalheRua(ruaId: string, viewer: string | null, ex: Exec) {
  const rua = await q1<RuaRow & { emblema: string | null; descricao: string | null; criada_em: string; arquivada_em: string | null; cidade: string; uf: string }>(
    `select s.id, s.ibge, s.nome, s.emblema, s.descricao, s.status, s.capacidade, s.ocupadas, s.publica, s.fundador_user_id, s.criada_em, s.arquivada_em, m.nome cidade, m.uf
       from virtual_streets s join municipios m on m.ibge = s.ibge where s.id = $1`, [ruaId], ex);
  if (!rua) throw new ErroHttp(404, 'rua não encontrada');
  const moradores = await q(
    `select h.id "houseId", h.dono_user_id "userId", h.nivel, p.lote_index "lote", sm.entrou_em "entrouEm", ${SQL_HANDLE} handle, a.config avatar,
            ${estadoPresencaSql('$2')} estado
       from street_memberships sm join houses h on h.id = sm.house_id join plots p on p.id = h.plot_id
       left join external_identities ei on ei.id = h.dono_identity_id
       left join privacy_preferences pp on pp.user_id = h.dono_user_id
       left join presence_sessions ps on ps.user_id = h.dono_user_id and ps.expira_em > now()
       left join avatars a on a.house_id = h.id and a.ativo
      where sm.street_id = $1 and sm.saiu_em is null order by sm.entrou_em, h.id`, [ruaId, viewer], ex);
  const fundador = rua.fundador_user_id ? await q1<{ handle: string | null }>(
    `select ${SQL_HANDLE} handle from users u left join external_identities ei on ei.user_id = u.id and ei.revogado_em is null left join privacy_preferences pp on pp.user_id = u.id where u.id = $1 limit 1`, [rua.fundador_user_id], ex) : null;
  const seguro = async <T>(f?: (id: string, ex: Exec) => Promise<T>) => { if (!f) return { disponivel: false as const }; try { const v = await f(ruaId, ex); return v ?? { disponivel: false as const }; } catch { return { disponivel: false as const, erro: 'indisponível agora' }; } };
  const lider = provedor.liderDaRua ? await (async () => { try { return { disponivel: true as const, lider: await provedor.liderDaRua!(ruaId, ex) }; } catch { return { disponivel: false as const }; } })() : { disponivel: false as const };
  const competicao = await seguro(provedor.competicaoDaRua);
  const obra = await seguro(provedor.obraDaRua);

  let eu: Record<string, unknown> | null = null;
  if (viewer) {
    const casa = await casaPrincipal(viewer, ex);
    const atual = casa ? await ruaAtualDaCasa(casa.id, ex) : null;
    const modera = await podeModerarRua(rua, viewer, ex);
    const espera = casa ? await q1<{ estado: string; criado_em: string }>(`select estado, criado_em from street_waitlist where street_id = $1 and house_id = $2 and estado in ('aguardando','notificada')`, [ruaId, casa.id], ex) : null;
    const posEspera = espera ? (await q1<{ n: number }>(`select count(*)::int n from street_waitlist where street_id = $1 and estado in ('aguardando','notificada')
        and criado_em <= (select criado_em from street_waitlist where street_id = $1 and house_id = $2 and estado in ('aguardando','notificada'))`, [ruaId, casa!.id], ex))!.n : null;
    const pedido = casa ? await q1<{ id: string }>(`select id from street_join_requests where street_id = $1 and house_id = $2 and estado = 'pendente'`, [ruaId, casa.id], ex) : null;
    eu = {
      temCasa: !!casa, souMembro: atual?.street_id === ruaId, minhaRua: atual?.street_id ?? null, souFundador: rua.fundador_user_id === viewer, possoModerar: modera,
      listaEspera: espera ? { estado: espera.estado, posicao: posEspera } : null, pedidoPendente: pedido?.id ?? null,
      pedidos: modera ? await q(`select r.id, r.mensagem, r.criado_em "criadoEm", ${SQL_HANDLE} handle from street_join_requests r join houses h on h.id = r.house_id
                                   left join external_identities ei on ei.id = h.dono_identity_id left join privacy_preferences pp on pp.user_id = r.user_id
                                  where r.street_id = $1 and r.estado = 'pendente' order by r.criado_em`, [ruaId], ex) : [],
      convites: await q(`select id, tipo, max_usos "maxUsos", usos, expira_em "expiraEm" from invitations where criado_por = $1 and street_id = $2 and revogado_em is null and expira_em > now() and usos < max_usos order by criado_em desc`, [viewer, ruaId], ex),
    };
  }
  const espera = (await q1<{ n: number }>(`select count(*)::int n from street_waitlist where street_id = $1 and estado in ('aguardando','notificada')`, [ruaId], ex))!.n;
  return {
    rua: { id: rua.id, nome: rua.nome, emblema: rua.emblema, descricao: rua.descricao, status: rua.status, publica: rua.publica, capacidade: rua.capacidade, ocupadas: rua.ocupadas, ibge: rua.ibge, cidade: rua.cidade, uf: rua.uf, criadaEm: rua.criada_em, listaEspera: espera },
    fundador: fundador ? { handle: fundador.handle } : null,
    moradores, lider, competicao, obra, eu,
    regras: { vinculoCompetitivo: 'a troca de rua só passa a pontuar na competição a partir do próximo fechamento (domingo 21h); pontos já feitos ficam na rua antiga' },
  };
}
