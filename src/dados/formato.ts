/* Formato do pacote estático de dados do mapa (public/dados/mundo.json), gerado por scripts/build-dados.ts.
   Moradores ficam agrupados por cidade: o morador gi pertence à cidade c se c.ini <= gi < c.ini + c.n. */
export type PacoteMundo = {
  v: 1;
  /** true = dados fictícios de demonstração; a UI mostra um selo e contadores não valem como produção */
  demo: boolean;
  geradoEm: string;
  temporada: { n: number; inicio: number; fim: number };
  /** total de moradores */
  n: number;
  /** [ibge, ini, n, giFundador] ordenado por ibge */
  cidades: [number, number, number, number][];
  /** @ separados por \n, na ordem gi */
  u: string;
  /** pontos da semana por gi */
  pts: number[];
  /** pontos totais (XP) por gi — define o nível */
  tot: number[];
  /** cargo por gi: ' ' nenhum ou letra de CARGOS */
  cg: string;
  /** cor da casa por gi: parede*10 + telhado */
  cor: number[];
  /** frase pública da casa (só quem escreveu) */
  frases: Record<string, string>;
  /** lojas/estabelecimentos patrocinados vigentes */
  lojas: Loja[];
};

export type Loja = {
  id: string; nome: string; tipo: string; ibge: number; cor: string; desc: string;
  ate: string; ig?: string; site?: string; patrocinado: true;
};
