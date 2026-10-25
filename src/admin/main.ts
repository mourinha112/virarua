/* Entrada do painel administrativo (admin.html). Mostra só as áreas que o papel do usuário acessa; o servidor
   revalida tudo. Produção: painel atrás de passkey/2FA (ver server/src/modulos/admin/auth.ts). */
import { $, el, botao } from '../ui/dom';
import { aquecer, get, req } from './api';
import { AREAS } from './areas';
import './admin.css';

async function iniciar() {
  await aquecer();
  const main = $('adm-main'), nav = $('adm-nav');
  const eu = await get<{ usuario: { nome: string }; papeis: string[]; areas: string[]; sessaoMaxMin: number; ambiente: string }>('/eu');
  if (!eu.ok) {
    main.innerHTML = '';
    const b = el('section', 'cartao-b adm-login');
    b.append(el('h2', '', 'Entrar no painel'));
    if (eu.status !== 401) b.append(el('p', 'nota', eu.erro));
    const f = el('form') as HTMLFormElement;
    const campo = (rot: string, tipo: string, ac: string) => { const l = el('label', 'campo-adm'); const i = el('input') as HTMLInputElement; i.type = tipo; i.setAttribute('autocomplete', ac); i.required = true; l.append(el('span', '', rot), i); f.append(l); return i; };
    const login = campo('usuário', 'text', 'username'), senha = campo('senha', 'password', 'current-password');
    const msg = el('p', 'msg'); const bt = el('button', 'btn prim', 'entrar') as HTMLButtonElement; bt.type = 'submit'; f.append(bt, msg);
    f.onsubmit = async (e) => {
      e.preventDefault(); bt.disabled = true; msg.textContent = 'entrando…';
      const r = await req('POST', '/admin/login', { login: login.value, senha: senha.value });
      senha.value = ''; bt.disabled = false;
      if (r.ok) { location.reload(); return; }
      msg.className = 'msg erro'; msg.textContent = r.erro;
    };
    b.append(f); main.append(b); login.focus(); return;
  }
  const sair = botao('btn mini', 'sair', async () => { await req('POST', '/admin/sair', {}); location.reload(); });
  $('adm-quem').after(sair);
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
