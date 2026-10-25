/* Ajudantes dos testes da Fase 3 (dados sintéticos). Resolve desafios lendo o gabarito do banco — o teste faz o
   papel de um jogador honesto; o cliente real nunca recebe o gabarito. */
import { q1, q, tx } from '../src/db/db';
import { moradorTeste, ruaTeste, type Morador } from './fixtures';
import { instanteLocal, somarDias } from '../src/modulos/recompensas/regras';

/** resposta correta de um desafio emitido */
export async function resposta(id: string): Promise<any> {
  const d = (await q1<{ tipo: string; gabarito: any }>(`select tipo, gabarito from server_challenges where id = $1`, [id]))!;
  if (d.tipo === 'conta' || d.tipo === 'peca') return d.gabarito.resposta;
  if (d.tipo === 'sequencia') return d.gabarito.sequencia;
  if (d.tipo === 'quiz') return d.gabarito.certas;
  return d.gabarito.celulas;
}
export const mais = (d: Date, seg: number) => new Date(d.getTime() + seg * 1000);
/** quarta-feira 12h (local) da semana n a partir de 06/01/2031 — cada teste usa uma temporada própria */
export const semana = (n: number, diaDaSemana = 2) => instanteLocal(somarDias('2031-01-06', n * 7 + diaDaSemana), 12);

/** rua com `n` moradores na cidade */
export async function ruaCom(ibge: number, n: number, nome?: string): Promise<{ rua: string; moradores: Morador[] }> {
  const rua = await ruaTeste(ibge, nome);
  const moradores: Morador[] = [];
  for (let i = 0; i < n; i++) moradores.push(await moradorTeste(ibge, { rua }));
  return { rua, moradores };
}

/** muda o morador de rua (fecha a membership atual e abre outra) */
export async function mudarDeRua(m: Morador, novaRua: string) {
  await q(`update street_memberships set saiu_em = now(), motivo_saida = 'troca' where house_id = $1 and saiu_em is null`, [m.houseId]);
  await q(`insert into street_memberships (street_id, house_id) values ($1, $2)`, [novaRua, m.houseId]);
  m.streetId = novaRua;
}

export async function somaLedger(userId: string, sistema: string) {
  return (await q1<{ s: number }>(`select coalesce(sum(quantidade), 0)::int s from reward_ledger where user_id = $1 and sistema = $2`, [userId, sistema]))!.s;
}

/** conclui uma missão como jogador honesto (desafio → espera → resposta) */
export async function fazerMissao(userId: string, missao: string, agora: Date) {
  const { desafioMissao, concluirMissao } = await import('../src/modulos/recompensas/missoes');
  const d = await tx((c) => desafioMissao(c, userId, missao, agora));
  const r = await resposta(d.id);
  return tx((c) => concluirMissao(c, userId, missao, { desafio_id: d.id, resposta: r }, mais(agora, 10)));
}
