# OPERATIONS — Seu Mundo Novo

## Processos
| Processo | Comando | Função |
|---|---|---|
| API + worker | `npm run server:start` | HTTP (Hono) e worker da fila (`processing_jobs`) + outbox (`domain_events`) |
| Front | `npm run build` → servir `dist/` | jogo (`index.html`), reivindicação (`reivindicar.html`), admin (`admin.html`) |
| Estúdio | `cd video-studio && npm run worker` | consome render jobs via `/interno/conteudo/*` (Bearer `CONTEUDO_TOKEN_ESTUDIO`) |
| Banco local | `npm run db:local` | Postgres do projeto em 127.0.0.1:54329 |

## Jobs recorrentes (fila durável)
Se reagendam sozinhos ao terminar; o primeiro é enfileirado na subida do servidor. **Pendência:** em produção, um agendador externo (cron chamando um endpoint interno ou o próprio worker) deve garantir que existam, caso um job morra.
- `mundo.expirar_reservas` (1 h) · `eleicoes.ciclo` (5 min) · `eventos.relogio` (1 min) · `competicao.abrir/placar/apurar` · `social.expirar_presencas` · `estabelecimentos.agregar_metricas` (diário) · `conteudo.selecionar`.

## Alertas a configurar
- `processing_jobs` com `estado = 'morto'` > 0.
- `webhook_events` sem novos registros por mais de 6 h com campanha ativa.
- `instagram_connections.token_expira_em` < 7 dias ou `status <> 'ativa'`.
- `onboarding` em `delivery_failed` ou `needs_review` acumulando.
- `render_jobs` falhando seguidamente; uso de CPU/memória do estúdio.

## Procedimentos
**Reprocessar job morto:** painel admin → Fila → "reprocessar" (motivo obrigatório, auditado). Equivale a `reprocessar(id)` em `server/src/jobs/fila.ts`.

**Dead-letter de webhook:** eventos ficam em `webhook_events` (payload, estado, erro). Corrigir a causa e reenfileirar o job `ig.comentario` pelo painel; a deduplicação por `comment_id:campo` impede casa duplicada.

**Token do Instagram expirado:** o adaptador oficial passa a falhar o envio → `delivery_failed`. Renovar o token no fluxo oficial da Meta, gravar com `salvarConexao()` (fica cifrado). Enquanto isso: pausar mídias de campanha no painel (posts que prometem criação imediata) e manter o jogo no ar.

**Webhook fora do ar:** a Meta reenvia por tempo limitado; não prometer replay além do que o provedor oferece. Reconciliação só por endpoints oficiais e paginados.

**Recuperação de apuração:** a apuração é idempotente (`eleicoes.apurar`); repetir o job não cria segundo mandato (índice único em `office_terms`). Correção pós-resultado só por `POST /api/eleicoes/admin/:id/correcao` (motivo + auditoria + evento público de correção).

**Kill switches:** `KILL_EVENTOS`, `KILL_RENDER`, `KILL_PUBLICACAO` (env) ou flags no painel. Desligar eventos não afeta missões, votos nem o mapa.

## Migrações, backup e rollback
1. Backup antes de migrar: `pg_dump -Fc "$DATABASE_URL" > backup-$(date +%F).dump`.
2. Aplicar: `npm run db:migrar`. Cada migração roda em transação; falha = rollback daquela migração.
3. Reverter a última: `npm run db:reverter` (usa `NNN_*.down.sql`). Todas as migrações têm down testado (`base.test.ts` desce e sobe tudo).
4. Restaurar: `pg_restore -c -d "$DATABASE_URL" backup.dump`.
**Produção: migração real só pelo operador, após revisão.**

## Testes
`npm test` (banco `smn_test`; os arquivos rodam em sequência porque compartilham o banco) · `npm run typecheck` · `cd video-studio && npm test`.
