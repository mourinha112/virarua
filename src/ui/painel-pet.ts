/* Painel "meu pet": adotar gato ou cachorro quando os pontos chegam na meta (o servidor confere).
   Prévia 3D girando com o mesmo modelo do mapa; o pet aparece na frente da casa para todo mundo. */
import * as T from 'three';
import { el, botao, toast } from './dom';
import { petsApi, type Especie, type PetUI } from '../api/cliente';
import { retencaoApi } from '../api/crescimento';
import { criarPet } from '../mundo/pets3d';

const NOME_COR: Record<string, string> = { laranja: 'laranja', cinza: 'cinza', preto: 'preto', branco: 'branco', siames: 'siamês', caramelo: 'caramelo', marrom: 'marrom', malhado: 'malhado' };

function previa(cv: HTMLCanvasElement) {
  const r = new T.WebGLRenderer({ canvas: cv, antialias: true, alpha: true });
  r.setPixelRatio(Math.min(2, devicePixelRatio)); r.setSize(cv.clientWidth || 240, cv.clientHeight || 170, false);
  const cena = new T.Scene(), cam = new T.PerspectiveCamera(35, (cv.clientWidth || 240) / (cv.clientHeight || 170), 0.1, 50);
  cam.position.set(0, 1.5, 3.4); cam.lookAt(0, 0.55, 0);
  cena.add(new T.HemisphereLight('#ffffff', '#8fc468', 1.6)); const sol = new T.DirectionalLight('#ffffff', 1.4); sol.position.set(2, 4, 3); cena.add(sol);
  const chao = new T.Mesh(new T.CircleGeometry(1.1, 32), new T.MeshStandardMaterial({ color: '#97cc72' })); chao.rotation.x = -Math.PI / 2; cena.add(chao);
  let pet: T.Group | null = null;
  const t0 = performance.now();
  const loop = () => {
    if (!cv.isConnected) { r.dispose(); return; }
    const t = (performance.now() - t0) / 1000;
    if (pet) { pet.rotation.y = t * 0.7; const u = pet.userData; u.rabo.rotation.z = Math.sin(t * (u.gato ? 2.2 : 9)) * (u.gato ? 0.35 : 0.55); u.cab.rotation.y = Math.sin(t * 0.8) * 0.3; }
    r.render(cena, cam); requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return (especie: string, cor: string) => { if (pet) cena.remove(pet); pet = criarPet(especie, cor); cena.add(pet); };
}

const HUMOR: Record<string, [string, string]> = { feliz: ['😄', 'feliz e de barriga cheia'], fome: ['🥺', 'com fome: faz um tempão que não come'], triste: ['😢', 'triste: sentiu sua falta']};
/** comida 1x por dia: +5 XP e o pet volta a abanar o rabo no mapa */
function cartaoComida(pet: PetUI) {
  const b = el('div', 'cartao-b pet-comida'), h = pet.humor || 'feliz';
  const [ic, txt] = HUMOR[h];
  b.append(el('div', 'pet-humor', ic), el('h2', '', `${pet.nome} está ${txt}`));
  const bt = botao('btn prim bloco', pet.comeuHoje ? '✅ já comeu hoje · volta amanhã' : '🍖 dar comida · +5 XP', async () => {
    bt.disabled = true; const x = await retencaoApi.alimentar();
    if (!x.ok) { toast(x.erro, 3500); return; }
    b.querySelector('.pet-humor')!.textContent = '😄'; b.querySelector('h2')!.textContent = `${pet.nome} comeu e ficou feliz!`; bt.textContent = '✅ já comeu hoje · volta amanhã';
    toast(`🍖 ${pet.nome} adorou! +${x.xp} XP`); (window as any).__pets3d?.recarregar(); (window as any).__atualizarPerfil?.();
  });
  (bt as HTMLButtonElement).disabled = !!pet.comeuHoje;
  b.append(bt, el('p', 'nota', 'dê comida todo dia: se passar 1 dia ele fica com fome, 2 dias fica triste no mapa (todo mundo vê).'));
  return b;
}

export async function montarPainelPet(c: HTMLElement, abrir: (id: string, o?: any) => void) {
  const st = el('p', 'nota', 'carregando…'); c.append(st);
  const r = await petsApi.eu(); st.remove();
  if (!r.ok) {
    const b = el('div', 'cartao-b'); b.append(el('h2', '', 'meu pet'), el('p', 'nota', 'confirme a sua casa para adotar um pet (link do direct ou código de verificação).'), botao('btn prim bloco', 'confirmar minha casa', () => abrir('reivindicar')));
    c.append(b); return;
  }
  let especie: Especie = r.pet?.especie || 'cachorro', cor = r.pet?.cor || r.cores[especie][0];
  const box = el('div', 'cartao-b am');
  box.append(el('h2', '', r.pet ? `${r.pet.nome}, seu ${r.pet.especie}` : 'adote um pet'), el('p', 'nota', 'ele fica na frente da sua casa no mapa e todo mundo vê.'));
  const cv = el('canvas', 'pet-cv'); box.append(cv); c.append(box);
  const mostrar = previa(cv); mostrar(especie, cor);
  if (r.pet) c.append(cartaoComida(r.pet));

  if (!r.liberado) {
    const m = el('div', 'cartao-b');
    const pct = Math.min(100, Math.round((100 * r.pontos) / r.meta));
    m.append(el('h2', '', `🔒 libera com ${r.meta} pontos`), el('p', '', `você tem ${r.pontos} · faltam ${Math.max(0, r.meta - r.pontos)}`));
    const br = el('div', 'barra'); const i = el('i'); i.style.width = pct + '%'; br.append(i); m.append(br);
    const ul = el('ul'); for (const t of ['faça as missões do dia (até +30 por dia)', 'vá trabalhar (+10 por dia)', 'ajude a obra da sua rua']) ul.append(el('li', '', t)); m.append(ul);
    const tr = el('div', 'hub-bts'); tr.append(botao('btn', '🐶 ver cachorro', () => mostrar('cachorro', 'caramelo')), botao('btn', '🐱 ver gato', () => mostrar('gato', 'laranja')));
    m.append(tr, botao('btn prim bloco', 'fazer missões agora', () => abrir('missoes')));
    c.append(m); return;
  }

  const f = el('div', 'cartao-b');
  const seg = el('div', 'seg');
  const cores = el('div', 'tipos'); cores.setAttribute('role', 'radiogroup'); cores.setAttribute('aria-label', 'cor do pet');
  const pintarCores = () => {
    cores.innerHTML = '';
    for (const k of r.cores[especie]) { const b = botao(k === cor ? 'on' : '', NOME_COR[k] || k, () => { cor = k; pintarCores(); mostrar(especie, cor); }); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === cor)); cores.append(b); }
  };
  const bt: Record<Especie, HTMLButtonElement> = {
    cachorro: botao(especie === 'cachorro' ? 'on' : '', '🐶 cachorro', () => trocar('cachorro')),
    gato: botao(especie === 'gato' ? 'on' : '', '🐱 gato', () => trocar('gato')),
  };
  function trocar(e: Especie) { especie = e; if (!r.ok || !r.cores[e].includes(cor)) cor = r.ok ? r.cores[e][0] : cor; bt.cachorro.classList.toggle('on', e === 'cachorro'); bt.gato.classList.toggle('on', e === 'gato'); pintarCores(); mostrar(especie, cor); }
  seg.append(bt.cachorro, bt.gato); pintarCores();
  const fn = el('div', 'form-campo'); const lb = el('label', '', 'nome do pet'); const inp = el('input'); inp.maxLength = 20; inp.placeholder = 'ex.: Paçoca'; inp.id = 'pet-nome'; lb.htmlFor = inp.id; inp.value = r.pet?.nome || ''; fn.append(lb, inp);
  const msg = el('p', 'msg'); msg.setAttribute('aria-live', 'polite');
  const ok = botao('btn prim bloco', r.pet ? 'salvar meu pet' : 'adotar 🐾', async () => {
    ok.disabled = true; const x = await petsApi.adotar({ especie, cor, nome: inp.value }); ok.disabled = false;
    if (!x.ok) { msg.className = 'msg erro'; msg.textContent = x.erro; return; }
    msg.className = 'msg ok'; msg.textContent = `${x.pet.nome} já está na frente da sua casa!`; toast(`🐾 ${x.pet.nome} chegou na sua casa`);
    (window as any).__pets3d?.recarregar();
  });
  const fe = el('div', 'form-campo'); fe.append(el('label', '', 'bicho'), seg);
  const fc = el('div', 'form-campo'); fc.append(el('label', '', 'cor'), cores);
  f.append(fe, fc, fn, ok, msg);
  c.append(f);
}
