/* Desafios curtos emitidos e verificados pelo servidor (missões e motores de evento).
   Semente aleatória → enunciado determinístico; o gabarito fica só no banco. Cada desafio é de um usuário e de um
   contexto, vale uma vez, expira, exige tempo mínimo entre emissão e resposta e aceita no máximo 3 erros.
   Isto substitui "aba aberta" ou "socket conectado" como prova de participação. */
import { randomBytes, createHash } from 'node:crypto';
import type { Exec } from '../../db/db';
import { ErroHttp } from '../../http/app';

export type TipoDesafio = 'conta' | 'sequencia' | 'peca' | 'quiz' | 'simbolos';
/** mesmos ids do catálogo de emotes predefinidos (016_emotes, Fase 2) */
export const EMOTES = ['acenar', 'comemorar', 'sentar', 'palmas', 'coracao', 'rir'] as const;
const FORMAS = ['▲', '■', '●', '◆', '★'];

/** banco de perguntas revisado (fatos do próprio jogo; sem tema sensível). Índice da certa em `c`. */
export const QUIZ: Record<string, { p: string; o: string[]; c: number }[]> = {
  tour: [
    { p: 'O que prova que a casa é sua?', o: ['digitar o seu @', 'o link de uso único ou o código publicado pela sua conta', 'comentar várias vezes'], c: 1 },
    { p: 'Ficar dias sem entrar faz você perder a casa?', o: ['sim', 'não'], c: 1 },
    { p: 'Onde fica a sua casa?', o: ['num lote da sua cidade, numa rua virtual', 'em qualquer cidade sorteada'], c: 0 },
    { p: 'Como a sua rua ganha pontos na competição?', o: ['com missões válidas dos moradores do elenco', 'com mais curtidas no Instagram', 'pagando'], c: 0 },
  ],
  jogo: [
    { p: 'Vencer o ranking das ruas torna alguém prefeito?', o: ['sim', 'não: ruas disputam troféu, pessoas disputam cargos'], c: 1 },
    { p: 'Quantos pontos de contribuição cada morador pode dar por dia?', o: ['10', '30', 'ilimitado'], c: 1 },
    { p: 'XP aumenta o peso do seu voto?', o: ['sim', 'não, voto vale sempre 1'], c: 1 },
    { p: 'Quem entrou na rua depois do início da temporada pontua quando?', o: ['na hora', 'a partir da próxima temporada'], c: 1 },
    { p: 'Uma pessoa sozinha consegue terminar a obra da rua?', o: ['sim, pagando', 'não, a obra tem limite por pessoa'], c: 1 },
    { p: 'Se a rua perder a competição, a obra comunitária some?', o: ['sim', 'não, a obra fica'], c: 1 },
  ],
  biblioteca: [
    { p: 'Quantos estados tem o Brasil (sem contar o DF)?', o: ['26', '27', '25'], c: 0 },
    { p: 'Qual destes é um bioma brasileiro?', o: ['Cerrado', 'Tundra', 'Savana ártica'], c: 0 },
    { p: 'Qual é o maior rio do Brasil em volume de água?', o: ['Amazonas', 'Tietê', 'Paraíba do Sul'], c: 0 },
    { p: 'Qual região tem a Caatinga?', o: ['Nordeste', 'Sul'], c: 0 },
    { p: 'Brasília fica em qual unidade da federação?', o: ['Distrito Federal', 'Goiás', 'Minas Gerais'], c: 0 },
  ],
};

function rng(semente: string) {
  let a = createHash('sha256').update(semente).digest().readUInt32LE(0);
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function embaralhar<T>(arr: T[], r: () => number) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** gera enunciado (público) e gabarito (secreto) a partir da semente */
export function gerar(tipo: TipoDesafio, semente: string, params: Record<string, any> = {}): { enunciado: any; gabarito: any } {
  const r = rng(semente);
  if (tipo === 'conta') {
    const a = 2 + Math.floor(r() * 18), b = 2 + Math.floor(r() * 18), soma = r() < 0.6;
    const res = soma ? a + b : Math.max(a, b) - Math.min(a, b);
    const ops = new Set([res]); while (ops.size < 4) ops.add(Math.max(0, res + Math.floor(r() * 9) - 4));
    return { enunciado: { pergunta: soma ? `quanto é ${a} + ${b}?` : `quanto é ${Math.max(a, b)} − ${Math.min(a, b)}?`, opcoes: embaralhar([...ops], r) }, gabarito: { resposta: res } };
  }
  if (tipo === 'sequencia') {
    const n = Number(params.tamanho || 3); const seq = Array.from({ length: n }, () => EMOTES[Math.floor(r() * EMOTES.length)]);
    return { enunciado: { pergunta: 'repita a sequência de gestos', sequencia: seq, opcoes: [...EMOTES] }, gabarito: { sequencia: seq } };
  }
  if (tipo === 'peca') {
    const periodo = 2 + Math.floor(r() * 2); const base = embaralhar(FORMAS, r).slice(0, periodo);
    const visiveis = 4 + Math.floor(r() * 2); const padrao = Array.from({ length: visiveis }, (_, i) => base[i % periodo]);
    const certa = base[visiveis % periodo];
    return { enunciado: { pergunta: 'qual peça completa o padrão da obra?', padrao: [...padrao, '?'], opcoes: embaralhar(FORMAS.slice(0, 4).includes(certa) ? FORMAS.slice(0, 4) : [...FORMAS.slice(0, 3), certa], r) }, gabarito: { resposta: certa } };
  }
  if (tipo === 'quiz') {
    const banco = QUIZ[params.banco || 'jogo'] || QUIZ.jogo; const n = Math.min(Number(params.perguntas || 3), banco.length);
    const escolhidas = embaralhar(banco.map((_, i) => i), r).slice(0, n);
    return { enunciado: { perguntas: escolhidas.map((i) => ({ p: banco[i].p, opcoes: banco[i].o })) }, gabarito: { certas: escolhidas.map((i) => banco[i].c), min_acertos: Number(params.min_acertos ?? n) } };
  }
  // simbolos: objetos escondidos numa grade; o cliente só descobre célula a célula
  const celulas = Number(params.celulas || 9), objetos = Number(params.objetos || 3);
  const pos = embaralhar(Array.from({ length: celulas }, (_, i) => i), r).slice(0, objetos).sort((x, y) => x - y);
  return { enunciado: { pergunta: `encontre ${objetos} símbolos escondidos`, celulas, objetos, tentativas: objetos * 2 }, gabarito: { celulas: pos, tentativas: objetos * 2 } };
}

export type Emissao = { userId: string; contexto: string; tipo: TipoDesafio; params?: Record<string, any>; validadeSeg?: number; agora?: Date };
export async function emitirDesafio(c: Exec, e: Emissao) {
  const agora = e.agora || new Date();
  const n = (await c.query(`select count(*)::int n from server_challenges where user_id = $1 and criado_em > $2::timestamptz - interval '10 minutes'`, [e.userId, agora])).rows[0].n;
  if (n >= 30) throw new ErroHttp(429, 'muitos desafios pedidos: espere alguns minutos');
  const semente = randomBytes(16).toString('hex');
  const { enunciado, gabarito } = gerar(e.tipo, semente, e.params);
  const r = (await c.query(
    `insert into server_challenges (user_id, contexto, tipo, semente, gabarito, criado_em, expira_em)
     values ($1,$2,$3,$4,$5,$6,$6::timestamptz + make_interval(secs => $7)) returning id, expira_em`,
    [e.userId, e.contexto, e.tipo, semente, JSON.stringify(gabarito), agora, e.validadeSeg ?? 600])).rows[0];
  return { id: r.id as string, tipo: e.tipo, enunciado, expira_em: r.expira_em as string };
}

export type Verificacao = { ok: true; tipo: TipoDesafio; acertos?: number; total?: number } | { ok: false; motivo: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** verifica e consome (na transação do chamador). Erro de resposta conta tentativa; 3 erros queimam o desafio. */
export async function verificarDesafio(c: Exec, v: { id: unknown; userId: string; contexto: string; resposta: unknown; minMs?: number; agora?: Date }): Promise<Verificacao> {
  if (typeof v.id !== 'string' || !UUID.test(v.id)) return { ok: false, motivo: 'desafio inválido' };
  const agora = v.agora || new Date();
  const d = (await c.query(`select * from server_challenges where id = $1 and user_id = $2 and contexto = $3 for update`, [v.id, v.userId, v.contexto])).rows[0];
  if (!d) return { ok: false, motivo: 'desafio inválido' };
  if (d.consumido_em) return { ok: false, motivo: 'desafio já usado' };
  if (new Date(d.expira_em) <= agora) return { ok: false, motivo: 'desafio expirado: peça outro' };
  if (agora.getTime() - new Date(d.criado_em).getTime() < (v.minMs ?? 1500)) return { ok: false, motivo: 'rápido demais: faça a atividade com calma' };
  const g = d.gabarito; let certo = false; let acertos: number | undefined, total: number | undefined;
  if (d.tipo === 'conta') certo = Number(v.resposta) === g.resposta && v.resposta !== null && v.resposta !== '';
  else if (d.tipo === 'peca') certo = v.resposta === g.resposta;
  else if (d.tipo === 'sequencia') certo = Array.isArray(v.resposta) && v.resposta.length === g.sequencia.length && v.resposta.every((x: unknown, i: number) => x === g.sequencia[i]);
  else if (d.tipo === 'quiz') {
    const rs = Array.isArray(v.resposta) ? v.resposta : []; total = g.certas.length;
    const ac: number = g.certas.filter((cx: number, i: number) => Number(rs[i]) === cx).length; acertos = ac; certo = ac >= g.min_acertos;
    // quiz: uma tentativa só (senão bastaria chutar até acertar)
    await c.query(`update server_challenges set tentativas = tentativas + 1, consumido_em = $2, resultado = $3 where id = $1`, [d.id, agora, certo ? 'certo' : 'errado']);
    return certo ? { ok: true, tipo: 'quiz', acertos, total } : { ok: false, motivo: `acertou ${acertos ?? 0} de ${total}: tente outro quiz` };
  } else if (d.tipo === 'simbolos') certo = (d.progresso?.achados || []).length >= g.celulas.length;
  if (certo) {
    await c.query(`update server_challenges set tentativas = tentativas + 1, consumido_em = $2, resultado = 'certo' where id = $1`, [d.id, agora]);
    return { ok: true, tipo: d.tipo, acertos, total };
  }
  const t = d.tentativas + 1;
  await c.query(`update server_challenges set tentativas = $2, consumido_em = case when $2 >= 3 then $3::timestamptz end, resultado = case when $2 >= 3 then 'errado' end where id = $1`, [d.id, t, agora]);
  return { ok: false, motivo: t >= 3 ? 'resposta errada: desafio encerrado, peça outro' : 'resposta errada, tente de novo' };
}

/** caça aos símbolos: revela uma célula. Não consome; o motor chama verificarDesafio quando completo. */
export async function revelarCelula(c: Exec, v: { id: unknown; userId: string; contexto: string; celula: unknown; agora?: Date }) {
  if (typeof v.id !== 'string' || !UUID.test(v.id)) return { ok: false as const, motivo: 'desafio inválido' };
  const agora = v.agora || new Date();
  const d = (await c.query(`select * from server_challenges where id = $1 and user_id = $2 and contexto = $3 and tipo = 'simbolos' for update`, [v.id, v.userId, v.contexto])).rows[0];
  if (!d || d.consumido_em) return { ok: false as const, motivo: 'desafio inválido ou encerrado' };
  if (new Date(d.expira_em) <= agora) return { ok: false as const, motivo: 'desafio expirado: peça outro' };
  const cel = Number(v.celula); const g = d.gabarito;
  const prog = { achados: [] as number[], abertas: [] as number[], ...(d.progresso || {}) };
  if (!Number.isInteger(cel) || cel < 0 || cel > 63 || prog.abertas.includes(cel)) return { ok: false as const, motivo: 'célula inválida ou já aberta' };
  if (prog.abertas.length >= g.tentativas) return { ok: false as const, motivo: 'sem tentativas: peça outro desafio' };
  prog.abertas.push(cel); const achou = g.celulas.includes(cel); if (achou) prog.achados.push(cel);
  const esgotou = prog.abertas.length >= g.tentativas && prog.achados.length < g.celulas.length;
  await c.query(`update server_challenges set progresso = $2, tentativas = tentativas + 1, consumido_em = case when $3 then $4::timestamptz end, resultado = case when $3 then 'errado' end where id = $1`, [d.id, JSON.stringify(prog), esgotou, agora]);
  return { ok: true as const, achou, achados: prog.achados.length, objetos: g.celulas.length, completo: prog.achados.length >= g.celulas.length, restantes: g.tentativas - prog.abertas.length };
}
