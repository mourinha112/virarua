/* Retenção na tela: baú diário (pop-up 1x por dia + atalho), pet com fome, chuva de baús das 20h (aviso antes,
   faixa durante e toque no baú), aviso ao vivo de campainha/curtida e comemoração quando a casa sobe de nível. */
import type { Ctx } from './app';
import { el, botao, toast, $, quandoLivre } from './dom';
import { api, petsApi } from '../api/cliente';
import { retencaoApi, type BauEstado } from '../api/crescimento';
import { aviso } from './novidades';
import { NIVEIS, nivelDe } from '../jogo/regras';
import { DETALHES_NIVEL } from '../mundo/niveis3d';
import './retencao.css';

const ler = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravar = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sem storage */ } };
const hojeBR = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

function modal(cls: string) {
  const fundo = el('div', 'pop-fundo'), cx = el('div', 'rt-caixa ' + cls); cx.setAttribute('role', 'dialog'); cx.setAttribute('aria-modal', 'true');
  const fechar = () => fundo.remove();
  fundo.onclick = (e) => { if (e.target === fundo) fechar(); };
  cx.append(botao('rt-x', '✕', fechar, 'fechar')); fundo.append(cx); document.body.append(fundo);
  return { cx, fechar };
}

/* ---------- baú diário ---------- */
function abrirBauPop(st: BauEstado, aoAbrir: () => void) {
  const { cx, fechar } = modal('rt-bau');
  cx.append(el('small', 'rt-tag', '🎁 baú diário'), el('h2', '', st.aberto ? 'volta amanhã!' : `dia ${st.proximo} de 7`));
  const dias = el('div', 'rt-dias');
  st.premios.forEach((x, i) => {
    const d = i + 1, feito = st.aberto ? d <= st.seq : d < st.proximo, hoje = !st.aberto && d === st.proximo;
    const b = el('div', 'rt-dia' + (feito ? ' ok' : '') + (hoje ? ' hoje' : '') + (d === 7 ? ' grande' : ''));
    b.append(el('small', '', 'dia ' + d), el('span', '', feito ? '✅' : d === 7 ? '👑' : '🎁'), el('b', '', '+' + x));
    dias.append(b);
  });
  cx.append(dias);
  if (st.perdeu && !st.aberto) cx.append(el('p', 'rt-aviso', 'você pulou um dia e a sequência voltou pro dia 1 😢 · volte todo dia!'));
  const res = el('div', 'rt-res');
  if (st.aberto) {
    res.append(el('p', '', `🔥 ${st.seq} ${st.seq === 1 ? 'dia seguido' : 'dias seguidos'} · amanhã o baú dá +${st.premios[st.seq % 7]} XP`));
    cx.append(res, botao('btn bloco', 'ok', fechar)); return;
  }
  const bau = botao('rt-bau-bt', '', () => void abrir(), 'abrir o baú'); bau.append(el('span', '', '🎁'));
  cx.append(bau, res);
  const bt = botao('btn prim bloco', `abrir baú · +${st.premios[st.proximo - 1]} XP`, () => void abrir());
  cx.append(bt, el('p', 'nota', 'abra todo dia: o 7º dia vale +50 XP. Se pular um dia, volta pro dia 1.'));
  let indo = false;
  async function abrir() {
    if (indo) return; indo = true; bau.classList.add('abrindo'); (bt as HTMLButtonElement).disabled = true;
    const r = await retencaoApi.abrirBau();
    await new Promise((ok) => setTimeout(ok, 700));
    if (!r.ok) { toast(r.erro, 3500); fechar(); return; }
    bau.classList.remove('abrindo'); bau.classList.add('aberto'); bau.querySelector('span')!.textContent = '✨';
    dias.children[r.seq - 1]?.classList.replace('hoje', 'ok'); (dias.children[r.seq - 1]?.querySelector('span') as HTMLElement).textContent = '✅';
    res.innerHTML = ''; res.append(el('div', 'rt-xp', `+${r.xp} XP`), el('p', '', `🔥 ${r.seq} ${r.seq === 1 ? 'dia seguido' : 'dias seguidos'} · amanhã: +${r.amanha} XP`));
    bt.textContent = 'bora jogar!'; (bt as HTMLButtonElement).disabled = false; bt.onclick = fechar;
    aoAbrir(); (window as any).__atualizarPerfil?.();
  }
}
async function bauDiario() {
  const r = await retencaoApi.bau(); if (!r.ok) return;
  const fab = el('button', 'rt-fab'); (fab as HTMLButtonElement).type = 'button'; fab.setAttribute('aria-label', 'baú diário');
  fab.append(el('span', '', '🎁'), el('b', '', 'baú'));
  const pinta = (st: BauEstado) => { fab.querySelector('i')?.remove(); if (!st.aberto) fab.append(el('i')); };
  pinta(r);
  fab.onclick = async () => { const s = await retencaoApi.bau(); if (s.ok) abrirBauPop(s, () => pinta({ ...s, aberto: true })); };
  $('atalhos').prepend(fab);
  if (!r.aberto && ler('smn_bau_pop') !== hojeBR()) { gravar('smn_bau_pop', hojeBR()); quandoLivre(() => abrirBauPop(r, () => pinta({ ...r, aberto: true }))); }
}

/* ---------- pet com fome ---------- */
async function petFome() {
  const r = await petsApi.eu(); if (!r.ok || !r.pet || r.pet.humor === 'feliz' || r.pet.comeuHoje) return;
  if (ler('smn_pet_pop') === hojeBR()) return; gravar('smn_pet_pop', hojeBR());
  const pet = r.pet;
  quandoLivre(() => {
    const { cx, fechar } = modal('rt-pet');
    cx.append(el('div', 'rt-pet-ic', pet.humor === 'triste' ? '😢' : '🥺'), el('h2', '', `${pet.nome} ${pet.humor === 'triste' ? 'sentiu sua falta' : 'está com fome'}!`),
      el('p', '', pet.humor === 'triste' ? `faz 2 dias que ${pet.nome} não come. Todo mundo vê ele cabisbaixo na frente da sua casa.` : `${pet.nome} está esperando na porta. Uma comidinha e ele volta a abanar o rabo.`));
    const bt = botao('btn prim bloco', '🍖 dar comida · +5 XP', async () => {
      (bt as HTMLButtonElement).disabled = true; const x = await retencaoApi.alimentar();
      if (!x.ok) { toast(x.erro, 3500); fechar(); return; }
      cx.querySelector('.rt-pet-ic')!.textContent = '😄'; cx.querySelector('h2')!.textContent = `${pet.nome} adorou! +${x.xp} XP`;
      bt.textContent = 'ver no mapa'; (bt as HTMLButtonElement).disabled = false; bt.onclick = () => { fechar(); (window as any).__irMinhaCasa?.(); };
      (window as any).__pets3d?.recarregar(); (window as any).__atualizarPerfil?.();
    });
    cx.append(bt, botao('btn bloco', 'depois', fechar));
  });
}

/* ---------- chuva de baús ---------- */
function chuva(ctx: Ctx) {
  const c3d = (window as any).__chuva3d;
  const chip = el('button', 'rt-chuva'); (chip as HTMLButtonElement).type = 'button'; chip.hidden = true;
  $('atalhos').prepend(chip);
  let ativaAntes = false, avisouAntes = '', pegos = 0, max = 5, fimEm = 0;
  const irCidade = () => { const f = (window as any).__irMinhaCasa; if (f) { ctx.fecharCartao(); f(); } else { const c = ctx.dados.ORDEM[0]; if (c) ctx.mostrarCidade(c); } };
  chip.onclick = irCidade;
  const pintaChip = () => {
    const min = Math.max(0, Math.ceil((fimEm - Date.now()) / 60_000));
    chip.textContent = `🌧️🎁 chuva · ${min}min · ${pegos}/${max}`;
  };
  async function checar() {
    const r = await retencaoApi.chuva(); if (!r.ok) return;
    pegos = r.pegos; max = r.max;
    c3d?.definir({ ativa: r.ativa, dia: r.dia, porCidade: r.porCidade, meus: r.meus });
    chip.hidden = !r.ativa;
    if (r.ativa) { fimEm = Date.now() + r.restaMin * 60_000; pintaChip(); }
    if (r.ativa && !ativaAntes) aviso('🎁 CHUVA DE BAÚS! toque nos baús dourados das cidades: +5 XP cada', ['ir pra minha cidade', irCidade], 12_000);
    if (!r.ativa && r.faltaMin <= 10 && avisouAntes !== r.dia) { avisouAntes = r.dia; aviso(`⏰ chuva de baús em ${r.faltaMin} min! às 20h na sua cidade`, undefined, 9000); }
    ativaAntes = r.ativa;
  }
  (window as any).__pegarBau = async (ibge: number, idx: number) => {
    const r = await retencaoApi.pegar(ibge, idx);
    if (!r.ok) {
      if (/entre/i.test(r.erro)) toast('entre na sua casa (minha casa) pra pegar os baús', 3500);
      else { toast(r.erro, 3500); if (/já pegou esse/.test(r.erro)) c3d?.pegou(ibge, idx); }
      return;
    }
    c3d?.pegou(ibge, idx); pegos = r.pegos; pintaChip();
    toast(r.pegos >= r.max ? `🎁 +${r.xp} XP · você pegou os ${r.max} baús de hoje!` : `🎁 +${r.xp} XP · ${r.pegos}/${r.max} baús`, 2600);
    (window as any).__atualizarPerfil?.();
  };
  void checar();
  setInterval(() => { if (!document.hidden) void checar(); }, 30_000);
  setInterval(() => { if (!chip.hidden) pintaChip(); }, 15_000);
}

/* ---------- campainha ao vivo ---------- */
function avisosVisita(ctx: Ctx) {
  let maior = -1;
  (window as any).__aoNotif = (r: { itens: { id: number; tipo: string; texto: string; acao: string | null; lida: boolean }[] }) => {
    const vis = r.itens.filter((n) => n.tipo === 'visita' && !n.lida);
    const visitar = (n: { acao: string | null }) => () => { if (n.acao?.startsWith('u:')) ctx.buscar('@' + n.acao.slice(2)); else ctx.paineis.abrir('notificacoes'); };
    if (maior < 0) {
      maior = Math.max(0, ...r.itens.map((n) => n.id));
      if (vis.length > 1) aviso(`🔔 ${vis.length} visitas na sua casa enquanto você estava fora!`, ['ver quem foi', () => ctx.paineis.abrir('notificacoes')], 10_000);
      else if (vis.length === 1) aviso(vis[0].texto, ['visitar de volta', visitar(vis[0])], 10_000);
      return;
    }
    const novas = vis.filter((n) => n.id > maior); maior = Math.max(maior, ...r.itens.map((n) => n.id));
    if (novas.length) aviso(novas[0].texto + (novas.length > 1 ? ` (+${novas.length - 1})` : ''), ['visitar de volta', visitar(novas[0])], 10_000);
  };
  (window as any).__pollNotif?.();
}

/* ---------- casa subiu de nível ---------- */
async function nivel() {
  const [eu, rec] = await Promise.all([api.eu(), api.recompensas().catch(() => null)]);
  if (!eu.ok || !eu.casa || !rec?.ok) return;
  const nv = nivelDe(rec.resumo.xp_total), k = 'smn_nivel_' + (eu.usuario?.id || 'eu'), antes = Number(ler(k) || 0);
  gravar(k, String(nv));
  if (!antes || nv <= antes) return;
  const novos = DETALHES_NIVEL.filter(([n]) => n > antes && n <= nv), prox = DETALHES_NIVEL.find(([n]) => n > nv);
  quandoLivre(() => {
    const { cx, fechar } = modal('rt-nivel');
    cx.append(el('div', 'rt-pet-ic', '🎉'), el('small', 'rt-tag', `nível ${nv}`), el('h2', '', `sua casa virou ${NIVEIS[nv - 1].nome}!`));
    for (const [, ic, t] of novos) cx.append(el('p', 'rt-novo', `${ic} ganhou ${t}`));
    if (prox) cx.append(el('p', 'nota', `próximo: ${prox[1]} ${prox[2]} no nível ${prox[0]}`));
    cx.append(botao('btn prim bloco', 'ver minha casa no mapa', () => { fechar(); (window as any).__irMinhaCasa?.(); }));
  });
}

export function iniciarRetencao(ctx: Ctx) {
  chuva(ctx);
  setTimeout(() => { void bauDiario(); void petFome(); void nivel(); avisosVisita(ctx); }, 2500);
  // ganhou XP em qualquer lugar (missão, baú, pet, chuva) → confere se a casa subiu de nível
  const orig = (window as any).__atualizarPerfil;
  if (orig) (window as any).__atualizarPerfil = () => { orig(); setTimeout(() => void nivel(), 600); };
}
