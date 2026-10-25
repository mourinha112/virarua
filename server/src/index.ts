/* Servidor do jogo: HTTP + worker da fila. Em dev aplica migrações e semente na subida. */
import { serve } from '@hono/node-server';
import { config, validarConfigProducao } from './config';
import { criarApp } from './http/app';
import { migrar } from './db/migrar';
import { semear } from './db/semear';
import { iniciarWorker } from './jobs/fila';

const erros = validarConfigProducao();
if (erros.length) { console.error('configuração inválida para produção:\n- ' + erros.join('\n- ')); process.exit(1); }
if (config.ambiente === 'dev') { await migrar(); await semear(); }
const app = criarApp();
iniciarWorker();
serve({ fetch: app.fetch, port: config.porta }, (i) => console.log(`servidor do jogo em http://localhost:${i.port} (${config.ambiente})`));
