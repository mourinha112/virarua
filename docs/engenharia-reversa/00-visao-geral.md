# Engenharia reversa · naoeummapa.app · visão geral

Data da análise: 24/10/2026. Fonte: arquivos públicos do site (index.html, dados.js, engine.js, rewind.js, JSONs), navegação no navegador e leitura do código (que não é minificado e traz os nomes dos módulos originais).

## O que é

"Não É Um Mapa" é um **jogo social sobre um Brasil virtual em 3D**. Cada pessoa que comenta o nome da sua cidade num post do perfil do jogo no Instagram ganha uma **casa** naquela cidade no mapa 3D. A casa sobe de nível com pontos; cada hora dá para **votar** em alguém para um cargo (vereador, prefeito, deputado, governador, senador, presidente); domingo às 21h a semana fecha, quem tem mais pontos assume o cargo e tudo recomeça. As cidades evoluem com **missões** (minigames) e **obras** (água, infraestrutura, saúde, segurança), e **lojas patrocinadas** (negócios locais que pagam R$ 49–99 por 10 dias) aparecem como prédios com letreiro.

Posicionamento: "o jogo do Brasil virtual · veja sua casa". Público: jovens brasileiros no Instagram (muitas contas 2008–2013) e pequenos negócios locais.

## Arquitetura do original (como está no ar)

```
Instagram (@ do jogo)                         Vercel (estático + funções)
 ├─ comentários "minha cidade é X"  ──┐        ┌─ index.html (1 arquivo, CSS inline ~190 KB)
 ├─ marcações de amigos/lojas         │ ingest  ├─ dados.js  (window.__DADOS, 4,6 MB: todos os @, cidades, pontos)
 ├─ stories marcando a página         ├──────► ├─ engine.js (Three.js r160 + ~19.400 linhas próprias, legíveis)
 └─ seguir lojas                      │ Python ├─ rewind.js (temporada 1, hash do @)
                                      │        ├─ numeros.json, poder.json, eleicao.json, missoes.json, ofensiva.json
 /api/voto, /api/frase, /api/missao, ─┘ build  ├─ ev/<k>.json, hm/<k>.json, selos/<k>.json (shards de 2048 moradores)
 /api/seguir, /api/decisao, /api/visita, Node  ├─ missoes-jogos.js (3 minigames, carregado sob demanda)
 /api/neg-ev  (funções Vercel → fila)          └─ manifest.webmanifest + ícones (PWA)
```

- **Tudo é estático e regenerado por um build** a cada ~20 minutos ("os pontos entram em até 20 min"). As funções `/api/*` só gravam eventos (voto, frase, missão, seguir, decisão, visita, telemetria do funil de negócio); o build lê esses eventos + o ingest do Instagram e reescreve `dados.js` e os JSONs. O front usa `?v=hash` nas metas para cache-busting.
- **Sem login**: a identidade é o @ do Instagram digitado (guardado em localStorage `nem_eu`/`voto_eu`). A prova de posse é fraca (há um "link mágico"/prova opcional para frases). Votos são públicos com o @.
- **Front sem framework**: vanilla JS em IIFEs, DOM criado à mão, um `<canvas>` WebGL com Three.js ocupando a tela, cartões/abas em HTML por cima.
- **Mobile-first / PWA**: tabbar inferior, "adiciona à tela inicial", `?app=1` no start_url, modo `SIMPLES` (flags `window.SIMPLES`, `VOTAR_UI`, `REATIVA`, `MISSOES`, `FRASES`).

## Módulos do engine (ordem no bundle)

| Faixa | Módulo original | Papel |
|---|---|---|
| site/src/cidade-t3.js | gerador procedural de cidade | ruas, lotes, casas, praça, marcos (prédio/hospital/cassino), níveis T3 da cidade, nuvens, shaders |
| shared/relevo.js | relevo | decodifica relevo/biomas comprimidos, achata sob cidades |
| mesa3d/src/layout.js | layout | ordem dos moradores por cidade, casas cinzas/anônimas, obras |
| shared/figo.js, obras.js, obras-cidades-a/b.js | obras 3D | kit voxel, ~dezenas de obras genéricas, monumentos reais das capitais |
| shared/lojas-especiais/*.js (97) + lojas.js | lojas 3D | modelo padrão por tipo + 97 modelos exclusivos de patrocinadores |
| mesa3d/src/world3d.js | mundo | renderer, câmera, luz, mar, continente, árvores, marcadores, entrada, laço |
| site/src/hash.js, urbanista.js, figo.js, alta.js, obras-mapa.js, lojas-mapa.js, lojas-visiveis.js, obras-t3.js, cidade-nivel.js, cidade-painel.js, cidade-futuro.js | cidade no site | nível da cidade, painel, "cidade do futuro" (obras por área, decisão do prefeito) |
| site/src/site.js | núcleo | busca, cartões, abas, voo, totais, ajuda, reativação |
| site/src/poder.js, dados.js | pontos e dados | decodifica `__DADOS`, níveis 1–50, cargos, extrato, selos, votar |
| site/src/ranking.js, eleicao.js, ofensiva.js, missoes.js | jogo | ranking cidade/UF/Brasil, painel votar, sequência de fogo, missões |
| shared/frase-filtro.js, site/src/frases.js, frase-ui.js | frase da casa | frase pública + cor do telhado, filtro de conteúdo |
| site/src/painel-eleicao.js, lojas-hub.js, mapa2d.js, negocio.js, ficha.js | painéis | painel da eleição ao vivo, aba Lojas, mapa 2D (SVG por UF), funil "seu negócio no mapa", ficha |

As especificações detalhadas de cada parte estão nos arquivos `01`–`05` desta pasta.

## Números do original (24/10/2026)

| Métrica | Valor |
|---|---|
| casas (moradores) | 159.047 |
| cidades com casa | 5.509 de 5.571 (98,9%) |
| eleitores na semana | 26.726 |
| votos na semana | 170.517 |
| lojas patrocinadas vigentes | 88 (97 modelos 3D exclusivos já feitos) |
| temporada (mandato) atual | 2 · 18/10 → 01/11/2026 (fecha domingo 21h) |

## Loop do jogo (regras principais)

1. Comenta a cidade em qualquer post → casa nasce em até 20 min com 10 pontos.
2. Pontos: comentar +5 (1 por post, teto 100/dia junto com marcações), amigo marcado que entra +50 (evento: +100), story marcando a página +30/dia (e "em alta" 24 h), seguir loja +30 (até 15 lojas/dia), marcar loja +10, cada voto recebido +5 ou mais, missões +5 (cidade +10), Reel no direct.
3. Nível da casa = função dos pontos totais (50 níveis com nomes: casinha, sobrado, casa alta…); nunca desce.
4. Voto: 1 por hora em cada cargo; vale 5 + sequência (horas seguidas votando, "fogo"); zera domingo 21h; público.
5. Cargos por pontos da semana: vereador (cidade), prefeito (1º da cidade), vice, deputado (UF), governador (1º da UF), senador (top Brasil), presidente (1º Brasil). Selos permanentes de ex-cargos.
6. Cidade: nível 1–5 (bairro, cidade, polo, metrópole, capital), 25 upgrades por área (água, infra, saúde, segurança) comprados com pontos da cidade; prefeito decide a próxima obra.
7. Missões: 3–4 minigames por cidade (água: canos; infraestrutura: sequência de postes; saúde: triagem; segurança), trava de 12 h por área, quem mais conclui vira "ministro" da semana.
8. Lojas: negócio paga Pix (R$ 49 até 100 mil hab., 69 até 1 mi, 99 acima) por 10 dias; vira prédio com selo "patrocinado"; moradores ganham pontos seguindo/marcando.

## Decisões para a nossa versão (Seu Mundo Novo)

- **Reimplementação original**: nada de copiar código, modelos 3D de patrocinadores, @ de usuários ou textos de marca do original. Mecânicas de jogo e layout de informação são referência; a execução é nossa.
- **Stack**: Vite + TypeScript + Three.js (vanilla, canvas-game), Supabase (Postgres + RPC + cron) e Vercel (`/api/*` + estático). Dados do mapa gerados por script (`scripts/build-dados.ts`) a partir do Supabase, com modo `--mock` para desenvolvimento (milhares de casas sintéticas).
- **Geografia própria**: IBGE (malhas das UFs, 5.571 municípios com população 2024) → `src/data/terreno.json` e `municipios.json`.
- **Identidade**: fase 1 igual ao original (@ digitado + link mágico); fase 2 (diferencial) login real.
