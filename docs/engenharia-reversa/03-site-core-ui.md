# 03 · Site core + UI — especificação técnica e de interface

Engenharia reversa de `naoeummapa.app` (bundle legível `engine.js`, módulos `site.js`, `poder.js`, `dados.js` (aba DADOS), `ficha.js`, arquivo solto `rewind.js`, `body.html`, `style.css`, `index.html`, `manifest.webmanifest`, `privacidade.html`). Tudo aqui é o que o código faz hoje (24/10/2026), escrito como especificação para reimplementar do zero. Onde um módulo vizinho (ranking.js, eleicao.js, alta.js, frase-ui.js, negocio.js, cidade-painel.js) é indispensável para entender a tela, ele é descrito no nível de contrato, não de implementação.

Convenções: `D` = `window.__DADOS`; `gi` = índice global do morador (posição dentro de `D.u`); `h` = @ normalizado; `PD` = `D.P`; "cartão" = `<section id="cartao">`; "painel" = tela cheia que cobre o mapa (ranking, lojas, como, votar, minha casa, negócio, ficha, missões).

---

## 0. Arquitetura da página (visão rápida)

- Página única, `index.html`, `lang=pt-BR`, `viewport-fit=cover`. CSS inteiro inline no `<head>` (o `style.css` é o mesmo texto). Fonte Nunito 900 embutida em base64 (`@font-face`, `font-display: swap`).
- Scripts (todos `defer`, na ordem): `dados.js?v=` (define `window.__DADOS`, `window.NEG_CFG` e as flags), `engine.js?v=` (Three.js + todos os módulos concatenados num único escopo), `rewind.js?v=` (solto, com uma cópia de `hash.js` colada antes).
- `<meta name="...">` usados como "config" em tempo de execução: `numeros` (URL do numeros.json), `poder` (URL do poder.json), `ev`, `selos`, `hm`, `rewind` (só o hash de versão; os arquivos ficam em `ev/<k>.json`, `selos/<k>.json`, `hm/<k>.json`, `rewind/geral.json`, `rewind/p/<k>.json`).
- Analytics: `window.va` (Vercel Web Analytics, `/_vercel/insights/script.js`). Eventos próprios: `va('event', {name:'rewind', data:{casa}})`; `POST /api/visita` anônimo.
- Flags globais (fim do `dados.js`): `window.REATIVA=1`, `window.VOTAR_UI=1`, `window.SIMPLES=1`, `window.MISSOES=1` (+ `window.__MJV` = versão dos jogos), `window.FRASES=1`. Sem a flag o módulo correspondente não roda e a interface cai para a versão anterior (documentado em cada tela).
- Modelo de dados fica em `site.js` (arrays tipados derivados de `D`); `poder.js` só desenha. Cargos e somas são sempre DERIVADOS dos arrays do build, nunca recalculados no cliente.

### 0.1 Perfil do aparelho (orçamento)

```
NAV_IG  = UA contém Instagram|FBAN|FBAV|FB_IAB|Line/|MicroMessenger
MOBILE  = pointer:coarse  OU  min(innerW, innerH) < 700  OU  NAV_IG
FRACO   = deviceMemory <= 2 GB  OU  UA de Samsung A/J antigo com Android 5-8  OU  Android 4-7
ORC     = MOBILE ? {cidades:48, casas:5600} : {cidades:110, casas:13000};  FRACO → {16, 1800}
leve    = FRACO OU ?leve=1  → mapa 2D (SVG, body.leve/sem3d), sem WebGL
```

---

## 1. Mapa de telas e estados

### 1.1 Esqueleto do `<body>` (ordem e ids)

| Elemento | Papel | Regras de exibição |
|---|---|---|
| `canvas#gl` (role=img, aria-label "Mapa 3D do Brasil com as cidades e as casinhas de quem já entrou no jogo") | mapa Three.js | escondido em `body.sem3d`/`body.leve` |
| `#camada` (aria-hidden) › `#selring`, `.etq#etq` (`#etqH`, `#etqC`) | rótulos HTML, anel da cidade escolhida, etiqueta da casa escolhida | `pointer-events:none`, z 3 |
| `header#topo` › `h1.sr-only` "Não É Um Mapa" · `button#ajuda` "?" · `form#form[role=search]` (`label.campo` › `span.at` "@" + `input#q`; `button#ir` "achar") · `p.dica1#dica1` · `ul#sug[role=listbox]` · `button.negtopo#abrirNegocioTopo` | busca | `#ajuda` nasce `hidden`, ranking.js mostra se `PD`; `.negtopo` nasce `hidden`, `negocioIniciar()` mostra se `NEG_CFG.ativo`; `body.achou` esconde `.negtopo`/`.dica1`; em `body.simples` o `.negtopo` recebe `.s1-fora` (some) |
| `#ctrl[role=group aria-label="Zoom do mapa"]` › `#zmais` (aria "aproximar"), `#zmenos` ("afastar"), `#zbr` ("Brasil inteiro") | zoom | em telas ≤ 640 px fica invisível enquanto o cartão está aberto; `top` recalculado por `aplicarMargens()` |
| `section#cartao[hidden aria-live=polite aria-label=Detalhes]` | cartão de casa/cidade/UF/aviso | preenchido por `abrirCartao()`; `body.achou` enquanto aberto |
| `footer#rodape` › `p.totais#totais[role=status]` · `button.negbtn#abrirNegocio` "seu negócio no mapa" · `p.rod-links` (`a.priv` "privacidade" · `a#segRodape` "seguir @naoeummapa") | rodapé | `body.achou #rodape {display:none}` |
| `nav#tabbar[aria-label="navegação principal"]` › 6 `button.tab[data-tab]` | barra de baixo | ver 1.9 |
| `section#lojas`, `section#ranking`, `section#como` | painéis estáticos | nascem `hidden`; painéis dinâmicos (`#eleicao`, `#minha-casa`, `#painel-eleicao`, `.mi`, `#negocio`, `#ficha`) são criados por JS e anexados a `#app` |
| `#toast[role=status hidden]` | aviso curto | 2,6 s |
| `#carrega[role=status]` › `.spin` + `p.out` "montando o mapa…" | carregamento | some com `html.pronto` (opacity 0, 0,5 s) |
| `noscript #semjs` "esse mapa precisa de JavaScript ligado" | | |

### 1.2 Estados globais

| Estado | Como entra | Efeitos |
|---|---|---|
| carregando | antes de `pronto=true` | `#carrega` visível; busca digitada fica `pendente` e roda quando pronto |
| `html.pronto` | `iniciar()`: mundo criado → `definirCirculos/Marcadores` → `refrescar()` → `brasil()` → `pular()` → 3 frames | esconde `#carrega`; `negocioIniciar()`; processa `?u`, `?c`, `?loja` ou `pendente` |
| `body.achou` | `abrirCartao()` | esconde rodapé, encolhe `h1`, esconde `.negtopo` e `.dica1` |
| `body.dados-on` | ranking/como/lojas abertos | esconde `#ajuda`, baixa z do `#ctrl` |
| `body.simples` | `window.SIMPLES` (fila de avisos) | regras `.s1-*` |
| `body.sem3d` / `body.leve` | WebGL falhou / aparelho fraco | sem canvas; cartões sem animação; `#mapa2d-box` |
| `sel` (variável) | `{tipo:'casa', casa, h, c}` · `{tipo:'cid', c}` · `{tipo:'est', uf}` · `null` | decide marcadores amarelos, anel, etiqueta, prioridade de rótulos, raio-X |

### 1.3 Topo: busca

- `input#q`: `type=text`, `inputmode=text`, `autocomplete=off`, `autocapitalize=none`, `autocorrect=off`, `spellcheck=false`, `enterkeyhint=search`, `maxlength=60`, placeholder **"seu @ ou cidade"**, aria-label "Busca por @ do Instagram, cidade ou estado". Botão **"achar"** (submit).
- Eventos: `input` → `mostrarSugestoes(sugestoes(valor))`; `focus` com valor → mostra de novo; `blur` → esconde `#sug` após 120 ms; `keydown` ArrowDown/ArrowUp percorre (`li.on`), Enter com item marcado escolhe; `submit` → `buscar(valor)`; `Escape` global fecha o cartão.
- `#ajuda` ("?", amarelo, redondo, 40 px): abre "como funciona". Recebe classe `.novo` (anel pulsando) até a pessoa abrir uma vez (`nem_viu_como`).
- `p.dica1`: vazia por padrão (`:empty{display:none}`); recebe `#evFaixa` (faixa de evento) e o cartão `.reativa` logo depois dela; em `body.simples` vira a "linha" da fila de avisos (1.11).
- `.negtopo` **"registrar meu negócio na minha cidade"** (amarelo, 32 px) abaixo da busca; some com cartão aberto.

### 1.4 Totais (rodapé)

`#totais` vira uma pílula branca com 2 ícones (casa + pino): `<b>N casas</b>` · `<b>M cidades</b>` sem texto corrido; `aria-label`/`title` = **"N casas em M cidades"** (N = `D.n`, M = `D.c.length`, `fmtN` com ponto de milhar).

### 1.5 Toast e aviso fixo

- `toast(t)`: texto no `#toast`, some em 2 600 ms (timer reiniciado a cada chamada). Pílula escura (`--ink`) com texto branco, 17 px, `bottom: 110px + safe-area`.
- `avisoFixo(t)`: mesmo elemento, sem timer; `avisoFixo(null)` esconde. Usado em perda de contexto WebGL: **"recarregando o mapa…"**.

### 1.6 Controles de zoom

`#zmais` → `mundo.zoomEm(centroLivre, 2, 8)`; `#zmenos` → fator 0,5; `#zbr` → `fechar()` + `mundo.brasil()`. `centroLivre = [W/2, (UI.topo+UI.base)/2]`. No modo leve usam `zoom2d`/`irLeve`.

### 1.7 Margens da área livre (`aplicarMargens`)

```
UI.topo = bottom(#topo) + 4
UI.base = cartão aberto ? top(#cartao) - 4 : (rodapé visível ? top(#rodape) - 2 : H)
UI.base = max(UI.topo + 120, UI.base)
#ctrl.top = max(UI.topo + 8, UI.base - 148)
mundo.setMargens(UI.topo, UI.base)     // a câmera enquadra entre topo e base
```
Chamado em resize, ao abrir/fechar cartão e ao mostrar o botão de negócio.

### 1.8 Cartão (`#cartao`) — comportamento comum

- `abrirCartao(c)`: substitui o conteúdo por `c` (um `.cart`), remove `hidden`, põe `body.achou`, anexa fora do `.cart` um `button.fechar` (X SVG, aria "fechar") para o X não rolar junto, e agenda `aplicarMargens`.
- `fechar()`: `sel=null`, esvazia, tira `.achou`, esconde `#etq`/`#selring`, remove `?u`/`?loja` da URL (replaceState), `mundo.selecionar(null)`, refaz marcadores, `aplicarMargens`.
- `.cart` rola internamente (`max-height: min(68dvh, 620px)`; `.cart.pessoa` até `min(84dvh, 760px)`), barra de rolagem escondida, animação `sobe` (0,45 s, mola).
- `aviso(titulo, linhas[])`: cartão `.cart.nao` com `.nome` + parágrafos, sem botões. Usado em:
  - `naoAchei(h)`: título **não achei "h"**; linhas: **"comenta o nome da sua cidade no último post do @naoeummapa e ela aparece aqui."** e **"confere se o @ está igualzinho ao do Instagram (ou digita o nome de uma cidade ou estado)."**
  - `abrirCidadeIbge` sem casa: título **"essa cidade ainda não tem casa"**, linha **"ninguém comentou o nome dela no @naoeummapa ainda. comenta lá e vira o fundador!"**

### 1.9 Barra de baixo (`#tabbar`) — T3 (20/10) + abas FRASES (21/10)

Botões no HTML (ordem): `casa` "Minha Casa" (hidden), `votar` "Votar", `minha` "Minha cidade", `eleicoes` "Eleições" (hidden), `ranking` "Ranking", `lojas` "Lojas" (hidden, com `i.selo-pts`). Cada um: SVG 24×24 traço 2,1 + `span` rótulo 11,5 px.

Com `window.FRASES` (produção): `frase-ui.js › mcIniciar()` mostra **Minha Casa** e **Eleições**, esconde **Votar**. Barra final: **Minha Casa · Eleições · Minha cidade · Ranking · Lojas** (Lojas aparece quando `lojas-hub.js` tem lojas vigentes). **Eleições** fica no centro como botão redondo amarelo de 52 px, 30 px acima da barra (`#abrirEleicoes::before`).

Regras (`tabsIniciar`, ouvinte em captura):
- Toque numa aba: `tabsFecharTudo(k)` fecha todos os painéis menos o alvo (`Eleicao.fechar`, `__fecharRanking`, `__fecharLojas`, `__fecharComo`, `miFechar`) e abre o dela.
- Toque na aba já ligada (`.on`): fecha tudo e volta pro mapa (`minha` também chama `fechar()` do cartão).
- `minha`: lê o "eu" (`nem_eu` ou `voto_eu`); sem @ → `toast('escreva o seu @ na busca para achar a sua casa')` e foca `#q`; com @ → `cartaoCidade(cidade do eu)` (espera o mapa ficar pronto, até 150 tentativas × 200 ms).
- Aba ativa (`tabsAtiva`): `__tabAtiva()` (FRASES: 'casa' se `#minha-casa` visível, 'eleicoes' se pop-up ou `#painel-eleicao`/`#eleicao` visíveis) → senão `#eleicao` visível = 'votar', `#ranking` = 'ranking', `#lojas` = 'lojas'; `#como`/`#missoes` visíveis = nenhuma; cartão aberto da própria cidade ou da própria casa = 'minha'. Repintado por `MutationObserver` em `#app` (atributo `hidden`).
- Visual: `.tab.on` tem pílula amarela 58×32 com borda escura atrás do ícone (mola 0,28 s) e cor `--ink`; inativas `#66748a`.
- Painéis terminam acima da barra: `#ranking, #lojas, #eleicao {bottom: var(--tabb)}`; `#cartao {bottom: var(--tabb)}`; `--tabb = 72px + safe-area-bottom`. Em ≥ 641 px a barra tem 480 px centrados.

### 1.10 Painéis de tela cheia (contrato)

Todos: `position:absolute; inset:0` (bottom = `--tabb`), fundo gradiente `#b3d1ee → #e6ebea 55% → #cfe3c4`, cabeçalho `sticky` com `h1.out` (texto branco com contorno preto) e `button.fechar` (44 px) à direita, corpo `max-width: 520px` em grade com `gap`.

| Painel | Abre por | Hash/URL | Título |
|---|---|---|---|
| `#ranking` | aba Ranking, `abrirRanking({gi, esc} \| {c} \| {uf})`, trio do cartão | `#ranking`, `?aba=ranking` | "contagem de votos" no HTML, trocado em runtime para **"Ranking"** |
| `#como` | `#ajuda`, `#ajudaRk`, botão "como funciona tudo isso?" | — | **"como funciona"** |
| `#lojas` | aba Lojas | `#lojas`, `?aba=lojas` | **"lojas"** |
| `#eleicao` (eleicao.js) | aba Votar (sem FRASES) | `#eleicao` | votar em 3 passos |
| `#minha-casa` (frase-ui) | aba Minha Casa | — | **"Minha Casa"** |
| `#painel-eleicao` | hub de eleições | `#painel` | — |
| `.mi` (missoes.js) | "ajudar <cidade>" | — | — |
| `#negocio` | botões de negócio | — | — |
| `#ficha` | — | `#obra` / `#obra=NEG-XXXXXX` | **"ficha da obra"** (`obra` em amarelo) |

`Escape` fecha como → ranking → cartão, nessa prioridade.

### 1.11 "Como funciona" (`#como-corpo`, SIMPLES ligado)

Conteúdo já vem no HTML (SEO) e é redesenhado por `montarComoSimples`:
1. `section.cs-obj` (amarelo): rótulo **"o objetivo"**, h2 **"construir o Brasil virtual e governar a sua cidade"**, p **"comenta sua cidade → ganha sua casa → vota e faz sua cidade crescer → quem soma mais pontos na semana manda (vereador → prefeito → governador → presidente) · domingo 21h a eleição fecha e começa de novo"**.
2. Três cartões `.cs-c` (o 3º escuro `.esc`):
   - **sua casa**: "comenta sua cidade em qualquer post" · "a casa nasce em até 20 min com 10 pontos" · "cresce com os seus pontos e nunca encolhe".
   - **seu voto**: "1 voto por hora em cada cargo" · "vale +5 e sobe 1 a cada hora que você vota" · "zera domingo 21h" · 'seu voto aparece em "últimos votos" com o seu @'.
   - **quem manda**: "domingo 21h fecha a semana" · "quem tem mais pontos vira prefeito, governador, presidente".
3. `.cs-duv` **"dúvidas que todo mundo tem"** (6 pares pergunta/resposta — lista em §10). Na dúvida "e o app?" entra o botão **"como virar app"** (`__site.instalarApp`).
4. `details.cs-tudo` com summary **"ver tudo (níveis, cargos, jeitos de ganhar pontos)"**; ao abrir monta o "como funciona" completo:
   - bloco **"sua casa cresce"** (sub "pontos da temporada: a casa sobe com eles"): 5 marcos da escada (índices 0, 12, 25, 37, 49 das 50 casas) com ícone, nome e "N+ pts"; rodinha: **"50 níveis, da casinha até o topo do Brasil. a temporada 2 vai de domingo 18/10 às 21h até domingo 01/11 às 21h: os pontos zeraram; a sua casa e o nível ficam (o nível nunca diminui), e o selo de fundador também. o que mais sobe a casa é trazer amigo novo (+50)."**
   - bloco **"cargos: quem faz mais pontos na semana manda"** (sub "mais pontos, cargo mais alto"): escada `CARGOS_ESCADA` (Presidente · 1 vaga · Brasil / Senadores · 49 vagas · Brasil / Governador · 1 por estado · estado / Deputados · "bancada real do estado (SP 70, MG 53, RJ 46…)" · estado / Prefeito · 1 por cidade · cidade / Vereadores · 20 por cidade · cidade / Morador · "todo mundo que tem casa"), cada linha deslocada 11 px; regras: "na cidade: prefeito + 20 vereadores. no estado: governador + deputados. no Brasil: presidente + 49 senadores." · "cada pessoa tem 1 cargo só, o mais alto. quem sobe abre a vaga lá embaixo: o próximo da fila assume." · "desempate: quem tem a casa mais antiga." · "os cargos mudam ao vivo e valem até o fim do mandato (domingo às 21h)."; destaque **"mandato N fecha domingo às 21h (Brasília) em"** + relógio `dhms` atualizado a cada 1 s.
   - bloco **"como ganhar pontos"** (sub "com o que você já fez, @eu" ou "cada jeito, o valor e o botão") = `cartoesAcao`.
   - botão **"ver minha posição no ranking"** / **"ver o ranking"**.
- Abrir grava `nem_viu_como=1` e tira `.novo` do "?".

### 1.12 Reativação, faixa de evento e fila de avisos (eleicao.js)

- `nem_ult` = timestamp da última visita (gravado em toda carga).
- **Reativa** (só com `window.REATIVA`, 1 vez por aparelho `nem_reativa1`): precisa de `nem_eu` e ≥ 12 h desde `nem_ult`. Cartão escuro `.reativa` abaixo de `#dica1` (ou da faixa): título **"voltou, @eu! o que mudou:"**, lista "50 níveis (o seu nível ficou)" · "vote a cada hora" · "eleição ao vivo" (+ "hoje amigo = +100" se evento ativo), botão amarelo **"ver minha casa"** (→ `mostrarCasa`), link **"conta o que você quer no jogo (comenta no nosso último post)"** (Instagram), × fecha.
- **Faixa de evento** `#evFaixa`: só com `window.EVENTO_SITE {ini, fim, txt}`; aparece na janela e some no fim.
- **Fila (SIMPLES)**: `body.simples`; só UM cartão visível no topo por vez (ordem evento › fogo › voltou); os outros viram botões-pílula na `.dica1` ("texto ›") que trocam o visível; o "voltou" vira linha dentro do cartão do fogo com `voltaTxt()`: **"desde a última visita: +N posições na cidade (Pº)"** / **"desde a última visita: caiu N na cidade (Pº) · vote pra subir"** / **"desde a última visita: Pº na cidade"** (posição guardada em `nem_s1pos`).
- **Visita anônima**: `nem_vid` (id aleatório) → `POST /api/visita {d, n (1ª visita), eu (tem @), p (em app)}`.

### 1.13 Convite do story (alta.js)

Depois de buscar o próprio @ (`escolher` tipo usr), se o cartão não estiver aberto: botão flutuante `#convite` (amarelo, largura do topo, `top = UI.topo+8`, anima `convite`): **"posta sua casa no story"** + "+30 pontos (1 por dia) e em alta por 24 h"; se já em alta: **"você está em alta"** + "até 15h · posta de novo amanhã pra manter". Some em 7 s; toque gera a imagem (`gerarStory`).

### 1.14 Botão "seu negócio no mapa"

`negocioOk() = window.Negocio && NEG_CFG && NEG_CFG.ativo !== false`. Se ok: mostra `#abrirNegocioTopo` e `#abrirNegocio` (ambos → `Negocio.abrir()`); também "coloque seu negócio aqui" no cartão da cidade (`negocioAbrir(ibge)`) e "＋ seu negócio nesta cidade" no cartão da loja. `NEG_CFG` (do build) traz: `precos` (3 faixas por população: até 100 mil R$ 49 "Plano Interior"; até 1 milhão R$ 69 "Plano Cidades Grandes"; acima R$ 99 "Plano Metrópoles"), `duracao_dias: 10`, `prazo_texto`, `pontos_marcacao: 30` (texto da regra), `pix` (copia-e-cola por faixa), `proibidos` (aposta/bet, IPTV/pirataria, adulto, político, armas, remédio controlado), `tipos` (12 categorias), `pacote` (4 frases com `{cidade}`/`{pts_marcar}`), `whatsapp`/`whatsapp_texto` (`{nome} {cidade} {codigo} {valor}`), `prova` (prova social), `pts_marcar {antes:30, depois:10, virada_ts}`, `joao` (cartão de confiança do criador). Fluxo: dados → preços/pacote → `POST /api/negocio` → código `NEG-XXXXXX` + Pix + "já paguei" (wa.me). Rascunho em `neg_rascunho_v1`, funil em `POST /api/neg-ev` com `neg_sid`.

### 1.15 Ficha da obra (`ficha.js`)

- Abre em `#obra` ou `#obra=NEG-XXXXXX` (hashchange + carga). `window.Ficha = {abrir(opts), fechar(), validar(d)}`. Folha `#ficha` (role=dialog, aria "Ficha da obra"), cabeçalho "ficha da **obra**", X "voltar pro mapa", `Escape` fecha; fechar limpa o hash.
- Pré-preenche celular/@ se `neg_rascunho_v1_enviado.codigo` for igual ao código do hash (dados de `neg_rascunho_v1`).
- Campos (rótulo · dica · atributos): "seu código do pedido" · "está na tela do Pix e começa com NEG-" · maxlength 10, placeholder `NEG-XXXXXX`, uppercase; "conta pro mapa: nome e o que seu negócio faz" · "de 20 a 600 letras. Pode ser simples." · textarea 600 com contador `n/600`, placeholder "ex.: Padaria do Zé. Pão quentinho todo dia desde 1998, no centro de Vitória."; fieldset "como vai ser sua loja em 3D?" com 2 rádios: "Vou montar minha loja em 3D no ChatGPT e mandar a imagem no WhatsApp" / "Vocês geram com base no meu contexto"; "como você quer a sua loja (opcional)" · "cores, estilo, o que não pode faltar" · textarea 600, placeholder "ex.: fachada amarela, toldo listrado, placa com o nome"; "nome de quem fez o Pix" · "como aparece no comprovante do banco. É assim que a gente acha o seu pagamento." · maxlength 60; "número do WhatsApp de onde você vai mandar a logo e as fotos" · "com DDD, só números" · tel; "seu celular para contato" · "com DDD, só números"; "@ do Instagram do negócio" (prefixo @, placeholder "seunegocio"); "site do negócio (opcional)" (url, placeholder `https://`); aviso "Se você pagou antes das 21h de hoje, até 00h te mandamos as amostras para ajustes; a aprovação final vai até 10h da manhã do dia seguinte, para entrar na página."; checkbox "Li e estou ciente do prazo. Não mando áudio nem arquivo no WhatsApp."; botão **"enviar a ficha"** (→ "enviando…").
- Validação (mensagens, nessa ordem): "O código do pedido tem que ser como NEG-AB12CD." · "Escreve o nome de quem fez o Pix (como aparece no comprovante)." · "Conta um pouco mais do seu negócio (pelo menos 20 letras)." · "O texto do negócio passou de 600 letras." · "Escolhe como vai ser a sua loja em 3D." · "Confere o número do WhatsApp da logo (com DDD)." · "Confere o seu celular (com DDD)." · "Falta o @ do Instagram do negócio." · "O site tem que começar com http:// ou https://." · "Marca que você está ciente do prazo." Erro de rede: "Não consegui enviar agora. Seus dados continuam aqui. Tenta de novo."
- `POST /api/obra` com `{codigo, pagador, contexto, montagem, logo_zap, celular, insta, ciente_prazo:true, montagem_texto?, site?}`; sucesso grava o código em `neg_ficha_enviada` (últimos 20) e mostra: "Ficha enviada!", "seu código" + código, "Agora é só mandar no WhatsApp o comprovante do Pix e a logo (ou as fotos). Não mande áudio nem arquivo.", botão **"mandar comprovante e logo no WhatsApp"** (wa.me com texto "Oi! Loja: <nome> · pedido <código>: ficha enviada pelo site. Pix feito por <pagador>. Segue o comprovante e a logo (enviando do número <zap>)."), aviso do prazo, botão "voltar pro mapa".

---

## 2. Fluxo "quem sou eu"

Há DOIS "eus", de propósito:

| Chave | Quem grava | Significado | Quem lê |
|---|---|---|---|
| `nem_eu` | `lembrarEu(h, gi)` a cada @ buscado (sugestão tipo usr) ou `?u=`; link mágico; rewind ("ver meu rewind") | "quem sou eu" do ranking e dos textos (`EU.gi`) | ranking (`.rk.eu`, barra "você"), `tabsMinha`, `botaoStoryGrande`, `cartoesAcao`, reativa, ofensiva (fallback), rewind |
| `voto_eu` | só quando a pessoa digita o PRÓPRIO @ no formulário de voto ("qual é o seu @?"), no passo 1 do painel votar, no link mágico | o eleitor (não muda ao buscar outros @) | `botaoVotar` ("votando como @x · trocar"), `frEu()` (Minha Casa, frase/cor), `cvEu`, ofensiva, `tabsMinha` (fallback) |

Regras:
- `lerEu()`: lê `nem_eu`, só vale se `POR_HANDLE` conhece o @ (senão `-1`).
- `lembrarEu` também é chamado ao gravar `voto_eu` (o eleitor vira "eu" do ranking), mas o contrário não.
- **"não sou eu"** (`esquecerEu`): botão `.eu-nao` na barra "você" do ranking e no cartão da loja ("você: @x · não sou eu"). Remove `nem_eu`, `EU.gi=-1`, redesenha o ranking. Não mexe em `voto_eu`.
- **"trocar"** (voto) / **"trocar @"** (Minha Casa): remove `voto_eu` e reabre o formulário do @.
- Erro ao digitar @ sem casa no voto: **"comenta a sua cidade num post do @naoeummapa para ganhar casa e poder votar"**.
- `votoSid()`: id do aparelho `[a-z0-9]{8,16}` (8 chars aleatórios base36 + 4 últimos do timestamp) em `voto_sid`; vai em todo `POST /api/voto` (`s`) e `/api/frase` (`s`). `Frases.codigo(votoSid())` gera o código de verificação `MAPA-XXXXXX` (FNV-1a 32 bits de `'mapa|' + sid`, 6 chars do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
- **Link mágico / prova** (`frases.js`): URL `?eu=<@>&vp=<24 chars [A-Za-z0-9_-]>` (gerada pelo webhook do direct). Na carga: grava `nem_prova = {h, p, ts}`, `voto_eu`, `nem_eu`, `nem_verif_novo=1`, limpa a query. `Frases.prova(h)` devolve `p` se `h` for o @ salvo. `Frases.verificado(h) = D.VF.includes(h) || !!prova(h)`. Ao iniciar com `nem_verif_novo`: `toast('verificado ✓ você entrou como @eu')` e abre Minha Casa. O corpo do `POST /api/frase` leva `p` quando existe.
- Verificação no cartão (bloco `.fr-ver`): verificado → **"verificado"** + "só você publica a frase e a cor deste @. trocou de celular? mande também o código deste aparelho: MAPA-XXXXXX"; não verificado → **"verifique o seu @"** + "mande este código no direct do @naoeummapa pela conta @h. você recebe na hora um link: toque nele e pronto." + `code` + botão **"copiar código e abrir o direct"** (→ "código copiado · cole no direct", abre `ig.me/m/naoeummapa`).

---

## 3. Busca

### 3.1 Normalização (`Hash.norm`, mesmo código no build e no browser)

```
norm(s): trim, lowercase
         se contém 'instagram.com/' → fica só o que vem depois
         tira '@' iniciais; corta em / ? #; tira '@' de novo
         mantém só [a-z0-9._]; máx. 30 chars; '' se nada sobrar
chave(h) = base64url-sem-padding dos 12 primeiros bytes de SHA-256('naoeummapa:v1:' + h)  → 16 chars
```
`semAcento(s)` (cidades/UF): NFD, remove diacríticos, lowercase, trim.

### 3.2 Índices do modelo

```
USR        = D.u.split('\n')                 // @ por gi
POR_HANDLE = Map(@ → gi)
LISTA[ci]  = {ibge, ini, n, nome, uf, fund, k: semAcento(nome), q: ordem por tamanho, rUF, cx, cy, rs, ...}
CID_DE[gi] = ci
ORDEM      = LISTA ordenada por n desc, ibge asc (cidades grandes primeiro)
ESTADOS[uf]= {uf, nome, k, cor, x, y, folga, casas, cidades[], gov}
```

### 3.3 Sugestões (`sugestoes(bruto)` → até 6)

```
q0 = trim; arroba = q0[0]=='@'; t = semAcento(q0 sem @)
se !arroba:
  cidades com c.k == t           (ORDEM)              → {tipo:'cid', rot: nome, sub: 'UF · N casas'}
  estados com e.k == t ou uf == t                     → {tipo:'est', rot: nome, sub: 'estado · N casas'}
  se t.length >= 2:
    cidades c.k.startsWith(t)   até 4 itens
    estados e.k.startsWith(t)
    cidades c.k.includes(t)     até 5 itens
h = Hash.norm(q0); se h:
  POR_HANDLE.get(h) exato                             → {tipo:'usr', rot:'@h', sub:'Cidade · UF'}
  se h.length >= 2: até 3 USR[i].startsWith(h) (varredura linear em NM)
```
Desenho de cada `li > button`: `span.ic` ('@' | 'UF' | '●', cor = cor da UF), `span.tx` (texto sem @ para usr), `span.sb` (sub). `onpointerdown` cancela o blur do input.

### 3.4 Escolher / buscar

- `escolher(s)`: fecha `#sug`, blur, põe `h`/`rot` no input. usr → `lembrarEu` + `mostrarCasa(h, gi)` + `conviteStory(gi)`; cid → `cartaoCidade(c, {voar:false})` + `mundo.voarCidade(garantirCidade(c))`; est → `cartaoEstado(uf, {voar:true})`.
- `buscar(bruto)`: vazio ou sem nada válido → `toast('digita um @, cidade ou estado')` + focus. Mapa não pronto → guarda em `pendente`. Com sugestões → `escolher(primeira)`; sem → `naoAchei`.

### 3.5 URL e hash

| Entrada | Efeito |
|---|---|
| `?u=<@>` | preenche `#q` com `Hash.norm`, após pronto `buscar(u)`; `mostrarCasa` grava `?u=` via replaceState; `fechar()` remove |
| `?c=<ibge>` | `abrirCidadeIbge` |
| `?loja=<id>` (≤ 40 chars) | `abrirLojaId` |
| `?leve=1` | mapa 2D |
| `?rewind=1` | força o rewind |
| `?eu=&vp=` | link mágico (§2) |
| `?aba=ranking` / `?aba=lojas` | abre o painel |
| `#ranking`, `#eleicao`, `#lojas`, `#painel`, `#obra[=NEG-…]` | abrem o painel correspondente; fechar limpa o hash |
| `?app=1` | `start_url` do manifest; nenhum código lê (detecção de app é por `display-mode`) |

`urlDe(h)` = origem + path, sem search/hash, `?u=h` — usado em compartilhar.

### 3.6 Voo da câmera

- Casa: `garantirCidade(c)` (constrói a geometria já e fixa por 20 s em `PIN`), `casa = lay.porChave.get(h)`, `mundo.selecionar(casa)`, `mundo.voar({x, y, dist:16})`.
- Cidade: `voarCidade(lc)` ou, quando vem do toque no mapa, `voar({x, y, dist: D > 2200 ? 1800 : D})`.
- Estado: `voarEstado(uf)` enquadra a caixa `BOX_UF` com fov 25° e tilt 52°, `dist ≥ 300`.
- Modo leve: `irLeve(cx, cy, zoom)` / `irCaixa2d`.

### 3.7 Toque no mapa (`aoToque(cx, cy)`)

```
D = distância da câmera
se D >= 70: a cidade sob o dedo (marcador visível ou real>=8, dentro de rHit) tem prioridade → cartaoCidade
hospital parceiro → loja → obra → ilha (módulos)
se D < 70: casa mais perto (<28 px) entre as com @ visível, senão qualquer casa projetada → mostrarCasa
cidade (de novo) → cartaoCidade
se D > 1000: chão → UF → cartaoEstado(voar)
senão: se havia seleção, fechar()
```

### 3.8 Rótulos HTML (`rotulos(D)`, resumo das regras de texto)

- Reserva topo (`UI.topo`), base (`UI.base`), caixa do `#ctrl` e a etiqueta da casa escolhida; depois ilha, cidade escolhida, estados (D entre 650 e 1500 em fade; "UF" + "gov. @x" sem FRASES), cidades por prioridade (`c.pri = n*0.5 + ps/(2*AVGP)` com pontos; senão `n`), hospitais parceiros (D<160), obras/lojas, balões de frase, @ dos moradores (D<70: `GLIFO @x` para cargos ≠ V, `em alta @x`, `fundador @x`, `@x`; máx. 8 no celular/14 no desktop; só os próximos ao centro salvo cargos).
- Tamanho do nome da cidade: 17/15,5/14/13 px (n ≥ 300/100/30/menos); sublinhas 11,5 px. Linha 2 com pontos: **"prefeito @x"** (sem FRASES); sem pontos: "N casas" e "fundador @x".
- Limite de rótulos: celular 8 (D<150) / 11; desktop 12 / 20. Colisão com folga 7 px (celular) / 3 px.
- Pool de `div.rt` reutilizado; fade em 0,22 s; remove do DOM após 240 quadros sem uso.
- Etiqueta `.etq` da casa escolhida: `#etqH` = "em alta · @h" ou "@h", `#etqC` = "Cidade, UF"; `.fund` põe bandeirinha; visível só com D < 140.
- Marcadores: brancos; amarelos para cidades ≥ 150 casas e para a cidade escolhida; raio `max(3, min(11, 2.6 + 0.5√n))` px.

---

## 4. Cartões

### 4.1 Cartão da casa (`corpoCasaP`, com `PD`) — ordem dos blocos

Classe raiz: `.cart.pessoa[.fund][.cgX][.cp]` (`cp` = estilos "cartão limpo" de cidade-painel).

| # | Bloco | Conteúdo / regra |
|---|---|---|
| 1 | `.cab › .nome` | **@h**. Se `h.length > 12`, `font-size = clamp(24px,7.4vw,32px) × max(0.55, 12/len)`, `nowrap` |
| 2 | `.onde` | `button.lk` **<Cidade>** (→ cartão da cidade) · `span.uf-sigla` **UF** · `pill.prov` **"casa provisória"** se `ehProv(gi)` · (MISSOES) `pill.ministro` **"ministro da <área>"** · (SIMPLES) `pill.vice` **"vice-prefeito"/"vice-governador"/"vice-presidente"/"suplente de senador"** |
| 3 | `pfQuadros` `.pf-tr` (3 quadrados iguais, role=list) | `.pf-casa` ícone da casa do nível + "nível N" (title "casa de nível N") · `.pf-t1` **#pos** da temporada 1 (de `hm/`; "—" se não jogou; title "Nº de TOT no Brasil na temporada 1") + "temporada 1" · `.pf-fogo` chama SVG + contagem da ofensiva (`Ofensiva.de(h)`; `.on` se > 0, `.hot` se ≥ 10) + "sequência" (title "sequência de fogo: horas seguidas votando nesta semana") |
| 4 | selo do parceiro de saúde (`figoSelo`) | só se a pessoa é "secretário de saúde" da cidade |
| 5 | `seloAlta` `.alta-selo` | se `emAlta(gi)`: ícone fogo + **"em alta no story"** + "até 15h · quem posta marcando @naoeummapa fica em alta por 24 h" (`altaAte`: "até HHh[MM]" ou "até amanhã HHh") |
| 6 | `botaoVotar(h)` | ver 4.2 |
| 7 | `botaoStoryGrande` `.story-big` | se é o "eu" ou não há eu: câmera + **"posta sua casa no story"** + "+30 e em alta por 24 h"; senão `.outro` **"gerar a imagem da casa de @h"**. → `gerarStory(gi)` |
| 8 | `p.nota` | se provisória: **"você só disse o estado, então a casa ficou na capital. comenta o nome da sua cidade no último post e ela muda."** |
| 9 | `.cp-hero` | número grande = `PSEM` (conta de 0 com mola), "ponto(s) na semana", `em` "N na temporada"; `i.cp-conf` **"+N a confirmar"** quando há missões pendentes (`miPendentes('@h').voce`), redesenhado no evento `nem-mis-pend` |
| 10 | `.cp-cargo` | `span.selo.cK` = `rotCargo` (Presidente do Brasil / Senador / Governador de UF / Deputado de UF / Prefeito de Cidade / Vereador de Cidade) ou `selo.c0` **"morador de <Cidade>"**; + `selo.cD` **"fundador"** se `gi === c.ini`; FRASES adiciona `fr-selo` (bolinha + nome da cor) |
| 11 | `frCartaoPessoa` | citação `.fr-q` da frase (`Frases.de(h)`) para outros; para o próprio @: bloco de verificação + editor **"sua cor e sua frase"** (3 chips azul/vermelho/amarelo, dica "a cor do telhado da sua casa e o seu partido na eleição", input "sua frase (até 70 letras)", contador `n/70`, botão **"publicar"**; toasts "publicada · já está na sua casa" / "cor salva · seu telhado já mudou"; `POST /api/frase {u, t, c, s, p?}`) |
| 12 | `cpLinhaPessoa` / `cvLinhaPessoa` `.cp-linha` | **"sua cidade: faltam N pontos de <área> para <upgrade>"** / "sua cidade: todas as 25 obras prontas" / "sua cidade: nível N, <nome>" |
| 13 | `btn.prim` **"ajudar <Cidade>"** | MISSOES e `h === miEu()` → `miAbrir(c)` |
| 14 | `.disp[.topo]` | frase de disputa (4.4) |
| 15 | `bk.sec-comp` **"de onde vieram os pontos"** · sub "N no total" | pilha empilhada + legenda (4.5) |
| 16 | `details.cp-det` › summary **"mais detalhes"** | (SIMPLES) `blocoPoder`; `blocoSelos`; `blocoVotosPessoa`; `blocoUltimo`; `blocoExtrato`; `blocoEscada`; `blocoTrio`; `p.quando` **"casa criada em dd/mm às hh:mm"** (`PEMM`, BRT) |
| 17 | `bk.acoes-bk` **"como ganhar mais pontos"** · sub "toque e faça" | `cartoesAcao({gi,h,pq})` + `btn.mini.como-lk` **"como funciona tudo isso?"** (o bloco é criado antes do details e re-anexado depois dele: fica após "mais detalhes") |
| 18 | `.botoes` | `btn.prim` **"compartilhar"** → `compartilhar(h, textoX)`; `textoX` = "sou <rotCargo> no mapa do @naoeummapa. vem tentar tomar meu lugar" ou "minha casa no mapa do @naoeummapa tem N pontos" |

Fora do cartão: `#etq` sobre a casa; `history.replaceState(?u=h)`.

Sem `PD` (fallback V1, `corpoCasaV1`): bandeira se fundador, nome, cidade · UF, "casa provisória", nota, linhas "fundador de <Cidade>: @x" (ou pílula **"você!"**), "governador de UF: @x", "N casas em <Cidade> · #q no Brasil", barra "próxima conquista: faltam N pro <marco>", botão "compartilhar".

### 4.2 Votar no cartão (`botaoVotar`)

Constantes: `VOTO_ABRE = 1792368000e3` (dom 18/10/2026 21:00 BRT), `VOTO_ESPERA = 3 600 000 ms` por cargo, `VOTO_CARGOS = [[ver,VER,vereador],[pref,PREF,prefeito],[dep,DEP,deputado],[gov,GOV,governador],[sen,SEN,senador],[pres,PRES,presidente]]`.

Estrutura `.voto-box`: `btn.voto-btn` → `.voto-chips[hidden]` (6 chips) → `form.voto-pede[hidden]` (input "qual é o seu @?" + `btn.mini` "votar") → `p.voto-quem` → `p.voto-msg[role=status]` → `.voto-ult` → `.voto-prev`.

```
valor do voto vl = Ofensiva.valor() || 5          // ofensiva: 5 + C − (1 se já contou nesta hora)
botão:  antes de VOTO_ABRE → disabled "votar abre às 21h"
        depois → "votar em @h · +vl"; toque alterna os chips
chip k: texto SIGLA; se falta f>0 → disabled, "SIGLA · N min" (ceil); re-rotula a cada 30 s
tentar(alvo, cargo): eu = voto_eu válido? enviar : mostra form (pend = {alvo, cargo})
form submit: v = Hash.norm(input); sem casa → msg.erro "comenta a sua cidade num post do @naoeummapa para ganhar casa e poder votar"
             ok → voto_eu=v, lembrarEu(v), esconde form, "votando como @v · trocar", envia pend
votoEnviar: POST /api/voto {u: eu, a: alvo, s: votoSid(), c: cargo}
   ok → voto_ultimo[c] = {ts, a}; evento 'nem:votou' {eu, a, c, vl};
        msg.ok "voto registrado[ · valeu +vl] · seu próximo voto de <cargo> libera às HH:MM · os pontos entram em até 20 min"
   erro → msg.erro = j.erro || "não consegui registrar, tenta de novo"
```
- **"seus últimos votos"** (`table.vu`, caption uppercase): até 5 linhas, mais recente primeiro: `@alvo` · cargo · `haTxt` ("agora" / "há N min" / "há N h" / "há N d").
- **Prévia** `.voto-prev`: título **"prévia da eleição · fecha domingo às 21h"**; linhas para prefeito da cidade do eleitor, governador do estado e presidente (cada pessoa aparece uma vez só, no cargo mais alto; se já apareceu, entra o vice via `viceDe`). Linha: `pv-r` rótulo ("prefeito de X" / "governador de UF" / "presidente"), `pv-n` @ (→ `mostrarCasa`), `pv-p` "N pts", `pv-vt` "· N pts de votos" (de `poder.json`), `btn.mini.pv-v` **"votar"** (ou "N min" em espera).
- Chips `.voto-chip`: amarelos 44 px; `.voto-btn`: amarelo, borda 4 px, raio 16.

### 4.3 Blocos recolhidos ("mais detalhes")

- **blocoPoder** (SIMPLES): `.poder-cg` azul-claro com `b.pc-vice` **"você é vice-prefeito de X · faltam N pts pra prefeito"** e `p.pc-tx` rótulo **"o que o seu cargo faz"** + texto `PODER_TXT[k]`: V "você entra na Câmara da cidade; a partir de dom 25/10 a Câmara aprova a obra da semana" · M "a partir de dom 25/10 você decreta a obra da semana da cidade" · G "capital da semana e meta do estado (em breve)" · D/S "Congresso: vota a lei da semana (em breve)" · P "propõe a lei da semana (em breve)".
- **blocoSelos** `.sp-selos`: de `selos/<gi>>11>.json › e[gi]` (lista de strings): `c|<mandato>|<cargo>|<lugar>` → pílula `CGI[cargo]` + "ex-prefeito de <lugar> · mandato N" (P/S sem lugar: "ex-presidente do Brasil", "ex-senador"); `f|<cidade>|<UF>|<1|0>` → "F" + **"fundador de Cidade/UF"** (`.fund`, amarelo) ou **"foi fundador de …"** (`.exfund`). Sem itens o bloco é removido.
- **blocoVotosPessoa** `.vp`: de `eleicao.json › pessoas[@] = [recebidos, dados, horas]`: título "votos na temporada" + 3 caixas "voto(s) recebido(s)", "voto(s) dado(s)", "hora(s) votando". Oculto se tudo zero.
- **blocoUltimo** `.ultimo` (tracejado, amarelo-claro): de `hm/<gi>>11>.json` (`n` = número do mandato fechado, `tot`, `e[gi] = "cargo,posBR,pontos,posCidade"`): título "ex-<cargo> de <lugar da época>" (ou **"morador no mandato N"**) + "mandato N · Pº da cidade · Bº de TOT no Brasil · X pontos". Ícone = sigla do cargo ou casa.
- **blocoExtrato** `bk.sec-extrato` **"por que ganhei"** · sub "os últimos pontos desta temporada": de `ev/<gi>>11>.json` (`ini` segundos; `e[gi] = "min36,razao,pts;..."`, minuto relativo em base36). Lista invertida (mais recente primeiro): `b.mais` "+P" (ou `.zero`), razão (`EV_ROT`: casa "ganhou a casa", comentou "comentou num post", meta "meta de curtidas batida", palavra "acertou a palavra secreta", curti 'comentou "curti"', compartilhei 'comentou "compartilhei"', marcou "marcou um amigo", "marcou loja" "marcou uma loja", "seguiu loja" "seguiu uma loja", recrutou "amigo virou morador", story "story marcando @naoeummapa", envio "mandou o Reel no direct", voto "recebeu um voto", "voto da página"), hora `quandoBRT` "dd/mm às hh:mm". Sem eventos: linha única "+10 ganhou a casa" na data de criação. Nota: **"comentar e marcar amigos ou lojas valem até 100 pontos por dia. seguir loja, story, voto, amigo que entrou e Reel no direct ficam fora desse limite. os pontos novos aparecem em até 20 min."** Erro: "não carreguei o extrato agora".
- **blocoEscada** `bk.sec-escada` **"nível da casa"** · sub "N de 50": janela de 5 degraus (atual ± 2, colada nas pontas), cada `deg.feito|atual|falta` com ícone, nome e "X pts"; trilho preenchido até a fração do atual→próximo; frase `.falta-nv`: **"faltam N pontos pra <próximo nome>"** ou **"no topo: sua casa já é <nome>. o nível da casa nunca diminui."**
- **blocoTrio** `bk.sec-trio` **"sua posição"** · sub "pontos da semana": 3 botões `.tt` (cidade / estado / Brasil): rótulo, **#pos**, "de N em <Cidade>" / "de N em UF" / "de N", e `i.tf` com `faltaPara` (4.4). Toque → `abrirRanking({gi, esc})`. Rodinha "toque num número pra ver o ranking inteiro".
- Legado não usado hoje: `blocoCargo` ("cargo ao vivo: vale até domingo às 21h" / "sem cargo ainda · os pontos da semana decidem") e `blocoPontos` ("define o nível da casa" / "define o cargo").

### 4.4 Frases de disputa (`disputa`, `faltaPara`)

`pontosPara(gi, alvo) = max(1, PSEM[alvo] − PSEM[gi] + (eu mais antigo que alvo ? 0 : 1))` — empate favorece a casa mais antiga.

| Cargo atual | Alvo | Texto `disputa` |
|---|---|---|
| P | 1º senador | **"você lidera o Brasil: segura até domingo 21h"** · sub "N pontos à frente de @seg" (`.disp.topo`, escuro) |
| S | presidente | "faltam N pontos pra virar presidente do Brasil" |
| G | 49º senador (se há 49) | "…pra virar senador" |
| D | governador da UF | "…pra virar governador de UF" |
| M | último deputado da UF | "…pra virar deputado de UF" |
| V | prefeito | "…pra virar prefeito de Cidade" |
| morador | 20º vereador (ou `max(1, 1−s)` se < 20 vereadores) | "…pra entrar na Câmara de Cidade" |

Sub: **"hoje é @alvo, com N pontos na semana"**. Singular: "falta 1 ponto pra …".

`faltaPara(gi, esc)` (trio): se o cargo já está acima da escala → "já é o prefeito" / "já é o governador" / "no topo do Brasil" / "subiu além da cidade" / "subiu além do estado"; senão "falta(m) N ponto(s) pra vereador|prefeito|deputado|governador|senador|presidente".

### 4.5 Composição dos pontos (`poder.json`)

`poder.json = {v, mandato:{n, inicio, fim}, qk:[casa,posts,extras,marcou,recrutou,stories,votos], q:"<linha por gi>\n…"}`; cada linha = valores base36 separados por vírgula na ordem de `qk` (faltantes = 0). Carregado só ao abrir um cartão de pessoa ou "como funciona" (pré-carga em idle quando o mapa fica pronto).

Cores/nomes: casa `#8ecae6` "a casa" · posts `#FFD23F` "comentários" · extras `#f4a259` "extras" · marcou `#78ad54` "marcou amigos" · recrutou `#ef7b7b` "recrutou" · stories `#b79cf0` "stories" · votos `#5fd1c4` "votos". Esqueleto pulsante enquanto carrega; legenda em 2 colunas com zeros escondidos atrás de **"+ N jeito(s) de ganhar pontos"** / **"esconder"**; vazio: "ainda sem detalhes dos pontos desta casa"; erro: "não carreguei a composição" + "tentar de novo".

### 4.6 Cartões de ação (`cartoesAcao`, lista `ACOES_V4` desde 18/10 21h)

| k | vale | nome | como (texto) | botão |
|---|---|---|---|---|
| recrutou | +50 | amigo que você marcou entra no mapa | marque um amigo que ainda não joga. quando ele comentar a cidade e ganhar a casa, você leva +50 (se vários marcaram, vale para quem marcou primeiro). até 20 amigos por semana: é o jeito que mais sobe. | **copiar a chamada** (copia "@amigo comenta o nome da sua cidade no último post do @naoeummapa e entra no mapa do Brasil comigo. eu te marquei lá <url IG>"; toast "copiei a chamada: manda pro seu amigo") |
| stories | +30 | story marcando @naoeummapa | posta a imagem da sua casa nos stories e marca @naoeummapa. vale 1 por dia e deixa você em alta por 24 h. | **gerar imagem do story** (sem @: toast "busca seu @ primeiro pra gerar a imagem") |
| votos | +5 | voto em você | a cada hora você tem 1 voto para cada cargo: toque em "votar" no rodapé (ou abra a casa de quem você quer). cada voto dá +5 ou mais para quem recebe, até em você mesmo: com o fogo aceso, cada hora que você vota o seu voto sobe 1. o voto só vale aqui no site: nos comentários você faz campanha (peça voto e curta o pedido de quem você apoia). | **copiar “vota em mim”** (copia "vota em mim no @naoeummapa! abre naoeummapa.vercel.app, procura @h e toca em votar (1 voto por hora para cada cargo)"; toast "copiei “vota em mim”: cola nos comentários e nos stories") |
| posts | +5 | comentar num post | o primeiro comentário em cada post do @naoeummapa vale +5. comentar de novo no mesmo post não soma. | **abrir o Instagram** (link) |
| marcou | +1 | marcar amigo que ainda não joga | marcar @amigo que ainda não tem casa: +1 por amigo, até 5 por post. quem já tem casa não conta. | **copiar link do perfil** (toast "link do perfil copiado: manda pro amigo achar o post") |
| envio | +20 | mandou o Reel no nosso direct | mande um Reel do @naoeummapa no direct da nossa página: +20 por Reel (1 vez cada Reel), até 3 por dia. só vale Reel nosso. | — |
| casa | 10 | ter casa | comentar o nome da cidade cria a sua casa. na temporada nova, quem já morava recomeça com esses 10. | — |

Rodapé de cada cartão (`.feito`): "conferindo…" → "já fez: N <unid> (+P)" (`.ok`) / "ainda não fez" (`.nada`) / casa: "feito: +10" ou "ainda sem casa"; sem dados: "sem limite de dias" / "vale uma vez". O primeiro cartão com `dica` e nada feito recebe `.dica` + fita **"faz agora"**. (`ACOES_V3`, antes de 18/10: stories +30, recrutou +25, marcou +3 até 10/post, votos +5 por comentário "voto @você", posts +5, extras +1 até 10/post, casa 10.)

### 4.7 Cartão da cidade

**T3 (`cpCartao`, com `D.CV.v === 3`)** — `.cart.cidade.cp`:
1. `.cp-top`: `h2.nome` Cidade; `.cp-sub`: nome do estado · **"nível N · <bairro|cidade|polo|metrópole|capital>"** · `.cp-pos` "#N no Brasil" (de `cidades-t3.json`, sob demanda); `.cp-hero`: pontos da semana da cidade (soma das áreas) + "ponto(s) na semana" + `cp-conf` "+N a confirmar".
2. (MISSOES) `btn.prim` **"ajudar <Cidade>"**.
3. `cpMedidores` **"esta semana"**: 4 barras (água `#6cc4f0`, infra `#ffb347`, saúde `#72dca0`, segurança `#9b7bff`) com "N pts", escala logarítmica até a cidade líder do Brasil, traço da **"média do Brasil"**.
4. `cpGrafico`: pontos por dia da semana (D S T Q Q S S), leitura **"melhor dia: <dia>"** ou por dia tocado; números "voto(s) recebido(s)" e "morador(es) ajudou/ajudaram".
5. `cpTrilha` **"upgrades"** · "N de 25": grade 5 níveis × 5 obras (ícones de traço único), estados `ok|obra|fut`; info **"faltam N pontos de <área> para <obra>"** / "todas as obras prontas" / "toque numa obra para ver"; ao tocar: "<obra> · pronto" / "· em obra, G de C pontos de <área>" / "· pede C pontos em cada área" / "· custa C pontos de <área>". Nível da cidade = `min(5, 1 + floor(prontas/5))`.
6. `cpAutoridades` **"quem manda"**: chips com avatar (1ª letra, cor por papel: prefeito amarelo, vice `#fff2bd`, fundador `#ffb347`, presidente `#ef7b7b`, senador `#b79cf0`, governador `#72dca0`, deputado `#6cc4f0`), rótulos acumulados ("prefeito · fundador"), **"vaga aberta"** se não há prefeito; "e mais N no Congresso".
7. `.cp-ac › .duo`: `btn.mini` **"ranking"** · **"ver no mapa"**.
8. `details.cp-det` **"moradores e lojas"**: linha do parceiro de saúde, linha da obra, linha das lojas, `btn` **"coloque seu negócio aqui"**, `top5` **"vereadores (N de 20)"** (lista `linhaPessoa`: posição · [SIGLA ]@x · pontos; vazio: **"ninguém ainda: comenta e pontua pra entrar na Câmara"**), `details` **"todos os moradores (N)"** (lista rolável com **"mostrar mais (N)"** de 50 em 50; se n > 12, busca "buscar @ nesta cidade").
9. (FRASES) citação do prefeito: `.fr-q` com a frase + botão "prefeito @x".

**Legado (`corpoCidadeP`, sem CV v3)**: bandeira + nome; chip UF (cor do estado) + nome do estado; `stats` 4 caixas: "pontos da semana", "morador(es)", "#N em UF", "#N no Brasil"; `leg2` **"guerra de cidades: #N entre as M cidades de UF"**; linhas: cargos acima de prefeito da cidade (presidente/senador/governador/deputado), **prefeito** (@ + "N pontos" ou **"vaga aberta"**), vice-prefeito (SIMPLES), **fundador**; parceiro de saúde; extras; `btn.mini.rkgo` **"ranking de <Cidade>"**; vereadores; todos os moradores; `btn.prim` **"ver no mapa"**.

**V1 (sem PD)**: stats "casas", "prédios", "#q no Brasil", "#r em UF"; barra "próxima conquista"; "fundador de X", "governador de UF"; "ver no mapa".

### 4.8 Cartão do estado (`corpoEstadoP`)

`.cart.estado`: nome; chip UF + **"N casas em M cidades"**; `stats`: "pontos da semana", "#r guerra de estados", "N deputado(s)", "N moradores"; `leg2`: **"<UF líder> lidera com N pontos: faltam X pro UF passar"** ou **"UF lidera a guerra de estados"**; `btn.mini.rkgo` **"ranking de UF"**; linhas **governador** (@ + pontos ou "vaga aberta"), **vice-governador** (SIMPLES); `top5` **"deputados (N): os 5 mais fortes"** (vazio: **"bancada vazia"**); (FRASES) citação do governador; `btn.prim` **"ver no mapa"** (→ `voarEstado`).

V1: "governador" (`D.g`: fundador da maior cidade) + sub "Cidade · N casas"; "vice" = fundador da 2ª cidade + "faltam N pra virar governador"; "sem vice ainda: só tem 1 cidade no estado"; "maiores cidades" top 5.

### 4.9 Compartilhar

`compartilhar(h, texto)`: `navigator.share({title:'minha casa no @naoeummapa', text, url: urlDe(h)})`; cancelado (AbortError) → nada; sem share → clipboard + `toast('link copiado')`; fallback `execCommand('copy')`; último recurso `prompt('copia o link:', url)`. Texto padrão: **"achei minha casa no mapa do @naoeummapa"**.

---

## 5. Pontos, níveis, cargos e temporadas

### 5.1 Decodificação de `D.P`

```
w = [2, 2, 3]                 // largura (chars base36) de t, s, e
PTOT[gi] = parseInt(P.t.substr(gi*2, 2), 36)   sobrescrito por P.xt[gi] (exceções acima de 1295)
PSEM[gi] = parseInt(P.s.substr(gi*2, 2), 36)   sobrescrito por P.xs[gi]
PEMM[gi] = parseInt(P.e.substr(gi*3, 3), 36);  se ≠ 0 → += P.b   (minuto unix de criação da casa; 0 = desconhecido)
NVA[gi]  = max(nivelDe(PTOT[gi]) + 1, parseInt(P.v[gi], 36) || 1)   // P.v = piso: o nível nunca diminui
cargo    = P.c[gi]  ∈ {P,S,G,D,M,V,' '}  (espaço = morador)
nivelDe(t) = maior i com t >= P.niv[i]
```
`P.mand = 2`, `P.ini = 1792368000` (dom 18/10/2026 21:00 BRT), `P.fim = 1793577600` (dom 01/11/2026 21:00 BRT), `P.ger` = unix da geração. `PD.b = 29862719` (base dos minutos).

### 5.2 Tabela de níveis (50) — `P.niv` → `P.nn`

| Nível | Pontos (temporada) | Casa | Nível | Pontos | Casa |
|---|---|---|---|---|---|
| 1 | 0 | casinha | 26 | 2500 | torre jardim |
| 2 | 15 | sobrado | 27 | 2700 | torre de esferas |
| 3 | 25 | casa alta | 28 | 2950 | pirâmide de vidro |
| 4 | 45 | mansão | 29 | 3150 | torre espiral |
| 5 | 75 | torre | 30 | 3350 | base de foguete |
| 6 | 110 | prédio | 31 | 3600 | torre de saturno |
| 7 | 150 | edifício | 32 | 3850 | art déco |
| 8 | 210 | arranha-céu | 33 | 4100 | torre solar |
| 9 | 270 | torre de vidro | 34 | 4350 | cidade vertical |
| 10 | 330 | torre com heliponto | 35 | 4650 | torre do disco |
| 11 | 410 | torre de luxo | 36 | 4900 | torre neon |
| 12 | 490 | megatorre | 37 | 5200 | torre arco-íris |
| 13 | 590 | torre dourada | 38 | 5500 | castelo nas nuvens |
| 14 | 690 | torre de diamante | 39 | 5800 | ilha flutuante |
| 15 | 790 | o topo do mapa | 40 | 6100 | agulha |
| 16 | 910 | castelo | 41 | 6400 | cristal de ametista |
| 17 | 1050 | farol | 42 | 6700 | zigurate dourado |
| 18 | 1150 | torre do relógio | 43 | 7100 | safira |
| 19 | 1300 | pagode | 44 | 7400 | portal |
| 20 | 1450 | torre de TV | 45 | 7800 | torre tesla |
| 21 | 1600 | torres gêmeas | 46 | 8100 | esmeralda |
| 22 | 1750 | torre de ferro | 47 | 8500 | palácio de cristal |
| 23 | 1950 | coroa de concreto | 48 | 8800 | nave-mãe |
| 24 | 2150 | prédio onda | 49 | 9200 | coroa do Brasil |
| 25 | 2300 | torre torcida | 50 | 9600 | o topo do Brasil |

Cada nível tem um ícone 32×32 (`<symbol id="csN">`, sprite injetado por ranking.js; `casaIco(n)` usa `<use href="#csN">`), e um desenho 3D (módulo do mapa). Dica de UI: níveis 1-5 usam alturas de telhado 1,15/1,85/2,4/1,7/2,9 km; do 6 em diante `nv*0.55+0.4`.

### 5.3 Pontos: regras vigentes (v4, desde dom 18/10/2026 21h)

| Ação | Pontos | Limite |
|---|---|---|
| ter casa (comentar a cidade) | 10 (uma vez; recomeça com 10 na temporada nova) | — |
| comentar num post (1º comentário) | +5 | 1 por post; comentar + marcar: teto 100/dia |
| marcar amigo sem casa | +1 | até 5 por post; conta no teto de 100/dia |
| amigo marcado entra no mapa (recrutou) | +50 | até 20 por semana; vale pro 1º que marcou |
| story marcando a página | +30 | 1 por dia; "em alta" por 24 h |
| voto recebido | +5 ou mais (5 + ofensiva de quem vota) | 1 voto/hora/cargo por eleitor |
| Reel no direct | +20 | 1 vez por Reel, até 3 por dia |
| seguir loja do mapa | +30 (texto do site) / +100 (botão do cartão da loja, `D.LC.s`) | até 15 por dia; 1 vez por loja |
| marcar o @ de uma loja | +10 (após 18/10; antes +30; `D.LC.p = 30` ainda no dado) | 1 vez por loja |
| missão da cidade | +5 por área (ex. "💧 missão água") | 1 vez por área a cada 12 h |

Comentário repetido não soma mais (era +1 na v3). Pontos entram "em até 20 min" (a ponte refaz os dados).

### 5.4 Ofensiva (fogo) do voto

`C` = número de horas-relógio distintas em que o eleitor teve voto aceito na semana. Voto vale `5 + C − (1 se a hora atual já contou)`. Zera domingo 21h (fim do mandato). Dados: `ofensiva.json {ligada, base:5, mandato, p:{@:[C, vale, votos, hora]}}` + `nem_of` local (otimista, `{h, m, C, hora}`). Estados visuais `nova|aceso|quente` (≥ 10 = `.hot`). Cartão no topo: "seu voto vale +X · cada voto sobe 1 · próximo voto em N min · zera domingo 21h"; ao votar: celebração "+X → próximo vale +X+1".

### 5.5 Cargos e quem manda

- Pontos da **semana** (`PSEM`) definem o cargo; pontos da **temporada** (`PTOT`) definem o nível da casa.
- Ordenação universal `maior(a,b)`: `PSEM` desc → `PEMM` asc (casa mais antiga ganha; 0 = sem data vai pro fim) → `gi` asc.
- Vagas: 1 presidente (Brasil), 49 senadores, 1 governador por UF, deputados = bancada real da UF (SP 70, MG 53, RJ 46…), 1 prefeito por cidade, 20 vereadores por cidade. Cada pessoa tem só o cargo mais alto; quem sobe abre vaga embaixo. Cargos são calculados no build e vêm prontos em `P.c`; o cliente só deriva listas: `PRESI`, `SENI[]` (ordenados por `maior`), `GOVI[uf]`, `DEPI[uf][]`, `c.pref` (prefeito), vereadores = membros com 'V'.
- Vice (SIMPLES, derivado): cidade = 2º da cidade sem cargo acima de vereador; estado = 2º do estado tirando P e S; Brasil = 1º senador; suplentes de senador = os 10 seguintes ao 49º.
- Mandato/temporada: `P.ini`→`P.fim` (2 semanas na temporada 2); textos dizem **"domingo 21h fecha a semana"**; a virada zera pontos da semana e cargos; casa, nível e selo de fundador ficam. "Mandato" fechado gera `hm/` (histórico) e `selos/`.
- Agregados por cidade: `c.ps` (soma PSEM), `c.pt`, `c.rUFp`, `c.rBRp` (posição por pontos), `c.pri` (prioridade de rótulo). Por UF: `e.ps`, `e.pt`, `e.nres`, `e.rp` (guerra de estados).
- Rótulos de cargo: `rotCargo` (longo: "Presidente do Brasil", "Senador", "Governador de UF", "Deputado de UF", "Prefeito de Cidade", "Vereador de Cidade"); `CGI`/`CGSIGLA` (PRES, SEN, GOV, DEP, PREF, VER); `GLIFO` no mapa (V = vazio).

### 5.6 Temporada 1 e rewind (`rewind.js`)

- Roda só depois de `FIM_T1 = 1792368000e3`, 1 vez por aparelho (`nem_rewind_t1b`), ou com `?rewind=1`. Espera `html.pronto` (até 20 s).
- Dados: `rewind/geral.json` (`numeros{moradores, cidades, comentarios, views, votos, marcacoes, recrutados, stories, topo}`, `nomesNiveis[]`, `presidente{h, cidade, uf, pts}`, `governadores[{ufg,h,pts}]`, `cargos{senadores,deputados,prefeitos,vereadores}`, `curiosidades{aperto, diaRecorde, maiorCidade, cidadeMaisPontos}`) e `rewind/p/<índice da 1ª letra da chave no alfabeto base64>.json` → `{chave: [pts, nv, cargo, posBR, posUF, posCid, nUF, nCid, cidade, sigla, fund, casa, posts, extras, marcou, recrutou, stories, votos]}`. O @ nunca aparece em texto; a chave é `Hash.chave(@)`.
- Player tipo "stories": barras no topo (7 s por card, último fica), toque à direita/esquerda avança/volta (30% da largura), segurar pausa, setas e Esc. Cards (cores `c-ceu/c-y/c-verde/c-azul/c-roxo/c-branco`): 1 abertura ("rewind" / "temporada 1" / "acabou." + texto; sem @: form "seu @" + "ver meu rewind" → "procurando…" / "não achei esse @"); 2 pontos e casa ("sua casa chegou ao nível N: <nome>. e o nível fica na temporada 2.", pílula "fundador de X para sempre"); 3 posições (cidade/UF/Brasil com "top N%") e cargo ("você foi eleito <cargo>!" ou "sem cargo dessa vez…"); 4 "de onde vieram seus pontos" (barra + lista); 5 "o Brasil da temporada 1" (4 números + linha); 6 "a 1ª eleição do mapa" (presidente, 3 governadores, totais de cargos); 7 "coisas que só aconteceram aqui" (até 4 curiosidades); 8 "papo reto · o Instagram mudou o jogo"; 9 "temporada 2 · o que vale ponto agora" (tabela de regras); 10 "o que vem por aí · o jogo acontece aqui dentro" (4 itens); 11 "temporada 2 · valendo." com botões **"ver ranking"** (→ `#ranking`), **"ver minha casa"**/"explorar o mapa", caixa "+50 por amigo…" com **"copiar a chamada"** (→ "copiado: manda pro amigo ✓"), "curtiu? manda o Reel do @naoeummapa pra um amigo."

---

## 6. `window.__DADOS` — decodificação completa

Arquivo `dados.js` (~4,6 MB), um único `window.__DADOS = {…};` seguido de `window.NEG_CFG = {…};` e das flags. Gerado por `build.mjs`.

| Chave | Tipo | Significado | Decodificação |
|---|---|---|---|
| `v` | int (3) | versão do formato | — |
| `dia` | int (12) | dia do projeto (semente do layout, `finalizarLayout({dia})`) | — |
| `geradoEm` | ISO string | quando o build rodou | — |
| `n` | int | número de moradores (NM) | igual a `u.split('\n').length` |
| `u` | string | todos os @ normalizados, um por linha, agrupados por cidade na ordem de `c`; o 1º de cada cidade é o fundador | `USR = u.split('\n')`; `gi` = índice |
| `p` | string base64 | bitmap "casa provisória" (1 bit por gi, LSB primeiro dentro do byte) | `ehProv(gi) = (bytes[gi>>3] >> (gi&7)) & 1` |
| `c` | array `[ibge, n, fundador]` | cidades com casa, na ordem de `u`; `n` = quantas casas; índice inicial `ini` = soma dos `n` anteriores | `POR_IBGE`, `CID_DE[gi]`, `LISTA` |
| `m` | array `[ibge, nome, uf, lat, lon]` | todos os 5 509 municípios (base IBGE), para nome/UF e para o funil de negócio | `MUN_ID = Map(ibge → m)` (vem de `MUNIS` no engine; `D.m` é a cópia servida) |
| `k` | Int array, 3 por cidade (ordem de `c`) | `[cx*10, cy*10, rs*10]`: centro (km, no plano do mapa) e raio canônico da cidade | `/10` |
| `e` | obj por UF `{n, k, x, y, f}` | nome do estado, índice da cor em `pal`, centro do rótulo (km), folga | `COR_UF[uf] = pal[e.k]` |
| `g` | obj por UF `{h, c, n, v, vn}` | governador V1 = fundador da maior cidade (`h`), cidade (`c`), casas (`n`), vice-cidade (`v`) e casas dela (`vn`) | usado só no fallback sem `P` |
| `pal` | 8 cores | paleta das UFs: `#FFD23F #FF7F6B #4FB7F0 #B58CFF #FF9F2E #47D4A7 #FF8BC2 #FFFFFF` | — |
| `P` | obj | pontos/níveis/cargos (§5.1): `w, t, s, e, v, c, xt, xs, b, niv, nn, mand, ini, fim, ger` | strings posicionais base36 |
| `F` | obj `{m, c, p, k, app, s}` | parceria de saúde: @ da marca, cupom, pontos `[5,1,3,30]`, título do cargo ("Secretário de Saúde …"), link da app, `s = [[ibge, @secretário, n, nível]]` | módulo figo.js |
| `S` | array `[gi, fimUnixSeg]` | buff "em alta no story" (24 h após o story) | `AL = Map(gi → fim*1000)` |
| `O` | array `[ibge, id, nome, metaAtual, metaTotal]` (30) | obras/marcos das cidades (ex.: monumentos) | obras-mapa.js |
| `L` | array (97) `[id, @, nome, tipo, ibge, cor, iniISO, fimISO, categoria, {d, w, l, e}]` | lojas patrocinadas: descrição `d`, WhatsApp `w`, link `l`, estágio `e` | lojas.js; vigente se `ini <= hoje <= fim` (hoje em BRT) |
| `CV` | obj `{v:3, a:[áreas], o:[[id, nome, área, custo, nível]×25], f:[0.5, 4], c:[[ibge, [pa,pi,ps], máscaraProntas, [ka,ki,ks], [ga,gi,gs], prefeitoGi]]}` | "a cidade cresce": pontos por área na semana, obras prontas (bitmask de 25), obra em andamento por área (`k`) e progresso (`g`) | cidade-nivel.js / cidade-painel.js |
| `FR` | obj `{@: frase}` | frases oficiais (só de quem tem cargo) | `Frases.de(h)` |
| `PT` | obj `{a:[gi], v:[gi], y:[gi]}` | cor do partido (azul/vermelho/amarelo) por gi — formato compacto | `Partidos.letra(h)` |
| `VF` | array de @ | quem já verificou pelo direct | `Frases.verificado` |
| `LC` | `{p:30, s:100, t:{12 tipos}}` | pontos por marcar/seguir loja e nomes das categorias | lojas-hub |

`window.NEG_CFG` (ver 1.14). `window.EVENTO_SITE` (opcional, `{ini, fim, txt}`) para a faixa de evento.

Arquivos laterais (carregados sob demanda, sempre com `?v=<hash do meta>`): `poder.json` (§4.5), `numeros.json` (aba DADOS, removida da barra), `ev/<gi>>11>.json`, `hm/<k>.json`, `selos/<k>.json`, `eleicao.json` (`pessoas{@:[recebidos, dados, horas]}`, placar), `ofensiva.json`, `missoes.json`, `cidades-t3.json`, `rewind/*.json`. Particionamento por `gi >> 11` (2 048 moradores por arquivo).

---

## 7. Design system (de `style.css`)

### 7.1 Tokens

| Token | Valor | Uso |
|---|---|---|
| `--ink` | `#1e2430` | tinta: texto, bordas, sombras duras, toast |
| `--muted` | `#5d6b7e` | texto secundário |
| `--mudo` | `#4d5a6c` | secundário T3 (mais escuro) |
| `--y` | `#FFD23F` | amarelo primário (botões `prim`, aba ativa, destaques) |
| `--y2` | `#b88f00` | borda tracejada de notas amarelas |
| `--sea` | `#acdaf2` | fundo html/body (mar) |
| `--sky` | `#e2e9ea` | — |
| `--pad` | `14px` | gutter lateral |
| `--tabb` | `calc(72px + env(safe-area-inset-bottom))` | altura reservada da tabbar |
| `--card-sh` | `0 5px 0 rgba(30,36,48,.22)` | sombra dura leve (T3) |
| `--area-agua/infra/saude/seg/cidade` | `#6cc4f0 #ffb347 #72dca0 #9b7bff #FFD23F` | áreas da cidade |
| fundo do app | `linear-gradient(#b3d1ee, #e6ebea 55%, #cfe3c4)` | `#app`, `#carrega`, todos os painéis |
| cabeçalho de painel | `#b3d1ee` (+ sombra `0 5px 8px -3px rgba(30,36,48,.28)`) | sticky |
| cinzas de apoio | `#eef2f6` (fundo de chip neutro), `#f3f6f8` (stat), `#e6ebf0` (esqueleto), `#dfe6ee` (2º lugar), `#f2c299` (3º lugar), `#d5dce4` (tracejado de lista), `#9aa6b4` (placeholder) | |
| amarelos de apoio | `#fff2bd` (vereador/eu no ranking), `#fff6d6` (nota/destaque), `#ffe9a8` (provisória), `#fff8e1`, `#fff3bd`, `#fff4c4` | |
| verdes | `#78ad54`/`#3f7a1f`/`#e5f4dc` (ok), `#0d7a3a` (msg ok), `#c9f0b0` (feito), `#25D366` (WhatsApp), parceiro saúde `#1c3a19`/`#afe88e` | |
| vermelhos | `#b3261e`/`#a3261c` (erro), `#ff7f6b` (selo "+pts"), `#ef7b7b` | |
| laranja "em alta" | `linear-gradient(100deg, #ff7a1a, #ffb42e)`, `#fff0d9`, `#c4540a` | |
| azul "vice"/poder | `#3a5bd9`, `#e9f0ff`, `#eef4ff`, `#23409e` | |
| partidos | azul `#2f6fe0`, vermelho `#e0343a`, amarelo `#f5c400` | telhados e selos |
| cores de cargo | P/S/G: fundo `--ink` + texto `--y`; D/M: fundo `--y`; V: `#fff2bd`; morador: `#eef2f6` + `--muted` | `.selo`, `.cargo`, `.ec`, `.rt.mor`, `.selo-c` |
| escuro translúcido (ofensiva/reativa) | `rgba(14,17,22,.94)`, borda `#3a4250`, texto `#e9edf1`, link `#9cc3ff` | |

### 7.2 Tipografia

- Família: `'Nunito', system-ui, -apple-system, 'Segoe UI', sans-serif`; **peso 900 em tudo** (body, button, input, a). Pesos 800/700 só em textos corridos secundários (`.cs-c ul`, `.dica1`, `.ofe-s`, negócio).
- Suavização: `-webkit-font-smoothing: antialiased`; `text-size-adjust: 100%`; números em `font-variant-numeric: tabular-nums` nos placares.
- `.out`: texto branco com contorno preto feito por 48 `text-shadow` radiais (0,085em e 0,05em) — títulos dos painéis, "montando o mapa…", rewind.
- Tamanhos-chave: h1 `clamp(28px, 8.4vw, 40px)`; título de cartão `clamp(24px, 7.4vw, 32px)`; painel h1 34 px (como 30, negócio `clamp(22px,6.6vw,32px)`); corpo 16-17 px; secundário 13-14 px; micro 11-12,5 px; números-herói `clamp(44px,14vw,58px)` / `clamp(54px,17vw,84px)`; `.rw-mega clamp(64px,22vw,108px)`.
- Line-height apertado: 1,05-1,2 em títulos, 1,2-1,35 em parágrafos.
- Texto do rodapé sobre o mapa ganha halo branco: `text-shadow: 0 1px 0 rgba(255,255,255,.9), 0 0 6px rgba(255,255,255,.9)`.

### 7.3 Linguagem visual "cartoon"

- **Borda escura grossa** em tudo que é componente: 2,5 px (micro), 3-3,5 px (chips, botões mini, inputs), 4 px (botões, campo de busca, cartões médios), 5 px (`.cart`, `.bl`, blocos do como/negócio).
- **Sombra dura** (sem blur, deslocada para baixo): `0 2px 0` (pílulas pequenas), `0 3px 0` (mini), `0 4px 0` (botões redondos/zoom), `0 5px 0` (botões, campo, etiqueta), `0 6px 0` (toast, barra "você"), `0 8px 0 rgba(30,36,48,.35)` (cartão). Cor sempre `rgba(30,36,48,.3-.35)`.
- **Pressionar** = o elemento desce o valor da sombra: `transform: translateY(4px); box-shadow: 0 1px 0 …` em `:active` (3 px nos redondos, 2 px nos mini).
- **Raios**: pílula `999px` (botões, campo, chips, selos, barras); cartão 30 px (26 em telas baixas); blocos 18-24 px; chips quadrados 12-16 px; stat 16 px; `.cp` tabela/trilho 10-14 px.
- **Foco**: `outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 6px var(--ink)` em botões; inputs `box-shadow: 0 0 0 3px var(--y)` (campo de busca mantém a sombra dura + anel amarelo).
- Sem emoji na interface (T3): ícones SVG 24×24 traço 2,1 `currentColor` (`icoSvg`, `.ico`, `.cs-ic`, `.mi-svg`, tabbar). Casas em sprite 32×32 com `stroke #1e2430 1.8`.
- Nunca link sublinhado: tudo que é ação vira pílula (`:is(.lk, .rk-gap, .eu-nao, …)`), e nomes clicáveis de pessoa/cidade dentro do cartão são **negrito + seta** (`::after` com máscara SVG de chevron, opacidade 0,55).

### 7.4 Componentes

| Componente | Especificação |
|---|---|
| `.btn` | inline-flex, 52 px alto, raio 999, borda 4 px, fundo branco, 17 px, sombra 5 px. `.prim` amarelo. `.mini`: 36 px, 13,5 px, borda 3,5, sombra 3 px, amarelo, nowrap. `.btn.mais/.mais2`: 34 px, branco, sem sombra. `:active` desce 4 px |
| `.campo` (busca) | 46 px, borda 4, raio 999, branco, sombra 5; `.at` "@" 21 px muted; `#q` 18 px sem borda; `#ir` 46 px amarelo |
| `.fechar` (X) | 40 px redondo (44 nos painéis), borda 3, branco, SVG 16 px traço 3; área de toque +4 px invisível |
| `#ctrl button` | 44 px redondos, borda 3, sombra 4 |
| `.cart` | branco, borda 5, raio 30, sombra 8, padding 14/16/16, `max-width 470`, animação `sobe` (translateY 40 → 0, scale .97 → 1, 0,45 s `cubic-bezier(.2,1.3,.4,1)`); rola por dentro |
| `.pill` | amarelo, raio 999, padding 1/12/3, `.78em`; `.prov` `#ffe9a8` tracejada `--y2`; `.vice` azul; `.ministro` verde |
| `.chip` (UF) | borda 3, raio 999, `.86em`, fundo = cor da UF |
| `.selo` (cargo) | borda 3, raio 999, 15 px, cores por cargo (7.1) |
| `.selo-c` (ranking) | 10,5 px, letter-spacing .03em, borda 2,5 |
| `.stats/.stat` | grid 4 col gap 6; `.stat` `#f3f6f8`, borda 3, raio 16, `b` `min(19px, 4.4vw)`, `span` 11,5 muted |
| `.linhas/.lin` | grid gap 7; linha flex 16 px min 38 px; `.rot` muted; `.val` à direita; `.nn` 13 px muted |
| `.lin2` (linha de lista) | flex, `border-top 2px dashed #d5dce4`, `.pos` bolinha 22 px amarela borda 2,5, `.nm` reticências, `.nn` muted |
| `.rola` | caixa rolável 168 px (120 na cidade), borda 3, raio 16, `#fafcfd` |
| `.busca-in` | 40 px, borda 3, raio 999, 16 px, foco anel amarelo |
| `.barra` (progresso) | 16 px, borda 3, raio 999; `i` amarelo com `border-right 3` e `transition width .9s cubic-bezier(.2,.9,.3,1) .25s` |
| `.pilha` | 30 px, borda 3,5, segmentos com `border-right 3`; `.carr` esqueleto `brilha` 1,1 s |
| `.degraus/.deg` | grid `--n` colunas; degrau raio 16, ícone 36 px (44 no atual); `.atual` amarelo borda ink sombra 4; `.feito` branco borda `#cfd7e1`; `.falta` opacidade .45 + grayscale; `.trilho` 10 px |
| `.trio/.tt` | 3 caixas `#f3f6f8` borda 3,5 raio 18 sombra 4; `.te` uppercase 12 px; `.tn` `clamp(25px,7.6vw,32px)`; `.tf` caixa amarela-clara borda 2 `--y2` (ok: verde) |
| `.acao` | borda 3,5 raio 18 branco; `.dica` `#fff6d6` + anel amarelo 3 px + fita escura "faz agora"; `.vale` pílula amarela 18 px (stories/recrutou: escura, 21 px) |
| `.bk > header` | h3 17 px + span 12,5 muted à direita |
| `.disp` | amarelo, borda 3,5, raio 18; `.topo` escuro com texto amarelo |
| `.nota` / `.loja-ganha` / `.fh-aviso` | `#fff6d6`, `border 3px dashed --y2`, raio 16, texto `#6b5200` |
| `.etq` (etiqueta da casa) | pílula branca borda 4 sombra 5, seta de 14 px rotacionada embaixo, `.etq-h` 19 px, `.etq-c` 13 px muted, fade .25 s |
| `.rt` (rótulo do mapa) | texto `.out`-like via `--f1/--f2`; `.rt.mor` pílula branca borda 2,5 12 px sombra 2 (fundos por cargo) |
| `#selring` | anel amarelo 4 px com contorno ink 3 px dentro e fora, `pulsa` 1,4 s |
| `#toast` | ink, branco, raio 999, 17 px, sombra 6 |
| `#sug` | lista branca borda 4 raio 22 sombra 5, `max-height 46vh`; item 17 px raio 16, hover/on `#fff2bd` |
| `#tabbar/.tab` | branco, `border-top 3.5`, raio 24 em cima, `box-shadow 0 -5px 0 rgba(30,36,48,.1)`, tab 56 px, ícone 24, rótulo 11,5 |
| `.rk` (linha do ranking T3) | grid `30px 34px 1fr auto`, 62 px, `border-top 2px solid #eef2f6`; `.p1/.p2/.p3` bolinhas coloridas; `.eu` `#fff6cf` com faixa amarela interna 5 px; `.foco` `#eaf4ff` |
| `.rk-chefe` | botão amarelo largo (ícone 46 px, nome 21 px, pontos 24 px) |
| `.eu-bar` | caixa branca borda 3,5 raio 24 sticky no rodapé do ranking; `.eu-c` 3 chips com número 21 px |
| `.v3-*` (votar em 3 passos) | `.v3-campo` 58 px pílula com "@"; `.v3-prim` 56 px amarelo; `.v3-sec` 48 px branco; `.v3-quem` caixa `#f5f8fb` borda `#dbe3ec` raio 18 (expandida: amarela-clara); `.v3-op` opções raio 16; `.v3-check` 78 px redondo amarelo com traço animado; `.v3-bars` placar com trilhos 12 px |
| `.pf-q` (quadradinhos do perfil) | `aspect-ratio 1`, borda 3, raio 18, sombra 3; fundos `#fff3bd` (casa), `#e4f0ff` (T1), `#ffe6d2` (fogo; `.hot` `#ffd2ad`); número `clamp(24px,7.4vw,30px)` |
| `.voto-ult .vu` | tabela 12,5 px, caption uppercase 11 px, colunas 46/29/25 % |
| `.story-big` | botão amarelo largo 56 px raio 22 borda 4 sombra 5; `.outro` branco 44 px |
| `.alta-selo` | gradiente laranja, borda 4, raio 20, chama animada `chama` |
| `.convite` | flutuante amarelo largura do topo, raio 22, anima `convite` |
| `.reativa`/`.ofe`/`.ofe-pop` | caixas escuras translúcidas (7.1), botão amarelo sem borda raio 12/999 |
| `.app-dica` | fixa embaixo, branca borda 4 raio 20 sombra 8, `bottom: --tabb + 10px` |
| `.rw-*` (rewind) | overlay `rgba(30,36,48,.94)` z 1000; card borda 5 raio 30 sombra 8 padding 70/22/26; barras 5 px; botões 52 px (`.prim` escuro com texto amarelo) |
| negócio/ficha `.ng-*`/`.fh-*` | folha branca borda 5 raio 30 sombra 8; inputs 48 px borda 4 raio 16 18 px; textarea 110 px; chips raio 999; passos bolinhas 14 px |

### 7.5 Animações

| Nome | O quê |
|---|---|
| `sobe` | cartão entra (0,45 s mola) |
| `gira` | spinner 0,8 s |
| `pulsa` | anel da cidade (opacidade .55 no meio, 1,4 s) |
| `anel` | "?" novo: anel expandindo 1,6 s |
| `brilha` | esqueleto (gradiente deslizando 1,1 s) |
| `pulsaRk` | linha do ranking destacada (1,7 s, uma vez) |
| `chama` / `pfchama` | chama oscilando (scale/rotate alternado 1,1 s) |
| `convite` | entra de cima (.5 s mola) |
| `ljPulso`, `ljAnel`, `ljPonto` | selo "+pts" das lojas (2,1 s / 1,6 s) |
| `ofeFlick`, `ofeGlow`, `ofeEntra`, `ofePulsa`, `ofeFumo`, `ofePopFogo` | fogo da ofensiva |
| `v3Entra`, `v3Pop`, `v3Traco` | votar em 3 passos |
| `ng-sobe` | folhas de negócio/ficha |
| `rwEntra`, `rwSai`, `rwCard`, `rwPula`, `rwPisca`, `rwSobe`, `rwCresce` | rewind |
| JS `mola(fn, k, c)` | contadores (`counta`), barras da composição, escada — não usam CSS ease |

`@media (prefers-reduced-motion: reduce)` desliga todas (cartão, spinner 2 s, barras sem transição, rewind, ofensiva, tabbar).

### 7.6 Breakpoints e layout

| Condição | Ajustes |
|---|---|
| `min-width: 700px` | cartão encosta à esquerda (`left: --pad`), rodapé alinhado à esquerda, `#ctrl` à direita |
| `min-width: 641px` | tabbar com 480 px centrada e bordas laterais; `.ofe` 64 px de fogo |
| `max-width: 640px` | `#ctrl` invisível com cartão aberto; rodapé `align-items: stretch` com totais à esquerda |
| `max-width: 560px` | abas "quatro" ocupam a largura toda |
| `max-width: 520px` | rodapé antigo em grade 3×2 |
| `max-width: 480px` | `#form` ocupa `100% − 52px` (espaço do "?"), `#ajuda` sobe 2 px |
| `max-width: 380px` | ranking mais compacto (ícone 26, pontos 18), `#ajuda` 38 px |
| `max-width: 340/360px` | rodapé antigo mais apertado |
| `max-height: 740px` | h1 maior relativo, campo 48 px, cartão padding 10/14/12 raio 26, fontes −1/−2 px, `.ofe` menor |
| `max-height: 700px` | rewind compacto (card padding 56/16/16, regras 13 px, botões 44) |

- Safe-area: `env(safe-area-inset-top/right/bottom/left)` no topo, rodapé, cartão, tabbar, cabeçalhos sticky, toast, app-dica, rewind.
- `html, body {overflow: hidden; overscroll-behavior: none}`; `#app {position: fixed; inset: 0; height: 100dvh}`; painéis com `overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch`; cartão e `.rola` rolam por dentro com `scrollbar-width: none`.
- Canvas: `touch-action: none; cursor: grab/grabbing; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent`.
- Alvos de toque ≥ 44 px: `::after` invisíveis em `.negtopo`, `.priv`, `.fechar`, `.negbtn`, `#ajuda`; `#cartao .lk {padding-block:10px; margin-block:-10px}`.
- z-index: `#camada` 3, `#carrega` 3, `#rodape` 4, `#topo/#ctrl` 5, `#cartao` 6, `.convite` 8, `#toast` 9 (20 com painel), painéis 12-15, `#tabbar` 18, `.ofe-pop` 25, `#semjs` 30, `.app-dica` 40, `.rw` 1000.
- Modo escuro: **não existe** (sem `prefers-color-scheme`); cartões escuros são só destaques (`.disp.topo`, `.cs-c.esc`, `.reativa`, `.ofe`, selos P/S/G).

---

## 8. PWA

- `manifest.webmanifest`: `name` "Não É Um Mapa", `short_name` "mapa", `description` (igual à meta), `lang` pt-BR, `start_url` `/?app=1`, `scope` `/`, `display` standalone, `orientation` portrait, `background_color` `#acdaf2`, `theme_color` `#FFD23F`; ícones `/icones/icone-192.png` (any), `/icones/icone-512.png` (any) e `/icones/icone-512.png` (maskable).
- `<head>`: `<link rel=manifest>`, `apple-touch-icon` `/icones/apple-touch-icon.png`, `apple-mobile-web-app-capable`/`mobile-web-app-capable` yes, `apple-mobile-web-app-title` "mapa", status bar `default`, `theme-color` `#b3d1ee` (difere do manifest), favicon SVG inline (quadrado verde `#78ad54` raio 8 com casinha branca contornada).
- Sem service worker (nada de cache offline).
- Detecção: `emApp() = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true`. `?app=1` não é lido pelo código; a visita manda `p:1` quando em app (só com SIMPLES).
- Dica "vira app" (`dicaApp`, SIMPLES): caixa `.app-dica` fixa embaixo: **"vira app"** · " · o mapa na sua tela inicial, em tela cheia, a 1 toque de votar"; com `beforeinstallprompt` guardado → botão **"instalar"** (chama `prompt()`); senão instrução: no Instagram "abra no navegador (⋯ → abrir no navegador) e depois: compartilhar → adicionar à tela inicial"; iOS 'toque em compartilhar e depois em "adicionar à tela inicial"'; outros 'no menu do navegador (⋮), toque em "instalar app" ou "adicionar à tela inicial"'. Aparece 1 vez por aparelho (`nem_app_dica`) 3,8 s depois do 1º voto (evento `nem:votou`) e sob demanda no "como funciona" (botão "como virar app"). Já em app: `toast('você já está no app')`.
- SEO: `title` "Não É Um Mapa · o jogo do Brasil virtual · veja sua casa"; `description` "Não É Um Mapa é o jogo do Brasil virtual: comenta sua cidade no @naoeummapa, ganha sua casa e vira prefeito. Digita seu @ e o mapa voa até a sua casa."; canonical `https://naoeummapa.app/`; OG site_name/title/description/type website/url/locale pt_BR/image `og.jpg` 1200×630 (alt "Não É Um Mapa: o Brasil virtual com a casa de cada jogador"); twitter `summary_large_image`; JSON-LD `WebSite` com `alternateName` ["naoeummapa", "Nao E Um Mapa", "@naoeummapa"]. `robots.txt` libera tudo (bots da Meta explícitos) e bloqueia `/v/`, `/api/`, `/ev/`, `/hm/`; `sitemap.xml` com `/` (1.0) e `/privacidade.html` (0.2).
- `privacidade.html` (resumo): página estática no mesmo estilo (cartão branco borda 4, tag amarela "Não É Um Mapa · @naoeummapa", h1 "Política de privacidade", "Atualizada em 15 de outubro de 2026"). Seções: **O que a gente usa** (comentários públicos: @, texto, data/hora, curtidas; dele só cidade/UF ou obra sugerida; DMs com a cidade valem como comentário; stories que marcam a página só o fato; total de seguidores); **O que a gente NÃO usa** (senha, e-mail, telefone, fotos, localização, seguidores, curtidas; "Não escreva endereço, telefone ou chave Pix"; "Casa e cargo no mapa não se compram"; sem anúncios nem cookies; Vercel Web Analytics anônimo); **Para que serve** (montar o mapa, fundador, governador, pontos e cargos; "É um jogo: os cargos são de brincadeira"); **Onde o seu @ aparece** (mapa público, vídeos); **Com quem a gente compartilha** (ninguém; API oficial do Instagram/Termos Meta); **Por quanto tempo** (enquanto o projeto existir ou até pedir); **Quero tirar minha casa** (link "Excluir meus dados"); **Contato** (DM @naoeummapa); botão "← voltar pro mapa".

---

## 9. Chaves de `localStorage`

| Chave | Conteúdo | Quem |
|---|---|---|
| `nem_eu` | @ normalizado do "quem sou eu" (ranking/textos) | ranking.js, rewind, link mágico |
| `voto_eu` | @ do eleitor (quem vota; frase/cor; Minha Casa) | poder.js, eleicao.js, frase-ui |
| `voto_sid` | id do aparelho `[a-z0-9]{8,16}` para `/api/voto` e `/api/frase` | poder.js |
| `voto_ultimo` | `{ver|pref|dep|gov|sen|pres: {ts, a}}` último voto por cargo (espera de 1 h) | poder.js |
| `nem_viu_como` | `'1'` depois de abrir "como funciona" (tira o anel do "?") | ranking.js |
| `nem_seg` | `{'@|lojaId': 1}` lojas seguidas | lojas-mapa/hub |
| `nem_cv` | `{ib, m}` máscara de obras vista por último (detecta obra nova) | cidade-nivel |
| `nem_dec` | `{ib, t, …}` decisão otimista do prefeito (3 h) | cidade-nivel |
| `nem_ult` | timestamp da última visita | eleicao.js |
| `nem_reativa1` | timestamp em que o cartão "voltou" foi mostrado (1 vez) | eleicao.js |
| `nem_vid` | id anônimo de visita | eleicao.js |
| `nem_s1pos` | `{h, p, t}` posição na cidade na última visita | eleicao.js (fila) |
| `nem_app_dica` | timestamp da dica "vira app" | eleicao.js |
| `nem_of` / `nem_ofx` | ofensiva otimista `{h, m, C, hora}` / auxiliar | ofensiva.js |
| `nem_mis2` | `{h, l:[ts…]}` missões feitas (janela 12 h) | missoes.js |
| `nem_mis_ult` | `{}` última janela por área | missoes.js |
| `nem_mis_pend` | `[…]` missões pendentes de confirmação | missoes.js |
| `nem_frase` | `{h, t, ts}` frase otimista (3 h) | frases.js |
| `nem_cor` | `{h, c:'a'|'v'|'y', ts}` cor otimista (3 h) | frases.js |
| `nem_prova` | `{h, p, ts}` prova do link mágico | frases.js |
| `nem_verif_novo` | `'1'` até o site comemorar a verificação | frases.js / frase-ui |
| `nem_rewind_t1b` | timestamp: rewind da T1 já visto | rewind.js |
| `neg_rascunho_v1` | rascunho do pedido de negócio | negocio.js |
| `neg_rascunho_v1_enviado` | `{codigo, …}` pedido enviado | negocio.js |
| `neg_rascunho_v1_zap` | estado do passo WhatsApp | negocio.js |
| `neg_sid` | id do aparelho para o funil `/api/neg-ev` | negocio.js |
| `neg_ficha_enviada` | `[códigos]` (últimos 20) fichas enviadas | ficha.js |

Todo acesso é embrulhado em `try/catch` (modo privado / storage bloqueado não quebra nada). Evento `storage` sincroniza `voto_eu`/`nem_eu` (ofensiva) e `nem_frase`/`nem_cor` (frase-ui) entre abas.

---

## 10. Textos pt-BR de interface (strings) — site.js, poder.js, rewind.js, body.html, ficha.js

**Topo / busca / rodapé**: "Não É Um Mapa" · "seu @ ou cidade" · "achar" · "Busca por @ do Instagram, cidade ou estado" · "como funciona: pontos, casas e cargos" · "registrar meu negócio na minha cidade" · "aproximar" · "afastar" · "Brasil inteiro" · "Zoom do mapa" · "Detalhes" · "N casas em M cidades" · "seu negócio no mapa" · "privacidade" · "seguir @naoeummapa" · "navegação principal" · "montando o mapa…" · "esse mapa precisa de JavaScript ligado" · "recarregando o mapa…" · "digita um @, cidade ou estado" · "escreva o seu @ na busca para achar a sua casa".

**Tabbar (rótulo · aria)**: "Minha Casa" · "minha casa: sua cor, sua frase e sua casa no mapa" / "Votar" · "votar: seus votos desta hora e o placar" / "Minha cidade" · "minha cidade" / "Eleições" · "eleições: vote nesta hora e veja a apuração" / "Ranking" · "ranking: sua posição na cidade, no estado e no Brasil" / "Lojas" · "lojas patrocinadas: visite e ganhe pontos".

**Painéis**: "lojas" · "contagem de votos" → "Ranking" · "como funciona" · "voltar pro mapa" · "fechar" · "Lojas patrocinadas: visite e ganhe pontos" · "Contagem de votos: sua posição na cidade, no estado e no Brasil" · "Como funciona: pontos, casas e cargos".

**Sugestões / avisos**: "estado · N casas" · "UF · N casas" · "Cidade · UF" · 'não achei "x"' · "comenta o nome da sua cidade no último post do @naoeummapa e ela aparece aqui." · "confere se o @ está igualzinho ao do Instagram (ou digita o nome de uma cidade ou estado)." · "essa cidade ainda não tem casa" · "ninguém comentou o nome dela no @naoeummapa ainda. comenta lá e vira o fundador!".

**Cartão da casa**: "casa provisória" · "você só disse o estado, então a casa ficou na capital. comenta o nome da sua cidade no último post e ela muda." · "nível N" · "casa de nível N" · "temporada 1" · "posição no Brasil na temporada 1" · "Nº de TOT no Brasil na temporada 1" · "sequência" · "sequência de fogo: horas seguidas votando nesta semana" · "em alta no story" · "até HHh · quem posta marcando @naoeummapa fica em alta por 24 h" · "posta sua casa no story" · "+30 e em alta por 24 h" · "gerar a imagem da casa de @x" · "ponto na semana" / "pontos na semana" · "N na temporada" · "+N a confirmar" · "morador de <Cidade>" · "fundador" · "ministro da <área>" · "vice-prefeito" / "vice-governador" / "vice-presidente" / "suplente de senador" · "ajudar <Cidade>" · "mais detalhes" · "casa criada em dd/mm às hh:mm" · "compartilhar" · "sou <cargo> no mapa do @naoeummapa. vem tentar tomar meu lugar" · "minha casa no mapa do @naoeummapa tem N pontos" · "achei minha casa no mapa do @naoeummapa" · "minha casa no @naoeummapa" · "link copiado" · "copia o link:" · "você!" · "em alta · @x".

**Cargos**: "Presidente do Brasil" · "Senador" · "Governador de UF" · "Deputado de UF" · "Prefeito de <Cidade>" · "Vereador de <Cidade>" · siglas PRES SEN GOV DEP PREF VER · "ex-presidente do Brasil" · "ex-senador" · "ex-governador de " · "ex-deputado de " · "ex-prefeito de " · "ex-vereador de " · "mandato N" · "morador no mandato N" · "fundador de X/UF" · "foi fundador de X/UF" · "cargo ao vivo: vale até domingo às 21h" · "sem cargo ainda · os pontos da semana decidem".

**Votar**: "votar em @x · +N" · "votar abre às 21h" · "escolha o cargo do voto" · "votar em vereador|prefeito|deputado|governador|senador|presidente" · "qual é o seu @?" · "votar" · "votando como @x" · "trocar" · "comenta a sua cidade num post do @naoeummapa para ganhar casa e poder votar" · "voto registrado · valeu +N · seu próximo voto de <cargo> libera às HH:MM · os pontos entram em até 20 min" · "não consegui registrar, tenta de novo" · "seus últimos votos" · "agora" / "há N min" / "há N h" / "há N d" · "N min" · "prévia da eleição · fecha domingo às 21h" · "prefeito de X" / "governador de UF" / "presidente" · "N pts" · "· N pts de votos".

**Disputa e posição**: "você lidera o Brasil: segura até domingo 21h" · "N pontos à frente de @x" · "falta 1 ponto pra " / "faltam N pontos pra " + "virar presidente do Brasil" / "virar senador" / "virar governador de UF" / "virar deputado de UF" / "virar prefeito de X" / "entrar na Câmara de X" · "hoje é @x, com N pontos na semana" · "sua posição" · "pontos da semana" · "cidade" / "estado" / "Brasil" · "de N em X" / "de N" · "já é o prefeito" · "já é o governador" · "no topo do Brasil" · "subiu além da cidade" / "subiu além do estado" · "… pra vereador|prefeito|deputado|governador|senador|presidente" · "ver o ranking: <escala>, posição N" · "toque num número pra ver o ranking inteiro".

**Pontos / blocos**: "de onde vieram os pontos" · "N no total" · "a casa" · "comentários" · "extras" · "marcou amigos" · "recrutou" · "stories" · "votos" · "+ N jeito(s) de ganhar pontos" · "esconder" · "ainda sem detalhes dos pontos desta casa" · "não carreguei a composição" · "tentar de novo" · "por que ganhei" · "os últimos pontos desta temporada" · (EV_ROT, §4.3) · "comentar e marcar amigos ou lojas valem até 100 pontos por dia. seguir loja, story, voto, amigo que entrou e Reel no direct ficam fora desse limite. os pontos novos aparecem em até 20 min." · "não carreguei o extrato agora" · "nível da casa" · "N de 50" · "N pts" · "falta 1 ponto pra X" / "faltam N pontos pra X" · "no topo: sua casa já é X. o nível da casa nunca diminui." · "votos na temporada" · "voto(s) recebido(s)" · "voto(s) dado(s)" · "hora(s) votando" · "o que o seu cargo faz" · "você é <vice> <onde> · falta 1 pt / faltam N pts pra <próximo>" · (PODER_TXT, §4.3) · "ponto na temporada" / "pontos na temporada" · "define o nível da casa" · "define o cargo".

**Ações**: "como ganhar mais pontos" · "toque e faça" · "como funciona tudo isso?" · (tabela §4.6) · "conferindo…" · "vale uma vez" · "sem limite de dias" · "feito: +N" · "ainda sem casa" · "já fez: N <unid> (+P)" · "ainda não fez" · "faz agora" · "busca seu @ primeiro pra gerar a imagem" · "copiei a chamada: manda pro seu amigo" · "link do perfil copiado: manda pro amigo achar o post" · "copiei “vota em mim”: cola nos comentários e nos stories" · "copiei “voto @x”: cola num post" · "copia o texto:".

**Cidade / estado**: "pontos da semana" · "morador(es)" · "em UF" · "no Brasil" · "guerra de cidades: #N entre as M cidades de UF" · "prefeito" · "vice-prefeito" · "fundador" · "presidente" / "senador" / "governador" / "deputado" · "vaga aberta" · "N ponto(s)" · "ranking de X" · "vereadores (N de 20)" · "ninguém ainda: comenta e pontua pra entrar na Câmara" · "todos os moradores (N)" · "buscar @ nesta cidade" · "mostrar mais (N)" · "ver no mapa" · "N casas em M cidades" · "guerra de estados" · "deputado(s)" · "moradores" · "UF lidera com N pontos: faltam X pro UF passar" · "UF lidera a guerra de estados" · "vice-governador" · "deputados (N): os 5 mais fortes" · "bancada vazia" · "casa(s)" · "prédio(s)" · "próxima conquista: falta 1 / faltam N pro <marco>" · "fundador de X" · "governador de UF" · "ainda ninguém" · "vice" · "faltam N pra virar governador" · "sem vice ainda: só tem 1 cidade no estado" · "maiores cidades" · "nível N · bairro|cidade|polo|metrópole|capital" · "#N no Brasil" · "esta semana" · "água" / "infra" / "saúde" / "segurança" · "média do Brasil" · "melhor dia: <dia>" · "hoje" · "upgrades" · "N de 25" · "faltam N pontos de <área> para <obra>" · "todas as obras prontas" · "toque numa obra para ver" · "· pronto" · "· em obra, G de C pontos de <área>" · "· pede C pontos em cada área" · "· custa C pontos de <área>" · "quem manda" · "e mais N no Congresso" · "ranking" · "moradores e lojas" · "coloque seu negócio aqui" · "sua cidade: faltam N pontos de <área> para <upgrade>" · "sua cidade: todas as 25 obras prontas" · "sua cidade: nível N, <nome>".

**Mapa (rótulos)**: "N casa(s)" · "fundador @x" · "prefeito @x" · "gov. @x" · "saúde @x" · "em alta " · "PRES|SEN|GOV|DEP|PREF @x".

**Como funciona**: ver §1.11 (objetivo, 3 cartões, 6 dúvidas: "voto de vereador conta pra presidente?" / "hoje sim: todo voto soma nos pontos de quem recebe; o cargo é o seu relógio." · "quem vê meu voto?" / "todo mundo: placar e últimos votos são públicos, com o @." · "como ganho pontos?" / "comentar 5 (1 por post) · amigo que você marcou e entrou 50 · story marcando a página 30 por dia · seguir loja 30 · cada voto recebido 5 ou mais." · "zerou meus pontos?" / "domingo zera só os pontos da semana (os cargos); casa e nível ficam." · "não recebi os pontos" / "entram em até 20 min; o story só conta se marcar @naoeummapa; o amigo só conta se comentar a cidade depois de você marcar." · "e o app?" / "adiciona à tela inicial: vira app, com ícone e tela cheia." · "como virar app" · "ver tudo (níveis, cargos, jeitos de ganhar pontos)" · "sua casa cresce" · "cargos: quem faz mais pontos na semana manda" · "mais pontos, cargo mais alto" · "como ganhar pontos" · "cada jeito, o valor e o botão" · "com o que você já fez, @x" · "ver minha posição no ranking" · "ver o ranking" · "mandato N fecha domingo às 21h (Brasília) em" · "fechou").

**Reativação / app / fila**: "voltou, @x! o que mudou:" · "50 níveis (o seu nível ficou)" · "vote a cada hora" · "eleição ao vivo" · "hoje amigo = +100" · "ver minha casa" · "conta o que você quer no jogo (comenta no nosso último post)" · "o que mudou" · "vira app" · " · o mapa na sua tela inicial, em tela cheia, a 1 toque de votar" · "instalar" · (3 instruções §8) · "você já está no app" · "voltou? veja o que mudou" · "seu voto vale N" · "desde a última visita: …" · "verificado ✓ você entrou como @x".

**Story / convite**: "posta sua casa no story" · "+30 pontos (1 por dia) e em alta por 24 h" · "você está em alta" · "até HHh · posta de novo amanhã pra manter".

**Frase / cor (frase-ui)**: "sua cor e sua frase" · "a cor do telhado da sua casa e o seu partido na eleição" · "azul" / "vermelho" / "amarelo" · "sua frase (até 70 letras)" · "sua frase no mapa" · "publicar" · "enviando" · "essa frase não pode" · "entra no mapa em até 20 min" · "sua cor já está no seu telhado" · "publicada · já está na sua casa" · "cor salva · seu telhado já mudou" · "verificado" · "verifique o seu @" · "copiar código e abrir o direct" · "código copiado · cole no direct" · "prefeito @x" / "governador @x" · "trocar @" · "nível N" · "quem chega a prefeito, vereador, deputado, governador, senador ou presidente também escreve uma frase aqui." · "ver minha casa no mapa".

**Rewind**: "rewind" · "temporada 1" · "acabou." · "em 5 dias, um Brasil inteiro saiu do zero. olha o que você fez nele, @x." / "… olha o que a gente construiu junto." · "tem casa? digita seu @ e vê o seu rewind:" · "seu @" · "ver meu rewind" · "procurando…" · "não achei esse @" · "toca pra passar →" · "seus pontos na temporada 1" · "sua casa chegou ao nível N: <nome>. e o nível fica na temporada 2." · ". o topo." · "fundador de X para sempre" · "onde você terminou" · "de N · top N%" · "você foi eleito <cargo> de X!" · "sem cargo dessa vez. na temporada 2 os pontos zeram pra todo mundo: a disputa recomeça." · "de onde vieram seus pontos" · "ter casa" / "comentar nos posts" / "comentário repetido" / "marcar amigos" / "amigos que entraram" / "stories" / "votos que você recebeu" · "quase tudo veio de comentário repetido. na temporada 2 isso não vale mais (já já a gente explica)." · "você jogou do jeito que mais vale agora. a temporada 2 foi feita pra você." · "o Brasil da temporada 1" · "casas" / "cidades com fundador" / "comentários" / "views nos Reels" · "N votos · N marcações · N amigos trazidos · N stories" · "a 1ª eleição do mapa" · "presidente do Brasil · Cidade · UF · N pontos" · "governadores mais fortes" · "e mais N senadores, N deputados, N prefeitos e N vereadores." · "coisas que só aconteceram aqui" · "N ponto(s) separou o prefeito de X (UF) do 2º lugar." · "1 milhão de / N comentários num dia só (dd/mm)." · "N casas em X, a maior cidade do mapa." · "X (UF) foi a cidade que mais pontuou: N pontos." · "N pessoas chegaram ao último nível, “o topo do Brasil”." · "papo reto" · "o Instagram mudou o jogo" · (2 parágrafos §5.6) · "mais justo pra quem joga de verdade" · "temporada 2 · o que vale ponto agora" · (regras) · "comentário repetido não soma mais. faz campanha: quem mobiliza mais gente vence. os pontos zeraram; a sua casa, o nível e o fundador ficam." · "o que vem por aí" · "o jogo acontece aqui dentro" · "eleição toda semana: todo domingo às 21h sai o resultado, com presidente, governadores e prefeitos novos." · "eventos dentro do jogo: desafios aqui no site pra você agir e ganhar pontos. quem estiver de olho sai na frente." · "campeão da temporada 2 no domingo 01/11, às 21h." · "50 níveis de casa: castelo, farol, torre de TV… até “o topo do Brasil”." · "temporada 2" · "valendo." · "os pontos zeraram; a sua casa e o nível ficam. a casa continua em X, nível N, e sobe daqui." · "os pontos zeraram pra todo mundo: é a melhor hora pra entrar. comenta o nome da sua cidade no último post do @naoeummapa e ganha sua casa." · "ver ranking" · "ver minha casa" / "explorar o mapa" · "+50 por amigo: marca no post quem ainda não tem casa. quando ele entra, o ponto é seu." · "copiar a chamada" · "copiado: manda pro amigo ✓" · "copia a chamada:" · "curtiu? manda o Reel do @naoeummapa pra um amigo." · "rewind da temporada 1" · "fechar o rewind".

**Ficha da obra**: ver §1.15 (todos os rótulos, dicas, placeholders, validações e sucesso).

---

## 11. Checklist de reimplementação (resumo executável)

1. Carregar `__DADOS` e derivar `USR, POR_HANDLE, LISTA, CID_DE, ORDEM, ESTADOS, PTOT, PSEM, PEMM, NVA, cargoDe, PRESI/SENI/GOVI/DEPI/pref` exatamente como §3.2 e §5.1.
2. Montar o `<body>` de §1.1 com os textos de §10; CSS pelos tokens/componentes de §7.
3. Busca + sugestões (§3.3-3.4), URL/hash (§3.5), cartões (§4), tabbar (§1.9), painéis (§1.10-1.11), toasts (§1.5).
4. Votação (§4.2) com `/api/voto`, ofensiva (§5.4), "quem sou eu" (§2), link mágico e prova.
5. Arquivos laterais sob demanda (`poder.json`, `ev/`, `hm/`, `selos/`, `eleicao.json`, `ofensiva.json`) com cache por partição `gi >> 11` e versão via `<meta>`.
6. PWA (§8), localStorage (§9) sempre em `try/catch`, `prefers-reduced-motion`, safe-area, alvos de 44 px.
7. Flags `REATIVA, VOTAR_UI, SIMPLES, MISSOES, FRASES` controlando os módulos opcionais; sem elas o site cai nas versões anteriores descritas em cada seção.
