# IMPLEMENTATION_STATUS — Seu Mundo Novo

Atualizado: 24/10/2026. Status por item: `implemented` · `tested-local` · `tested-sandbox` · `verified-live` · `blocked-external`.

## Fase 0 — Diagnóstico (concluído)

**O que existe**
- Front: Vite + TypeScript + Three.js r170 (vanilla). Mapa 3D próprio (`src/mundo/*`): continente por UF (IBGE), costa, rios, biomas, mata instanciada, nuvens, marcadores, rótulos, gerador procedural determinístico de cidade (`src/mundo/cidade.ts`: lote k da cidade sempre na mesma posição), casas por nível (11 modelos), lojas 3D, dia/noite por horário de Brasília, pós-processamento (MSAA + bloom leve).
- UI: busca, cartões (casa/cidade/estado/loja), abas (Minha Casa, Minha cidade, Eleições, Ranking, Lojas), painéis (como funciona, negócio, reivindicar, ruas).
- Dados: pacote estático `public/dados/mundo.json` (hoje DEMO: 40 mil moradores fictícios `demo.*`, marcado `demo: true`).
- Servidor: `server/` Node 22 + Hono + Postgres (`pg`). Migrações SQL reversíveis (`server/migrations`), fila durável com SKIP LOCKED/backoff/fila morta, outbox, sessão por cookie HttpOnly, CSRF double-submit, limite por IP.
- Banco local: cluster Postgres próprio do projeto (`npm run db:local`, porta 54329; `smn_dev`, `smn_test`).

**Decisões**
- "3DDS" = a renderização Three.js própria deste repositório; nenhuma engine nova.
- O "serviço atual de criação da casa" é o par **contador de lote por cidade (`city_lot_counters`) + gerador procedural do front**: o lote k da cidade é sempre a k-ésima posição do gerador. O provisionamento do Instagram só aloca o próximo índice, em transação; nenhum gerador paralelo.
- Ruas são **agrupamento lógico** (24 casas por rua, configurável) sobre os lotes existentes; nenhuma casa é movida.
- Cargos MVP: líder da rua, prefeito, presidente (eleição por voto). Os cargos clássicos por pontos (deputado/governador/senador) ficam só como histórico/legado no mapa estático.
- Identidade: o @ digitado nunca autentica. Prova por link de uso único (private reply) ou desafio por código publicado da própria conta.

**Riscos concretos**
- Meta: permissões/janelas de Private Reply e de webhooks precisam ser confirmadas na documentação vigente e na revisão do app (blocked-external até o operador conectar a conta profissional).
- Unicidade de pessoa: conta verificada ≠ pessoa única; só limites e revisão de abuso.
- Desempenho mobile: cidades grandes (SP) passam de 3 mil casas visíveis; o orçamento de cidades/casas por aparelho já existe, falta medir FPS real em aparelho intermediário.

## Frentes e faixas de migração
| Frente | Escopo | Migrações | Status |
|---|---|---|---|
| Núcleo (feito) | config, db, migrações, fila, outbox, http, sessão, CSRF, resolução de cidade, fixtures | 001 | tested-local |
| Fase 1 | webhook Instagram, provisionamento idempotente, reivindicação (link e desafio), página de confirmação | 002 | tested-local (28 testes `server/test/fase1-*`); Meta ao vivo blocked-external — ver `docs/meta-instagram.md` |
| Fase 2 | ruas, avatar/editor, destinos/slots/teletransporte, presença, amizade, convites | 010–016 | tested-local (31 testes) |
| Fase 3 | ledger de recompensas, missões, competição de ruas, obras comunitárias, catálogo 60 eventos + orquestrador | 030–033 | tested-local (25 testes; 15 eventos desabilitados com motivo) |
| Fase 4 | eleições (líder, prefeito, presidente), snapshot, voto, apuração, mandato, poderes | 020–021 | tested-local (27 testes) |
| Fase 5 | estabelecimentos patrocinados, cupons, métricas, política etária, painel admin | 040–041 | tested-local (20 testes) |
| Fase 6 | pipeline de conteúdo, publicação dry-run, `video-studio/` separado (Motionmaxxing) | 050–051 | tested-local (publicação oficial: blocked-external) |
| Integração | provedores entre frentes, painéis no app, jornada ponta a ponta | — | tested-local (`jornada.test.ts`) |
| Fase 7 | migração do legado (dry-run), mundo.json a partir do banco, hardening mobile | 060+ | pendente |

## Fase 6 — conteúdo e vídeo (tested-local)
- **Motionmaxxing** (github.com/Tejashmakwana/motionmaxxing, commit `8c8ec0f`, 06/10/2026): skill de agente (SKILL.md) para dirigir motion design; renderiza HTML local via Chrome + ffmpeg. Apache-2.0, mas o runtime dela embute GSAP (licença GreenSock, não aberta). Decisão: runtime próprio sem GSAP; vendorizadas só as 12 curvas de easing (atribuição em `video-studio/NOTICE`); templates seguem o contrato de seek dela (`__seek/__duration/__ready`). Nada instalado globalmente.
- `video-studio/` separado (package.json/tsconfig/testes próprios): 12 templates HTML 1080×1920/30 fps, `HtmlRenderer` (RendererAdapter: validateInput/render/thumbnail/inspectOutput), worker da fila, pacote manual dry-run. Ver `video-studio/README.md`.
- Servidor: `server/src/modulos/conteudo/` (contrato, fontes, copy, pipeline, publicador, rotas) + migrações 050 (candidatas, snapshots, render_jobs, publication_jobs, tentativas, calendário, aprovações, erros de evento) e 051 (funil). Autopublish desligado; 1 post orgânico/dia; kill switches render/publicação separados; publicação oficial só com 3 chaves explícitas.
- Demonstração: `video-studio/out/demo/{casa,votacao,resultado}.mp4` (+ .jpg, pacote manual), dados fictícios rotulados.
- Pendências: recapturar fundos com o mundo do banco (hoje pacote DEMO); câmera por rua para antes/depois real; aprovação dos storyboards; casar nomes de eventos das outras frentes com `EVENTOS_CONTEUDO`; storage público do MP4 e credenciais Meta (blocked-external); agendador periódico de `conteudo.selecionar`; painel admin consumir `/api/conteudo/admin/*`.

## Comandos
```bash
npm run db:local      # sobe o Postgres do projeto (54329)
npm run db:migrar     # aplica migrações em smn_dev
npm run server        # API em :8787 (o Vite faz proxy de /api)
npm run dev           # front em :5173
npm test              # testes (banco smn_test)
npm run capturas      # capturas de tela de referência (docs/capturas)
```

## Resultado da verificação (24/10/2026)
- `npm test`: **19 arquivos, 145/145** (num banco único, em sequência). `video-studio`: **37/37**.
- `npm run typecheck`: front e servidor sem erros. `vite build`: ok (jogo, reivindicar, admin).
- Jornada integrada (sintética): comentário assinado → casa no lote 0 de Vila Velha (IBGE 3205200) → private reply (adaptador dev) → reivindicação → sessão → avatar salvo → rua com competição/obra → missões → eleições.

## Checklist (capítulo 19)
| Item | Situação |
|---|---|
| Pronto localmente | mapa 3D, cidades, lojas 3D, dia/noite; webhook com assinatura; provisionamento idempotente; reivindicação (link e código); avatar; ruas; presença; amizade; missões/ledger; competição; 60 eventos + orquestrador; eleições completas; estabelecimentos + cupons; painel admin; pipeline de conteúdo dry-run; 3 vídeos demo |
| Depende de credencial | IG_APP_SECRET, IG_VERIFY_TOKEN, IG_CONTA_ID, token da conta oficial; CONTEUDO_URL_MIDIA (storage público) |
| Depende de revisão Meta | Advanced Access para instagram_business_basic, instagram_business_manage_comments, instagram_business_content_publish (e possivelmente manage_messages para private reply) |
| Depende de teste ao vivo | entrega real de webhook e de private reply; publicação de Reel; formato exato do payload (doc tem 2 variantes) |
| Depende de decisão comercial | preços/contratos de patrocínio (MVP manual, sem cobrança); política etária antes de ligar "bares"; aprovação dos storyboards para autopublish |

## Pendências conhecidas
- `mundo.json` ainda é gerado em modo DEMO; falta `server/src/build/exportar.ts` lendo do banco (casas reivindicadas + lojas via `lojasParaMapa()`).
- Agendador externo garantindo os jobs recorrentes (ver OPERATIONS.md).
- Eleições nascem sob demanda (primeiro acesso da cidade); considerar criação no início da temporada.
- Participação ativa em 7 dias, coordenador provisório de rua e limites de abuso além de IP.
- Painel admin ainda não mostra a fila editorial (`/api/conteudo/admin/*`).
- Passkey/2FA na frente do admin em produção; upload/escaneamento de logos.
- Medir FPS em aparelho intermediário real.

## Próximo passo concreto
Escrever `server/src/build/exportar.ts` (mundo.json a partir do banco) e o dry-run de migração do legado; depois o operador conecta a conta oficial da Meta em ambiente de teste.
