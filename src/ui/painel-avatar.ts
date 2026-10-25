/* Editor de avatar (Fase 2): tons de pele, cabelos e cores, roupas e cores, acessórios e calçados, com prévia 3D
   baixo-poli própria (src/mundo/avatares3d.ts, mesmo estilo das casas) com idle e aceno. Respeita
   prefers-reduced-motion (prévia sem balanço; aceno vira pose). Sem WebGL: lista acessível das escolhas.
   O servidor valida tudo (catálogo + inventário); este painel só mostra o que a API devolve.

   COMO PLUGAR (outro dev, em src/ui/paineis.ts):
     import { montarPainelAvatar } from './painel-avatar';
     DEFS.avatar = { titulo: 'meu avatar', desenhar: (c) => montarPainelAvatar(c, { abrirReivindicar: () => abrir('reivindicar') }) };

   ASSINATURA
     montarPainelAvatar(corpo: HTMLElement, ctx?: PainelAvatarCtx): Promise<{ dispose(): void }>
       corpo  elemento vazio (o .painel-corpo); a prévia 3D se desliga sozinha quando o corpo sai do DOM
       ctx.abrirReivindicar()   opcional: botão mostrado enquanto a casa não foi reivindicada
       ctx.aoSalvar(config)     opcional: avisado depois de salvar (ex.: atualizar avatares no mapa)
     devolve dispose() para liberar o WebGL antes, se quiser */
import { el, botao, toast } from './dom';
import { social, type ConfigAvatar, type ItemCatalogo, type SlotAvatar } from '../api/social';
import { CORES, PADRAO, criarPreviaAvatar } from '../mundo/avatares3d';

export type PainelAvatarCtx = { abrirReivindicar?: () => void; aoSalvar?: (config: ConfigAvatar) => void };

const SECOES: { slot: SlotAvatar; titulo: string; cor: boolean }[] = [
  { slot: 'pele', titulo: 'tom de pele', cor: true },
  { slot: 'cabelo', titulo: 'cabelo', cor: false },
  { slot: 'cor_cabelo', titulo: 'cor do cabelo', cor: true },
  { slot: 'roupa', titulo: 'roupa', cor: false },
  { slot: 'cor_roupa', titulo: 'cor da roupa', cor: true },
  { slot: 'acessorio', titulo: 'acessório', cor: false },
  { slot: 'calcado', titulo: 'calçado', cor: false },
];

const CATALOGO_LOCAL: [string, string, string][] = [
  ['pele.1', 'pele', 'tom 1'], ['pele.2', 'pele', 'tom 2'], ['pele.3', 'pele', 'tom 3'], ['pele.4', 'pele', 'tom 4'], ['pele.5', 'pele', 'tom 5'], ['pele.6', 'pele', 'tom 6'],
  ['cabelo.curto', 'cabelo', 'curto'], ['cabelo.longo', 'cabelo', 'longo'], ['cabelo.cacheado', 'cabelo', 'cacheado'], ['cabelo.crespo', 'cabelo', 'crespo'], ['cabelo.raspado', 'cabelo', 'raspado'], ['cabelo.coque', 'cabelo', 'coque'], ['cabelo.trancas', 'cabelo', 'tranças'],
  ['cor_cabelo.preto', 'cor_cabelo', 'preto'], ['cor_cabelo.castanho', 'cor_cabelo', 'castanho'], ['cor_cabelo.loiro', 'cor_cabelo', 'loiro'], ['cor_cabelo.ruivo', 'cor_cabelo', 'ruivo'], ['cor_cabelo.colorido', 'cor_cabelo', 'colorido'],
  ['roupa.camiseta', 'roupa', 'camiseta'], ['roupa.moletom', 'roupa', 'moletom'], ['roupa.vestido', 'roupa', 'vestido'], ['roupa.camisa', 'roupa', 'camisa'], ['roupa.regata', 'roupa', 'regata'],
  ['cor_roupa.amarelo', 'cor_roupa', 'amarelo'], ['cor_roupa.azul', 'cor_roupa', 'azul'], ['cor_roupa.verde', 'cor_roupa', 'verde'], ['cor_roupa.vermelho', 'cor_roupa', 'vermelho'], ['cor_roupa.preto', 'cor_roupa', 'preto'], ['cor_roupa.branco', 'cor_roupa', 'branco'],
  ['acessorio.nenhum', 'acessorio', 'nenhum'], ['acessorio.bone', 'acessorio', 'boné'], ['acessorio.oculos', 'acessorio', 'óculos'], ['acessorio.fone', 'acessorio', 'fone'],
  ['calcado.tenis', 'calcado', 'tênis'], ['calcado.chinelo', 'calcado', 'chinelo'], ['calcado.bota', 'calcado', 'bota'],
];

function temWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

export async function montarPainelAvatar(corpo: HTMLElement, ctx: PainelAvatarCtx = {}): Promise<{ dispose(): void }> {
  const st = el('p', 'nota', 'carregando avatar…'); st.setAttribute('role', 'status'); corpo.append(st);
  let [eu, cat] = (await Promise.all([social.meuAvatar(), social.catalogo()])) as [any, any];
  st.remove();
  // provador: sem login (ou servidor fora do ar) dá para montar e ver o avatar; salvar exige casa reivindicada
  let provador = false;
  if (!eu.ok || !cat.ok) {
    provador = true;
    eu = { ok: true, editavel: true, motivo: null, houseId: null, config: { ...PADRAO }, versao: 0 };
    cat = { ok: true, itens: CATALOGO_LOCAL.map(([id, slot, nome]) => ({ id, slot, nome, gratuito: true, possui: true })) };
  }
  if (!eu.ok || !cat.ok) {
    const b = el('div', 'cartao-b'); const erro = !eu.ok ? eu.erro : !cat.ok ? cat.erro : '';
    b.append(el('h2', '', 'meu avatar'), el('p', 'msg erro', erro));
    b.append(botao('btn mini', 'tentar de novo', () => { corpo.innerHTML = ''; void montarPainelAvatar(corpo, ctx); }));
    corpo.append(b); return { dispose() {} };
  }
  let cfg: ConfigAvatar = { ...PADRAO, ...eu.config } as ConfigAvatar;
  let versao = eu.versao; let salvo = JSON.stringify(cfg);
  const editavel = eu.editavel;

  /* prévia */
  const pv = el('div', 'cartao-b');
  pv.append(el('h2', '', provador ? 'provador de avatar' : 'meu avatar'));
  if (provador) pv.append(el('p', 'nota', 'modo provador: monte e veja o avatar. Para salvar, reivindique a sua casa.'));
  let previa: ReturnType<typeof criarPreviaAvatar> | null = null;
  const resumo = el('p', 'nota'); resumo.setAttribute('aria-live', 'polite');
  if (temWebGL()) {
    const cv = el('canvas'); cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'prévia 3D do avatar');
    cv.style.cssText = 'display:block;width:100%;height:260px;border:3px solid var(--ink);border-radius:16px;background:linear-gradient(180deg,#bcd8f2,#d9ead6);touch-action:pan-y';
    pv.append(cv);
    try { previa = criarPreviaAvatar(cv, cfg); } catch { cv.remove(); pv.append(el('p', 'nota', 'prévia 3D indisponível neste aparelho.')); }
    if (previa) {
      const ctr = el('div', 'voto-chips');
      ctr.append(botao('btn mini', 'girar ◀', () => previa!.girar(-0.5), 'girar para a esquerda'), botao('btn mini', 'acenar', () => previa!.animar('aceno')), botao('btn mini', 'comemorar', () => previa!.animar('comemorar')), botao('btn mini', 'girar ▶', () => previa!.girar(0.5), 'girar para a direita'));
      pv.append(ctr);
    }
  } else pv.append(el('p', 'nota', 'prévia 3D indisponível neste aparelho; as escolhas abaixo continuam valendo.'));
  pv.append(resumo);
  corpo.append(pv);

  if (!editavel) {
    const av = el('div', 'cartao-b papel'); av.append(el('h2', '', 'falta reivindicar'), el('p', '', eu.motivo || 'reivindique a sua casa para editar o avatar.'));
    if (ctx.abrirReivindicar) av.append(botao('btn prim', 'reivindicar minha casa', () => ctx.abrirReivindicar!()));
    corpo.append(av);
  }

  const nomes = new Map(cat.itens.map((i: ItemCatalogo) => [i.id, i.nome]));
  const pintarResumo = () => { resumo.textContent = SECOES.map((s) => `${s.titulo}: ${nomes.get(cfg[s.slot]) || cfg[s.slot]}`).join(' · '); };
  pintarResumo();

  /* escolhas */
  const porSlot = new Map<SlotAvatar, ItemCatalogo[]>();
  for (const i of cat.itens) (porSlot.get(i.slot) || porSlot.set(i.slot, []).get(i.slot)!).push(i);
  const msg = el('p', 'msg'); msg.setAttribute('aria-live', 'polite');
  const btSalvar = botao('btn prim bloco', 'salvar avatar', () => void salvar());
  const sujo = () => { btSalvar.disabled = !editavel || JSON.stringify(cfg) === salvo; };

  const ed = el('div', 'cartao-b');
  for (const s of SECOES) {
    const itens = porSlot.get(s.slot) || []; if (!itens.length) continue;
    const f = el('div', 'form-campo'); const lbl = el('label', '', s.titulo); lbl.id = 'av-' + s.slot; f.append(lbl);
    const grupo = el('div', s.cor ? 'cores' : 'tipos'); grupo.setAttribute('role', 'radiogroup'); grupo.setAttribute('aria-labelledby', lbl.id);
    for (const it of itens) {
      const bloqueado = !it.possui;
      const b = s.cor ? botao('cor', '', undefined, `${s.titulo}: ${it.nome}${bloqueado ? ' (bloqueado)' : ''}`) : botao('', it.nome + (bloqueado ? ' · bloqueado' : ''));
      if (s.cor) b.style.background = CORES[it.id] || '#ffffff';
      b.setAttribute('role', 'radio'); b.dataset.id = it.id;
      b.disabled = !editavel || bloqueado;
      b.onclick = () => { cfg = { ...cfg, [s.slot]: it.id }; marcar(grupo, it.id); previa?.definir(cfg); pintarResumo(); sujo(); msg.textContent = ''; };
      grupo.append(b);
    }
    marcar(grupo, cfg[s.slot]);
    f.append(grupo); ed.append(f);
  }
  ed.append(el('p', 'nota', 'opções iniciais são gratuitas. Itens bloqueados só chegam por conquistas do jogo; ninguém escolhe sua aparência por você.'));
  corpo.append(ed);
  const rod = el('div', 'cartao-b'); rod.append(btSalvar, msg); corpo.append(rod); sujo();

  async function salvar() {
    if (provador) { resumo.textContent = 'provador: para salvar este avatar, reivindique a sua casa pelo Instagram (Minha Casa → reivindicar).'; if (ctx.abrirReivindicar) ctx.abrirReivindicar(); return; }
    btSalvar.disabled = true; msg.className = 'msg'; msg.textContent = 'salvando…';
    const r = await social.salvarAvatar(cfg, versao);
    if (!r.ok) { msg.className = 'msg erro'; msg.textContent = r.erro; btSalvar.disabled = false; return; }
    cfg = r.config; versao = r.versao; salvo = JSON.stringify(cfg); sujo(); msg.className = 'msg ok'; msg.textContent = 'avatar salvo';
    toast('avatar salvo'); previa?.animar('aceno'); ctx.aoSalvar?.(r.config);
  }
  return { dispose() { previa?.dispose(); previa = null; } };
}

function marcar(grupo: HTMLElement, id: string) {
  grupo.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { const on = b.dataset.id === id; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
}
