# 04 — Eleição, Ranking, Ofensiva, Missões/Minigames, Frases, Painel da Eleição, Lojas, Mapa 2D e Negócio

Especificação técnica + UI, em português, para reimplementar do zero os módulos de **ranking.js, eleicao.js, ofensiva.js, missoes.js, missoes-jogos.js (18 minigames), frase-filtro.js, frases.js (Frases + Partidos), frase-ui.js (+ aba Minha Casa), painel-eleicao.js, lojas-hub.js, mapa2d.js e negocio.js** do site de referência (mapa 3D do Brasil onde quem comenta a cidade no Instagram ganha uma casa, vota a cada hora, disputa cargos, faz missões pela cidade e lojas patrocinadas aparecem no mapa).

Fonte: `app.js` (linhas 16128–19279) e `missoes-jogos.js` do bundle legível, mais a ESTRUTURA de `eleicao.json`, `missoes.json` e `ofensiva.json`. Nada de dados reais foi copiado; nomes de usuários, patrocinadores, códigos Pix e dados do dono do site foram omitidos.

---

## 0. Convenções e dependências compartilhadas

### 0.1 Globais do engine que estes módulos consomem (definidos em outros arquivos — ver docs 01–03)

| Nome | O que é |
|---|---|
| `USR[gi]` | handle (sem @) do morador de índice `gi` |
| `NM` | número de moradores |
| `PSEM[gi]`, `PTOT[gi]` | pontos da semana e da temporada |
| `NVA[gi]` | nível da casa (1..50) |
| `LISTA[]`, `CID_DE[gi]` | lista de cidades e índice da cidade de cada morador; cidade `{ibge, nome, uf, n, ini, ps, pt, pref, cx, cy}` |
| `ESTADOS[uf]`, `UFS[]` | estados `{nome, cidades[], ps, nres, cor, x, y}` |
| `ORDEM[]` | cidades da maior para a menor (em moradores) |
| `membros(c)` | `Int32Array` dos `gi` da cidade ordenados por `maior()` |
| `maior(a,b)` | comparador oficial: mais pontos na semana primeiro; empate = casa mais antiga |
| `cargoDe(gi)` | `'P'|'S'|'G'|'D'|'M'|'V'|''` (presidente, senador, governador, deputado, prefeito, vereador) |
| `PRESI`, `SENI[]`, `GOVI[uf]`, `DEPI[uf][]` | quem ocupa cada cargo agora |
| `PD` | dados de pontos: `{fim, ini, mand, nn[] (nomes dos níveis), niv[] (pontos mínimos)}`; `PD` ausente = site sem pontos |
| `POR_HANDLE` (Map handle→gi), `POR_IBGE` (Map ibge→cidade) | índices |
| `Hash.norm(txt)` | normaliza um @ digitado (minúsculas, sem @, só `[a-z0-9._]`) |
| `rotCargo(k,c)`, `CGSIGLA[k]` | rótulos de cargo |
| `el(tag, cls, txt)`, `btn(txt, fn, cls)`, `toast(msg)`, `fmtN(n)`, `plural(n,s,p)`, `$(id)` | utilitários de UI |
| `paraMapa(fn)`, `mostrarCasa(h, gi)`, `cartaoCidade(c)`, `cartaoEstado(uf, {voar})` | navegação no mapa |
| `novoCanvas`, `caixa`, `tx`, `ajusta`, `rodapeImg`, `listaImg`, `entregarImagem` | geração das imagens 1080×1920 (story) |
| `cvEstado(c)`, `CVM`, `window.CV` | "cidade viva": obras por área (orçamento) |
| `window.__DADOS` | `{n, c: [[ibge, moradores]…], L: [[…loja…]…]}` dados crus |
| `carregarNumeros()` | `numeros.json` → `{mapa:{vb, d:{UF: path}}, estados:[…]}` |

### 0.2 "Quem sou eu" neste aparelho

Duas chaves de `localStorage` convivem:

* `nem_eu` — @ do ranking ("quem sou eu", pode ser o último @ buscado ou `?u=`).
* `voto_eu` — @ de quem vota/joga missão/escreve frase. Sempre validado contra `POR_HANDLE` (só quem tem casa).

Os módulos leem assim: `eu = norm(voto_eu) || norm(nem_eu)`, e só aceitam se `POR_HANDLE.get(eu) !== undefined`. Quando o usuário informa o @ num painel, grava-se `voto_eu` e também chama `lembrarEu(h, gi)` (que grava `nem_eu`).

### 0.3 Flags de build (window.*)

| Flag | Liga |
|---|---|
| `PD` (dados de pontos) | ranking, como funciona, painel votar |
| `window.FRASES` | frases/cores, abas Minha Casa e Eleições, painel da eleição |
| `window.MISSOES` | missões e ministérios |
| `window.SIMPLES` | "fase 1": como-funciona simplificado, fila de avisos, dica de app |
| `window.REATIVA` | cartão "voltou? o que mudou" |
| `window.EVENTO_SITE` | faixa de evento `{ini, fim, txt}` (epoch s) |
| `window.NEG_CFG` | configuração do funil de negócio |
| `window.__MJV` | versão do arquivo de jogos (cache-bust) |

### 0.4 Tempo

* Fuso de referência: Brasília (`America/Sao_Paulo`, UTC-3 fixo nos cálculos de "dia": `new Date(Date.now() - 3h).toISOString().slice(0,10)`).
* **Semana/mandato**: fecha **domingo 21h** (Brasília). `FIM_MS() = PD.fim*1000`, `INI_MS() = PD.ini*1000`.
* `VOTO_ABRE = 1792368000e3` (início da temporada 2, um domingo 21h). Antes disso a votação é "fechada" (`votoFalta` devolve `Infinity`).
* `dhms(ms)`: `"fechou"` se ≤0; `"Dd HHh MMmin"` quando há dias; senão `"Hh MMmin SSs"`.
* `minTxt(ms) = max(1, ceil(ms/60000)) + ' min'`.
* `horaTxt(ms)`: `HH:MM` em pt-BR no fuso de São Paulo.

### 0.5 Pontuação relevante (textos oficiais do "como funciona")

* Comentar a cidade: casa nasce em até 20 min com 10 pontos; cada comentário +5 (1 por post).
* Amigo marcado que entrou: +50 (em evento, +100).
* Story marcando a página: +30 por dia ("em alta" por 24 h).
* Seguir loja patrocinada: +30 (texto antigo) / `LJC.s` (hub de lojas diz +100, 1 vez por loja, até 15 lojas por dia após a temporada 2); marcar o @ da loja num comentário: `LJC.p` (+30).
* Cada voto recebido: +5 ou mais (valor do voto = 5 + ofensiva).
* Missão concluída: +5 para a pessoa, +10 para a cidade.
* Domingo 21h zera só os pontos da semana (cargos); casa e nível ficam.

---

## 1. ranking.js — aba Ranking, "como funciona", casas e "quem sou eu"

### 1.1 Objetivo

Aba de tela cheia (`#ranking`) com o ranking de pontos da semana por **Cidade / Estado / Brasil**, a barra "você" com a posição em cada recorte, a linha de votos da semana (de `eleicao.json`), o cartão de quem manda no recorte (presidente/governador/prefeito), o botão de compartilhar o top 10 em imagem, e a tela "como funciona". Também define os ícones das 50 casas e o "quem sou eu".

### 1.2 As casas (50 níveis)

`CASAS_FORMAS` é um array com 50 entradas; cada entrada é uma lista de `[pathSVG, fill]` desenhada num quadro 32×32, traço `#1e2430` largura 1.8, cantos arredondados. Níveis 1–5: casinha, sobrado, casa alta, mansão com piscina, torre. 6–15: prédios crescentes até "o topo do mapa". 16–50: castelo, farol, torre do relógio, pagode, torre de TV, torres gêmeas, torre de ferro, … , coroa do Brasil, "o topo do Brasil".

Implementação: um `<svg width=0 height=0>` com um `<symbol id="cs{n}">` por casa é injetado no `body`; cada linha do ranking usa `<use href="#cs{n}">` (`casaIco(n, cls)`). Para canvas (imagem do story) `desenhaCasa(ctx, n, cx, cy, tam)` percorre os mesmos paths com `Path2D`.

### 1.3 "Quem sou eu" (`EU`)

* `lerEu()`: lê `nem_eu`, valida em `POR_HANDLE`; `EU.gi = -1` se não há.
* `lembrarEu(h, gi)`: grava `nem_eu`, atualiza `EU.gi` e redesenha o ranking se aberto.
* `esquecerEu()`: remove `nem_eu`.

### 1.4 Listas ordenadas e posição

* `listaDe('br')`: `Int32Array` com todos os `gi` ordenados por `maior` (cacheada em `ORD_BR`).
* `listaDe('cid', c)`: `membros(c)`.
* `listaDe('est', uf)`: concatena `membros` de todas as cidades da UF e ordena; cache LRU de 3 estados (`ORD_UF`).
* `posIn(lista, gi)`: busca binária usando `maior`; `posNaLista(gi, esc)` = índice+1.

### 1.5 Vices e suplentes (derivados, sem dado novo)

* `viceDe('br')` = `SENI[0]` (1º senador = vice-presidente).
* `viceDe('est', uf)` = 1º da lista do estado que não é o governador e não tem cargo `P` nem `S`.
* `viceDe('cid', c)` = 1º morador da cidade que não é o prefeito e cujo cargo é vazio ou `V`.
* `suplentesSen(n=10)`: os n seguintes ao último senador na lista do Brasil, sem `P`/`S`.
* `viceDeGi(gi)` → `{k:'vice-presidente'|'vice-governador'|'vice-prefeito'|'suplente de senador', onde, alvo, prox}` ou `null`.

### 1.6 Imagens 1080×1920

* `imgStoryCasa(gi)`: fundo do canvas padrão (`novoCanvas('minha casa', 'Cidade · UF')`), caixa branca 980×1150, casa grande (540 px), `@handle` (fonte ajustada até 140 px), `"{nome do nível} · nível N de 50"`, linha 2 = cargo curto ou `"X pontos na semana"`, pontos da temporada grandes + `"pontos na temporada"`, caixa amarela: `"marca @naoeummapa"` e `"no story: +30 pontos e "em alta" por 24 h"`, rodapé. Entregue por `gerarStory(gi)` → toast `"gerando a imagem…"`, arquivo `naoeummapa-casa-{handle}.png`, texto de compartilhamento `"minha casa no mapa do @naoeummapa. naoeummapa.vercel.app"`, toast final `"posta nos stories e marca @naoeummapa: +30 pontos"`.
* `imgRanking()`: `listaImg('ranking', '{título} · pontos da semana', top10)` onde cada item = `{n, a:'@h', v: pontos, b: cargo curto ou 'cidade · UF', p: fração do 1º}`. Botão `"compartilhar top 10"` vira `"gerando…"` durante a geração; arquivo `naoeummapa-ranking-{nome-sem-acento}.png`.

### 1.7 Estado e montagem da aba

`RK = { aberto, montado, esc:'br'|'est'|'cid', c (cidade), uf, foco (gi destacado), topo:100, busca:false, e:{refs}, votos (eleicao.json) }`, `CAP_BR = 500` (no Brasil nunca passa de 500 linhas).

DOM (dentro de `#ranking`, com `#ranking-topo`, `#ranking-eu`, `#ranking-corpo`):

1. **Segmento** `role=tablist` com 3 `role=tab`: `Cidade | Estado | Brasil`.
2. **Alvo**: `h2` com o título (`"Cidade · UF"`, nome do estado ou `"Brasil"`), `p` com `"{n} moradores · {ps} pontos na semana"`; botões `"outra cidade"`/`"outro estado"` (abre busca; oculto no Brasil) e `"ver no mapa"` (aria-label `"ver o cartão da cidade"`/`"…do estado"`; oculto no Brasil).
3. **Cartão do chefe** (`button.rk-chefe`): ícone da casa, `small` com `"Presidente do Brasil"`/`"Governador de UF"`/`"Prefeito de {cidade}"`, `b` com `@handle` ou `"vaga aberta"`, à direita pontos + `"pontos"` ou `"comente e pontue"`. Toque abre a casa. Classe `vago` quando sem ocupante.
4. **Linha de fechamento** (`p.rk-fecha`, só no Brasil): `"fecha em {dhms} · domingo 21h"`.
5. **Bloco de ministérios** (`div.rk-min`, só Brasil e com `MISSOES`): `miBlocoBrasilia()` (ver §5.9).
6. **Linha de votos** (`p.rk-votos`): Brasil/Estado → `"{total} votos de {eleitores} eleitores nesta semana"`; Cidade → `"{n} votos para moradores daqui nesta semana"` ou `"ainda sem votos aqui nesta semana"`. Dados de `window.EleicaoDados()` (cache 5 min).
7. **Em alta** (`p#rk-alta`): `"{n pessoa(s)} em alta agora (postou story marcando @naoeummapa)"` — conta entradas do mapa `AL` (gi → expira em ms) ainda válidas no recorte.
8. **Busca** (`div.rk-busca`, oculta por padrão): `input[type=search]` placeholder `"cidade ou @ (ex.: Chapecó)"` (recorte cidade) ou `"estado, cidade ou @"`; resultados de `sugestoes(txt)` (estados só no recorte estado); textos vazios: `"digita o nome de uma cidade"` / `"digita o nome de um estado"` / `"não achei: tenta outro nome"`. Escolher: estado → `esc='est'`; cidade → `RK.c`; pessoa → `RK.c` da pessoa e `foco=gi`.
9. **Lista** (`div.rk-lista`) — ver 1.8.
10. **Compartilhar** (`button.comp`): ícone + `"compartilhar top 10"` (aria-label `"compartilhar o top 10 em imagem"`).
11. Se `FRASES` e `PainelEleicao`: `PainelEleicao.botao()` é inserido **antes** de tudo (ver §8.10).

### 1.8 Linha e lista

`linhaRank(gi, pos)` = `button.rk` com classes `eu` (se é você), `foco`, `p1/p2/p3` (pódio), `k{cargo}`; filhos: `span.rk-pos` (posição), ícone da casa, `span.rk-nm` com `b "@handle"` + `em.voce "você"` + `span.rk-sub` (cargo curto `"prefeito de X"`, ou `cidade` no recorte estado, ou `cidade · UF` no Brasil; vazio no recorte cidade), `b.rk-pt` (pontos da semana). `aria-label`: `"{pos}º @{h}, {pts} pontos na semana[, {cargo por extenso}]"`. Clique → `paraMapa(() => mostrarCasa(h, gi))`.

`desenharLista()`:

```
topo = min(n, RK.topo)                      // começa em 100
âncoras = posições de EU.gi e RK.foco se estiverem fora do topo (no recorte)
segmentos = [[0, topo]] + para cada âncora [p-5, p+6] (mescla se encostar)
entre segmentos: botão "{gap} pessoa(s) no meio · mostrar mais" (só o 1º gap é clicável: RK.topo += 100; no Brasil trava em 500 → fica "{gap} pessoas no meio" desabilitado)
depois do último segmento, se sobrar: "mostrar mais 100 (faltam {resto})" | Brasil no teto: "mostrando os {fim} primeiros de {n}" | com âncoras: "mais {resto} abaixo"
vazio: "ninguém por aqui ainda"
```

`rolarPara(gi)`: `scrollIntoView` centralizado + classe `pulsa` por 1,8 s.

### 1.9 Barra "você" (`#ranking-eu`)

* Com `EU.gi`: `"você · @handle"` + botão `"não sou eu"`; três chips: `#{pos}` com `small` `"em {cidade}"`, `"em {UF}"`, `"no Brasil"`; o do recorte atual tem classe `on`; toque → `irParaEu(esc)` (troca o recorte para o da pessoa e rola até ela).
* Sem: formulário com label `"digita seu @ pra ver sua posição"`, `input#eu-in` (placeholder `"@ do Instagram"`, `maxlength 60`, `autocapitalize=none`, `enterkeyhint=go`, aria-label `"seu @ do Instagram"`) e botão `"ver"`. Submit: `Hash.norm`; se não existe → toast `"não achei @{h} no mapa"` ou `"digita seu @"`; se existe → `lembrarEu` e `irParaEu('cid')`.

### 1.10 Abrir / fechar / navegação

* `abrirRanking(o)`: `o.gi` (foca a pessoa, recorte cidade), `o.c`, `o.uf`, senão a cidade de `EU`, senão Brasil com `RK.c = ORDEM[0]`. Fecha as outras abas (`fecharAbasMenos('ranking')`: dados, Brasília, lojas), `body.dados-on`, `history.replaceState('#ranking')`, monta na 1ª vez (`abasDe('ranking')`), rola ao topo, rola até o foco.
* `fecharRanking()`: esconde, remove `dados-on`, limpa o hash `#ranking`.
* `trocarEscopo(esc)`: zera busca e `topo=100`; se não há cidade escolhida usa a de `EU` ou `ORDEM[0]`.
* Ligações: `#abrirRanking`, `#fecharRanking`, `#ajudaRk`/`#ajuda` (abre "como funciona"; `#ajuda` ganha classe `novo` até `nem_viu_como` existir), `Escape` fecha (como → ranking), `hashchange` `#ranking`, `?aba=ranking`.
* Exposto em `window.__site`: `abrirRanking, fecharRanking, abrirComo, fecharComo, gerarStory, imagemRanking, imagemStory, eu, lembrarEu, esquecerEu, listaDe, posNaLista, rk(), faltaPara`.

### 1.11 Tela "como funciona" (`#como`)

Abrir grava `nem_viu_como=1`, relógio de 1 s em `.relogio-c`. Dois modos:

**Simples (`window.SIMPLES`)** — `montarComoSimples`:

* Objetivo: rótulo `"o objetivo"`, título `"construir o Brasil virtual e governar a sua cidade"`, texto `"comenta sua cidade → ganha sua casa → vota e faz sua cidade crescer → quem soma mais pontos na semana manda (vereador → prefeito → governador → presidente) · domingo 21h a eleição fecha e começa de novo"`.
* 3 cartões (ícones casa/voto/coroa):
  * **sua casa**: `comenta sua cidade em qualquer post` · `a casa nasce em até 20 min com 10 pontos` · `cresce com os seus pontos e nunca encolhe`
  * **seu voto**: `1 voto por hora em cada cargo` · `vale +5 e sobe 1 a cada hora que você vota` · `zera domingo 21h` · `seu voto aparece em "últimos votos" com o seu @`
  * **quem manda**: `domingo 21h fecha a semana` · `quem tem mais pontos vira prefeito, governador, presidente`
* `"dúvidas que todo mundo tem"` (6 pares pergunta/resposta):
  * `voto de vereador conta pra presidente?` → `hoje sim: todo voto soma nos pontos de quem recebe; o cargo é o seu relógio.`
  * `quem vê meu voto?` → `todo mundo: placar e últimos votos são públicos, com o @.`
  * `como ganho pontos?` → `comentar 5 (1 por post) · amigo que você marcou e entrou 50 · story marcando a página 30 por dia · seguir loja 30 · cada voto recebido 5 ou mais.`
  * `zerou meus pontos?` → `domingo zera só os pontos da semana (os cargos); casa e nível ficam.`
  * `não recebi os pontos` → `entram em até 20 min; o story só conta se marcar @naoeummapa; o amigo só conta se comentar a cidade depois de você marcar.`
  * `e o app?` → `adiciona à tela inicial: vira app, com ícone e tela cheia.` (+ botão `"como virar app"` → `__site.instalarApp()`)
* `details` `"ver tudo (níveis, cargos, jeitos de ganhar pontos)"` que monta o modo completo dentro na 1ª abertura.

**Completo** — `montarComo`:

1. Bloco `"sua casa cresce"` (subtítulo `"pontos da temporada: a casa sobe com eles"` quando `Date.now() ≥ 1792368000e3`, senão `"pontos de sempre: ela nunca diminui"`): escada com 5 marcos (níveis `round(k*(N-1)/4)`), cada um com ícone, nome e `"{pts}+ pts"`; parágrafo explicando a temporada 2 (`"50 níveis, da casinha até {último}. a temporada 2 vai de domingo 18/10 às 21h até domingo 01/11 às 21h: os pontos zeraram; a sua casa e o nível ficam (o nível nunca diminui), e o selo de fundador também. o que mais sobe a casa é trazer amigo novo (+50)."`).
2. Bloco `"cargos: quem faz mais pontos na semana manda"` / `"mais pontos, cargo mais alto"`: escada `CARGOS_ESCADA` (Presidente 1 vaga Brasil; Senadores 49 vagas Brasil; Governador 1 por estado; Deputados "bancada real do estado (SP 70, MG 53, RJ 46…)"; Prefeito 1 por cidade; Vereadores 20 por cidade; Morador "todo mundo que tem casa"), regras: `na cidade: prefeito + 20 vereadores. no estado: governador + deputados. no Brasil: presidente + 49 senadores.` · `cada pessoa tem 1 cargo só, o mais alto. quem sobe abre a vaga lá embaixo: o próximo da fila assume.` · `desempate: quem tem a casa mais antiga.` · `os cargos mudam ao vivo e valem até o fim do mandato (domingo às 21h).`; destaque `"mandato {n} fecha domingo às 21h (Brasília) em {relógio}"`.
3. Bloco `"como ganhar pontos"` com `cartoesAcao({gi, h, pq})` (subtítulo `"com o que você já fez, @h"` ou `"cada jeito, o valor e o botão"`).
4. Bloco opcional `figoBloco()` e botão final `"ver minha posição no ranking"`/`"ver o ranking"`.

---

## 2. poder.js — helpers de voto usados por tudo (resumo necessário)

| Função | Regra |
|---|---|
| `votoSid()` | id anônimo do aparelho em `voto_sid` (`[a-z0-9]{8,16}`; gerado por `Math.random().toString(36)` + timestamp) |
| `VOTO_CARGOS` | `[['ver','VER','vereador'],['pref','PREF','prefeito'],['dep','DEP','deputado'],['gov','GOV','governador'],['sen','SEN','senador'],['pres','PRES','presidente']]` |
| `votoUltimo()` | lê `voto_ultimo` = `{cargo: {ts, a: alvo}}` |
| `votoFalta(c)` | `Infinity` se `Date.now() < VOTO_ABRE`; senão `max(0, ts + 3600000 − now)`; 0 = livre |
| `votoVale()` | `Ofensiva.valor()` se finito e > 0, senão **5** |
| `votoEnviar(alvo, c, eu)` | `POST /api/voto {u: eu, a: alvo, s: sid, c}` → sucesso quando `r.ok && j.ok`: grava `voto_ultimo[c] = {ts: now, a}`, dispara `CustomEvent('nem:votou', {detail:{eu, a, c, vl}})`, retorna `{ok:true, ts, vl, msg:"voto registrado[ · valeu +{vl}] · seu próximo voto de {cargo} libera às {HH:MM} · os pontos entram em até 20 min"}`; erro → `{ok:false, msg: j.erro || "não consegui registrar, tenta de novo"}` |
| `VOTO_BTNS` + `votoRotulos()` | conjunto de funções "repintar rótulos"; cada uma devolve `false` para sair do conjunto |

**Regra de negócio**: 1 voto por cargo por hora (espera de 3 600 000 ms contada no aparelho, confirmada no servidor); 6 cargos → até 6 votos por hora; pode votar em si mesmo; quem recebe ganha `vl` pontos; o eleitor ganha a ofensiva (§4).

---

## 3. eleicao.js — painel "Votar", pop-up "Seu voto desta hora", aba Eleições e utilidades da 1ª tela

### 3.1 Dados: `eleicao.json`

Gerado pela ponte a cada ~20 min. Estrutura:

| Campo | Tipo | Significado |
|---|---|---|
| `gerado` | epoch s | hora da geração |
| `mandato` | int | número da semana/mandato |
| `inicio` | epoch s | início do mandato |
| `total` | int | votos aceitos na semana |
| `eleitores` | int | pessoas distintas que votaram |
| `ultimaHora` | int | votos na última hora |
| `porCargo` | `{ver,pref,dep,gov,sen,pres,com}` | votos por cargo (`com` = "por comentário", legado) |
| `placar` | `{cargo: [[handle, votos, ibge, uf] × 10]}` | top 10 mais votados por cargo |
| `cidades` | `{ibge: [votosRecebidosPorMoradores, eleitoresDaCidade, {cargo: [handleLíderLocal, votos, eleitoresDistintos]}]}` | resumo por cidade (soma de `[0]` = `total`; de `[1]` = `eleitores`) |
| `pessoas` | `{handle: [votosRecebidos, votosDados, horasDistintasEmQueVotou]}` | por pessoa |
| `ultimos` | `[[ts, eleitor, alvo, cargo, ibgeDoAlvo, uf] × 40]` | últimos votos, mais recente primeiro |

Carregamento: `fetch('eleicao.json?t=' + floor(now/60000), {cache:'no-store'})` ao abrir o painel; `window.EleicaoDados()` compartilha uma carga com cache de **5 min** (`?t=floor(now/300000)`) para ranking e painel da eleição. Em erro usa `{total:0, placar:{}, ultimos:[], gerado: now}`.

### 3.2 Constantes

* `NOME` = `{ver:'vereador', pref:'prefeito', dep:'deputado', gov:'governador', sen:'senador', pres:'presidente', com:'por comentário'}`; `NOME_C` com inicial maiúscula.
* `ORDEM` (placar, do mais alto): `pres, sen, gov, dep, pref, ver`.
* `ORDEM_VOTO` (tela de voto): `ver, pref, dep, gov, sen, pres`.
* `ESC3` = `[['cid','Sua cidade',['pref','ver']], ['est','Seu estado',['gov','dep','sen']], ['br','Brasil',['pres']]]`.
* `NOTA_C` = `{ver:'20 vagas', dep:'bancada do estado', sen:'49 vagas', pref:'1 vaga', gov:'1 vaga', pres:'1 vaga'}`.
* `AV_COR` = 7 cores de avatar (`#ffd23f #8ecae6 #f4a259 #b79cf0 #9ad37a #ef9a9a #5fd1c4`); avatar = inicial maiúscula do @ sobre a cor `hash31(handle) % 7`.

### 3.3 Candidato sugerido e opções

`sugerido(cargo, cidade)`: quem ocupa o cargo hoje no recorte — `pres` → `PRESI`; `sen` → senador com mais `PSEM`; `gov` → `GOVI[uf]`; `dep` → deputado da UF com mais pontos; `pref` → `c.pref`; `ver` → vereador da cidade com mais pontos. `-1` = vaga aberta.

`opcoes(cargo, c, eu)` → lista de até 3: `{h, tag:'1º', pts}` (líder), `{h, tag:'2º', pts}` (vice — só pref/gov/pres), e `{h: eu, tag:'', pts}` (você mesmo, se ainda não está). `escolhido(cargo, ops)` = a opção em `escolha[cargo]` ou a 1ª.

### 3.4 Painel "Votar" (`section#eleicao.el`, aria-label `votar`)

Cabeçalho: `h1 "Votar"` + botão fechar (aria-label `"voltar pro mapa"`). Corpo `desenhar()`:

0. Se `now < VOTO_ABRE`: só `"a eleição da temporada 2 começa hoje às 21h."`.
1. Bloco do foguinho `Ofensiva.bloco()` (sem × e sem CTA) se há `eu`.
2. **Passo "quem é você"** (`passoEu`) quando não há `voto_eu`: `h2 "Qual é o seu @?"`, `p "só quem tem casa no mapa vota."`, campo com prefixo `@` (placeholder `"seu @ do Instagram"`, `maxlength 60`, aria-label `"qual é o seu @?"`), botão `"Continuar"`. Erro: `"não achei esse @ no mapa. comente a sua cidade num post do @naoeummapa para ganhar casa."` Sucesso: grava `voto_eu`, `lembrarEu`, `Ofensiva.repintar()`, redesenha.
3. **Passo votos** (`passoVotos`): chip `avatar + @eu` + link `"trocar"` (remove `voto_eu`); `h2 "Em quem você vota?"`; `p "um voto por cargo a cada hora. o líder já vem marcado, toque no nome para trocar."`. Três grupos (`h3 "Sua cidade · {cidade}"`, `"Seu estado · {UF}"`, `"Brasil"`); por cargo uma linha: rótulo (`b` nome do cargo + `small` nota de vagas), botão "quem" com avatar, `"@h (você)"` e `"{pts} pts na semana"`, texto `"trocar"` se há ≥2 opções (`aria-expanded`), ou `"vaga aberta"` desabilitado; status à direita: `""` (sem candidato), `"abre às 21h"` (Infinity), `"libera em {N min}"` ou `"pronto"` (classe `ok`). Abrir a lista: `role=radiogroup` com `role=radio`/`aria-checked`, cada opção `"@h"` + `"1º · você · 123 pts"`.
   CTA único `button.v3-go` + `p role=status`:
   * antes de abrir: desabilitado `"a votação abre às 21h"`;
   * `n>0` cargos livres com candidato: `"Votar em {n} cargo(s) · +{vl} pontos cada"`;
   * nenhum: `"Próximo voto em {min}"` + nota `"volte aqui quando liberar: cada hora vale pontos."`, ou `"sem votos disponíveis"`.
   Rótulos reavaliados por `votoRotulos()` (registrado em `VOTO_BTNS`) e por um `setTimeout` de **30 s** a cada desenho.
   `votar3`: coleta `[cargo, handle]` de todos os cargos livres; botão vira `"registrando 1 de N"` … e chama `votoEnviar` em série; guarda `feito = {res, ts}` e redesenha.
4. **Passo pronto** (`passoFeito`): ícone ✓ (ou × se nenhum ok); `h2 "1 voto registrado"`/`"{n} votos registrados"`/`"Não deu para votar"`; `p "+{vl} pontos para cada pessoa que você escolheu. eles entram em até 20 min."` ou `"tente de novo daqui a pouco."`; celebração do fogo (`Ofensiva.pendente()`) **dentro** da tela; lista `li.ok|erro` com `Cargo` + `@h` ou a mensagem de erro; `"próximo voto"` + `"às {HH:MM} · em {min}"`; botões `"Ver o placar"` (rola até o placar) e `"Voltar"`.
5. **Placar da semana** (`placar3`): `h2 "Placar da semana"`; chips `role=tablist` por cargo na `ORDEM`; `"carregando…"` até o JSON chegar; vazio: `"ainda sem votos para {cargo} nesta semana. seja o primeiro."`; senão barras do **top 3 + você** (se você está além do 3º, separador `v3-gap` e sua linha com a posição real), cada barra `pos · avatar · @h (você) · N voto(s)` e trilho cuja largura = `max(4, n/máx*100)%` animada no 2º `requestAnimationFrame`; toque abre a casa (preenche a busca `#q` e dá `requestSubmit` no `#form`). Rodapé: `"{total} votos de {eleitores} eleitores · atualizado há N min"` ou `"atualiza a cada 20 min"`.
   **Placar sem repetir** (`placarSemRepetir`): percorre `ORDEM` do presidente ao vereador; em cada cargo remove quem já ficou no top 3 de um cargo acima; os 3 primeiros restantes passam a "ocupar".
6. Se `MISSOES`: `p "enquanto o próximo voto não libera"` + `miBotaoCidade(cidade)`.
7. Link `"ver o ranking de pontos"` (fecha e abre o ranking).

`abrir()` monta, mostra, desenha e carrega; `fechar()` esconde e limpa `#eleicao` do hash. `hashchange` `#eleicao` abre.

### 3.5 Pop-up "Seu voto desta hora" (aba Eleições, só com hub `FRASES + PainelEleicao`)

`section#eleicao-pop.el-pop` `role=dialog` aria-label `"seu voto desta hora"`, folha que sobe do rodapé (fundo escuro clicável fecha). Conteúdo (`popDesenhar`):

* `h2 "Seu voto desta hora"` + × (`"fechar"`).
* Sem `eu`: `passoEu(popDesenhar)`.
* Com `eu`: pílula com ícone de fogo `"+{vl} pontos por voto"`; para cada grupo de `ESC3` com candidatos:
  * botão grande `pg-go`: `b "Sua cidade · {cidade}"` / `"Seu estado · UF"` / `"Brasil"`, `small` com `"Prefeito @x · Vereador @y (você)"`, e status `pg-st`: `"Votar"` quando há cargo livre; senão desabilitado com `"votado"` (classe `ok`, se este pop-up já votou com sucesso), `"às 21h"` ou `"em {min}"`; durante o envio todos ficam desabilitados com `"…"`; erro → classe `err` e o `small` mostra a mensagem;
  * botão `"em mim"` (aria-label `"votar em mim, {grupo}"`) vota em si em todos os cargos livres do grupo.
* Rodapé fixo: botão primário `"Ver a apuração"` (`#popApuracao` → `irHub()`) e link `"ver todos os cargos"` (fecha o pop-up e abre o painel Votar).
* Redesenho automático a cada **30 s** (se não estiver enviando). Se após votar não resta nada pendente, espera **1,1 s** e vai para o hub.

`irHub()`: fecha o pop-up; se não há hub, abre o painel Votar; senão `PainelEleicao.abrir({faixa})` com `faixa = "seu próximo voto libera em {min}"` quando não há voto pendente.

`eleicoes()` (toque na aba): sem hub → painel Votar; com hub → se não há `eu` **ou** há voto pendente → pop-up (e carrega o JSON se ainda não há); senão direto `irHub()`.

`window.Eleicao = { abrir, fechar, eleicoes, fecharPop, popAberto, passoEu }`.

### 3.6 Extras montados neste arquivo (1ª tela)

* **Faixa de evento** (`#evFaixa`): com `EVENTO_SITE` e dentro de `[ini, fim)` cria `p.ev-faixa` com `E.txt` logo após `#dica1`; agenda aparecer/sumir.
* **Visita anônima**: id `nem_vid` (12 chars base36); `POST /api/visita {d, n: 1ª visita?1:0, eu: tem nem_eu?1:0, p:1 se SIMPLES e em modo app}` com `keepalive`; não envia em localhost.
* **Cartão "voltou"** (`REATIVA`): 1 vez por aparelho (`nem_reativa1`), só se há `nem_eu` e a última visita (`nem_ult`) foi há ≥ 12 h: `section.reativa` aria-label `"o que mudou"`, ×, `"voltou, @h! o que mudou:"`, lista `50 níveis (o seu nível ficou)` · `vote a cada hora` · `eleição ao vivo` (+ `hoje amigo = +100` em evento), botão `"ver minha casa"`, link `"conta o que você quer no jogo (comenta no nosso último post)"` para o Instagram do site.
* **Fila de avisos (SIMPLES)**: só 1 cartão acima do mapa por vez (ordem evento › foguinho › voltou); os outros viram uma linha de links no lugar da dica (`"{texto} ›"`, separados por ` · `): evento = 1ª parte do texto, fogo = `"seu voto vale +N"`, voltou = `"voltou? veja o que mudou"`. O "voltou" dentro do fogo vira a linha `voltaTxt()`: `"desde a última visita: +{d} posição(ões) na cidade ({pos}º)"` / `"desde a última visita: caiu {d} na cidade ({pos}º) · vote pra subir"` / `"desde a última visita: {pos}º na cidade"` (posição guardada em `nem_s1pos = {h, p, t}`). Esconde `#abrirNegocioTopo`. Observa mutações de `#topo`.
* **Vira app**: guarda `beforeinstallprompt`; `dicaApp()` cria `section.app-dica` (`role=dialog`, aria-label `"vira app"`): `"vira app · o mapa na sua tela inicial, em tela cheia, a 1 toque de votar"`, botão `"instalar"` (Android) ou instruções: dentro do Instagram `"abra no navegador (⋯ → abrir no navegador) e depois: compartilhar → adicionar à tela inicial"`, iOS `"toque em compartilhar e depois em "adicionar à tela inicial""`, outros `"no menu do navegador (⋮), toque em "instalar app" ou "adicionar à tela inicial""`. Já em app: toast `"você já está no app"`. Aparece automaticamente **3,8 s** depois do 1º voto (`nem:votou`), 1 vez (`nem_app_dica`).
* `rotulosNovos()`: título do painel de ranking vira `"Ranking"` e aria-label `"Ranking: sua posição na cidade, no estado e no Brasil"`.

---

## 4. ofensiva.js — sequência de fogo

### 4.1 Dados: `ofensiva.json`

| Campo | Significado |
|---|---|
| `gerado`, `dia` | geração (epoch s, `YYYY-MM-DD`) |
| `ligada` | `true` só quando o arquivo de ativação existe; `false`/ausente = nada aparece |
| `desde` | epoch s em que a ofensiva começou a contar |
| `base` | 5 |
| `mandato` | `{n, inicio, fim}` (epoch s) |
| `n` | `{ativas: eleitores com C≥1, ge2: com C≥2}` |
| `p` | `{handle: [C, vale, votosNaSemana, horaRelogio]}` — `C` = horas-relógio distintas com voto aceito nesta semana; `vale` = valor do próximo voto; `horaRelogio = floor(ts/3600)` da última hora contada |

Carga: `fetch('ofensiva.json?t='+floor(now/300000), {cache:'no-store'})` no início e a cada **10 min**; repinta o cartão a cada **30 s**.

### 4.2 Regra

```
BASE = 5
estado(eu):
  [C, , votos, hora] = T.p[eu] || [0, 5, 0, null]
  se now ≥ mandato.fim: C = 0, votos = 0, hora = null       // semana virou
  L = localStorage nem_of = {h, m (nº do mandato), C, hora}; se L.h==eu && L.m==mandato.n && L.C > C: C = L.C, hora = L.hora   // otimismo local
  ha = floor(now/3600e3)
  vale = BASE + C − (hora == ha ? 1 : 0)   // se esta hora já contou, o voto de agora não sobe
  nova = !T.p[eu] && C == 0
```

Ao votar (`nem:votou` com `detail.eu == eu`): `subiu = (hora != ha)`; se subiu grava `nem_of = {h, m, C: C+1, hora: ha}`; limpa `nem_ofx`; celebra; repinta; `votoRotulos()`. Zera domingo 21h (fim do mandato). `Ofensiva.de(h)` devolve o C de qualquer @ (para o cartão da casa).

### 4.3 Cartão do fogo (`section.ofe`, aria-label `"sua ofensiva de voto"`, `data-estado = nova|quente|aceso`)

Fogo SVG de 3 chamas + `b.ofe-n "+{vale}"`; textos:

* título `"seu voto vale +{vale}"`;
* sub: novo → `"cada voto que você dá sobe 1 · {prox}"`; senão `"cada voto sobe 1 · {prox}"`, onde `prox` = `"pode votar agora"` | `"a votação abre às 21h"` | `"próximo voto em {min}"`;
* `"zera domingo 21h · faltam {Xd Yh | Yh Zmin | Zmin}"`;
* botão `"votar agora"` (abre `Eleicao.abrir()`) quando pode votar (ou sempre no estado novo);
* × grava `nem_ofx = hora atual` → o cartão não volta nesta hora (volta na próxima ou ao votar).

Posição: depois de `.reativa`, senão depois de `#evFaixa`, senão depois de `#dica1`. Classe `ofe-entra` anima (respeita `prefers-reduced-motion`).

### 4.4 Celebração (`celebrar(valeu, proximo, quando, subiu)`)

`div.ofe-pop` `role=status aria-live=polite`: fogo com `"+{valeu}"`, `"seu voto valeu +{valeu}"`, e `"+{valeu} → próximo vale +{proximo} a partir das {HH:MM}"` (subiu) ou `"sobe de novo às {HH:MM} · aí vale +{proximo}"`. Após **1,25 s** o número muda para `+{proximo}` com classe `bate`. Fecha ao toque ou em **3,4 s**. Se o painel Votar está aberto, a celebração não cobre nada: fica guardada (`PEND`, válida 15 s) e é inserida na tela "pronto" (`Ofensiva.pendente()`); em 6 votos seguidos vale a 1ª.

`window.Ofensiva = { de, pronto, pendente, valor, estado, bloco, repintar }`.

---

## 5. missoes.js — missões da cidade

### 5.1 Objetivo

Quatro áreas por cidade (**Água · Infraestrutura · Saúde · Segurança**), cada uma com um minigame; só moradores ajudam a própria cidade; cada área 1 vez a cada **12 h** por pessoa; concluir dá **+5** para a pessoa e **+10** para a cidade; quem mais conclui cada área na semana vira **ministro**.

### 5.2 Dados: `missoes.json`

| Campo | Significado |
|---|---|
| `gerado`, `ligada`, `dia` | meta |
| `semana` | `{inicio, fim}` epoch s |
| `pts`, `cidade` | 5 e 10 |
| `cidades` | `{ibge: [missõesNaSemana, pontosDaCidade, moradoresQueAjudaram, [água, infra, saúde, segurança]]}` |
| `hoje` | `{handle: bitmask}` áreas em espera (bit0 água, bit1 infra, bit2 saúde, bit3 seg) |
| `prox` | `{handle: [ts água, ts infra, ts saúde, ts seg]}` epoch s em que cada área libera (0 = livre) |
| `ministros` | `{agua|infra|saude|seg: [handle, missões]}` |
| `top` | `{área: [[handle, missões, uf] × 5]}` |

Carga única por sessão: `fetch('missoes.json?t='+floor(now/300000), {cache:'no-store'})`; fallback `{cidades:{}, hoje:{}, ministros:{}, top:{}}`.

### 5.3 Constantes

* `MI_LISTA` = `[['agua','agua','Água','gire os canos e leve a água até a casa'], ['infra','infra','Infraestrutura','repita a ordem em que os postes acendem'], ['saude','saude','Saúde','arraste cada paciente para a sala do sintoma dele'], ['seg','segur','Segurança','salve o dia na cidade em microjogos rápidos','justiça']]` (5º item = nome da pasta do ministro: "ministro da justiça").
* `MI_COR` = `{agua:#6cc4f0, infra:#ffb347, saude:#72dca0, seg:#9b7bff}`; CSS usa `--area-{k}`.
* `MI_PTS = 5`, `MI_CID = 10`, `MI_JAN = 12 h`, `MI_ENVIO_MIN = 8600 ms` (servidor aceita "fim" ≥ 8 s após "ini"; 0,6 s de folga), `MI_PEND_MAX = 2 h`.
* Ícones SVG inline (traço 2, quadro 24): gota, raio, cruz em caixa, escudo com check, chave, check, relógio.

### 5.4 Trava de 12 h (`miLibera(h)`)

`[ms de liberação por área]` = máximo entre `prox[h][i]*1000` (servidor) e `nem_mis2 = {h, l:[ms×4]}` (otimista, gravado ao concluir com `now + 12h`); valores ≤ now viram 0. `miFeitas(h)` = bitmask das áreas em espera. `miDur(ms)` → `"H h M min"` ou `"M min SS s"`.

### 5.5 API

`POST /api/missao {u: handle, m: área ('agua'|'infra'|'saude'|'seg'), e: 'ini'|'fim', j: idDaVariação, s: votoSid()}` com `keepalive`; só o `r.ok` importa. "ini" ao abrir o jogo; "fim" ao vencer — se a vitória veio antes de 8,6 s, o envio espera em silêncio; em falha tenta de novo até 3× (3 s, 6 s, 9 s). O servidor valida: morador da cidade, fim ≥ 8 s após ini, 1 vez por área a cada 12 h.

### 5.6 Rodízio de variações (`miEscolha(eu, área, J)`)

```
jan = floor(now / 12h)
i = fnv1a32(eu + '|' + área + '|' + jan) % n
se n > 1 e nem_mis_ult[área] == v[i].id: i = (i+1) % n    // não repete o último jogo da área
```
Gancho de teste `window.__miForca` só em localhost. `nem_mis_ult = {área: id}` gravado ao concluir.

### 5.7 Pontos otimistas

`nem_mis_pend = [{h, i: ibge, a: área, t: ts}]`. `miPendLer()` descarta vencidos (> 2 h) e os que o `prox` oficial já cobre (`prox[h][a]*1000 ≥ t + 12h − 120 s`). `miSobrepor(p)` soma **uma vez por carga** (`MI.ap`): `PSEM[gi] += 5`, `PTOT[gi] += 5`, `c.ps += 5`, `c.pt += 5`; em `CVM` (cidade viva) `pts[a] += 10`, `orc += 10` se `a < 3`, `gc[a] += 10`; em `missoes.json` `cidades[ibge][1] += 10` e `[3][a] += 1`. `window.miPendentes(x)` → `{n, voce (×5), cidade (×10), areas[4] (×10)}` por ibge ou @ (marcado `jaSomado = true` para quem lê não duplicar). Evento `nem-mis-pend`.

### 5.8 Telas (`section#missoes.mi`, aria-label `"missões da cidade"`)

**Lista** (`miLista(c)`): `h1 "Ajude {cidade}"` (ou `"Missões"`); `p.mi-lead "Uma missão por área, de novo a cada 12 horas. +5 pontos para você e +10 para {cidade} em cada uma."`.
* Sem @: `"Qual é o seu @?"` + campo (placeholder `"seu @ do Instagram"`) + `"Continuar"`; erro `"não achei esse @ no mapa. só quem tem casa joga."`.
* Cidade diferente da sua: `"só moradores ajudam a própria cidade. você mora em {minha}."` + botão `"Ajudar {minha}"`.
* Grade de 4 cartões (`mr-card {agua|infra|saude|segur}`, classe `espera` quando travada): ícone redondo na cor da área; `span.mr-ar` (nome da área em caixa alta), `b.mr-nm "Missão de {área}"` (substituído pelo nome da variação quando o arquivo de jogos carrega), `i.mr-fr` (frase); barra de progresso com largura `max(6%, feitas/máx×100)` e `small "{n} missão(ões) feita(s) em {cidade} nesta semana[ · {k} sua(s) a confirmar]"` ou `"progresso da cidade aparece aqui"`; botão `mr-go`: `"Jogar"` | desabilitado com relógio + `"libera em {dur}"` (contagem viva a cada 1 s, redesenha quando libera) | `"Só para moradores"` | `"Entre com o seu @"`.
* `"{n} morador(es) ajudou/ajudaram {cidade} nesta semana"` e o bloco de ministérios (§5.9).

**Jogo** (`miJogar(c, k)`): `"abrindo…"` → carrega `missoes-jogos.js?v={__MJV}` sob demanda (erro: `"não consegui abrir o jogo. tenta de novo."`); re-checa a trava; escolhe a variação; manda `ini`; cabeçalho com ícone + nome da variação e `p.mi-dica` (a `dica` devolvida pelo jogo); contêiner `.mi-jogo` com `--ac` da área; **semente** `= (ibge*31 + jan*7 + i*1013) >>> 0` (mesmo desafio para a cidade toda na janela de 12 h; `i` = índice da área). Um `MutationObserver` marca `data-mj-venceu` no contêiner quando aparece um nó com classe `*-win` (para testes). O callback `fim()` (uma vez): grava trava, `nem_mis_ult`, pendente otimista, agenda o `fim` para a API, mostra o resultado.

**Resultado** (`miResultado`): selo ✓ na cor da área, `b "{Área}: feita"`, chips `"+5 para você"` e `"+10 para {cidade}"`, se há "cidade viva": `"faltam {n} pontos de {área} pra {obra}"`, `p "já somados aqui; a ponte confirma em até 20 min. {Área} libera de novo em 12 h."`, botões `"Próxima missão"` e `"Fechar"`.

**Entrada** (`miBotaoCidade(c)`): botão `"Ajude {cidade} (4 missões)"` (morador, primário) ou `"Missões de {cidade}"` (mini); depois da carga: `"{n} morador(es) ajudou/ajudaram esta semana"` e, para o morador, `"Ajude {cidade} ({k} missão(ões) livre(s))"` ou `"{cidade}: 4 de 4 feitas, libera em breve"`.

### 5.9 Ministérios (`miBlocoBrasilia()`)

`h3 "ministérios da semana"`, `p "quem mais concluiu cada missão nesta semana vira ministro. uma pasta por pessoa. zera domingo 21h."`; por área: ícone, `"ministro da água|infraestrutura|saúde|justiça"`, botão `@handle` (abre a casa) + `"{n} missão(ões)"`, ou `"vaga aberta: jogue as missões da sua cidade"`; `details "os 5 que mais ajudaram"` com `"{i}º @h (UF) · n"`. `miMinistroDe(h)` devolve a pasta de alguém.

`window.__mi` expõe `resolver, abrir, lista, feitas, libera, escolha, variantes` para testes.

---

## 6. missoes-jogos.js — os 18 minigames

### 6.1 Contrato comum

* Cada jogo é `fn(caixa, semente, fim) → { dica, resolver, … }`. `caixa` = contêiner; `semente` = inteiro (mesma semente = mesmo desafio); `fim()` deve ser chamado ~1,5–2,6 s depois da tela de vitória.
* PRNG determinístico (mulberry32): `s = (s + 0x6D2B79F5)>>>0; t = imul(s ^ s>>>15, s|1); t ^= t + imul(t ^ t>>>7, t|61); return ((t ^ t>>>14)>>>0) / 2^32`.
* Registro: `window.MissoesJogos = { agua, infra, saude, variantes, consumir }`; `variantes[área] = [{id, nome, frase, fn}]`; arquivos extras fazem `window.MJ_FILA.push([área, id, nome, frase, fn])` e `consumir()` incorpora (sem duplicar id; cria `variantes.seg` se faltar).
* Tela de vitória comum: overlay com classe `*-win` (`role=status`), 18–20 confetes (`--x/--y/--r/--d`), selo SVG 120×120 (círculo amarelo + branco + ícone), `b` título e `span.l` linha. Tela de reinício: overlay branco com título + sub, remove-se sozinha (1–1,5 s) e o jogo recomeça do zero.
* Largura máx. 362 px; tudo SVG/CSS inline; sem imagens, sem emoji; respeita `prefers-reduced-motion`.
* `resolver()` é só para teste automático (resolve o jogo).

Tabela de variações:

| Área | id | nome | frase |
|---|---|---|---|
| agua | canos | Canos | gire os canos e leve a água até a casa |
| agua | vazamento | Vazamentos | toque nos vazamentos para tapar antes que a caixa esvazie. |
| agua | comporta | Comportas | abra e feche as comportas para manter o nível na faixa verde. |
| agua | filtro | Estação de tratamento | toque no filtro que combina com a sujeira que desce. |
| agua | calha | Chuva e calhas | toque nas calhas para guiar a chuva até a cisterna. |
| infra | postes | Postes | repita a ordem em que os postes acendem |
| infra | fios | Ligue a rede | Ligue cada casa à subestação da mesma cor, sem cruzar os fios. |
| infra | guindaste | Torre de obra | Toque para soltar o andar bem em cima do anterior. |
| infra | semaforo | Hora do rush | Toque nos semáforos para os carros passarem sem bater. |
| infra | asfalto | Tapa-buraco | Arraste o rolo num traço só, cobrindo todos os buracos. |
| saude | triagem | Triagem | arraste cada paciente para a sala do sintoma dele |
| saude | ambulancia | Corre, ambulância | deslize para trocar de faixa e chegue ao hospital. |
| saude | ritmo | Batida certa | toque quando o pico cruzar o círculo. |
| saude | vacinacao | Fila da vacina | toque em quem está com o cartão vermelho. |
| saude | germes | Mão limpa | esfregue a mão para tirar todos os germes. |
| seg | gato | Gato na árvore | segure a escada e solte no gato |
| seg | fogo | Fogo na janela | arraste a mangueira até as chamas |
| seg | sinal | Sinal fechado | feche o sinal antes do carro chegar |
| seg | viatura | Viatura na pista | deslize e desvie dos buracos |
| seg | praca | Praça acesa | acenda os postes antes de escurecer |

### 6.2 ÁGUA

**canos** — grade N×N (`N = 6` se `semente % 4 == 0`, senão 5). Peça = máscara de 4 bits (0 cima, 1 direita, 2 baixo, 3 esquerda); girar 90° = rotacionar a máscara. Geração: caminho aleatório da coluna 0 (linha `ent` sorteada) até a coluna N−1 sem repetir célula (passos ponderados `[1,1,1,0,2]` = direita 3×, cima 1×, baixo 1×; até 300 tentativas; fallback linha reta na linha 2); as células do caminho recebem a máscara exigida; as demais recebem formas `[5 (reto), 3 (curva), 7 (T), 3]` giradas ao acaso; rotação inicial aleatória, mas nenhuma célula do caminho começa certa. Caixa d'água à esquerda na linha `ent`, casa à direita na linha `sai`. Toque gira +90° (anima com mola). `cheios()` = BFS a partir da célula (0, ent) se ela abre para a esquerda, propagando por lados compatíveis; células cheias ganham classe `cheio` com atraso `--d` = distância (onda de 80 ms por célula). **Vitória**: a célula (N−1, sai) está cheia e abre para a direita → a casa acende (`+80·n+200 ms`), vitória `"água chegou" / "o bairro agradece"` em `80·n+1000 ms`, `fim` em `80·n+2600 ms`. Dica: `"gire os canos e leve a água até a casa."`

**vazamento** — `N = 10 + semente%3` furos a tapar. 13 pontos furáveis fixos num encanamento com 3 casas. Loop: a cada `prox` s (começa 0,5; depois `lerp(1,55 → 0,8, fix/N) × (0,8..1,2)`) um ponto livre vaza (máx. 5 ao mesmo tempo; a cada 4 tapados abre um extra). Cada vazamento drena `0,05 + 0,035·min(1, idade/3,5)` do nível por s; o nível repõe 0,02/s; após 2,4 s o furo fica `grave`. Toque no furo tapa (+1, remendo). Nível ≤ 0 → reinício `"a caixa secou" / "tape mais rápido"`. Pílula mostra `"{nível}%"` (classe `erro` abaixo de 30 %). **Vitória** ao tapar N: `"vazamentos tapados" / "a caixa segurou"` em 0,7 s, `fim` em 2,2 s.

**comporta** — represa com 3 comportas em alturas `LV = [0,12, 0,40, 0,68]` do nível; faixa alvo `[0,50, 0,66]`; `C = 0,3 + (semente%3)·0,015`. Chuva `rain(t) = clamp(0,8·sin(0,62t+φ1) + 0,45·sin(0,23t+φ2), 0, 1) × rampa(3→6 s)`; entrada `0,09 + amp·rain` (`amp = 0,22 + (semente%3)·0,03`); cada comporta aberta drena `C·sqrt(max(0, L − LV[k]))`. Toque alterna a comporta. `hold` sobe `dt/6` dentro da faixa e desce `dt/4` fora; nível ≥ 0,995 transborda (tela treme, `hold = 0`). Pílula: `cheia | alto | subindo | baixo | no ponto`. **Vitória** quando `hold ≥ 1` (6 s acumulados na faixa): `"nível no ponto" / "represa estável"`.

**filtro** — `N = 10 + semente%3` sujeiras, 3 vidas. Três tanques (`grade`, `carvão`, `cloro`) em ordem embaralhada pela semente; sujeira tipo 0/1/2 combina com o filtro do mesmo tipo. A sujeira desce pelo cano central (`v = 64·(1 + 0,45·ok/N)` px/s) e na bifurcação (`d = 112`) trava no tanque **selecionado** naquele instante (toque/tecla seleciona; braço gira ±55°). Chegou no tanque certo: +1 e tanque enche; errado: −1 vida e lama. Spawn a cada `lerp(1,75 → 1,2)·(0,85..1,15)` s enquanto `ok + emVoo < N`. 3 erros → `"água suja demais" / "filtro certo para cada sujeira"` e reinicia. **Vitória** com N acertos: `"água tratada" / "pronta para a torneira"`.

**calha** — 8 calhas giratórias (3+2+3) acima de uma cisterna em `CX = [134,170,206][semente%3]`; `NEED = 64 + (semente%3)·4` gotas. Cada calha tem lado "bom" (apontar para a cisterna); começa com ~72 % apontando errado e no máximo 2 certas. Toque inverte a inclinação (±0,5 rad, interpolada). Nuvem oscila (`x = 170 + 48·sin(0,5t+φ)`), 7,5 gotas/s; física: gravidade 560, limite 380; ao tocar uma calha a gota desliza acelerando `300·|sin a|`, sai pela ponta com `vx = ±0,45·v·cos a`; calha plana escorre para o lado. Gota que entra na boca da cisterna (`|x−CX| < 60`, `y ≥ 332`) conta; no chão vira respingo. **Vitória** em `NEED`: `"cisterna cheia" / "chuva aproveitada"`.

### 6.3 INFRAESTRUTURA

**postes** — Simon de 6 postes numa cidade noturna. `rodadas = [3, 4, 5 + (semente%3==0 ? 1 : 0)]`; sequência de `rodadas[2]` índices sorteados. Cada rodada: pílula `"olhe"` (520 ms), mostra os `n` primeiros (430 ms aceso + 150 ms), pílula `"sua vez"`. Toque certo: ping + acende 240 ms; errado: poste vermelho, cena treme, pílula `"quase"`, 650 ms, e **a mesma ordem é mostrada de novo** (não perde progresso de rodada). Rodada completa: ponto preenchido, janelas da cidade acendem `rodada/3 × 80 %`, pílula `"boa"` (750 ms). **Vitória** após as 3 rodadas: `"luz de volta" / "a cidade acendeu"` em ~1 s, `fim` +1,5 s.

**fios** — Flow: grade `N = 6` se `semente%4==0` senão 5; `NP = 4` (grande) ou `4` se `semente%3==0` senão 3 pares. Geração: caminhos aleatórios de 4..N+2 células sem se tocar (até 400 tentativas) → solução garantida; pontas = subestação (início) e casa (fim) da mesma cor. Arrastar a partir de uma ponta ou de um fio existente; `passo(c)` só aceita vizinho ortogonal, não passa por ponta de outra cor, **fio novo corta o velho** (o outro fio volta até a célula cortada e deixa de estar ligado), voltar uma célula desfaz, tocar numa célula do próprio caminho recorta até ela. Ligado quando encosta na outra ponta. Pílula `"{ligados}/{NP}"`. **Vitória** quando todos ligados: `"cidade ligada" / "a rede está de pé"` (0,75 s + 1 s).

**guindaste** — Stack: `ALVO = 7 + semente%3` andares; largura inicial 150; carro do guindaste balança `cx = 170 + 82·sin(fase)` com `ω = 2,0 + (semente%4)·0,08` (sobe 0,13 por andar, máx. 3,6). Toque solta (queda 2600 px/s²). Pouso: `|dx| ≤ 9` = **perfeito** (mantém largura, pop `"perfeito"`); sobreposição `< 12` = erro: o andar despenca, pop `"errou"`, reinício `"a torre caiu" / "vamos de novo"`; senão a sobra é cortada e cai (largura diminui). Câmera sobe acompanhando. **Vitória** com `ALVO` andares: telhado + antena, `"torre de pé" / "obra entregue"`.

**semaforo** — cruzamento com 4 vias (L, O, S, N), 4 semáforos independentes (começam vermelhos), `ALVO = 10 + semente%4` carros, 3 chances. Spawn a cada `0,78..1,28` s em via ponderada (`0,7..1,3`), só se o último carro já avançou. Carro: acelera 380, freia 950, `VMAX = 135`; para na linha (`STOP = 122`) se vermelho, mantém distância `CL+7` do líder. Conta ao cruzar `s > 212 + CL/2`. Colisão = retângulos de um carro horizontal e um vertical se sobrepõem → explosão, os dois somem, −1 chance, tela treme; 0 chances → `"muita batida" / "vamos de novo"` (zera tudo). **Vitória**: `"trânsito livre" / "ninguém bateu"`.

**asfalto** — grade 5×6; caminho `L = 12 + semente%4` células (auto-evitante, até 400 tentativas); `NB = 5 + semente%2` buracos sorteados no caminho (nunca a 1ª célula); `NO = 5 + semente%3` obstáculos fora do caminho (cavaletes/cones); orçamento `L + 3` células. Arrastar **num traço só** (pointerdown numa célula livre inicia; soltar antes de cobrir tudo apaga o traço); passo só ortogonal, sem repetir célula, voltar desfaz, obstáculo treme a tela; estourar o orçamento recusa o passo (pílula vermelha). Barra mostra o orçamento restante (classe `baixo` com ≤ 2). **Vitória** quando os `NB` buracos estão cobertos: `"rua nova" / "sem nenhum buraco"`.

### 6.4 SAÚDE

**triagem** — pronto-socorro: `ALVO = 10 + semente%3` pacientes, `T = 6000 − (semente%3)·500` ms de paciência, 3 chances. Três salas (coração/osso/febre) em ordem embaralhada. Fila de 3 cartões empilhados; o da frente tem balão com o sintoma e barra de tempo que drena em `T`; aos 60 % fica `urgente` (suor, boca aberta, treme). Toque na sala **ou** arraste o cartão até ela: certa → voa para a sala, +1; errada → treme, −1 chance (o paciente fica); tempo esgotado → o paciente vai embora (−1 chance). 0 chances → `"plantão cheio" / "vamos de novo"` (zera contagem). **Vitória**: `"todos atendidos" / "plantão salvo"` (0,6 s + 1,7 s).

**ambulancia** — corrida vertical em 3 faixas (`x = 101/173/245`), `TOTAL = 20 + semente%3` s, 3 vidas. Carros descem a `185` px/s em fileiras com 1 ou 2 bloqueios (sempre 1 faixa livre alcançável, a livre muda ≤ 1 faixa por vez; após a 4ª fileira 22 % de chance de caminhão longo). Toque/arraste na faixa escolhe a faixa (setas ←/→ também); a ambulância desliza (`ax += (alvo−ax)·min(1, 13dt)`). Colisão (AABB) → −1 vida, invulnerável 1,5 s, relógio volta 1,4 s, pop `"bateu"`; 0 vidas → `"trânsito pesado" / "vamos de novo"`. Ao esgotar o tempo os carros somem, o hospital desce e a ambulância estaciona. **Vitória**: `"chegou a tempo" / "paciente a salvo"`.

**ritmo** — monitor cardíaco: batidas viajam da direita para a linha alvo (`x = 92`, 150 px/s); intervalo `I0 = 0,94 − (semente%3)·0,05` s, após as 4 primeiras com irregularidade `±(0,1 + (semente%3)·0,04)`; `ALVO = 18 + semente%3` pontos. Toque na tela/botão/espaço julga a batida mais próxima (janela 0,25 s): `|d| < 0,075` = `"perfeito"` (+1,25), `< 0,16` = `"bom"` (+1), senão `"cedo"`/`"tarde"` (−1); sem batida próxima `"fora do tempo"` (−0,6, com debounce 0,28 s); batida não tocada até 0,17 s depois = `"falhou"` (−1,5). BPM exibido oscila `72 ± 52·(1 − m/ALVO)`; status `instável | quase | estável`. **Vitória** em `m ≥ ALVO`: `"batimento estável" / "coração em ritmo"`.

**vacinacao** — fila anda da direita para a esquerda a `V0 = 84 + (semente%3)·9` px/s (+45 % ao longo do jogo); `ALVO = 11 + semente%3`, 3 vidas. Cada pessoa tem cartão vermelho (pendente, 64 %, máx. 4 seguidos) ou verde (em dia, máx. 2 seguidos). Toque numa pessoa (±44 px): pendente → seringa, vira verde, +1; já em dia → erro `"já está em dia"` (−1 vida, uma vez por pessoa); pendente que sai da tela → `"escapou"` (−1 vida). 0 vidas → `"fila bagunçada" / "vamos de novo"`. **Vitória**: `"fila vacinada" / "todo mundo em dia"`.

**germes** — mão com `N = 13 + semente%4` germes (24 % grandes, hp 2,2; normais hp 1) posicionados em zonas (dedos, palma ×5 de peso, polegar) sem se tocar (≥ 44 px). Arrastar o dedo: germes a < `r+22` px do ponteiro em movimento (último move < 110 ms) perdem `1,15 hp/s`, encolhem e viram ×_×; espuma (bolhas) acompanha o dedo a cada 11 px. Contador mostra os restantes; mancha marrom da mão esmaece. **Vitória** com todos mortos: brilhos e `"mãos limpas" / "nenhum germe sobrou"`.

### 6.5 SEGURANÇA (estilo "uma ação, 8–15 s")

Esqueleto comum `jogo(...)`: `monta(c)` desenha a cena e devolve `{cheat, errar}`; `c.perdeu(título, linha)` treme, mostra `"quase!"` + linha + botão `"de novo"` e recomeça sozinho em 1,8 s (ou ao toque); `c.ganhou(selo, título, linha, atraso)` → vitória e `fim` 1,5 s depois. HUD = barra de progresso + pílula (classe `urge` quando o tempo aperta).

**gato** — segurar para esticar a escada (98 px/s, máx. 306) e soltar quando a ponta chega nos pés do gato, que balança `±13·sin(1,8t)`; tolerância 17 px; tempo 11 s. Soltar com < 14 px recolhe sem contar. Acertou: `"miau!"`, `"gato salvo" / "o bombeiro agradece"`; curta → `"curta!"` + `"faltou escada"`; passou → `"passou!"` + `"a escada passou do gato"`; tempo → `"o galho estalou, tente de novo"`.

**fogo** — prédio 3×3 janelas, 4 focos sorteados, 14 s. Arrastar o bocal (`nx` 14..332, `ny` 100..410) — enquanto pressionado o jato sobe em cone; foco dentro do cone (`−18 < dy < 112`, `dx < 22 + 0,26·dy`) perde 1 hp/s (hp 1,05; regenera 0,14/s fora). Apagou: `"pssht"`. **Vitória**: `"fogo apagado" / "a casa está a salvo"`; tempo: `"o fogo ainda não apagou"`.

**sinal** — 3 crianças atravessam, uma por rodada; carro chega da esquerda (`VMAX = 128/160/194`), botão `PARE` fecha o sinal: se a frente do carro já passou de `146 − v²/(2·420)` é `"tarde!"` (não freia); senão freia a 420 px/s² e para na faixa; a criança atravessa em 1,5 s (`"ufa!"`), sinal abre, carro sai, próxima rodada. Carro passa de `x=158` com `v > 20` → `"bi bii!"` e `"o carro não parou a tempo"`. **Vitória**: `"criançada a salvo" / "todo mundo atravessou"`.

**viatura** — 3 faixas, 7 fileiras de obstáculos (buraco/cone) a cada 215 px a partir de 420, sempre com 1 faixa livre que muda ≤ 1 por vez (55 % das fileiras fecham 2 faixas); velocidade 205 px/s; delegacia em `FIN = 420 + 6·215 + 330`. Deslizar ≥ 24 px troca de faixa (ou toque no lado). Colisão (`|dy| < 40`, `|dx| < 28`) → `"ops!"`, `"um buraco no caminho"`. **Vitória** ao chegar: `"chegou à delegacia" / "rua livre e viatura a salvo"`.

**praca** — 8 postes, noite escurece em 7,5 s (`opacidade = 0,84·t/T`, estrelas aparecem após 35 %). Toque em cada poste acende (+brilho). Todos acesos → `"praça iluminada" / "agora é seguro passear"`; tempo → `"escureceu antes de acender tudo"`.

---

## 7. frase-filtro.js, frases.js (Frases + Partidos) e frase-ui.js (+ aba Minha Casa)

### 7.1 Filtro `Frase.limpar(texto) → {ok, texto, motivo}` (mesmo código no servidor e no navegador)

Política: discurso livre (palavrão, gíria, crítica, política e nomes de políticos **passam**). Recusa só:

1. vazia → `"escreva algo"`; > **70** caracteres (por code point) → `"passou de 70 letras"`; TUDO MAIÚSCULO com > 20 letras vira minúsculo (não recusa).
2. **dados pessoais** (`"essa frase não pode: dados pessoais"`): `@` ou "arroba"; links (`http`, `www.`, `palavra.com|br|net|org|io|me|gg|ly|co|app|dev|xyz|club|tv|link|site|vercel|info|bio|ai|to|cc|ws`, "ponto com", `x/y`); ≥ 8 dígitos seguidos (ignorando `.-()+` e espaços entre grupos); 4 números por extenso seguidos; palavras de contato (whatsapp, zap, telegram, insta, tiktok, pix, discord, dm, gmail…); `"me segue/chama/add"`, `"segue meu/minha/la/no"`, `"chama (la) no"`.
3. **discurso de ódio**: insultos de grupo/símbolos (lista fechada), regex `grupo + (são|é|sempre|todos…) + depreciativo`, `grupo … morrer/exterminar`, `morte/fogo/bomba aos grupo`, "volta pra senzala/África", apologia a escravidão, white power/supremacia, "viva Hitler/nazismo", negação do holocausto.
4. **conteúdo proibido**: apologia a estupro/pedofilia; palavra sexual + menção a menor (menina, criança, novinha, "N anos" com 3 ≤ N ≤ 17…).
5. **ameaça**: "vou te matar/espancar/…", "te mato", "atirar em", "tiro na cara/no prefeito…", "morte a", "tem que morrer", "vai morrer", "morra", incentivo a suicídio ("se mata", "corte os pulsos"…). "matar a fome/saudade/tempo…" é removido antes.

Normalização para busca: minúsculas, NFKD sem acentos, homóglifos cirílicos/gregos → latinos, dígitos colados em letras (`0134 57` → `o i e a s t`), `k→c`, símbolos viram espaço; palavra inteira com letras repetidas colapsadas e plural sem `s`; curingas `*` (qualquer letra) e `x` (vogal); letras soltas (`v i a d o`) e palavras vizinhas juntadas (`vi ado`).

### 7.2 `window.Frases`

* `de(h)`: frase vigente = otimista do aparelho (`nem_frase = {h, t, ts}`, vale **3 h**, só para o @ que escreveu; some quando a oficial `D.FR[h]` fica igual) ou a oficial.
* `otimista(h, t)`: passa pelo filtro e grava `nem_frase`.
* `codigo(s)`: FNV-1a de `'mapa|' + s`, 6 chars do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; `meuCodigo()` = `codigo(votoSid())` → código do aparelho `MAPA-XXXXXX` para verificação pelo direct.
* **Link mágico**: `?eu=<@>&vp=<prova de 24 chars [A-Za-z0-9_-]>` → grava `nem_prova = {h, p, ts}`, `voto_eu`, `nem_eu`, `nem_verif_novo=1` e limpa a URL. `verificado(h)` = `D.VF` (lista de @ que já mandaram código) inclui h **ou** há prova local. `prova(h)` devolve a prova.

### 7.3 `window.Partidos` (cor da eleição = telhado da casa)

Cores: `azul #2f6fe0`, `vermelho #e0343a`, `amarelo #f5c400`; letras `a/v/y`. Oficial `D.PT` em dois formatos: `{handle: letra}` ou `{a:[gi…], v:[…], y:[…]}`. Otimista `nem_cor = {h, c, ts}` (3 h, só o próprio @, some quando a oficial iguala; memoizada e invalidada por `storage`). `aoMudar(fn)` notifica para refazer as casas. API: `cor(h)`, `hex(c)`, `letra(h)`, `otimista(h, c)`.

### 7.4 frase-ui.js — citações, editor e balões

* **Citação** `frCitacao(txt, h, cargoTxt)`: bloco amarelo com `q` e, nos cartões de cidade/estado, botão `"prefeito @h"`/`"governador @h"` com bolinha da cor (abre a casa). `frCartaoCid` (junto do prefeito) e `frCartaoEst` (governador) só se a pessoa tem cargo e frase.
* **Selo** `fr-selo`: bolinha + nome da cor ao lado do cargo no cartão da pessoa.
* **Cartão da própria pessoa** (`frCartaoPessoa(cart, h, gi, k)`, só se `voto_eu == h`):
  * bloco de verificação: verificado → `"verificado"` + `"só você publica a frase e a cor deste @. trocou de celular? mande também o código deste aparelho: MAPA-XXXXXX"`; não → `"verifique o seu @"`, `"mande este código no direct do @naoeummapa pela conta @h. você recebe na hora um link: toque nele e pronto."`, `code MAPA-XXXXXX`, botão `"copiar código e abrir o direct"` (copia, vira `"código copiado · cole no direct"`, abre `https://ig.me/m/naoeummapa`).
  * editor `"sua cor e sua frase"` (ou `"sua frase no mapa"` sem Partidos): contador `n/70` (classe `mx` em 70); `"a cor do telhado da sua casa e o seu partido na eleição"`; 3 chips `role=radio` (azul/vermelho/amarelo); input `maxlength 70` placeholder `"sua frase (até 70 letras)"` (`enterkeyhint=send`, Enter envia); `p.fr-msg aria-live=polite` com o motivo do filtro ou `"essa frase não pode"`; botão `"publicar"` habilitado só se (frase válida e mudou) ou (cor mudou). Frase vazia = só a cor.
  * envio: `POST /api/frase {u: h, t: frase ou '', s: votoSid(), c?: 'a'|'v'|'y', p?: prova}`; botão `"enviando"`; sucesso (`res.ok && j.ok`): `Frases.otimista`, `Partidos.otimista`, `refrescar()` (refaz telhados), toast `"publicada · já está na sua casa"` ou `"cor salva · seu telhado já mudou"`, mensagem `"entra no mapa em até 20 min"` (com cargo) / `"sua cor já está no seu telhado"`; erro: `j.erro` ou `"não consegui enviar, tenta de novo"`.
* **Balões no mapa (pop-ups rotativos)**: elementos `div.frb` (`role=button`) em `#camada`, no máx. 3 slots; só quando a câmera está parada > 500 ms e nenhum painel (`eleicao, ranking, lojas, como, missoes, minha-casa`) está aberto. A cada **2,5 s** (5 s com reduced motion) e com menos de 2 (celular) / 3 (desktop) ativos, `frSpawn` escolhe candidatos visíveis com frase: zoom de rua (`D < 70`) → qualquer casa com cargo; longe → presidente sobre **Brasília** (ibge 5300108), governador + 2 deputados + senadores sobre o rótulo do estado (`D ≥ 650`), prefeito + até 2 vereadores sobre o nome da cidade (`D < 2600`, máx. 24 cidades). Rodízio embaralhado sem repetir até passar por todos (`vistos`); de perto prioriza prefeito/vereador. Balão fica **6 s** (4,5 s quando é só o nome). Sem frase que caiba, a cada 6 s aparece um balão só com `"prefeito @x"`/`"gov. UF @x"`. Colisão: tenta acima do rótulo (3 deslocamentos × 4 alturas com "fio") e depois abaixo; reserva o retângulo em `livre/reservar`. Texto quebrado em até 2 linhas (11 px, `…`). `data-c` = cargo (P/G/S fundo escuro com texto amarelo; M/D amarelo claro), `data-p` = cor do partido (borda/faixa `--pc`). Toque abre a casa. Relógio de 700 ms força redesenho quando o mapa está parado.

### 7.5 Abas "Minha Casa" e "Eleições" (só com FRASES)

Barra inferior passa a: **Minha Casa · Eleições · Minha cidade · Ranking · Lojas** (`#abrirCasa`, `#abrirEleicoes` deixam de ser `hidden`; `#abrirEleicao` "Votar" some). Cliques tratados em captura; 2º toque na aba ligada volta ao mapa; `window.__tabAtiva` devolve `'casa'|'eleicoes'|''`.

`section#minha-casa` (`h1 "Minha Casa"`, × `"voltar pro mapa"`): sem @ → `Eleicao.passoEu`; com @ → cartão com avatar (inicial sobre a cor do partido ou amarelo), `@h`, `"{cidade} · UF"`, chips `"nível N"`, `"{pts} ponto(s) na semana"`, cargo (chip escuro), link `"trocar @"`; editor de frase/cor (`frCartaoPessoa`); sem cargo: `"quem chega a prefeito, vereador, deputado, governador, senador ou presidente também escreve uma frase aqui."`; botões `"ver minha casa no mapa"` e `miBotaoCidade`. Vindo do link mágico (`nem_verif_novo`): espera `__site.pronto`, toast `"verificado ✓ você entrou como @h"` e abre Minha Casa.

---

## 8. painel-eleicao.js — apuração ao vivo (`section#painel-eleicao.pe`, aria-label `"painel da eleição: apuração ao vivo"`)

Só com `FRASES` e `PD`. Visual de transmissão (fundo azul-escuro, Nunito 900). Montado **uma vez**; só o relógio anda (1 s, enquanto aberto). Abre por `PainelEleicao.abrir({faixa})`, `#painel`; fecha por ×, `Esc` (captura em `window`), toque em qualquer `.tab`.

### 8.1 Topo fixo
`AO VIVO` (ponto pulsante), `h2 "apuração"`, ×; linha `"semana {mandato} · fecha dom 21h"` + `"faltam {dhms}"`/`"apuração fechada"`; barra de progresso da semana com 6 marcas de dia e `"{pct}% apurado"` (`pct = (now − ini)/(fim − ini)`).

### 8.2 Corpo (`max-width 620`, 2 colunas ≥ 900 px)
0. Faixa opcional `role=status` (ex.: `"seu próximo voto libera em N min"`).
1. **Números** (3 tiles, contagem animada 1,1 s): `votos`, `eleitores`, `na última hora` (de `eleicao.json`); **ticker** `role=marquee` aria-label `"últimos votos"` com rótulo `"última hora"` e os 18 últimos: `@alvo` + `cargo` + `UF` + `há N min`, duplicado para rolar (`duração = max(30, n×4,2) s`); vazio: `"a apuração continua · vote para aparecer aqui"`.
2. **Herói — presidente**: tag `"presidente do brasil"`, botão `casa + @h` (aria `"ver @h no mapa"`), `"{cidade} · UF"`, pontos grandes (contagem 1,3 s) + `"pontos"`, `"à frente por {dif} pts"` (classe `apertado` se `g ≥ 300 e (dif < 5% ou dif < 30)`), barra "vs" com o vice (1º senador; fallback 2º do Brasil) em proporção de pontos, frase entre aspas ou, se você é o presidente sem frase, botão `"você ainda não escreveu sua frase"` (abre Minha Casa). Vaga: `"vaga aberta · comente e pontue"`.
3. **Placar dos partidos**: conta governadores, prefeitos e senadores por cor; ordena por total (empate: governadores, depois senadores); linha por cor com bolinha, nome, `"na frente"`, número grande, barra proporcional, `"{n} governador(es) · {n} prefeito(s) · {n} senador(es)"`, botão `"ver as frases do {cor}"`/`"fechar frases"` (`role=button`, `aria-expanded`); linha tracejada `"{n} gov · {n} pref · {n} sen · sem partido"`; vazio: `"ninguém escolheu a cor do partido ainda"`. Abrir uma cor mostra `"frases do {cor}"` / `"o que os políticos do {cor} escreveram"` agrupadas por cargo (`presidente, senadores, governadores, deputados, prefeitos, vereadores · N`, 12 por vez, `"ver mais · faltam N"`); vazio `"ninguém do {cor} escreveu ainda"`.
4. **Estados**: mapa SVG do Brasil (`numeros.json`), cada UF pintada pela cor que **predomina entre os moradores** que escolheram cor (`mistura(neutro, cor, 0,3 + 0,7·(share − 1/3)/(2/3))`; empate/ninguém = `#3a4766`); siglas pequenas (`DF SE AL PB RN ES RJ PE`) fora do estado com fio; `aria-label "{estado}: predomina {cor}, {pct}% de quem escolheu cor"`; legenda `azul · vermelho · amarelo · empate ou sem cor · mais forte = mais dominante`; `"toque num estado para abrir o hub dele"`.
   **Hub do estado**: chip UF, nome, `"predomina o {cor} · {pct}% de quem escolheu"`, `"fechar estado"`; barras `"cores do estado"` → `moradores` (azul/vermelho/amarelo/sem cor com %) e `políticos` (`"governador, deputados, senadores e prefeitos"`); `"governador"` com vice (linha tracejada) e `"à frente por N pts"` (+ `apertado`), ou `"vaga aberta · quem pontuar mais assume"`; `"deputados · N"` (lista rolável) ou `"ainda sem deputados"`; `"prefeituras · N"` com busca (`"buscar cidade"`, se > 12) e cards `cidade · @prefeito|"sem prefeito" · moradores · "nível N"` (nível = `min(5, 1 + obrasProntas/5)`), 20 por vez `"ver mais · faltam N"`, `"nenhuma cidade com esse nome"`.
5. **Senado**: hemiciclo SVG de **49 cadeiras** em 5 arcos (`6, 8, 10, 12, 13` cadeiras; raios `80..180`), ordenadas por partido (azul, amarelo, vermelho, sem) e pontos; cadeira vazia tracejada; número de senadores e `SENADORES` no centro; toque na cadeira mais próxima (raio 22) mostra detalhe: UF, `@h`, cor ou `"sem partido"`, `"vice-presidente"` para o 1º, `"{pts} pontos · {pos}º no senado · {cidade}"`, frase; vaga: `"cadeira vaga"` / `"quem pontuar mais entre os não eleitos assume"`.
6. **Prefeituras mais disputadas**: entre as 120 maiores cidades com prefeito e vice, ordena por `pontosPara(vice, prefeito)` (o que falta para virar) e tamanho; 10 linhas: posição, cidade + UF, `@prefeito`, frase, `"{falta}"` + `"pts p/ virar"` (classe `zero` se ≤ 1); vazio `"ainda sem disputa nas grandes cidades"`.
7. Rodapé `"pontos e votos da semana atual · atualiza a cada poucos minutos"`.

### 8.3 Botão de entrada (`PainelEleicao.botao()`, no topo do Ranking)
Gradiente azul, ícone de barras, `"painel da eleição"` / `"presidente, governadores e senado"`, selo `AO VIVO`; aria-label `"abrir o painel da eleição, apuração ao vivo"`.

---

## 9. lojas-hub.js — aba Lojas (`#lojas`)

Só existe com loja patrocinada **vigente hoje** (`l.desde ≤ hojeBRT() ≤ l.ate`); sem loja o botão `#abrirLojas` fica oculto e `?aba=lojas` não abre. Depende de `LJ` (lojas), `LJC` (`{s: pontos por seguir, p: pontos por marcar}`), `cartaoLoja`, `segFeito/segLer/SEG_MEM` (`nem_seg[@|loja]`), `euLoja()`.

* **Hero**: `h2 "Visite as lojas e ganhe pontos"`; `"seguir a loja pelo botão do cartão = +{LJC.s} pts (1 vez por loja[, até 15 lojas por dia]). marcar o @ dela num comentário do @naoeummapa = +{LJC.p} pts (1 vez por loja)."`; contador `"você já ganhou {feitas} de {total} loja(s)"` com barra, e `"+{pts} pts a caminho · entram na próxima atualização do mapa"` ou `"cada loja que você segue vale +{LJC.s} pts"`.
* **Filtros**: chips `aria-pressed` `"perto de mim"` | `"todas"` (padrão: `perto` se há casa conhecida); "perto" sem @ pede: input `"seu @ pra ver as lojas do seu estado"` + `"ok"`; erro `"não achei @h no mapa. comenta o nome da sua cidade no @naoeummapa pra entrar."` / `"digita o seu @ do Instagram."`. Busca `type=search` `"buscar loja ou cidade"` (nome, cidade, UF, tipo, @).
* **Ordem justa**: `[não seguida/não dona/com Instagram] → [mesma UF do jogador] → sorteio estável do dia (hash('lh'+dia+'|'+id)) → id`; em "perto de mim" a UF vem antes de tudo. Seções `"em {UF} · perto de você"` / `"no resto do Brasil"` / `"nenhuma loja em {UF} ainda · veja as do Brasil"`.
* **Card**: bolinha na cor, nome, `"{tipo} · {cidade}-{UF}"`, descrição (se diferente do tipo), status `"sua loja"` | `"chame no WhatsApp"` (sem IG) | `"seguindo ✓"` | `"+{LJC.s} disponível"`, `"até {data}"`, botão `"visitar"` (aria `"visitar {nome} no mapa"`) → fecha o painel, espera o mapa (até 150×200 ms) e `cartaoLoja(l)`.
* 40 por página: `"mostrar mais (N)"`; vazios: `"nenhuma loja com essa busca. tenta outro nome ou cidade."` / `"nenhuma loja no mapa agora."`; rodapé `"lojas patrocinadas vigentes hoje · ordem: as que você ainda não seguiu primeiro, depois as do seu estado, depois um sorteio que muda todo dia"`.
* Selo `+pts` no botão do rodapé some quando todas foram seguidas. `?loja=<id>` abre direto o cartão (`"essa loja não está mais no mapa"` se expirou). `#lojas`, `Esc`.

---

## 10. mapa2d.js — modo leve

Ativado para `deviceMemory ≤ 2`, WebGL que falha ou `?leve=1`. SVG com as UFs de `numeros.json` (fill da cor do estado a 55 %, traço 1,6 sem escala), fundo `#acdaf2`, cidades como pontos em 5 baldes por nº de casas (`[1,3) 4,2px · [3,8) 5,4 · [8,30) 7,4 · [30,150) 10 · 150+ 13 (amarelo)`), 2 camadas (contorno + miolo), aparecem conforme o zoom (`b0 ≥ 4×`, `b1 ≥ 2,5×`, `b2 ≥ 1,5×`); rótulos: siglas sempre, nomes das 40 maiores (`8 primeiras a partir de 2,2×`, demais 4×, somem acima de 6× para os estados). Gestos: arrastar, pinça, roda (`exp(−Δ·0,002)`, `0,012` com Ctrl), duplo toque (2,2×), botões ±; zoom mín. = extensão total, máx. 40×; limite de pan 20 % fora. Toque: cidade mais próxima visível (raio do ponto/2 + 10 px) → `cartaoCidade`; senão UF → `cartaoEstado(uf, {voar:true})`; senão fecha o cartão. `irLeve(x, y, largura)` anima o viewBox em 650 ms (smoothstep); `marcar2d(c)` anel amarelo na cidade selecionada. `role=img` aria-label `"Mapa 2D do Brasil com as cidades que já têm casa"`.

---

## 11. negocio.js — "coloque seu negócio no mapa"

### 11.1 Configuração (`window.NEG_CFG`)

| Campo | Uso |
|---|---|
| `ativo` | `false` = esconder o botão |
| `precos[]` | `{valor, rotulo, plano?, ate_pop}` em ordem crescente de população; `ate_pop == null` = última faixa |
| `duracao_dias` | padrão 10 |
| `prazo_texto` | texto sob o relógio |
| `pacote[]` | o que ganha (`{pts_marcar}`, `{cidade}` substituídos) |
| `pts_marcar` | `{antes, depois, virada_ts}` (padrão 30) |
| `tipos[]`, `tipos_destaque[]`, `cor_por_tipo{}` | tipos de negócio (`"Outro"` sempre por último) |
| `proibidos[]` | lista lida no checkbox de ciência |
| `whatsapp`, `whatsapp_texto` | número com DDI e modelo `{codigo} {nome} {cidade} {valor}` |
| `pix.codigos` | `{"<valor>": "<Pix copia e cola>"}` por faixa |
| `prova` | `{loja, h, onde, titulo, frase:{texto, loja, h}, notifs:[[n, quando]…]}` prova social |
| `joao` | cartão de confiança do criador `{nome, papel, foto, linkedin}` |

`municipios-pop.json` = `[[ibge, nome, uf, pop] × 5571]`, carregado só ao abrir (ou `Negocio.abrir({municipios: url})`).

### 11.2 Telemetria (`POST /api/neg-ev`, `sendBeacon` com fallback `fetch keepalive`)

Payload `{e, s: neg_sid, c?: código NEG, campo?, v?: 'a'|'b'}`; **uma vez por evento+código+campo por página**. Eventos: `abriu`, `preco` (entrou no passo 2), `trava` (validação falhou; `campo` = `nome|insta|tipo|tipo_outro|cidade|whatsapp|ciente`), `copiou` (código Pix), `zap` (tocou em "já paguei"). `neg_sid` = id aleatório do aparelho (`[a-z0-9]{8,16}`). Variante A/B = `hash31(sid) % 2 ? 'b' : 'a'` (estável por aparelho).

### 11.3 Folha (`section#negocio`, `role=dialog`, aria-label `"Coloque seu negócio no mapa"`)

Topo: `h1 "seu negócio no mapa"` (destaque em "mapa"), × `"voltar pro mapa"`, 3 pontos de passo (`ok|on`). `Esc` fecha. Rascunho em `neg_rascunho_v1` (saneado ao ler: strings ≤ 80, `cor` hex válido, `ibge` inteiro, `ciente` booleano). `abrir({cidade?, insta?, api?, apiEv?, municipios?, onFechar?})`.

### 11.4 Passo 1 — dados

* Prévia presa abaixo do topo: título dinâmico `"Assim o seu negócio aparece no mapa"` → `"Seja o 1º negócio de {cidade} no mapa"` ou `"Coloque seu negócio no mapa de {cidade} ({n} negócio(s) já está/estão lá)"`; selo mini com prédio na cor, nome (`"seu negócio"`), linha `"@insta · tipo · cidade · UF"` (`"assim ele aparece no mapa"`), etiqueta `"patrocinado"`.
* `"Seu negócio vira um prédio com selo patrocinado na cidade que você escolher. Leva 1 minuto."`; `"a partir de R$ {mínimo} · pagamento único no Pix · {dias} dias no mapa"`.
* Campos (ordem na tela: cidade, nome, @, tipo, cor, WhatsApp, ciência):
  * **cidade** (`role=combobox`, `aria-autocomplete=list`, placeholder `"digite a cidade ou a UF"`, dica `"a cidade onde o selo aparece. O preço depende do tamanho dela."`): busca com ≥ 2 letras, prefixo primeiro, depois contém, ordenado por população, 6 sugestões (`"Nome UF"`); ao escolher: status `"{cidade} · {n} morador(es) no mapa|cidade no mapa · {n} negócio(s)|nenhum negócio ainda · {plano} R$ {valor}"`; erro de carga: `"não consegui carregar a lista de cidades. Confere a internet e "` + `"tenta de novo"`.
  * **nome do negócio** (`maxlength 60`, `"ex.: Padaria do Zé"`).
  * **@ do Instagram do negócio** (`maxlength 40`, `"seunegocio"`; `normInsta` remove URL/@, só `[a-z0-9._]`, 30 chars).
  * **tipo de negócio** (`role=radiogroup`): chips dos `tipos_destaque` (8) + `"+ mais tipos"` + `"Outro"`; `Outro` abre `"qual é o seu tipo de negócio?"` (`maxlength 30`, `"ex.: hotel, doceria, gráfica"`); escolher um tipo sugere `cor_por_tipo` se a cor não foi manual.
  * **cor da sua marca** (`role=radiogroup`): 8 cores `#E63946 #F4A261 #FFD23F #2A9D8F #3A86FF #8338EC #FF5D8F #1E2430` + `"+"` com `input[type=color]` (`"outra cor"`); dica `"não achou a sua? toca no + e escolhe qualquer cor."`.
  * **WhatsApp do negócio** (`type=tel`, `maxlength 20`, `"(11) 91234-5678"`, dica `"com DDD. É o número do botão "chamar no WhatsApp" da sua loja no mapa."`); com 10–11 dígitos mostra `"o botão da sua loja vai chamar: (DD) NNNN-NNNN · confere se está certo"`.
  * **ciência**: checkbox `"Meu negócio não é {proibidos separados por vírgula} nem coisa parecida. Sei que a gente pode recusar e devolver o valor."`
* Botão `"ver o preço"` → `"ver o preço em {cidade}"`. Validação na ordem (mensagem em `p[role=alert]`, foca o campo):
  1. nome < 2 → `"Falta o nome do negócio."`
  2. @ < 2 → `"Falta o @ do Instagram do negócio."`
  3. sem tipo → `"Escolhe o tipo de negócio."`
  4. outro < 2 → `"Escreve qual é o tipo do seu negócio."`
  5. cidade não escolhida: tenta auto-escolher (1 resultado só ou nome exato); senão `"Escolhe a cidade na lista que aparece quando você digita."`
  6. WhatsApp fora de `^\d{10,13}$` → `"O WhatsApp parece incompleto: DDD + número."` ou `"Falta o WhatsApp do negócio (com DDD)."`
  7. sem ciência → `"Marca a caixinha dizendo que o negócio não é de nenhum dos tipos proibidos."`

### 11.5 Passo 2 — preço

* Selo completo (nome, `"@insta · tipo"`, `"cidade · UF"`, `patrocinado`); `"{n} negócios já estão no mapa agora"` (se ≥ 5 vigentes); cartão de prova social curto.
* Preço: `faixa(pop)` = 1ª faixa com `pop ≤ ate_pop`; `plano`, `R$ valor`, `"uma vez só · {dias} dias no mapa"`, âncora `"menos de R$ {ceil(valor/dias)} por dia, durante {dias} dias"`, `"o preço é pelo tamanho da cidade, não da loja"`.
* Tabela `role=list` aria-label `"preço por tamanho da cidade"`: cada faixa `plano + rotulo (+ " (a sua)")` e valor.
* `"o que você ganha"` + `pacote[]`.
* **Relógio da turma das 21h**: antes das 21h (Brasília) `"Faltam {H}h{MM} para entrar na turma de hoje: no ar até 10h de amanhã"`; depois `"Passou das 21h: fechando agora, você entra no ar até 10h de {amanhã|dia-da-semana (DD/MM)}"` (atualiza a cada 30 s) + `prazo_texto`.
* Garantia: `"Garantia: se o seu negócio não puder entrar, a gente devolve o valor."` / `"Pagamento único, sem mensalidade e sem cadastro."`; cartão de confiança do criador (`nome`, `papel`, `"ver meu LinkedIn ↗"`).
* Botões: `"voltar e editar"` e `"garantir o lugar da {nome} · R$ {valor} no Pix"` → gera `NEG-XXXXXX` (6 chars de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, `crypto.getRandomValues`) e vai ao passo 3.

### 11.6 Passo 3 — pagamento

1. `"seu código"` + `NEG-XXXXXX`.
2. `"registrando seu pedido…"` → `POST /api/negocio {codigo, nome, insta, tipo, tipo_outro, ibge, cidade, uf, cor, whatsapp (só dígitos), valor, pix:true, ciente:true}`; sucesso = `r.ok && j.ok` → grava `neg_rascunho_v1_enviado = {codigo, ts}`; erro: `"Não consegui registrar o pedido agora. Seus dados continuam aqui. Tenta de novo."` + `"tentar de novo"` + `"voltar"`. (O servidor **não** recalcula o preço; apenas registra o pedido no log.)
3. Tela de pagamento: cabeçalho vira `"Lugar da {nome} reservado em {cidade} até 21h"` / `"Pagando até 21h, entra no ar até 10h de amanhã."` (ou `"Pedido da {nome} registrado em {cidade}"` / `"Entra no ar até 10h de {dia}."`), código fica menor; `plano`; `R$ valor`; `"o Pix vai para"` + titular extraído do próprio código EMV (campo `59`) + `"é o {criador}. É esse o nome que aparece no seu banco: pode pagar tranquilo."` + cartão de confiança; **variante A**: card de impacto antes do botão (`"{N} mil pessoas já têm casa no mapa. Sua loja aparece para quem mora em {cidade} e para quem passa por lá."` + prova social completa com até 3 notificações); botão `"copiar código Pix"` (`"copiado!"` 1,8 s; fallback `execCommand`/`"segura e copia o código"`), código fechado em 2 linhas (`tabindex 0`, aria-label `"código Pix copia e cola"`, toque seleciona; `copy` também dispara `copiou`), `"ver o código inteiro"`; passos: `1 cola no app do banco — Pix → copia e cola. Confere se o valor é R$ X.` · `2 tira o print do comprovante — é ele que confirma o seu lugar` · `3 toca no verde e manda o print — a mensagem já vai com o nome da loja e o código`; sem código Pix: `"Chama no WhatsApp que a gente te passa o Pix."`; botão verde `"já paguei: mandar o print no WhatsApp"` → `wa.me/{whatsapp}?text={whatsapp_texto preenchido}` (grava `neg_rascunho_v1_zap = código`); linha do tempo `hoje, até 21h|agora → você paga e manda o print` · `até 10h de amanhã|{dia} → seu negócio no mapa e no Instagram do @naoeummapa` · `{dias} dias → no ar em {cidade}, com a galera marcando o seu @`; `"Regra: fechou até 21h, entra no ar até 10h do dia seguinte. Fechou depois das 21h? Conta como o dia seguinte."`; **variante B**: card de impacto aqui; garantia; `"voltar pro mapa"`.
   * Existe `pixPedido(base, codigo)` (reescreve o EMV com `PEDIDO NEG-XXXXXX` no campo 26.02 e `NEGXXXXXX` no 62.05, recalculando CRC-16/CCITT) mas está **desligado**: usa-se o código estático da config por faixa.

### 11.7 Lembrete do comprovante

Ao abrir a folha, se há pedido enviado neste aparelho nos últimos **3 dias** sem toque em "já paguei" (e não listado em `neg_ficha_enviada`): `div[role=note]` `"Já pagou o pedido NEG-XXXXXX? Manda o comprovante no WhatsApp com esse código."` + botão `"mandar comprovante do NEG-XXXXXX"` (mensagem `"Oi! Loja: {nome} · pedido {código}. Já paguei o Pix no @naoeummapa. Segue o comprovante:"`).

### 11.8 Regra das 21h (`turma()`)

```
br = now − 3h (UTC); cedo = hora(br) < 21
corte = hoje 21h BRT (+1 dia se !cedo)
post = dia seguinte ao corte; nome = "amanhã" se é +1 dia, senão "{dia da semana} (DD/MM)"
falta = corte − now → "Hh MM"
```

---

## Anexo A — Endpoints (todos `POST`, JSON, resposta `{ok: true}` ou `{ok:false, erro}`)

| Endpoint | Payload | Quando | Erros exibidos |
|---|---|---|---|
| `/api/voto` | `{u: eleitor, a: alvo, s: sid, c: cargo}` | cada voto (painel Votar, pop-up, cartão da casa) | `j.erro` ou `"não consegui registrar, tenta de novo"` |
| `/api/missao` | `{u, m: área, e: 'ini'|'fim', j: idVariação, s}` | abrir/vencer missão | silencioso (retry 3×) |
| `/api/frase` | `{u, t: frase ou '', s, c?: 'a'|'v'|'y', p?: prova}` | publicar frase/cor | `j.erro` ou `"não consegui enviar, tenta de novo"` |
| `/api/negocio` | `{codigo, nome, insta, tipo, tipo_outro, ibge, cidade, uf, cor, whatsapp, valor, pix, ciente}` | passo 3 | `"Não consegui registrar o pedido agora…"` |
| `/api/neg-ev` | `{e, s, c?, campo?, v?}` | funil do negócio | nenhum |
| `/api/visita` | `{d, n, eu, p?}` | carga da página | nenhum |
| `GET eleicao.json`, `missoes.json`, `ofensiva.json`, `numeros.json`, `municipios-pop.json`, `missoes-jogos.js` | — | estáticos com cache-bust `?t=` (1 min / 5 min) | fallbacks vazios |

## Anexo B — localStorage

| Chave | Conteúdo |
|---|---|
| `nem_eu` | @ do ranking |
| `voto_eu` | @ que vota/joga/escreve |
| `voto_sid` | id anônimo do aparelho |
| `voto_ultimo` | `{cargo: {ts, a}}` |
| `nem_of` | `{h, m, C, hora}` ofensiva otimista |
| `nem_ofx` | hora em que o cartão do fogo foi fechado |
| `nem_mis2` | `{h, l:[ms×4]}` trava de 12 h otimista |
| `nem_mis_ult` | `{área: idVariação}` |
| `nem_mis_pend` | `[{h, i, a, t}]` pontos otimistas de missão |
| `nem_frase` | `{h, t, ts}` frase otimista (3 h) |
| `nem_cor` | `{h, c, ts}` cor otimista (3 h) |
| `nem_prova` | `{h, p, ts}` prova do link mágico |
| `nem_verif_novo` | `1` até comemorar a verificação |
| `nem_viu_como` | viu "como funciona" |
| `nem_vid` | id de visita |
| `nem_ult` | ts da última visita |
| `nem_reativa1` | viu o cartão "voltou" |
| `nem_s1pos` | `{h, p, t}` posição na cidade na última visita |
| `nem_app_dica` | mostrou a dica de app |
| `nem_seg` | `{"@|loja": …}` lojas seguidas |
| `neg_rascunho_v1`, `_enviado`, `_zap`, `neg_sid`, `neg_ficha_enviada` | funil do negócio |

## Anexo C — Timers e polling

| Onde | Intervalo |
|---|---|
| Relógio do "como funciona" / painel da eleição | 1 s |
| Contagem da trava de missões | 1 s |
| Rótulos do painel Votar / pop-up / cartão do fogo | 30 s |
| `ofensiva.json` | 10 min (cache-bust 5 min) |
| `eleicao.json` painel Votar | a cada abertura (bust 1 min); compartilhado 5 min |
| `missoes.json` | 1× por sessão (bust 5 min) |
| Rodízio de balões | 2,5 s (5 s reduced motion), dura 6 s / 4,5 s; relógio 700 ms |
| Relógio da turma das 21h | 30 s |
| Dica de app após 1º voto | 3,8 s |
| Pop-up Eleições → hub após votar tudo | 1,1 s |

## Anexo D — Acessibilidade (resumo)

* Abas/segmentos: `role=tablist` + `role=tab` (+ `aria-selected` no placar); chips de opção: `role=radiogroup`/`radio` + `aria-checked`; filtros do hub de lojas `aria-pressed`.
* Diálogos: `role=dialog` + `aria-label` (pop-up de voto, dica de app, folha do negócio); celebração e status `role=status`/`aria-live=polite`; ticker `role=marquee`; mensagens de erro do formulário `role=alert`; lembrete `role=note`.
* Todo botão só com ícone tem `aria-label` (`fechar`, `voltar pro mapa`, `votar em mim, …`, `girar cano N`, `poste N`, `sala de {sintoma}`, `fechar o sinal`, `acender o poste`, `bater no ritmo`, `visitar {loja} no mapa`, `compartilhar o top 10 em imagem`…).
* Linhas do ranking e do painel têm `aria-label` descritivo com posição, @, pontos e cargo; mapa 2D `role=img`; mapa do painel `role=group` com UFs `role=button tabindex=0` operáveis por Enter/Espaço.
* `Escape` fecha todas as folhas; `prefers-reduced-motion` desliga animações/transições (celebrações, confetes, barras, balões).

## Anexo E — Textos pt-BR (lista consolidada)

**Ranking**: Cidade · Estado · Brasil · outra cidade · outro estado · ver no mapa · ver o cartão da cidade · ver o cartão do estado · Presidente do Brasil · Governador de {UF} · Prefeito de {cidade} · vaga aberta · pontos · comente e pontue · fecha em {t} · domingo 21h · {n} moradores · {n} pontos na semana · {n} votos de {n} eleitores nesta semana · {n} votos para moradores daqui nesta semana · ainda sem votos aqui nesta semana · {n} pessoas em alta agora (postou story marcando @naoeummapa) · você · {n} pessoas no meio · mostrar mais · mostrar mais 100 (faltam {n}) · mostrando os {n} primeiros de {n} · mais {n} abaixo · ninguém por aqui ainda · você · @h · não sou eu · em {cidade} · em {UF} · no Brasil · digita seu @ pra ver sua posição · @ do Instagram · ver · não achei @{h} no mapa · digita seu @ · cidade ou @ (ex.: Chapecó) · estado, cidade ou @ · digita o nome de uma cidade · digita o nome de um estado · não achei: tenta outro nome · compartilhar top 10 · gerando… · gerando a imagem… · posta nos stories e marca @naoeummapa: +30 pontos · marca @naoeummapa · no story: +30 pontos e "em alta" por 24 h · {nível} · nível N de 50 · ponto(s) na semana · ponto(s) na temporada · Ranking.

**Como funciona**: ver §1.11 (todos os textos estão listados lá).

**Votar / Eleições**: Votar · voltar pro mapa · a eleição da temporada 2 começa hoje às 21h. · Qual é o seu @? · só quem tem casa no mapa vota. · seu @ do Instagram · Continuar · não achei esse @ no mapa. comente a sua cidade num post do @naoeummapa para ganhar casa. · trocar · Em quem você vota? · um voto por cargo a cada hora. o líder já vem marcado, toque no nome para trocar. · Sua cidade · Seu estado · Brasil · Vereador · Prefeito · Deputado · Governador · Senador · Presidente · 20 vagas · bancada do estado · 49 vagas · 1 vaga · (você) · {n} pts na semana · trocar · vaga aberta · 1º · 2º · você · abre às 21h · libera em {n} min · pronto · a votação abre às 21h · Votar em {n} cargo(s) · +{v} pontos cada · Próximo voto em {n} min · volte aqui quando liberar: cada hora vale pontos. · sem votos disponíveis · registrando {k} de {n} · 1 voto registrado · {n} votos registrados · Não deu para votar · +{v} pontos para cada pessoa que você escolheu. eles entram em até 20 min. · tente de novo daqui a pouco. · próximo voto · às {HH:MM} · em {n} min · Ver o placar · Voltar · Placar da semana · carregando… · ainda sem votos para {cargo} nesta semana. seja o primeiro. · {n} voto(s) · {n} votos de {n} eleitores · atualizado há {n} min/h · agora · atualiza a cada 20 min · enquanto o próximo voto não libera · ver o ranking de pontos · Seu voto desta hora · fechar · +{v} pontos por voto · Votar · em mim · votado · às 21h · em {n} min · Ver a apuração · ver todos os cargos · seu próximo voto libera em {n} min · voto registrado · valeu +{v} · seu próximo voto de {cargo} libera às {HH:MM} · os pontos entram em até 20 min · não consegui registrar, tenta de novo.

**1ª tela**: voltou, @h! o que mudou: · 50 níveis (o seu nível ficou) · vote a cada hora · eleição ao vivo · hoje amigo = +100 · ver minha casa · conta o que você quer no jogo (comenta no nosso último post) · desde a última visita: +{n} posição(ões) na cidade ({p}º) · desde a última visita: caiu {n} na cidade ({p}º) · vote pra subir · desde a última visita: {p}º na cidade · seu voto vale +{n} › · voltou? veja o que mudou › · vira app · o mapa na sua tela inicial, em tela cheia, a 1 toque de votar · instalar · você já está no app · (instruções iOS/Android/Instagram em §3.6).

**Ofensiva**: sua ofensiva de voto · seu voto vale +{n} · cada voto que você dá sobe 1 · cada voto sobe 1 · pode votar agora · a votação abre às 21h · próximo voto em {n} min · zera domingo 21h · faltam {t} · votar agora · seu voto valeu +{n} · +{n} → próximo vale +{m} a partir das {HH:MM} · sobe de novo às {HH:MM} · aí vale +{m}.

**Missões**: missões · missões da cidade · Ajude {cidade} · Missões · Uma missão por área, de novo a cada 12 horas. +5 pontos para você e +10 para {cidade} em cada uma. · Qual é o seu @? · não achei esse @ no mapa. só quem tem casa joga. · só moradores ajudam a própria cidade. você mora em {cidade}. · Ajudar {cidade} · Água · Infraestrutura · Saúde · Segurança · Missão de {área} · (frases das variações, §6.1) · {n} missão(ões) feita(s) em {cidade} nesta semana · progresso da cidade aparece aqui · {n} sua(s) a confirmar · Jogar · libera em {t} · Só para moradores · Entre com o seu @ · {n} morador(es) ajudou/ajudaram {cidade} nesta semana · carregando… · abrindo… · não consegui abrir o jogo. tenta de novo. · {Área}: feita · +5 para você · +10 para {cidade} · faltam {n} pontos de {área} pra {obra} · já somados aqui; a ponte confirma em até 20 min. {Área} libera de novo em 12 h. · Próxima missão · Fechar · Ajude {cidade} (4 missões) · Missões de {cidade} · {n} moradores ajudaram esta semana · Ajude {cidade} ({n} missões livres) · {cidade}: 4 de 4 feitas, libera em breve · ministérios da semana · quem mais concluiu cada missão nesta semana vira ministro. uma pasta por pessoa. zera domingo 21h. · ministro da água/infraestrutura/saúde/justiça · {n} missão(ões) · vaga aberta: jogue as missões da sua cidade · os 5 que mais ajudaram.

**Minigames (HUD/telas)**: olhe · sua vez · quase · boa · luz de volta · a cidade acendeu · água chegou · o bairro agradece · plantão cheio · vamos de novo · todos atendidos · plantão salvo · a caixa secou · tape mais rápido · vazamentos tapados · a caixa segurou · subindo · baixo · no ponto · alto · cheia · alvo · nível no ponto · represa estável · {n} de {N} · grade · carvão · cloro · +1 · água suja demais · filtro certo para cada sujeira · água tratada · pronta para a torneira · cisterna cheia · chuva aproveitada · cidade ligada · a rede está de pé · toque · perfeito · errou · a torre caiu · torre de pé · obra entregue · muita batida · trânsito livre · ninguém bateu · rua nova · sem nenhum buraco · HOSPITAL · bateu · chegou · trânsito pesado · chegou a tempo · paciente a salvo · BPM · instável · quase · estável · toque quando o pico cruzar o círculo · batimento estável · fora do tempo · bom · cedo · tarde · falhou · coração em ritmo · VACINA · já está em dia · escapou · fila bagunçada · fila vacinada · todo mundo em dia · mãos limpas · nenhum germe sobrou · quase! · de novo · segure e solte no gato · miau! · curta! · passou! · gato salvo · o bombeiro agradece · faltou escada · a escada passou do gato · o galho estalou, tente de novo · pssht · fogo apagado · a casa está a salvo · o fogo ainda não apagou · PARE · tarde! · ufa! · bi bii! · criançada a salvo · todo mundo atravessou · o carro não parou a tempo · deslize para os lados · ops! · um buraco no caminho · DELEGACIA · chegou à delegacia · rua livre e viatura a salvo · toque em cada poste · praça iluminada · agora é seguro passear · escureceu antes de acender tudo · {n} s.

**Frases / Minha Casa**: escreva algo · passou de 70 letras · essa frase não pode: discurso de ódio | ameaça | dados pessoais | conteúdo proibido · essa frase não pode · prefeito @h · governador @h · azul · vermelho · amarelo · verificado · só você publica a frase e a cor deste @. trocou de celular? mande também o código deste aparelho: MAPA-XXXXXX · verifique o seu @ · mande este código no direct do @naoeummapa pela conta @h. você recebe na hora um link: toque nele e pronto. · copiar código e abrir o direct · código copiado · cole no direct · sua cor e sua frase · sua cor na eleição · sua frase no mapa · a cor do telhado da sua casa e o seu partido na eleição · sua frase (até 70 letras) · publicar · salvar minha cor · enviando · entra no mapa em até 20 min · sua cor já está no seu telhado · publicada · já está na sua casa · cor salva · seu telhado já mudou · não consegui enviar, tenta de novo · presidente · senador · gov. {UF} · deputado · prefeito · vereador · Minha Casa · trocar @ · nível {n} · {n} ponto(s) na semana · quem chega a prefeito, vereador, deputado, governador, senador ou presidente também escreve uma frase aqui. · ver minha casa no mapa · escreva o seu @ na busca do mapa para achar a sua casa · verificado ✓ você entrou como @h.

**Painel da eleição**: AO VIVO · apuração · fechar o painel da eleição · fecha dom 21h · semana {n} · fecha dom 21h · faltam {t} · apuração fechada · {n}% apurado · votos · eleitores · na última hora · última hora · a apuração continua · vote para aparecer aqui · presidente do brasil · vaga aberta · comente e pontue · pontos · à frente por {n} pts · você ainda não escreveu sua frase · placar dos partidos · na frente · governador(es) · prefeito(s) · senador(es) · ver as frases do {cor} · fechar frases · sem partido · ninguém escolheu a cor do partido ainda · frases do {cor} · o que os políticos do {cor} escreveram · presidente · senadores · governadores · deputados · prefeitos · vereadores · ver mais · faltam {n} · ninguém do {cor} escreveu ainda · estados · carregando o mapa · não consegui carregar o mapa agora · feche e abra de novo · empate ou sem cor · mais forte = mais dominante · toque num estado para abrir o hub dele · predomina o {cor} · {n}% de quem escolheu · sem cor predominante · fechar estado · cores do estado · moradores · políticos · governador, deputados, senadores e prefeitos · sem cor · governador · vaga aberta · quem pontuar mais assume · apertado · vice · deputados · {n} · ainda sem deputados · prefeituras · {n} · buscar cidade · sem prefeito · nível {n} · nenhuma cidade com esse nome · senado · SENADORES · cadeira vaga · quem pontuar mais entre os não eleitos assume · vice-presidente · {n}º no senado · prefeituras mais disputadas · pts p/ virar · ainda sem disputa nas grandes cidades · pontos e votos da semana atual · atualiza a cada poucos minutos · painel da eleição · presidente, governadores e senado.

**Lojas**: Visite as lojas e ganhe pontos · seguir a loja pelo botão do cartão = +{n} pts (1 vez por loja, até 15 lojas por dia). marcar o @ dela num comentário do @naoeummapa = +{n} pts (1 vez por loja). · você já ganhou {a} de {b} loja(s) · +{n} pts a caminho · entram na próxima atualização do mapa · cada loja que você segue vale +{n} pts · perto de mim · todas · seu @ pra ver as lojas do seu estado · ok · buscar loja ou cidade · em {UF} · perto de você · no resto do Brasil · nenhuma loja em {UF} ainda · veja as do Brasil · sua loja · chame no WhatsApp · seguindo ✓ · +{n} disponível · até {data} · visitar · mostrar mais ({n}) · nenhuma loja com essa busca. tenta outro nome ou cidade. · nenhuma loja no mapa agora. · lojas patrocinadas vigentes hoje · ordem: … · essa loja não está mais no mapa.

**Negócio**: ver §11 (todos os textos listados por passo).
