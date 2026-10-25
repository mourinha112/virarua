/* Página de reivindicação (reivindicar.html). Sem trackers, sem terceiros.
   - Com ?t= (link da private reply): lê o token, REMOVE da URL na hora (history.replaceState), faz GET só para mostrar
     os dados (o GET não consome) e só o botão "confirmar" faz o POST que consome o link.
   - Sem token: desafio por código, vinculado a este navegador (cookie HttpOnly smn_pend). Digitar @ nunca autentica. */
import { el, botao } from './dom';

const params = new URLSearchParams(location.search);
const token = params.get('t') || '';
if (location.search || location.hash) history.replaceState(null, '', location.pathname);   // o token sai da barra/histórico

const raiz = document.getElementById('conteudo')!;
type J = Record<string, any>;

function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function api(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<{ status: number; j: J }> {
  try {
    const r = await fetch('/api' + caminho, {
      method: metodo, credentials: 'same-origin', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { 'content-type': 'application/json', 'x-csrf': csrf() },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    let j: J = {}; try { j = await r.json(); } catch { /* sem corpo */ }
    return { status: r.status, j };
  } catch { return { status: 0, j: { ok: false, erro: 'servidor do jogo fora do ar. Tente de novo em instantes.' } }; }
}

function cartao(titulo: string, ...filhos: (Node | string)[]) {
  const c = el('div', 'cartao-b'); c.append(el('h2', '', titulo), ...filhos); return c;
}
function trocar(...n: Node[]) { raiz.replaceChildren(...n); }
function linha(rotulo: string, valor: string) { const l = el('div', 'linha'); l.append(el('span', '', rotulo), el('b', '', valor)); return l; }
function msg() { return el('p', 'msg'); }
function erro(m: HTMLElement, t: string) { m.className = 'msg erro'; m.textContent = t; }

/** campos de confirmação (nome público + aceite). Devolve leitor dos valores. */
function camposConfirmacao(box: HTMLElement) {
  const campo = el('div', 'form-campo');
  const lab = el('label', '', 'nome público no jogo'); lab.htmlFor = 'nome';
  const dica = el('small', '', '2 a 30 caracteres. Aparece na sua casa (você pode ocultar o @ depois).');
  const inp = el('input'); inp.id = 'nome'; inp.maxLength = 30; inp.setAttribute('autocomplete', 'nickname'); inp.required = true;
  campo.append(lab, dica, inp);
  const ac = el('label', 'aceite'); const cb = el('input'); cb.type = 'checkbox'; cb.id = 'aceite';
  const txt = el('span'); txt.append('Li e aceito as regras do jogo e a ', Object.assign(el('a', '', 'política de privacidade'), { href: '/privacidade.html', target: '_blank', rel: 'noopener noreferrer' }), '.');
  ac.append(cb, txt);
  box.append(campo, ac);
  return () => ({ nome_publico: inp.value.trim(), aceite_regras: cb.checked });
}

function sucesso(cidade?: string | null) {
  trocar(cartao('a casa é sua!', el('p', '', `Pronto${cidade ? `: sua casa em ${cidade} está confirmada` : ''}. Agora você pode personalizar o avatar e a casa.`),
    Object.assign(el('a', 'btn prim bloco', 'abrir o mapa'), { href: '/' })));
}

// ---------- fluxo 1: link de uso único ----------
async function fluxoLink(t: string) {
  const { status, j } = await api('GET', '/reivindicacao/link?t=' + encodeURIComponent(t));
  if (status !== 200 || !j.ok) {
    const box = cartao('link indisponível', el('p', '', j.erro || 'Este link não vale mais.'));
    box.append(botao('btn prim bloco', 'confirmar com código de verificação', () => fluxoDesafio()));
    trocar(box); return;
  }
  const box = cartao('confirmar a sua casa', el('p', '', 'Esta casa foi reservada para a conta que comentou a cidade no perfil oficial. Confirme para ficar com ela.'));
  const dados = el('div', 'bloco');
  dados.append(linha('cidade', `${j.cidade} - ${j.uf}`));
  if (j.rua) dados.append(linha('rua', j.rua));
  if (j.lote !== null && j.lote !== undefined) dados.append(linha('lote', '#' + (Number(j.lote) + 1)));
  if (j.usuario_instagram) dados.append(linha('Instagram', '@' + j.usuario_instagram));
  box.append(dados);
  const ler = camposConfirmacao(box);
  const m = msg();
  const b = botao('btn prim bloco', 'confirmar e entrar', async () => {
    const v = ler();
    if (!v.aceite_regras) return erro(m, 'marque o aceite das regras para continuar.');
    if (v.nome_publico.length < 2) return erro(m, 'escolha um nome público com pelo menos 2 caracteres.');
    b.disabled = true; m.className = 'msg'; m.textContent = 'confirmando…';
    const r = await api('POST', '/reivindicacao/confirmar', { t, ...v });
    if (r.status === 200 && r.j.ok) return sucesso(`${j.cidade} - ${j.uf}`);
    b.disabled = false; erro(m, r.j.erro || 'não deu para confirmar agora.');
  });
  const acoes = el('div', 'acoes'); acoes.append(b, m); box.append(acoes);
  box.append(el('p', 'nota', `O link vale ${j.validadeMin || 30} min e só funciona uma vez. Não compartilhe.`));
  trocar(box);
}

// ---------- fluxo 2: desafio por código ----------
async function fluxoDesafio() {
  await api('GET', '/sessao');                       // garante o cookie de CSRF
  const box = cartao('confirmar com código', el('p', '', 'Não recebeu o link no direct? Sem problema: gere um código aqui e comente ele em qualquer post do @viraruajogo, pela SUA conta. Assim a gente sabe que é você.'));
  const campo = el('div', 'form-campo');
  const lab = el('label', '', 'seu @ (opcional, só para lembrar)'); lab.htmlFor = 'handle';
  const inp = el('input'); inp.id = 'handle'; inp.maxLength = 31; inp.autocapitalize = 'none'; inp.spellcheck = false;
  campo.append(lab, inp); box.append(campo);
  const m = msg(); const acoes = el('div', 'acoes');
  const gerar = botao('btn prim bloco', 'gerar código', async () => {
    gerar.disabled = true;
    const r = await api('POST', '/reivindicacao/desafio', { handle: inp.value });
    gerar.disabled = false;
    if (!r.j.ok) return erro(m, r.j.erro || 'não deu para gerar o código.');
    mostrarCodigo(r.j.codigo, r.j.validadeMin);
  });
  acoes.append(gerar, m); box.append(acoes);
  trocar(box);
}

function mostrarCodigo(codigo: string, validadeMin: number) {
  const box = cartao('publique este código');
  box.append(el('p', '', 'Copie o código e comente ele em qualquer post do @viraruajogo, pela SUA conta do Instagram. Esta página confere sozinha:'));
  box.append(el('div', 'codigo', codigo));
  box.append(Object.assign(el('a', 'btn prim bloco', 'abrir o @viraruajogo'), { href: 'https://www.instagram.com/viraruajogo/', target: '_blank', rel: 'noopener noreferrer' }));
  box.append(el('p', 'nota', `Vale ${Math.round(validadeMin)} min e só conclui NESTE navegador. Se outra pessoa copiar o código, não ganha acesso à sua casa.`));
  const m = msg(); const acoes = el('div', 'acoes');
  const conferir = botao('btn prim bloco', 'já comentei, conferir', async () => {
    conferir.disabled = true;
    const r = await api('POST', '/reivindicacao/desafio/status', {});
    conferir.disabled = false;
    if (!r.j.ok) return erro(m, r.j.erro || 'não deu para conferir agora.');
    if (r.j.estado === 'verificado') return confirmarDesafio(r.j);
    if (r.j.estado === 'aguardando') { m.className = 'msg'; m.textContent = 'ainda não chegou. O Instagram pode levar alguns minutos; tente de novo.'; return; }
    erro(m, 'o código expirou. Gere outro.');
  });
  acoes.append(conferir, botao('btn bloco', 'gerar outro código', () => fluxoDesafio()), m);
  box.append(acoes); trocar(box);
  m.className = 'msg'; m.textContent = 'esperando o seu comentário…';
  const auto = setInterval(async () => {
    if (!box.isConnected) return clearInterval(auto);
    const r = await api('POST', '/reivindicacao/desafio/status', {});
    if (!box.isConnected) return clearInterval(auto);
    if (r.j.ok && r.j.estado === 'verificado') { clearInterval(auto); confirmarDesafio(r.j); }
    else if (r.j.ok && r.j.estado !== 'aguardando') { clearInterval(auto); erro(m, 'o código expirou. Gere outro.'); }
  }, 5000);
}

function confirmarDesafio(j: J) {
  const box = cartao('é você?');
  const dados = el('div', 'bloco');
  if (j.usuario_instagram) dados.append(linha('Instagram', '@' + j.usuario_instagram));
  if (j.cidade) dados.append(linha('cidade', `${j.cidade} - ${j.uf}`));
  if (j.rua) dados.append(linha('rua', j.rua));
  if (!j.cidade) dados.append(el('p', 'nota', 'Esta conta ainda não tem casa: comente sua cidade e UF em qualquer post do @viraruajogo.'));
  box.append(el('p', '', 'O código foi publicado por esta conta:'), dados);
  const ler = camposConfirmacao(box);
  const m = msg(); const acoes = el('div', 'acoes');
  const b = botao('btn prim bloco', 'confirmar e entrar', async () => {
    const v = ler();
    if (!v.aceite_regras) return erro(m, 'marque o aceite das regras para continuar.');
    if (v.nome_publico.length < 2) return erro(m, 'escolha um nome público com pelo menos 2 caracteres.');
    b.disabled = true;
    const r = await api('POST', '/reivindicacao/desafio/status', v);
    if (r.j.ok && r.j.estado === 'concluido') return sucesso(j.cidade ? `${j.cidade} - ${j.uf}` : null);
    b.disabled = false; erro(m, r.j.erro || (r.j.estado === 'expirado' ? 'o código expirou. Gere outro.' : 'não deu para confirmar agora.'));
  });
  acoes.append(b, m); box.append(acoes); trocar(box);
}

if (token) fluxoLink(token); else fluxoDesafio();
