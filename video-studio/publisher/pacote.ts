/* Pacote de publicação MANUAL (modo padrão, dry-run): MP4 + thumbnail + legenda + manifesto com status honesto.
   O estúdio NUNCA publica: não tem token da Meta (a custódia do token é do servidor, criptografado em
   instagram_connections) e não usa senha nem bot de navegador. O InstagramPublisher oficial (Graph API, container →
   status → media_publish, com reconciliação antes de retry) fica em server/src/modulos/conteudo/publicador.ts e só
   liga com IG_ADAPTADOR=oficial + KILL_PUBLICACAO=0 + PUBLICACAO_OFICIAL=sim + conexão ativa + URL pública de mídia. */
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import type { RenderInput } from '../contrato/contrato.ts';
import type { Inspecao } from '../renderers/tipos.ts';

const TZ = 'America/Sao_Paulo';
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** legenda sem dado sensível; identifica jogo virtual, placar parcial, patrocínio e demonstração */
export function legendaManual(i: RenderInput) {
  const p = [i.title, '', i.lines.evidencia, i.lines.acao, '', i.cta.texto];
  if (i.election_status === 'em_andamento' || i.election_status === 'provisorio') p.push('', 'Placar parcial do jogo virtual; o resultado só vale depois da apuração.');
  if (i.sponsorship_label) p.push('', `#publi · ${i.sponsorship_label}`);
  p.push('', `Jogo virtual Seu Mundo Novo · dados de ${quando(i.data_timestamp)}`);
  if (i.demo) p.unshift('DEMONSTRAÇÃO · dados fictícios', '');
  return p.join('\n');
}

export function gerarPacote(i: RenderInput, arquivos: { mp4: string; thumb: string; inspecao: Inspecao }, dir: string) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(arquivos.mp4, resolve(dir, 'video.mp4'));
  copyFileSync(arquivos.thumb, resolve(dir, 'thumbnail.jpg'));
  writeFileSync(resolve(dir, 'legenda.txt'), legendaManual(i));
  writeFileSync(resolve(dir, 'manifesto.json'), JSON.stringify({
    status: 'NAO_PUBLICADO: pacote para publicação manual (dry-run). Nenhuma chamada externa foi feita.',
    template_version: i.template_version, snapshot_id: i.snapshot_id, content_id: i.content_id, event_ids: i.event_ids, demo: i.demo,
    fatos: i.metrics, election_status: i.election_status, patrocinio: i.sponsorship_label, perfis_publicos: i.permitted_public_profiles.length,
    origem_mp4: basename(arquivos.mp4), inspecao: arquivos.inspecao,
  }, null, 2));
  return dir;
}
