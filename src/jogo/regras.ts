/* Regras do jogo compartilhadas entre o front, o build de dados e o servidor.
   Tudo aqui é configuração de produto (pode mudar entre temporadas); nunca muda no meio de uma temporada. */

/** 50 níveis da casa: pontos totais mínimos e nome. O nível nunca diminui. */
export const NIVEIS: { min: number; nome: string }[] = (() => {
  const nomes = [
    'barraca', 'casinha', 'casinha com varanda', 'sobradinho', 'sobrado', 'casa de vila', 'casa de praia', 'casa com quintal', 'chalé', 'casa alta',
    'casa com piscina', 'mansãozinha', 'mansão', 'mansão com jardim', 'predinho', 'prédio de 5 andares', 'edifício', 'edifício com terraço', 'torre de vidro', 'torre com heliponto',
    'arranha-céu', 'arranha-céu dourado', 'torre de cristal', 'farol', 'castelo', 'torre do relógio', 'pagode', 'torre de TV', 'torres gêmeas', 'torre-jardim',
    'pirâmide de vidro', 'espiral', 'base de foguete', 'observatório', 'cúpula solar', 'cidade vertical', 'disco voador', 'torre neon', 'arco-íris', 'castelo nas nuvens',
    'ilha flutuante', 'agulha', 'ametista', 'zigurate', 'safira', 'portal', 'esmeralda', 'palácio de cristal', 'nave-mãe', 'topo do Brasil',
  ];
  return nomes.map((nome, i) => ({ nome, min: i === 0 ? 0 : Math.round((10 * Math.pow(i, 1.85)) / 5) * 5 }));
})();

export function nivelDe(pontosTotais: number) {
  let n = 1;
  for (let i = 0; i < NIVEIS.length; i++) if (pontosTotais >= NIVEIS[i].min) n = i + 1;
  return n;
}

/** Cargos do jogo clássico (por pontos da semana). Letra usada nos dados compactados. */
export const CARGOS = {
  P: { nome: 'presidente', escopo: 'Brasil', ordem: 6 },
  S: { nome: 'senador', escopo: 'Brasil', ordem: 5 },
  G: { nome: 'governador', escopo: 'estado', ordem: 4 },
  D: { nome: 'deputado', escopo: 'estado', ordem: 3 },
  M: { nome: 'prefeito', escopo: 'cidade', ordem: 2 },
  V: { nome: 'vereador', escopo: 'cidade', ordem: 1 },
} as const;
export type LetraCargo = keyof typeof CARGOS;

/** Pontos por ação (jogo clássico). O servidor é a fonte da verdade; o front só exibe. */
export const PONTOS = {
  casa: 10,
  comentario: 5,
  amigoEntrou: 50,
  story: 30,
  seguirLoja: 30,
  votoRecebidoBase: 5,
  missao: 5,
  missaoCidade: 10,
  tetoComentarioDia: 100,
};

/** O voto vale 5 + sequência de horas votando na semana (até um teto). */
export const VOTO = { base: 5, tetoSequencia: 50, esperaMs: 3600_000 };

export const CORES_PAREDE = ['#f4f1e8', '#f1dfb0', '#f2d160', '#ee9d83', '#e59aaa', '#94bfe6', '#a3d6aa', '#dcbd8a', '#bba9dc', '#f3b680', '#7fc8c0', '#f7a8b8', '#c9e27a', '#9db4e8', '#e8c07a', '#ffffff'];
export const CORES_TELHADO = ['#c8572f', '#a04526', '#8f98a5', '#b9bfc8', '#4f6f94', '#5f8a45', '#7d5238', '#6d7683', '#d9824a', '#3d5a80'];

/** Fechamento semanal: domingo 21h em Brasília (UTC−3, sem horário de verão). */
export function proximoFechamento(agoraMs = Date.now()) {
  const brt = new Date(agoraMs - 3 * 3600_000);
  const dia = brt.getUTCDay(); // 0 = domingo
  const alvo = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate(), 21, 0, 0));
  let add = (7 - dia) % 7;
  if (add === 0 && brt.getTime() >= alvo.getTime()) add = 7;
  return alvo.getTime() + add * 86400_000 + 3 * 3600_000;
}
