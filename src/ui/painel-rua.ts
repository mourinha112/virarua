/* Painel da rua (Fase 2): casas, moradores, obra, líder, convite, mudar de rua e competição.
   Usa só os componentes/classes do design system atual (cartao-b, btn, linha, barra, etiq, chip, rk, tipos, form-campo).

   COMO PLUGAR (outro dev, em src/ui/paineis.ts):
     import { montarPainelRua } from './painel-rua';
     DEFS.rua = { titulo: 'minha rua', desenhar: (c, o) => montarPainelRua(c, { ibge: o?.cid?.ibge, cidadeNome: o?.cid?.nome, ruaId: o?.ruaId,
       abrirAvatar: () => abrir('avatar'), visitarDestino: (id) => ..., aoMudarDeRua: () => ... }) };

   ASSINATURA
     montarPainelRua(corpo: HTMLElement, ctx: PainelRuaCtx): Promise<void>
       corpo  elemento vazio (o .painel-corpo); o painel desenha tudo dentro dele e se redesenha após cada ação
       ctx.ruaId        abre essa rua; sem ruaId abre a rua do usuário logado; sem casa/sessão mostra as ruas de ctx.ibge
       ctx.ibge         cidade para listar ruas (mudar de rua / visitante)
       ctx.cidadeNome   rótulo opcional da cidade
       ctx.abrirAvatar  opcional: botão "editar meu avatar"
       ctx.visitarDestino(destinoId) opcional: botão "ir para a rua" (teletransporte para o destino street)
       ctx.aoMudarDeRua(ruaId)       opcional: avisado depois de mudar/entrar em rua (ex.: recarregar o mapa) */
import { el, botao, toast } from './dom';
import { social, type RuaDetalhe, type RuaResumo, type ResultadoTroca, type Morador } from '../api/social';
import { CORES } from '../mundo/avatares3d';

export type PainelRuaCtx = {
  ruaId?: string; ibge?: number; cidadeNome?: string;
  abrirAvatar?: () => void; visitarDestino?: (destinoId: string) => void; aoMudarDeRua?: (ruaId: string) => void;
};

const EMBLEMAS: [string, string][] = [['estrela', 'estrela'], ['coracao', 'coração'], ['sol', 'sol'], ['lua', 'lua'], ['folha', 'folha'], ['flor', 'flor'], ['raio', 'raio'], ['bola', 'bola'], ['nota', 'nota'], ['casa', 'casa'], ['peixe', 'peixe'], ['passaro', 'pássaro'], ['arvore', 'árvore'], ['onda', 'onda'], ['coroa', 'coroa'], ['fogo', 'fogo']];
const STATUS: Record<string, string> = { fundacao: 'em fundação', ativa: 'ativa', pausada: 'pausada', arquivada: 'arquivada' };
const ESTADO: Record<string, string> = { online: 'online', away: 'ausente', offline: 'offline', invisible: 'invisível' };
const dataCurta = (iso: string) => { try { return new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

function carregando(c: HTMLElement, txt = 'carregando…') { const p = el('p', 'nota', txt); p.setAttribute('role', 'status'); c.append(p); return p; }
function erroRecuperavel(c: HTMLElement, erro: string, tentar: () => void) {
  const b = el('div', 'cartao-b'); b.append(el('p', 'msg erro', erro), botao('btn mini', 'tentar de novo', tentar)); c.append(b);
}
function msgTroca(t: ResultadoTroca) {
  if (t.tipo === 'mudou') return t.loteNovo ? 'mudança feita: sua casa ganhou um lote novo nesta cidade, avatar e inventário vieram junto' : 'mudança feita: casa, avatar e inventário continuam iguais';
  if (t.tipo === 'lista_espera') return `rua lotada: você entrou na lista de espera (posição ${t.posicao}). Sua casa continua onde está.`;
  return 'você já mora nessa rua';
}

export async function montarPainelRua(corpo: HTMLElement, ctx: PainelRuaCtx = {}): Promise<void> {
  const redesenhar = (novo: Partial<PainelRuaCtx> = {}) => { Object.assign(ctx, novo); corpo.innerHTML = ''; void montarPainelRua(corpo, ctx); };
  const st = carregando(corpo);
  let det: RuaDetalhe | null = null;
  if (ctx.ruaId) {
    const r = await social.rua(ctx.ruaId); st.remove();
    if (!r.ok) { erroRecuperavel(corpo, r.erro, () => redesenhar()); return; }
    det = r as RuaDetalhe;
  } else {
    const r = await social.minhaRua(); st.remove();
    if (r.ok && r.rua) det = r as unknown as RuaDetalhe;
    else if (!ctx.ibge) {
      const b = el('div', 'cartao-b'); b.append(el('h2', '', 'sua rua'), el('p', 'nota', r.ok ? 'sua casa ainda não está em nenhuma rua.' : r.status === 401 || r.status === 403 ? 'entre e reivindique a sua casa para ter uma rua.' : r.erro)); corpo.append(b); return;
    }
  }
  if (det) desenharRua(corpo, det, ctx, redesenhar);
  else await desenharLista(corpo, ctx.ibge!, ctx, redesenhar, null);
}

/* ---------- detalhe da rua ---------- */
function desenharRua(c: HTMLElement, d: RuaDetalhe, ctx: PainelRuaCtx, redesenhar: (n?: Partial<PainelRuaCtx>) => void) {
  const { rua, eu } = d;
  const topo = el('div', 'cartao-b am');
  topo.append(el('h2', '', rua.nome), el('p', '', `${rua.cidade} · ${rua.uf}`));
  const chips = el('div', 'voto-chips');
  chips.append(el('span', 'etiq ' + (rua.status === 'ativa' ? 'vd' : 'am'), STATUS[rua.status] || rua.status), el('span', 'etiq ' + (rua.publica ? '' : 'ink'), rua.publica ? 'pública: qualquer morador pode entrar' : 'privada: entra com convite ou aprovação'));
  if (rua.emblema) chips.append(el('span', 'chip', 'emblema: ' + (EMBLEMAS.find(([k]) => k === rua.emblema)?.[1] || rua.emblema)));
  if (eu?.souMembro) chips.append(el('span', 'chip am', 'sua rua'));
  topo.append(chips);
  if (rua.descricao) topo.append(el('p', '', rua.descricao));
  const cap = el('div', 'linha'); cap.append(el('span', '', 'casas'), el('b', '', `${rua.ocupadas}/${rua.capacidade}`)); topo.append(cap);
  const barra = el('div', 'barra'); const i = el('i'); i.style.width = Math.round((rua.ocupadas / Math.max(1, rua.capacidade)) * 100) + '%'; barra.append(i); barra.setAttribute('aria-label', `${rua.ocupadas} de ${rua.capacidade} casas ocupadas`); topo.append(barra);
  if (rua.listaEspera) topo.append(el('p', 'nota', `${rua.listaEspera} na lista de espera`));
  if (d.fundador?.handle) topo.append(el('p', 'nota', `fundada por @${d.fundador.handle}`));
  c.append(topo);

  // próxima ação (explica o que fazer)
  const acao = el('div', 'cartao-b'); const msg = el('p', 'msg'); msg.setAttribute('aria-live', 'polite');
  const executar = async (b: HTMLButtonElement, f: () => Promise<{ ok: boolean; erro?: string }>, ok: (r: any) => string, depois?: () => void) => {
    b.disabled = true; const r = await f(); b.disabled = false;
    msg.className = 'msg ' + (r.ok ? 'ok' : 'erro'); msg.textContent = r.ok ? ok(r) : r.erro || 'não deu certo agora';
    if (r.ok) { toast(msg.textContent); depois?.(); }
  };
  if (!eu) acao.append(el('h2', '', 'quer morar aqui?'), el('p', 'nota', 'entre na sua conta e reivindique a sua casa para escolher uma rua.'));
  else if (!eu.temCasa) acao.append(el('h2', '', 'quer morar aqui?'), el('p', 'nota', 'reivindique a sua casa pelo Instagram para escolher uma rua.'));
  else if (eu.souMembro) {
    acao.append(el('h2', '', 'o que fazer agora'));
    const ul = el('ul'); for (const t of ['chame vizinhos com um convite', 'ajude a obra da rua quando ela abrir', 'visite as casas dos moradores']) ul.append(el('li', '', t)); acao.append(ul);
    if (ctx.abrirAvatar) acao.append(botao('btn mini', 'editar meu avatar', () => ctx.abrirAvatar!()));
  } else if (eu.listaEspera) {
    acao.append(el('h2', '', 'lista de espera'), el('p', '', eu.listaEspera.estado === 'notificada' ? 'abriu uma vaga! Confirme a mudança agora (sua casa só muda com o seu aceite).' : `você é o ${eu.listaEspera.posicao}º da fila. Sua casa continua na rua atual.`));
    if (eu.listaEspera.estado === 'notificada') { const b = botao('btn prim', 'mudar para esta rua', () => executar(b, () => social.entrarRua(rua.id), (r) => msgTroca(r.troca), () => { ctx.aoMudarDeRua?.(rua.id); redesenhar(); })); acao.append(b); }
    const s = botao('btn mini', 'sair da fila', () => executar(s, () => social.sairDaEspera(rua.id), () => 'você saiu da lista de espera', () => redesenhar())); acao.append(s);
  } else if (eu.pedidoPendente) acao.append(el('h2', '', 'pedido enviado'), el('p', 'nota', 'quem cuida da rua ainda não respondeu. Sua casa continua onde está.'));
  else if (rua.status === 'fundacao' || rua.status === 'ativa') {
    acao.append(el('h2', '', 'quer morar aqui?'), el('p', 'nota', 'mudar de rua leva sua casa, avatar e inventário. A casa não some e ninguém perde nada.'));
    if (rua.publica) { const b = botao('btn prim', rua.ocupadas >= rua.capacidade ? 'entrar na lista de espera' : 'mudar para esta rua', () => executar(b, () => social.entrarRua(rua.id), (r) => msgTroca(r.troca), () => { ctx.aoMudarDeRua?.(rua.id); redesenhar(); })); acao.append(b); }
    else { const b = botao('btn prim', 'pedir para entrar', () => executar(b, () => social.pedirEntrada(rua.id, 'vizinho'), () => 'pedido enviado para quem cuida da rua', () => redesenhar())); acao.append(b); }
  }
  if (ctx.visitarDestino) acao.append(botao('btn mini', 'ir para a rua', async () => { const r = await social.destinosDaCidade(rua.ibge); const dst = r.ok ? r.destinos.find((x) => x.tipo === 'street' && x.nome === rua.nome) : null; if (dst) ctx.visitarDestino!(dst.id); else toast(r.ok ? 'essa rua ainda não tem ponto de encontro' : r.erro); }));
  acao.append(msg); c.append(acao);

  // líder
  const ld = el('div', 'cartao-b'); ld.append(el('h2', '', 'líder da rua'));
  if (!d.lider.disponivel) ld.append(el('p', 'nota', 'a eleição de líder ainda não está ligada neste servidor.'));
  else if (!d.lider.lider) ld.append(el('p', '', 'sem líder eleito agora. O cargo fica vago até haver eleição com quorum.'));
  else { const l = el('div', 'linha'); l.append(el('span', '', d.lider.lider.handle ? '@' + d.lider.lider.handle : 'morador'), el('small', '', 'desde ' + dataCurta(d.lider.lider.desde))); ld.append(l); }
  ld.append(el('p', 'nota', 'líder organiza a rua; não despeja moradores nem mexe em casas.'));
  c.append(ld);

  // obra comunitária
  const ob = el('div', 'cartao-b'); ob.append(el('h2', '', 'obra da rua'));
  if (!d.obra.disponivel) ob.append(el('p', 'nota', 'as obras comunitárias ainda não estão ligadas neste servidor.'));
  else {
    const o = d.obra; ob.append(el('p', '', `${o.nome} · ${o.estado}`));
    const br = el('div', 'barra'); const bi = el('i'); bi.style.width = Math.min(100, Math.round((o.progresso / Math.max(1, o.meta)) * 100)) + '%'; br.append(bi); ob.append(br, el('p', 'nota', `${o.progresso} de ${o.meta}`));
  }
  c.append(ob);

  // competição (Fase 3: estado real ou indisponível)
  const cp = el('div', 'cartao-b'); cp.append(el('h2', '', 'competição da semana'));
  if (!d.competicao.disponivel) cp.append(el('p', 'nota', 'a competição de ruas ainda não está ligada neste servidor.'));
  else {
    const k = d.competicao;
    for (const [r, v] of [['modo', k.modo === 'cooperativa' ? 'cooperativa (sem adversário)' : 'competitiva'], ['posição', k.posicao ? k.posicao + 'º' : '—'], ['pontos', String(k.pontos)], ['fecha', dataCurta(k.fechaEm)]] as [string, string][]) { const l = el('div', 'linha'); l.append(el('span', '', r), el('b', '', v)); cp.append(l); }
  }
  cp.append(el('p', 'nota', d.regras.vinculoCompetitivo + '. Competição de ruas não escolhe prefeito.'));
  c.append(cp);

  // casas e moradores
  const mo = el('div', 'cartao-b'); mo.append(el('h2', '', `casas e moradores (${d.moradores.length})`));
  if (!d.moradores.length) mo.append(el('p', 'nota', 'rua vazia por enquanto.'));
  d.moradores.forEach((m: Morador, k: number) => {
    const linha = el('div', 'rk'); linha.setAttribute('role', 'listitem');
    const bola = el('span', 'pos'); bola.style.background = CORES[m.avatar?.pele || 'pele.3'] || '#d9a273'; bola.textContent = String(k + 1); bola.setAttribute('aria-hidden', 'true');
    const nm = el('span', 'nome'); nm.append(el('b', '', m.handle ? '@' + m.handle : 'morador'), el('small', '', `casa nível ${m.nivel} · lote ${m.lote}`));
    const es = el('span', 'chip' + (m.estado === 'online' ? ' am' : ''), ESTADO[m.estado] || m.estado);
    linha.append(bola, nm, es); mo.append(linha);
  });
  c.append(mo);

  // convite (moradores)
  if (eu?.souMembro) {
    const cv = el('div', 'cartao-b papel'); cv.append(el('h2', '', 'convidar vizinhos'), el('p', 'nota', 'o link vale por 3 dias e até 5 pessoas. Quem aceitar muda a casa para cá só se confirmar.'));
    const saida = el('div'); const m2 = el('p', 'msg');
    const gerar = botao('btn prim', 'gerar convite', async () => {
      gerar.disabled = true; const r = await social.criarConvite({ tipo: 'rua', ruaId: rua.id, maxUsos: 5, validadeHoras: 72 }); gerar.disabled = false;
      if (!r.ok) { m2.className = 'msg erro'; m2.textContent = r.erro; return; }
      saida.innerHTML = ''; const caixa = el('div', 'pix-caixa', r.convite.link); saida.append(caixa);
      saida.append(botao('btn mini', 'copiar link', async () => { try { await navigator.clipboard.writeText(r.convite.link); toast('link copiado'); } catch { toast('copie o link acima'); } }));
      if ((navigator as any).share) saida.append(botao('btn mini', 'compartilhar', () => { (navigator as any).share({ title: 'vem morar na minha rua', url: r.convite.link }).catch(() => {}); }));
      m2.className = 'msg ok'; m2.textContent = 'convite criado';
    });
    cv.append(gerar, saida, m2);
    if (eu.convites.length) {
      const h = el('h3', '', 'convites ativos'); cv.append(h);
      for (const x of eu.convites) { const l = el('div', 'linha'); l.append(el('span', '', `${x.usos}/${x.maxUsos} usos · até ${dataCurta(x.expiraEm)}`)); const b = botao('btn mini', 'cancelar', async () => { b.disabled = true; const r = await social.revogarConvite(x.id); toast(r.ok ? 'convite cancelado' : r.erro); redesenhar(); }); l.append(b); cv.append(l); }
    }
    c.append(cv);
  }

  // pedidos de entrada (quem cuida da rua)
  if (eu?.possoModerar && eu.pedidos.length) {
    const pd = el('div', 'cartao-b'); pd.append(el('h2', '', `pedidos para entrar (${eu.pedidos.length})`));
    for (const p of eu.pedidos) {
      const l = el('div', 'linha'); l.append(el('span', '', (p.handle ? '@' + p.handle : 'morador') + ' · ' + dataCurta(p.criadoEm)));
      const ac = el('span'); const sim = botao('btn mini prim', 'aceitar', async () => { sim.disabled = true; const r = await social.responderPedido(p.id, true); toast(r.ok ? (r.troca ? msgTroca(r.troca) : 'aceito') : r.erro); redesenhar(); });
      const nao = botao('btn mini', 'recusar', async () => { nao.disabled = true; const r = await social.responderPedido(p.id, false); toast(r.ok ? 'pedido recusado' : r.erro); redesenhar(); });
      ac.append(sim, nao); l.append(ac); pd.append(l);
    }
    c.append(pd);
  }

  // mudar de rua / criar rua
  if (eu?.temCasa) {
    const mu = el('div', 'cartao-b'); mu.append(el('h2', '', eu.souMembro ? 'mudar de rua' : 'outras ruas'));
    mu.append(el('p', 'nota', 'sua casa, avatar e inventário vão junto. Pontos da competição desta semana ficam com a rua antiga.'));
    const lista = el('div'); mu.append(botao('btn mini', 'ver ruas de ' + rua.cidade, async (ev) => { (ev.currentTarget as HTMLButtonElement).remove(); await desenharLista(lista, rua.ibge, ctx, redesenhar, eu.minhaRua); }), lista);
    c.append(mu);
    if (eu.souFundador && rua.ocupadas === 0 && rua.status !== 'arquivada') {
      const ar = el('div', 'cartao-b'); ar.append(el('h2', '', 'arquivar rua'), el('p', 'nota', 'só ruas vazias podem ser arquivadas. O histórico fica guardado.'));
      const b = botao('btn mini', 'arquivar esta rua', async () => { if (!confirm('arquivar esta rua vazia?')) return; b.disabled = true; const r = await social.arquivarRua(rua.id); toast(r.ok ? 'rua arquivada' : r.erro); if (r.ok) redesenhar({ ruaId: undefined }); else b.disabled = false; });
      ar.append(b); c.append(ar);
    }
  }
}

/* ---------- lista de ruas da cidade + criar rua ---------- */
async function desenharLista(c: HTMLElement, ibge: number, ctx: PainelRuaCtx, redesenhar: (n?: Partial<PainelRuaCtx>) => void, minha: string | null) {
  const st = carregando(c, 'carregando ruas…');
  const r = await social.ruasDaCidade(ibge); st.remove();
  if (!r.ok) { erroRecuperavel(c, r.erro, () => { c.innerHTML = ''; void desenharLista(c, ibge, ctx, redesenhar, minha); }); return; }
  const box = el('div', 'cartao-b'); box.append(el('h2', '', `ruas${ctx.cidadeNome ? ' de ' + ctx.cidadeNome : ''}`));
  if (!r.ruas.length) box.append(el('p', 'msg', 'nenhuma rua ainda. A primeira casa reivindicada abre a primeira rua pública.'));
  for (const ru of r.ruas as RuaResumo[]) {
    const b = botao('rk' + (ru.minha ? ' eu' : ''), '', () => redesenhar({ ruaId: ru.id }));
    const nm = el('span', 'nome'); nm.append(el('b', '', ru.nome), el('small', '', `${STATUS[ru.status] || ru.status} · ${ru.publica ? 'pública' : 'privada'}${ru.minha ? ' · sua rua' : ''}`));
    b.append(nm, el('span', 'n', `${ru.ocupadas}/${ru.capacidade}`)); b.setAttribute('aria-label', `${ru.nome}, ${ru.ocupadas} de ${ru.capacidade} casas, ${ru.publica ? 'pública' : 'privada'}`);
    box.append(b);
  }
  c.append(box);

  // criar rua (uma por pessoa, nome moderado)
  const cr = el('div', 'cartao-b'); cr.append(el('h2', '', 'fundar uma rua'), el('p', 'nota', 'uma rua ativa por pessoa. Nome e descrição passam por filtro: nada de links, @, telefone ou ofensa.'));
  const fNome = el('div', 'form-campo'); const lNome = el('label', '', 'nome da rua'); const iNome = el('input'); iNome.maxLength = 40; iNome.placeholder = 'ex.: Rua dos Ipês'; iNome.id = 'rua-nome-' + ibge; lNome.htmlFor = iNome.id; fNome.append(lNome, iNome);
  const fDesc = el('div', 'form-campo'); const lDesc = el('label', '', 'descrição (opcional)'); const iDesc = el('input'); iDesc.maxLength = 140; iDesc.placeholder = 'uma frase sobre a rua'; iDesc.id = 'rua-desc-' + ibge; lDesc.htmlFor = iDesc.id; fDesc.append(lDesc, iDesc);
  let emblema = 'estrela'; const tipos = el('div', 'tipos'); tipos.setAttribute('role', 'radiogroup'); tipos.setAttribute('aria-label', 'emblema');
  for (const [k, n] of EMBLEMAS) { const b = botao(k === emblema ? 'on' : '', n, () => { emblema = k; tipos.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', String(x === b)); }); }); b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(k === emblema)); tipos.append(b); }
  const fEmb = el('div', 'form-campo'); fEmb.append(el('label', '', 'emblema'), tipos);
  let publica = true; const seg = el('div', 'seg');
  const bPub = botao('on', 'pública', () => { publica = true; bPub.classList.add('on'); bPri.classList.remove('on'); }), bPri = botao('', 'privada', () => { publica = false; bPri.classList.add('on'); bPub.classList.remove('on'); });
  seg.append(bPub, bPri); const fVis = el('div', 'form-campo'); fVis.append(el('label', '', 'quem pode entrar'), seg, el('small', '', 'pública: qualquer morador entra. Privada: só com convite ou sua aprovação.'));
  const msg = el('p', 'msg'); msg.setAttribute('aria-live', 'polite');
  const ok = botao('btn prim bloco', 'fundar e mudar para ela', async () => {
    ok.disabled = true; const res = await social.criarRua({ nome: iNome.value, descricao: iDesc.value || undefined, emblema, publica }); ok.disabled = false;
    msg.className = 'msg ' + (res.ok ? 'ok' : 'erro'); msg.textContent = res.ok ? (res.troca ? msgTroca(res.troca) : 'rua criada') : res.erro;
    if (res.ok) { toast('rua fundada'); ctx.aoMudarDeRua?.(res.id); redesenhar({ ruaId: res.id }); }
  });
  cr.append(fNome, fDesc, fEmb, fVis, el('div', 'form-campo'), ok, msg);
  c.append(cr);
}
