# 05 — Dados, formatos e backend (naoeummapa.app)

Especificação de dados e backend obtida por engenharia reversa dos arquivos públicos do site
(snapshot de 24/10/2026, ~16:31 UTC) e do código que os **lê** (`engine.js`, desconcatenado em `app.js`;
cada trecho abaixo cita o arquivo de origem que aparece nos marcadores `/* ===== D:\naoeummapa\v2\... ===== */`).

> Regras deste documento: nenhum @ real (usamos `usuario_exemplo`), nenhum nome de empresa
> patrocinadora, nenhum código Pix, telefone ou nome do dono. Onde o front não lê um campo e o
> significado foi deduzido pelos dados, está marcado **(inferido)**.

---

## 0. Convenções usadas em todo o site

| Termo | Significado |
|---|---|
| **gi** | índice global do morador: posição (0..n−1) do @ na string `D.u` (split por `\n`). Todos os arrays posicionais (`P.t`, `P.s`, `P.e`, `P.v`, `P.c`, `p`, `S`, `PT`, `ev/hm/selos`) usam gi. |
| **ci** | índice da cidade em `D.c` (e em `D.m`, `D.k`). As casas da cidade ci são os gi contíguos `ini..ini+n−1`, com `ini = soma dos n das cidades anteriores`. O **primeiro gi de cada cidade é o fundador**. |
| **ibge** | código IBGE de 7 dígitos do município (chave de cidade em todos os JSONs). |
| **base36** | `parseInt(s, 36)`: dígitos `0-9a-z`. Campos de largura fixa usam `substr(i*w, w)`. |
| **km** | unidade do mundo 3D: x = leste, y = norte (no three.js `z = −y`). Uma casa tem ~1 km. |
| **BRT** | fuso de Brasília = UTC−3, fixo (`Date.now() − 3*3600e3` para "dia de hoje"). |
| **mandato / temporada / semana** | janela de pontos: mandato 2 = `ini 1792368000` (dom 18/10/2026 21:00 BRT) → `fim 1793577600` (dom 01/11/2026 21:00 BRT). Pontos da semana zeram domingo 21h. |
| **ponte / rodada** | ciclo do ingest (Python) + build (Node) + deploy, "a cada ~20 min" ("os pontos entram em até 20 min"). |
| **dia** | contador de dias do projeto (`dia: 12` em 24/10 ⇒ dia 1 = 13/10/2026). |
| **sid** | id aleatório do aparelho (`[a-z0-9]{8,16}`, localStorage `voto_sid`/`neg_sid`): `Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4)`. Vai em todo POST para antifraude. |
| **shard** | `k = gi >> 11` (2048 moradores por arquivo). Com n = 159 047 ⇒ shards 0..77. |

---

## 1. Inventário dos arquivos públicos

### 1.1 Entregues pelo deploy estático (Vercel)

| Arquivo | Tamanho | Cache-busting | Periodicidade / carimbo | Quem lê |
|---|---|---|---|---|
| `index.html` | 201 KB | — (CSS crítico + SVG inline) | regerado a cada build (`sitemap lastmod` = dia) | navegador |
| `dados.js` | 4,66 MB | `?v=3451f206` (hash no `<script>`) | `__DADOS.geradoEm` ISO UTC (`2026-10-24T16:31:51Z`), `dia`, `P.ger` | tudo (`const D = window.__DADOS`) |
| `engine.js` | 3,83 MB | `?v=c7d6f6b2` | só quando o código muda | é o `app.js` (1,69 MB) + three.js; contém `const TERRENO = {...}` (1,45 MB) embutido na linha 11 |
| `rewind.js` | 25 KB | `?v=d165725d` | — | pop-up "rewind da temporada 1" |
| `missoes-jogos.js` | 256 KB | `?v=` + `window.__MJV` (`"09069495"`) | — | carregado sob demanda ao abrir uma missão |
| `style.css` | 189 KB | (inline no index) | — | — |
| `numeros.json` | 31 KB | `<meta name="numeros" content="numeros.json?v=1df54e11">` | `geradoEm`, `dia`, `v:1` | mapa 2D leve, painel da eleição (contornos) |
| `poder.json` | 695 KB | `<meta name="poder" content="poder.json?v=29d8776a">` | `mandato{n,inicio,fim}`, `v:1` | composição dos pontos (cartão da pessoa); pré-carregado em idle |
| `eleicao.json` | 923 KB | `?t=floor(now/60000)` ou `/300000`, `cache:'no-store'` | `gerado` (unix s) — **a cada rodada (~20 min)** | painel votar / painel eleição / votos da pessoa |
| `missoes.json` | 130 KB | `?t=floor(now/300000)`, `no-store` | `gerado`, `dia`, `semana` | missões, ministros |
| `ofensiva.json` | 833 KB | `?t=floor(now/300000)`, `no-store` | `gerado`, `dia`, `desde`, `mandato` | foguinho (valor do voto) |
| `ev/<k>.json` | ~57 KB (k=0) | `?v=` + `<meta name="ev" content="73aadd45">` | `ini` do mandato | extrato "por que ganhei" |
| `hm/<k>.json` | ~34 KB | `?v=` + `<meta name="hm" content="f2f4f4be">` | `n` = mandato fechado | "último mandato" / posição na T1 |
| `selos/<k>.json` | ~11 KB | `?v=` + `<meta name="selos" content="e9e8cbaf">` | — | selos permanentes |
| `rewind/geral.json`, `rewind/p/<0..63>.json` | não baixados | `?v=` + `<meta name="rewind" content="7cdce9ca">` | gerados por `ingest/rewind-t1.py` | rewind.js |
| `cidades-t3.json` | não baixado | `<meta name="cidades-t3">` **não existe** no index ⇒ fetch sem hash | `{gerado, semana, c:{ibge:{d,m,v,h,top}}, br:{media, rank}}` | painel da cidade (opcional; 404 tolerado) |
| `municipios-pop.json` | não baixado (~190 KB) | — | `[[ibge, nome, uf, pop] × 5571]` | folha "seu negócio" |
| `lojas-logos/<slug>.png` | — | — | copiados pelo build | letreiro 3D das lojas |
| `manifest.webmanifest` | 751 B | — | — | PWA (`start_url: /?app=1`, standalone, portrait, `theme_color #FFD23F`) |
| `robots.txt` | 234 B | — | — | permite Meta; `Disallow: /v/ /api/ /ev/ /hm/` |
| `sitemap.xml` | 328 B | — | `lastmod 2026-10-24` | só `/` e `/privacidade.html` |
| `privacidade.html` | 4,5 KB | — | "Atualizada em 15 de outubro de 2026" | — |
| `og.jpg`, `icones/*.png` | 150 KB | — | — | OG / PWA |
| `/_vercel/insights/script.js` | — | — | — | Vercel Web Analytics |

Observações:
* `lojas.html` e `negocio.html` **não existem** (404 Vercel): lojas, negócio, ranking, eleição etc. são abas no
  mesmo `index.html` (`#lojas`, `?aba=lojas`, `?loja=<id>`, `#eleicao`, `#painel`, `#ranking`, `#obra=NEG-XXXXXX`).
* Deep links: `?u=<@>` abre a casa, `?c=<ibge>` a cidade, `?loja=<id>` o cartão da loja, `?rewind=1` força o rewind,
  `?eu=<@>&vp=<prova24>` é o link mágico do direct (ver §6.2), `?leve=1` força o mapa 2D, `?app=1` marca PWA.
* O build embute **flags** em `dados.js`: `window.REATIVA=1`, `VOTAR_UI=1`, `SIMPLES=1`, `MISSOES=1`, `FRASES=1`
  (cada uma corresponde a um arquivo-chave no repo: `MISSOES-LIGADAS`, `FRASES-LIGADAS`, `data/CIDADE-LIGADA`,
  `data/OFENSIVA-LIGADA`, `build --<patrocinador>` (liga o campo `F`), `--relevo`).

### 1.2 Relógio do snapshot

* `dados.js.geradoEm = 2026-10-24T16:31:51.362Z`; `numeros.json.geradoEm = ...16:31:51.715Z` (mesmo build).
* `eleicao/missoes/ofensiva.gerado = 1792859430` = 2026-10-24T16:30:30Z; `P.ger` idêntico ⇒ o ingest roda
  ~1 min antes do build; os três JSONs "vivos" são **copiados** pelo build (não gerados por ele).

---

## 2. `window.__DADOS` campo a campo

Contagens do snapshot: **n = 159 047 moradores**, **5 509 cidades com casa** (de 5 571 municípios), 27 UFs.

### 2.1 Cabeçalho

| Campo | Tipo | Valor | Significado |
|---|---|---|---|
| `v` | int | 3 | versão do formato |
| `dia` | int | 12 | dia do projeto (nome de arquivo das imagens: `naoeummapa-<id>-dia12.png`) |
| `geradoEm` | string ISO | | hora do build |
| `n` | int | 159 047 | nº de moradores = `u.split('\n').length` |

### 2.2 `u` — moradores (string, 2,25 MB)

* **Codificação:** @ normalizados (`Hash.norm`: minúsculas, sem `@`, só `[a-z0-9._]`, ≤30 chars) separados por `\n`,
  **sem** `@`. Ordem = ordem de `c` (cidade a cidade), e dentro da cidade o fundador primeiro.
* **Decodificação (site.js):**
  ```
  USR = D.u.split('\n'); NM = USR.length
  POR_HANDLE: Map(handle → gi)      // busca "esse @ tem casa?"
  CID_DE: Uint16Array(NM)            // gi → ci
  ```
* Todos os @ são públicos de propósito (comentário do código: "Os @ são públicos (os comentários são públicos; autorizado pelo dono)").
  O `hash.js` (SHA-256 com sal `naoeummapa:v1:`, 12 bytes → 16 chars base64) **não** é usado para esconder `u`; só para
  as chaves do `rewind/p/*.json`.

### 2.3 `p` — bitmap "casa provisória" (string base64, 26 508 chars → 19 881 bytes ≥ 159 047 bits)

* bit gi ligado ⇒ a pessoa só disse o **estado**; a casa foi posta na **capital** e muda quando ela comentar a cidade.
* ```
  PB = bytes(atob(D.p)); ehProv(gi) = (PB[gi >> 3] >> (gi & 7)) & 1
  ```

### 2.4 `c` — cidades com casa (5 509 × `[ibge, n, fundador]`)

```
ini = 0
for ci, [ib, n, fund] in enumerate(D.c):
    cidade = {ibge: ib, ini, n, fund, nome/uf de MUN_ID(ib)}
    for j in 0..n-1: POR_HANDLE[USR[ini+j]] = ini+j; CID_DE[ini+j] = ci
    ini += n
```
`fund` é o @ do fundador (= `USR[ini]`). `ORDEM` = cidades por `n` desc, desempate `ibge` asc (o `q` = posição no Brasil).

### 2.5 `m` — municípios (5 509 × `[ibge, nome, uf, lat, lon]`)

Só os municípios que têm casa (mesmo conjunto de `c`); lat/lon com 3 decimais. Vira `MUN_ID: Map(ibge → {id,nome,uf,pop:0,lat,lon})`.
A população **não** vem aqui (vem de `municipios-pop.json` para o fluxo de negócio e de `numeros.json` para os totais).

### 2.6 `e` — UFs (27 × `{n, k, x, y, f}`)

| Campo | Significado |
|---|---|
| `n` | nome do estado |
| `k` | índice em `pal` (cor do estado, 0..7) |
| `x`, `y` | posição do rótulo em km (mesma projeção do TERRENO) |
| `f` | "folga" do rótulo (km) para colisão de rótulos |

### 2.7 `g` — governadores da v1 (27 × `{h, c, n, v, vn}`)

`h` @ do governador (fundador da maior cidade da UF), `c` nome da capital/maior cidade, `n` casas dela,
`v` nome da 2ª maior cidade (vice), `vn` casas dela. Com `P` presente, o governador "ao vivo" é o cargo `G` (ver 2.10); `g` fica como fallback dos cartões v1.

### 2.8 `pal` — paleta (8 cores hex): `#FFD23F #FF7F6B #4FB7F0 #B58CFF #FF9F2E #47D4A7 #FF8BC2 #FFFFFF`.

### 2.9 `k` — centros canônicos (array plano int, 3 × 5 509 = 16 527)

Para a cidade ci: `cx = k[3ci]/10`, `cy = k[3ci+1]/10`, `rs = k[3ci+2]/10` (km, décimos). São o centro **resolvido no build**
(a praça pode ser deslocada até 200 km se cair no mar ou em cima de outra cidade: `urbanizarGen` em layout.js) e o raio canônico
da cidade. O marcador de longe usa só isso; a geometria real é gerada sob demanda no navegador (`criarUrbanista`).

### 2.10 `P` — pontos, níveis e cargos (objeto)

| Campo | Tipo | Significado / codificação |
|---|---|---|
| `w` | `[2,2,3]` | larguras (chars base36) de `t`, `s`, `e` |
| `t` | string n×2 | **pontos totais da temporada** por gi |
| `s` | string n×2 | **pontos da semana** por gi (decidem o cargo) |
| `e` | string n×3 | **minuto de entrada** da casa, relativo a `b` |
| `xt`, `xs` | `{gi: valor}` | **exceções** de `t`/`s` que estouram 36²−1 = 1295 (a string traz `zz`; 487/482 pessoas) |
| `b` | int | base de `e` em **minutos unix** (29 862 719 ⇒ 2026‑10‑12 00:59 UTC) |
| `v` | string n×1 | **nível com piso** por gi (1 char base36 1..z): "o nível da casa nunca diminui" |
| `c` | string n×1 | **cargo** por gi: `' '` nenhum, `P` presidente, `S` senador, `G` governador, `D` deputado, `M` prefeito, `V` vereador |
| `niv` | int[50] | degraus de pontos totais por nível: `0,15,25,45,75,110,150,210,...,9600` |
| `nn` | string[50] | nomes dos níveis (`casinha`, `sobrado`, `casa alta`, `mansão`, `torre`, `prédio` … `o topo do Brasil`) |
| `mand` | int | 2 (nº do mandato) |
| `ini`, `fim`, `ger` | unix s | início/fim do mandato e hora da geração |

Decodificação (site.js):
```
dec(str, w, ex, out): for i in 0..NM-1: out[i] = parseInt(str.substr(i*w, w), 36); then out[k] = ex[k] for k in ex
PTOT = dec(P.t, w[0], P.xt);  PSEM = dec(P.s, w[1], P.xs);  PEMM = dec(P.e, w[2], null)
for i: NVA[i] = nivelDe(PTOT[i]) + 1;  pv = parseInt(P.v[i],36)||1;  NVA[i] = max(NVA[i], pv)
       if PEMM[i]: PEMM[i] += P.b           // minuto unix de entrada (quandoBRT(min) = Date((min*60−10800)*1000))
nivelDe(t) = maior i com t >= niv[i]        // 0..49
cargoDe(gi) = P.c[gi] (vazio se ' ')
```
Derivados: `PRESI` (gi do `P`), `SENI[]` (até 49 `S`), `GOVI[uf]`, `DEPI[uf][]`, `c.pref` (gi do `M` da cidade), vereadores = `V`
da cidade (até 20). Ranking = `PSEM` desc, desempate casa mais antiga (`PEMM` asc), depois gi. Cargos e somas são **derivados
dos arrays** no front; o build é quem decide quem tem cada letra.

Tetos do jogo (poder.js, regra v4 a partir de 18/10 21h): casa +10 (uma vez), comentar post +5 (1/post), marcar amigo sem casa +1
(até 5/post), amigo marcado virou morador +50 (até 20/semana), story marcando a página +30 (1/dia, "em alta" 24 h), Reel no direct +20
(até 3/dia), voto recebido +5 (ou 5 + ofensiva), seguir loja +30, marcar loja +10; "comentar e marcar valem até 100 pontos por dia".

### 2.11 `F` — patrocinador de saúde (objeto)

`{m: @ da marca, c: cupom, p: [post, extra, marca, story] (pontos da promoção), k: nome do cargo ("Secretário de Saúde <marca>"),
app: URL da loja de apps, s: [[ibge, @secretário, pontosDoPatrocinador, nCasasDaCidade] × 1 673]}`.
Cada cidade em `s` ganha um **hospital** 3D e o @ ganha o selo do cargo (módulo do patrocinador no engine). Sem `F` o site é o de antes.

### 2.12 `S` — em alta por story (53 × `[gi, fimUnixSegundos]`)

`AL: Map(gi → fim*1000)`; `emAlta(gi) = fim > Date.now()`. Buff de 24 h após o story (build lê `data/entrada/stories.jsonl`).

### 2.13 `O` — obras com meta (30 × `[ibge, id, nome, base, alvo]`)

Progresso `p = clamp((casasAgora − base)/(alvo − base), 0, 1)`; < 1 mostra canteiro (20 passos de 5 %), ≥ alvo mostra o monumento
(modelos em `shared/obras*.js`, ex.: `cristo-redentor`, `masp`). Fonte: `data/obras-metas.json`.

### 2.14 `L` — lojas patrocinadas (97 × array de 10)

| idx | Campo | Exemplo/tipo |
|---|---|---|
| 0 | `id` (slug) | string |
| 1 | `@` do negócio | string |
| 2 | nome | string |
| 3 | tipo | `lanchonete acai mercado roupa beleza academia tech flores pet oficina servico criador outro` |
| 4 | ibge | int |
| 5 | cor da marca | `#rrggbb` |
| 6 | `desde` | `YYYY-MM-DD` |
| 7 | `ate` | `YYYY-MM-DD` (desde + 9 dias = 10 dias de vigência) |
| 8 | `tipo_outro` | texto livre (≤30) quando tipo = `outro` |
| 9 | extras | `{d: descrição, w: whatsapp, i: instagram (se ≠ @), e: id de "loja especial" (modelo 3D sob medida), l: slug do logo (lojas-logos/<l>.png), s: 1 = sem Instagram}` |

Vigente hoje (BRT): `desde <= hoje <= ate`. O **slot** 3D da loja é a posição i na lista completa da cidade (não muda quando outra entra/sai).

### 2.15 `LC` — config das lojas: `{p: 30 (pontos por marcar), s: 100 (seguir), t: {tipo: nome legível}}`.
O front sobrescreve para `p=10, s=30` após a virada v4 (`Date.now() >= 1792368000e3`).

### 2.16 `CV` — cidade que evolui (v3)

```
CV = { v: 3,
       a: ['água','infraestrutura','saúde'],                  // 3 áreas com orçamento
       o: [[id, nome, área(0-2; 3 = "cidade"), custoBase, nível] × 25],   // catálogo fixo, 5 por nível
       f: [0.5, 4],                                           // limites do fator de custo
       c: [[ibge, [pa,pi,ps], mask25, [ka,ki,ks], [ga,gi,gs], prefeito@] × 2908] }
```
* `pts = [pa,pi,ps]` pontos da semana por área (missões + votos); `orc = pa+pi+ps`.
* `mask25`: bit k ligado ⇒ obra `o[k]` **pronta** (mesma ordem do catálogo). Nível da cidade = `min(5, 1 + floor(prontas/5))`;
  `nivelDe` em cidade-t3.js usa `max(o[k][4])` das prontas.
* `kc = [ka,ki,ks]`: índice (em `o`) da obra **em andamento** por área (−1 = nenhuma); `gc = [ga,gi,gs]`: pontos já gastos nela.
* custo real: `cvCusto(k, n) = max(1, round(o[k][3] * clamp(sqrt(n/100), f[0], f[1])))` (n = casas da cidade).
* `prefeito@` (último campo) — quem pode decidir (`/api/decisao`).

### 2.17 `FR` — frases dos políticos: `{handle: "frase ≤ 70 chars"}` (852). Só de quem tem cargo agora; passou pelo filtro `Frase.limpar` (frase-filtro.js) no servidor e no build.

### 2.18 `PT` — partidos/cor do telhado: `{a: [gi...], v: [gi...], y: [gi...]}` (azul 610, vermelho 178, amarelo 192). Formato compacto (b); o front também aceita `{handle: 'a'|'v'|'y'}` (a). Hex: azul `#2f6fe0`, vermelho `#e0343a`, amarelo `#f5c400`.

### 2.19 `VF` — @ verificados pelo direct (1 308 strings). Lista de quem já mandou o código `MAPA-XXXXXX` (sem os códigos, de propósito).

---

## 3. `window.NEG_CFG` — "coloque seu negócio no mapa"

Embutido pelo build a partir de `data/negocios-config.json`. Campos (valores sensíveis omitidos):

| Campo | Tipo | Significado |
|---|---|---|
| `ativo` | bool | esconde o botão se `false` |
| `nota` | string | comentário interno ("Preços e Pix são decisão do dono; trocar aqui") |
| `precos[]` | `{ate_pop, valor, plano, rotulo}` | 3 faixas por **população do município**: ≤100 mil → R$ 49 "Plano Interior"; ≤1 mi → R$ 69 "Plano Cidades Grandes"; `null` (acima) → R$ 99 "Plano Metrópoles". `faixa(pop)` = primeira faixa com `ate_pop == null || pop <= ate_pop` |
| `duracao_dias` | 10 | vigência da loja no mapa |
| `prazo_texto` | string | "Fechou até 21h? Até as 10h do dia seguinte seu negócio está no mapa…" |
| `pontos_marcacao` / `regra_pontos` | 30 / string | pontos para quem marca o @ do negócio num comentário (uma vez por negócio) |
| `pts_marcar` | `{antes:30, depois:10, virada_ts:1792368000}` | valor antes/depois da regra v4 |
| `pix` | `{modo:'copia_e_cola', nota, codigos:{"49":EMV,"69":EMV,"99":EMV}}` | **um Pix copia-e-cola estático por faixa** (CRC16 conferido); o front tentou injetar o código do pedido no EMV (`pixPedido`) mas voltou ao estático em 18/10 |
| `proibidos[]` | 6 strings | aposta/bet, IPTV/pirataria, adulto, político/partido/candidato, armas, remédio controlado |
| `tipos[]` | `{id, nome}` × 12 | mesmos ids de `L[3]`; o front acrescenta `outro` no fim |
| `tipos_destaque[]` | 8 ids | ordem de destaque na tela |
| `cor_por_tipo` | `{tipo: hex}` | cor padrão da marca por tipo |
| `pacote[]` | 4 strings | o que o anunciante ganha (placeholders `{cidade}`, `{pts_marcar}`) |
| `whatsapp` | string DDI+número | destino do "já paguei" (omitido) |
| `whatsapp_texto` | template | `"Oi! Loja: {nome} ({cidade}) · pedido {codigo}. Já paguei o Pix de R$ {valor}…"` |
| `prova` | `{nota, loja, h, onde, titulo, notifs:[[texto,hora]], frase}` | prova social de um cliente real (omitida) |
| `<primeiro nome do dono>` | `{nome, papel, linkedin, foto}` | cartão de confiança do criador (chave e valores omitidos) |

Fluxo (negocio.js): passo 1 dados (nome, @, tipo, cidade via `municipios-pop.json`, cor, WhatsApp) → passo 2 preço pela população
→ passo 3 `POST /api/negocio` registra o pedido `NEG-XXXXXX` **antes** de mostrar o Pix, depois botão `wa.me/<whatsapp>?text=…`.
Código: 6 chars do alfabeto `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` via `crypto.getRandomValues`. Rascunho em localStorage `neg_rascunho_v1`.
Depois do Pix o dono preenche a "ficha da obra" (`#obra=NEG-XXXXXX` → `POST /api/obra`).

---

## 4. `TERRENO` — geografia do mundo (const embutida no engine, 1,45 MB)

### 4.1 Estrutura

```
TERRENO = {
  ufs: [ { c: "12", uf: "AC", polys: [ { o: [[x,y],...], h: [ [[x,y],...], ... ] } ] } × 27 ],
        // c = código IBGE da UF (2 dígitos); o = anel externo; h = buracos. 1 polígono por UF, exceto AP, MA, RJ (3), SP (2). 16 664 pontos.
  coast:   [ [[x,y],...] × 33 ],          // linha de costa (12 187 pts)
  borders: [ [[x,y],...] × 27 ],          // divisas interestaduais
  rivers:  [ { n: "Araguaia", w: 1|2|3, p: [[x,y],...] } × 131 ],   // w = classe de largura; RW = {3:[1.3 km,7 px], 2:[0.8,5], 1:[0.45,3.4]}
  dens:    { nx:256, ny:264, minx:-2140, miny:-2200, w:4280, h:4400, b64 },  // textura RGBA 256×264 (270 336 bytes)
  box:     [-2111.8, -2173.9, 2113.6, 2165.2],   // [minx, miny, maxx, maxy] km do continente
  proj:    { kx: 107.7974, ky: 111.1949, lat0: -14.2, lon0: -54.4 },
  relevo:  { v:1, nx:384, ny:384, box:[-2140,-2200,4280,4400], hmax:3000, sigmaKm:10,
             fonte:"NOAA NCEI ETOPO 2022 60s; IBGE Biomas 1:250.000 (2019)",
             planos: { h: b64, r: b64, b: b64 },        // deflate raw + filtro PNG "Sub" por linha
             mun: { n: 5523, b64 } }                      // platôs por município
}
```

### 4.2 Projeção (layout.js › `xyCidade`)

Equirretangular centrada em (lat0, lon0) = (−14,2°, −54,4°), em km, com `ky = 111,195 km/°` e `kx = ky·cos(14,2°) = 107,797 km/°`:
```
x_km = round((lon − lon0) · kx · 10) / 10      // leste +
y_km = round((lat − lat0) · ky · 10) / 10      // norte +
inverso: lon = x/kx + lon0 ; lat = y/ky + lat0
three.js: position = (x, altura, −y)
SVG (numeros.json › mapa.d, mapa2d.js): (x, −y) inteiros
```
Os `k` de `__DADOS` (centros canônicos) estão nessa mesma projeção, já deslocados pelo urbanismo.

### 4.3 Máscara terra/mar (cidade-t3.js › `criarTerra`)

Tiles de 128 km × células de 0,5 km (`TN = 256`), rasterizados sob demanda por scanline par/ímpar sobre `o` + `h`
de cada polígono; `terra(x,y)` é booleano. Casas, lojas e hospitais só nascem onde `terra()` é verdadeiro.

### 4.4 `dens` (textura de mata)

RGBA por texel (grade 256×264 sobre `minx..minx+w`, `miny..miny+h`): **R** densidade de mata (0..255), **G** secura,
**B** valor/8 usado como altura/categoria quando **A** ≠ 0 (A = máscara de terra). Com relevo ligado, R e G são recalculados
dos biomas (`Relevo.densBytes`): Amazônia 0,97/0,0 · Caatinga 0,17/0,95 · Cerrado 0,36/0,62 · Mata Atlântica 0,80/0,08 · Pampa 0,10/0,35 · Pantanal 0,28/0,25.

### 4.5 `relevo` (relevo.js › `decodificar`)

```
pl(k) = desfazerSub(inflar(b64(planos[k]), nx*ny), nx, ny)     // inflate RFC1951 "raw", depois soma acumulada por linha (mod 256)
h   = pl('h')   // altitude absoluta codificada: metros = (v/255)^2 * 3000  (shader: c*c*3000)
r   = pl('r')   // relevo LOCAL (altitude − chão regional suavizado σ=10 km), mesma tabela quadrática → rf (Float32, m)
bio = pl('b')   // id do bioma 0..6 (0 = mar)
mun: inflar(b64, n*6) → por município: int16 x*5, int16 y*5 (km/5), u8 rin*4, u8 rout*4 (raios do platô, km/4)
```
Altura 3D = `max(0, (exagero/1000)·rf_bilinear − PISO 0,15 km)`, achatada a 0 num platô em volta de cada cidade.

### 4.6 Caixa do mapa 2D (`numeros.json › mapa`)

`vb = [-2112, -2166, 4226, 4340]` = viewBox SVG `[minx, −maxy, largura, altura]` (= `box` arredondado e com y invertido);
`d[UF]` = path SVG `"M x -y L x -y … Z"` com inteiros, um por UF (27). O mapa leve usa `fill = pal[e.k]`.

---

## 5. Os JSONs servidos

### 5.1 `numeros.json` (build, v1)

```
{ v, dia, geradoEm,
  placar: { casas, cidades, municipios(5571), pctMun, pop(IBGE total), popCom(pop dos municípios com casa), pctPop, estados, estadosTotal, fundadores },
  estados: [ { uf, nome, casas, mun, comCasa, pct, pop, por100k, gov:{h, cidade, n}, vice:{h, cidade, n, dif, falta} } × 27 ],
  cidades20: [ { ib, nome, uf, n, fund, gov } × 20 ],
  semDono:   [ { ib, nome, uf, pop, x, y } × 15 ],          // maiores municípios ainda sem casa (x,y km)
  disputas:  [ { uf, nome, gov, vice } × 5 ],                // menor `falta` entre gov e vice
  crescimento: [ { dia, casas, cidades } ... ],              // histórico por dia
  fundadasHoje: { dia, total, casas, top:[{ib,nome,uf,n,fund} × 10] },
  mapa: { vb, d:{UF: path} } }
```
`gov`/`vice` aqui seguem a regra v1 (fundador da maior cidade; vice = fundador da 2ª; `falta = dif + 1`).

### 5.2 `poder.json` (build, v1) — composição dos pontos

```
{ v:1, mandato:{n, inicio, fim},
  qk: ['casa','posts','extras','marcou','recrutou','stories','votos'],   // nomes das colunas
  q:  "a,0,0,5,0,0,u\na\na,5\n…",     // UMA LINHA POR gi (159 047 linhas): colunas base36 na ordem de qk; colunas faltantes = 0; linha "a" = só a casa (10)
  top: [ [@, pontosSemana, pontosTotal] × 100 ],     (inferido: 2º = semana, 3º = total; 1º lugar bate com max(xt))
  ufs: { UF: { s: pontos da semana, t: pontos totais, n: moradores } } }
```
Leitura: `linhas = q.split('\n'); v = linhas[gi].split(',').map(x => parseInt(x,36)||0); q[qk[i]] = v[i]`.

### 5.3 `eleicao.json` (ingest/pontos.py, a cada rodada)

```
{ gerado (unix s), mandato: 2, inicio (unix s), total (votos da semana), eleitores (distintos),
  placar: { ver|pref|dep|gov|sen|pres|com : [ [@candidato, votos, ibge, uf] × 10 ] },   // 'com' = votos por comentário "voto @x" (legado v3) (inferido)
  ultimaHora: votos nos últimos 60 min,
  porCargo: { cargo: votos },
  cidades: { ibge: [ votosRecebidosPorMoradores, X (não lido pelo front), { cargo: [@líder, votos, vantagem] } ] },   (3º do array interno: inferido)
  pessoas: { @: [ votosRecebidos, votosDados, horasVotando ] },
  ultimos: [ [ts, @eleitor, @candidato, cargo, ibge, uf] × 40 ] }
```
Front usa: `placar`, `total`, `eleitores`, `ultimaHora`, `ultimos` (ticker), `cidades[ib][0]`, `pessoas[@]`.

### 5.4 `missoes.json` (pontos.py)

```
{ gerado, ligada: true, dia: "YYYY-MM-DD", semana:{inicio,fim}, pts: 5 (pra pessoa), cidade: 10 (pro orçamento),
  cidades: { ibge: [ conclusões, pontosCreditadosÀCidade, moradoresDistintos, [conclusões por área ×4] ] },
  hoje:    { @: bitmask (bit0 água, bit1 infra, bit2 saúde, bit3 segurança) das áreas feitas na janela },
  prox:    { @: [ unix s em que cada área libera ×4 ] },          // 1 vez por área a cada 12 h
  ministros: { agua|infra|saude|seg: [@, n] },                   // quem mais concluiu na semana
  top:       { área: [ [@, n, uf] × 5 ] } }
```
Regras do servidor citadas no código: só morador; `fim` ≥ `MIS_MIN_S` (8 s) depois do `ini`; `MIS_JANELA_S` = 12 h por área.

### 5.5 `ofensiva.json` (pontos.py › `tabela_ofensiva`)

```
{ gerado, dia, ligada, desde (unix s), base: 5, mandato:{n,inicio,fim}, n:{ativas, ge2},
  p: { @: [ C, vale, votosDadosNaSemana, hora ] } }
  // C = nº de horas-relógio distintas com voto aceito nesta semana; vale = base + C; hora = floor(ts/3600) da última hora contada
```
Valor do voto no front: `vale = 5 + C − (hora === floor(now/3600e3) ? 1 : 0)`; zera no fim do mandato.

### 5.6 `ev/<k>.json` — extrato de pontos (k = gi >> 11)

```
{ ini: unix s do início do mandato, e: { gi: "m36,razão,pts;m36,razão,pts;…" } }
minuto = floor(ini/60) + parseInt(m36, 36)
```
Razões vistas: `casa, comentou, meta, palavra, curti, compartilhei, marcou, marcou loja, seguiu loja, recrutou, story, envio, voto,
voto da página, voto · ofensiva +N, 💧 missão água, ⚡ missão infraestrutura, 🏥 missão saúde, 🛡 missão segurança`.
404 ⇒ `{e:{}}`. Nota no cartão: "comentar e marcar valem até 100 pontos por dia; os pontos novos aparecem em até 20 min".

### 5.7 `hm/<k>.json` — histórico do mandato fechado

`{ n: 1 (mandato), tot: 128738 (moradores da época), e: { gi: "cargo,posiçãoBrasil,pontos,posiçãoCidade" } }` — `cargo` vazio = morador sem cargo.

### 5.8 `selos/<k>.json` — selos permanentes

`{ e: { gi: [ "c|<mandato>|<cargo PSGDMV>|<cidade ou UF da época>", "f|<cidade>|<UF>|<1 atual / 0 ex>" ] } }`.

### 5.9 `rewind/geral.json`, `rewind/p/<j>.json` (ingest/rewind-t1.py)

Chave = `Hash.chave(@)` (16 chars); arquivo `j = ALF.indexOf(chave[0])` (64 shards). Registro:
`[pts, nível, cargo, posBR, uf, ibge, nUF, nCidade, nomeCidade, sigla, fundador(0/1), casa, posts, extras, marcou, recrutou, stories, votos]`.

---

## 6. API (`/api/*`, funções Vercel) — tudo que o front chama

Padrão comum: `POST`, `content-type: application/json`, resposta `{ok: true}` ou `{ok: false, erro: "texto pronto para a tela"}`;
qualquer status ≠ 2xx ou `ok` falso ⇒ mensagem genérica "não consegui registrar, tenta de novo". Todos levam `s` = sid do aparelho.
Os comentários do código dizem que as funções **só registram** (log/fila); quem valida e credita é o **`ingest/pontos.py`** na rodada seguinte.

| # | Endpoint | Payload exato | Regras que o front assume | Servidor (pelos comentários) |
|---|---|---|---|---|
| 1 | `POST /api/voto` | `{u: @eleitor, a: @alvo, s, c}` com `c ∈ ver,pref,dep,gov,sen,pres` | eleitor precisa ter casa (`POR_HANDLE`); **1 voto por hora por cargo** (trava local em `voto_ultimo`); pode votar em si; vale `+5` ou `5 + ofensiva`; só após `VOTO_ABRE` 18/10 21h; dispara evento `nem:votou` | pontos.py conta e gera `eleicao.json`/`ofensiva.json`; "os pontos entram em até 20 min" |
| 2 | `POST /api/frase` | `{u, t: texto ou '', s, c?: 'a'|'v'|'y', p?: prova}` | `t` passa por `Frase.limpar` (≤70 chars, sem ódio/ameaça/contato/link/@); `t=''` = só cor; otimista 3 h em `nem_frase`/`nem_cor`; `p` = prova de 24 chars do link mágico | filtro roda de novo na API e em cada build; frase entra em `D.FR`, cor em `D.PT` |
| 3 | `POST /api/missao` | `{u, m: índice da área 0..3, e: 'ini'|'fim', j: id da variante do jogo, s}` keepalive | `fim` só ≥ 8,6 s após `ini`; retry 3× no `fim`; 1 vez por área/12 h; +5 pessoa, +10 cidade | `api/missao.js` → pontos.py (`MIS_MIN_S`, `MIS_JANELA_S`, `MISSOES_FLAG`) |
| 4 | `POST /api/seguir` | `{u, loja: id}` keepalive | 1 vez por pessoa+loja (`nem_seg`); dono não ganha; loja sem Instagram não pontua | `api/seguir.js → ingest/pontos.py`: só morador, loja vigente, tetos por dia e por IP |
| 5 | `POST /api/visita` | `{d: id aparelho, n: 1 primeira visita, eu: 1 se tem @ salvo, p?: 1 se PWA}` keepalive | não roda em localhost; fire-and-forget | `api/visita.js`: contagem anônima |
| 6 | `POST /api/decisao` | `{u: @prefeito, c: 'obra', v: id da obra (CV.o[k][0]), s}` | só o prefeito atual (`USR[c.pref] === voto_eu`), entre as 3 obras mais baratas não prontas; guarda `nem_dec` 3 h | "vale na próxima rodada da ponte (~20 min)"; build resolve a fila |
| 7 | `POST /api/neg-ev` | `{e: etapa, s, c?: ibge, campo?, v?: 'a'|'b'}` via `sendBeacon` (fallback fetch keepalive) | 1 vez por etapa por página; A/B estável por sid | `api/neg-ev.js`: loga linha `NEV {...}` |
| 8 | `POST /api/negocio` | `{codigo: 'NEG-XXXXXX', nome, insta, tipo, tipo_outro, ibge, cidade, uf, cor, whatsapp (só dígitos), valor, pix: true, ciente: true}` | registra **antes** de mostrar o Pix; guarda `neg_rascunho_v1_enviado` | `api/negocio.js`: loga `NEG {...}`; **não recalcula o preço** (quem confere vê valor × população no log); aprovação manual → `data/negocios.json` → `L` |
| 9 | `POST /api/obra` | `{codigo, pagador, contexto, montagem, montagem_texto, logo_zap, celular (≤13 dígitos), insta, site, ciente}` | `codigo` válido `NEG-[A-Z0-9]{6}`; lista enviados em `neg_ficha_enviada` | loga `OBRA {...}`; coletor grava `data/negocios/fichas.jsonl` |
| 10 | `api/webhook.js` (não chamado pelo front) | webhook do Instagram (DM) | quem manda `MAPA-XXXXXX` no direct recebe link `/?eu=<@>&vp=<prova>`; o front salva `nem_prova`, `voto_eu`, `nem_eu` | gera `D.VF`; `/v/` (bloqueado no robots) é provavelmente a rota do link (inferido) |

### 6.1 Identidade do jogador (sem login)

* `nem_eu` = último @ buscado/"quem sou eu" (ranking, rewind, missões); `voto_eu` = quem vota (só gravado quando a pessoa digita o próprio @).
* `voto_sid` = id do aparelho; `codigo(sid)` = FNV‑1a 32 bits de `'mapa|' + sid` → 6 chars de `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` = código `MAPA-XXXXXX` para verificação pelo direct.
* Não há autenticação real: qualquer um pode postar como qualquer @; a defesa é antifraude no ingest (sid, IP, tetos) e a verificação opcional pelo direct (prova de 24 chars).

### 6.2 Outros localStorage usados

`voto_ultimo` `{cargo:{ts,a}}`, `nem_seg` `{"@|loja":1}`, `nem_of`/`nem_ofx` (ofensiva otimista), `nem_mis2`, `nem_mis_pend`, `nem_mis_ult`,
`nem_dec`, `nem_cv` (máscara de obras vista), `nem_frase`, `nem_cor`, `nem_prova`, `nem_verif_novo`, `nem_viu_como`, `nem_vid`, `nem_app_dica`,
`nem_rewind_t1b`, `neg_rascunho_v1`, `neg_rascunho_v1_enviado`, `neg_sid`, `neg_ficha_enviada`.

---

## 7. Pipeline inferido

```
 INSTAGRAM (@ da página)                         ENTRADAS                          INGEST (Python)
 ┌──────────────────────────┐   API Graph   ┌─────────────────────────┐    ┌──────────────────────────────────┐
 │ comentários nos posts    │ ───────────▶  │ comentários (@, texto,  │    │ parser: cidade/UF citada → casa  │
 │ ("Curitiba", "voto @x",  │               │  hora, curtidas)        │ ─▶ │ (1ª menção = fundador); provisória│
 │  "@amigo", "curti")      │               │ DMs (cidade, MAPA-XXXX, │    │ se só UF; marcou amigo; recrutou;│
 │ stories marcando a página│ ───────────▶  │  Reel enviado)          │    │ palavra secreta; meta de curtidas│
 │ DMs                      │ ───────────▶  │ stories.jsonl           │    │ pontos.py: tetos/dia, ofensiva,  │
 └──────────────────────────┘               │ nº de seguidores        │    │ votos (1/h/cargo), missões (12 h)│
                                            └─────────────────────────┘    │ seguir loja, decisão do prefeito │
 SITE (Vercel Functions /api/*)                                             │ → eleicao.json, missoes.json,    │
 ┌──────────────────────────┐   logs/fila (NEG, NEV, OBRA, voto, frase…)    │   ofensiva.json, rewind/*        │
 │ voto · frase · missao ·  │ ───────────────────────────────────────────▶ │ cargos da semana (PSGDMV),       │
 │ seguir · decisao · visita│                                               │ níveis (piso), obras (CV)        │
 │ negocio · obra · neg-ev  │                                               └──────────────┬───────────────────┘
 │ webhook (DM → link)      │                                                              │ data/*.json(l)
 └──────────────────────────┘                                                              ▼
                                                                            BUILD (Node, build.mjs)
                                                                 ┌──────────────────────────────────────────┐
                                                                 │ dados.js (__DADOS + NEG_CFG + flags),    │
                                                                 │ numeros.json, poder.json, ev/hm/selos/*, │
                                                                 │ cidades-t3.json, municipios-pop.json,    │
                                                                 │ index.html com ?v=hash, engine.js (só se │
                                                                 │ o código mudou), lojas-logos/*.png       │
                                                                 └──────────────┬───────────────────────────┘
                                                                                ▼  deploy estático a cada ~20 min
                                                                   naoeummapa.app (CDN) ──▶ navegador (3D sob demanda)
```

Ciclo: ~20 min ("ponte"). O ingest roda antes do build (gerado 16:30:30 vs geradoEm 16:31:51). Lojas e obras entram por
curadoria manual (`data/negocios.json`, `data/obras-metas.json`, `data/<patrocinador>.json`, `data/negocios-config.json`).
Prazo prometido ao anunciante: "fechou até 21h → no mapa até 10h do dia seguinte".

### 7.1 O que o backend precisa ter para reproduzir

Entidades mínimas (todas já aparecem, direta ou indiretamente, nos dados públicos):

1. **municipio** (IBGE: id, nome, uf, lat, lon, pop, porte) — fonte estática.
2. **morador** (handle normalizado, cidade, provisória, entrada, fundador, nível com piso, verificado, partido).
3. **evento_pontos** (morador, razão, pontos, instante, origem: comentário/story/dm/voto/missão/loja; chave de idempotência).
4. **comentario / dm / story** brutos (para auditoria e reprocessamento) — a privacidade promete não exibir o texto de DMs.
5. **voto** (eleitor, alvo, cargo, hora-relógio, sid, ip, aceito).
6. **frase** e **cor/partido** (morador, texto filtrado, cor, prova, status).
7. **loja/negócio** (pedido NEG → aprovado → vigência; tipo, cor, extras, logo) + **pedido_negocio** + **ficha_obra** + **evento_funil**.
8. **missao_sessao** (morador, área, variante, ini, fim, aceita) e **orçamento da cidade** por área, **decisao_obra** do prefeito, **obra_pronta** (máscara).
9. **mandato** (n, início, fim) e **snapshot semanal** (cargo, posições, pontos → hm/selos/rewind).
10. **visita** (sid, primeira, com @, pwa) e **seguir_loja** (morador, loja, sid, ip).
11. **patrocinador saúde** (cidade, secretário, pontos) e **obra_com_meta** (cidade, id, base, alvo).

---

## 8. Modelo de dados proposto (PostgreSQL)

```sql
-- ======== referência geográfica ========
create table municipio (
  ibge        integer primary key,
  nome        text not null,
  uf          char(2) not null,
  lat         numeric(7,3), lon numeric(7,3),
  pop         integer not null default 0,
  porte       smallint not null default 1,            -- 1..4 (cidade-t3.js › PORTE_IDS)
  x_km        numeric(7,1), y_km numeric(7,1),         -- projeção §4.2 (cache)
  capital     boolean not null default false
);
create index on municipio (uf);

create table mandato (
  n           smallint primary key,
  inicio      timestamptz not null, fim timestamptz not null,
  regras      jsonb not null                           -- versão das regras de pontos (v3/v4)
);

-- ======== moradores ========
create table morador (
  id            bigserial primary key,
  handle        text not null unique,                   -- Hash.norm(@)
  ibge          integer not null references municipio,
  provisoria    boolean not null default false,         -- só disse a UF → capital
  entrada_em    timestamptz not null,                   -- P.e (minuto)
  fundador      boolean not null default false,
  nivel_piso    smallint not null default 1,            -- P.v (nunca diminui)
  partido       char(1) check (partido in ('a','v','y')),
  verificado_em timestamptz,                            -- D.VF
  removido_em   timestamptz,                            -- "quero tirar minha casa"
  seq_cidade    integer not null                        -- ordem dentro da cidade (gi relativo)
);
create index on morador (ibge, seq_cidade);
create unique index morador_fundador_uk on morador (ibge) where fundador;

-- ======== entradas brutas (auditoria / reprocesso) ========
create table post_instagram (id text primary key, publicado_em timestamptz, legenda text, palavra_secreta text, meta_curtidas int);
create table comentario (
  id text primary key, post_id text references post_instagram, handle text not null,
  texto text not null, criado_em timestamptz not null, curtidas int default 0,
  cidade_ibge integer, uf char(2), mencoes text[], processado_em timestamptz
);
create index on comentario (handle, criado_em);
create table story_marcacao (id text primary key, handle text not null, em timestamptz not null);
create table dm (id text primary key, handle text not null, tipo text not null, em timestamptz not null, payload jsonb);  -- texto nunca exibido

-- ======== pontos ========
create table evento_pontos (
  id          bigserial primary key,
  morador_id  bigint not null references morador,
  mandato_n   smallint not null references mandato,
  razao       text not null,          -- casa|comentou|marcou|recrutou|story|envio|voto|voto da página|meta|palavra|curti|compartilhei|marcou loja|seguiu loja|missão <área>|…
  pontos      integer not null,
  em          timestamptz not null,
  origem_tipo text, origem_id text,   -- comentário/story/voto/missão/seguir…
  unique (origem_tipo, origem_id, razao)     -- idempotência
);
create index on evento_pontos (morador_id, em);
create index on evento_pontos (mandato_n, em);

create materialized view pontos_morador as                 -- base de P.t / P.s / poder.json
select morador_id, mandato_n,
       sum(pontos) as total_temporada,
       sum(pontos) filter (where em >= date_trunc('week', now() at time zone 'America/Sao_Paulo') + interval '21 hours' - interval '1 day') as semana,
       sum(pontos) filter (where razao='casa') as casa, sum(pontos) filter (where razao='comentou') as posts,
       sum(pontos) filter (where razao='marcou') as marcou, sum(pontos) filter (where razao='recrutou') as recrutou,
       sum(pontos) filter (where razao='story') as stories, sum(pontos) filter (where razao like 'voto%') as votos
from evento_pontos group by 1,2;

-- ======== votos e ofensiva ========
create table voto (
  id bigserial primary key,
  eleitor_id bigint not null references morador, alvo_id bigint not null references morador,
  cargo text not null check (cargo in ('ver','pref','dep','gov','sen','pres')),
  hora_relogio integer not null,                  -- floor(epoch/3600)
  sid text not null, ip inet, em timestamptz not null default now(),
  aceito boolean not null default true, valor smallint not null default 5,
  unique (eleitor_id, cargo, hora_relogio)        -- 1 voto/hora/cargo
);
create index on voto (alvo_id, em); create index on voto (sid, em); create index on voto (ip, em);

-- ======== cargos (resultado da rodada) ========
create table cargo_semana (
  mandato_n smallint references mandato, calculado_em timestamptz not null,
  morador_id bigint references morador, cargo char(1) not null check (cargo in ('P','S','G','D','M','V')),
  escopo text not null,                           -- 'BR' | uf | ibge
  primary key (mandato_n, morador_id)
);
create table mandato_fechado (                     -- hm/*.json, selos/*.json
  mandato_n smallint references mandato, morador_id bigint references morador,
  cargo char(1), escopo text, pos_brasil integer, pos_cidade integer, pontos integer, fundador boolean,
  primary key (mandato_n, morador_id)
);

-- ======== frases e partidos ========
create table frase (
  morador_id bigint primary key references morador, texto text not null check (length(texto) <= 70),
  cor char(1), prova text, sid text, atualizado_em timestamptz not null default now(), aprovada boolean not null default true
);

-- ======== lojas / negócios ========
create table pedido_negocio (
  codigo text primary key check (codigo ~ '^NEG-[A-Z0-9]{6}$'),
  nome text, insta text, tipo text, tipo_outro text, ibge integer references municipio, cor text,
  whatsapp text, valor integer, plano text, sid text, ip inet, criado_em timestamptz default now(),
  status text not null default 'pendente'          -- pendente|pago|aprovado|recusado|devolvido
);
create table ficha_obra (codigo text primary key references pedido_negocio, pagador text, contexto text, montagem text,
  montagem_texto text, logo_zap text, celular text, insta text, site text, enviada_em timestamptz default now());
create table evento_funil (id bigserial primary key, etapa text, sid text, ibge integer, campo text, variante char(1), em timestamptz default now());
create table loja (
  id text primary key, pedido_codigo text references pedido_negocio, handle text, nome text not null, tipo text not null,
  ibge integer not null references municipio, cor text not null, desde date not null, ate date not null,
  tipo_outro text, descricao text, whatsapp text, instagram text, especial text, logo_slug text, sem_instagram boolean default false
);
create index on loja (ibge, desde, ate);
create table seguir_loja (morador_id bigint references morador, loja_id text references loja, sid text, ip inet, em timestamptz default now(),
  aceito boolean default true, primary key (morador_id, loja_id));

-- ======== cidade que evolui (CV) e missões ========
create table obra_catalogo (k smallint primary key, id text unique, nome text, area smallint, custo_base integer, nivel smallint);
create table cidade_estado (
  ibge integer primary key references municipio, mandato_n smallint references mandato,
  pts_agua integer default 0, pts_infra integer default 0, pts_saude integer default 0, pts_seg integer default 0,
  mask_prontas integer default 0,                 -- 25 bits
  obra_agua smallint, obra_infra smallint, obra_saude smallint,   -- k em andamento (null = nenhuma)
  gasto_agua integer default 0, gasto_infra integer default 0, gasto_saude integer default 0
);
create table decisao_obra (id bigserial primary key, ibge integer references municipio, prefeito_id bigint references morador,
  obra_id text, sid text, em timestamptz default now(), aplicada_em timestamptz);
create table missao_sessao (
  id bigserial primary key, morador_id bigint references morador, ibge integer references municipio,
  area smallint not null check (area between 0 and 3), variante text, sid text, ip inet,
  ini timestamptz not null, fim timestamptz, aceita boolean,
  check (fim is null or fim >= ini + interval '8 seconds')
);
create index on missao_sessao (morador_id, area, fim desc);     -- janela de 12 h

-- ======== patrocínio e obras com meta ========
create table patrocinio_saude (ibge integer primary key references municipio, secretario_id bigint references morador, pontos integer default 0);
create table obra_meta (ibge integer primary key references municipio, obra_id text, nome text, base integer, alvo integer);

-- ======== telemetria ========
create table visita (id bigserial primary key, sid text, primeira boolean, com_eu boolean, pwa boolean, em timestamptz default now());
create index on visita (em);
```

Jobs: (1) ingest a cada ~20 min: Graph API → `comentario/story/dm` → regras → `evento_pontos`, `voto` aceito/recusado,
`missao_sessao.aceita`, `seguir_loja.aceito`; (2) apuração: `cargo_semana`, `cidade_estado`; (3) build: materializa
`__DADOS` (gi = `row_number() over (order by ibge, seq_cidade)`), JSONs e shards; (4) domingo 21h: fecha mandato →
`mandato_fechado`, zera semana, aplica piso de nível.

---

## 9. Privacidade

### 9.1 O que é público de fato (dados.js, sem autenticação)

* **Todos os 159 047 @** (normalizados) em `u`, cidade de cada um (`c`), se a casa é provisória (`p`), pontos totais/da semana,
  **minuto de entrada**, nível, cargo (`P`), partido (`PT`), frase (`FR`), se é verificado (`VF`), se está "em alta" (`S`),
  secretário do patrocinador (`F.s`), prefeito de cada cidade (`CV.c`).
* `poder.json`: composição dos pontos de **cada** morador; `eleicao.json`: votos recebidos/dados/horas votando por @ (28 389 pessoas),
  **quem votou em quem** nos últimos 40 votos (`ultimos`), líderes por cidade; `ofensiva.json`: votos dados por @ (26 716); `missoes.json`:
  @ que fizeram missões hoje e quando liberam; `ev/*`: extrato individual com hora de cada ponto; `hm/*`, `selos/*`: histórico por gi.
* Lojas: @, WhatsApp e descrição dos anunciantes (`L[9].w` — dado comercial, fornecido por eles).
* Só o `rewind/p/*` é indexado por hash do @ (não lista quem tem casa).
* Vercel Web Analytics (sem cookies); nenhum cookie próprio; estado só em localStorage.

### 9.2 O que `privacidade.html` promete (15/10/2026)

* **Usa:** comentários públicos nos posts da página (@, texto, data/hora, curtidas) — dali só a cidade/UF ou a obra sugerida;
  DMs com o nome da cidade (valem como comentário; respondidas por lá); stories que marcam a página (só o fato); número total de seguidores.
* **Não usa:** senha, e-mail, telefone, fotos, localização, quem segue, quem curtiu; o texto das DMs nunca aparece no site/vídeos;
  pede para não escrever endereço, telefone ou Pix nos comentários; "casa e cargo não se compram: nunca pedimos dinheiro"
  (o fluxo pago é só para **negócios**, não para casas/cargos).
* **Finalidade:** montar o mapa, fundadores, governadores, pontos e cargos da semana (comentários, marcações, votos "voto @fulano",
  stories). Cargos são brincadeira, sem relação com eleições reais.
* **Onde o @ aparece:** sobre a casa no site e nos vídeos; fundadores e governadores em destaque.
* **Compartilhamento:** com ninguém; leitura via **API oficial do Instagram** (Termos da Plataforma Meta).
* **Retenção:** enquanto o projeto existir ou até a pessoa pedir para sair ("Excluir meus dados", vale para responsáveis).
* **Contato:** DM para a página.

### 9.3 Lacunas a tratar numa reimplementação

* `ultimos` expõe o par eleitor→candidato com timestamp; `pessoas` expõe horas votando; `ev/*` expõe horários individuais. A política
  fala só em "@ sobre a casa". Recomenda-se agregar ou pseudonimizar esses campos.
* Lojas: WhatsApp do anunciante no `dados.js` — OK por ser dado comercial, mas convém consentimento explícito no pedido (`ciente: true` já existe).
* `NEG_CFG` publica nome completo e LinkedIn do criador e o Pix com o nome do titular — decisão do produto, não um vazamento.
* Não há endpoint de exclusão: "Excluir meus dados" é manual por DM; o modelo acima prevê `morador.removido_em` e remoção no build.

---

## 10. Incertezas e pendências

* `eleicao.json › cidades[ib][1]` e o 3º número de `cidades[ib][2][cargo]` não são lidos pelo front (significado inferido).
* `poder.json › top[][1..2]` (semana × total) inferido pela coincidência com `max(P.xt)`.
* `TERRENO.dens` canal B/A: uso no engine (`dmBytes[k+2]/8` quando `A≠0`) sugere altura/categoria de mata; não confirmado.
* `cidades-t3.json`, `municipios-pop.json`, `rewind/*`, shards > 0 e `/v/` não foram baixados: estrutura vem só dos comentários do código.
* As funções `/api/*` não são visíveis: payloads vêm do front; respostas de erro reais (textos de `erro`) não foram observadas.
