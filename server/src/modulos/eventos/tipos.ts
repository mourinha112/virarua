/* Schema EventDefinition (seção 21 do mega prompt) e vocabulários fechados usados pelo validador. */

export const CATEGORIAS = ['boas_vindas', 'casa_visual', 'obra_comunitaria', 'exploracao', 'social', 'eleicao_editorial', 'competicao', 'cidade', 'estabelecimentos', 'memoria'] as const;
export const ESCOPOS = ['usuario', 'rua', 'cidade', 'regional', 'nacional'] as const;
/** motores reutilizáveis (não 60 minijogos) */
export const MOTORES = ['exploracao', 'contribuicao', 'quiz', 'decoracao', 'reacao', 'presenca', 'social', 'calendario'] as const;
/** regras de conclusão aceitas por motor (o validador recusa combinações sem implementação) */
export const CONCLUSOES: Record<Motor, readonly string[]> = {
  exploracao: ['cidades_distintas', 'simbolos_encontrados'],
  contribuicao: ['contribuicoes_min', 'obra_concluida_contribuida'],
  quiz: ['acertos_min'],
  decoracao: ['configuracao_valida', 'escolha_valida'],
  reacao: ['sequencia_correta'],
  presenca: ['locais_com_acao'],
  social: ['interacoes_validas'],
  calendario: ['confirmacao'],
};
/** pré-requisitos conhecidos: por usuário (checados ao participar) e por instância (checados pelo planejador) */
export const PREREQ_USUARIO = ['casa_reivindicada', 'membro_de_rua', 'amizades_disponiveis'] as const;
export const PREREQ_INSTANCIA = ['fato', 'competicao_ativa', 'rua_aniversario', 'obra_concluida_na_cidade', 'duas_cidades_ativas'] as const;

export type Categoria = (typeof CATEGORIAS)[number];
export type Escopo = (typeof ESCOPOS)[number];
export type Motor = (typeof MOTORES)[number];
export type Prerequisito = { tipo: (typeof PREREQ_USUARIO)[number] | (typeof PREREQ_INSTANCIA)[number]; fato?: string; dias?: number; exige?: 'campeas' };

export type EventDefinition = {
  id: string;                         // 'E01'..'E60'
  version: number;
  category: Categoria;
  title: string;
  description: string;
  scope: Escopo;
  mechanic: { motor: Motor; params: Record<string, any> };
  prerequisites: Prerequisito[];
  min_participants: number;
  duration: { tipo: 'permanente' } | { tipo: 'janela'; horas: number; hora_local?: number };
  cooldown: { tipo: 'unica_por_conta' } | { tipo: 'horas'; horas: number };
  enrollment: 'automatica' | 'opt_in';
  completion_rule: { tipo: string; [k: string]: any };
  reward_rule_id: string;
  limits: { por_usuario_edicao: number; por_usuario_dia?: number; max_instancias_simultaneas_cidade?: number };
  visual_asset_ids: string[];
  content_template_ids: string[];
  cta: { texto: string; acao: string };
  cancellation_rule: { tipo: 'nunca' | 'min_participantes_no_fim' | 'min_participantes_no_inicio' | 'fato_revogado' };
  moderation_policy: 'sem_texto_livre' | 'opcoes_pre_aprovadas' | 'revisao_humana';
  /** fallback para população pequena (seção 22) */
  small_population_fallback: string;
  enabled: boolean;
  disabled_reason?: string;
};

export const ESTADOS = ['proposed', 'validated', 'scheduled', 'announced', 'enrolling', 'active', 'resolving', 'completed', 'cancelled', 'archived'] as const;
export type Estado = (typeof ESTADOS)[number];
/** transições permitidas da máquina de estados da EventInstance */
export const TRANSICOES: Record<Estado, Estado[]> = {
  proposed: ['validated', 'cancelled'],
  validated: ['scheduled', 'cancelled'],
  scheduled: ['announced', 'cancelled'],
  announced: ['enrolling', 'cancelled'],
  enrolling: ['active', 'cancelled'],
  active: ['resolving', 'cancelled'],
  resolving: ['completed', 'cancelled'],
  completed: ['archived'],
  cancelled: ['archived'],
  archived: [],
};
