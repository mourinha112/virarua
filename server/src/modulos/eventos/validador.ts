/* Validador do schema EventDefinition. Recusa: campo faltando, vocabulário desconhecido, motor sem a regra de
   conclusão, regra de recompensa inexistente, evento de eleição com XP, evento habilitado com asset ausente e
   evento desabilitado sem motivo. Roda no teste do catálogo e na sincronização (catálogo inválido não sobe). */
import { CATEGORIAS, CONCLUSOES, ESCOPOS, MOTORES, PREREQ_INSTANCIA, PREREQ_USUARIO, type EventDefinition } from './tipos';
import { REGRAS } from '../recompensas/regras';
import { ASSETS_DISPONIVEIS, GANCHOS } from './catalogo';

const CAMPOS: (keyof EventDefinition)[] = ['id', 'version', 'category', 'title', 'description', 'scope', 'mechanic', 'prerequisites', 'min_participants', 'duration', 'cooldown', 'enrollment', 'completion_rule', 'reward_rule_id', 'limits', 'visual_asset_ids', 'content_template_ids', 'cta', 'cancellation_rule', 'moderation_policy'];

export function validarDefinicao(d: EventDefinition): string[] {
  const e: string[] = []; const p = (m: string) => e.push(`${d?.id ?? '?'}: ${m}`);
  for (const k of CAMPOS) if ((d as any)[k] === undefined || (d as any)[k] === null) p(`campo obrigatório ausente: ${k}`);
  if (e.length) return e;
  if (!/^E\d{2}$/.test(d.id)) p('id fora do padrão E00');
  if (!Number.isInteger(d.version) || d.version < 1) p('version inválida');
  if (!(CATEGORIAS as readonly string[]).includes(d.category)) p('categoria desconhecida: ' + d.category);
  if (!(ESCOPOS as readonly string[]).includes(d.scope)) p('escopo desconhecido: ' + d.scope);
  if (!d.title.trim() || !d.description.trim()) p('título/descrição vazios');
  if (!(MOTORES as readonly string[]).includes(d.mechanic.motor)) p('motor desconhecido: ' + d.mechanic.motor);
  else if (!CONCLUSOES[d.mechanic.motor].includes(d.completion_rule.tipo)) p(`regra de conclusão ${d.completion_rule.tipo} não existe no motor ${d.mechanic.motor}`);
  const regra = REGRAS[d.reward_rule_id];
  if (!regra) p('reward_rule_id inexistente: ' + d.reward_rule_id);
  if (d.category === 'eleicao_editorial' && regra && regra.sistema !== 'nenhum' && !(regra.sistema === 'colecao' && regra.item === 'lembranca')) p('evento de eleição não pode dar XP/pontos');
  if (regra?.sistema === 'contribuicao') p('evento não concede contribuição competitiva (só missões, cap. 10)');
  for (const pr of d.prerequisites) {
    const ok = (PREREQ_USUARIO as readonly string[]).includes(pr.tipo) || (PREREQ_INSTANCIA as readonly string[]).includes(pr.tipo);
    if (!ok) p('pré-requisito desconhecido: ' + pr.tipo);
    if (pr.tipo === 'fato' && !pr.fato) p('pré-requisito fato sem tipo de fato');
  }
  if (!Number.isInteger(d.min_participants) || d.min_participants < 1) p('min_participants inválido');
  if (d.duration.tipo === 'janela' && !(d.duration.horas > 0 && d.duration.horas <= 168)) p('duração fora de 1h–7 dias');
  if (d.duration.tipo !== 'janela' && d.duration.tipo !== 'permanente') p('duração desconhecida');
  if (d.cooldown.tipo === 'horas' && !(d.cooldown.horas > 0)) p('cooldown inválido');
  if (d.enrollment !== 'automatica' && d.enrollment !== 'opt_in') p('enrollment inválido');
  if (!(d.limits.por_usuario_edicao >= 1)) p('limits.por_usuario_edicao precisa ser >= 1');
  if (!Array.isArray(d.visual_asset_ids) || !d.visual_asset_ids.length) p('sem visual_asset_ids');
  if (!d.content_template_ids.length || d.content_template_ids.some((t) => !GANCHOS[t.replace(/^gancho\./, '')])) p('template de conteúdo inexistente');
  if (!d.cta?.texto || !d.cta?.acao) p('CTA incompleto');
  if (!['nunca', 'min_participantes_no_fim', 'min_participantes_no_inicio', 'fato_revogado'].includes(d.cancellation_rule.tipo)) p('cancellation_rule desconhecida');
  if (!['sem_texto_livre', 'opcoes_pre_aprovadas', 'revisao_humana'].includes(d.moderation_policy)) p('moderation_policy desconhecida');
  if (d.min_participants > 1 && d.cancellation_rule.tipo === 'nunca') p('evento coletivo precisa de regra de cancelamento por participantes');
  if (!d.small_population_fallback) p('sem fallback para população pequena');
  if (d.enabled) {
    const faltam = d.visual_asset_ids.filter((a) => !ASSETS_DISPONIVEIS.has(a));
    if (faltam.length) p('habilitado com asset ausente: ' + faltam.join(', '));
  } else if (!d.disabled_reason || d.disabled_reason.length < 10) p('desabilitado sem motivo explícito');
  // parâmetros mínimos por motor
  const m = d.mechanic.params || {};
  if (d.mechanic.motor === 'exploracao' && m.modo !== 'cidades' && m.modo !== 'simbolos') p('exploração sem modo');
  if (d.mechanic.motor === 'quiz' && !m.banco) p('quiz sem banco');
  if (d.mechanic.motor === 'decoracao' && !m.opcoes) p('decoração sem opções');
  if (d.mechanic.motor === 'presenca' && !(Array.isArray(m.locais) && m.locais.length >= (m.min_locais || 1))) p('presença sem locais suficientes');
  if (d.mechanic.motor === 'contribuicao' && !m.alvo) p('contribuição sem alvo');
  return e;
}

export function validarCatalogo(cat: EventDefinition[]): string[] {
  const erros = cat.flatMap(validarDefinicao);
  const ids = cat.map((d) => d.id + '@' + d.version);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dup.length) erros.push('ids duplicados: ' + [...new Set(dup)].join(', '));
  return erros;
}
