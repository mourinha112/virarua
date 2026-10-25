/* Cola principal: dados ↔ mundo 3D ↔ interface (busca, toque, cartões, rótulos, abas). */
import type { Mundo } from '../mundo/mundo';
import { criarMarcadores, raioMarcadorPx } from '../mundo/marcadores';
import { criarRotulos, type Rotulo } from '../mundo/rotulos';
import { criarCidades3D } from '../mundo/cidades3d';
import { criarPets } from '../mundo/pets3d';
import { criarRaios } from '../mundo/raios';
import { iniciarRuaViva } from './ruaviva';
import { iniciarJornal } from './jornal';
import { criarAeroportos, META_AEROPORTO } from '../mundo/aeroportos';
import { TERRENO, UF_POR_SIGLA, ufEm } from '../mundo/terreno';
import { carregarDados, normHandle, semAcento, fmtN, type Dados, type Cidade } from '../dados/dados';
import { $, el, toast } from './dom';
import { CARGOS, PONTOS } from '../jogo/regras';
import { api } from '../api/cliente';
import { esc } from '../mundo/rotulos';
const NIV_CID = ['bairro', 'cidade', 'polo', 'metrópole', 'capital'];
const nivelCidade = (c: { n: number }) => { const k = c.n < 40 ? 0 : c.n < 150 ? 1 : c.n < 500 ? 2 : c.n < 1500 ? 3 : 4; return `nível ${k + 1} · ${NIV_CID[k]}`; };
const CARGOS_NOME: Record<string, string> = Object.fromEntries(Object.entries(CARGOS).map(([k, v]) => [k, v.nome]));
import { cartaoCasa, cartaoCidade, cartaoEstado, cartaoLoja, avisoNaoAchei } from './cartoes';
import { montarPaineis, type Paineis } from './paineis';
import { montarPerfil } from './perfil';

export type Sel = { tipo: 'casa'; gi: number } | { tipo: 'cid'; c: Cidade } | { tipo: 'est'; uf: string } | null;

export type Ctx = {
  mundo: Mundo; dados: Dados;
  sel: Sel;
  eu(): number; lembrarEu(gi: number): void; esquecerEu(): void;
  mostrarCasa(gi: number, voar?: boolean): void;
  mostrarCidade(c: Cidade, voar?: boolean): void;
  mostrarEstado(uf: string, voar?: boolean): void;
  abrirCartao(node: HTMLElement): void; fecharCartao(): void;
  buscar(txt: string): void;
  paineis: Paineis;
  posicaoCidade(c: Cidade): number;
  visitarLoja(l: import('../dados/formato').Loja): void;
};

const LS = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ok */ } }, del: (k: string) => { try { localStorage.removeItem(k); } catch { /* ok */ } } };

export async function iniciarApp(mundo: Mundo) {
  let dados: Dados;
  try { dados = await carregarDados(); }
  catch (e) { toast(String((e as Error).message || e), 8000); return; }
  const ehCel = mundo.Q.nivel <= 1;

  if (dados.p.demo) { const s = el('div', 'demo-selo', 'dados de demonstração · moradores fictícios'); $('app').append(s); }
  $('totais').innerHTML = '';
  $('totais').append(el('b', '', fmtN(dados.p.n) + ' casas'), el('i'), el('b', '', fmtN(dados.CID.length) + ' cidades'));
  $('totais').setAttribute('aria-label', `${fmtN(dados.p.n)} casas em ${fmtN(dados.CID.length)} cidades`);

  /* ---------- camadas do mapa ---------- */
  const marc = criarMarcadores(mundo.renderer);
  mundo.scene.add(marc.pts);
  const AMARELAS = new Set(dados.ORDEM.slice(0, ehCel ? 45 : 70).map((c) => c.ibge));
  const redesenharMarcadores = () => marc.definir(dados.CID.map((c) => ({ x: c.x, y: c.y, n: c.n, amarelo: AMARELAS.has(c.ibge) || (ctx.sel?.tipo === 'cid' && ctx.sel.c === c) })));
  const cid3d = criarCidades3D(mundo.scene, dados, mundo.camera, ehCel ? { maxCidades: 40, maxCasas: 5000 } : { maxCidades: 100, maxCasas: 13000 });
  const pets3d = criarPets(mundo.scene, cid3d); (window as any).__pets3d = pets3d;
  const rot = criarRotulos($('camada'));
  // cidades "em alta" (demo: as que mais pontuaram na semana) ganham raio de luz na vista de longe
  const raios = criarRaios([...dados.CID].sort((a, b) => b.pts - a.pts).slice(0, 14).map((c) => ({ x: c.x, y: c.y })));
  mundo.scene.add(raios.mesh);
  const aeros = criarAeroportos(mundo.scene, dados.CID.map((c) => ({ ibge: c.ibge, nome: c.nome, x: c.x, y: c.y, n: c.n })));
  (window as any).__aeros = aeros;

  /* ---------- ranking de cidades por pontos (posição no Brasil) ---------- */
  const rankCid = [...dados.CID].sort((a, b) => b.pts - a.pts);
  const posCid = new Map(rankCid.map((c, i) => [c.ibge, i + 1]));

  /* ---------- contexto ---------- */
  const ctx: Ctx = {
    mundo, dados, sel: null,
    eu() { const h = normHandle(LS.get('nem_eu') || ''); const gi = dados.POR_HANDLE.get(h); return gi ?? -1; },
    lembrarEu(gi) { LS.set('nem_eu', dados.USR[gi]); },
    esquecerEu() { LS.del('nem_eu'); },
    mostrarCasa(gi, voar = true) {
      const ci = dados.CID_DE[gi]; if (ci < 0) return; const c = dados.CID[ci];
      ctx.sel = { tipo: 'casa', gi }; cid3d.forcar(c);
      const p = cid3d.posicaoCasa(gi) || { x: c.x, y: c.y };
      if (voar) mundo.camera.voar({ fx: p.x, fy: p.y, ld: Math.log(16), phi: 40 });
      ctx.abrirCartao(cartaoCasa(ctx, gi));
      try { history.replaceState(null, '', '?u=' + encodeURIComponent(dados.USR[gi])); } catch { /* ok */ }
      redesenharMarcadores();
    },
    mostrarCidade(c, voar = true) {
      ctx.sel = { tipo: 'cid', c };
      const L = cid3d.layout(c.ibge);
      const r = L ? L.raio : Math.max(4, Math.sqrt(c.n) * 1.6);
      if (voar) mundo.camera.voar({ fx: c.x, fy: c.y, ld: Math.log(Math.min(700, Math.max(24, r * 4.2))), phi: 42 });
      ctx.abrirCartao(cartaoCidade(ctx, c));
      redesenharMarcadores();
    },
    mostrarEstado(uf, voar = true) {
      ctx.sel = { tipo: 'est', uf };
      const u = UF_POR_SIGLA.get(uf);
      if (u && voar) {
        let a = 1e9, b = 1e9, cc = -1e9, d = -1e9; for (const p of u.polys) for (const [x, y] of p.o) { a = Math.min(a, x); b = Math.min(b, y); cc = Math.max(cc, x); d = Math.max(d, y); }
        const ext = Math.max(cc - a, d - b);
        mundo.camera.voar({ fx: (a + cc) / 2, fy: (b + d) / 2 - ext * 0.12, ld: Math.log(Math.max(300, ext * 1.25)), phi: 52 });
      }
      ctx.abrirCartao(cartaoEstado(ctx, uf));
      redesenharMarcadores();
    },
    abrirCartao(node) {
      const s = $('cartao'); s.innerHTML = ''; s.append(node); s.hidden = false; s.scrollTop = 0;
      document.body.classList.add('achou'); margens();
    },
    fecharCartao() {
      const s = $('cartao'); s.hidden = true; s.innerHTML = ''; ctx.sel = null; document.body.classList.remove('achou');
      try { history.replaceState(null, '', location.pathname); } catch { /* ok */ }
      redesenharMarcadores(); margens();
    },
    buscar(txt) {
      const s = sugestoes(txt);
      if (!txt.trim()) { toast('digita um @, cidade ou estado'); $('q').focus(); return; }
      if (s.length) escolher(s[0]); else ctx.abrirCartao(avisoNaoAchei(txt));
    },
    paineis: null as unknown as Paineis,
    posicaoCidade: (c) => posCid.get(c.ibge) || 0,
    visitarLoja(l) {
      const c = dados.POR_IBGE.get(l.ibge); if (c) cid3d.forcar(c);
      const p: any = cid3d.posicaoLoja(l); if (!p) return;
      // câmera na frente da fachada: a frente aponta para (sin yaw, -cos yaw); psi da câmera = yaw
      let psi = ((p.yaw ?? 0) * 180) / Math.PI; while (psi - mundo.camera.st.psi > 180) psi -= 360; while (psi - mundo.camera.st.psi < -180) psi += 360;
      ctx.sel = null;
      // no celular o cartão ocupa a metade de baixo: puxa o foco para frente da loja, que sobe na tela
      const cel = innerWidth < 640, yw = p.yaw ?? 0, off = cel ? 3.2 : 0;
      mundo.camera.voar({ fx: p.x + Math.sin(yw) * off, fy: p.y - Math.cos(yw) * off, ld: Math.log(cel ? 12 : 9), phi: 26, psi });
      ctx.abrirCartao(cartaoLoja(ctx, l));
    },
  };
  ctx.paineis = montarPaineis(ctx);
  montarPerfil(ctx);
  redesenharMarcadores();

  /* ---------- margens da área livre (câmera e rótulos evitam topo, cartão e barra) ---------- */
  function margens() {
    const H = innerHeight, topo = $('topo').getBoundingClientRect().bottom + 4;
    const cart = $('cartao'); const larga = innerWidth >= 900;
    const base = !cart.hidden && !larga ? cart.getBoundingClientRect().top - 4 : $('tabbar').getBoundingClientRect().top - 4;
    mundo.camera.margem.topo = topo / H; mundo.camera.margem.base = Math.max(0, (H - base) / H);
  }
  addEventListener('resize', margens); margens();

  /* ---------- busca ---------- */
  type Sug = { tipo: 'usr'; gi: number; rot: string; sub: string } | { tipo: 'cid'; c: Cidade; rot: string; sub: string } | { tipo: 'est'; uf: string; rot: string; sub: string };
  function sugestoes(bruto: string): Sug[] {
    const q0 = bruto.trim(), arroba = q0.startsWith('@'), t = semAcento(q0.replace(/^@+/, ''));
    const out: Sug[] = [], visto = new Set<string>();
    const add = (s: Sug, k: string) => { if (out.length < 7 && !visto.has(k)) { visto.add(k); out.push(s); } };
    const cidSug = (c: Cidade) => add({ tipo: 'cid', c, rot: c.nome, sub: `${c.uf} · ${fmtN(c.n)} ${c.n === 1 ? 'casa' : 'casas'}` }, 'c' + c.ibge);
    if (!arroba && t) {
      for (const c of dados.ORDEM) if (c.k === t) cidSug(c);
      for (const e of dados.ESTADOS.values()) if (semAcento(e.nome) === t || e.uf.toLowerCase() === t) add({ tipo: 'est', uf: e.uf, rot: e.nome, sub: `estado · ${fmtN(e.casas)} casas` }, 'e' + e.uf);
      if (t.length >= 2) {
        let k = 0; for (const c of dados.ORDEM) { if (k >= 4) break; if (c.k.startsWith(t)) { cidSug(c); k++; } }
        for (const e of dados.ESTADOS.values()) if (semAcento(e.nome).startsWith(t)) add({ tipo: 'est', uf: e.uf, rot: e.nome, sub: `estado · ${fmtN(e.casas)} casas` }, 'e' + e.uf);
        k = 0; for (const c of dados.ORDEM) { if (k >= 3) break; if (c.k.includes(t)) { cidSug(c); k++; } }
      }
    }
    const h = normHandle(q0);
    if (h) {
      const gi = dados.POR_HANDLE.get(h);
      const sub = (g: number) => { const c = dados.CID[dados.CID_DE[g]]; return c ? `${c.nome} · ${c.uf}` : ''; };
      if (gi !== undefined) add({ tipo: 'usr', gi, rot: '@' + h, sub: sub(gi) }, 'u' + gi);
      if (h.length >= 2) { let k = 0; for (let g = 0; g < dados.USR.length && k < 3; g++) if (dados.USR[g].startsWith(h) || (h.length >= 3 && dados.USR[g].includes(h))) { add({ tipo: 'usr', gi: g, rot: '@' + dados.USR[g], sub: sub(g) }, 'u' + g); k++; } }
    }
    return out;
  }
  function escolher(s: Sug) {
    esconderSug(); ($('q') as HTMLInputElement).blur();
    if (s.tipo === 'usr') { ($('q') as HTMLInputElement).value = dados.USR[s.gi]; ctx.lembrarEu(s.gi); ctx.mostrarCasa(s.gi); }
    else if (s.tipo === 'cid') { ($('q') as HTMLInputElement).value = s.c.nome; ctx.mostrarCidade(s.c); }
    else { ($('q') as HTMLInputElement).value = s.rot; ctx.mostrarEstado(s.uf); }
  }
  let sugAtual: Sug[] = [], sugIdx = -1;
  const ul = $('sug') as HTMLUListElement;
  function esconderSug() { ul.hidden = true; ul.innerHTML = ''; sugAtual = []; sugIdx = -1; }
  function mostrarSug(l: Sug[]) {
    sugAtual = l; sugIdx = -1; ul.innerHTML = '';
    if (!l.length) { ul.hidden = true; return; }
    l.forEach((s, i) => {
      const li = el('li'); li.setAttribute('role', 'option'); li.id = 'sug' + i;
      const ic = el('span', 'sg-ic' + (s.tipo === 'usr' ? ' at' : ''), s.tipo === 'usr' ? '@' : s.tipo === 'est' ? s.uf : '●');
      const tx = el('span'); tx.append(el('b', '', s.rot), el('small', '', s.sub));
      li.append(ic, tx);
      li.onpointerdown = (e) => { e.preventDefault(); escolher(s); };
      ul.append(li);
    });
    ul.hidden = false;
  }
  const q = $('q') as HTMLInputElement;
  q.addEventListener('input', () => mostrarSug(q.value.trim() ? sugestoes(q.value) : []));
  q.addEventListener('focus', () => { if (q.value.trim()) mostrarSug(sugestoes(q.value)); });
  q.addEventListener('blur', () => setTimeout(esconderSug, 120));
  q.addEventListener('keydown', (e) => {
    if (!sugAtual.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sugIdx = (sugIdx + (e.key === 'ArrowDown' ? 1 : -1) + sugAtual.length) % sugAtual.length; [...ul.children].forEach((c, i) => c.setAttribute('aria-selected', String(i === sugIdx))); }
    else if (e.key === 'Enter' && sugIdx >= 0) { e.preventDefault(); escolher(sugAtual[sugIdx]); }
  });
  ($('form') as HTMLFormElement).addEventListener('submit', (e) => { e.preventDefault(); ctx.buscar(q.value); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!ctx.paineis.fecharTopo()) ctx.fecharCartao(); } });

  /* ---------- toque no mapa ---------- */
  mundo.aoClicar(async (x, y) => {
    const D = mundo.camera.dist, cam = mundo.camera;
    if (D < 60 && await ruaViva.tocar(x, y, (a, b, h) => cam.projetar(a, b, h ?? 0))) return;
    if (D < 140) {
      for (const lv of cid3d.lojas) { const [px, py, ok] = cam.projetar(lv.x, lv.y, 1.6); if (ok && Math.hypot(px - x, py - y) < 60) { ctx.visitarLoja(lv.loja); return; } }
    }
    if (D < 90) {
      let melhor = -1, md = 30;
      for (const h of cid3d.casas) { const [px, py, ok] = cam.projetar(h.x, h.y, h.alt * 0.6); if (!ok) continue; const d = Math.hypot(px - x, py - y); if (d < md) { md = d; melhor = h.gi; } }
      if (melhor >= 0) { ctx.mostrarCasa(melhor, false); return; }
    }
    if (D >= 60) {
      let melhor: Cidade | null = null, md = 1e9;
      for (const c of dados.CID) { const [px, py, ok] = cam.projetar(c.x, c.y); if (!ok) continue; const d = Math.hypot(px - x, py - y), lim = raioMarcadorPx(c.n) + 9; if (d < lim && d < md) { md = d; melhor = c; } }
      if (melhor) { ctx.mostrarCidade(melhor); return; }
    }
    const g = cam.chaoEm(x, y);
    if (g) {
      // dentro do círculo de uma cidade construída?
      for (const c of cid3d.visiveis) { const L = cid3d.layout(c.ibge); if (L && Math.hypot(g[0] - c.x, g[1] - c.y) < L.raio) { ctx.mostrarCidade(c, false); return; } }
      if (D > 900) { const uf = ufEm(g[0], g[1]); if (uf) { ctx.mostrarEstado(uf); return; } }
    }
    if (ctx.sel) ctx.fecharCartao();
  });

  /* ---------- rótulos e anel por quadro ---------- */
  const ring = $('selring');
  const capitais = new Set(Object.values(TERRENO.capitais));
  const candCid = dados.ORDEM.slice(0, 600);
  let tick = 0;
  mundo.aoPasso((dt, t) => {
    cid3d.passo(t); pets3d.passo(t, mundo.camera.dist); raios.passo(mundo.camera.dist, t); aeros.passo(t, mundo.camera.dist);
    const D = mundo.camera.dist;
    marc.passo(D, mundo.renderer.getPixelRatio(), innerWidth < 600 && D > 3000 ? 0.85 : 1);
    if ((tick++ & 1) === 1) return;
    const W = innerWidth, H = innerHeight, cam = mundo.camera;
    const L: Rotulo[] = [];
    if (D > 1200) for (const u of TERRENO.ufs) L.push({ id: 'uf' + u.uf, x: u.cx, y: u.cy, txt: u.uf, cls: 'uf', pri: D > 3500 ? 5000 : 40 });
    for (const c of candCid) {
      const cap = capitais.has(c.nome) && UF_POR_SIGLA.get(c.uf) && TERRENO.capitais[c.uf] === c.nome;
      const pri = (cap ? 300 : 0) + c.n + (ctx.sel?.tipo === 'cid' && ctx.sel.c === c ? 1e6 : 0);
      if (D > 2500 && !cap && c.n < 120) continue;
      const perto = D < 700;
      const Lc3 = perto ? cid3d.layout(c.ibge) : null;
      L.push({ id: 'c' + c.ibge, x: Lc3 ? Lc3.cx : c.x, y: Lc3 ? Lc3.cy : c.y, alt: perto ? 2.5 : 0, txt: c.nome, sub: perto ? nivelCidade(c) : undefined, cls: 'cid' + (perto ? ' amar' : c.n > 300 || cap ? ' g' : c.n < 30 ? ' p' : ''), pri, dy: perto ? 0 : -raioMarcadorPx(c.n) - 2 });
    }
    if (D < 80) {
      const eu = ctx.eu(); const sg = ctx.sel?.tipo === 'casa' ? ctx.sel.gi : -1;
      const fx = cam.st.fx, fy = cam.st.fy;
      const perto = cid3d.casas.map((h) => ({ h, d: Math.hypot(h.x - fx, h.y - fy) })).filter((o) => o.d < D * 0.9).sort((a, b) => a.d - b.d).slice(0, 60);
      for (const { h, d } of perto) {
        const cg = dados.cargo(h.gi), fr = dados.p.frases[dados.USR[h.gi]];
        const glifo = cg === 'M' ? '★ ' : cg === 'P' ? '♛ ' : cg === 'G' ? '♜ ' : '';
        const pri = 2000 - d * 10 + (h.gi === sg ? 1e6 : 0) + (h.gi === eu ? 5e5 : 0) + (cg && cg !== 'V' ? 400 : 0);
        const fund = dados.CID[dados.CID_DE[h.gi]]?.fund === h.gi;
        const ic = cg === 'M' ? '🏛' : cg === 'P' ? '👑' : cg === 'G' ? '🏰' : fund ? '🚩' : '';
        L.push({ id: 'h' + h.gi, x: h.x, y: h.y, alt: h.alt + 0.3, txt: '@' + dados.USR[h.gi], ic, cls: 'casa' + (h.gi === eu || h.gi === sg ? ' eu' : fund ? ' fund' : ''), pri: pri + (fund ? 300 : 0) });
        if (fr && D < 50) L.push({ id: 'f' + h.gi, x: h.x, y: h.y, alt: h.alt + 1.2, txt: fr, sub: (glifo ? glifo : '') + '@' + dados.USR[h.gi], cls: 'frase', pri: pri - 1, dy: -22 });
      }
    }
    if (D < 60) for (const r of ruaViva.rotulos()) L.push({ id: r.id, x: r.x, y: r.y, alt: 1.3, txt: r.txt, cls: 'casa eu', pri: 8e5 });
    if (D < 260) for (const lv of cid3d.lojas) { const l = lv.loja, ini = l.nome.split(/s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
      const html = `<div class="pat-box"><span class="pat-logo" style="background:${esc(l.cor)}">${esc(ini)}</span><span>${esc(l.nome)}</span>${l.ig ? `<span class="pat-h">@${esc(l.ig)}</span>` : ''}<span class="pat-selo">☆ PATROCINADO</span><span class="pat-pts">+${PONTOS.seguirLoja}</span></div>`;
      L.push({ id: 'l' + l.id, x: lv.x, y: lv.y, alt: 4.4, txt: l.nome, html, larg: 160 + l.nome.length * 9 + (l.ig ? l.ig.length * 7 : 0), cls: 'pat', pri: 9e5, dy: -12 }); }
    if (D > 600) {
      const fr = Object.keys(dados.p.frases); const k0 = Math.floor(t / 7);
      for (let k = 0; k < Math.min(2, fr.length); k++) { const h = fr[(k0 * 2 + k) % fr.length], gi = dados.POR_HANDLE.get(h); if (gi === undefined) continue; const c = dados.CID[dados.CID_DE[gi]]; const cg = dados.cargo(gi); L.push({ id: 'fa' + gi, x: c.x, y: c.y, txt: dados.p.frases[h], sub: (cg ? CARGOS_NOME[cg] + ' ' : '') + '@' + h, cls: 'alta', pri: 5e5, dy: -14 }); }
    }
    const topo = $('topo').getBoundingClientRect(), tab = $('tabbar').getBoundingClientRect(), cart = $('cartao');
    const res = [{ x0: 0, y0: 0, x1: W, y1: topo.bottom }, { x0: tab.left, y0: tab.top, x1: tab.right, y1: H }];
    if (!cart.hidden) { const r = cart.getBoundingClientRect(); res.push({ x0: r.left, y0: r.top, x1: r.right, y1: r.bottom }); }
    rot.reservar(res);
    rot.desenhar(L, (x, y, a) => cam.projetar(x, y, a ?? 0), W, H, ehCel ? (D < 80 ? 9 : D > 3500 ? 22 : 11) : (D < 80 ? 14 : D > 3500 ? 40 : 20));
    // anel na cidade escolhida
    if (ctx.sel?.tipo === 'cid' && D < 2500) {
      const c = ctx.sel.c, Lc = cid3d.layout(c.ibge), r = Lc ? Lc.raio : 4;
      const [px, py, ok] = cam.projetar(c.x, c.y), [qx] = cam.projetar(c.x + r, c.y);
      const rr = Math.max(16, Math.abs(qx - px)); ring.hidden = !ok;
      ring.style.left = px + 'px'; ring.style.top = py + 'px'; ring.style.width = ring.style.height = rr * 2 + 'px';
    } else ring.hidden = true;
  });

  /* ---------- entrada por URL ---------- */
  const sp = new URLSearchParams(location.search);
  const u = sp.get('u'), cidp = sp.get('c');
  if (u) { const gi = dados.POR_HANDLE.get(normHandle(u)); if (gi !== undefined) { q.value = dados.USR[gi]; setTimeout(() => ctx.mostrarCasa(gi), 600); } else ctx.abrirCartao(avisoNaoAchei(u)); }
  else if (cidp) { const c = dados.POR_IBGE.get(Number(cidp)); if (c) setTimeout(() => ctx.mostrarCidade(c), 600); }
  const aba = sp.get('aba') || location.hash.slice(1); if (aba) setTimeout(() => ctx.paineis.abrir(aba), 400);

  // conta real logada: avatar na frente da própria casa + atalho "ver minha casa"
  async function carregarEu() {
    (window as any).__atualizarPerfil?.();
    const r = await api.eu(); if (!r.ok || !r.casa) { cid3d.definirMeuAvatar(null); return; }
    const casa = r.casa; cid3d.definirMeuAvatar({ ibge: casa.cidade.ibge, lote: casa.lote_index, config: (r.avatar?.config || {}) as any });
    (window as any).__irMinhaCasa = () => { const c = dados.POR_IBGE.get(casa.cidade.ibge); if (c) cid3d.forcar(c); const p = cid3d.posicaoLote(casa.cidade.ibge, casa.lote_index); if (p) mundo.camera.voar({ fx: p.x, fy: p.y, ld: Math.log(7), phi: 38 }); setTimeout(() => cid3d.acenarEu(), 2500); };
  }
  (window as any).__carregarEu = carregarEu; void carregarEu();
  // empresas virtuais de moradores viram prédios no mapa
  fetch('/api/empresas/mapa', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => { if (j?.ok) cid3d.definirEmpresas(j.empresas.map((e: any) => ({ id: e.id, nome: e.nome, tipo: 'empresa', ibge: e.ibge, cor: e.cor, desc: e.ramo, ate: '', patrocinado: true, dono_lote: e.dono_lote }))); }).catch(() => {});
  // boneco no local de trabalho: empresa → frente do escritório; loja → loja do ramo na cidade; serviço público → praça
  const LOJA_DA_PROF: Record<string, string[]> = { barista: ['cafe'], personal: ['academia'], vendedor: [] };
  async function localTrabalho(): Promise<{ x: number; y: number; yaw: number } | null> {
    const r = await fetch('/api/trabalho', { credentials: 'same-origin' }).then((x) => x.json()).catch(() => null); const eu = await api.eu();
    if (!r?.ok || !r.emprego || !eu.ok || !eu.casa) return null;
    const ib = eu.casa.cidade.ibge; const c = dados.POR_IBGE.get(ib); if (c) cid3d.forcar(c);
    if (r.emprego.local_tipo === 'empresa' && r.emprego.local_ref) return cid3d.posicaoEmpresa(r.emprego.local_ref);
    if (r.emprego.local_tipo === 'loja') return cid3d.lojaDoTipo(ib, LOJA_DA_PROF[r.emprego.profissao] || []);
    return null;
  }
  (window as any).__irEmpresa = async (id: string, ibge: number) => { const c = dados.POR_IBGE.get(ibge); if (c) cid3d.forcar(c); await new Promise((r) => setTimeout(r, 300)); const p = cid3d.posicaoEmpresa(id); if (p) { let psi = (p.yaw * 180) / Math.PI; while (psi - mundo.camera.st.psi > 180) psi -= 360; while (psi - mundo.camera.st.psi < -180) psi += 360; mundo.camera.voar({ fx: p.x, fy: p.y, ld: Math.log(10), phi: 26, psi }); } };
  async function aplicarTrabalho(t: boolean) { cid3d.trabalhando(t, t ? await localTrabalho() : null); }
  (window as any).__trabalhando = (t: boolean) => void aplicarTrabalho(t);
  fetch('/api/trabalho', { credentials: 'same-origin' }).then((x) => x.json()).then((r) => { const t = r?.turno; if (t && !t.recompensado && new Date(t.fim).getTime() > Date.now()) setTimeout(() => void aplicarTrabalho(true), 1500); }).catch(() => {});
  // sino de notificações
  const sino = document.createElement('button'); sino.id = 'sino'; sino.type = 'button'; sino.setAttribute('aria-label', 'notificações'); sino.innerHTML = '<span aria-hidden="true">🔔</span><i hidden></i>';
  sino.onclick = () => ctx.paineis.abrir('notificacoes'); $('topo').append(sino);
  async function pollNotif() { const r = await fetch('/api/notificacoes', { credentials: 'same-origin' }).then((x) => x.json()).catch(() => null); const b = sino.querySelector('i')!; sino.hidden = !r?.ok; if (r?.ok) { b.hidden = !r.naoLidas; b.textContent = r.naoLidas > 9 ? '9+' : String(r.naoLidas); } }
  void pollNotif(); setInterval(pollNotif, 30000); (window as any).__pollNotif = pollNotif;
  const ruaViva = iniciarRuaViva(ctx, cid3d);
  iniciarJornal(ctx);
  (window as any).ctx = ctx; (window as any).__cid3d = cid3d;
  return ctx;
}
