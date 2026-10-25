/* Registro central dos módulos. Cada módulo expõe registrar(app) em rotas.ts (rotas + jobs + ouvintes de eventos). */
import type { App } from '../http/app';
import * as identidade from './identidade/rotas';
import * as instagram from './instagram/rotas';
import * as mundo from './mundo/rotas';
import * as avatares from './avatares/rotas';
import * as social from './social/rotas';
import * as eleicoes from './eleicoes/rotas';
import * as recompensas from './recompensas/rotas';
import * as eventos from './eventos/rotas';
import * as estabelecimentos from './estabelecimentos/rotas';
import * as conteudo from './conteudo/rotas';
import * as admin from './admin/rotas';
import { registrarIntegracao } from './integracao';
import { registrarDev } from './dev';
import { registrarRuaViva } from './ruaviva';
import { registrarTrabalho } from './trabalho';
import { registrarNotificacoes } from './notificacoes';
import { registrarPacote } from './mundo/pacote';
import { registrarPonteManychat } from './instagram/ponte-manychat';
import { registrarPets } from './pets';
import { registrarMetricas } from './metricas';

export const MODULOS = { identidade, instagram, mundo, avatares, social, eleicoes, recompensas, eventos, estabelecimentos, conteudo, admin };
export function registrarModulos(app: App) { for (const m of Object.values(MODULOS)) m.registrar(app); registrarIntegracao(); registrarDev(app); registrarRuaViva(app); registrarTrabalho(app); registrarNotificacoes(app); registrarPacote(app); registrarPonteManychat(app); registrarPets(app); registrarMetricas(app); }
