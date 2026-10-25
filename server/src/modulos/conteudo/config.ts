/* Configuração do pipeline de conteúdo (Fase 6). Os kill switches e o autopublish vêm do núcleo (config.ts):
   config.kill.render, config.kill.publicacao (padrão LIGADO = nada sai), config.publicacao.autopublish (padrão false),
   config.publicacao.maxPostsDia (padrão 1 orgânico/dia). Aqui ficam só os parâmetros próprios do módulo. */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const num = (k: string, d: number) => { const v = Number(process.env[k]); return process.env[k] && Number.isFinite(v) ? v : d; };
const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export const conteudoConfig = {
  /** token do worker do video-studio na API interna (/interno/conteudo/*). Vazio = API interna desligada. */
  tokenEstudio: process.env.CONTEUDO_TOKEN_ESTUDIO || '',
  /** limite de renders simultâneos entregues aos workers (CPU: 1 render ≈ 1 Chrome + 1 ffmpeg ≈ 1,5 núcleo e ~700 MB) */
  renderMaxSimultaneos: num('RENDER_MAX_SIMULTANEOS', 1),
  /** lease de um render: se o worker sumir, o job volta para a fila depois disso */
  renderLeaseMin: num('RENDER_LEASE_MIN', 10),
  /** versão do runtime de render (entra na chave de cache) */
  renderRuntime: process.env.RENDER_RUNTIME || 'smn-html@1',
  /** teto diário de posts patrocinados (separado do orgânico) */
  maxPatrocinadosDia: num('POSTS_PATROCINADOS_DIA', 1),
  /** horário padrão de publicação (hora local de São Paulo) */
  horaPadrao: num('POST_HORA', 19),
  /** intervalo mínimo entre posts no perfil oficial (min) */
  intervaloMinimoMin: num('POST_INTERVALO_MIN', 180),
  /** mesma categoria na mesma cidade: no máximo 1 pauta a cada N horas (exceto calendário eleitoral) */
  rodizioHoras: num('PAUTA_RODIZIO_H', 48),
  /** validade padrão de um fato sem prazo explícito */
  validadeFatoH: num('FATO_VALIDADE_H', 72),
  /** tentativas de publicação antes de 'failed' */
  maxTentativasPublicacao: num('PUBLICACAO_TENTATIVAS', 5),
  /** pacotes de publicação manual (dry-run) */
  dirPacotes: process.env.CONTEUDO_DIR_PACOTES || resolve(raizRepo, 'video-studio/out/publicacao'),
  /** capturas do jogo usadas como fundo (cidade-<ibge>.png tem prioridade sobre a genérica do template) */
  dirCapturas: process.env.CONTEUDO_DIR_CAPTURAS || resolve(raizRepo, 'video-studio/assets/capturas'),
  /** saída dos renders (o worker do estúdio grava aqui; em produção, storage de objetos) */
  dirRenders: process.env.CONTEUDO_DIR_RENDERS || resolve(raizRepo, 'video-studio/out/jobs'),
};
