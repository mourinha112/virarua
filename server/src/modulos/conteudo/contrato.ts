/* CONTRATO DO RENDER (fonte canônica). Copiado byte a byte para video-studio/contrato/contrato.ts por
   `npm run contrato` no estúdio; o teste do estúdio falha se as cópias divergirem.
   Sem imports: o estúdio e o servidor não dependem um do outro em build.

   Regras do mega prompt §12: toda métrica tem origem rastreável; o template NUNCA recebe token, email, voto
   individual nem dado interno; placar provisório não vira vídeo de posse; patrocinado sempre identificado. */

export const CONTRATO_VERSAO = 'render-input@1';

export type TemplateId =
  | 'casa' | 'avatar' | 'convite' | 'obra' | 'exploracao' | 'desafio'
  | 'votacao' | 'virada' | 'resultado' | 'inauguracao' | 'agenda' | 'retrospectiva';

export type EleicaoStatus = 'nao_aplica' | 'em_andamento' | 'provisorio' | 'oficial' | 'sem_resultado';
export type Origem = { tipo: 'consulta' | 'evento' | 'demo'; ref: string; apurado_em: string };
export type Metrica = { chave: string; rotulo: string; valor: number | string; unidade?: string; origem: Origem };
export type AssetData = { src: string; data: string; rotulo: string; placeholder?: boolean };
export type PerfilPublico = { nome_publico: string; handle: string | null; avatar?: Record<string, string> };

export type RenderInput = {
  content_id: string;
  template_id: TemplateId;
  template_version: string;              // ex.: 'resultado@1'
  event_ids: number[];                   // domain_events que originaram o fato (vazio só em demo)
  snapshot_id: string;
  scope: { tipo: 'pais' | 'estado' | 'cidade' | 'rua' | 'eleicao' | 'estabelecimento' | 'usuario'; nome: string; uf?: string; ibge?: number };
  title: string;
  lines: { gancho: string; evidencia: string; acao: string };   // 0–2s, 2–7s, 7–12s
  metrics: Metrica[];
  before_after_assets: { antes?: AssetData; depois?: AssetData } | null;
  background_asset?: AssetData | null;   // captura do jogo real (assets/capturas/*) ou placeholder marcado
  permitted_public_profiles: PerfilPublico[];   // só quem tem aparecer_em_video = true
  cta: { texto: string; tipo: 'comentar_cidade' | 'abrir_jogo' | 'votar' | 'convidar' | 'visitar' | 'agenda'; aceita_comentario_cidade: boolean };
  election_status: EleicaoStatus;
  data_timestamp: string;                // ISO: momento dos dados (aparece no vídeo)
  sponsorship_label: string | null;      // obrigatório na inauguração patrocinada
  locale: 'pt-BR';
  demo: boolean;                         // true → selo "DEMONSTRAÇÃO · dados fictícios" sempre visível
  duration_s: number;                    // 10–20
};

/** requisitos por template (o servidor e o estúdio validam os mesmos) */
export const TEMPLATES: Record<TemplateId, {
  versao: string; nome: string; duracao: number; metricas: string[]; eleicao?: EleicaoStatus[];
  antesDepois?: boolean; patrocinio?: boolean; perfisMin?: number; ctaTipos: RenderInput['cta']['tipo'][];
}> = {
  casa: { versao: 'casa@1', nome: 'Nascimento da casa', duracao: 14, metricas: ['moradores_reivindicados'], ctaTipos: ['comentar_cidade', 'abrir_jogo'] },
  avatar: { versao: 'avatar@1', nome: 'Avatar novo', duracao: 12, metricas: ['avatares_salvos'], ctaTipos: ['abrir_jogo', 'comentar_cidade'] },
  convite: { versao: 'convite@1', nome: 'Convite de rua', duracao: 14, metricas: ['vagas', 'moradores'], ctaTipos: ['convidar', 'comentar_cidade'] },
  obra: { versao: 'obra@1', nome: 'Obra antes/depois', duracao: 16, metricas: ['casas_antes', 'casas_depois'], antesDepois: true, ctaTipos: ['abrir_jogo', 'visitar', 'comentar_cidade'] },
  exploracao: { versao: 'exploracao@1', nome: 'Exploração', duracao: 14, metricas: ['cidades_com_casas', 'visitas_semana'], ctaTipos: ['visitar', 'abrir_jogo'] },
  desafio: { versao: 'desafio@1', nome: 'Desafio da rua', duracao: 14, metricas: ['meta', 'progresso', 'prazo'], ctaTipos: ['abrir_jogo', 'convidar'] },
  votacao: { versao: 'votacao@1', nome: 'Disputa apertada', duracao: 15, metricas: ['diferenca_votos', 'candidaturas', 'prazo'], eleicao: ['em_andamento'], ctaTipos: ['votar', 'abrir_jogo'] },
  virada: { versao: 'virada@1', nome: 'Virada na apuração parcial', duracao: 15, metricas: ['diferenca_votos', 'prazo'], eleicao: ['em_andamento', 'provisorio'], ctaTipos: ['votar', 'abrir_jogo'] },
  resultado: { versao: 'resultado@1', nome: 'Resultado oficial', duracao: 15, metricas: ['cargo', 'vencedor', 'mandato_dias'], eleicao: ['oficial'], ctaTipos: ['abrir_jogo', 'comentar_cidade'] },
  inauguracao: { versao: 'inauguracao@1', nome: 'Inauguração patrocinada', duracao: 14, metricas: ['local', 'horario'], patrocinio: true, ctaTipos: ['visitar', 'agenda'] },
  agenda: { versao: 'agenda@1', nome: 'Agenda do evento', duracao: 12, metricas: ['evento', 'inicio'], ctaTipos: ['agenda', 'abrir_jogo'] },
  retrospectiva: { versao: 'retrospectiva@1', nome: 'Retrospectiva', duracao: 18, metricas: ['casas_reivindicadas', 'ruas_ativas', 'obras_concluidas'], ctaTipos: ['abrir_jogo', 'comentar_cidade'] },
};
export const TEMPLATE_IDS = Object.keys(TEMPLATES) as TemplateId[];

const CHAVES_PROIBIDAS = /^(token|access_token|refresh_token|senha|password|email|e_mail|cookie|sessao|session|ip|telefone|phone|voto|votos_individuais|voto_individual|vote|ballot|cpf|user_id|identity_id|external_id)$/i;
const VALOR_PROIBIDO: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'email'],
  [/\b(EAA|IGQ)[A-Za-z0-9_-]{10,}/, 'token da Meta'],
  [/[?&](access_token|token|code)=/i, 'token em URL'],
];
/** palavras de posse/vitória: só com election_status = 'oficial' */
export const PALAVRAS_POSSE = /\b(eleit[oa]s?|venceu|vencedor(a)?|ganhou a elei[çc][ãa]o|tomou posse|posse|empossad[oa])\b/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export type ResultadoValidacao = { ok: true; input: RenderInput } | { ok: false; erros: string[] };

function varrer(v: unknown, caminho: string, erros: string[]) {
  if (typeof v === 'string') { for (const [re, nome] of VALOR_PROIBIDO) if (re.test(v)) erros.push(`${caminho}: contém ${nome}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => varrer(x, `${caminho}[${i}]`, erros)); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (CHAVES_PROIBIDAS.test(k)) erros.push(`${caminho}.${k}: campo proibido no render`); varrer(x, `${caminho}.${k}`, erros); }
}
const texto = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** valida o input do render. Não muta. Erros em pt-BR para o painel editorial. */
export function validarRenderInput(x: any): ResultadoValidacao {
  const e: string[] = [];
  if (!x || typeof x !== 'object') return { ok: false, erros: ['input ausente'] };
  varrer(x, 'input', e);
  const t = TEMPLATES[x.template_id as TemplateId];
  if (!t) return { ok: false, erros: [...e, `template_id desconhecido: ${x.template_id}`] };
  if (x.template_version !== t.versao) e.push(`template_version ${x.template_version} ≠ ${t.versao}`);
  if (!texto(x.content_id, 80)) e.push('content_id obrigatório');
  if (!texto(x.snapshot_id, 80)) e.push('snapshot_id obrigatório');
  if (!Array.isArray(x.event_ids) || !x.event_ids.every((n: unknown) => Number.isInteger(n) && (n as number) > 0)) e.push('event_ids deve ser lista de ids inteiros');
  else if (!x.demo && x.event_ids.length === 0) e.push('fato real sem event_ids: origem não rastreável');
  if (!x.scope || !texto(x.scope.nome, 60) || !['pais', 'estado', 'cidade', 'rua', 'eleicao', 'estabelecimento', 'usuario'].includes(x.scope.tipo)) e.push('scope inválido');
  if (!texto(x.title, 80)) e.push('title obrigatório (até 80)');
  if (!x.lines || !texto(x.lines.gancho, 90) || !texto(x.lines.evidencia, 110) || !texto(x.lines.acao, 110)) e.push('lines.gancho/evidencia/acao obrigatórios (90/110/110)');
  if (!Array.isArray(x.metrics)) e.push('metrics deve ser lista');
  else {
    for (const [i, m] of x.metrics.entries()) {
      if (!m || !texto(m.chave, 40) || !texto(m.rotulo, 60) || !(typeof m.valor === 'number' ? Number.isFinite(m.valor) : texto(m.valor, 60))) e.push(`metrics[${i}] inválida`);
      else if (!m.origem || !['consulta', 'evento', 'demo'].includes(m.origem.tipo) || !texto(m.origem.ref, 200) || !ISO.test(m.origem.apurado_em || '')) e.push(`metrics[${i}] (${m.chave}) sem origem rastreável`);
      else if (m.origem.tipo === 'demo' && !x.demo) e.push(`metrics[${i}] (${m.chave}) é dado demo num conteúdo real`);
    }
    for (const k of t.metricas) if (!x.metrics.some((m: Metrica) => m?.chave === k)) e.push(`métrica obrigatória ausente: ${k}`);
    const vagas = x.metrics.find((m: Metrica) => m?.chave === 'vagas');
    if (x.template_id === 'convite' && vagas && !(typeof vagas.valor === 'number' && vagas.valor > 0)) e.push('convite exige vagas realmente disponíveis (> 0)');
  }
  if (!['nao_aplica', 'em_andamento', 'provisorio', 'oficial', 'sem_resultado'].includes(x.election_status)) e.push('election_status inválido');
  if (t.eleicao && !t.eleicao.includes(x.election_status)) e.push(`template ${x.template_id} exige election_status em [${t.eleicao.join(', ')}], veio ${x.election_status}`);
  if (x.election_status !== 'oficial') {
    const txt = [x.title, x.lines?.gancho, x.lines?.evidencia, x.lines?.acao, x.cta?.texto].filter(Boolean).join(' ');
    if (PALAVRAS_POSSE.test(txt)) e.push('texto anuncia vencedor/posse sem resultado oficial');
  }
  if (t.antesDepois) {
    const a = x.before_after_assets;
    if (!a?.antes || !a?.depois || !texto(a.antes.src, 300) || !texto(a.depois.src, 300) || !ISO.test(a.antes.data || '') || !ISO.test(a.depois.data || '')) e.push('obra exige before_after_assets.antes/depois com src e data');
    else if (Date.parse(a.antes.data) >= Date.parse(a.depois.data)) e.push('antes deve ser anterior ao depois');
  }
  if (t.patrocinio && !texto(x.sponsorship_label, 40)) e.push('inauguração patrocinada exige sponsorship_label');
  if (x.sponsorship_label != null && !texto(x.sponsorship_label, 40)) e.push('sponsorship_label inválido');
  if (!Array.isArray(x.permitted_public_profiles)) e.push('permitted_public_profiles deve ser lista');
  else for (const [i, p] of x.permitted_public_profiles.entries()) if (!p || !texto(p.nome_publico, 30) || !(p.handle === null || texto(p.handle, 31))) e.push(`permitted_public_profiles[${i}] inválido`);
  if (!x.cta || !texto(x.cta.texto, 70) || !t.ctaTipos.includes(x.cta.tipo) || typeof x.cta.aceita_comentario_cidade !== 'boolean') e.push(`cta inválido (tipos aceitos: ${t.ctaTipos.join(', ')})`);
  else if (x.cta.tipo === 'comentar_cidade' && !x.cta.aceita_comentario_cidade) e.push('CTA pede cidade mas o post não aceita comentários de cidade');
  if (!ISO.test(x.data_timestamp || '')) e.push('data_timestamp ISO obrigatório');
  if (x.locale !== 'pt-BR') e.push('locale deve ser pt-BR');
  if (typeof x.demo !== 'boolean') e.push('demo obrigatório (boolean)');
  if (!(typeof x.duration_s === 'number' && x.duration_s >= 10 && x.duration_s <= 20)) e.push('duration_s entre 10 e 20');
  for (const k of ['background_asset'] as const) if (x[k] != null && (!texto(x[k].src, 300) || !texto(x[k].rotulo, 80))) e.push(`${k} inválido`);
  if (!x.demo) for (const a of [x.background_asset, x.before_after_assets?.antes, x.before_after_assets?.depois]) if (a?.placeholder) e.push('asset placeholder em conteúdo real');
  return e.length ? { ok: false, erros: e } : { ok: true, input: x as RenderInput };
}
