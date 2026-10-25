/* inspectOutput: confere o MP4 com ffprobe/ffmpeg em vez de confiar no próprio render (lição da Motionmaxxing:
   "um vídeo preto de 15 s já foi certificado como limpo"). G0: decodifica, não é vazio, a imagem muda, duração bate. */
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import type { Esperado, Inspecao } from './tipos.ts';

const FFPROBE = process.env.FFPROBE || 'ffprobe', FFMPEG = process.env.FFMPEG || 'ffmpeg';

export function inspecionar(mp4: string, esperado: Esperado = {}): Inspecao {
  const erros: string[] = [];
  const vazio: Inspecao = { ok: false, erros, largura: 0, altura: 0, fps: 0, duracao_s: 0, quadros: null, codec: '', pix_fmt: '', tem_audio: false, luminancia: [], parado_max_s: 0 };
  if (!existsSync(mp4) || statSync(mp4).size < 1024) { erros.push('arquivo ausente ou vazio'); return vazio; }
  const p = spawnSync(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-count_frames', '-of', 'json', mp4], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (p.status !== 0) { erros.push('ffprobe falhou: ' + (p.stderr || '').slice(0, 300)); return vazio; }
  const j = JSON.parse(p.stdout);
  const v = (j.streams || []).find((s: any) => s.codec_type === 'video');
  if (!v) { erros.push('sem stream de vídeo'); return vazio; }
  const [a, b] = String(v.avg_frame_rate || v.r_frame_rate || '0/1').split('/').map(Number);
  const fps = b ? a / b : 0;
  const duracao = Number(v.duration || j.format?.duration || 0);
  const quadros = v.nb_read_frames ? Number(v.nb_read_frames) : null;
  const r: Inspecao = { ok: false, erros, largura: v.width, altura: v.height, fps: Math.round(fps * 1000) / 1000, duracao_s: Math.round(duracao * 1000) / 1000, quadros, codec: v.codec_name, pix_fmt: v.pix_fmt, tem_audio: (j.streams || []).some((s: any) => s.codec_type === 'audio'), luminancia: [], parado_max_s: 0 };

  // luminância média a cada 1 s (não é preto/branco chapado) e maior trecho parado (freezedetect)
  const f = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', mp4, '-vf', "select='not(mod(n\\,30))',signalstats,metadata=print:key=lavfi.signalstats.YAVG,freezedetect=n=0.002:d=0.5", '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const txt = (f.stderr || '') + (f.stdout || '');
  r.luminancia = [...txt.matchAll(/YAVG=([\d.]+)/g)].map((m) => Math.round(Number(m[1])));
  // freezedetect roda sobre os quadros amostrados (1 por segundo): duração em amostras ≈ segundos
  const congel = [...txt.matchAll(/freeze_duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  r.parado_max_s = congel.length ? Math.max(...congel) : 0;

  if (r.codec !== 'h264') erros.push(`codec ${r.codec} (esperado h264)`);
  if (r.pix_fmt !== 'yuv420p') erros.push(`pix_fmt ${r.pix_fmt} (esperado yuv420p)`);
  if (r.tem_audio) erros.push('tem áudio (render deve ser sem áudio externo)');
  if (esperado.largura && r.largura !== esperado.largura) erros.push(`largura ${r.largura} ≠ ${esperado.largura}`);
  if (esperado.altura && r.altura !== esperado.altura) erros.push(`altura ${r.altura} ≠ ${esperado.altura}`);
  if (esperado.fps && Math.abs(r.fps - esperado.fps) > 0.01) erros.push(`fps ${r.fps} ≠ ${esperado.fps}`);
  if (esperado.duracao_s && Math.abs(r.duracao_s - esperado.duracao_s) > 1 / 30 + 0.001) erros.push(`duração ${r.duracao_s}s ≠ ${esperado.duracao_s}s`);
  if (!r.luminancia.length) erros.push('não foi possível amostrar quadros');
  else {
    if (r.luminancia.every((y) => y < 20)) erros.push('vídeo preto');
    if (r.luminancia.every((y) => y > 240)) erros.push('vídeo branco');
    if (new Set(r.luminancia).size === 1 && r.luminancia.length > 3) erros.push('imagem não muda');
  }
  r.ok = erros.length === 0;
  return r;
}
