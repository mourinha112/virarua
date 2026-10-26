/* Ofensiva: dias seguidos com pelo menos 1 missão feita. Vale até ontem (hoje ainda dá tempo de manter).
   Marcos 3, 7 e 30 dias dão XP uma vez por marco atingido (chave com o dia). */
import type { Exec } from '../../db/db';
import { conceder } from './ledger';
import { diaJogo, somarDias } from './regras';

export const MARCOS: [number, string][] = [[30, 'xp50_ofensiva@1'], [7, 'xp20_ofensiva@1'], [3, 'xp10_ofensiva@1']];

/** { dias, hoje } — dias = sequência atual; hoje = já fez missão hoje */
export async function ofensivaDe(c: Exec, userId: string, agora = new Date()) {
  const hoje = diaJogo(agora);
  const rows = (await c.query(`select distinct to_char(dia, 'YYYY-MM-DD') d from mission_completions where user_id = $1 and dia <= $2 and dia > $2::date - 400 order by 1 desc`, [userId, hoje])).rows as { d: string }[];
  const set = new Set(rows.map((r) => r.d));
  const fezHoje = set.has(hoje);
  let dia = fezHoje ? hoje : somarDias(hoje, -1), n = 0;
  while (set.has(dia)) { n++; dia = somarDias(dia, -1); }
  return { dias: n, hoje: fezHoje };
}

/** depois de concluir uma missão: paga o marco se a sequência acabou de chegar nele */
export async function premiarOfensiva(c: Exec, userId: string, agora = new Date()) {
  const o = await ofensivaDe(c, userId, agora);
  const marco = MARCOS.find(([n]) => o.dias === n);
  if (!marco) return null;
  const r = await conceder(c, { userId, regraId: marco[1], eventoRef: `ofensiva:${marco[0]}:${diaJogo(agora)}`, origem: 'ofensiva', agora });
  return r.duplicado ? null : { dias: marco[0], xp: r.quantidade };
}
