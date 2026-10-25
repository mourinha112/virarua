/* Interface comum dos renderizadores. Adaptador principal: HtmlRenderer (HTML → quadros no Chrome → ffmpeg H.264),
   compatível com o contrato de seek da Motionmaxxing (window.__seek/__duration/__ready). Um adaptador Remotion seria
   opcional e NÃO existe: não foi necessário. */
import type { RenderInput, ResultadoValidacao } from '../contrato/contrato.ts';

export type OpcoesRender = {
  saida: string;              // caminho do .mp4
  escala?: number;            // 1 = 1080×1920 (produção); <1 só para testes/rascunho
  sinal?: AbortSignal;        // cancelamento
  progresso?: (quadro: number, total: number) => void;
  crf?: number;
};
export type ResultadoRender = { mp4: string; quadros: number; duracao_s: number; largura: number; altura: number; ms: number; fontes: Record<string, boolean>; avisos: string[] };
export type Inspecao = {
  ok: boolean; erros: string[];
  largura: number; altura: number; fps: number; duracao_s: number; quadros: number | null; codec: string; pix_fmt: string; tem_audio: boolean;
  luminancia: number[]; parado_max_s: number;
};
export type Esperado = { largura?: number; altura?: number; fps?: number; duracao_s?: number };

export interface RendererAdapter {
  readonly nome: string;
  validateInput(x: unknown): ResultadoValidacao;
  render(input: RenderInput, o: OpcoesRender): Promise<ResultadoRender>;
  thumbnail(input: RenderInput, o: { saida: string; t?: number; escala?: number }): Promise<string>;
  inspectOutput(mp4: string, esperado?: Esperado): Promise<Inspecao>;
}
