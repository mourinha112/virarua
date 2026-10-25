/* módulo mundo: jobs de provisionamento/retensão. O provisionamento em si está em provisionar.ts (chamado pelo Instagram). */
import type { App } from '../../http/app';
import { config } from '../../config';
import { db, tx } from '../../db/db';
import { enfileirar, registrarJob } from '../../jobs/fila';
import { expirarReservas } from './provisionar';

export const JOB_EXPIRAR = 'mundo.expirar_reservas';
const chaveHora = (d = new Date()) => `${JOB_EXPIRAR}:${d.toISOString().slice(0, 13)}`;

/** agenda a próxima rodada (uma por hora; a chave idempotente impede duplicar) */
export async function agendarExpiracao(emSeg = 3600) {
  return enfileirar(db(), JOB_EXPIRAR, {}, chaveHora(new Date(Date.now() + emSeg * 1000)), emSeg);
}

let agendado = false;
export function registrar(_app: App) {
  registrarJob(JOB_EXPIRAR, async () => {
    for (let i = 0; i < 50; i++) { const n = await tx((c) => expirarReservas(c, 200)); if (n < 200) break; }
    await agendarExpiracao();
  });
  if (!agendado && config.ambiente !== 'teste') {
    agendado = true;
    setTimeout(() => { agendarExpiracao(5).catch(() => { /* banco ainda subindo: a próxima subida agenda */ }); }, 2000).unref?.();
  }
}
