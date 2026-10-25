/* Ajudantes dos testes da Fase 4 (eleições virtuais). Relógio sempre explícito: a temporada de teste é a semana
   seguinte à data real, para que os moradores das fixtures (verificados há 3 dias) já sejam elegíveis. */
import { tx, q, q1 } from '../src/db/db';
import { garantirEleicao, candidatar, votar, avancarEleicao } from '../src/modulos/eleicoes/dominio';
import { calcularCalendario, segundaDaSemana, REGRAS_PADRAO, type Cargo } from '../src/modulos/eleicoes/regras';
import { moradorTeste, ruaTeste, sessaoTeste, type Morador } from './fixtures';
import { cliente } from './ajuda';

export function semana(diasAFrente = 7) {
  return calcularCalendario(REGRAS_PADRAO, segundaDaSemana('America/Sao_Paulo', new Date(Date.now() + diasAFrente * 86400_000)));
}
export const mais = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
/** instantes úteis da temporada */
export function tempos(diasAFrente = 7) {
  const T = semana(diasAFrente);
  return { T, inscr: mais(T.inscricoesAbrem, 60), votando: mais(T.votacaoAbre, 60), fechou: T.votacaoFecha, publica: mais(T.publicaEm, 1) };
}

export async function eleicaoDe(cargo: Cargo, escopoId: string, agora: Date) { return tx((c) => garantirEleicao(c, cargo, escopoId, agora)); }

/** cidade com uma rua e n moradores elegíveis */
export async function cidade(ibge: number, n: number, capacidade = 60): Promise<{ rua: string; m: Morador[] }> {
  const rua = await ruaTeste(ibge, undefined, capacidade); const m: Morador[] = [];
  for (let i = 0; i < n; i++) m.push(await moradorTeste(ibge, { rua }));
  return { rua, m };
}

export async function inscrever(ms: Morador[], cargo: Cargo, eleicaoId: string, agora: Date) {
  const ids: string[] = [];
  for (const x of ms) ids.push((await candidatar(x.userId, eleicaoId, { cargo }, agora)).candidatoId);
  return ids;
}
/** votos: lista de [eleitor, candidatoId | 'rejeitar'] */
export async function votarTodos(eleicaoId: string, votos: [Morador, string][], agora: Date) {
  for (const [m, k] of votos) await votar(m.userId, eleicaoId, k, agora);
}
export async function estado(eleicaoId: string) {
  return (await q1<any>(`select * from elections where id = $1`, [eleicaoId]))!;
}
export async function mandatos(cargo: string, escopoId: string) {
  return q<any>(`select * from office_terms where cargo = $1 and escopo_id = $2 order by criado_em`, [cargo, escopoId]);
}
export async function eventos(tipo: string, filtro?: (d: any) => boolean) {
  const r = await q<{ dados: any }>(`select dados from domain_events where tipo = $1 order by id`, [tipo]);
  return r.map((x) => x.dados).filter((d) => !filtro || filtro(d));
}
export async function tornarAdmin(userId: string) { await q(`insert into admin_roles (user_id, papel) values ($1, 'moderador') on conflict do nothing`, [userId]); }

/** cliente HTTP autenticado como o usuário (IP próprio para não somar no limite por IP de outros testes) */
export async function clienteDe(userId: string, ip = '10.4.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250)) {
  const k = cliente(); k.jar.set('smn_sess', await sessaoTeste(userId)); await k.aquecer();
  const h = { 'x-forwarded-for': ip };
  return { ...k, get: (p: string) => k.req('GET', p, undefined, h), post: (p: string, b?: unknown) => k.req('POST', p, b, h) };
}

export { avancarEleicao, votar, candidatar };
