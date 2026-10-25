/* Ciclo periódico (job 'eleicoes.ciclo'): cria a temporada, avança eleições vencidas, atualiza placar provisório
   (detecta virada), encerra mandatos no fim fixo e aplica vacância. Idempotente: pode rodar em vários workers. */
import { tx, q, emitir } from '../../db/db';
import { carregarRegras } from './regras';
import { garantirTemporada, avancarEleicao, contarVotos, type Eleicao } from './dominio';
import { expirarMandatos, verificarOcupantes } from './cargos';

export async function atualizarPlacares(agora: Date) {
  const abertas = await q<Eleicao>(`select * from elections where estado = 'votacao' and votacao_abre <= $1 and votacao_fecha > $1`, [agora]);
  let viradas = 0;
  for (const e0 of abertas) {
    await tx(async (c) => {
      const e = (await q<Eleicao>(`select * from elections where id = $1 for update skip locked`, [e0.id], c))[0];
      if (!e || e.estado !== 'votacao') return;
      const regras = await carregarRegras(c, e.regra_id);
      const { totais } = await contarVotos(c, e.id);
      const lider = totais[0] && totais[0].votos > 0 && (totais.length === 1 || totais[1].votos < totais[0].votos) ? totais[0].candidatoId : null;
      // virada só é anunciada com eleitorado grande o bastante para não expor votos individuais
      if (lider && e.lider_provisorio && lider !== e.lider_provisorio && (e.eleitorado ?? 0) >= regras.placarMinEleitorado) {
        await emitir(c, 'eleicao.virada', { eleicaoId: e.id, cargo: e.cargo, escopoId: e.escopo_id, escopoNome: e.escopo_nome, liderCandidatoId: lider, provisorio: true, virtual: true }, `virada:${e.id}:${agora.getTime()}`);
        viradas++;
      }
      await q(`update elections set lider_provisorio = coalesce($2, lider_provisorio), placar_atualizado_em = $3 where id = $1`, [e.id, lider, agora], c);
    });
  }
  return viradas;
}

export async function ciclo(agora: Date) {
  await tx((c) => garantirTemporada(c, agora));
  const vencidas = await q<{ id: string }>(
    `select id from elections where (estado = 'inscricoes' and inscricoes_fecham <= $1) or (estado = 'congelada' and votacao_abre <= $1)
        or (estado = 'votacao' and votacao_fecha <= $1) or (estado = 'apuracao' and publica_em <= $1) order by votacao_fecha limit 500`, [agora]);
  for (const v of vencidas) await avancarEleicao(v.id, agora);
  const viradas = await atualizarPlacares(agora);
  const encerrados = await expirarMandatos(agora);
  const vagos = await verificarOcupantes(agora);
  return { avancadas: vencidas.length, viradas, encerrados, vagos };
}
