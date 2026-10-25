# Engenharia reversa — 01 · Motor 3D

Especificação técnica para reimplementar do zero o motor 3D do jogo social "mapa do Brasil em maquete" (cada jogador tem uma casa na sua cidade). O documento descreve o que o código faz, em prosa e pseudocódigo, com as constantes e tabelas numéricas que definem o resultado visual. Não é uma transcrição do código.

Fontes analisadas (arquivo `app.js` legível, sem Three.js r160):

| Faixa de linhas | Módulo original | Papel |
|---|---|---|
| 8 – 1 890 | `cidade-t3.js` (objeto `Cidade`) | Gerador procedural de cidades (urbanismo puro), nível T3, ambiente (nuvens, clareiras, névoa) e `criarRender` (geometrias, instancing, fitas, placas) |
| 1 890 – 2 180 | `relevo.js` (objeto `Relevo`) | Decodificação do relevo e biomas, achatamento sob cidades, malha adaptativa (quadtree), GLSL do chão |
| 2 180 – 2 376 | `layout.js` | Ordem persistente dos moradores, casas anônimas (cinza), obras, especificações para `urbanizar`, layout fatiado |
| 11 794 – 12 938 | `world3d.js` (`criarMundo`) | Renderer, paleta pré-compensada ACES, luz, céu, continente, mar, fitas, árvores, marcadores, poeira, câmera (Mesa e Mapa), entrada, governador de desempenho, laço, `atualizar(layout)`, API pública |

Convenções deste documento:

- "km" é a unidade de todo o mundo. Uma casa tem ~1 km de largura (é uma maquete, não uma escala real).
- `hashN(...)`, `h2(a,b,s)`, `vnoise` e `rng32` são as funções determinísticas descritas em §3.2. Toda aleatoriedade do gerador vem delas; não há `Math.random`.
- "T" é o Three.js; "U" é o conjunto de uniforms compartilhados.
- Nomes de patrocinadores e identificadores de usuários reais foram omitidos. A opção de "hospital de parceiro" do gerador aparece aqui como `o.parceiro` (no original o nome da chave é a marca do parceiro).

---

## 1. Visão geral da arquitetura

### 1.1 Módulos e dependências

```
dados (window.__DADOS): municípios (id IBGE, nome, UF, lat, lon), CV (obras T3), moradores
TERRENO: polígonos das 27 UFs (km), fronteiras, costa, rios, mapa de densidade de mata 256×264,
         relevo 384×384 (altura, relevo local, bioma), projeção (lon0, lat0, kx, ky)

        ┌──────────────┐    specs     ┌────────────────────┐   cidades   ┌─────────────────────┐
        │  layout.js   │ ───────────► │ Cidade.urbanizar / │ ──────────► │ criarMundo.atualizar │
        │ ordem, cinza │              │ construirCidade    │             │  (world3d.js)        │
        │ obras, sig   │ ◄─────────── │ (cidade-t3.js)     │             │   └► CR.atualizar    │
        └──────────────┘   layout     └────────────────────┘             │      (criarRender)   │
                                            │  terra(x,y) ◄── criarTerra  └─────────────────────┘
                                            │  nivelDe(ibge) ◄── CV                 │
                                            ▼                                        ▼
                                      Relevo.criar ──── Y(x,y), achatar(), geometria() ──► laje + malha
```

- **`Cidade`** (cidade-t3.js) é puro e determinístico na parte 1 (urbanismo: sem Three, roda em Node para testes). A parte 2 (`criarRender`) recebe `THREE` e monta geometrias instanciadas. A parte 3 (ambiente) fornece ruído de clareiras, textura de clareiras, tom das árvores da mata, névoa suave e nuvens com sombra.
- **`Relevo`** é opcional: só existe se `TERRENO.relevo` veio no build. Sem ele, o mundo é plano (y = 0) com laje extrudada.
- **`layout.js`** transforma o estado do jogo (moradores ativos, seguidores, obras, dia) em especificações `{ibge, centro, nome, uf, moradores[]}` por cidade, chama `Cidade.urbanizar` (ou a versão geradora fatiada) e devolve um `layout` com `cidades`, `casas` achatadas, `obras`, índices e uma assinatura.
- **`criarMundo`** (world3d.js) é o motor em si: cria renderer, cena, materiais, câmera, entrada e laço; recebe o `layout` via `atualizar(L)` e delega a montagem das cidades ao `CR = Cidade.criarRender(T, {scene, A, U})`.

### 1.2 Dois modos do mesmo mundo

`criarMundo(canvas, opts)` tem dois comportamentos escolhidos por `opts.mapa`:

| | Modo **Mesa** (`opts.mapa` ausente) | Modo **Mapa** (`opts.mapa = {cores, distMin, encaixe}`) |
|---|---|---|
| Escala das cidades | "Infladas" quando a câmera está alta (`cityScale` até 40×, teto por raio) | Escala real (`cityScale = 1`) |
| Câmera | Foco + log-distância + inclinação + rumo, com molas; pinça gira e inclina | Estilo Google/Apple Maps: sem rumo, inclinação função do zoom, arraste direto (o ponto sob o dedo fica sob o dedo), inércia, âncora de zoom |
| Marcadores | Pinos (disco amarelo/escuro) que somem de perto + pulsos de "encheu hoje" | Marcadores com crossfade para a geometria real, tamanho em px pelo nº de casas, cor por cidade; visibilidade decidida pelo site |
| Árvores finas | Região de 55 km em volta do foco quando h < 170 km | Conjunto gerado para o frustum, espaçamento ∝ distância, crossfade A/B, fade por distância 60–115 km |
| Tinta por estado | Não | Textura com a cor de cada UF misturada ao chão quando a câmera está alta |
| Fronteiras | Traço branco 50 % | Traço escuro (4,6 px) + branco (2,3 px) por cima |

### 1.3 Fluxo por quadro (`laco`)

```
requestAnimationFrame →
  dt = min(0.05, agora − último)
  dimensionar()                 # canvas ↔ tamanho CSS, DPR
  renderQuadro(dt):
     passoCamera(dt)            # molas / inércia / âncora
     c = ajustar(t)             # posiciona câmera, uniforms globais (cityScale, capR, fog, treeScale, tint…)
     céu, névoa, mar seguem a câmera; sombra direcional segue o ponto olhado
     LOD (CR.lod), pinos, árvores finas (passoFine ou passoArvoresMapa), marcadores
     poeira, anel de seleção
     renderer.render(scene, camera)
     opts.aoQuadro({dt, h, cs, D})
  governar(dt)                  # fps → nível de qualidade
```

---

## 2. Sistema de coordenadas, caixa do mundo e escalas

### 2.1 Projeção geográfica → km

Equiretangular centrada no Brasil (`TERRENO.proj`):

```
x_km = (lon − lon0) · kx        lon0 = −54.4     kx = 107.79740456749855
y_km = (lat − lat0) · ky        lat0 = −14.2     ky = 111.19492664455873
```

`xyCidade(ibge)` arredonda para 0,1 km. x cresce para **leste**, y para **norte**. Todos os dados de `TERRENO` (polígonos das UFs com furos `h`, `borders`, `coast`, `rivers[{w: 1|2|3, p: [[x,y]…]}]`) já estão nessa unidade.

### 2.2 Eixos no Three.js

O mundo 3D usa **y para cima** e **z = −y_km**:

```
posição_3D = (x_km, altura_km, −y_km)
```

Consequências que aparecem em todo o código:
- normais de fitas: `(nx, 0, −ny)`;
- "frente" de uma casa (yaw) = `atan2(dx, −dy)` do vetor de frente em km;
- `chaoEm()` devolve `{x: hit.x, y: −hit.z}`;
- a textura de densidade é amostrada com `v = (−z − miny)/h`.

### 2.3 Caixas e limites

| Nome | Valor | Uso |
|---|---|---|
| `dens.box` / `CLR_BOX` | x −2140, y −2200, w 4280, h 4400 (km) | Mapa de mata 256×264, textura de clareiras 512×512, tinta das UFs, árvores grossas |
| `relevo.box` | idem (grade 384×384, hmax 3000 m, σ 10 km) | Relevo e biomas |
| `BB` | bounding box dos polígonos das UFs (≈ −2112…2114 × −2174…2165) | Limites de foco e `dFit` no modo Mapa |
| `LIM.bx, by` | 2250, 2300 | Limite de foco no modo Mesa |
| `SLAB` | 400 km | Espessura da laje extrudada do continente (para baixo) |
| Caixa da malha de relevo | (−3000, 0, −3000)…(3000, 30, 3000) | `boundingBox` fixo para não recalcular |

### 2.4 Escalas de desenho

- Casa térrea: caixa 1,0 × 0,52 × 0,8 km (largura × altura × profundidade) + telhado até 0,94 km.
- Quadra: `Su ≈ 3,5–5,0 km` de largura, `Sv ≈ 7,5–13 km` de comprimento, `nLotes = max(4, round((Sv − 1,4)/1,32))` lotes por lado.
- Rua: meia-largura 0,30 km (+0,07 de meio-fio); avenida 0,78 (calçada até 0,9); anel da praça 0,3.
- Praça: raio externo `Rp = 2,3 · esc`, anel `Ra = 1,95 · esc`, `esc` por porte (1,0 / 1,1 / 1,28 / 1,45).

### 2.5 "Inflação" das cidades (`escalaVisual`)

Para a cidade continuar legível com a câmera a centenas de km, cada vértice de cidade é escalado em torno do centro da cidade pelo fator:

```
cap(r)  = capR · (0.35 + 0.65 · sqrt(min(1, r/90)))
cityS(r) = max(1, min(cityScale, cap(r) / max(r, 0.5)))
```

onde `r` é o raio real da cidade (km), `cityScale` sobe com a altura da câmera (`h/70`, teto 40, ver §7.6) e `capR = 110 · boost · CR.fator()` (boost = clamp(1400/alturaTela, 1, 1,7); `fator = clamp(sqrt(150/nCidadesComCasas), 0,3, 1)` reduz o teto quando há muitas cidades). A mesma fórmula existe em JS (`Cidade.escalaVisual(r, cs, capR)`) e em GLSL (`cityS`). No modo Mapa `cityScale = 1`, logo nenhuma inflação.

### 2.6 Máscara terra × mar (`criarTerra`)

`criarTerra(ufs)` devolve `terra(x,y) → bool` rasterizando os polígonos (anel externo `o` + furos `h`) em ladrilhos de 128 km com células de 0,5 km (256×256 bits por ladrilho), sob demanda e em cache. Algoritmo clássico de scanline por paridade: para cada linha de células, coleta as interseções x das arestas, ordena, preenche entre pares. Usado pelo gerador (`noTerra`) para não pôr lotes, ruas ou avenidas no mar. Opcionalmente recebe `{relevo}` e ganha `.altura(x,y)`.

`world3d` tem a sua própria `isLand(x, y, hintUF)` por ponto-em-polígono com bounding boxes pré-calculados (usada para as árvores da mata).

---

## 3. Gerador de cidade (`Cidade.construirCidade`)

### 3.1 Entradas e saída

```
construirCidade(o)
  o.ibge        código IBGE (semente padrão)
  o.seed        semente explícita (opcional; padrão = ibge; 0 vira 1)
  o.centro      [x, y] km da praça
  o.moradores   lista ordenada; cada item {key, h, tipo (0 real · 1 provisória · 2 anônima), flag (fundador), nv (nível 1–50), c (cargo 'P','S','G','D','M','V')}
                 ou null (buraco: quem saiu deixa o lote vago)
  o.terra       função terra(x,y) ou null
  o.nome, o.uf, o.lat, o.lon
  o.porte       1–4 força o porte (senão tabela por IBGE)
  o.tracado     força o traçado
  o.t3          força nível T3 (testes)
  o.lojas       n ≥ 1 reserva n grupos de lotes para lojas (opção comercial; inerte sem ela)
  o.parceiro    reserva meio quarteirão para um hospital de parceiro (opção comercial; inerte sem ela)
```

Saída (objeto cidade):

```
{ ibge, nome, uf, lat, lon, centro, seed, r (raio da mancha, km), n (nº de casas), faltou,
  casas[], ruas[], marcas[], avenidas[], quadras[], predios[], marcos[], vagas[], praca{}, arvores[],
  anel[], gramado[], temAvenida, hospital, cassino, parceiro?, lojas?, fundador, conquistas[], proxima{},
  quadroMax, igreja, perfil{}, local{th, mapa(u,v), warp(u,v)}, nivel, urb{}, sitiosCiv[] }
```

Regra de ouro do gerador: **a posição de cada casa depende só da semente e da ordem do morador, nunca do número total de moradores nem do nível T3**. Por isso as reservas (prédios, hospital, cassino, sítios cívicos) são escolhidas por rank fixo e o número de lotes gerados tem folga grande (≥ nTot + 220).

### 3.2 Funções determinísticas

| Função | Definição | Uso |
|---|---|---|
| `rng32(seed)` | Mulberry32 (`s += 0x6D2B79F5` …) → [0,1) | sequências (casas anônimas, nuvens, árvores grossas) |
| `hashN(str)` | FNV-1a 32 bits + avalanche (`^>>>13, *0x5bd1e995, ^>>>15`) / 4294967295 | sorteios por chave de texto (`'tr#'+seed`) |
| `h2(a,b,s)` | mistura inteira (`a·374761393 + b·668265263 + s·2147483647`, `^>>>13 · 1274126177 ^>>>16`) / 4294967295 | ruído por célula / lote |
| `vnoise(x,y,s)` | value noise bilinear com smoothstep sobre `h2` | warp da malha, clareiras |
| `sstep(a,b,x)` | smoothstep | em todo lugar |

### 3.3 Marcos e conquistas

```
MARCO = { predio: 100, hospital: 1000, cassino: 10000 }       # casas necessárias
marcosDe(n)        → { predios: floor(n/100), hospital: n ≥ 1000, cassino: n ≥ 10000 }
proximaConquista(n)→ { nome, faltam, meta, de }  # próximo múltiplo de 100; vira 'HOSPITAL' se 1000 cai nesse intervalo, 'CASSINO' se 10000
conquistas(n)      → lista [{tipo, nome: 'kº PRÉDIO' | 'HOSPITAL' | 'CASSINO', em}] ordenada por `em`
```

### 3.4 Personalidade da cidade (`perfilDe`)

Tudo decidido por `Hh(k) = hashN(k + '#' + seed)`; nada depende do nº de moradores.

**Porte** (1–4) por lista fixa de códigos IBGE (`PORTE_IDS`): 15 metrópoles no porte 4 (≥ 1 mi hab.), ~80 cidades no porte 3 (300 mil – 1 mi), ~270 no porte 2 (100–300 mil); o resto é 1. `o.porte` sobrepõe.

**Traçado**: forçado por `TRACADO_ESPECIAL` para 16 capitais (ex.: Brasília, Palmas e Maringá = `planejada`; Belo Horizonte e Curitiba = `diagonal`; Goiânia, Boa Vista, São Paulo, Campinas, Porto Alegre = `radial`; Rio, Salvador, São Luís, Recife, Belém = `organica`; Fortaleza = `grade`), senão sorteado pela tabela do porte:

| Porte | grade | diagonal | radial | organica | planejada | vila |
|---|---|---|---|---|---|---|
| 4 | 0,30 | 0,22 | 0,22 | 0,16 | 0,10 | – |
| 3 | 0,36 | 0,18 | 0,16 | 0,20 | 0,10 | – |
| 2 | 0,46 | 0,12 | – | 0,18 | 0,10 | 0,14 |
| 1 | 0,34 | – | – | 0,28 | – | 0,38 |

Parâmetros por traçado (intervalos são sorteados por `Hh`):

| Traçado | Su (km) | Sv (km) | amp | f1 | amp2 | swirl | braços | aniso | avDesde | extras |
|---|---|---|---|---|---|---|---|---|---|---|
| grade | 3,6–4,1 | 10–13 | 0,5–1,4 | 0,016 | 0,25 | 0 | cruz | 1 | 20 | |
| organica | 3,5–3,9 | 7,5–9,5 | 1,8–2,6 | 0,021 | 0,35 | 0,2–0,45 | cruz | 1 | 28 | hwAv 0,64 · hwAvCalc 0,8 |
| vila | 3,6–4,0 | 8–10,5 | 0,8–1,8 | 0,02 | 0,3 | 0 | rua (só eixo v) | 2,0–3,0 | 40 | hwAv 0,62 · hwAvCalc 0,76 |
| planejada | 4,4–5,0 | 9–11 | 0 | 0,016 | 0 | 0 | cruz | 1 | 12 | hwAv 1,0 · hwAvCalc 1,18 · roAv 1,85 · aAv 1,45 · avExtra 0,72 · alinhado |
| diagonal | 3,6–4,0 | 10–12 | 0,3–0,8 | 0,016 | 0,15 | 0 | estrela (8) | 1 | 20 | |
| radial | 3,5–3,9 | 9–11 | 0,8–1,5 | 0,018 | 0,3 | 0,15–0,35 | estrela (8) | 1 | 20 | |

Base `G` (valores padrão, sobrescritos pelo traçado): `Su 3,7 · Sv 12 · nLotes 8 · avExtra 0,52 · hwRua 0,30 · hwCalcada 0,07 · hwAv 0,78 · hwAvCalc 0,9 · roRua 1,0 · roAv 1,52 · aRua 0,68 · aAv 1,2 · praca 2,3 · anel 1,95 · avDesde 20`.

Derivados: `Su *= 0,96` em metrópoles não planejadas; `nLotes = max(4, round((Sv−1,4)/1,32))`; `f2 = f1·2,8`; `swirl` recebe sinal aleatório; `diag = (braços == 'estrela')`.

**Praça**: `esc = ESC_PRACA[porte] (1,0 · 1,1 · 1,28 · 1,45) × (0,92 vila | 1,1 planejada)`. Tipo pela `TABELA_PRACA` do porte (fonte / coreto / arborizada / monumento; planejada: monumento 0,45, coreto 0,3, arborizada 0,25). Forma = expoente da superelipse `PRACA_FORMA = {fonte 2, coreto 4,6, arborizada 2,3, monumento 3,2}`, 6 nas planejadas. Bits `PRACA_TIPOS = {fonte 1, coreto 2, arborizada 4, monumento 8}`. `Rp = 2,3·esc`, `Ra = 1,95·esc`.

Tabela de praça por porte: 4 → monumento 0,30 · fonte 0,30 · arborizada 0,26 · coreto 0,14; 3 → fonte 0,30 · monumento 0,24 · arborizada 0,24 · coreto 0,22; 2 → fonte 0,28 · coreto 0,28 · arborizada 0,22 · monumento 0,22; 1 → coreto 0,34 · fonte 0,28 · arborizada 0,22 · monumento 0,16.

**Igreja**: probabilidade 0,95 (0,55 planejada). Estilo: 1 = catedral de duas torres (porte ≥ 3, 60 %), 2 = capela (vila ou porte 1, 45 %), 0 = matriz.

**Densidade do miolo** (`DENS[porte]`), probabilidade de casa de 3 andares (`pA = a0·e^(−d/ar)`) e de sobrado (`pS = s0 + s1·e^(−d/sr)`), d = distância ao centro no quadro local:

| Porte | a0 | ar | s0 | s1 | sr |
|---|---|---|---|---|---|
| 1 | 0 | 6 | 0,07 | 0,2 | 8 |
| 2 | 0,1 | 7 | 0,13 | 0,26 | 12 |
| 3 | 0,22 | 10 | 0,18 | 0,34 | 18 |
| 4 | 0,45 | 14 | 0,22 | 0,4 | 24 |

Planejada: `a0 *= 0,25; s1 *= 0,7`. Vila: `s0 *= 0,6; s1 *= 0,6`.

**Altura dos prédios‑marco**: `ALTURA_PREDIO[porte] = [fator, bônus]` = `[0,62,0] · [0,82,0] · [1,0,6] · [1,1,6]`.

**Paleta da cidade**: sorteio ponderado **sem reposição** (chaves exponenciais `−ln(u)/peso`) de paredes (`PESO_PAREDES = [1,1 1,5 1,2 1,2 0,9 1,2 1,0 1,0 0,5 1,0]`) e telhados (`PESO_TELHADOS = [3 2 1,1 0,7 2 1,6 1,6 0,8]`, só os índices 0–7; 8–11 são os cinzas das anônimas). A ordem sorteada vira a paleta: `palW = [0,0,0,0,0,1,1,1,2,2,3]` e `palT = [0,0,0,0,1,1,1,2,2,3]` indexam a lista sorteada (1 dominante + secundárias). Cada casa escolhe `pickA(palW, hash)`.

**Vegetação**: `verde = lerp(0,55, 1,45, Hh)`, `verdeCentro = 0,45 (porte ≥ 3) | 0,8`. `palmaP = clamp((trop 0,5 | sudeste litoral 0,32 | 0,06) + (costa a < 11 km ? 0,22 : 0) + (Hh−0,5)·0,3, 0, 0,8)`, com `UF_TROPICAL = {AM PA AP RR AC RO TO MA PI CE RN PB PE AL SE BA}` e `UF_LITORAL_SUDESTE = {RJ ES}`. `flor` (55 %): 1 ipê amarelo · 2 ipê rosa · 3 flamboyant · 4 jacarandá.

**Costa** (`costaDe`): amostra 24 direções × raios {3, 5, 7,5, 10, 13} km; se 5 ≤ nÁgua ≤ 78 % do total, devolve `{ang: rumo médio da água, dist: menor raio com água, frac}`.

**Rotação da grade** `th`: `hashN('rot'+seed)·π/2`; planejadas: 0 ou 15°; com costa (85 %): rumo da água arredondado a múltiplos de 15° ± 0,06 rad.

### 3.5 Malha local: eixos u/v, dobra e rotação

Quadro local (u = atravessa as quadras, v = ao longo dos lotes). Linhas de quadra:

```
ub(i) = 0 se i=0 ; i·Su + avExtra se i>0 ; i·Su − avExtra se i<0      # a avenida central ganha folga
vb(j) = idem com Sv
ro(i) = roAv se i=0 senão roRua         # recuo da fileira de casas em relação à linha
aE(j) = aAv se j=0 senão aRua           # folga entre a esquina e o 1º lote
```

**Warp** (dobra orgânica), aplicado antes da rotação:

```
f = sstep(4, 24, |uv|)                      # some perto do centro (praça e avenidas regulares)
a = (vnoise(u·f1+wx, v·f1+wy, s1)·2−1)·amp + (vnoise(u·f2+wy, v·f2+wx, s1+1)·2−1)·amp2
b = (vnoise(u·f1−wy, v·f1+wx, s1+2)·2−1)·amp + (vnoise(u·f2+wx, v·f2−wy, s1+3)·2−1)·amp2
x = u + a·f ; y = v + b·f
se swirl ≠ 0: rotação por ângulo swirl·sstep(3, 42, |uv|)
```

com `s1 = seed mod 9973`, `wx = hashN('wx'+seed)·300`, `wy = hashN('wy'+seed)·300`.

`mapa(u,v) = centro + R(th)·warp(u,v)`. `frente(u,v,fu,fv)` = yaw da casa: diferença finita (passo 0,4) de `mapa` na direção da frente, `atan2(dx, −dy)`. `ringR(ang) = Ra · (|cos|^forma + |sin|^forma)^(−1/forma)` (raio do anel superelíptico na direção `ang`). `distDiag(u,v) = min(|u−v|, |u+v|)/√2`.

### 3.6 Lotes candidatos, do centro para fora

`gerar(R)` percorre células `c ∈ [−cmax, cmax]`, `j ∈ [−jmax, jmax]` (`cmax = ceil(R/Su)+1`), descarta colunas/linhas inteiramente além de R (+1), e nas vilas as colunas além de `0,78·R/aniso + 1,6` (mancha estreita em u). Em cada célula: `v0 = vb(j)+aE(j)`, `v1 = vb(j+1)−aE(j+1)`, `len = (v1−v0)/nLotes`; para cada lado (`side 0`: `u = ub(c)+ro(c)`, frente `fu = −1`; `side 1`: `u = ub(c+1)−ro(c+1)`, `fu = +1`) e cada `k < nLotes`: `v = v0 + (k+0,5)·len`.

Filtros: `d = |uv| ≤ R` e `d ≥ Rp + 1,1`; nos traçados `diag`, `distDiag ≥ hwAvCalc + 0,78`; `mapa(u,v)` em terra; os 4 cantos do lote (±0,55 u, ±0,5 v, só rotação) em terra.

Chave de ordenação: `key = dk·(1+ruído) + h2(c·31+k, j·17+side, s1)·0,01`, com `dk = d` (ou `hypot(u·aniso, v)` nas vilas) e `ruído = (vnoise(u·0,07+wx, v·0,07+wy, s1+5)·2−1)·0,2`. Marca `av = true` nos lotes de frente para as avenidas (c = 0 lado 0, c = −1 lado 1, j = 0 k = 0, j = −1 k = nLotes−1). Lista ordenada por `key`.

Raio inicial `Rc = max(16, sqrt((nTot+200)·3,2/π)·1,4/0,78·aniso^0,6)`. Laço de até 7 tentativas:

```
lotes = gerar(Rc) truncados em key ≤ 0,78·Rc        # só a parte "segura" (sem buracos na borda)
reservas(...)                                      # §3.7
casas ocupam, em ordem, os lotes não reservados; ultimoRank = índice do último ocupado
se colocou todos e lotes.length ≥ nTot + 220: fim
Rc *= 1,6 ; para se Rc > 100 + 5·sqrt(nTot+4)·aniso^0,6
```

### 3.7 Reservas (por rank fixo de lote)

Com `achar(alvo, n, janela)`: a partir do índice `alvo`, primeiro só lotes `av` numa janela, depois qualquer lote até 400 à frente; precisa de `n` lotes vizinhos (`k, k+1, …` no mesmo lado da mesma célula) livres.

| Reserva | Regra |
|---|---|
| Igreja | o 1º lote `av` entre os 30 primeiros com `|v| > 0,8·|u|` (frente para a praça); senão o lote 0. Só desenhada se nCasas ≥ 1. |
| Lojas (opção) | até 4 grupos de `NKL = min(3, nLotes)` lotes × 2 lados (meio quarteirão) o mais perto do centro, preferindo quadra "larga" (`|Δu| + 1,6 ≥ 3,0`) e fora da faixa de visão de outra loja (|dx| < 4,4, |dy| < 6 km; a câmera olha do sul). Os lotes ao sul de cada loja (meia‑largura 3,8, profundidade 7 km) ficam proibidos para construções altas. |
| Hospital do parceiro (opção) | meio quarteirão `NK = min(4, nLotes)` × 2 lados a partir do rank 40. |
| Hospital (marco) | `achar(650, 2, 90)` — 2 lotes a partir do rank 650 |
| Cassino (marco) | `achar(2400, 3, 120)` — 3 lotes a partir do rank 2400 |
| Prédio k | `achar(rank(k) + round(h2(k,7,s1)·6), 1, 70)` com `rank(k) = round(70·k^0,85)`, enquanto `R + 100 < lotes.length` |

### 3.8 As casas

Para cada lote com morador (`l.m`):

```
yaw     = frente(u, v, fu, 0) + (hsh − 0,5)·0,06           # leve desalinhamento
andares = 3 se hA < pA ; 2 se hA < pA + pS ; senão 1        # pA, pS de §3.4 com dd = |uv|
sx = 0,92 + 0,18·h2(k, j, s1+3) ; sy = 0,9 + 0,22·h2(k, c, s1+4)
tom = floor(hsh·4)                                          # 0..3, variação de cor
pi  = −1 se anônima senão pickA(palW, hW)                    # índice de parede
ti  = 8 + floor(hT·4) se anônima senão pickA(palT, hT)       # índice de telhado (8–11 = cinzas)
tipo, flag, h, key copiados do morador; nv = clamp(1..50); c = cargo
```

**Adensamento T3 (`dn`)** — só desenho, só para casas reais (`tipo 0`), com `q = h2(...)`:

| Nível | dd < 4,5–4,8 | até 8–8,5 | até 12,5–13 | até 18 |
|---|---|---|---|---|
| 3 | 4 (q<0,55) senão 2 | 2 (q<0,6) | – | – |
| 4 | 7 + floor(q·3) | 4 (q<0,8) senão 2 | 2 (q<0,55) | – |
| 5 | 8 + floor(q·4) | 7 + floor(q·3) (q<0,75) senão 4 | 4 (q<0,8) senão 2 | 2 (q<0,5) |

`dn` é um índice de **modelo** (ver §6.8.6: 2 = casa alta, 4 = torre, 7+ = prédios dos níveis 6+), e o render usa `max(modeloDe(h), dn)`.

Fundador: a 1ª casa com `flag` não anônima (senão a 1ª não anônima); `praca.temBandeira = !!fundador`.

### 3.9 Marcos desbloqueados, terrenos vagos e igreja

Para cada reserva, se `idx ≤ ultimoRank + 1` (ou prédio já desbloqueado):

- **Prédio k**: se `k ≤ floor(n/100)` → `predios.push({tipo 'predio', k, desbloqueio k·100, x, y, yaw, andares, id 'p'+k})` com `andares = clamp(round((3 + 9·e^(−idx/650) + h2(k,3,s1)·2,4)·alturaF + alturaB), 3, 12)`. Senão, se `idx ≤ ultimoRank + 40`, vira `vagas` (terreno com 3 árvores).
- **Hospital/Cassino**: centro = média dos lotes do grupo; `largura = nLotes·len`; ativo se `n ≥ 1000 / 10000`, senão vaga larga.
- **Igreja**: `{x, y, yaw de frente para a praça, estilo, pi ∈ [0,0,1,0,5,7][hash·6], ti: 0 (45 %) · 1 (25 %) · 4 (15 %) · 2}`.
- `marcos` ordenados por `desbloqueio`.

### 3.10 Sítios cívicos T3 (`T3_SITIOS`)

Escolhidos **depois** das casas, só em lotes que nenhuma casa nem reserva usa, no anel seguinte ao último lote ocupado (`key ≥ keyÚltimo + 2,2`), a partir de uma malha maior (`gerar(Rc·1,7 + 16)`). Ordem fixa e tamanho:

```
posto u2 · cultural m2 · caixa u1 · upa m2 · escola m4 · parque cel · hospital m4 · shopping cel ·
estadio cel · hospuni m4 · aquatico cel · roda m2 · pesq m4
u1 = 1 lote · u2 = 2 lotes · m2 = 2×2 (2 lotes, 2 lados) · m4 = 4×2 · cel = quadra inteira (nLotes × 2 lados)
```

Cada sítio **reserva** o espaço mesmo sem obra (fica gramado); só os com `NV.tem.has(key)` entram em `sitiosCiv` com `{x, y, a (yaw ao longo da rua), w (largura atravessando = |Δu| + 1,1), l (comprimento = NK·len), lotes}`.

### 3.11 Ruas, faixas, avenidas, anel e quadras

**Células ocupadas** (`celI`): para cada lote ocupado (casas, marcos, vagas, igreja, sítios cívicos), a célula `(c, j)` guarda o intervalo `[a, z]` em v coberto (±0,55 além do lote); se o intervalo chega a menos de 2,8 km da linha `vb(j)` / `vb(j+1)`, estende até ela.

**Ruas verticais** (`eixo v`): para cada coluna `i ∈ {c, c+1}` de cada célula, junta (`mescla`) os intervalos; pula `i = 0` quando há avenida; se `i = 0` sem avenida, recorta a parte dentro do anel (`−Ra..Ra`). Trechos < 0,5 km são ignorados. `ruas.push({pts: linhaV(ub(i), a, z), hw: hwRua, kind 'rua'})`, com pontos a cada `passo = 1,7 km` passando por `mapa`. Faixa tracejada central (`marcas`, hw 0,028) entre cruzamentos, com recuo 0,9 km dos cruzamentos e 0,4 km das pontas livres.

**Ruas horizontais** (`eixo u`): só onde uma célula **toca** a linha `vb(j)`; trechos contíguos de colunas viram uma rua de `ub(c0)` a `ub(c1+1)`; pula `j = 0` quando há avenida horizontal.

**Avenidas** (a partir de `nCasas ≥ avDesde`): braços que começam no anel (`ringR`) e vão até `ext + 1,1` (mínimo 9 km), onde `ext` é o alcance dos lotes ocupados perto de cada eixo (|u| < Su + 1,2 para o eixo v; |v| < 3 para o eixo u; faixa de 3,6 km em volta das diagonais). Param no mar. Braços: `v+`, `v−` sempre; `u+`, `u−` se braços ≠ 'rua'; 4 diagonais se `diag` e `nCasas ≥ avDesde + 20`. Cada avenida: `{pts, hw: hwAv, hwCalc: hwAvCalc, eixo, sg, loc, can (canteiro: 0,17 · 0,24 nível ≥ 2 · 0,3 nível ≥ 4), bus (nível ≥ 3)}`, duas faixas brancas tracejadas em ±0,42 km e árvores a cada 1,15 km (`s = 0,44 + hs·0,14`, floridas e palmeiras por probabilidade).

**Anel da praça**: superelipse de raio `Ra`, 56 segmentos, `hw 0,3`, `kind 'anel'` (nunca recortado pelo mar).

**Quadras**: para cada célula ocupada, fita de meia‑largura `(ub(c+1)−ub(c))/2` centrada em `um` ao longo de `[a, z]` (mancha de gramado claro).

**Recorte no mar** (`recortar`): com `terra`, cada polilinha é partida onde o eixo ou qualquer uma das duas bordas (`±hw`, com folga +0,2 ruas / +0,1 marcas / ×0,95 quadras) sai da terra.

### 3.12 Praça e árvores

`praca = {x, y, r: Ra, nome, uf, fundador, mastro{x,y}, placa{x,y,yaw} em (−0,9·esc, −1,0·esc) de frente para o sul local, gramado (disco r 0,9, 24 pts), temBandeira, tipo, bit, forma, escala}`.

Árvores (`arvores[] = {x, y, s (escala), r (rotação), tom, tipo, flor, palma}`):

- **Calçada**: nos lotes de `k` ímpar com `hs3 < pCal`, `pCal = clamp(0,5 + 0,55·vd, 0,3, 1)`, `vd = verde·(verdeCentro se dd < 9)`; posição `u − fu·0,52`, `v − len/2`; `s = 0,36 + hs2·0,12`.
- **Quintal**: `hs < pQuint`, `pQuint = clamp(0,2·vd + 0,3·sstep(4, 24, dd), 0,05, 0,75)`; posição `u + fu·0,78`; `s = 0,38 + hs2·0,2`.
- **Terrenos vagos**: 3 árvores `s = 0,5 + hs·0,2`.
- **Praça**: por tipo — fonte 9 em anel r 1,25·esc; coreto 8 nos cantos; arborizada 8 (r 1,3) + 6 (r 0,72); monumento 6 (r 1,22). `palma` com `palmaP·0,85`.
- Floridas: `flor` da cidade com prob. 0,34 na praça, 0,2 nas ruas/calçadas.

### 3.13 Raio da mancha e retorno

`r = max(Ra + 1,2, max(|lote − centro|) + 1,4, |fim de avenida − centro| + 0,5)`. `quadroMax` = distância máxima de lote. `faltou` = moradores sem lote (nunca em condições normais).

### 3.14 Casas anônimas (`anonimas(muns, n, seed = 20261014)`)

`n` sorteios com `rng32(seed)` sobre a distribuição cumulativa da população dos municípios (`max(1, pop)`), busca binária. **Prefixo estável**: com `n` maior, as primeiras casas continuam nas mesmas cidades. Devolve `Map ibge → quantidade`.

### 3.15 `urbanizar(specs, terra, fixos)` — cidades vizinhas se afastam

Processa as cidades da **maior para a menor** (nº de moradores, desempate por IBGE), com uma grade de ocupação de células de 2 km:

```
c = fixos.get(ibge) ou spec.centro
se não fixo e !discoLivre(c, 4,5 km):               # disco livre: nenhuma célula ocupada e 5 pontos em terra
    gira em espiral: raios 2..200 (passo 2 até 40, depois 4), 20 ângulos a partir de hashN('ur'+ibge)·2π
    primeiro ponto livre vira o novo centro (arredondado a 0,1 km)
cidade = construirCidade({...spec, centro: c, terra: (x,y) → célula livre && terra(x,y)})
cidade.centroOriginal, cidade.deslocada = distância
marca(c, max(3,4, praca.r + 1,3)); marca cada casa/marco/vaga/igreja com raio 1,2
```

Como a função `terra` passada já exclui as células ocupadas pelas cidades maiores, as menores **crescem em volta** das grandes em vez de serem engolidas. `fixos` (Map ibge → centro) congela praças já deslocadas durante a sessão.

### 3.16 Nível T3 — "cidade que evolui"

#### 3.16.1 Fonte do nível (`nivelDe(ibge, o)`)

- `o.t3` força (nº → todas as obras dos níveis ≤ N; ou um `{nivel, tem}`).
- Em Node (sem `window`): nível 0, sem obras.
- Em `localhost`, `?nivel=N[&ib=IBGE]` liga todas as obras dos níveis ≤ N (teste).
- Produção: `window.CV` (ou `__DADOS.CV`) com `v === 3`; `CV.c = [[ibge, ?, mask25bits], …]`, `CV.o[k][4]` = nível opcional por obra. Para cada bit `k` ligado: `tem.add(T3_FEATS[k])`, `nivel = max(nivel, CV.o[k][4] || floor(k/5)+1)`.

#### 3.16.2 Catálogo de obras (25, 5 por nível)

| Nível | Chaves (`T3_FEATS[5·(N−1) … 5·N−1]`) | O que desenha |
|---|---|---|
| 1 | `caixa`, `poste`, `posto`, `praca`, `esgoto` | caixa d'água (sítio u1), postes nas avenidas, posto de combustível (u2), praça integrada (calçadão + árvores + postes + bancos), esgoto (sem desenho) |
| 2 | `escola`, `eta`, `upa`, `parque`, `solar` | escola (m4), estação de tratamento (zona R 1,3), UPA (m2), parque com lago (quadra), usina solar (zona R 1,9) |
| 3 | `hospital`, `shopping`, `cultural`, `reserv`, `estadio` | hospital (m4), shopping com estacionamento (quadra), centro cultural com domo (m2), reservatório (zona R 1,3), estádio (quadra) |
| 4 | `hospuni`, `aero`, `aquatico`, `arranha`, `roda` | hospital universitário (m4, mais alto), aeroporto (zona R 2,7), parque aquático (quadra), arranha‑céus nos sítios dos prédios k ≤ 8, roda‑gigante (m2) |
| 5 | `metro`, `ponte`, `dessal`, `pesq`, `auto` | metrô elevado no maior braço de avenida, ponte sobre água (ou viaduto estaiado), dessalinizadora (zona R 1,6, rumo da costa), centro de pesquisa (m4), autódromo (zona R 3,1) |

Efeitos indiretos do nível: canteiro das avenidas mais largo (nível ≥ 2), faixa de ônibus (`bus`, nível ≥ 3), adensamento `dn` das casas (nível ≥ 3, §3.8).

#### 3.16.3 Kit de desenho (`t3Kit`) e saída numérica

Tudo vira **dados**; o render só instancia. Um sítio `F = {x, y, a (yaw), w, l, R, id, palma}` tem um quadro local onde `+z` corre ao longo da rua e `+x` atravessa; `W(lx, lz)` leva ao mundo. Primitivas (`out.prims`): `{t: 'b' bloco | 'c' cilindro | 'k' cone | 'd' domo | 'l' luz (emissivo), x, y, z (altura da base), w, h, d, a (yaw), rx, rz (inclinações), cor}`; `barra(...)` é um bloco fino inclinado entre dois pontos (cabos, raios da roda, escorregadores). Fitas de chão (`out.chao`): `{cam (camada), pts, hw, min (largura mínima em px)}` — `rect`, `elipse` (3 anéis concêntricos 0,78/0,5/0,22), `anel`, `linha`. Árvores: `arv(lx, lz, s, palma)` → `arvores.push({tipo 'parque'})`.

Paleta `T3C` (hex): conc `#e9e4d8` · branco `#f4f6f8` · vidro `#7fa8cc` · vidroE `#3f5670` · tijolo `#c8785a` · amar `#f2c230` · verm `#d9453a` · azul `#4a7fc1` · verde `#5aa247` · cinza `#9aa3ae` · cinzaE `#5d6570` · esc `#3a3f46` · agua `#5bb4e5` · mad `#8a6a45` · lar `#f08a3c` · rox `#9b6fd1` · creme `#f3e3b5` · aco `#c9ced6`. No render as cores T3 são multiplicadas por 0,72 (luz forte da cena).

Camadas de chão T3 (`CAM_T3 = {cor, renderOrder, lift}`): verde2 `#74b85a` 5,60 0,00019 · pav `#d9d2c3` 5,70 0,00021 · estac `#979ca1` 5,74 0,00022 · agua `#5bb4e5` 5,78 0,00023 · campo `#58a84a` 5,82 0,00024 · azulq `#4a7fc1` 5,84 0,00025 · pista `#4c5156` 5,88 0,00026 · branco `#f4f4f0` 5,95 0,00027 (fade 1,2 px) · bus `#c8574a` 6,15 0,00038.

Os modelos (`T3M.*`) são composições de 5–40 primitivas; as dimensões são proporcionais a `F.w`/`F.l` (sítios) ou `F.R` (zonas). Exemplos de referência: UPA = bloco branco 0,74·w × 0,74·l × 0,74 alto com laje azul e cruz vermelha; estádio = elipse de campo + 16 segmentos de arquibancada em dois anéis + 4 torres de luz (1,7 km) com luminária emissiva; roda‑gigante `R = min(0,62 + 0,12·l, 1,0)`, eixo a `R + 0,28`, 16 segmentos de aro, 8 raios, 8 gôndolas coloridas; arranha‑céu `H = 3,4 + (v mod 6)·0,55` com 3 variantes (laje+coroa, torres gêmeas assimétricas, escalonado com cone dourado) e luz vermelha no topo.

#### 3.16.4 `urbT3(C)` — a camada urbana

1. **Sítios construídos**: `T3M[key](kit(F), F)` para cada `sitiosCiv` com `built`; `F.w = max(1,6, w)`.
2. **Praça integrada** (`praca`): calçadão superelíptico entre `rin = Ra + 0,34` e `rout = Rp + 0,92` (camada pav), linha branca em `rin + 0,06`; em 16 posições angulares (fora dos braços das avenidas, exceto estrela) alterna: poste (cilindro 0,7 + luz `#fff0b0`), banco de madeira, árvore (`s = 0,5 + 0,1·(q mod 3)`, flor em q mod 3 = 0, palmeira em q mod 4 = 0 se palmaP > 0,35).
3. **Postes** (`poste`): nas avenidas (ordenadas por comprimento), a cada 2 pontos a partir de 1,1 km, dos dois lados a `hwCalc − 0,05`, até 26 por braço; cilindro 0,74 + luz.
4. **Arranha‑céus** (`arranha`): nos sítios de prédio com `k ≤ 8`; variante `h = floor(h2(k, 91, s1)·60)`; os prédios‑marco correspondentes **não** são desenhados (`torresK`).
5. **Zonas da periferia** (`t3Zona`): procura, em 24 ângulos a partir de um ângulo base (hash da chave; dessalinizadora: rumo da costa − th) alternando ±15°, distâncias 6 → 80 km (passo 0,8), um ponto em terra cujo círculo `0,9·R` também está em terra e que fica a ≥ `R + 1,1 + rOcupado` de todo lote/zona ocupados. A zona vira sítio orientado para o centro; uma estrada de acesso (`hw = hwRua`, `t3: true`) vai da zona até a borda ocupada.
6. **Metrô** (`metro`): no maior braço, trecho de `Ra + 0,9` a 26 km: vigas `0,46 × 0,1 × L·1,06` a 1,3 km de altura, trilho escuro, pilar a cada 2 segmentos (0,14 × 1,3), 2 estações (18 % e 62 % do trecho: plataforma 0,9 × 1,7, cobertura azul, caixa de vidro) e um trem de 3 vagões em 35 %.
7. **Ponte** (`ponte`): varre 18 direções × 11 offsets laterais (0, ±2,5, ±5, ±8, ±11, ±15 km) em passos de 0,5 km até ±40 km do centro procurando um vão de água de 1,4–18 km cujo meio esteja a ≤ 34 km; pontuação `|Lw − 6,5|·0,4 + |t|·0,45 + |mid|·0,1 + 6·bloqueios + 4·(Lw < 2,4)`; a menor vence. Estrutura estaiada (`ponteEst`): tabuleiro a 0,82 km, rampas de 1,5 km, 1 ou 2 pilones de 3,5 km (2 se L > 9), 6 estais dourados por lado/pilone, luzes. Acessos até a borda ocupada (`hw = 0,8·hwAv`). Sem água: viaduto sobre outro braço (`Ra + 1 … Ra + 11`).

Saída `urb = {nivel, tem[], chao[], prims[], sitios[{id, x, y, a, w, l}], torresK, nTorres, zonas[], metro, ponte}`.

---

## 4. Relevo e biomas (`Relevo`)

### 4.1 Formato dos dados (`TERRENO.relevo`, v1)

```
{ v: 1, nx: 384, ny: 384, box: [−2140, −2200, 4280, 4400], hmax: 3000, sigmaKm: 10,
  planos: { h: base64(deflate raw(PNG-filter "Sub")), r: idem, b: idem },
  mun: { n: 5523, b64: base64(deflate raw(int16 x·5, int16 y·5, uint8 rin·4, uint8 rout·4)) } }
```

- `h`: altitude absoluta codificada em raiz quadrada: `alt_m = (v/255)² · hmax`.
- `r`: **relevo local** (altitude menos o "chão regional" suavizado com σ = 10 km, calculado no preparo), mesma codificação; é o que sobe do chão.
- `b`: bioma por texel: 0 mar · 1 Amazônia · 2 Caatinga · 3 Cerrado · 4 Mata Atlântica · 5 Pampa · 6 Pantanal.
- `mun`: platôs potenciais `[x, y, rin, rout]` km para cada município.

Decodificação: inflate (RFC 1951, implementação própria síncrona), desfaz o filtro "Sub" linha a linha (soma acumulada mod 256), tabela `tab[i] = (i/255)²·hmax` → `rf` Float32 (relevo em metros).

### 4.2 Biomas → mata e secura

| id | Bioma | dens | seca | cor |
|---|---|---|---|---|
| 1 | Amazônia | 0,97 | 0,00 | `#2f6f35` |
| 2 | Caatinga | 0,17 | 0,95 | `#d2bc8a` |
| 3 | Cerrado | 0,36 | 0,62 | `#b3b55c` |
| 4 | Mata Atlântica | 0,80 | 0,08 | `#438f48` |
| 5 | Pampa | 0,10 | 0,35 | `#92c45e` |
| 6 | Pantanal | 0,28 | 0,25 | `#79b06a` |

`densBytes(orig, dm)` reescreve os canais R (densidade) e G (secura) do mapa de mata 256×264 do build por supersampling 4×4 dos biomas; em Cerrado e Mata Atlântica a densidade cai 35 % acima de 500–1400 m de altitude real. Canais B (índice da UF/8) e A (terra) ficam.

### 4.3 Altura do chão (`criar(opts)`)

```
E     = exagero (padrão 10; o build passa relevoOpt.exagero)
PISO  = 0,15 km (nível de qualidade ≥ 2) · 0,25 (Mesa, nível ≤ 1) · 0,32 (Mapa, nível ≤ 1)
Yraw(x,y) = max(0, (E/1000) · bilinear(rf) − PISO)          # km, já exagerado; abaixo do piso é plano
F(x,y)    = fração achatada 0..1 = max sobre platôs (grade espacial 64 km) de
            1 se d ≤ rin ; 1 − sstep(rin, rout, d) se d < rout ; 0
Y(x,y)    = Yraw · (1 − F)       (0 se Yraw < 1e−5)
```

`achatar([{x, y, r}])` **substitui** a lista de platôs pelas cidades reais: `rin = 1,05·r + 2`, `rout = rin + max(4, 0,3·r)`, mantendo os municípios potenciais se `opts.platos === 'municipios'` (o motor usa `'cidades'`). A altitude absoluta e o bioma só entram na **cor** (shader); a altura 3D é o relevo local. Assim casas, ruas e prédios continuam em y = 0 e nem flutuam nem afundam.

### 4.4 Malha adaptativa (`construirMalha`)

Quadtree de folhas de 64 km (TOPO) até `FOLHA = 2 km`:

```
visita(x0, y0, s):
   mr = máximo do relevo bruto nos texels cobertos (+1 de folga); se mr < 0,004 km → nada
   amostra 4 cantos (cache por vértice de 2 km), centro e 4 meios de aresta
   err = maior desvio entre a amostra e a interpolação linear dos cantos
   se s > FOLHA:
      lim = folhaMaxPerto se mr > LIMREL (perto de platô: folha ≤ max(FOLHA, 0,8·rin)) senão ∞
      subdivide se err > TOL ou s > lim ou (s > 16 e mr > 0,25)
   se max das 9 alturas < 0,002 → nada (plano: a laje já cobre)
   senão folha [ix, iy, n] em unidades de FOLHA
```

`TOL` = 0,6 km padrão (motor: 0,8 em nível ≥ 2; 1,4 Mesa / 1,9 Mapa em nível ≤ 1); `LIMREL` = 1,2 (motor: 1,5 / 2,5 / 3,1).

Triangulação sem rachaduras: vértices "pendurados" nas arestas de folhas vizinhas menores entram no polígono da folha grande, que vira um **leque a partir do centro**; sem pendurados, escolhe a diagonal que melhor segue a altura do centro. Orientação forçada com normal para +y (z = −y_km). Vértices a `h + 0,02` km (20 m acima da laje, sem z‑fighting; 0,02 onde h = 0). Normais por diferenças finitas de 1 km: `n = normalize(−dY/dx, 1, dY/dy_km)`. Estatística `{folhas, vertices, triangulos, pendurados, ms}`.

### 4.5 GLSL do relevo (injetado no material do chão)

Uniforms: `uRelA` (textura R da altura `h`, linear), `uRelB` (bioma, nearest), `uRelBox`, `uRelN` (nx, ny), `uBioCol[7]` (cores pré-compensadas), `uRock #b8a888`, `uWater #8fd0e2`, `uRelSun`, `uRelK` (peso da cor do bioma, 0,8), `uRelSh` (força do sombreado, 1,0), `uRelEx` (exagero do sombreado, 24).

- `relH(uv) = c² · 3000` (metros). `relBio` faz interpolação bilinear **das cores** dos 4 texels vizinhos (e um canal alfa = 1 no Pantanal). `relLand` = bioma ≠ 0.
- `GLSL_BASE`: `base = mix(base, corBioma, uRelK)`.
- `GLSL_COR`: `base = mix(base, uRock, 0,42·smoothstep(550, 2300, alt))`; sombreado por inclinação (diferenças centrais dos vizinhos em terra, `× uRelEx / 1000`) → `sh = clamp(1 + (lit − L.y)·uRelSh, 0,55, 1,4)`; Pantanal: lagoas por ruído (`relVn(P/46)·0,62 + relVn(P/13 + 3,7)·0,38`, `smoothstep(0,58, 0,65)`), `mix(base, uWater, 0,85·lag)`.

### 4.6 Integração no motor

- `REL = Relevo.criar({dados, platos: 'cidades', exagero, tol, limRel, piso, A, sunDir})`.
- `agendarRelevo(circulos)`: assinatura `ibge:round(4r)` das cidades; muda → espera 450 ms (0 se já espera > 4 s), `REL.achatar`, `REL.geometria(T)` e troca a geometria de `relMesh` (material `groundMaterial('relevo')`, que descarta fragmentos no mar). A pausa não conta para o governador (`gov.n = 0`).
- Tudo que fica no chão consulta `REL.Y`: fitas globais (`+0,05`), árvores da mata, câmera (`h ≥ Y + 1,2`), `api.relY`.

---

## 5. Layout (`layout.js`)

### 5.1 Ordem persistente dos moradores

`ord = {cidades: Map ibge → [key | null], onde: Map key → ibge}`. `sincronizarOrdem(ord, ativos)`: quem saiu (ou mudou de cidade) deixa `null` no lugar (buraco: o lote fica vago, ninguém anda); quem entra vai para o **fim** da fila da sua cidade, em ordem de `max(diaEntrada, diaMudanca)`, desempate por `hashN(key)` e depois pela própria chave. Assim quem já tem casa nunca muda de lugar quando chega gente na mesma cidade.

### 5.2 Casas cinza (anônimas)

`nFol = clamp(seguidores − ativos, 0, MAX_CINZA = 8000)`. `cinzaPorCidade(n, grande)` = `Cidade.anonimas` sobre `[[ibge, pop]]` de todos os municípios com coordenada; em escala grande (`ativos ≥ 1000`) só municípios com `pop ≥ 100 000` (cada cidade nova custa ~0,7 ms de urbanismo). Chaves `'g:IBGE:i'`, item `{key, h: '', tipo: 2, flag: false}`.

### 5.3 Obras (sugestões dos jogadores)

`tipoDaObra(texto)` por palavras: metro (metrô, trem, estação, VLT, BRT) · ponte (ponte, viaduto, túnel, passarela) · estadio (estádio, arena, ginásio, autódromo) · parque (parque, praça, jardim, bosque, praia, lago, zoológico, piscina, campo, horta) · torre (torre, farol, antena, roda gigante, arranha, prédio, hotel, shopping, hospital, aeroporto, escola, universidade, biblioteca) · senão monumento. Status `'escolhida'` → modelo `canteiro`. Posições fixas sobre o gramado da praça em volta do mastro: `OBRA_OFF = [[0,95,0,0,5],[−0,95,0,0,5],[0,0,95,0,5],[0,−0,95,0,5],[0,5,0,5,0,34],[−0,5,−0,5,0,34]]` ([u, v, escala]), rotacionadas por `th`; yaw = `hashN(id)·2π`.

### 5.4 Pipeline em 3 passos

1. `prepararLayout({ord, ativos, moradores, obras, seguidores, dia})` → `specs[]` (`{ibge, centro: xyCidade, nome, uf, moradores: itens}`), `meta[]` (`{nReais, nCinza, novos (entraram hoje), fundador}`), `obrasPorCidade`. Fundador: campo explícito no banco por cidade, senão o 1º morador real da fila.
2. `Cidade.urbanizar(specs, TERRA, fixos)` — ou `urbanizarGen` (gerador equivalente, uma cidade por `yield`, mesma ocupação do chão; usa `marca(c, 3,4)` e não inclui a igreja nas marcas).
3. `finalizarLayout(prep, cidades, feitas, urb)` → `{cidades (com x, y, n, cinza, novos, fundador, nCasas), casas[{key, h, ibge, x, y, yaw, tipo, flag, cx, cy, r, c3}], estradas: [], obras[], porChave, porIbge, urb, sig}`. `sig` = `nCasas:nCidades:nObras:checksum:dia`.

`construirLayoutGen` fatia o passo 2 por quadro, devolve layouts **parciais** em 35 % e 70 % das casas (maiores cidades primeiro) e reaproveita o passo 2 quando `sigSpecs(specs)` (hash FNV das chaves, tipos e bandeiras por cidade) não mudou. Centros deslocados por `urbanizar` são congelados em `_fixos` durante a sessão.

---

## 6. Renderização

### 6.1 Paleta e pré-compensação ACES

Cores "de tela" desejadas (`COL`):

| chave | hex | chave | hex | chave | hex |
|---|---|---|---|---|---|
| grass | `#78ad54` | grassDry | `#9cb85a` | grassDeep | `#5f9b47` |
| tree | `#3f7f3a` | grid | `#b6e08c` | sea | `#acdaf2` |
| seaGrid | `#d2edfa` | beach | `#eeeec8` | river | `#8ecdf0` |
| skyTop | `#b3d1ee` | skyHor | `#e6ebea` | fog | `#e2e9ea` |
| road | `#6b6f72` | curb | `#dfdedc` | slab | `#a98f66` |

Cores do gerador de cidade (`COR`): grama `#78ad54`, quadra `#a1cf7a`, gramaPraca `#97cf72`, calcada `#dfdedc`, asfalto `#6b6f72`, canteiro `#80c15c`, marca `#f4f4f0`, caminho `#ece6d6`. Paredes (`PAREDES`, 10): `#f4f1e8 #f1dfb0 #f2d160 #ee9d83 #e59aaa #94bfe6 #a3d6aa #dcbd8a #bba9dc #f3b680`. Telhados (`TELHADOS`, 12; 8–11 cinzas das anônimas): `#c8572f #a04526 #8f98a5 #b9bfc8 #4f6f94 #5f8a45 #7d5238 #6d7683 | #d4dae3 #c2c8d2 #cdd0d4 #b8b9c2`. Flores: `#f4c83c` ipê amarelo, `#eb82aa` ipê rosa, `#dc3c28` flamboyant, `#a078d2` jacarandá.

O renderer usa `ACESFilmicToneMapping` com exposição 1,0. Para que uma cor **apareça na tela** com o hex escolhido, o motor calcula o **albedo** que, iluminado pela luz da cena e passado pelo ACES, cai nessa cor:

```
SUN_DIR = normalize(−0.62, 0.56, −0.36)              # fim de tarde, baixa e quente
LIGHT   = { hemi: 1.45, sun: 2.3, exposure: 1.0 }
KLIT    = (hemi + sun · SUN_DIR.y) / π                 # irradiância de uma face voltada para cima (≈ 0,871)

aces(v): v *= exposure / 0.6
         v = M1 · v
         v = (v·(v + 0.0245786) − 0.000090537) / (v·(0.983729·v + 0.432951) + 0.238081)   # RRT+ODT fit
         v = clamp(M2 · v, 0, 1)
M1 = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]]
M2 = [[1.60475, −0.53108, −0.07367], [−0.10208, 1.10813, −0.00605], [−0.00327, −0.07276, 1.07602]]

comp(hex, k = KLIT): alvo = sRGB→linear(hex); a = alvo / k
   até 60 iterações de Newton (jacobiano numérico 3×3, passo 1e−3, Cramer, relaxação 0,8):
      erro = aces(a · k) − alvo ; parar se max|erro| < 1e−4
   devolve a (linear, ≥ 0)
A(hex, k)   = THREE.Color linear com comp(hex, k)      # usado em TODOS os materiais do chão, fitas e cidade
DISP(hex)   = cor literal no espaço de saída (névoa)
```

A lateral da laje usa `k = (hemi·0,5 + sun·0,05)/π`. Nas casas, as cores das paredes são `A(hex)·0,62`, telhados `A(hex)·0,42` (anônimas ×1), ouro dos cargos `A('#D08A00')·0,22`, T3 ×0,72 — porque a luz da cena é forte e os valores "crus" saíam claros demais.

### 6.2 Renderer, qualidade e luzes

```
ehCelular = pointer coarse || min(innerWidth, innerHeight) < 700 || UA de Instagram/Facebook
Q.nivel   = opts.nivel ?? (ehCelular ? 1 : 3)        # 0..3
SOMBRA    = [0, 1024, 2048, 4096]                     # mapa de sombra (0 = sem sombra), limitado a MAX_TEXTURE_SIZE
DENS_ARV  = [2.2, 1.7, 1.0, 0.8]                      # multiplica o espaçamento das árvores finas
DPR_MAX   = [1, 1.5, 2, 2]                            # teto do devicePixelRatio (opts.dprMax sobrepõe)
antialias = nivel ≥ 2 || !ehCelular
```

- `renderer.toneMapping = ACESFilmic`, `outputColorSpace = sRGB`, `shadowMap.type = PCFSoft`.
- `scene.fog = Fog(COL.fog, 100, 1000)` com a névoa trocada por **smoothstep** (`Cidade.nevoa` substitui `fog_fragment`).
- `camera = PerspectiveCamera(50°, aspecto, near, far)`.
- `hemi = HemisphereLight('#f3f5ff', '#c6d79c', 1.45)`; `sun = DirectionalLight('#ffe6c6', 2.3)`, `shadow.radius 3`, `bias −0.0004`, `castShadow = nivel > 0`.
- Perda de contexto WebGL: `webglcontextlost` marca `ctxPerdido` (sem `render`), `webglcontextrestored` marca texturas `needsUpdate`, zera o mapa de sombra e re-aquece.

### 6.3 Céu

Esfera de 24×16 segmentos, `BackSide`, sem névoa nem tone mapping, centrada na câmera com raio `0,9·far`. Fragment: `c = mix(skyHor, skyTop, smoothstep(0, 0,62, y))`, mais um brilho solar `0,30·g·(1 − 0,6·y)` em `(1, 0,86, 0,66)` com `g = max(dot(dir, SUN), 0)^5`.

### 6.4 Continente, mar e o shader do chão

**Laje**: cada polígono de UF vira `ExtrudeGeometry` (profundidade `SLAB = 400` km para baixo, sem bevel), materiais `[landMat, sideMat]`, `receiveShadow`. **Mar**: plano 2×2 (24×24) escalado a `1,1·far`, posicionado em `(cam.x, −(0,12 + 0,011·h), −cam.y)`, `renderOrder −1`.

`groundMaterial(kind ∈ 'land' | 'relevo' | 'sea')` = `MeshStandardMaterial(roughness 1)` com `onBeforeCompile` que injeta, após `color_fragment`:

Uniforms: `uDens` (mapa de mata RGBA 256×264: R densidade, G secura, B UF/8, A terra), `uBox`, `uGrass/uGrassDry/uGrassDeep/uTree/uGridC/uSea/uSeaGrid` (pré-compensados), `uUF` + `uTint` (tinta por estado), `uClr` + `uClrBox` (clareiras 512², R multiplicador 0,06–1, G tom), `uCl[24]` (nuvens: xy = sombra no chão, z raio, w força), `uTimeG`, mais os do relevo.

Terra (`land`/`relevo`), com `P = posição.xz` em km:

```
dn = dens.r · clareira.r ; dr = dens.g
base = mix(grass, grassDry, 0,45·dr)                      → [relevo: mix(base, corBioma, 0,8)]
base = mix(base, grassDeep, 0,7·smoothstep(0,5, 1, dn))
px   = tamanho do pixel em km (fwidth de P)
GRADE: duas oitavas de células (cA = 2^floor(log2(px·64)), cB = 2·cA), linhas antialiasadas (gridL), mistura 0,17 com uGridC
PONTINHOS DE MATA: células cd = 0,02·2^floor(log2(px·250)); por célula um disco aleatório (hash3) presente se r < dn·1,25,
     raio 0,15–0,29 da célula; duas oitavas em crossfade; só aparecem com px entre 0,03 e 0,14 km; mistura 0,72 com uTree
base = mix(base, grassDry·1,04, 0,42·(1 − clareira.r)) ; base *= 0,95 + 0,1·clareira.g ; base *= 1 − 0,11·cloudShadow(P)
→ [relevo: rocha por altitude, sombreado de encosta, Pantanal]
se uTint > 0: base = mix(base, corUF, alfaUF·uTint)
```

Mar: `mix(sea, seaGrid, 0,26·grade)`, `× (1 − 0,10·cloudShadow)`, `+ (0,13, 0,14, 0,15)·sparkle(P, px)` (produto de senos animado, `pow(…, 6)`).

`cloudShadow(P) = max_i (1 − smoothstep(0,3·r_i, r_i, |P − c_i|))·w_i` sobre os 24 puffs.

### 6.5 Fitas (ribbons) com largura mínima em pixels

Duas implementações irmãs: `ribbonGeo/ribbonMat` (world3d: praia, divisas, rios) e `fitaGeo/fitaMat` (criarRender: quadras, ruas, avenidas, faixas, chão T3). Ambas geram, por ponto da polilinha, **2 vértices** no mesmo lugar com atributos:

| atributo | significado |
|---|---|
| `position` | o ponto (x, Y, −y) |
| `aN` | normal 2D da polilinha × fator de canto `m = clamp(1/max(0,5, sqrt((1+cosθ)/2)), 1, 2)` (engrossa nos cotovelos para não afinar) |
| `aSide` | −1 / +1 |
| `aU` | comprimento acumulado (km) — tracejado |
| `aW` | meia-largura (km) |
| `aC`, `aR` | centro e raio da cidade (inflação) |
| `aM` | (fita) largura mínima em px |

Vertex shader: `hw = max(aW·sc, uMinPx·0,5·uPx·d)` onde `uPx = 2·tan(fov/2)/alturaTela` (km por pixel a 1 km) e `d` a distância à câmera → a fita **nunca fica mais fina que N pixels**. `p = c + aN·aSide·hw ; p.y += d·uLift` (levanta proporcional à distância, evita z‑fighting; `lift` cresce com a ordem de desenho). Névoa própria (`smoothstep(uFogN, uFogF, |mv|)`), cor `uColor·uLight` (`uLight = KLIT`), tone mapping + colorspace, `transparent`, `depthWrite false`, `DoubleSide`.

Variantes: `ROAD` (meio-fio `uCurb` em |side| > 0,84, tracejado central branco a cada 0,9 km); `CITY` (inflação); `DASH` (descarta `fract(vU/0,9) > 0,5`); `uFadePx` (alfa `smoothstep(f/2, f, larguraReal_px)`: faixas finas somem de longe em vez de virar ruído).

Fitas globais (ordem de desenho, meia-largura km, mínimo px):

| fita | hw | minPx | cor | ordem |
|---|---|---|---|---|
| divisas (Mapa) | 0,08 | 4,6 escuro `#1e2430` α0,5 + 2,3 branco α0,95 | | 2 / 2,1 |
| divisas (Mesa) | 0,22 | 2,2 | branco α0,5 | 2 |
| costa | 0,22 | 6 | beach | 3 |
| rios — areia | `RW[w][0] + 0,45` | 11 | beach, lift 0,00035 | 4 |
| rios — água | `RW[w][0]` (3: 1,3 · 2: 0,8 · 1: 0,45) | 6 | river, lift 0,0004 | 5 |

Camadas de cidade (`camadas`, `fitaMat`):

| camada | cor | fade px | lift | ordem | min px (por item) |
|---|---|---|---|---|---|
| quadras | COR.quadra | – | 0,00018 | 5,5 | 2,2 |
| calcadas | COR.calcada | 1,6 | 0,00028 | 6,0 | – (hw = rua + 0,08 / avenida hwCalc) |
| asfalto | COR.asfalto | – | 0,00032 | 6,1 | 0,8 rua · 1,1 anel · 2,4 avenida |
| canteiro | COR.canteiro | 1,2 | 0,00036 | 6,2 | – (hw = can) |
| marcas | COR.marca α0,95 DASH | 1,4 | 0,0004 | 6,3 | – |
| + `CAM_T3` | §3.16.3 | | | 5,60–6,15 | |

`bus`: duas fitas `hw 0,1` deslocadas ±0,5 km do eixo da avenida. Cache por cidade (`fitasDaCidade`, WeakMap chaveada pelos arrays da cidade): cada cidade guarda os seus arrays já no formato de `fitaGeo`; `preencherFitas` só **concatena** por camada (índice Uint32 se > 65 535 vértices) — evita refazer todas as cidades quando uma entra.

### 6.6 Árvores da mata

Geometria `TREE_G`: icosaedro r 0,5 (×1,05 em y, +0,62) verde `#5aa247` + tronco 0,1×0,3 `#7a5a3a`; cor por vértice. Material `MeshStandardMaterial(vertexColors, roughness 1, flatShading)` + depth material, ambos com `patchTS`:

```
io = posição da instância; p = io + (p − io)·mix(1, uTS, aBig)       # as grossas (aBig=1) encolhem com treeScale
se aClr.z > 0 e |io.xz − aClr.xy| < (aClr.z + 1,5)·cityS(aClr.z): p = (0, −90000, 0)   # some dentro da cidade
```

`aClr` (x, −y, r) é a cidade que "limpa" a árvore (`clrDe`: a **maior** cidade cujo círculo visual `max(r, r·escalaVisual(r, CS_MAX, 200)) + 3` cobre o ponto; grade espacial de 64 km no Mapa; `CS_MAX = 60` Mesa, 1 Mapa). Cor da instância: `tomArvore(x, y, seca, r)` — `u = 0,88 + 0,26·r`, `R = lerp(0,84, 1,1, seca)·(0,94 + 0,12·tom)`, `G = lerp(1,0, 0,96, seca)`, `B = lerp(0,88, 0,66, seca)·(1,04 − 0,1·tom)` com `tom` das clareiras. Escala `(s, s·(1 + 0,5·r), s)`, rotação `r·2π`, y = `REL.Y`.

**Grossas** (`coarse`): grade de passo `sp = 30` km (42 no Mapa nível ≤ 1) sobre a caixa −2140…2140 × −2200…2200, jitter uniforme, mantida se `rand ≤ dens^0,9` e em terra; tamanho `sp·(0,5 + 0,25·rand)`; `aBig = 1`. Visíveis só com `h > 150` (Mesa) ou `treeScale > 0,004` (Mapa); sombra só nível ≥ 2 na Mesa. `treeScale = clamp(h/5000, 0,02, 1)` (Mapa: `× sstep(220, 1500, h)`).

**Finas (Mesa)** — `genRegion(cx, cy, R = 55, c0 = 0,36·DENS_ARV, R0 = 16, cap)`: quadtree de ladrilhos de 96 km; espaçamento local `c = c0·(1 + r/R0)`; subdivide enquanto `sz > 1,6·c`; em cada folha `m = round(sz/c)` por lado, jitter 0,8; densidade de borda `clamp((R − rr)/(0,35·R), 0, 1)`; mantém se `rand ≤ dens^0,85` e em terra; tamanho `s·(0,6 + 0,4·rand)`; `yield` a cada 120 árvores. Dispara quando `h < 170`, o foco andou > 17 km do último centro (ou "sujo"), a câmera está parada (não voando ou a < 25 km do alvo) e passaram 0,4 s; orçamento `passoFine(3,5 ms)` por quadro; escreve tudo no fim. Capacidade `FINE_CAP = 9000`, orçamento por nível `[2500, 5000, 9000, 9000]`.

**Mapa (DR)** — `genArvoresMapa(cam, out, cap)`: ladrilhos de 96 km no raio `dMax + 24` (`dMax = 115 + 8`), culling por frustum (esfera `0,75·sz + 0,4·d`), espaçamento `cq = min(cmax, c0·2^(round(2·log2(max(1, K·dq/c0)))/2))` (passos de meia oitava; `c0 = 0,36·m`, `K = 0,02·m`, `cmax = 1,7·m`, `m = [1,5 1,1 0,9 0,8][nivel]`; `dq = max(h, d − 0,35·sz)`), sementes **fixas por ladrilho** (`rng((x0·7·73856093) ^ (y0·7·19349663) ^ (sz·83492791))`) para que as árvores não mudem de lugar; tamanho `min(0,55, …)` (nunca mais alta que um sobrado); orçamento `[1200, 2600, 6000, 9000]`. Dois meshes A/B com `patchDR`: `p = io + (p − io)·uK·fd`, `fd = 1 − smoothstep(60, 115, |uCamW − io|)` (fade por distância, de longe quem faz a mata é o chão) e a mesma limpeza por cidade. **Crossfade** de 0,6 s: o novo cresce (`k = e(2f)`), depois o velho encolhe (`k = 1 − e(2f − 1)`). Novo conjunto quando `|Δld| > 0,28` ou o foco andou `> 0,16·D`, ≥ 0,3 s depois do último, câmera abaixo de 125 km e sem fade em curso; 2,6 ms por quadro.

### 6.7 Nuvens (`criarNuvens`)

8 nuvens × 3 puffs (sprites 256×128 pintados em canvas: 9 bolinhas em gradiente radial, base azulada), altitude 380 km, posições em ±2600 km (`rng32(20261014)`), tamanho 70–140, vento `v = 3,2–5,6 km/s` em x com wrap em 5600 km; `scale = (4,2·r, 2,1·r)`, opacidade 0,8, visíveis só com `h > 450`. `uCl[j] = (x + ox, z + oz, 0,9·r, 0,9)`, onde `(ox, oz) = −sunDir.xz/sunDir.y · 380` é onde o raio de sol dessa altura toca o chão (sombra das nuvens no shader).

### 6.8 Render das cidades (`Cidade.criarRender(T, {scene, A, U})`)

#### 6.8.1 Geometria baixo-poli com cor por vértice

Tudo é **triângulos soltos** (sem índice) montados por `juntar(parts)`; cada `part = {pos[], col hex, part 0|1|2, ao {y0, y1, f}, lit}`:

- `boxTris(x0,y0,z0,x1,y1,z1, semFundo)` — 12 (ou 10) triângulos; `discoTris`, `cilTris` (via `CylinderGeometry.toNonIndexed`), `domoTris`, `telhado4(y0, y1, ex, ez, rl)` (4 águas com cumeeira), `jan2` (quad de janela), `quadO/triO` (orientação forçada por vetor "para fora").
- **AO falso**: cor × `f + (1−f)·clamp((y − y0)/(y1 − y0))` — escurece junto ao chão (`AO(h) = {0, h, 0,74}`).
- `lit` = cor convertida sRGB→linear sem pré-compensação (partes emissivas: letreiro do cassino).
- Atributo `aPart` (quando algum part define): **0 parede** → cor da instância, **1 telhado** → `color·aRoof`, **2 detalhe** → cor própria do vértice. `computeVertexNormals` + `flatShading`.

#### 6.8.2 Modelos (dimensões em km, frente = +z, origem no chão)

| Modelo | Descrição | LOD (`lo`) |
|---|---|---|
| casa 0 (térrea) | caixa 1,0×0,52×0,8; telhado 4 águas até 0,94 (beiral 0,58×0,48); 2 janelas `#2c3342`; porta `#8a6a45` | caixa + bloco de telhado |
| casa 1 (sobrado) | 0,92×0,98×0,76; telhado até 1,40; sacada; 4 janelas | idem |
| casa 2 (casa alta) | 0,88×1,5×0,78; laje plana + toldo; faixa `#ebe5d6`; 5 janelas | idem |
| mansão (nível 4 / cargos M, D, S) | corpo 2 andares 0,65×1,0 + ala térrea; telhado 4 águas; piscina `#46b5e6`; muro baixo com vão | simplificada |
| torre (nível 5) | 7 andares de 0,4 (0,72×2,8×0,66), fitas de janela, lajes, entrada envidraçada, cobertura de vidro `#8fd0f0`, antena; a instância varia `sy` (6–8 andares) | caixa + laje + cobertura |
| palácio (governador) | neoclássico creme `#efe7d2`: embasamento 1,32×0,07, alas, corpo central 0,68×1,0, pórtico de 6 colunas, frontão, cúpula e cornijas **ouro (part 1)**, bandeira `#ffd23f` | sem pórtico |
| "Alvorada" (presidente) | térreo 2,0 km de largura, volume de vidro recuado `#8fb7d2`, laje branca (part 1) sobre 26 colunas em ampulheta, espelho d'água, 2 bandeiras | sem colunas |
| alto 6 … 50 (`altoGeo(nv)`) | um modelo por nível (lote ~0,9×0,85, altura 4–12 km): 6 prédio 10 andares · 7 edifício com embasamento · 8 arranha-céu de aço · 9 torre de vidro com pirâmide · 10 heliponto · 11 luxo champagne/bronze · 12 megatorre em 3 blocos · 13 torre dourada · 14 cristal hexagonal · 15 prata com coroa e halo · 16 castelo · 17 farol · 18 torre do relógio · 19 pagode · 20 torre de TV · 21 gêmeas · 22 torre de ferro · 23 coroa de concreto · 24 prédio-onda · 25 torre torcida · 26 torre-jardim · 27 esferas · 28 pirâmide de vidro · 29 espiral · 30 base de foguete · 31 saturno · 32 art déco · 33 torre solar · 34 cidade vertical · 35 disco voador · 36 neon · 37 arco-íris · 38 castelo nas nuvens · 39 ilha flutuante · 40 agulha · 41 ametista · 42 zigurate · 43 safira · 44 portal · 45 tesla · 46 esmeralda · 47 palácio de cristal · 48 nave-mãe · 49 coroa do Brasil · 50 "topo do Brasil" (verde/amarelo, globo azul, agulha a 12 km). Todos têm `cap` = laje do topo em part 1 (ouro nos cargos). | sem janelas/anéis/detalhes |
| igreja 0/1/2 | matriz (nave 0,8×1,13, torre central 1,18 + agulha 0,5) · catedral (nave 1,0×1,1, 2 torres 1,26) · capela com campanário; paredes part 0, telhado part 1, cruz ouro `#e8b84b`, janelas, porta, degraus | – |
| prédio‑marco (3–12 andares) | base 1,08×0,16 cinza, corpo 0,84×0,7×(0,46·andares) `#f4f6f8`, fitas de janela `#3f5670` nas 4 faces, laje, caixa d'água, antena vermelha se ≥ 8 | – |
| hospital (marco) | 2,4×1,5×1,0 branco, bloco superior, faixa azul, 16 janelas, entrada, cruz vermelha, heliponto amarelo com H | – |
| cassino (marco) | 3,6×1,25×1,0 bordô `#b3303f`, frisos ouro, torre 1,9×0,9, marquise; **letreiro voxel "CASSINO"** (fonte 5×7, voxel 0,05) e lâmpadas em material emissivo (grupo separado `cassinoLuz`) | – |
| praça (4 tipos) | chão superelíptico r 1,55 (expoente `PRACA_FORMA`), caminhos em cruz, 4 bancos; **fonte**: bacia r 0,5 + água `#8fd0ee` + repuxo; **coreto**: base octogonal, 8 colunas, telhado cônico na cor do telhado da cidade (part 1); **arborizada**: canteiro com flores em 4 cores; **monumento**: degraus + sebe quadrada; 2 postes da placa | – |
| obelisco | pirâmide 4 lados 1,3 + ponta dourada (praça monumento sem fundador) | – |
| mastro | pé 0,4², haste 3,0 km, bandeira amarela `#FFE66A` 1,15×0,62 com faixas escuras (fundador) | – |
| bandeirinha | haste 1,5 + flâmula (casa do fundador) · `bandeiraV` (vereador, 0,8) · `mastroCargo` (prefeito, 1,9) | – |
| primitivas T3 | `t3b` cubo unitário (AO 0,84) · `t3c` cilindro 9 lados · `t3k` cone · `t3d` meia-esfera · `t3l` cubo emissivo (`MeshBasic`) | – |

Também: `decalTex` (gradiente radial 64² escuro) para a **sombrinha de contato** sob cada objeto, e a geometria da **placa** com o nome da cidade.

#### 6.8.3 Materiais e o shader comum das cidades (`patch`)

Materiais: `matCasa` (Standard, vertexColors, roughness 0,95, flat) · `matCasaV` (idem + `aPart`/`aRoof`) · `matLuz` (Basic, sem tone mapping — emissivos) · `depth` (`MeshDepthMaterial` RGBA, para as sombras) · `matSombra` (Basic com decal, preto α0,5, `polygonOffset −1`, `FLATLIFT`) · `matPlaca` (Basic com atlas).

`patch(mat, chave, {flat, cor})` injeta via `onBeforeCompile`:

Uniforms: `uCS` (cityScale), `uCapR`, `uTime` (relógio), `uStyle` (estilo de queda: 0 vídeo, 1 site), `uYoff`, `uXr` (raio‑x). Atributos por instância: `aCenter` (centro da cidade), `aTR = (t0 da animação ou −1, raio da cidade, modo)`, `aRoof`.

`GLSL_PROJETO` (substitui `project_vertex`):

```
p = instanceMatrix · vértice
p = aCenter + (p − aCenter) · cityS(aTR.y)        # inflação em torno do centro da cidade
p.y += uYoff ; [FLATLIFT: p.y += 0,0004·dist(câmera, p)]
se aTR.x ≥ 0:  tau = uTime − aTR.x
   tau < 0  → p = (0, −90000, 0)                          # ainda não chegou
   modo 1 (marco "sobe")  → p.y *= max(0, 1 − e^(−3,5τ)·(cos 6,06τ + 0,578·sin 6,06τ))   # cresce com ressalto
   estilo 0 (vídeo)       → cai de 6·sCity km em 0,32 s (parábola) e quica: 0,8·sCity·e^(−7s)·|sin 13s|
   estilo 1 (site)        → cai de 7·sCity em 0,34 s; ao pousar "achata": sy = 1 − 0,30·e^(−7s)·cos 22s
raio-x (uXr.w > 0): se a coluna da instância (3 alturas: 0,4·sy, 1,5·sy, 3,5·sy) passa a menos de uXr.w
   do segmento câmera → casa escolhida (até 1,1·uXr.w antes da casa), vXr = 1
```

Fragment: `if (vXr > 0,5) descarta 3 de cada 4 pixels (padrão xadrez 2×2)` → transparência sem ordenação. `GLSL_COR`: `aPart 1 → vColor = color·aRoof; aPart 2 → vColor = color (vértice); 0 → instanceColor`.

#### 6.8.4 Instancing (`criarGrupo(geoHi, geoLo, {sombra, receber, mat, extras})`)

- Capacidade = potência de 2 ≥ 1,25·n (mínimo 16); realoca quando estoura.
- Atributos instanciados dinâmicos: `instanceMatrix`, `instanceColor`, `aCenter` (3), `aTR` (3), `aRoof` (3, só com `extras`).
- `preencher(itens)`: item `{x, y, yaw, rx, rz, sx, sy, sz, y0, cor [r,g,b], roof [r,g,b], cx, cy, r, t, modo}` → matriz `compose((x, y0, −y), Euler(rx, yaw, rz) ou eixo Y, (sx, sy, sz))`.
- `hi` (detalhado, `castShadow = sombra`, `receiveShadow`, `customDepthMaterial = depth`, `renderOrder 6,6`) e `lo` (mesma matriz e cor compartilhadas, sem sombra, invisível até `lod(true)`). `frustumCulled = false` (a inflação move os vértices no shader).

Grupos fixos `G_`: casas, casas1, casas2, mansoes, torres, palacios, alvoradas, mastrosCargo, bandeirasV, arvores, palmeiras, bandeirinhas, pracaFonte/Coreto/Arborizada/Monumento, mastros, obeliscos, igreja0/1/2, t3b/c/k/d/l, hospital, cassino, cassinoLuz; `predios[3..12]` (um grupo por nº de andares); `alto6..alto50` criados **sob demanda** quando alguém chega ao nível.

Sombrinhas de contato: `InstancedMesh` próprio (`decalGeo` 1×1, `matSombra`, ordem 6,5, capacidade potência de 2 ≥ 64), escala `(w, 1, d)`; `visible` só com `h < 1500`.

#### 6.8.5 Placas com o nome (atlas)

Canvas 2048×2048 em 8 colunas × 32 linhas de 256×64 (256 cidades): fundo `#fbfaf4`, faixa amarela `#FFD23F` de 9 px, moldura `#1e2430` 6 px, nome em caixa alta, fonte 900 30 px (reduz até caber). Mesh único indexado: para cada cidade, 2 quads (frente e verso com UV espelhado) de largura `0,85·esc`, de y `0,5·esc` a `0,98·esc`, a `z = −1,2·esc ± 0,04` no quadro local da praça; atributos `aCenter`/`aTR = (−1, r, 0)` para inflar junto. Repinta quando as fontes carregam.

#### 6.8.6 `CR.atualizar(cidades)` — da cidade às instâncias

Para cada casa `h`:

```
legado   = 2 se andares = 3 ; 1 se 2 ; 0
modeloDe(h) = legado se sem nv e sem cargo
            = nv > 5: 5 se cargo G · 6 se cargo P · 7 + (nv − 6) (prédios dos níveis 6–50)
            = senão max(nv − 1 ou legado, MIN_CARGO[c])     MIN_CARGO = {D 0, S 0, M 3, G 5, P 6}; V não força
md = max(modeloDe(h), h.dn)                                  # dn = adensamento T3
cor  = h.cor | anônima (0,77, 0,79, 0,83)·v | provisória (1,02, 0,9, 0,68) | PAR_RGB[pi]·v   com v = 0,97 + 0,06·tom/3
roof = cor do partido (window.Partidos, ×0,42) | OURO se cargo em MIN_CARGO | TEL_RGB[ti]
torre (md 4): sy = (0,86 + 0,095·tom)·(0,96 + 0,08·(sy − 0,9)/0,22)   # 6 a 8 andares ; md ≥ 5: sx = sy = 1
sombrinha: w = {≥7: 1,15 · ≥5: 1,5 · 3: 1,35 · 4: 0,9 · else 1,55}·sx·(1,35 se 3–4 · 1,3 se 5–6) ; d análogo (1,05 · 1,2 · 1,1 · 0,85 · 1,35)
cargo V → bandeirinha a (+0,5 frente, +0,42 lado); M → mastro de cargo (+0,58, +0,46); flag (fundador) → bandeirinha (+0,8, +0,3)
```

Árvores da cidade: `k = 0,82 + 0,3·tom`; cor `(k, 1,03k, 0,94k)` ou multiplicador da flor (`cor_flor / #5aa247`) × (0,9 + 0,2·tom); palmeira `sx = 0,9·s`, `sy = s·(1,15 + 0,4·tom)`; árvore `sy = s·(0,9 + 0,3·tom)`; sombrinha `0,95·s·2` (palmeira 0,8). Praça: grupo do tipo, escala `esc`, `roof` = telhado dominante da cidade (coreto); mastro se `temBandeira`, senão obelisco em praça monumento. Igreja: `cor = PAR_RGB[pi]`, `roof = TEL_RGB[ti]`, sombrinha 1,3×1,9. Marcos: `modo 1` (animação "sobe"); prédios k cujo sítio virou arranha‑céu T3 não entram; sombrinha 1,4 / 3,0 / 4,2 × 1,5. T3: `prims` → grupos `t3b/c/k/d/l` com `(sx, sy, sz) = (w, h, d)`, `y0 = z`, `rx/rz`.

Depois: `preencherSombras`, `preencherFitas`, `preencherPlacas`; `estat = {fator, casas, mansoes, torres, palacios, altos, sobrados, altas, arvores, palmeiras, igrejas, predios, hospitais, cassinos, cidades}`.

#### 6.8.7 LOD (`CR.lod(h, nivel)`)

```
h > 900 → casas/mansões/torres/palácios/altos em `lo` e sem castShadow ; castShadow só se nivel > 0
h > 600 → árvores e palmeiras em `lo`
h > 700 → primitivas T3 em `lo`
árvores projetam sombra só com h < 260 e nivel > 1
sombrinhas visíveis só com h < 1500
```

### 6.9 Obras (`OBRA_GEO`, world3d)

Um grupo instanciado por tipo, criado sob demanda; geometrias `mergeTris` (cores via `A`): **torre** (base r 0,6, fuste 2,8, anel escuro, ponta vermelha), **ponte** (tabuleiro 3,2×1,8 azul‑água, viga, 2 pilones 1,7, cabos), **estadio** (anel 1,15–1,42 × 0,72, anel interno, gramado), **parque** (disco r 1,45, lago, 5 árvores), **metro** (plataforma 2,8×1,5, estação, cobertura azul, trem vermelho, placa amarela), **monumento** (base 1,3², obelisco 2,0 + ponta e esfera `#FFD23F`), **canteiro** (tapume, 6 placas laranja, guindaste amarelo 2,9 km, poste com bandeira). Item `{x, y, yaw, sx: esc, cx, cy, r, t}`.

### 6.10 Sombras por quadro

A luz direcional segue o ponto olhado: `E = clamp(6·h, 36, 5400)` km; alvo = interseção do olhar com o chão (limitado a `1,2·E`), posição `alvo + SUN_DIR·3E`; câmera ortográfica `±E`, `near 0,2E`, `far 7E`, `normalBias = 0,00015·E`. Mapa de sombra por nível (§6.2). `receiveShadow` na laje, relevo e casas `hi`.

---

## 7. Câmera

### 7.1 Modelo

Estado `CAM = {fx, fy (foco no chão, km), ld (ln da distância), phi (inclinação, graus abaixo do horizonte), psi (rumo, graus)}`; alvo `ALVO` com os mesmos campos; velocidades `VEL`. Posição:

```
D   = e^(ld + hump)
fwd = (sin ψ·cos φ, −sin φ, cos ψ·cos φ)              # ψ com um balanço sin(0,7t)·0,7° na Mesa
cam = (fx − fwd.x·D, D·sin φ, −(fy − fwd.z·D))        # h = D·sin φ
near = max(0,2, 0,12·h) ; far = 14·h + 4000 ; fov 50°
com relevo: h ≥ Y(cam) + 1,2
```

`setViewOffset(ox, oy)` desloca o centro óptico (área livre da interface); `VIEW.ox/oy` seguem `alvoOx/alvoOy` com `1 − e^(−7dt)`.

Inicial: `fx 30, fy 340, D 11000, φ 42, ψ 0`; `brasil()` voa para `brasilDist() = clamp(max(6300, 5800/aspecto), 6300, 13800)`.

### 7.2 Molas (Mesa)

Mola criticamente amortecida por componente, subpassos de 1/120 s: `a = ω²·(alvo − x) − 2ω·v`. `ω = 8,5` (5,0 em voo), ×1,1 em φ e ψ. Limites `ld ∈ [ln 7, ln 14000]`, `φ ∈ [20°, 78°]`, foco `±2250 × ±2300`; ψ desembrulhado para a volta mais curta. `orbita`: `ψ += 16°/s`. O voo termina quando `|foco − alvo| < 0,5 + 0,02·D_alvo` e `|Δld| < 0,04`.

### 7.3 Voo e "hump"

`voar({x, y, dist, phi, psi}, {rapido})` define o alvo e liga `voo`. Durante o voo a câmera **sobe** (`hump`) proporcional à distância que falta: `humpAlvo = ln(1 + 0,6·rem·sstep(15, 250, rem)/D)`; `HUMP.v` persegue com `1 − e^(−5dt)` e soma a `ld` em `posCamera`.

Atalhos: `voarCidade(c) → dist = clamp(4,2·r, 24, 700) (Mapa: 5,2·r, 20–500), φ 38` · `voarCasa → dist 15, φ 40` + seleção · `voarMarco → 18 (prédio) ou 24, φ 36` · `pousar(p)` (Mapa) salta sem animação · `pular()` iguala CAM a ALVO.

### 7.4 Entrada (Mesa)

- Arrastar 1 ponteiro: `panPx(dx, dy)` move o foco em km: `u = upp(D) = 2·tan(fov/2)·D/alturaTela` (km por pixel), lateral `dx·u` ao longo de `(cos ψ, −sin ψ)`, frente `dy·u/max(0,35, sin φ)`. Com Shift/Ctrl/Alt ou botão direito/meio: `ψ −= 0,28°/px`, `φ += 0,22°/px`.
- Pinça: `ld −= ln(d/d0)`; rotação dos dois dedos muda ψ; deslocamento vertical do meio muda φ (0,22°/px).
- Roda: `f = e^(clamp(ΔY, ±240)·k)`, `k = 0,0016` (0,012 com Ctrl); zoom **com âncora aproximada**: `foco += (chão sob o cursor − foco)·(1 − e^(Δld))·0,9`.
- Teclado: setas/WASD movem `60·upp` por tecla no rumo da câmera; `q/e` ±18° de rumo; `+/−` ±0,3 em ld; PageUp/Down ∓6° de φ. Ignorado em campos de texto ou com Ctrl/Meta.
- Toque curto (< 7 px, < 0,45 s) → `opts.aoToque(x, y, tipo)`; `opts.aoPassar(x, y)` com o mouse livre.

### 7.5 Modo Mapa

```
phiDe(ld) = 35 + 34·sstep(ln 22, ln 5500, ld)          # 35° perto do chão → 69° com o Brasil inteiro
dFit()    = encaixe · max( (BB.w/2·1,02)/(tan 25°·aspecto), (BB.h/2·1,02·sin 69°)/(tan 25°·livre) )
            livre = max(0,3, 1 − (margTopo + margBase)/alturaTela)
LD_MIN    = ln(mapa.distMin || 9) ; ld ≤ ln(dFit) ; ψ = 0 ; φ = phiDe(ld + hump)
limitarFoco: s = sstep(ln dFit − ln 3,2, ln dFit, ld); meia-caixa = lerp(BB/2 + 15, 40, s) em volta do centro do Brasil
```

- `chaoEstado(st, px, py)`: ponto do chão sob o pixel **se** a câmera estivesse no estado `st` (câmera sombra + raycast no plano y = 0).
- **Arrastar**: o ponto do chão que estava sob o dedo continua sob o dedo (`deslocarFoco(g0 − g1)`), sem mola; amostras dos últimos 0,12 s dão a **inércia** ao soltar (`v = Σdx/dt`, teto `2600·upp(D)` km/s; decai `e^(−3,4dt)`; para abaixo de `6·upp`). Bater no limite zera a inércia.
- **Pinça**: `ld` direto (`CAM.ld = ALVO.ld = clamp(ld − ln(d/d0))`), `φ = phiDe`, e o ponto médio dos dedos fica fixo no chão.
- **Roda / duplo toque / `zoomEm(cx, cy, fator, ω)`**: mola em `ld` (`ZW.v`, 13 padrão, 9 no duplo toque ×2,4) com **âncora**: enquanto a mola anda (até 0,6 s depois de parar), a cada quadro o foco é corrigido para que o ponto do chão originalmente sob o cursor continue sob o cursor (`aplicarAncora`). Roda: `k = 0,0021` (0,014 com Ctrl); a âncora é reaproveitada se o cursor andou < 4 px em < 0,5 s.
- Toque simples → `aoToque` após 280 ms (cancelado por duplo toque < 0,34 s e < 32 px). Teclado: setas/WASD dão inércia `4·80·upp`; `+/−` zoom ×1,6 no centro.
- Voo no Mapa: molas `ω = 4,4` em fx, fy, ld; `cancelarVoo()` em qualquer gesto.

### 7.6 Uniforms que dependem da câmera (`ajustar`)

```
boost     = clamp(1400 / max(300, alturaTela), 1, 1,7)
cityScale = Mapa ? 1 : clamp(h/70·boost, 1, 40·boost) ; capR = 110·boost·CR.fator()
treeScale = clamp(h/5000, 0,02, 1) [Mapa: · sstep(220, 1500, h)]
uTint     = 0,22·sstep(120, 3000, h) (Mapa) ; alfa das divisas × (1 − 0,55·(1 − sstep(25, 500, h)))
mkSz      = 1 − 0,18·sstep(1800, 7000, D) (marcadores menores com o Brasil inteiro)
névoa     near = 18 + 2,2h ; far = min(0,55·far, 240 + 9h)
uPx       = 2·tan(fov/2)/alturaTela
```

---

## 8. Marcadores, pulsos, poeira, anel de seleção e raio-x

### 8.1 Pinos (Mesa)

`InstancedBufferGeometry` de um plano 2×2 deitado; atributo `iP = (x, −y, raioPx, novos?)`. Vertex: `R = raioPx·uPx·d` (raio em km que vale `raioPx` pixels), quad `2,8·R`, levantado `0,0009·d`. Fragment (`PINO`): disco escuro `(0,118, 0,141, 0,188)` com miolo amarelo `(1, 0,824, 0,247)` a 72 %, alfa × `pinFade = sstep(700, 1800, h)` (somem de perto). `raioPx = clamp(5 + 1,7·sqrt(n), 6, 15)`. `renderOrder 9`.

**Pulsos** ("encheu hoje", cidades com `novos > 0`): mesmo mesh sem `PINO`; anel `r = 1 + 1,5·ph` com `ph = fract(0,75·t + fase)`, cor `(1, 0,949, 0,69)`, alfa `(1 − ph)·0,95`, espessura 0,11. `renderOrder 8`.

### 8.2 Marcadores (Mapa)

Quad em **espaço de tela** (`clip.xy += pos·(R + 2)·2/uView·clip.w`), `depthTest false`, `renderOrder 10`. Atributos `iP = (x, −y, rCidade, raioPx)`, `iC = (r, g, b, alfa)`, `iA` (1 quando a cidade tem geometria real).

```
raioMarcadorPx(n) = clamp(2,6 + 0,5·sqrt(n), 3, 11)        # o site usa a mesma conta para decidir colisões
real = rCidade/(uPx·d)·0,8                                  # raio da cidade real em px
f    = smoothstep(10, 22, real)·iA                          # crossfade: a geometria real passou de ~10 px
R    = max(raioPx·uSz·(1 − 0,4f), min(0,95·real, 14)·iA)    # cresce até cobrir a cidade enquanto ela é pequena
alfa = (1 − f)·iC.a
```

Fragment: disco com contorno escuro de `min(0,5, 1,9/R)`, miolo na cor da cidade; se `R > 7,5–10 px` e a cor não é azulada, desenha uma **casinha** (corpo + telhado) escura dentro. Alvos de visibilidade (`marcadoresAlvo`) e de "ativa" (`marcadoresAtivas`) vêm do site e são suavizados a `min(1, 9·dt)` por quadro (`passoMarcadores`). Ordem: mais casas primeiro, desempate por IBGE.

### 8.3 Poeira ao cair

Pool de 96 sprites (`puffTex`: gradiente radial 128², creme). `soltarPoeira(x, y, r, t0)` acorda 3 tufos em ângulos `i·120° + fase(x,y)`, `k = 0,8–1,2`. Por quadro, `pr = (t − t0)/0,6`: raio `(0,7 + 0,9e)·k·s`, altura `(0,2 + 0,4e)·s`, escala `(0,7 + 0,7e)·k·s`, opacidade `(1 − pr)^1,5·0,85`, com `e = 1 − (1 − pr)²` e `s = escalaCidade(r)`. Disparos: casa nova (`t0 = queda + 0,34`, no máximo ~40 tufos por atualização), marco novo (`+0,1`), obra que mudou de estado (`+0,34`).

Agendamento das quedas em `atualizar(L, {animar})`: casas novas caem em sequência a partir de `t + 0,15` com passo `clamp(2,6/n, 0,012, 0,045)` s; marcos novos a partir de `t + 0,9` com passo 0,5 s. Os instantes ficam em `casaT`/`marcoT`/`obraT` (Maps por chave) para sobreviver a reescritas, limpos após 9 s / 12 s.

### 8.4 Anel de seleção

`RingGeometry(0,82, 1, 40)` deitado, `#fff2b0`, sem tone mapping, `renderOrder 8`. Com `selecao = {x, y, r}`: `ph = fract(0,9t)`, escala `s·(1,6 + 0,9ph)`, opacidade `0,95·(1 − ph)`, `y = 0,05·s`.

### 8.5 Raio-x (`raioX(casa)`)

`uXr = (x, 0,6·e, −y, 1,3·e)` com `e = escalaCidade(r)` (`w = 0` desliga). Toda instância (casa, árvore, prédio, primitiva) cujo eixo vertical passa a menos de `w` do segmento câmera → casa fica **pontilhada** (descarte xadrez, §6.8.3), revelando a casa escolhida atrás de prédios.

---

## 9. Governador de desempenho

```
a cada 75 quadros (ou ≥ 5 quadros e ≥ 2,2 s): fps = n/Δt ; histórico (40 últimos)
meta = 28 fps (celular) · 42 fps (desktop)
se ligado e fps < meta e nivel > 0 e passaram 2,2 s desde a última troca e 3 s desde o início:
     definirNivel(nivel − 1)
definirNivel(n): Q.nivel = clamp(n, 0, 3); aplica DPR (DPR_MAX), mapa de sombra (SOMBRA), invalida árvores finas
                 (fine.sujo, DR.sujo), renderer.setSize, opts.aoNivel(n)
```

O governador só **desce**; `semGovernador()` desliga; o tempo gasto construindo a malha de relevo é descontado (`gov.n = 0`).

---

## 10. API pública (`criarMundo(canvas, opts)` → `api`)

`opts`: `mapa {cores: {UF: hex}, distMin, encaixe}`, `nivel`, `dprMax`, `preservar` (preserveDrawingBuffer), `governador: false`, callbacks `aoQuadro({dt, h, cs, D})`, `aoToque(x, y, tipoPonteiro)`, `aoPassar(x, y)`, `aoNivel(n)`, `aoPerderContexto()`, `aoRestaurarContexto()`. Devolve `null` se o WebGL falhar.

| Função / propriedade | O que faz |
|---|---|
| `atualizar(L, {animar})` → `{novas, marcosNovos}` | Recebe o layout; recalcula círculos das cidades, agenda relevo, agenda quedas, `CR.atualizar`, obras, pinos/marcadores, árvores (se a assinatura das cidades mudou), aquece shaders |
| `voar(p, {rapido})` | `p = {x, y, dist, phi, psi}` parciais |
| `voarCidade(c, extra)`, `voarCasa(c)`, `voarMarco(cid, m)`, `brasil()` | atalhos de voo (§7.3) |
| `pousar({x, y, dist})` (Mapa), `pular()` | salto sem animação |
| `zoom(f)`, `girar(graus)`, `zoomEm(cx, cy, fator, ω)` | zoom relativo; rumo; zoom com âncora (Mapa) |
| `setOffset(px, py)`, `setMargens(topo, base)`, `setQuadro(r)` | área livre da tela / aspecto forçado para `brasilDist` |
| `pickCidade(cx, cy)` | cidade sob o pixel (raio visual + tolerância 22 px) |
| `chao(cx, cy)` → `{x, y, d}` | pixel → km no plano do chão |
| `projetar(x, y, alt)`, `projetarCasa(c, alto = 1,35)` → `{x, y, ok, z}` | km → pixel (a casa com `alto·escalaCidade(r)` de altura) |
| `selecionar(c)`, `raioX(c)` | anel de seleção; raio-x |
| `escalaCidade(r)` | fator de inflação atual |
| `definirCirculos([{x, y, r, ibge}])` | o site passa círculos externos (todas as cidades, não só as do layout): árvores, relevo |
| `definirMarcadores(lista)`, `marcadoresAlvo(Float32Array)`, `marcadoresAtivas(Float32Array)`, `escalaMarcador()` | marcadores externos e seus alvos de visibilidade/atividade |
| `aquecerCidades()` | render único com todos os meshes de cidade visíveis (compila shaders) |
| `estadoCamera()` → `{D, h, fx, fy, ld, phi, dFit, voando, kmPorPx}` | leitura da câmera |
| `cam()`, `alvo()`, `bb`, `cancelarVoo()`, `estaVoando`, `alturaCamera`, `ultimaMao` | estado |
| `ufEm(x, y)` | sigla da UF no ponto |
| `relY(x, y)`, `corA` (= `A`, pré-compensação ACES; no original a chave leva o nome do parceiro) | utilidades para o host |
| `cidGrupos()` | grupos instanciados da cidade por nome (`predioN` para os prédios) |
| `orbitaAuto(bool)`, `semGovernador()`, `definirNivel(n)`, `nivel`, `fps`, `historicoFps`, `ehCelular`, `quadros` | desempenho |
| `custoQuadro(n = 60)` → `{cpu, gpu, wall}` | mede ms por quadro (timer query se disponível) |
| `perf`, `triangulos()`, `info()` | estatísticas |
| `perderContexto()`, `restaurarContexto()`, `contextoPerdido` | teste de perda de contexto |
| `renderer`, `scene`, `camera`, `parar()` | acesso bruto; para o laço |

`Cidade` exporta: `construirCidade, urbanizar, anonimas, criarTerra, criarRender, escalaVisual, nivelDe, T3_FEATS, proximaConquista, conquistas, marcosDe, clareira, texClareira, tomArvore, nevoa, criarNuvens, GLSL_AMB, GLSL_TERRA_DEPOIS_DENS, GLSL_TERRA_COR, GLSL_MAR_COR, CLR_BOX, G, MARCO, NOME_MARCO, rng32, hashN, vnoise, h2, clamp, lerp, sstep`. `Relevo` exporta `criar, decodificar, inflar, desfazerSub, BIOMAS`; o objeto de `criar` tem `Y, Yraw, F, achatar, construirMalha, geometria, densBytes, biomaEm, uniformes, GLSL_DECL, GLSL_BASE, GLSL_COR, exagero, dados, BIOMAS`. `CR` (criarRender) expõe `atualizar, lod, fator, todosMeshes, grupos, predios, estat, atlas, mats, criarGrupo, geos, juntar, boxTris, quad, cilTris, discoTris, GLSL_COMUM, GLSL_PROJETO, patch`.

---

## 11. Constantes e tabelas numéricas (resumo)

| Grupo | Valores |
|---|---|
| Marcos | prédio 100 · hospital 1000 · cassino 10000 casas; `rank(k) = round(70·k^0,85)`; hospital `achar(650, 2, 90)`; cassino `achar(2400, 3, 120)` |
| Malha base `G` | Su 3,7 · Sv 12 · nLotes 8 · avExtra 0,52 · hwRua 0,30 · hwCalcada 0,07 · hwAv 0,78 · hwAvCalc 0,9 · roRua 1,0 · roAv 1,52 · aRua 0,68 · aAv 1,2 · praça 2,3 · anel 1,95 · avDesde 20 · passo das polilinhas 1,7 |
| Lotes | `Rc0 = max(16, sqrt((n+200)·3,2/π)·1,4/0,78·aniso^0,6)`; corte `0,78·Rc`; `Rc *= 1,6` até 7 vezes; folga ≥ n + 220; lote mínimo a `Rp + 1,1` do centro |
| Warp | `sstep(4, 24, r)`; swirl `sstep(3, 42, r)`; ruído da chave `0,07` × 0,2 |
| Praça | ESC 1,0/1,1/1,28/1,45; forma fonte 2 · coreto 4,6 · arborizada 2,3 · monumento 3,2 · planejada 6; placa em (−0,9, −1,0)·esc; gramado r 0,9 |
| T3 | 25 feats, 5 por nível; `T3_ALVO_MAX 700`; zonas R: solar 1,9 · eta 1,3 · reserv 1,3 · dessal 1,6 · aero 2,7 · auto 3,1; metrô a 1,3 km de altura até 26 km; ponte: vão 1,4–18 km, tabuleiro 0,82, pilone 3,5 |
| Anônimas | semente 20261014; `MAX_CINZA 8000`; `ESCALA_GRANDE 1000`; `POP_GRANDE 100000` |
| `urbanizar` | célula 2 km; disco livre 4,5 km; espiral 2→200 km, 20 ângulos; marca praça `max(3,4, r+1,3)`, lote 1,2 |
| Relevo | grade 384², hmax 3000 m, σ 10 km; exagero 10; PISO 0,15/0,25/0,32; TOL 0,8/1,4/1,9; LIMREL 1,5/2,5/3,1; TOPO 64, FOLHA 2; platô `rin = 1,05r + 2`, `rout = rin + max(4, 0,3r)`; vértices +0,02; rocha 550–2300 m; sombreado ×24, clamp 0,55–1,4 |
| Luz | SUN (−0,62, 0,56, −0,36); hemi 1,45 `#f3f5ff/#c6d79c`; sol 2,3 `#ffe6c6`; exposição 1; `KLIT = (1,45 + 2,3·0,56)/π` |
| Qualidade | SOMBRA [0, 1024, 2048, 4096]; DENS_ARV [2,2, 1,7, 1,0, 0,8]; DPR_MAX [1, 1,5, 2, 2]; meta fps 28/42; FINE_CAP 9000; orçamentos [2500, 5000, 9000, 9000] / Mapa [1200, 2600, 6000, 9000]; passo fino 3,5 ms / Mapa 2,6 ms |
| Árvores | grossas passo 30 km (42 Mapa celular), `dens^0,9`; finas R 55, c0 0,36, R0 16, `dens^0,85`; Mapa fade 60–115 km, crossfade 0,6 s, meia-oitava; caixa −2140..2140 × −2200..2200 |
| Inflação | `cap = capR·(0,35 + 0,65·sqrt(min(1, r/90)))`; `cityScale = h/70·boost` (1–40·boost); `capR = 110·boost·fator`; `fator = clamp(sqrt(150/nCidades), 0,3, 1)`; `boost = clamp(1400/alturaTela, 1, 1,7)` |
| Câmera Mesa | ld [ln 7, ln 14000]; φ [20, 78]; foco ±2250/±2300; ω 8,5 (voo 5,0; φ/ψ ×1,1); roda k 0,0016 (Ctrl 0,012), âncora 0,9; girar 0,28°/px e 0,22°/px; teclado 60·upp, q/e 18°, ±0,3 ld, PgUp/Dn 6° |
| Câmera Mapa | `phiDe = 35 + 34·sstep(ln 22, ln 5500, ld)`; LD_MIN ln 9; dFit com 1,02 de folga e sin 69°; foco meia-caixa `lerp(BB/2 + 15, 40, s)`; inércia decai 3,4/s, teto 2600·upp, para em 6·upp; roda k 0,0021 (Ctrl 0,014); ZW 13 (duplo toque 9, ×2,4); voo ω 4,4; âncora expira 0,6 s |
| Névoa / fundo | near 18 + 2,2h; far min(0,55·far, 240 + 9h); mar em `−(0,12 + 0,011h)`; céu 0,9·far; sombra E = clamp(6h, 36, 5400) |
| Marcadores | pinos `clamp(5 + 1,7√n, 6, 15)` px, fade 700–1800 km; Mapa `clamp(2,6 + 0,5√n, 3, 11)` px, crossfade real 10–22 px, teto 14 px, suavização 9/s; `mkSz = 1 − 0,18·sstep(1800, 7000, D)` |
| Animações | queda site 7·s em 0,34 s + squash 0,30·e^(−7s)·cos 22s; vídeo 6·s em 0,32 s + quique 0,8·s·e^(−7s)·|sin 13s|; marco sobe `1 − e^(−3,5τ)(cos 6,06τ + 0,578 sin 6,06τ)`; poeira 0,6 s; passo das quedas clamp(2,6/n, 0,012, 0,045); marcos +0,9 s, passo 0,5 s |
| Placas | atlas 8×32 de 256×64; placa `0,85·esc` × (0,5…0,98)·esc a `z = −1,2·esc` |
| Nuvens | 8×3 puffs, altura 380, span 5600, vento 3,2–5,6, visíveis h > 450, sombra 0,11 terra / 0,10 mar |
| Cores de fábrica | PAREDES, TELHADOS, FLORES, COL, COR, T3C, CAM_T3 (§3.16.3, §6.1); escurecimento: paredes 0,62 · telhados 0,42 · ouro `#D08A00`·0,22 · T3 0,72 |
