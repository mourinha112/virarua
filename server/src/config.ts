/* Configuração do servidor a partir do ambiente. Nada de segredo no front. Ver .env.example. */
const env = (k: string, d?: string) => process.env[k] ?? d;
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] !== '' && process.env[k] !== undefined ? v : d; };
const bool = (k: string, d: boolean) => { const v = process.env[k]; return v === undefined ? d : /^(1|true|sim|yes|on)$/i.test(v); };

export const config = {
  ambiente: env('SMN_AMBIENTE', 'dev') as 'dev' | 'teste' | 'producao',
  porta: num('PORT', 8787),
  databaseUrl: env('DATABASE_URL', 'postgres://smn@127.0.0.1:54329/smn_dev')!,
  urlPublica: env('SMN_URL_PUBLICA', 'http://localhost:5173')!,
  /** segredo para HMAC internos (cookies assinados); obrigatório em produção */
  segredo: env('SMN_SEGREDO', 'dev-apenas-nao-usar-em-producao')!,
  instagram: {
    /** 'oficial' usa a Graph API; 'dev' é o adaptador de desenvolvimento (nunca envia nada para fora) */
    adaptador: env('IG_ADAPTADOR', 'dev') as 'oficial' | 'dev',
    appSecret: env('IG_APP_SECRET', ''),
    verifyToken: env('IG_VERIFY_TOKEN', ''),
    /** id da conta profissional oficial conectada (escopo dos ids de autor) */
    contaId: env('IG_CONTA_ID', ''),
    graphVersao: env('IG_GRAPH_VERSAO', 'v26.0'), // versão dos exemplos da doc oficial consultada em 24/10/2026 (docs/meta-instagram.md)
    /** token da conta oficial: guardado CRIPTOGRAFADO no banco (instagram_connections); a env só serve para bootstrap */
    tokenBootstrap: env('IG_TOKEN', ''),
    payloadMaxBytes: num('IG_PAYLOAD_MAX', 256 * 1024),
  },
  reivindicacao: {
    validadeLinkMin: num('CLAIM_LINK_MIN', 30),
    validadeDesafioMin: num('CLAIM_DESAFIO_MIN', 20),
    retencaoReservaDias: num('RESERVA_DIAS', 30),
  },
  ruas: { capacidadeInicial: num('RUA_CAPACIDADE', 24) },
  presenca: { expiraSeg: num('PRESENCA_SEG', 90) },
  /** kill switches separados (jogo/eventos, render, publicação) */
  kill: { eventos: bool('KILL_EVENTOS', false), render: bool('KILL_RENDER', false), publicacao: bool('KILL_PUBLICACAO', true) },
  /** publicação externa só com ativação explícita; nesta fase é sempre dry-run */
  publicacao: { autopublish: bool('AUTOPUBLISH', false), maxPostsDia: num('POSTS_DIA', 1) },
  ia: { provedor: env('IA_PROVEDOR', ''), chave: env('IA_CHAVE', '') },
  /** chave de 32 bytes (hex) para AES-256-GCM dos tokens em repouso */
  chaveCripto: env('SMN_CHAVE_CRIPTO', '0'.repeat(64))!,
  fusoJogo: 'America/Sao_Paulo',
};

export function validarConfigProducao() {
  const erros: string[] = [];
  if (config.ambiente !== 'producao') return erros;
  if (config.segredo.startsWith('dev-')) erros.push('SMN_SEGREDO não configurado');
  if (/^0+$/.test(config.chaveCripto)) erros.push('SMN_CHAVE_CRIPTO não configurada');
  if (config.instagram.adaptador === 'oficial' && (!config.instagram.appSecret || !config.instagram.verifyToken || !config.instagram.contaId)) erros.push('credenciais do Instagram incompletas');
  return erros;
}
