/* Pontos de extensão para outras frentes, sem acoplamento de import circular:
   - Fase 4 (eleições) registra quem é o líder da rua;
   - Fase 3 (recompensas/competição/obras) registra o estado da competição e da obra comunitária;
   - Fase 5 (estabelecimentos) e eventos registram destinos extras de uma cidade.
   Se nenhum provedor estiver registrado, a API devolve { disponivel: false } e o front mostra isso (estado real). */
import type { Exec } from '../../db/db';

export type Lider = { userId: string; handle: string | null; desde: string; ate: string | null } | null;
export type Competicao = { disponivel: true; temporada: string; posicao: number | null; pontos: number; modo: 'competitiva' | 'cooperativa'; fechaEm: string; detalhes?: Record<string, unknown> };
export type Obra = { disponivel: true; nome: string; progresso: number; meta: number; estado: string; detalhes?: Record<string, unknown> };
export type DestinoExtra = { tipo: 'venue' | 'event'; refId: string; nome: string; capacidade: number; patrocinado?: boolean; detalhes?: Record<string, unknown> };

type Provedores = {
  liderDaRua?: (streetId: string, ex: Exec) => Promise<Lider>;
  /** quem pode aprovar pedidos de entrada em rua privada (além do fundador) */
  podeModerarRua?: (streetId: string, userId: string, ex: Exec) => Promise<boolean>;
  competicaoDaRua?: (streetId: string, ex: Exec) => Promise<Competicao | null>;
  obraDaRua?: (streetId: string, ex: Exec) => Promise<Obra | null>;
  destinosDaCidade?: (ibge: number, ex: Exec) => Promise<DestinoExtra[]>;
};
const P: Provedores = {};
const destinosExtras: NonNullable<Provedores['destinosDaCidade']>[] = [];

export function registrarProvedor<K extends keyof Provedores>(k: K, f: NonNullable<Provedores[K]>) {
  if (k === 'destinosDaCidade') destinosExtras.push(f as any); else (P as any)[k] = f;
}
export const provedor = P;
export async function destinosExtrasDaCidade(ibge: number, ex: Exec): Promise<DestinoExtra[]> {
  const out: DestinoExtra[] = [];
  for (const f of destinosExtras) { try { out.push(...(await f(ibge, ex))); } catch (e) { console.error('[social] provedor de destinos falhou', e); } }
  return out;
}
