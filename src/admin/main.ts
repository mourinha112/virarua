/* Entrada do painel administrativo (admin.html). Mostra só as áreas que o papel do usuário acessa; o servidor
   revalida tudo. Produção: painel atrás de passkey/2FA (ver server/src/modulos/admin/auth.ts). */
import { $, el, botao } from '../ui/dom';
import { aquecer, get } from './api';
import { AREAS } from './areas';
import './admin.css';

async function iniciar() {
  await aquecer();
  const main = $('adm-main'), nav = $('adm-nav');
  const eu = await get<{ usuario: { nome: string }; papeis: string[]; areas: string[]; sessaoMaxMin: number; ambiente: string }>('/eu');
  if (!eu.ok) {
    main.innerHTML = '';
    const b = el('section', 'cartao-b');
    b.append(el('h2', '', eu.status === 401 ? 'Entre na sua conta' : 'Sem acesso ao painel'));
    b.append(el('p', '', eu.erro));
    b.append(el('p', 'nota', `O painel exige um papel administrativo (operador de integração, moderador, editor de conteúdo ou administrador técnico) e sessão recente. Papéis são concedidos pela CLI auditada (server/src/modulos/admin/cli.ts), nunca pelo painel.`));
    main.append(b); return;
  }
  $('adm-quem').textContent = `${eu.usuario.nome} · ${eu.papeis.join(', ')}${eu.ambiente !== 'producao' ? ' · ' + eu.ambiente : ''}`;
  let atual = '';
  const abrir = async (id: string) => {
    atual = id; nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.area === id));
    try { location.hash = id; } catch { /* ok */ }
    main.innerHTML = ''; main.append(el('p', 'nota', 'carregando…'));
    await AREAS[id].f(main); if (atual === id) main.focus();
  };
  for (const a of eu.areas) { if (!AREAS[a]) continue; const b = botao('tab-btn btn mini', AREAS[a].rot, () => void abrir(a)); b.dataset.area = a; nav.append(b); }
  const ini = location.hash.slice(1); void abrir(eu.areas.includes(ini) ? ini : eu.areas[0]);
}
void iniciar();
