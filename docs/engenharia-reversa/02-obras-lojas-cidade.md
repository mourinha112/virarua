# 02 · Obras, lojas e cidade — especificação técnica para reimplementação

Engenharia reversa do mapa 3D (Three.js) do jogo social "não é um mapa". Este documento cobre o **kit de construção voxel**, o **catálogo de obras** (genéricas, famosas e monumentos de capitais), as **lojas patrocinadas** (padrão e sob medida), como obras e lojas **entram no mapa**, o **nível da cidade** e seu painel, a **cidade do futuro**, os utilitários `hash`/`urbanista`/`alta` e a obra especial do patrocinador de saúde. É escrito como especificação: prosa + pseudocódigo curto, sem código colado. Nomes de empresas e `@` reais foram omitidos ("loja especial X", "patrocinador de saúde").

Módulos de origem (arquivo `app.js` legível, build do site):

| Módulo | Função |
|---|---|
| `shared/figo.js` | Hospital do patrocinador de saúde (modelo 3D com letreiro-logo) |
| `shared/obras.js` | Kit (pincel), paleta, fonte 5x7, mola, registro de 14 famosas + 14 genéricas |
| `shared/obras-cidades-a.js`, `-b.js` | 21 monumentos de capitais + canteiro de obras |
| `shared/lojas-especiais/*.js` | 97 lojas sob medida (padrão de registro) |
| `shared/lojas.js` | 12 tipos de loja, fachada padrão, ícones, letreiro canvas, cache |
| `site/src/hash.js` | Normalização do @ e SHA-256 → chave de 16 chars |
| `site/src/urbanista.js` | Urbanismo sob demanda (uma cidade por vez, chão ocupado) |
| `site/src/figo.js` | Integração do hospital no site (posição, cartão, selo) |
| `site/src/alta.js` | Buff "em alta no story" (anel + chama 3D) |
| `site/src/obras-mapa.js` | Obras com meta de moradores (canteiro → monumento) |
| `site/src/lojas-mapa.js` | Lojas no mapa, vigência, posição, cartão, /api/seguir |
| `site/src/lojas-visiveis.js` | Raio-X: nada tapa uma loja patrocinada |
| `site/src/obras-t3.js` | 11 modelos de infraestrutura (upgrades da cidade) |
| `site/src/cidade-nivel.js` | "A cidade cresce com os pontos": D.CV, custo, prefeito decide |
| `site/src/cidade-painel.js` | Painel da cidade (medidores, gráfico, trilha de 25 upgrades) |
| `site/src/cidade-futuro.js` | Torre-farol, monotrilho, drones, cúpula, holograma (níveis 3-5) |

---

## 0. Convenções globais

- **Unidade: km** do mundo. Eixo x = leste, y = para cima, z = sul (no Three). O mapa 2D usa (x, y) com y = norte; na cena, `z = −y`.
- **Origem do objeto no centro do lote, chão em y = 0, fachada voltada para +z** (yaw 0). Como a câmera olha do sul para o norte, +z é "de frente para o jogador".
- Escalas de referência: casa ≈ 1,1 km de largura × 0,9 de altura; prédio de 12 andares ≈ 5,5; hospital comum da cidade 2,4 × 2,0; as obras ficam entre 3 e 9 km porque a câmera dos vídeos fica a ~15 km, 33° de elevação (a silhueta é o que importa).
- Todos os módulos "shared" **não importam Three**: recebem `T` (o namespace THREE) por parâmetro e, opcionalmente, `A(hex) → T.Color` (função de cor do mundo pré-compensada para o tone mapping ACES; sem ela usa `new T.Color(hex)` direto). Sem `import/export`: o texto é embutido no build e também roda em Node (parser de comentários, testes).
- Material padrão de tudo que é "construção": `MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })` — **toda cor é por vértice**, um material só para o mundo inteiro (o que permite fundir malhas e instanciar).
- Yaw "fachada para o centro da cidade": `yaw = atan2(cx − px, −(cy − py))` com (px, py) a posição do objeto no plano do mapa.

---

## 1. O kit de construção voxel (`obras.js`)

### 1.1 Paleta `C` (a do mundo)

| chave | hex | chave | hex | chave | hex |
|---|---|---|---|---|---|
| branco | #f3f4f6 | gelo | #e6e9ee | cinzaC | #c9ced6 |
| cinza | #97a0ae | cinzaE | #59616d | grafite | #2c3342 |
| vidro | #5b7fa8 | vidroE | #3f5670 | vidroC | #9fc4dc |
| agua | #8ecdf0 | aguaC | #aee2f5 | grama | #78ad54 |
| gramaC | #a1cf7a | mata | #5aa247 | mataE | #3f7f3a |
| tronco | #8a6a45 | troncoC | #a4825a | calcada | #dfdedc |
| asfalto | #6b6f72 | areia | #eeeec8 | terra | #d9cfb4 |
| pedra | #c9c5b8 | vermelho | #d9453a | amarelo | #FFD23F |
| ouro | #e8b84b | laranja | #f2a93b | azul | #3f78c4 |
| verde | #4f9c3f | | | | |

### 1.2 Mola de construção `mola(tau)`

Resposta de 2ª ordem sub-amortecida, fechada em t (determinística — não precisa de estado):

```
mola(tau):
  se tau <= 0 → 0 ; se tau > 1.4 → 1
  z = 0.42, w = 22, wd = w·sqrt(1 − z²), e = exp(−z·w·tau)
  → 1 − e·(cos(wd·tau) + (z·w/wd)·sin(wd·tau))
```
Sobe de 0, passa de 1 (~1,2) e assenta em ~1,4 s. É a mesma mola do `springPop` do renderizador dos vídeos com s0 = 0.

### 1.3 Fonte de pixels 5x7 `FONTE`

Glifos de 5 colunas × 7 linhas em strings `'X'`/`'.'`. Em `obras.js` existem: **A C E G H I L M N O P R S Z** e espaço. `obras-cidades-b.js` acrescenta **B J R T U V** (tabela `FB`). Qualquer caractere ausente vira espaço. Ex.: `A = ['.XXX.','X...X','X...X','XXXXX','X...X','X...X','X...X']`.

### 1.4 `Obras.kit(T, opts)` — o pincel

`opts = { A?, mat? }`. Devolve `{ T, A, estagio, montar, boxTris, quad, FONTE, estagios }`.

**Estágio** = `K.estagio(nome, base = 0, delay?)`: um acumulador de triângulos (`pos[]`, `col[]`) que vira **um Group por estágio** com `position.y = base`. Na animação de construção cada estágio sobe do chão com a mola a partir da sua `base`; `delay` (segundos) é o atraso explícito, senão `índice × passo`. Todos os vértices são guardados com `y − base` para que o `scale.y` do grupo cresça "a partir do pé".

Cada estágio `s` expõe (todas devolvem `s`, encadeáveis; `hex` = cor; `xf` = transformação `{x,y,z, rx,ry,rz (Euler 'YXZ'), s | sx,sy,sz}` ou uma `Matrix4`):

| primitiva | assinatura | o que é |
|---|---|---|
| `add` | `(triangulos[], hex, xf?, ao?)` | base de tudo; `ao` = altura (km) do escurecimento perto do chão: fator `0.78 + 0.22·clamp((y − y0)/ao)` |
| `tris` | `(a, hex, xf?)` | triângulos soltos |
| `box` | `(w, h, d, hex, xf?)` | caixa centrada em x/z, pé em y = 0; AO automático se h > 0,5 (até 1,4) |
| `bx` | `(x0,y0,z0, x1,y1,z1, hex, ao?)` | caixa por limites; `ao=true` liga AO (min(altura, 1,4)) |
| `cyl` | `(r0, r1, h, seg=10, hex, xf?, ao?)` | cilindro/tronco de cone, r0 embaixo, r1 em cima, pé em 0 |
| `cone` | `(r, h, seg, hex, xf?)` | = cyl(r, 0, …) |
| `esfera` | `(r, hex, xf?, ws=10, hs=7, t0?, t1?)` | esfera ou fatia (theta a partir do polo de cima) |
| `domo` | `(r, hex, xf?, ws=12, hs=5)` | meia esfera superior |
| `torno` | `(perfil[[raio,y]…], seg=12, hex, xf?, phi0?, phiN?)` | sólido de revolução (LatheGeometry), perfil de baixo para cima; `phi0/phiN` permitem fatias angulares (ex.: 1/3 de círculo colorido) |
| `anel` | `(rf, rd, h, seg=16, hex, xf?)` | tubo oco (raio fora/dentro), pé em 0 |
| `prisma` | `(poly[[x,z]…], h, hex, xf?, ao?)` | polígono extrudado em altura |
| `telhado` | `(w, h, d, hex, xf?)` | duas águas, cumeeira ao longo de x, 2 empenas triangulares |
| `pir` | `(w, d, h, hex, xf?)` | pirâmide de base retangular |
| `tubo` | `(p[3], q[3], r0, r1?, hex, seg=4)` | viga/tubo entre dois pontos (cilindro alinhado) |
| `laje` | `(p, q, w, h, hex)` | placa inclinada entre dois pontos, largura w, espessura h |
| `fita` | `(pts[], w, h, hex, junta=true)` | sequência de lajes por polilinha + discos nas juntas (ruas, pistas, tabuleiros) |
| `poly` | `(pts3d[], hex)` | leque de triângulos (polígono convexo plano) |
| `texto` | `(str, vx, hex, xf?, prof?) → largura` | letreiro em voxels voltado para +z: cada pixel 'X' vira caixa `vx × vx × prof` (prof padrão vx/2, folga 8%); avanço de letra 6·vx |
| `com` | `(xf, fn)` | tudo que `fn(s)` desenhar fica dentro de `xf` (pilha de matrizes: desenha na origem, posiciona depois) |

Propriedade extra: `s.junto = 'outroEstagio'` → a malha vai para o grupo do outro estágio (mesma base), usada quando se quer uma malha separada mas que sobe junto (cabines da roda-gigante).

**`K.montar(extra?) → Group`**: para cada estágio não vazio cria `BufferGeometry(position, color)` + `computeVertexNormals`, `Mesh(mat)` com sombras e `frustumCulled = false`, dentro de `Group 'estagio:<nome>'` em `y = base`. Preenche `root.userData = { estagios: [{g, nome, delay}], malhas: {nome → Mesh}, …extra }`.

### 1.5 Ajudantes de cena

- `Obras.lote(K, w, d, {cor?})` → estágio `'lote'` (base 0, delay 0): calçada `#dfdedc` com 0,12 de borda e 0,035 de espessura + gramado claro (`gramaC` ou `cor`) de 0,035 a 0,06.
- `Obras.arvore(s, x, z, k=1, y=0)`: tronco `cyl(0.05k, 0.06k, 0.3k, 5, tronco)` + copa `esfera(0.5k, mata, {y: y+0.62k, sy: 1.05}, 5, 3)` (icosaedro de 5x3).
- `Obras.palma(s, x, z, k, y, ry)`: tronco curvo em 5 tubos (lean 0,22k, altura 1,9k, cores alternadas tronco/troncoC), 8 folhas planas em leque (duas tonalidades `#79c457`/`#5fae45`, comprimento 1,0–1,22k), coco `#5a3d22`. k é multiplicado por 0,72 internamente.
- Internos de obras.js: `carro(s, cor)` (0,4 × 0,22, frente em +x, teto vidroC) e `aviao(s, cor)` (fuselagem branca, nariz em +x, asas `laje`, cauda na cor).

### 1.6 Registro e API

```
reg({ id, nome, apelidos[], categoria: 'famosa'|'generica', tamanho:[larg, prof, alt],
      centro?: [dx, dz]   // desloca só o lote (calçada) sob a obra
      escala?: k          // scale uniforme aplicado ao grupo final
      via?: 'cidade'      // a obra existe em outro módulo (criar = null)
      criar(K, opts) → Group })

Obras.lista            → metadados de todas (sem a função)
Obras.obter(id)        → entrada ou null
Obras.criar(id, T, {A, mat, lote:true}) →
   K = kit(T, opts); se lote ≠ false: lote(K, larg/esc + 0.5, prof/esc + 0.5)
   g = o.criar(K) || K.montar(); se centro: desloca o grupo 'lote'; se escala: g.scale = esc
   g.userData.{id, tamanho}; g.name = 'obra:'+id
Obras.animar(g, t, {t0=0, passo=0.2}) →
   para cada estágio i: tau = t − t0 − (delay ?? i·passo); v = mola(tau)
   visível se tau > 0; scale = (sxz, max(0.001, v), sxz) com sxz = 1 + 0.16·(1 − clamp(v, 0, 1.2))
   se g.userData.vivo: vivo(t − t0)      // animação contínua (roda-gigante gira)
Obras.duracao(g, {passo}) → max(delay_i) + 1.0 segundos
```
Exporta também `mola, kit, C, FONTE, lote, arvore, palma`.

---

## 2. Catálogo de obras

### 2.1 Famosas (`categoria: 'famosa'`, 14)

| id | nome | tamanho (l × p × a) | apelidos (para o parser de comentários) | descrição visual |
|---|---|---|---|---|
| cristo-redentor | Cristo Redentor | 4,5 × 4,5 × 7,5 | cristo redentor, cristo do rio, cristo do corcovado, o cristo, cristo, redentor, corcovado, cristo redentor do rio | morro verde em tronco de cone (2 estágios) com 7 árvores, pedestal em 3 caixas bege, corpo em torno branco, cabeça esfera, braços = tubos horizontais (delay 1,15) |
| pao-de-acucar | Pão de Açúcar com bondinho | 6,8 × 4,9 × 4,5 | pao de acucar, …, bondinho, morro da urca | dois morros de torno (cinza-pedra sobre verde), 3 estações brancas com teto vermelho, 2 cabos pretos, 2 bondinhos (vermelho e amarelo) pendurados |
| maracana | Maracanã | 7,4 × 6,4 × 1,6 | maracana, maraca, maracanazao, estadio do maracana… | arquibancada elíptica (sx 1,1667) em anéis de torno bege/branco/azul, gramado em anéis verdes, cobertura branca em anel + 40 tubos de treliça |
| congresso-nacional | Congresso Nacional | 6,6 × 3,2 × 4,3 | congresso nacional, congresso, camara e senado, senado… | base cinza com dois espelhos d'água, laje branca com 13 pilares, duas torres gêmeas brancas com vidro escuro, cúpula (domo) à esquerda e "tigela" invertida (torno) à direita |
| catedral-de-brasilia | Catedral de Brasília | 5,6 × 5,6 × 3,9 (escala 0,9) | catedral de brasilia, catedral metropolitana…, catedral da coroa de espinhos | espelho d'água circular, "coroa" hiperbólica de 16 tubos brancos em torno de vidro azul (R(u) = sqrt(rw² + a²(u−uw)²)), campanário de 4 pilares com 2 sinos |
| masp | MASP | 5,8 × 2,8 × 2,8 | masp, museu de arte de sao paulo, museu da paulista… | praça cinza, 4 pórticos vermelhos (#d9453a) com 2 vigas, caixa de vidro azulada suspensa em y 1,0 com 9 montantes brancos |
| ponte-estaiada | Ponte Estaiada (Octavio Frias) | 7,4 × 5,4 × 8,4 | ponte estaiada, ponte octavio frias…, ponte do x | rio, duas pistas curvas (fita) em alturas diferentes, mastro em X de dois tubos brancos até 8,4, 24 cabos finos |
| teatro-amazonas | Teatro Amazonas | 4,6 × 3,8 × 3,9 (centro [0, 0,3]) | teatro amazonas, teatro de manaus, opera de manaus… | corpo salmão com janelas escuras, colunata de 6 colunas creme com telhado, cúpula em 18 gomos verde/amarelo/azul (torno em fatias) com lanterna dourada e pináculo vermelho |
| elevador-lacerda | Elevador Lacerda | 5,6 × 2,5 × 6,5 (centro [0,5, 0,05]) | elevador lacerda, elevador de salvador, lacerda… | penhasco em 3 degraus ocre com casinhas coloridas em cima (cidade alta), cidade baixa com casinhas, torre bege de 6,5 com janelas azuis e topo vermelho, passarela ligando torre ao penhasco |
| ponte-hercilio-luz | Ponte Hercílio Luz | 7,6 × 2,7 × 4,7 | ponte hercilio luz, ponte de floripa, ponte pensil… | mar, duas margens, tabuleiro cinza-claro com treliça de 24 montantes, duas torres de 4 tubos, correntes parabólicas (sag) com 15 pendurais por lado |
| opera-de-arame | Ópera de Arame | 6,4 × 5,9 × 2,4 (centro [−0,05, −0,15]) | opera de arame, teatro de arame… | lago circular com 7 árvores, plateia cilíndrica de vidro claro com 28 tubos de aço e 5 anéis, palco em caixa de vidro com grade, teto cônico com 14 nervuras, passarela de madeira |
| ver-o-peso | Mercado Ver-o-Peso | 6,3 × 4,1 × 3,3 | ver o peso, mercado de belem, mercado de ferro… | rio + cais, mercado bege com telhado verde-água de duas águas e 4 torres piramidais, torre central, 6 barracas com toldos cônicos coloridos, 3 barcos com cabine |
| torre-eiffel | Torre Eiffel | 4,0 × 4,0 × 9,4 | torre eiffel, eiffel, torre de paris, torre eifel… | treliça em 3 estágios (cortes em y 0/1,7/3,45/8,3) com perfil `hw(y)` interpolado em 10 níveis, 4 pernas + diagonais em X em cada face, arcos de base, plataforma em 1,7, agulha |
| estatua-da-liberdade | Estátua da Liberdade | 3,5 × 3,5 × 8,5 | estatua da liberdade, liberdade, statue of liberty… | forte em estrela de 11 pontas (prisma), pedestal em 3 caixas, corpo verde-cobre em torno, coroa de 7 tubos, braço direito erguido com tocha dourada/amarela, tábua no esquerdo |

### 2.2 Genéricas (`categoria: 'generica'`, 14)

| id | nome | tamanho | apelidos | descrição visual |
|---|---|---|---|---|
| estadio | Estádio | 7,1 × 6,0 × 3,4 | estadio, estadio de futebol, arena, campo de futebol, estadio gigante… | arquibancada elíptica azul/branca/vermelha (sx 1,14), gramado listrado, cobertura cinza-escura em anel com 28 tubos, 4 torres de refletores nos cantos (3,0 de altura) |
| shopping | Shopping | 6,8 × 4,5 × 2,6 (centro [−0,05, 0,3]) | shopping, shopping center, mall… | estacionamento com 11 vagas e 7 carros coloridos, corpo bege com vitrines azuis e 13 pilastras, átrio de vidro central com telhado, letreiro vermelho com texto voxel **"SHOPPING"** |
| aeroporto | Aeroporto | 7,1 × 5,1 × 2,3 (centro [0,05, −0,15]) | aeroporto, aeroporto internacional, pista de pouso… | pista escura com marcações brancas, taxiways, estacionamento com 7 carros, terminal branco envidraçado, torre de controle com topo azul e luz vermelha, 3 aviões (vermelho, azul, amarelo) |
| ponte | Ponte | 7,6 × 2,6 × 4,4 | ponte, ponte pensil, ponte suspensa, golden gate… | igual à Hercílio Luz mas laranja-avermelhada (#e0502f) estilo Golden Gate: tabuleiro, 2 torres de 4,3, cabos parabólicos e pendurais |
| roda-gigante | Roda-gigante | 4,6 × 1,9 × 4,8 | roda gigante, london eye, roda… | base cinza com bilheteria vermelha, 2 pares de pernas vermelhas até o cubo (y 2,75), roda de 28 segmentos azul + 12 raios por lado, 12 cabines coloridas (estágios `cabine0..11` com `junto='roda'`); `userData.vivo(t)` gira a roda em z a 0,25 rad/s e reposiciona as cabines |
| parque-aquatico | Parque aquático | 6,6 × 5,6 × 3,3 (centro [−0,05, 0,15]) | parque aquatico, aqua park, toboagua, beach park… | deck areia, piscina retangular com raias, 2 piscinas redondas, 4 palmeiras, 4 guarda-sóis, torre amarela/vermelha de 2,7, 2 toboáguas helicoidais (vermelho e azul, 24 segmentos) + 1 reto verde |
| castelo | Castelo | 5,9 × 5,0 × 5,6 | castelo, castelo medieval, castelo da disney, fortaleza… | fosso azul, gramado, ponte de madeira, muralha com ameias e portão, 4 torres cilíndricas com cones (2 vermelhos, 2 azuis), 2 torrinhas no portão, torreão central com torre cônica azul e bandeira amarela |
| arranha-ceu | Arranha-céu | 3,0 × 3,1 × 10,1 | arranha ceu, torre, predio gigante, burj khalifa, empire state… | pódio cinza, 4 tiers (larguras 2,2/1,8/1,4/0,9) brancos/gelo com faixas de janelas azuis a cada 0,34, cornijas, antena até 10,0 com luz vermelha |
| escola | Escola | 5,8 × 4,7 × 2,5 | escola, colegio, creche, faculdade, universidade… | quadra azul com linhas, ônibus amarelo, 4 árvores, prédio amarelo-claro com faixa azul e janelas, bloco central branco, letreiro azul com texto voxel **"ESCOLA"**, mastro com bandeira do Brasil |
| igreja | Igreja | 4,4 × 5,2 × 4,3 (centro [0,1, 0,3]) | igreja, igreja matriz, capela, basilica, santuario, templo… | adro com 2 palmeiras, nave creme com telhado vermelho, fachada com frontão triangular, porta, rosácea azul, cruz dourada, 2 torres com pináculos piramidais e cruzes |
| praia | Praia / lago | 5,9 × 6,2 × 1,6 (centro [0,1, −0,15]; escala 0,88) | praia, lago, lagoa, orla, beira mar, calcadao da praia… | areia e água em discos (torno elíptico) com faixa de espuma branca, 3 palmeiras, 6 guarda-sóis com toalhas, guarita de salva-vidas, píer de madeira, veleiro |
| autodromo | Autódromo | 7,4 × 5,2 × 1,4 (centro [0, 0,35]) | autodromo, pista de corrida, interlagos, formula 1, kartodromo, f1… | gramado elíptico + lago, pista paramétrica `P(t) = [2,95cos t + 0,32cos 3t, 1,5 sin t + 0,32 sin 2t − 0,12 sin 3t]` (72 segmentos, fita cinza com borda branca e zebras vermelho/branco), arquibancada, boxes, torre, pórtico de largada amarelo, 5 carros de corrida |
| zoologico | Zoológico | 6,8 × 5,6 × 2,1 (centro [0, −0,15]) | zoologico, zoo, jardim zoologico, safari… | caminho de pedra, 3 recintos (savana amarela, terra, pasto) com cercas de madeira, 2 lagos, 8 árvores, portão com texto voxel **"ZOO"**, girafa, elefante e zebra low-poly |
| metro | Estação de metrô | 5,6 × 2,4 × 3,2 (centro [0,25, 0,6]) | metro, estacao de metro, trem, cptm… | viaduto em 5 pilares com trilhos, estação elevada com cobertura branca/azul, trem de 3 vagões branco/azul, entrada de vidro, escada (laje), placa azul com texto voxel **"M"** |
| hospital | Hospital | 2,4 × 1,1 × 2,1 | hospital, posto de saude, upa, pronto socorro, santa casa, clinica, ubs… | **via 'cidade'** (modelo do módulo de cidade; criar = null; só apelidos/tamanho para o parser) |
| cassino | Cassino | 3,7 × 1,1 × 2,3 | cassino, casino, las vegas… | **via 'cidade'** (idem) |

Observação de reimplementação: o parser de comentários do backend casa o texto do comentário contra os `apelidos` (sem acento, minúsculas) para decidir qual obra uma cidade "pediu"; o site só consome o id já resolvido (ver §4).

### 2.3 Monumentos de capitais — lote A (`ObrasCidadesA`, 11 + canteiro)

Formato: `{ id, nome, cidade, uf, tamanho, criar(T, opts) }`, `opts = { A, mat, progresso?, lote? }`. Só `canteiro` usa `progresso`. Ajudantes locais: `estrela(n, R, r, rot0)` (polígono estrelado), `perfilZ(K, s, pts2d, z0, z1, hex)` (perfil extrudado em z), `abobada(K, s, hw, h, z0, z1, hex)` (abóbada parabólica `h·(1 − (|x|/hw)^1.7)`), `agua(K, w, d, cor, cor2, nome)` (retângulo d'água + 7 riscos de espuma), `figura(e, hex, braco)` (estátua estilizada de 1,0 de altura), `tri2` (triângulo de dois lados).

| id | cidade/UF | nome | tamanho | descrição visual |
|---|---|---|---|---|
| torre-de-cristal | Recife/PE | Torre de Cristal | 4,2 × 4 × 7,5 | água, molhe de pedra com plataforma estrelada, torre afunilada em 3 fatias de vidro (3 tons de azul) com anéis brancos, pináculo dourado, 3 "cristais" cônicos inclinados na base |
| catedral-de-fortaleza | Fortaleza/CE | Catedral de Fortaleza | 4,2 × 5,6 × 7 | nave com contrafortes e telhado cinza, transepto, tambor + flecha cônica no cruzeiro, 2 torres quadradas com pináculos piramidais de 2,8 e 4 pináculos menores, portal ogival, rosácea, degraus, 4 árvores |
| igreja-da-pampulha | Belo Horizonte/MG | Igreja da Pampulha | 5,2 × 5,2 × 3,8 | lagoa, ilha gramada, 6 abóbadas parabólicas brancas (nave, abside, 4 capelas), painel de azulejos azul-branco (padrão pseudoaleatório 7×4), campanário trapezoidal separado, árvores + palmeira |
| monumento-tres-racas | Goiânia/GO | Monumento às Três Raças | 4,2 × 4,2 × 5,6 | praça circular em 3 discos, base em 3 cilindros + prisma triangular estrelado de 2,0, três figuras de bronze (tons distintos) de costas umas para as outras segurando um mastro com esfera dourada |
| palacio-dos-leoes | São Luís/MA | Palácio dos Leões | 7,6 × 4,8 × 3,8 | palácio colonial longo (6,0) creme com 22 janelas no andar alto, balaustrada de 60 pilaretes, 3 telhados piramidais vermelhos + 2 torrinhas azuis, pórtico de 4 colunas com frontão, jardins com 2 leões dourados em pedestais e 3 palmeiras |
| obelisco-campo-grande | Campo Grande/MS | Obelisco de Campo Grande | 4,2 × 4,2 × 6,8 | praça com avenida, base em 2 discos + caixa, obelisco em 2 metades (clara/sombra via torno de 180°) até 5,6, pirâmide branca e ponta dourada, 6 ipês (copas amarelas e rosa) |
| farol-cabo-branco | João Pessoa/PB | Farol do Cabo Branco | 5 × 4,6 × 6,8 | mar, falésia em 4 camadas (areia/ocre/creme/ocre) com grama no topo, plataforma, torre em 3 prismas triangulares estrelados decrescentes (sy 0,82), lanterna de vidro com domo vermelho, palmeiras |
| igreja-bom-despacho | Cuiabá/MT | Igreja do Bom Despacho | 4,6 × 4,8 × 5,6 | morro verde em torno com pedras e escadaria de 7 degraus, igreja neogótica em pedra bege com contrafortes, telhado marrom, 2 torres com pináculos de 1,7, portal e rosácea, árvores |
| forte-reis-magos | Natal/RN | Forte dos Reis Magos | 5,8 × 6,1 × 2,4 | mar, recife em estrela de 5 pontas com pedras, muralha branca em estrela de 5 pontas (lajes entre vértices + cilindros nos cantos), portão, capela e anexos com telhados vermelhos, mastro com bandeira verde/amarela |
| jangada-pajucara | Maceió/AL | Jangadas de Pajuçara | 6,0 × 5,4 × 2,3 | mar verde-água, praia com 4 palmeiras, banco de areia, 5 jangadas (estágios separados com delays 0,35+0,2i): 5 troncos, mastro inclinado, vela triangular em 3 faixas bicolores |
| usina-do-gasometro | Porto Alegre/RS | Usina do Gasômetro | 7,4 × 5,2 × 8,6 | orla do rio com cais, prédio longo de tijolo (#b4533f) com 12 janelas altas e 2 frontões, anexo, chaminé cilíndrica afunilada até ~8,5 (sy 1,17) com anéis, 2 barcos à vela, árvores |
| canteiro | qualquer | Canteiro de obras | 4,6 × 4 × 5 | **paramétrico em `progresso` (0..1, padrão 0,5)**: chão de terra, tapume laranja/branco de 8 painéis por lado com portão, estrutura de 9 pilares de altura `H = 0,45 + 2,9·p` com `N = floor((H − 0,05)/0,62)` lajes, andaime na frente, guindaste amarelo de 4,0 com lança de 2,8 e gancho cujo cabo encurta com H, placa com barra de progresso verde de largura `0,67·p`, montes de areia/brita, tijolos, contêiner azul, 2 cones |

### 2.4 Monumentos de capitais — lote B (`ObrasCidadesB`, 10)

Formato `def({ id, nome, cidade, uf, tamanho, criar: { lote(K, o), build(K, o) } })`; o wrapper cria o kit, chama `lote` (calçada `tamanho + 0,5`) se `opts.lote ≠ false`, depois `build`, e devolve `K.montar()` com `userData.id/tamanho` e `name 'obra:'+id`. Alvo ≤ 3.000 triângulos, sem textura. Ajudantes: `letras(s, str, vx, hex, x, y, z, chao)` (letreiro em **quadros planos**, 2 triângulos por trecho de pixels contíguos — mais barato que o voxel; `chao=true` deita no plano), `fronton`, `laminas` (polígono com espessura), `aframe` (prisma triangular/empena), `curva` (arco de lajes), `bandeira` (mastro + bandeira bicolor). Paleta local `COR = { pedra #c9c5b8, cimento #e6e2d6, creme #f3ecd8, telha #c8553d, ferrugem #8a4f3a, preto #2c3342, rocha #a39a88, rochaE #85806f }`.

| id | cidade/UF | nome | tamanho | descrição visual |
|---|---|---|---|---|
| tres-caixas-dagua | Porto Velho/RO | Três Caixas d'Água | 6,2 × 3,4 × 7,0 | trilhos com 16 dormentes, 3 torres de ferro enferrujado (4 pernas afuniladas + 3 anéis + contraventamento em X) de 4,3 com tanque cilíndrico cinza-azulado de 1,7 e tampa cônica (delays 0,5/0,9/1,3), árvores e palmeiras |
| palacio-rio-branco | Rio Branco/AC | Palácio Rio Branco | 6,2 × 4,3 × 2,9 | base de pedra com escadaria de 6 degraus, corpo creme central de 2,0 + alas de 1,45, colunata de 6 colunas, frontão, cúpula piramidal verde, 2 bandeiras verde/amarela, palmeiras |
| portal-do-milenio | Boa Vista/RR | Portal do Milênio | 6,2 × 3,4 × 5,3 | pista asfaltada com faixas, 2 pilares brancos, arco parabólico branco de 3,4 de flecha com fitas azul e verde, esfera dourada no topo, letreiro **"BOA VISTA"** em azul (quadros planos), palmeiras |
| arcos-da-orla | Aracaju/SE | Arcos da Orla | 7,5 × 4,4 × 3,0 | mar com espuma, faixa de areia, calçadão com padrão laranja, 5 arcos parabólicos brancos de alturas 1,9/2,5/2,8/2,5/1,9, guia de ônibus escuro, letreiro **"ARACAJU"** azul, 4 palmeiras (lote cor de areia) |
| palacio-araguaia | Palmas/TO | Palácio Araguaia | 6,7 × 4,5 × 3,5 | base com escadaria, palácio branco modernista longo (5,8) com colunata de 12 colunas finas e janelas azuis, rotunda cilíndrica com anel, domo achatado (sy 0,85) e esfera dourada, 2 bandeiras azul/amarela, canteiro com 10 girassóis |
| convento-da-penha | Vila Velha/ES | Convento da Penha | 5,0 × 5,0 × 5,9 | morro em 4 troncos de cone (mata/rocha/rocha escura/grama) com paredões rochosos e 10 árvores, rampa sinuosa (fita) subindo, convento branco com telhado de telha, frontão, torre lateral com pirâmide e cruz |
| marco-zero-equador | Macapá/AP | Marco Zero do Equador | 5,2 × 4,2 × 6,0 | linha do Equador amarela/vermelha no chão com **"NORTE"** (azul) e **"SUL"** (vermelho) deitados, base de pedra, obelisco: tronco quadrado branco + 2 lâminas verticais até 5,3 com pirâmide, esfera amarela (o "sol") em y 4,3, árvores e palmeiras |
| jato-sjc | São José dos Campos/SP | Jato do CTA | 4,8 × 3,6 × 4,2 | pedestal cinza com placa azul **"SJC"** em amarelo, coluna afunilada de 2,4, jato (torno da fuselagem, canopi de vidro, asas em `laminas`, cauda com detalhes vermelhos) inclinado 0,3 rad em basis matrix, escala 0,78 |
| catedral-joinville | Joinville/SC | Catedral de Joinville | 5,2 × 5,7 × 6,0 | adro com degraus, nave em A-frame cinza-escuro de 3,7 × 4,6 com empena branca e vitral triangular (2 tons de azul) e 5 montantes, cruz no cume, torre quadrada separada de 4,5 com pirâmide e cruz, árvores + palmeira |
| locomotiva-sorocabana | Sorocaba/SP | Locomotiva Sorocabana | 6,2 × 3,5 × 2,4 | trilhos com 17 dormentes, locomotiva a vapor preta (caldeira cilíndrica de 2,5 com 3 anéis dourados, chaminé, 2 domos, farol, cabine verde-escura, limpa-trilhos, 3 pares de rodas vermelhas de r 0,42 com bielas douradas), tender com carvão, placa azul **"SOROCABANA"**, árvores |

### 2.5 Infraestrutura — `ObrasT3` (11 modelos de upgrade da cidade)

Mesmo kit; `criar(id, T, {A, mat, lote})` acrescenta lote calçada+grama (borda 0,1) e devolve grupo `'obra-t3:'+id` com `userData.{id, tamanho}`. Tamanhos sem a escala de exibição (cidade-nivel aplica 0,62). Sem texto, sem emoji. Ajudantes: `cruz(s, x, y, z, k, hex)` (cruz vermelha de hospital), `janelas(s, x0, x1, y, z, n, hex)` (fileira de n janelas de 0,28 de altura).

| id | nome | tamanho | descrição visual |
|---|---|---|---|
| caixa-dagua | caixa d'água | 2,0 × 2,0 × 3,7 | 4 pernas cinza inclinadas com cruzeta, tanque azul-claro (#6ec6ff) de 1,0 com anel branco, tampa cônica azul, ventilação, escada lateral |
| poste | poste de luz | 3,4 × 1,2 × 2,3 | calçada, 2 postes grafite de 2,0 com braço e luminária retangular amarela voltada ao centro + 1 poste central com globo amarelo |
| posto-saude | posto de saúde | 2,6 × 2,2 × 1,3 | casa branca de 0,85 com telhado azul de duas águas, porta de vidro, marquise azul, 2+2 janelas, cruz vermelha nos fundos, árvore |
| esgoto | rede de esgoto | 3,6 × 2,6 × 1,5 | terreno de terra, tubulação cinza em L (3 trechos, r 0,17), 3 poços de visita com tampa grafite, casa de bombas gelo com teto azul e chaminé |
| estacao-tratamento | estação de tratamento | 4,4 × 3,4 × 2,4 | 2 tanques circulares gelo (r 0,85) com água e braço raspador, tanque retangular azul, prédio branco com teto azul e 3 janelas, chaminé, tubulações |
| upa | UPA 24h | 3,5 × 3,1 × 2,1 | prédio branco de 1,35 com platibanda azul, faixa azul, 3+5 janelas, entrada de vidro, totem no telhado com 2 cruzes vermelhas (frente e verso), ambulância branca com faixa vermelha, árvore |
| usina-solar | usina solar | 4,6 × 3,8 × 0,8 | gramado com grade 3×4 de painéis inclinados (laje vidroE + laje azul-escuro #2b4b7a + suportes), casinha branca com teto amarelo (inversor) |
| reservatorio | reservatório | 2,8 × 2,8 × 4,1 | torre de torno branca em taça (fuste 0,5 → bojo r 1,15 em y 2,9–3,35), anéis azul-claro e azul, antena, escada, casa de bombas cinza com tubo |
| hospital-universitario | hospital universitário | 4,8 × 3,6 × 3,1 | 2 alas brancas de 1,5 com platibanda azul e 3×5 janelas cada, torre central de 2,9 com cruz vermelha e heliponto (disco cinza + círculo amarelo + H branco), entrada de vidro com marquise, ambulância, 2 árvores |
| dessalinizadora | dessalinizadora | 4,8 × 3,8 × 1,8 | metade frente é mar azul-claro com faixa de areia, prédio branco com teto azul e 6 janelas, 4 cilindros verticais de 1,6 (membranas) com anéis azuis, tubulação alta e tubo descendo ao mar, tanque cinza com tampa azul, caixa amarela |
| centro-pesquisa | centro de pesquisa médica | 4,4 × 3,6 × 2,5 | bloco branco com teto azul e 2×5 janelas, laboratório cilíndrico (#e9eef2) com domo de vidro azul-claro e antena, 4 pilaretes, cruz verde-água (#2fa8a0), chaminé, árvore |

### 2.6 Hospital do patrocinador de saúde (`shared/figo.js`)

Módulo próprio no mesmo estilo (kit mínimo embutido: `bx, cyl, esfera, anel, capsula`). Lote ~4,6 × 3,4 km, ~4,5 de altura com o letreiro (`userData.tamanho = [4.9, 3.7, ~5.2]`). Paleta da marca: `deep #1c3a19, deep2 #304e2d, deep3 #415e3e, sage #849e7f, nevoa #e2e8df, mint #cedcc3, lime #afe88e, branco, gelo, cinza, grafite, mata, mataE, tronco, calcada`. Seis estágios com delays: `lote` (0; calçada + piso mint + caminho lime + 4 árvores), `podio` (0,15; cápsula branca 4,0 × 2,0 × 1,0 em `capsula` = caixa + 2 meias-cilindros, faixa de vidro verde contínua, beiral, marquise com 2 pilares lime, porta de vidro, heliponto com anel lime e **H** branco), `torre` (0,45; torre elíptica RX 1,15 × RZ 0,72 de y 1,14 a 3,5 em camadas de 0,39 alternando vidro `deep3`/`#5d7a59` e lajes brancas, aleta lime na frente), `coroa` (0,8; 6 pilaretes + anel lime flutuando), `letreiro` (1,0; caixa deep green 3,1 × 1,75 × 0,36 em y 3,5+0,5 com tampa lime e 2 pés), `ambulancia` (1,2; na porta, branca com faixa lime e sirene).

**Letreiro-logo**: textura canvas 1024 × 560 — fundo deep green, logo branca horizontal (data-URI PNG embutido) com 700 px de largura centralizada a y 46, texto **"HOSPITAL"** em `700 128px Helvetica Neue` lime, letter-spacing 14 px, na base (y = TH − 52). Aplicada em 2 `PlaneGeometry` (frente +z e fundo −z, `rotation.y = π` no fundo) com `MeshBasicMaterial({ map, toneMapped: false })` (cor exata da marca, sem ACES), `SRGBColorSpace`, anisotropy 4. `Figo.pronto` é uma Promise que resolve quando a imagem da logo desenhou (o render dos vídeos espera por ela). Mesma `mola`/`animar` de obras.js; `duracao = 2,4 s`.

---

## 3. Lojas (`lojas.js`) — tipos, fachada, ícones, letreiro, especiais

Ideia: um negócio local ganha um prédio do **seu tipo**, com o **nome no letreiro** e a **cor da marca** no toldo/letreiro/detalhe do ícone. 12 tipos × nome × cor = dezenas de lojas sem modelar uma a uma.

### 3.1 Dimensões

- Lote `LOTE = 2,2` × 2,2. Corpo 1,9 × 1,6 × 1,25; teto até `ROOF = 1,31` (o ícone nasce em ROOF). Com o ícone a loja tem 2,1 a 2,5 de altura.
- Letreiro: plano `SW = 1,68` × `SH = 0,42`, centro em `SY = 0,99`, face em `SZ = 0,835` (frente) e `−SZ` (fundo, girado π). Canvas `TW = 512 × TH = 128` (4:1).
- Paleta local `C = { branco #f3f4f6, gelo #e6e9ee, cinzaC #c9ced6, cinza #97a0ae, grafite #2c3342, vidro #9fc4dc, calcada #dfdedc, madeira #8a6a45, ouro #e8b84b }`. Cor da marca padrão `#d9453a`.

### 3.2 Tipos e cor de parede

| id | nome exibido | parede |
|---|---|---|
| lanchonete | Lanchonete / restaurante | #f6e3c3 |
| acai | Açaí / sorveteria | #efe4f7 |
| mercado | Mercado / padaria | #e3efe0 |
| roupa | Loja de roupa | #f4e6e6 |
| beleza | Salão / barbearia / estética | #f6e8ef |
| academia | Academia / esporte | #dfe3ea |
| tech | Celular / informática / TI | #e4e9f0 |
| flores | Flores / presentes | #f3ecdf |
| pet | Pet shop / veterinário | #efe7d8 |
| oficina | Oficina / auto / moto | #d9dde2 |
| servico | Serviço / escritório / escola | #e9e6df |
| criador | Página / criador de conteúdo | #efeaf6 |

Tipo desconhecido cai em `servico`. Nome vazio vira o nome do tipo; nome é `trim().slice(0, 40)`.

### 3.3 Fachada padrão `fachada(s, cm, parede)`

`s` = estágio de cores fixas, `cm` = estágio que recebe a cor da marca (geometria sem atributo `color`; a cor vem do material da loja). Composição (y = 0 é o chão do lote):

1. Calçada `bx(±1.1, 0..0.04)` em `calcada`.
2. Corpo `bx(−0.95..0.95, 0.04..1.25, −0.8..0.8)` na cor da parede, com AO.
3. Laje/teto `bx(±1.0, 1.25..ROOF, ±0.85)` cinza-azulado `#7a8494`.
4. Vitrine à esquerda (moldura branca 0,14..0,6, vidro, montante central) e porta à direita (madeira `#6b4a2f`, vidro, maçaneta dourada), ambas na face z = 0,8.
5. Janelas laterais (vidro) nas faces x = ±0,95, y 0,5..0,9.
6. Moldura do letreiro grafite `bx(±SW/2+0.05, SY±SH/2+0.04, 0.8..SZ−0.015)`.
7. **Toldo listrado** de 7 faixas (`w = SW/7`): faixa par vai para `cm` (cor da marca, `'#fff'` como placeholder), ímpar para `s` em `#f3f4f6`; cada faixa é uma `laje` inclinada de (x, 0,78, 0,82) a (x, 0,6, 1,28) com 0,035 de espessura + uma aba `bx` vertical 0,52..0,62 em z 1,26..1,3.

### 3.4 Os 12 ícones (y = 0 é o telhado; `s` fixo, `m` cor da marca)

| tipo | ícone | descrição geométrica |
|---|---|---|
| lanchonete | hambúrguer sobre bandeja | bandeja = disco r 0,78 na cor da marca; pão de baixo (cyl r 0,58 laranja #e8a33d), carne (cyl marrom), queijo (box 1,12² amarelo girado 45°), alface (cyl verde), tomate (cyl vermelho), pão de cima (domo r 0,6 sy 0,78) com 7 gergelins (caixinhas creme sobre a calota) |
| acai | copo de açaí | copo cônico branco (cyl 0,28→0,42, h 0,62, escalado 1,3 em x/z), borda gelo, bola roxa #5b2a86 (domo) com 2 esferas roxas transbordando, 3 rodelas de banana amarelas inclinadas, morango vermelho, 4 cubos de granola, colher marrom; **marca**: faixa no copo (cyl 0,335→0,375 em y 0,2) e canudo (tubo inclinado) |
| mercado | cesta de compras | cesta = tronco de pirâmide invertido na cor da marca (cyl 4 lados girado 45°, sz 0,7); alças em tubos grafite (2 laterais + 1 superior); dentro: baguete (tubo marrom-claro inclinado), alface (esfera verde), caixa de leite branca com tampa azul, maçã vermelha |
| roupa | camiseta no cabide | camiseta = prisma de 15 vértices (silhueta com mangas e gola em V) extrudado 0,13, deitado via rx π/2, **na cor da marca**; cabide em tubos grafite (gancho de 3 segmentos + 2 ombros) |
| beleza | tesoura aberta | 2 lâminas (tubos de r 0,1→0,02, de (0, 0,62) a (±0,3, 1,17)) gelo/cinza-claro, 2 hastes cruzadas (tubos r 0,06), parafuso dourado (cyl deitado), **argolas na cor da marca** (torno em anel r 0,1..0,26 deitado) nas pontas |
| academia | haltere em suportes | 2 suportes grafite (bx 0,1 × 0,64), barra (cyl deitado em x, r 0,05, comprimento 2,0), por lado: anilha grande grafite r 0,47 (esp 0,16), **anilha da marca** r 0,38 (esp 0,1), anilha pequena grafite r 0,27 |
| tech | notebook + celular | notebook: base cinza 1,14 × 0,7, teclado, tela inclinada (rx −0,2) grafite com tela azul-clara #8fd3ff e 2 "linhas de texto"; celular em pé à direita (ry −0,35) grafite com tela #8fd3ff e notch; **marca**: retângulo na metade inferior da tela do celular; tudo escalado 1,2 |
| flores | buquê | cone de papel **na cor da marca** (cyl 0,05→0,46, h 0,7; sx/sz 1,2, sy 0,88), borda branca, 8 flores (esferas r 0,17–0,2 em rosa, amarelo, branco, vermelho, lilás, laranja) em hastes (tubos verdes) e 5 folhas (cones verdes inclinados) |
| pet | pata + osso | pata grande em pé (5 esferas achatadas em sz 0,1, marrom #7a4b32: almofada 0,34 × 0,28 e 4 dedos 0,14 × 0,19; escala 0,82) sobre pino grafite; **osso na cor da marca** deitado na frente (cyl deitado r 0,07 comprimento 1,0 + 4 esferas r 0,13) |
| oficina | pneu + chave inglesa | pneu = torno em anel grafite (r 0,3..0,5, esp 0,34) deitado em rx π/2, roda interna cinza-clara, **calota da marca** (disco r 0,17); chave inglesa cinza inclinada (bx + torno aberto de 1,5 rad na cabeça + anel na base) |
| servico | maleta de couro | caixa marrom #8a5a3c 1,1 × 0,72 × 0,32 (escala 1,25), faixa grafite no meio, alça em 3 tubos, 2 fechos dourados, 2 pés; **etiqueta da marca** (bx 0,26 × 0,16 na frente) |
| criador | ring light em tripé | anel branco-amarelado (torno r 0,3..0,4 deitado) em y 0,72, celular grafite no centro com luz vermelha de gravação (esfera #ff3b30), **aro externo da marca** (torno r 0,4..0,45), tripé de 3 tubos grafite |

### 3.5 Cache de geometria e `criar`

```
cacheDe(T, A, mat): WeakMap por T; invalida se A ou mat mudam. Guarda { mat, tipos: {}, plano: PlaneGeometry(SW, SH) }
geometriasDoTipo(T, c, tipo, esp):
  chave = esp ? 'esp:'+esp : tipo
  K = Obras.kit(T, {A, mat}); 4 estágios: corpo, corpo-marca, icone, icone-marca
  ctx = { C, PI, ROOF, LOTE, SW, SH, SY, SZ, fachadaPadrao: fachada }
  (def.fachada || fachada(parede))(corpo, corpoM, ctx); (def.icone || ICONES[tipo])(ico, icoM, ctx)
  montar → pega as 4 geometrias; nas '-marca' deleteAttribute('color')
  altura = ROOF + max.y da bbox do ícone; anima = def.anima; tris = soma
Lojas.criar(T, { tipo, nome, cor, especial?, logo?, A?, mat? }) → Group:
  matMarca = MeshStandardMaterial({ color: A(cor), roughness 0.9, flatShading })
  estagio 'corpo' (delay 0): mesh(corpo, mat) + mesh(corpo-marca, matMarca) + 2 planos de letreiro (z ±SZ)
  estagio 'icone' (delay 0.35): Group em y = ROOF com mesh(icone) + mesh(icone-marca)
  anima: 'giro'   → si.rotation.y = 1.2t ; si.y = ROOF + 0.12 + 0.08·sin(2t)
         'flutua' → si.y = ROOF + 0.1 + 0.1·sin(1.6t)
         'pulo'   → si.y = ROOF + 0.12·|sin(2.4t)|
  userData = { anima, logoPronto, loja: {tipo, nome, cor, especial, logo}, tamanho: [2.2, 2.2, altura], estagios, tris: tris+4, _lojaMats, _lojaTex }
Lojas.liberar(g): dispose da textura (marca userData.liberada = true para cancelar redesenhos tardios) e dos 2 materiais da loja; remove do pai. A geometria é do cache e fica.
```
Memória por loja: 1 textura (canvas ≤ 512 × 128), 1 material de letreiro, 1 material da cor da marca. No Node (sem `document`) o letreiro vira placa lisa na cor.

### 3.6 Letreiro em canvas `desenhaLetreiro(canvas, nome, cor, logo)`

1. `claro = luminancia(cor) > 0.34` (luminância relativa sRGB linearizada: `0.2126R + 0.7152G + 0.0722B`); tinta = `#1e2430` se claro, senão `#ffffff`.
2. Fundo = cor da marca (512 × 128).
3. **Logo** (opcional): quadrado branco à esquerda `(10, 10, L = TH − 20)` com a imagem em `(14, 14, L − 8)`; `x0 = L + 14`.
4. Borda: `strokeRect(8, 8, TW−16, TH−16)` com largura 4, `rgba(30,36,48,.28)` se claro ou `rgba(255,255,255,.4)`.
5. Texto centrado: fonte `900 <px>px "Nunito", Helvetica Neue, Helvetica, Arial`; começa em 84 px e **decresce de 2 em 2 até caber** em `maxW = TW − 56 − x0` (mínimo 30 px); se ainda não couber, **encolhe horizontalmente** (`scale(maxW/width, 1)`) em vez de cortar. Baseline `middle`, y = TH/2 + 3.
6. Se a Nunito ainda não carregou (`document.fonts.check('900 40px Nunito')` falso) agenda `fonts.load(...)` e redesenha; a logo (URL ou imagem já carregada, `crossOrigin = 'anonymous'`) também redesenha ao chegar (falhou → fica só o nome). `Lojas.criar` devolve `userData.logoPronto` (Promise).
7. Textura: `CanvasTexture`, `SRGBColorSpace`, anisotropy 4; material `MeshBasicMaterial({ map, toneMapped: false })`.

`normalizaHex(h)`: aceita `#abc`/`abc`/`aabbcc`; inválido → cor padrão.

### 3.7 Padrão de "loja especial" (97 arquivos `lojas-especiais/*.js`)

Cada arquivo é uma IIFE que registra em `globalThis.LojasEspeciais[<slug>] = def` (o `lojas.js` lê esse objeto global na carga e chama `registrarEspecial(id, def)`; `def.icone` é obrigatório). Formato:

```
def = {
  tipo?,                       // raramente usado
  parede?: hex,                // cor do corpo quando se usa a fachada padrão
  fachada?(s, m, ctx),         // substitui o corpo INTEIRO (y = 0 = chão do lote); recebe ctx.{ROOF, SW, SY, SH, SZ, LOTE, fachadaPadrao}
  icone(s, m, ctx),            // no telhado (y = 0 = ROOF)
  anima?: 'giro' | 'flutua' | 'pulo',
  topo?: altura extra
}
```
Levantamento dos 97: 96 definem `fachada` própria (11 delas apenas chamam `ctx.fachadaPadrao(s, m, corDaParede)` e acrescentam detalhes), 90 definem `icone`; animação: 23 `flutua`, 12 `giro`, 3 `pulo`, o resto estático. Cada arquivo começa com um comentário descrevendo o briefing do cliente (referências, cores da logo, pedido) e define sua própria paleta como constantes.

Padrões recorrentes observados nas 4 lidas por inteiro:

- **Loja especial "delivery de açaí"** (`anima: 'giro'`): fachada própria — calçada, corpo em vinho com faixa dourada e platibanda, janela de retirada com balcão dourado e copos/garrafas em miniatura, toldo listrado vinho/dourado em 6 faixas, porta lateral, moto de entrega com baú (cilindros deitados como rodas), luminárias laterais, vaso. Ícone: garrafa roxa com rótulo creme + copo com domo de açaí e 4 morangos (esfera + cone verde), folhas atrás (cones). Em `m` (cor da marca): anel no rótulo e faixa do copo.
- **Loja especial "espetaria e choperia"** (sem anima): fachada cinza-escura com terraço de concreto, varanda coberta (3 pilares brancos, vigamento de madeira, telha metálica, luminárias penduradas), mesas e cadeiras com canecas, portas de vidro quadriculadas com salão aceso (bloco "LUZ" atrás do vidro), número da casa em voxels, tenda preta. Ícone: churrasqueira preta com brasa, 2 espetos com 4 pedaços de carne cada, 5 chamas em cones (laranja/amarelo/brasa), caneca de chopp gigante (cyl âmbar, espuma em 4 esferas, alça em 3 caixas). `m`: só uma base fina branca.
- **Loja especial "informática e celulares"** (`anima: 'flutua'`): fachada preta com laje preta, fio azul, moldura de letreiro quase preta, toldo em `laje`, neon magenta nas quinas e no rodapé, vitrine com 5 celulares alternando magenta/azul, porta com neon, tubo diagonal de neon. Ícone: smartphone gigante em pé (moldura cinza, frente preta, tela roxa, notch, botão play = 2 tornos + prisma triangular, painel inferior com 4 "apps" coloridos) + controle de videogame (corpo + 2 esferas achatadas como empunhaduras, d-pad em caixas, 2 analógicos, 4 botões coloridos).
- **Loja especial "pet shop"** (sem anima): usa `ctx.fachadaPadrao(s, m, '#58cfdc')` e acrescenta 4 patinhas brancas na parede lateral (função `pata` = almofada + 4 dedos em placas finas, posicionadas via `com` com `ry = ±π/2`) e 2 pegadas escuras na calçada (`com` com `rx = −π/2`). Ícone: cachorro caramelo sentado (esferas achatadas para corpo/cabeça/focinho/orelhas, caixas para patas, tubo para rabo, coleira em cyl), gato cinza (corpo, orelhas em cones de 4 lados com interior rosa em cone de 3, bigodes em caixas finas, olhos verdes), osso creme gigante deitado, tigela com ração (cubinhos marrons).

Regras de ouro do padrão: tudo via as primitivas do kit; `s.com(xf, fn)` para desenhar peças na origem e posicionar; esferas com baixa segmentação (5–8 × 3–5); cores da marca como constantes locais; o que deve mudar com a cor configurada vai para `m`; a moldura do letreiro é redesenhada pela fachada própria usando `SW/SH/SY/SZ` do ctx, frente e fundo (`z0/z1` espelhados).

---

## 4. Obras com meta no mapa (`obras-mapa.js`)

### 4.1 Dados e estado

- `D.O = [[ibge, id, nome, base, alvo], …]` (30 cidades têm uma obra, `data/obras-metas.json`). Mapa `OB: ibge → {ib, id, nome, base, alvo}`.
- `obraEstado(c)` (c = cidade com `n` moradores):
  ```
  p = clamp((c.n − base) / max(1, alvo − base), 0, 1); pronto = c.n >= alvo
  passo = min(19, floor(p·20))                     // OB_META = 20 faixas de 5%
  pct = pronto ? 100 : min(99, floor(p·100)); faltam = max(0, alvo − c.n)
  chave = pronto ? 'm' : 'c'+passo                 // muda → recria o objeto 3D
  ```
- Rótulo da cidade de perto: `"<nome> pronta"` ou `"em obra <pct>%"`.

### 4.2 Modelos

- `obraDef(id)`: procura em `Obras` (com `criar`), depois em `ObrasCidadesA` e `ObrasCidadesB`. Tamanho padrão de reserva `[4.5, 4.5, 4]`.
- Material único `obraMat()` (standard, vertexColors, flatShading) para todas as obras/lojas/canteiros.
- **Canteiro**: um molde por faixa (`OB_TPL: passo → Group`) criado com `progresso = (passo + 0,5)/20`; `userData = {}` antes do `clone()` (o clone faz `JSON.stringify` do userData). Sem o modelo: `obraReserva(true, …)` = caixas simples (tapume, prédio subindo `h = 0,4 + 2,6p`, guindaste).
- **Monumento**: criado por cidade quando ela entra (`Obras.criar` ou `def.criar`), geometria descartada quando sai. Reserva: pódio + pilar + topo amarelo.

### 4.3 Posição (`obraPos`) — "a obra tem de ficar NA cidade"

- Raio da obra `r = min(8, hypot(max(larg, 4.6), max(prof, 4)) / 2 + 0.4)` (considera o canteiro também).
- Ordem de ângulos `OB_ANG`: 24 ângulos de 15° ordenados pela proximidade de **225° (sudoeste)**, 45° (nordeste, lugar do hospital do patrocinador) por último.
- Se a cidade tem hospital do patrocinador, reserva a posição dele primeiro (`figoPos`); coleta hospitais de cidades vizinhas.
- Critérios: `terraCt` (centro + 8 pontos a 0,85r em terra, 0..9), `colideHosp` (hospitais a `r + 3,2 + 0,6`, outras obras a `r + q.r + 0,6`), `colideCid` (outras cidades a `rs + r + 0,6`), `desnivel` (amplitude do relevo em 5 pontos).
- Passes: (1) `min 7/9` em terra, sem encostar em cidade, raios `rs + [3.5, 4.5, 5.5, 6, 2.5, 2]`; (2) `min 1`, aceita encostar em cidade, raios `rs + [2..6]`. Score `= índiceDoÂngulo·0,12 + desnivel·0,5 + índiceDoRaio·0,05`, menor vence; (3) fallback: `rs + 3` no ângulo com mais terra.
- `yaw` = fachada para o centro. Cache em `OB_POS`.

### 4.4 Sincronização, toque, voo

- `obraSync()` roda a cada refresh: para cada cidade em `ATIVAS` com geometria e obra: se a chave mudou, remove e recria; posição `(x, relY + 0,02, −y)`, `userData.{chave, compartilhada: !pronto, ibge}`, `name 'obra-cidade:'+id`. Cidades que saíram de ATIVAS perdem a obra (dispose só se não compartilhada).
- `obraToque(cx, cy)`: raycast nos grupos; fallback por proximidade em tela (< 34 px) do ponto projetado a alturas 1,5 e 4 km. Abre o cartão da cidade.
- `obraVoar(c)`: garante a cidade, abre o cartão sem voar e voa para a obra a `dist 42`.

### 4.5 UI (cartão da cidade, aba Dados)

- `obraLinha(c)`: ícone `ok`/`obra`; pronta → **"<nome> inaugurado"** + "a cidade passou de N moradores"; em obra → **"Obra: <nome>"**, "N de M moradores · **faltam K**", barra animada (`width = max(3, pct)%` em 2 rAF). Botões: "chamar amigos de <cidade>" (copia `textoChamada`) e "ver a obra"/"ver o monumento".
- `textoChamada`: `Bora destravar o <obra> no @<perfil>! Comenta <cidade> no último post e marca 3 amigos: <url>/?c=<ibge>`.
- `blocoObras()` ("obras do Brasil" / "quem está construindo o quê"): número grande "X de N obras inauguradas", lista ordenada por pronta > progresso > ibge com posição, nome, UF, "pronta"/"pct%", barra fina e linha "em obra · nome · faltam N moradores". Legenda: "cada cidade destrava uma obra famosa quando bate a meta de moradores. comenta o nome da cidade e marca amigos pra acelerar". `imgObras()` gera a imagem compartilhável (top 9, barras arredondadas amarelas).

---

## 5. Lojas no mapa (`lojas-mapa.js`, `lojas-visiveis.js`)

### 5.1 Dados `D.L` e `D.LC`

`D.L = [[id, @dono, nome, tipo, ibge, cor, desde, ate, tipo_outro?, extras?], …]` com `extras = { d: descrição, w: whatsapp, i: instagram (se diferente do @), s: true = sem Instagram, e: slug da especial, l: slug da logo }`. Carregado em `LJ = [{ id, h, nome, tipo, ibge, cor, desde, ate, tn, desc, wa, semIg, ig, especial, logo }]` (só os não vencidos no build).

`D.LC = { p: pontos por marcar o @ (30), s: pontos por seguir (100), t: {tipo → nome} }`. Após um timestamp fixo de reset (`1792368000e3`) passa a `p: 10, s: 30` (pontuação v4).

- Vigência: `hojeBRT()` = data ISO de `Date.now() − 3 h`; `lojasDe(ibge)` filtra `desde <= hoje <= ate` **no navegador**. `lojasTodas(ibge)` = lista completa (define o índice do slot). `lojaFim(l)` = "dd/mm" de `ate`.

### 5.2 Modelo e escala

- `lojaCriar(l)` → `Lojas.criar(THREE, { tipo, nome, cor, especial, logo: 'lojas-logos/<slug>.png', A: mundo.figoA, mat: obraMat() })`; sem `lojas.js` cai em `lojaReserva` (caixa com faixa da cor).
- **Lojas grandes** (pedido do dono): escala entre `LJ_ESC_MIN 1,35` e `LJ_ESC_MAX 2,0`, altura final `≤ LJ_ALT_MAX 5,4` (`esc = max(1.2, min(p.s, 5.4/alt))`), lojas sem slot usam `LJ_ESC_RES 1,6`.
- `lojaAnima()` a cada quadro: chama `userData.anima(performance.now()/1000)` de cada loja em cena (especiais giram/flutuam/pulam).

### 5.3 Posição (`lojasPos`)

1. **Slot reservado no urbanismo**: a cidade reserva meio quarteirão por loja (`cid.lojas[i] = {x, y, angV, comp, larg}`; `i` = posição na lista completa, então o lugar não muda quando outra loja entra/sai). `lojaSlotPos(q, terra)`:
   - yaw = o ângulo da grade (`angV + k·90°`) mais perto de 0, limitado a `±30°` (fachada para o sul, de onde a câmera olha); `beta` = quanto ficou torta; fator `f = cos β + sin β`.
   - `disp = min(larg + 0,5 + 0,3, comp + 0,1) / f`; `escala = clamp(disp / 2,2, 1,35, 2,0)`.
   - Costa: encolhe de 0,05 em 0,05 (até 1,2) enquanto algum dos 8 pontos do lote (cantos e meios de lado, meia-largura `1,1·esc`) cair no mar.
2. **Sem slot** (mais de 4 lojas ou sem espaço): busca livre em anéis a partir da praça (`R = pr.r + 1,9`, passo 0,9, até `rs + 3`, n = `ceil(2πR)` pontos, offset angular por hash da cidade), respeitando obstáculos (casas r 0,8; marcos 1,2/2,0; vagas 1,3/1,8; igreja 1,5; hospital do patrocinador; slots de lojas 2,6; praça `r + 0,5`), terra, cidades vizinhas, hospitais/obras externas e **distância de ruas/avenidas** (`hw + RL·0,55`). Fallback: anel fora do raio da cidade; último recurso: ponto fixo em `rs + RL + 1`. yaw 0, escala 1,6, `RL = 2,3`.

### 5.4 Sincronização, toque

- `lojaSync()`: por cidade ativa, lojas vigentes; se todas já existem só marca; senão calcula posições de todas e cria as que faltam: `position (x, relY + 0,02, −y)`, `rotation.y = yaw`, `scale = esc`, `userData.{esc, alt, loja:{…, id, ibge}, pos}`, `name 'loja:'+id`. Remove as que saíram (`Lojas.liberar`).
- `lojaToque`: raycast + fallback por projeção (alturas `1·esc` e `2·esc`, < 34 px). Abre `cartaoLoja(l, {voar:false})`.
- Rótulos 3D de perto (`rotulosObjetos`, só com distância da câmera < 160): obra → `"<nome> pronta"` ou `"<nome> · em obra N%"` (classe `cO`); loja → `"<nome> · @<dono>"` (ou só nome se sem Instagram; classe `cL`), projetados a `alt + 0,5` km; opacidade cai entre D 90 e 160; reserva de espaço para não sobrepor.

### 5.5 Cartão da loja (`cartaoLoja`)

Ordem dos blocos:
1. Cabeçalho com o nome; linha "onde": `<tipo> · <cidade (botão → cartão da cidade)> · <UF>`.
2. Selo `patrocinado` com a cor da marca e "no mapa até dd/mm".
3. Descrição (se houver).
4. **Bloco seguir** (`segBloco`, omitido se `semIg`):
   - Dono da loja (`eu === l.h`): só "ver @ig no Instagram" (dono não ganha pontos pela própria loja).
   - Sem @ identificado: input "seu @ (1 vez) pra ganhar +S" + link; com @: "você: @x · [não sou eu]".
   - Link `https://www.instagram.com/<ig>/` (`rel="noopener nofollow sponsored"`), rótulo "seguir @ig / no Instagram · +S pts" ou "seguindo ✓ +S".
   - No clique: resolve o @ (`Hash.norm` → `POR_HANDLE`); se não achou: toast "não achei @h no mapa: só quem tem casa ganha os +S" ou "abri o Instagram. pra ganhar os +S, digita seu @ e toca de novo"; se já feito ou é o dono, nada; senão `POST /api/seguir {u, loja: id}` (`keepalive`), espera `{ok: true}`; sucesso → marca em `localStorage['nem_seg'][u|id] = 1` (+ Set em memória) e toast "+S pts a caminho: entram na próxima atualização do mapa"; falha → "abri o Instagram, mas não consegui registrar os +S agora: toca de novo". O servidor é quem valida (morador, loja vigente, tetos por dia e por IP).
5. WhatsApp: `https://wa.me/<num>?text=Oi! Vi vocês no @<perfil>` — "WhatsApp / chamar <nome>".
6. "marca **@dono** num comentário do @<perfil>: +P pts (1 vez)" + botão "copiar @" (toast "@x copiado: cola no comentário").
7. Botão "＋ seu negócio nesta cidade" (abre o módulo de cadastro de negócio com a cidade).
Seleção `sel = {tipo:'loja', l, c}`; voa para a loja a `dist 30` (ou para a cidade; no modo 2D leve, centraliza a cidade).

### 5.6 Cartão da cidade

`lojasLinha(c)`: rótulo "negócio no mapa" / "N negócios no mapa"; uma linha por loja com bolinha na cor, nome e `@dono` (ou o tipo se sem Instagram). `cartaoCidadeExtras` acrescenta: botão de missões, painel de nível (`cvLinha`), linha da obra, lojas e "＋ coloque seu negócio aqui" (se o módulo de negócios está ativo). Botões de rodapé/topo "＋ seu negócio no mapa".

### 5.7 Lojas sempre visíveis (`lojas-visiveis.js`) — raio-X

Objetivo: nenhuma construção tapa uma loja patrocinada no ângulo da câmera (que olha do sul, inclinada 35°–69°).

- **Camada 1 (urbanismo, no gerador de cidade)**: uma loja não cai na faixa de visão de outra (|dx| < 4,4 e |dy| < 6) e o corredor ao sul de cada loja (7,6 × 7 km) não recebe hospital/cassino/prédio.
- **Camada 2 (tempo de execução)**, parâmetros `LV = { FMIN 0,04, ALFA 0,22, RAIO 22, INF 0,25, HOLD 700 ms, ALT_MAX 1500 }`:
  - Para cada loja **em tela** (projeção dentro da tela com margem 60 px), gera 9×6 pontos na fachada (+z, de borda a borda, frações de altura 0,04..0,96) + 15 no telhado.
  - Candidatos: instâncias das malhas da cidade cujo nome casa `casas\d?|mansoes|torres|palacios|alvoradas|alto\d+|igreja\d|hospital|cassino|cassinoLuz|predio\d+` a até 22 km da loja (lidas da `instanceMatrix`: posição, rotação, escala, bbox local inflada em 0,25), pré-filtradas para quem está entre a câmera e a loja dentro de um leque da largura da loja.
  - Teste segmento câmera→ponto contra a caixa local (slab test `lvSegCaixa`), ignorando se o ponto final está **dentro** da caixa (é a própria construção). Pré-filtro por distância horizontal ao segmento e "passa por cima".
  - Quem bloqueia: instância → **achatada** (escala Y da matriz × 0,04, suavizado `k = 1 − exp(−14·dt)`), volta ao normal 0,7 s depois de parar de bloquear; grupos soltos (hospital do patrocinador, obras) → **fantasma** (materiais clonados com `transparent, depthWrite false, opacity → 0,22`). Outra loja nunca vira fantasma.
  - Custo: só com loja em tela e câmera abaixo de 1.500 km; recalcula no máx. a cada 130 ms (mobile) / 90 ms (desktop) e só se a câmera andou > 0,2 % da distância, a tela mudou ou o layout foi refeito; parado, reconfere a cada 500 ms (lojas que giram).
  - `lvRefresh()` após cada `refrescar()` (o mundo reescreve todas as matrizes): refaz candidatos e reaplica o achatamento por chave `nome:x,z` para não piscar.
  - Depuração: `window.__site.lv = { ativo, stats(), forcar() }`.

---

## 6. Nível da cidade (`cidade-nivel.js`) e painel (`cidade-painel.js`)

### 6.1 Dados `D.CV` (v3)

```
CV = { v: 3,
       a: ['água', 'infraestrutura', 'saúde'],          // áreas 0..2 ; área 3 = "cidade" (pede pontos nas 3)
       o: [[id, nome, área, custoBase, nível] × 25],
       f: [0.5, 4],                                     // limites do fator de custo
       c: [[ibge, [pa, pi, ps], máscara25bits, [ka, ki, ks], [ga, gi, gs], prefeito], …] }
```
`pts` = pontos da semana por área; `mask` = bit k ligado = upgrade k pronto; `kc[a]` = índice do upgrade em obra na área a (−1 = nenhum); `gc[a]` = pontos já gastos nela.

Catálogo dos 25 upgrades (id, nome, área, custo-base, nível) — ordem fixa (a trilha do painel e os ícones seguem este índice):

| # | id | nome | área | custo | nível |
|---|---|---|---|---|---|
| 1 | caixa-dagua | caixa d'água | água | 15 | 1 |
| 2 | poste | poste de luz | infra | 15 | 1 |
| 3 | posto-saude | posto de saúde | saúde | 15 | 1 |
| 4 | praca | praça | cidade | 20 | 1 |
| 5 | esgoto | rede de esgoto | água | 30 | 1 |
| 6 | escola | escola | infra | 50 | 2 |
| 7 | estacao-tratamento | estação de tratamento | água | 60 | 2 |
| 8 | upa | UPA 24h | saúde | 60 | 2 |
| 9 | parque | parque | cidade | 70 | 2 |
| 10 | usina-solar | usina solar | infra | 80 | 2 |
| 11 | hospital | hospital | saúde | 150 | 3 |
| 12 | shopping | shopping | infra | 150 | 3 |
| 13 | igreja | centro cultural | cidade | 160 | 3 |
| 14 | reservatorio | reservatório | água | 180 | 3 |
| 15 | estadio | estádio | cidade | 300 | 3 |
| 16 | hospital-universitario | hospital universitário | saúde | 400 | 4 |
| 17 | aeroporto | aeroporto | infra | 600 | 4 |
| 18 | parque-aquatico | parque aquático | água | 700 | 4 |
| 19 | arranha-ceu | arranha-céu | cidade | 800 | 4 |
| 20 | roda-gigante | roda-gigante | cidade | 500 | 4 |
| 21 | metro | metrô | infra | 2000 | 5 |
| 22 | ponte | ponte estaiada | infra | 2500 | 5 |
| 23 | dessalinizadora | dessalinizadora | água | 2000 | 5 |
| 24 | centro-pesquisa | centro de pesquisa médica | saúde | 2000 | 5 |
| 25 | autodromo | autódromo | cidade | 1500 | 5 |

Os modelos 3D vêm de: `ObrasT3` (ids de infraestrutura), `praca`/`parque` (gerados em cidade-nivel.js), e o resto de `Obras` (igreja, estádio, shopping, aeroporto, parque-aquatico, arranha-ceu, roda-gigante, metro, ponte, autodromo, hospital via cidade).

### 6.2 Fórmulas

```
custo(k, n) = max(1, round(custoBase_k · clamp(sqrt(n / 100), f0 = 0.5, f1 = 4)))   // n = moradores da cidade
nível da cidade = min(5, 1 + floor(prontas / 5))          // nomes: bairro, cidade, polo, metrópole, capital
orçamento = pa + pi + ps (pontos da semana)
área: gasto = min(gc[a], custo); falta = custo − gasto; pct = gasto/custo
"em" = área com obra de maior pct (é onde fica o canteiro)
oferta ao prefeito = 3 upgrades mais baratos (por custoBase, desempate pelo índice) que a cidade não tem e com área < 3
```
Gênero para textos: feminino para `praca, igreja, escola, roda-gigante, ponte, caixa-dagua, estacao-tratamento, esgoto, upa, usina-solar, dessalinizadora` ("pra"/"a"), masculino para o resto ("pro"/"o").

### 6.3 Decisão do prefeito (`/api/decisao`)

Só aparece se `e.atual >= 0`, a cidade tem prefeito (`c.pref`) e o `@` local (`localStorage voto_eu`, normalizado) é o prefeito. Bloco "você é o prefeito: escolha a próxima obra" com até 3 botões `"<nome> · <custo>"`; o escolhido fica `.on` (lembrado em `localStorage nem_dec = {ib, k, t}` por 3 h).
```
POST /api/decisao  { u: <@>, c: 'obra', v: <id do upgrade>, s: <sessão de voto> }
ok → "escolhido: <nome> · entra no mapa em até 20 min"
erro → j.erro || "não consegui registrar, tenta de novo"
```
A escolha vale na próxima rodada da ponte (~20 min); o build resolve a fila.

### 6.4 UI mínima (`cvLinha`, `cvLinhaPessoa`, `cvInaugurou`)

- Seção "a cidade cresce com os pontos": título "em obra" ou "<cidade> construiu tudo nesta temporada"; por área com obra: `"<área>: <nome> · G de C pontos · falta 1 | faltam N"` + barra `cv-barra a<área>`; fila de 25 chips com o nível (`pronta` quando feito, title = nome); rodapé "pontos por área = missões e votos desta semana · zera domingo 21h · as obras prontas ficam até 01/11".
- Cartão da pessoa: `"<cidade>: falta 1 ponto | faltam N pontos pra/pro <nome>"`.
- Inauguração: compara a máscara guardada em `localStorage nem_cv` com a atual da cidade do "eu"; se cresceu, toast após 2,5 s: `"<cidade> inaugurou a/o <nome>"` ou `"<cidade> inaugurou N obras: a, b, c"`.

### 6.5 3D do nível (`cvSync`)

- Escala `CV_ESC = 0,62` (menores que as obras com meta). Moldes por id (`cvModelo`) fundidos numa malha só (`cvFundir`: junta tudo que usa `obraMat()` e tem cor por vértice; o resto é clonado como filho).
- `praca` = disco bege r 2,6 + chafariz azul r 0,7 + 8 árvores (tronco cilíndrico + copa cônica, 2 verdes); `parque` = gramado r 3,4 + lago r 1,3 + 20 árvores em espiral áurea (3 verdes).
- Na versão T3 as obras **prontas** são desenhadas pelo próprio gerador da cidade (sítios no tecido urbano); aqui fica **só o canteiro** da obra em andamento: faixa `can = floor(pct·20)`, posicionado no sítio reservado (`c.cid.sitiosCiv` com id = `Cidade.T3_FEATS[k]`, escala `min(0,62, max(0,3, w/4,6))`) ou, se a obra vai para a periferia, na 1ª vaga do anel.
- `cvVagas(c)`: 4 vagas fixas por cidade no anel `rs + [3.4, 4.4, 2.8, 5.4, 6]`, ângulos preferidos **135° (NO), 180° (O), 315° (SE), 270° (S)**, raio de reserva 3,2; 3 passes (terra ≥ 7/9 sem encostar; aceita cidade vizinha; só o centro em terra). Nunca em cima de obra com meta, hospital do patrocinador ou outra vaga.
- Máximo 2 cidades novas por quadro (`requestAnimationFrame` para o resto). Debug: `window.__cv`.

### 6.6 Painel da cidade (`cidade-painel.js`)

Substitui o cartão em tabela por um painel; só se `CV.v === 3` com 25 upgrades (senão o cartão antigo). Carrega sob demanda `cidades-t3.json` (`{gerado, semana, c: {ibge: {d: [[a,i,s,seg]×7 dias], m, v: votos, h: moradores que ajudaram, top}, br: {media: [4], rank: {ibge: [4]}}}`; caminho em `<meta name="cidades-t3">`).

Áreas do painel (4, com cores): água `#6cc4f0`, infra `#ffb347`, saúde `#72dca0`, segurança `#9b7bff`; cor "cidade" `#FFD23F`. Dias `D S T Q Q S S`.

Blocos, em ordem:
1. **Topo**: nome (h2), chip do estado por extenso, chip "nível N · <nome do nível>", chip oculto "#R no Brasil" (rank geral do json), número-herói animado (`counta`) + "ponto(s) na semana", chip "+N a confirmar" (missões pendentes `window.miPendentes`).
2. Botão "ajudar <cidade>" (missões, se ativas).
3. **Medidores** "esta semana": por área, bolinha colorida, nome, "#R no Brasil", valor + "pts" (+ "+N" a confirmar); barra com **escala logarítmica** `lg(x) = ln(1 + x) / ln(1 + max(máximo do Brasil na área, 2))`, largura `max(4, 100·lg(p))%`; traço vertical = média do Brasil (legenda "média do Brasil").
4. **Gráfico "pontos por dia"**: SVG 300 × 124, 7 barras empilhadas (áreas, topo arredondado r 6, separadores de 1,5 px), dias futuros em cinza, label do dia atual em destaque; clique/Enter alterna leitura: "melhor dia: <dia> · N pontos" ou "<dia|hoje> · água N · infra N · saúde N · segurança N". Abaixo, 2 números: "voto(s) recebido(s)" e "morador(es) ajudou/ajudaram".
5. **Trilha "upgrades" (P de 25)**: grade 5 níveis × 5 botões quadrados com pictograma SVG de traço único (25 ícones em `CP_ICO`, na ordem do catálogo); estado `ok` (cor da área), `obra` (fundo branco com preenchimento proporcional `max(8, pct·100)%` subindo) ou `fut` (tracejado cinza). Texto: resumo "faltam N pontos de <área> para <nome>" / "todas as obras prontas" / "toque numa obra para ver"; ao tocar: "<nome> · pronto" | "· em obra, G de C pontos de <área>" | "· pede C pontos em cada área" (área cidade) | "· custa C pontos de <área>".
6. **"quem manda"**: chips com avatar (inicial do @) e papel: prefeito (#FFD23F), vice (#fff2bd), fundador (#ffb347), presidente (#ef7b7b), senador (#b79cf0), governador (#72dca0), deputado (#6cc4f0); "prefeito / vaga aberta" quando não há; "e mais N no Congresso".
7. Botões "ranking" e "ver no mapa".
8. `<details>` "moradores e lojas": linha do hospital do patrocinador, linha da obra com meta, lojas, "coloque seu negócio aqui", "vereadores (N de 20)" (lista ou "ninguém ainda: comenta e pontua pra entrar na Câmara"), `<details>` "todos os moradores (N)" com busca "buscar @ nesta cidade" se N > 12.

Linha no cartão da pessoa (`cpLinhaPessoa`): "sua cidade: faltam N ponto(s) de <área> para <nome>" | "sua cidade: todas as 25 obras prontas" | "sua cidade: nível N, <nome do nível>". CSS injetado uma vez (`#cp-css`), com `prefers-reduced-motion`.

---

## 7. Cidade do futuro (`cidade-futuro.js`)

Cidades de nível ≥ 3 (`CF_MINIMO`) ganham elementos futuristas; nível = `min(5, 1 + floor(prontas/5))` (mesma conta do painel). Cores `CF_COR = { corpo #dfe9f5, aco #8195ad, escuro #33445c, ciano #46e6ff, violeta #a98bff, branco #f4fbff, solar #1c3f8a, solarBorda #7fd6ff }`. Corpo em `obraMat()` (com normais), brilho em `MeshBasicMaterial({ vertexColors, fog: false, toneMapped: false })`. Nada projeta sombra.

| nível | elementos |
|---|---|
| 3 | torre-farol baixa (H 14, 1 anel ciano) + 4 campos solares |
| 4 | torre média (H 22, orbe) + 8 campos solares + monotrilho (~40 % do contorno, 1 trem) + 6 drones |
| 5 | torre alta (H 34, 2 anéis + anéis cruzados inclinados ±0,9 rad + orbe icosaedro) + 12 campos + monotrilho (~90 %, 2 trens) + 12 drones em 2 camadas + cúpula de energia + holograma com o nome |

- **Torre** (`cfTorre`, escala `s = sqrt(H/20)`): plinto, fuste afunilado de 0,74H, deck de observação em 0,76H, cabine, antena de 0,3H; luz: 3 frestas verticais ciano no fuste, faixa sob o deck, janelão branco, anel ciano em `0,76H + 2,3` (r 2,0s), 2º anel violeta (nível 5), orbe. Fica na vaga 1 (ou 2, ou 0) de `cvVagas`.
- **Cúpula** (`cfCupula(rs)`, por raio arredondado a 0,5): esqueleto de 8 meridianos × 12 segmentos (ciano/violeta alternados) com `R = 0,74·rs`, `H = 0,42·rs`, 2 paralelos de 40 segmentos, octaedro branco no topo. Centro da cidade.
- **Drones** (`cfDrones(rs, n, camada)`): n caixas achatadas (0,5 × 0,18) ciano/branco com cúpula violeta e facho branco para baixo, a `y = 7 + 4·camada + 1,6·(i%4)`, raio `rs·(0,55 + 0,1(i%3))` (camada 0) ou `rs·(0,35 + 0,12(i%3))` (camada 1); giram em y a ±0,16 rad/s.
- **Terreno** (geometria própria da cidade, descartada na saída): monotrilho no anel `rs + 1,2` (60 amostras; escolhe o maior arco contínuo de terra fora das vagas, centraliza o comprimento desejado; viga 0,55 × 0,26 a 2,6 km acima do relevo suavizado (média móvel 7), fita de luz alternando ciano/violeta, pilar a cada 3, trens de 3 carros brancos com luz ciano em 30 % e 70 %); campos solares: até 60 tentativas em espiral áurea a partir de um ângulo derivado do ibge, em `rs + 1,5 + 0,9·(t%3)`, só em terra (3 pontos) e fora das vagas e do trilho; cada campo = 3 painéis azul-escuro inclinados 0,5 rad para o centro com borda clara + suporte.
- **Holograma** (nível 5): sprite 11 × 2,75 com canvas 512 × 128: nome em maiúsculas, `800 60px "Baloo 2"/Nunito` (reduz até caber em 470 px), sombra ciano 18 px, cor `#d9f9ff`, linha de base e linhas de varredura a cada 6 px; `opacity 0,96`, sem fog/tone mapping; a `topo da torre + 2,6`.
- **Marco de longe** (`cfMarcoLonge`): uma única malha aditiva (`AdditiveBlending, DoubleSide, opacity 0,9`) com feixe cônico vertical de 120 km (base clara r `0,5 + 0,1·nível`, topo apagado) + anel no chão (r 2,6..3,8; violeta para nível 5) nas **20 cidades de maior `nível·1000 + prontas·10 + min(9, orçamento/1000)`**; engrossa com a altura da câmera: `s = round(clamp(h/250, 0,4, 40)·4)/4` (vertical limitada a 12), só quando muda.
- Sincronização como as demais (máx. 2 cidades novas por quadro); loop único de animação enquanto houver algo. Debug `window.__cf = { grupos, ids, sync, nivel, forcar(ib, n), todas(n), feixes, limpar, desenhos }`.

---

## 8. Utilitários do site

### 8.1 `hash.js` — @ normalizado e chave anônima

- `norm(s)`: trim, minúsculas; se contém `instagram.com/` corta até depois; remove `@` iniciais; corta em `/ ? #`; remove de novo `@`; mantém só `[a-z0-9._]`; máximo 30 chars; `''` se não sobrar nada.
- `sha256(str)`: implementação síncrona própria (ASCII; não depende de `crypto.subtle`, que só existe em páginas seguras).
- `chave(h) = base64(primeiros 12 bytes de sha256('naoeummapa:v1:' + h))` → 16 caracteres sem padding (alfabeto padrão A–Z a–z 0–9 + /).
- Privacidade: o site não guarda a lista de @ dos moradores comuns, só o hash; dá para perguntar "esse @ tem casa?" mas não listar quem tem. O mesmo código roda no build (Node) e no navegador.

### 8.2 `urbanista.js` — urbanismo sob demanda

`criarUrbanista(terra)` mantém um `Set` de células ocupadas (grade de 2 km, chave `floor(x/2)·100003 + floor(y/2)`). `construir(sp)` (`sp = {ibge, centro, nome, uf, moradores:[{key, h, tipo, flag}]}`): se o disco de 4,5 km no centro não está livre (células + 5 pontos em terra), procura em espiral (raios 2..200, passo 2 até 40 depois 4, 20 ângulos a partir de um offset por hash do ibge) e arredonda a 0,1; chama `Cidade.construirCidade({...sp, centro, terra: livre})`; marca o centro (r 3,4), casas, marcos e vagas (r 1,2); devolve a cidade com `centroOriginal` e `deslocada`. `construirFixo(sp, terraFn)` não desloca nem marca (centro já resolvido no build, para reconstruir/descartar com o mesmo resultado). Cidades grandes ocupam o chão primeiro; as pequenas (1–9 casas) entram quando o celular tem folga ou alguém as procura.

### 8.3 `alta.js` — buff "em alta no story"

- Dados `D.S = [[índice do @, fim do buff em segundos unix], …]` → `AL: gi → fim ms`; `emAlta(gi)` confere o relógio do aparelho (buff vencido some sozinho). `altaAte(gi)` → "até 15h" (hoje) ou "até amanhã 03h20".
- Selo no cartão da pessoa: "em alta no story" + "até … · quem posta marcando @<perfil> fica em alta por 24 h".
- **3D**: 2 `InstancedMesh` (capacidade em potências de 2 a partir de 32) com `MeshBasicMaterial({ vertexColors, DoubleSide, fog: false })`: anel no chão `RingGeometry(0.88, 1.2, 14)` em y 0,07 alternando laranja `#FF7A1A`/ouro `#FFD23F`; chama = 2 cones de 5 lados (0,46 × 1,5 base laranja/ponta ouro + 0,22 × 0,85 ouro/gema `#FFF3A8`, ~20 triângulos) no topo da casa. Altura do telhado por nível: `[1.15, 1.85, 2.4, 1.7, 2.9]` para níveis 1–5; do 6 em diante `0,55·nível + 0,4`. `altaPulso(ms)`: brilho do material `0,82 + 0,18·sin(ms/260)`.
- Botão grande do cartão: "posta sua casa no story" / "+30 e em alta por 24 h" (próprio) ou "gerar a imagem da casa de @x" (outro). Convite flutuante após buscar o próprio @ (some em 7 s): "posta sua casa no story · +30 pontos (1 por dia) e em alta por 24 h" ou, se já em alta, "você está em alta · até … · posta de novo amanhã pra manter".

### 8.4 `site/src/figo.js` — hospital do patrocinador no site

- Dados `D.F = { m: marca, c: cupom, p: [post, extra, marca, story], k: cargo, s: [[ibge, handle, pontosPatrocinador, nCidade], …], app }`. Só entra no build com o patrocínio ativo.
- **Posição**: se a cidade reservou meio quarteirão (`cid.figo = {x, y, angV, comp, larg}`), usa-o: gira o prédio para o comprido ficar ao longo da quadra, vira a fachada para o lado do centro, escala `min(1, (comp − 0,1)/4,9, (larg + 0,5)/3,7)`. Senão: anel `rs + 4,4`, ângulos na ordem `45, 135, 315, 225, 90, 0, 180, 270, 20, 70, …` (nordeste primeiro), terra em 9 pontos (r 2,6), longe de outras cidades (`rs + 3,2 + 0,6`) e de outros hospitais (`2·3,2 + 0,5`); fallback 45°. Fachada para o centro.
- **Cenário**: um molde `Figo.criar(THREE, {A})` e `clone()` por cidade ativa com secretário (geometria/material/textura compartilhados); `userData` do molde vazio.
- Toque: raycast ou proximidade (< 36 px) em alturas 2,5 e 6,6. Cartão: logo, "Hospital <marca> · <cidade>", "Secretário de Saúde: @x", vídeo mudo em loop (lazy, `preload none`), pitch ("Seu guia contínuo de saúde" + parágrafo + pílulas "Te entende / Te orienta / Evolui com você"), cupom com "copiar"/"copiado!" e "25% off na assinatura", botão "Baixar o app" (no Android, se o link é da App Store, manda para o site), rodapé "publi · parceria paga com @marca". Voa a `dist 34`.
- Linha no cartão da cidade: "Hospital <marca> · Secretário de Saúde: @x [ver o hospital]" ou "Hospital <marca> sem secretário: o primeiro que comentar marcando @marca leva". Selo no cartão da pessoa secretária: cargo + "Hospital … de <cidade> · N pontos". Bloco "como funciona": regras de pontuação (comenta a cidade marcando a marca +P, marca amigo +M, story +S por dia; comentário extra no post da marca +E até 10; os pontos do patrocinador só decidem o secretário, não somam no jogo; empate = quem marcou primeiro; o primeiro já vira secretário na hora) + cupom.

---

## 9. Textos de interface (pt-BR) por módulo

**obras-mapa**
- "<obra> pronta" · "em obra N%" · "<obra> · em obra N%"
- "<obra> inaugurado" · "a cidade passou de N moradores"
- "Obra: <obra>" · "N de M moradores · " · "faltam N"
- "chamar amigos de <cidade>" · "texto copiado: cola no story ou manda pros amigos" · "ver a obra" · "ver o monumento"
- "Bora destravar o <obra> no @<perfil>! Comenta <cidade> no último post e marca 3 amigos: <url>/?c=<ibge>"
- "de N obras inauguradas" · "pronta" · "em obra · " · " · inaugurado" · " · faltam N morador(es)"
- "cada cidade destrava uma obra famosa quando bate a meta de moradores. comenta o nome da cidade e marca amigos pra acelerar"
- "obras do Brasil" · "quem está construindo o quê" · "N de M inauguradas"

**lojas-mapa**
- "negócio no mapa" · "N negócios no mapa" · "patrocinado" · "no mapa até dd/mm"
- "seguir @ig" · "no Instagram · +S pts" · "seguindo ✓ +S" · "ver @ig no Instagram"
- "seu @ (1 vez) pra ganhar +S" · "seu @ do Instagram" (aria) · "você: @x · " · "não sou eu"
- "não achei @x no mapa: só quem tem casa ganha os +S" · "abri o Instagram. pra ganhar os +S, digita seu @ e toca de novo"
- "abri o Instagram, mas não consegui registrar os +S agora: toca de novo" · "+S pts a caminho: entram na próxima atualização do mapa"
- "WhatsApp" · "chamar <nome>" · "Oi! Vi vocês no @<perfil>"
- "marca @x num comentário do @<perfil>: +P pts (1 vez)" · "copiar @" · "@x copiado: cola no comentário"
- "＋ seu negócio nesta cidade" · "＋ coloque seu negócio aqui" · "＋ seu negócio no mapa"
- rótulo 3D: "<nome> · @x"

**cidade-nivel**
- "a cidade cresce com os pontos" (aria) · "em obra" · "<cidade> construiu tudo nesta temporada"
- "<área>: <obra> · G de C pontos · falta 1 | faltam N" · "obras da cidade" (aria) · "(pronta)"
- "você é o prefeito: escolha a próxima obra" · "<obra> · <custo>" · "…" · "escolhido: <obra> · entra no mapa em até 20 min" · "não consegui registrar, tenta de novo"
- "pontos por área = missões e votos desta semana · zera domingo 21h · as obras prontas ficam até 01/11"
- "<cidade>: falta 1 ponto | faltam N pontos pra/pro <obra>"
- "<cidade> inaugurou a/o <obra>" · "<cidade> inaugurou N obras: a, b, c"

**cidade-painel**
- níveis: "bairro, cidade, polo, metrópole, capital" · "nível N · <nível>" · "#R no Brasil"
- "ponto na semana" / "pontos na semana" · "+N a confirmar" · "ajudar <cidade>"
- "esta semana" · áreas "água, infra, saúde, segurança" · " pts" · "média do Brasil" · "#R no Brasil"
- "pontos por dia" · "pontos da semana por dia, em água, infraestrutura, saúde e segurança" (aria) · dias "domingo…sábado" · "<dia>: N pontos" (aria) · "melhor dia: <dia>" · "N pontos" · "hoje"
- "voto recebido / votos recebidos" · "morador ajudou / moradores ajudaram"
- "upgrades" · "P de 25" · "faltam N pontos de <área>" · " para <obra>" · "todas as obras prontas" · "toque numa obra para ver"
- "<obra>, pronto | , em obra | , ainda não" (aria) · " · pronto" · " · em obra, G de C pontos de <área>" · " · pede C pontos em cada área" · " · custa C pontos de <área>"
- "quem manda" · papéis "prefeito, vice, fundador, presidente, senador, governador, deputado" · "vaga aberta" · "e mais N no Congresso"
- "ranking" · "ver no mapa" · "moradores e lojas" · "vereadores (N de 20)" · "ninguém ainda: comenta e pontua pra entrar na Câmara" · "todos os moradores (N)" · "buscar @ nesta cidade"
- "sua cidade: faltam N ponto(s) de <área> para <obra>" · "sua cidade: todas as 25 obras prontas" · "sua cidade: nível N, <nível>"

**alta**
- "em alta no story" · "até HHh" · "até amanhã HHhMM" · "quem posta marcando @<perfil> fica em alta por 24 h"
- "posta sua casa no story" · "+30 e em alta por 24 h" · "gerar a imagem da casa de @x"
- "você está em alta" · " · posta de novo amanhã pra manter" · "+30 pontos (1 por dia) e em alta por 24 h"

**hospital do patrocinador (site)**
- "Hospital <marca> · <cidade>" · "Secretário de Saúde: " · "Seu guia contínuo de saúde" · "Te entende" · "Te orienta" · "Evolui com você"
- "cupom" · "25% off na assinatura" · "copiar" · "copiado!" · "copiar cupom" · "cupom X copiado" · "Baixar o app da <marca>" · "publi · parceria paga com @marca"
- "Hospital <marca>" · " · Secretário de Saúde: " · "ver o hospital" · "ver" · "Hospital <marca> sem secretário:" · " o primeiro que comentar marcando @marca leva"
- "Hospital <marca> de <cidade>" · " · N pontos <marca>" · "parceria @marca"
- "em cada cidade, quem pontua mais com a <marca> vira Secretário de Saúde e a cidade ganha o Hospital <marca> no mapa 3D, com o @ no letreiro."
- "comenta a cidade no post marcando @marca" · "marca amigo (por @)" · "posta story marcando @<perfil> (por dia)"
- "os pontos <marca> só decidem o secretário: não somam nos seus pontos do jogo. comentário extra no post da <marca> vale +E aqui (até 10). o secretário é quem tem mais pontos <marca> na cidade; empate: quem marcou primeiro. o primeiro a marcar já vira secretário na hora."

**letreiros em voxel dentro dos modelos**: "SHOPPING", "ESCOLA", "ZOO", "M", "BOA VISTA", "ARACAJU", "NORTE", "SUL", "SJC", "SOROCABANA", "HOSPITAL" (textura do hospital do patrocinador).

---

## 10. Checklist de reimplementação

1. Kit: primitivas da tabela §1.4 sobre `BufferGeometry` não indexada com cor por vértice; estágios como grupos com `base`; `montar`; `animar` com a mola §1.2.
2. Catálogo: 14 famosas + 14 genéricas (§2.1–2.2) com `apelidos`; 21 monumentos de capitais (§2.3–2.4); canteiro paramétrico; 11 de infraestrutura (§2.5); hospital do patrocinador (§2.6).
3. Lojas: 12 tipos/paredes/ícones; fachada padrão; letreiro canvas 512×128 com Nunito 900 e contraste por luminância 0,34; cache por tipo; especiais via objeto global `{parede, fachada, icone, anima}`.
4. Mapa: obras com meta (estado por moradores, canteiro em 20 faixas, posição SO), lojas (vigência BRT, slots do urbanismo, escala 1,35–2,0, raio-X anti-oclusão), hospital (NE), vagas do nível (NO/O/SE/S).
5. Cidade: `D.CV` v3, custo `base·clamp(sqrt(n/100), 0,5, 4)`, nível `1 + floor(prontas/5)`, painel com escala log, trilha 5×5, decisão do prefeito via `/api/decisao`; cidade do futuro para níveis 3–5.
6. Pontos: seguir loja `+LJC.s` via `/api/seguir`, marcar `+LJC.p`, story `+30` (1/dia) e buff de 24 h.
