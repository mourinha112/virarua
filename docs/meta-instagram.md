# Integração Meta / Instagram — Fase 1

Consulta da documentação oficial: **24/10/2026**, por WebFetch nas páginas de developers.facebook.com listadas abaixo.
Nada aqui foi verificado ao vivo: não há app Meta, conta profissional nem token do operador nesta sessão.

## Status

| Item | Status |
|---|---|
| Webhook GET (handshake) e POST (assinatura sobre o corpo bruto, limite de tamanho, conta, dedupe, fila) | tested-local |
| Processamento de comentário → casa reservada (idempotente, transação) | tested-local |
| Adaptador `dev` (dry-run: grava `outbound_messages` com modo `dry_run` e nunca chama a rede) | tested-local |
| Adaptador `oficial` (private reply via Graph API) | implemented, testado só com `fetch` simulado. Ao vivo: **blocked-external** |
| Assinatura do webhook, entrega real e permissões | **blocked-external** (exige app Live, App Review/Advanced Access e a conta oficial conectada) |

## Produto e API escolhidos

**Instagram API with Instagram Login** (na documentação também aparece como "Business Login for Instagram").
- Feita para contas profissionais ("businesses and creators"). Não precisa de Página do Facebook vinculada.
- Host: **`graph.instagram.com`**. O host `graph.facebook.com` é de outro fluxo (Facebook Login for Business), e os dois não se misturam: ids, tokens e endpoints são diferentes.
- Token: Instagram User access token. O de curta duração vale 1 hora e é trocado por um de longa duração, que vale 60 dias e pode ser renovado antes de vencer. O token fica **cifrado** (AES-256-GCM) em `instagram_connections.token_cifrado`. A variável `IG_TOKEN` serve só para o bootstrap e é gravada cifrada no primeiro uso.
- Versão: os exemplos de webhook/assinatura da documentação usam **v26.0**. O padrão do núcleo (`config.ts`) é `v23.0`. Recomendo configurar `IG_GRAPH_VERSAO=v26.0` no ambiente (não editei o `config.ts` porque ele é do núcleo).
- Os jogadores são **comentaristas** com contas pessoais. Não existe login OAuth do jogador por esse fluxo, e nenhum foi inventado aqui.

## Permissões encontradas (Instagram Login)

| Uso | Permissões |
|---|---|
| Webhook `comments` / `live_comments` | `instagram_business_basic`, `instagram_business_manage_comments` |
| Menções | vêm dentro da notificação `comments` (não há campo `mentions` separado nesse fluxo) |
| Webhook `messages` (não usado na Fase 1) | `instagram_business_basic`, `instagram_business_manage_messages` |
| Private Reply (`POST /<IG_ID>/messages` com `recipient.comment_id`) | `instagram_business_basic`, `instagram_business_manage_comments` (coluna Instagram Login da página de Private Replies) |

Requisitos da página de setup de webhooks:
- app **publicado/Live**;
- **Advanced Access** para `comments` e `live_comments`, o que exige App Review e Business Verification;
- a conta dona da mídia precisa ser **pública**.

Para assinar os eventos: `POST https://graph.instagram.com/v26.0/<IG_ID>/subscribed_apps?subscribed_fields=comments&access_token=<token>`, com resposta `{"success": true}`. A documentação aceita `/me` como identificador.

## Webhook

- **Verificação**: GET com `hub.mode=subscribe`, `hub.verify_token` e `hub.challenge`. Se o token bater, a resposta é o `hub.challenge`. Implementado em `GET /api/webhooks/instagram`: compara em tempo constante e responde 403 em qualquer outro caso.
- **Assinatura**: cabeçalho `X-Hub-Signature-256: sha256=<HMAC-SHA256(App Secret, payload)>`. Calculamos sobre os **bytes brutos** do corpo, antes de qualquer parse, com `assinaturaValida()`. Assinatura inválida ou ausente → 401, e nada é gravado.
- **Resposta**: 200 rápido. O processamento acontece na fila (`processing_jobs`, job `ig.comentario`).
- **Reentregas**: a Meta tenta de novo na hora e depois algumas vezes, com frequência decrescente, por até **36 horas**. Por isso o dedupe é durável: `webhook_events (provedor, chave = comment_id + ':' + campo)` e `instagram_comments.comment_id`.
- **Lotes**: até 1000 atualizações por entrega, e a documentação diz que o agrupamento "não é garantido". O tamanho é limitado por `IG_PAYLOAD_MAX` (256 KB por padrão; acima disso → 413).

### Formato do comentário

A documentação mostra **dois formatos** e os exemplos são inconsistentes entre si (um deles nem é JSON válido). O parser (`extrairComentarios`) aceita os dois:

```jsonc
// A) com "changes" (exemplo Unified/Facebook Login; é também o formato usual observado)
{ "object": "instagram", "entry": [{ "id": "<IG da conta profissional>", "time": 1729790000,
  "changes": [{ "field": "comments", "value": {
    "id": "<COMMENT_ID>",                      // em um exemplo aparece como "comment_id": aceitamos os dois
    "from": { "id": "<IGSID do autor>", "username": "<username>" },
    "text": "Duque de Caxias - RJ",
    "parent_id": "<se for resposta>",
    "media": { "id": "<MEDIA_ID>", "media_product_type": "FEED" } } }] }] }

// B) "Business Login for Instagram": field/value direto na entry, sem "changes"
{ "object": "instagram", "entry": [{ "id": "<IG>", "time": 1729790000, "field": "comments",
  "value": { "id": "...", "from": { "id": "...", "username": "..." }, "text": "...", "media": { "id": "...", "media_product_type": "..." } } }] }
```

Regras aplicadas:
- `entry.id` precisa ser igual a `IG_CONTA_ID`.
- Só entram os campos `comments` e `live_comments`.
- A mídia precisa estar em `enabled_media` com status `ativa`. Para criar casa, ela também precisa de `aceita_comentario_cidade`.
- O autor é sempre `from.id` (IGSID). O escopo da identidade é `entry.id`, porque a documentação define o IGSID como "específico da pessoa e da conta com que ela interage".
- O `@` citado no texto é descartado.
- Sem `from.id` → `needs_review`. Nada é resolvido por username.

## Private Replies

- `POST https://graph.instagram.com/<versão>/<IG_ID>/messages`
- Cabeçalho `Authorization: Bearer <token>`
- Corpo: `{"recipient":{"comment_id":"<COMMENT_ID>"},"message":{"text":"..."}}`
- Janela: **até 7 dias** após a criação do comentário. Em Live, só durante a transmissão.
- **Apenas uma mensagem** por comentário. Mensagens seguintes só depois que a pessoa responder, e dentro de 24 h dessa resposta.

Como isso está implementado:
- **Um `outbound_messages` por comentário** (`chave = ig_private_reply:<comment_id>`).
- O token do link é gerado no momento do envio. Só o sha256 vai para `identity_claims`. O texto guardado é redigido (`t=[redigido]`).
- Falha definitiva → `outbound_messages.estado = 'falhou'`, `onboarding.estado = 'delivery_failed'` com orientação para usar o código, e o link daquela tentativa é invalidado. **A casa não é desfeita nem duplicada.**
- Falha transitória (5xx, 429, timeout, rede) → a fila repete até 3 vezes, com backoff. Como a Meta aceita uma só mensagem por comentário, uma repetição depois de uma entrega que deu timeout volta com erro e não duplica a mensagem.
- Erro `190` (token inválido) → a conexão é marcada como `expirada`.
- Fora da janela de 7 dias → não envia e marca `delivery_failed`.
- Um **novo** comentário do mesmo autor, com a casa ainda reservada e sem link válido nem envio pendente, permite uma nova private reply. Uma nova casa não é criada.

## Não confirmado (verificar com o app real)

1. Se a private reply no Instagram Login exige também `instagram_business_manage_messages`. A tabela da página só lista `instagram_manage_messages` na coluna Unified Login.
2. Qual dos dois formatos de payload chega de fato, e se o id do comentário vem em `id` ou em `comment_id`.
3. A inconsistência sobre `entry.id`: alguns exemplos o chamam de id escopado.
4. Se o IGSID é estável entre apps diferentes. A página de overview é ambígua. Usamos o par (conta conectada, IGSID) como chave.
5. Se a página manda calcular a assinatura sobre o corpo bruto. Ela diz só "payload". Usamos os bytes brutos, que é o padrão da Meta.
6. A classificação dos códigos de erro da Graph API como transitórios (`4`, `17`, `32`, `613`, `2`, 5xx, 429).
7. Se comentários feitos pela própria conta chegam no webhook. Eles são ignorados pelo `from.id`.
8. Se a private reply funciona para respostas (`parent_id`). A documentação não restringe.
9. Se dá para reconciliar comentários perdidos com `GET /<MEDIA_ID>/comments`. Não foi implementado, e não prometemos replay.

## Guia do operador (ativação real, fora desta sessão)

1. Conta profissional oficial **pública**.
2. App Meta com o produto Instagram → "API setup with Instagram login". Configurar callback HTTPS `https://<domínio>/api/webhooks/instagram` e um verify token.
3. Variáveis: `IG_ADAPTADOR=oficial`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `IG_CONTA_ID` (o id IG da conta profissional), `IG_GRAPH_VERSAO=v26.0`, `SMN_CHAVE_CRIPTO` (32 bytes em hex), `SMN_URL_PUBLICA` (HTTPS).
4. Conectar a conta, obter o token de longa duração e gravá-lo cifrado (`salvarConexao()` ou `IG_TOKEN` só para o bootstrap).
5. Assinar `comments` (`subscribed_apps`). Pedir App Review/Advanced Access para `instagram_business_basic` e `instagram_business_manage_comments`.
6. Habilitar a mídia da campanha em `enabled_media`, com o texto de consentimento publicado ("Comente sua cidade e UF para criar sua casa virtual. Seu @ poderá aparecer no mundo…").
7. Testar em ambiente permitido: comentário com cidade, cidade ambígua, casa criada, private reply recebida, confirmação em `/reivindicar.html` e código de verificação.
8. Só então marcar como verified-live.

## Fontes (consultadas em 24/10/2026)

- Private Replies: https://developers.facebook.com/docs/instagram-platform/private-replies/
- Webhooks (visão geral): https://developers.facebook.com/docs/instagram-platform/webhooks/
- Webhooks, setup (verificação, assinatura, retries, requisitos, `subscribed_apps`): https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
- Webhooks, campos e permissões: https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
- Webhooks, exemplos de payload: https://developers.facebook.com/documentation/instagram-platform/webhooks/examples
- Instagram API with Instagram Login: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login
- Overview (IGSID, tokens, hosts, acesso, limites): https://developers.facebook.com/documentation/instagram-platform/overview
