/* IA opcional para textos de eventos (provedor configurável no servidor). A IA só redige chamadas a partir de fatos;
   não decide elegibilidade, pontos, prazos, resultados nem executa comandos. Sem chave/modelo, com erro ou com
   saída suspeita → null, e o chamador usa o texto parametrizado (modo determinístico). Toda chamada é registrada
   em ai_calls com latência e tokens quando o provedor informa. */
import type { Exec } from '../../db/db';
import { config } from '../../config';
import { GANCHOS } from './catalogo';
import type { EventDefinition } from './tipos';

export type Textos = { titulo: string; chamada: string; fonte: 'template' | 'ia'; template_id: string };

export function iaConfigurada() { return !!(config.ia.provedor && config.ia.chave && process.env.IA_MODELO); }

async function registrar(c: Exec, r: { ok: boolean; ms: number; ent?: number; sai?: number; erro?: string }) {
  await c.query(`insert into ai_calls (provedor, finalidade, ok, latencia_ms, tokens_entrada, tokens_saida, erro) values ($1, 'texto_evento', $2, $3, $4, $5, $6)`,
    [config.ia.provedor, r.ok, r.ms, r.ent ?? null, r.sai ?? null, r.erro?.slice(0, 300) ?? null]);
}

/** chama o provedor; devolve texto curto ou null (qualquer falha) */
export async function gerarTextoIA(c: Exec, prompt: string): Promise<string | null> {
  if (!iaConfigurada()) return null;
  const t0 = Date.now(); const prov = config.ia.provedor; const modelo = process.env.IA_MODELO!;
  try {
    let url: string, init: RequestInit, extrair: (j: any) => { txt: string; ent?: number; sai?: number };
    if (prov === 'anthropic') {
      url = process.env.IA_URL || 'https://api.anthropic.com/v1/messages';
      init = { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': config.ia.chave || '', 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: modelo, max_tokens: 120, messages: [{ role: 'user', content: prompt }] }) };
      extrair = (j) => ({ txt: j?.content?.[0]?.text || '', ent: j?.usage?.input_tokens, sai: j?.usage?.output_tokens });
    } else if (prov === 'openai_compat') {
      url = process.env.IA_URL || 'https://api.openai.com/v1/chat/completions';
      init = { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (config.ia.chave || '') }, body: JSON.stringify({ model: modelo, max_tokens: 120, messages: [{ role: 'user', content: prompt }] }) };
      extrair = (j) => ({ txt: j?.choices?.[0]?.message?.content || '', ent: j?.usage?.prompt_tokens, sai: j?.usage?.completion_tokens });
    } else { await registrar(c, { ok: false, ms: 0, erro: 'provedor desconhecido' }); return null; }
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(Number(process.env.IA_TIMEOUT_MS || 8000)) });
    if (!r.ok) { await registrar(c, { ok: false, ms: Date.now() - t0, erro: 'http ' + r.status }); return null; }
    const { txt, ent, sai } = extrair(await r.json());
    const limpo = sanitizar(txt);
    await registrar(c, { ok: !!limpo, ms: Date.now() - t0, ent, sai, erro: limpo ? undefined : 'saída recusada pelo filtro' });
    return limpo;
  } catch (e: any) {
    await registrar(c, { ok: false, ms: Date.now() - t0, erro: String(e?.cause?.code || e?.name || e?.message || e) });
    return null;
  }
}

/** recusa saída com números (métricas inventadas), links, menções ou texto longo demais */
export function sanitizar(txt: string): string | null {
  const t = (txt || '').replace(/\s+/g, ' ').trim().replace(/^["“]|["”]$/g, '');
  if (!t || t.length > 160 || /\d/.test(t) || /https?:|www\.|@\w/.test(t)) return null;
  return t;
}

/** textos da instância: template parametrizado sempre; IA só substitui a chamada quando disponível e aprovada pelo filtro */
export async function textosEvento(c: Exec, def: EventDefinition, alvo: { cidade?: string | null; usarIA?: boolean }): Promise<Textos> {
  const gancho = GANCHOS[def.id] || def.title;
  const base: Textos = { titulo: def.title, chamada: `${gancho}${alvo.cidade ? ' · ' + alvo.cidade : ''}`, fonte: 'template', template_id: def.content_template_ids[0] };
  if (!alvo.usarIA) return base;
  const ia = await gerarTextoIA(c, `Escreva UMA chamada curta (até 100 caracteres), em português do Brasil, convidando moradores${alvo.cidade ? ' de ' + alvo.cidade : ''} para o evento "${def.title}" de um jogo social. Gancho: "${gancho}". Não use números, links nem promessas de prêmio em dinheiro. Responda só com a frase.`);
  return ia ? { ...base, chamada: ia, fonte: 'ia' } : base;
}
