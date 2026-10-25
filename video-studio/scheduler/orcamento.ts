/* Orçamento de recursos do worker. Um render = 1 Chrome headless sem GPU (heap JS limitado a 512 MB; ~400–700 MB de
   RSS medido em 1080×1920) + 1 ffmpeg libx264 com -threads 2. Não pega job novo se faltar memória ou a máquina estiver
   carregada, para nunca disputar CPU com o servidor do jogo na mesma máquina. Limites ajustáveis por env. */
import { freemem, loadavg, cpus, platform } from 'node:os';

export const ORCAMENTO = {
  memoriaLivreMinMB: Number(process.env.STUDIO_MEM_LIVRE_MIN_MB || 1200),
  cargaMaxPorNucleo: Number(process.env.STUDIO_CARGA_MAX || 0.75),   // loadavg/núcleos (não disponível no Windows: ignorado)
};

export function temOrcamento() {
  const livre = Math.round(freemem() / 1048576);
  if (livre < ORCAMENTO.memoriaLivreMinMB) return { ok: false, motivo: `memória livre ${livre} MB < ${ORCAMENTO.memoriaLivreMinMB} MB` };
  if (platform() !== 'win32') { const c = loadavg()[0] / cpus().length; if (c > ORCAMENTO.cargaMaxPorNucleo) return { ok: false, motivo: `carga ${c.toFixed(2)} por núcleo` }; }
  return { ok: true, motivo: null };
}
