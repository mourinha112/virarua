# video-studio — Seu Mundo Novo

Estúdio de vídeo **separado do jogo** (Fase 6). Tem `package.json`, `tsconfig.json`, testes e `node_modules` próprios.
O build do jogo (`npm run build` na raiz) não importa nada daqui: o `tsconfig.json` da raiz inclui só `src`, `scripts`
e `api`, e o Vite só empacota `src/`.

Template HTML parametrizado (1080×1920, 30 fps, 10–20 s) → quadros no Chrome instalado → MP4 H.264 com ffmpeg →
thumbnail → inspeção com ffprobe. Publicação padrão: **dry-run** (MP4 + thumbnail + legenda para publicação manual).
Nada aqui publica, conecta conta ou envia mensagem.

## Motionmaxxing: o que é de fato

Conferido em 24/10/2026 em https://github.com/Tejashmakwana/motionmaxxing (README, SKILL.md, LICENSE, NOTICE,
`runtime/README.md`, `runtime/motion.js`, `scripts/render.mjs`, `scripts/_cdp.mjs`, `install.sh` lidos antes de qualquer uso).

- **Versão fixada:** commit `8c8ec0f2a6f6c9a0da15cd24f7b1298ab298368c` (06/10/2026, "docs: trim license line"). O repositório
  se declara "early release" e não tem tags.
- **O que é:** uma *skill de agente* (pasta com `SKILL.md`) que orienta um agente (Claude Code etc.) a dirigir filmes de
  motion design: protocolo de 10 passos, regras medidas em 53 filmes (12 curvas de easing, "pousar desacelera, sair
  acelera", "nada cresce do zero", "corte no movimento"), gates G0–G5 com scripts (`look.py`, `lint.mjs`). Renderiza
  localmente HTML puro com Chrome + ffmpeg (`scripts/render.mjs`, tempo controlado por `window.__seek(t)`).
  **Não é** pacote npm, plugin de Remotion, API de publicação, scheduler nem serviço contínuo.
- **Licença:** Apache-2.0 para o trabalho original (SKILL.md, references, scripts, templates, `runtime/motion.js`…).
  **Atenção:** o runtime da skill depende de **GSAP 3.12.5** empacotado em `runtime/vendor/`, que **não** é open source
  (GreenSock Standard "No Charge" License, com condições próprias, explicitadas no NOTICE deles). Também empacota
  three.js (MIT), opentype.js (MIT) e Inter (OFL).

### Decisão

1. **Runtime próprio** HTML → quadros → MP4 (`renderers/html.ts` + `templates/_base/runtime.js`), **sem GSAP**, para
   não herdar a licença não-aberta. Nada da skill foi instalado globalmente; `install.sh` e os scripts dela não foram
   executados.
2. **Vendorizado (Apache-2.0, com atribuição em `NOTICE`):** só as 12 curvas de easing medidas, reescritas em
   `templates/_base/runtime.js` com os mesmos números.
3. **Compatibilidade:** os templates seguem o contrato de seek da skill (`window.__seek`, `window.__duration`,
   `window.__ready`), então também podem ser renderizados por `scripts/render.mjs` da Motionmaxxing num fluxo
   assistido, sem alteração.
4. **Uso da skill no fluxo criativo:** os princípios dela orientaram os 12 templates (chegada de maior que o natural,
   corte no movimento, fundo em deriva para não ter quadro morto, segura final ≤ 1,4 s, um herói por quadro) e a
   inspeção honesta (`inspectOutput` reprova vídeo preto/parado/com áudio, em vez de "certificar"). Um template inédito
   pode ser criado com `/motionmaxxing` no fluxo assistido, passar por storyboard + revisão e então virar template de
   produção aqui. O runtime de produção não depende de alguém digitar `/motionmaxxing`.
5. **Conflito declarado:** a skill proíbe "rótulos de canto / selos". Aqui os selos **jogo virtual**, **patrocinado**,
   **placar parcial**, **resultado oficial** e **DEMONSTRAÇÃO · dados fictícios** são obrigatórios (transparência/
   identificação publicitária) e prevalecem.
6. Adaptador Remotion: **não existe** (não foi necessário). Nenhum pacote "motionmaxxing" foi inventado.

## Estrutura

```
contrato/contrato.ts     cópia byte a byte de server/src/modulos/conteudo/contrato.ts (npm run contrato; teste confere)
templates/_base/         runtime.js (seek determinístico + eases), filme.js (casca: fundo, selos, 4 partes, CTA), base.css
templates/<id>/          index.html + cena.js — 12 templates: casa, avatar, convite, obra, exploracao, desafio,
                         votacao, virada, resultado, inauguracao, agenda, retrospectiva
storyboards/             storyboards.json (beats, o que cada um "compra", aprovação pendente) e exemplos.ts (inputs DEMO)
renderers/               tipos.ts (RendererAdapter), html.ts (HtmlRenderer), inspecionar.ts (ffprobe/ffmpeg)
scheduler/               worker.ts (consome a fila do servidor pela API interna), orcamento.ts (memória/carga)
publisher/               pacote.ts (pacote manual dry-run: video.mp4, thumbnail.jpg, legenda.txt, manifesto.json)
assets/capturas/         capturas do JOGO REAL (engine Three.js do repositório), retrato 1080×1920 + manifesto.json
assets/placeholders/     imagens provisórias, marcadas "PLACEHOLDER" na imagem e `placeholder: true` no input
scripts/                 capturar-jogo, placeholders, render, demo, folhas, sincronizar-contrato
tests/                   contrato, templates (12), inspeção/worker
out/                     demo/ (vídeos de demonstração), folhas/ (folhas de contato), jobs/ e publicacao/ (gitignored)
```

## Comandos

```bash
cd video-studio && npm install            # escopado: só playwright-core (usa o Chrome instalado), tsx, vitest
npm run capturas                          # captura o jogo real em http://localhost:5173 (npm run dev na raiz)
npm run capturas -- cidade:3205309        # fundo específico de uma cidade (o servidor usa cidade-<ibge>.png se existir)
npm run placeholders                      # imagens provisórias marcadas (obra antes/depois; reserva se o jogo estiver fora)
npm run render -- exemplo:votacao out/x.mp4 [--escala 0.5]
npm run demo                              # out/demo/{casa,votacao,resultado}.mp4 + .jpg + pacote manual
npm run folhas                            # out/folhas/<template>.png (6 quadros por template, para aprovar storyboard)
npm run worker                            # SMN_API=http://localhost:8787 CONTEUDO_TOKEN_ESTUDIO=... (fila do servidor)
npm test && npm run typecheck
```

`CHROME_PATH` (padrão `C:/Program Files/Google/Chrome/Application/chrome.exe`), `FFMPEG`, `FFPROBE` podem ser trocados por env.

## Contrato do render (schema validado nos dois lados)

`content_id, template_id, template_version, event_ids, snapshot_id, scope, title, lines{gancho,evidencia,acao},
metrics[{chave, rotulo, valor, origem{tipo: consulta|evento|demo, ref, apurado_em}}], before_after_assets,
background_asset, permitted_public_profiles[{nome_publico, handle, avatar}], cta{texto, tipo, aceita_comentario_cidade},
election_status, data_timestamp, sponsorship_label, locale, demo, duration_s`.

Rejeita: campos `token/email/senha/voto/user_id/identity_id/...` em qualquer nível; valores com cara de email/token;
métrica sem origem; métrica `demo` em conteúdo real; placeholder em conteúdo real; `resultado` sem `election_status =
oficial`; texto de vitória/posse sem resultado oficial; inauguração sem `sponsorship_label`; convite sem vaga real;
CTA "comente cidade" em post que não aceita comentário de cidade; duração fora de 10–20 s; obra sem antes/depois datados.

## Determinismo

O renderer chama `__seek(i/30)` para cada quadro; os templates não usam relógio, rAF nem CSS animation/transition
(desligados no CSS). `Math.random` é semeado e `Date` congelado em `data_timestamp`. Captura por
`Page.captureScreenshot` (JPEG q92) → `ffmpeg -f image2pipe` → libx264, yuv420p (faixa TV), 30 fps CFR, `-an`, faststart.

## Recursos (orçamento do render)

- **1 render por worker**; o servidor entrega no máximo `RENDER_MAX_SIMULTANEOS` (padrão 1) jobs ao mesmo tempo
  (lease `RENDER_LEASE_MIN`=10 min; worker que some devolve o job à fila).
- Por render: 1 Chrome headless **sem GPU**, heap JS 512 MB (`--js-flags=--max-old-space-size=512`) e 1 ffmpeg
  `-threads 2`. Medido nesta máquina: 1080×1920 × 450 quadros ≈ 35 s; 270×480 ≈ 10–15 s.
- O worker não pega job com menos de `STUDIO_MEM_LIVRE_MIN_MB` (1200) livres ou carga > `STUDIO_CARGA_MAX` por núcleo
  (Linux/macOS); timeout `STUDIO_RENDER_TIMEOUT_S` (600). Cancelamento: o worker consulta o job a cada 3 s e aborta.
- Em produção: rodar o worker em processo/container próprio com limite de CPU/memória do orquestrador
  (ex.: `--cpus=2 --memory=1.5g`); nunca no mesmo processo do servidor do jogo.

## Pipeline no servidor (resumo; código em `server/src/modulos/conteudo/`)

domain_event → `content_candidates` → `content_snapshots` (fatos reconciliados, `fontes` re-executáveis) →
`render_jobs` (cache por snapshot + template + runtime) → worker do estúdio → `publication_jobs`
(draft → rendering → review → approved → scheduled → publishing → published | exported_manual; failed/cancelled/
needs_correction) + `editorial_calendar` (teto diário por slot único) + `content_funnel_events`.

Eventos consumidos (payload mínimo): `conteudo.fato` {tipo, escopo, metricas?, election_status?, valido_ate?,
perfis_user_ids?, patrocinio_label?, campanha?, demo?}, `cidade.marco` {ibge, nome, uf, marco}, `rua.convite_aberto`
{street_id, nome, ibge, uf}, `rua.obra_inaugurada` {obra_id, street_id, nome, casas_antes, casas_depois, antes_depois},
`eleicao.parcial` {eleicao_id, nome, ibge, uf, lider_mudou, diferenca_votos, diferenca_publicavel, candidaturas, prazo,
rodada} (no máximo virada/disputa), `eleicao.apurada` {eleicao_id, oficial: true, cargo, mandato_dias, vencedor_user_id}
(só oficial vira resultado; expira disputas/viradas pendentes), `estabelecimento.inaugurado` {aprovado: true, local,
horario, patrocinio_label}, `evento.agendado`, `privacidade.video_revogado` {user_id} e eventos de funil
(`casa.reservada`, `casa.reivindicada`, `avatar.salvo`, `convite.aceito`...). Os nomes reais emitidos pelas outras
frentes precisam ser casados com esta lista na integração.

Publicação oficial (Reels via Graph API: container → `status_code` → `media_publish`) só liga com
`IG_ADAPTADOR=oficial` + `KILL_PUBLICACAO=0` + `PUBLICACAO_OFICIAL=sim` + `CONTEUDO_URL_MIDIA` (URL pública HTTPS do MP4)
+ conexão ativa em `instagram_connections`. Timeout após `media_publish` → o retry reconcilia pelo status do container
(PUBLISHED → busca a mídia; FINISHED → publica; ERROR/EXPIRED → novo container) antes de repetir.

## Pendências

- Capturas atuais vêm do pacote **DEMO** do jogo (`public/dados/mundo.json`, moradores fictícios; o próprio jogo mostra o
  aviso "dados de demonstração"). Recapturar quando o mundo for gerado do banco; capturar `cidade:<ibge>` das cidades pautadas.
- Antes/depois de obra usa placeholder até existir captura por snapshot de rua (precisa de câmera por rua no jogo).
- Storyboards: aprovação do operador pendente (nenhum template habilitado para autopublish).
- Publicação oficial: depende de conta profissional, app Meta, permissões `instagram_business_basic` +
  `instagram_business_content_publish` (Instagram Login) e hospedagem pública do MP4 — **blocked-external**.
- Fontes vêm do Google Fonts em tempo de render (precisa de rede; sem rede cai para fonte do sistema e o render avisa).
