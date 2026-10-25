/* Painel do estabelecimento patrocinado (jogador): fachada, interior com mesas/slots, contato, cupons, eventos e links
   externos com destino claro. Montado dentro de um .painel-corpo: montarPainelLoja(corpo, ctx, lojaId).
   A política etária e a validação de URL são do SERVIDOR; aqui só exibimos o que ele liberou (e reconferimos a URL). */
import type { Ctx } from './app';
import { MUN } from '../dados/dados';
import { el, botao, toast, ICONES } from './dom';
import { apiEstabelecimentos as api, urlExternaSegura, type EstabelecimentoUI, type CupomUI } from '../api/estabelecimentos';
import './painel-loja.css';

const NOME_CATEGORIA: Record<string, string> = { cafeteria: 'Cafeteria', restaurante: 'Restaurante', loja: 'Loja', pet: 'Pet shop', eventos: 'Espaço de eventos', bar: 'Bar' };
const ROTULO_LINK: Record<string, string> = { site: 'site', instagram: 'Instagram', whatsapp: 'WhatsApp', cardapio: 'cardápio', mapa: 'mapa' };
const dataBR = (iso: string) => { const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return isNaN(+d) ? iso : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }); };
const horaBR = (iso: string) => { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const corSegura = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#ffd23f');
function telBR(t: string) { const d = t.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, ''); return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : d.length === 10 ? `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}` : t; }

export async function montarPainelLoja(corpo: HTMLElement, ctx: Ctx, lojaId: string): Promise<void> {
  corpo.innerHTML = '';
  const carregando = el('div', 'cartao-b pl-carrega'); carregando.append(el('span', 'spin'), el('span', '', 'abrindo o estabelecimento…'));
  corpo.append(carregando);
  const r = await api.detalhe(lojaId);
  carregando.remove();
  if (!r.ok) {
    const box = el('div', 'cartao-b');
    box.append(el('h2', '', r.status === 403 ? 'Conteúdo restrito' : r.status === 404 ? 'Este local não está no mapa' : 'Não consegui abrir agora'));
    box.append(el('p', 'nota', r.status === 403 ? 'Este espaço só abre para contas com maioridade confirmada.' : r.status === 404 ? 'O patrocínio pode ter terminado, ou é uma loja de demonstração do mapa estático.' : r.erro));
    corpo.append(box);
    return;
  }
  const v = r.estabelecimento;
  void api.visita(v.id);   // visita virtual (só conta com sessão; 1 por dia) — falha silenciosa para visitante
  corpo.append(fachada(ctx, v), interior(v));
  const ct = contato(v); if (ct) corpo.append(ct);
  if (v.cupons.length) corpo.append(cupons(v));
  if (v.eventos.length) corpo.append(eventos(v));
  rodape(corpo, ctx, v);
}

function fachada(ctx: Ctx, v: EstabelecimentoUI) {
  const cor = corSegura(v.cor);
  const box = el('div', 'cartao-b pl-fachada'); box.style.setProperty('--pl-cor', cor);
  const predio = el('div', 'pl-predio'); predio.setAttribute('aria-hidden', 'true');
  const toldo = el('div', 'pl-toldo'); for (let i = 0; i < 9; i++) toldo.append(el('i'));
  const placa = el('div', 'pl-placa', v.nome);
  const vitrine = el('div', 'pl-vitrine'); vitrine.append(el('span', 'pl-porta'));
  predio.append(placa, toldo, vitrine);
  box.append(predio);
  const selo = el('div', 'pl-selo'); const ic = el('span', 'pl-ic'); ic.innerHTML = ICONES.loja;
  selo.append(ic, el('b', 'etiq ink', v.selo || 'patrocinado'));
  if (v.patrocinio) selo.append(el('span', '', 'patrocínio até ' + dataBR(v.patrocinio.ate)));
  if (v.demo) selo.append(el('b', 'etiq vd', 'demonstração · fictício'));
  box.append(selo);
  const sub = el('div', 'ct-sub'); sub.append(el('span', '', NOME_CATEGORIA[v.categoria] || v.categoria), el('span', 'sep', '·'));
  const c = ctx.dados.POR_IBGE.get(v.ibge); const m = MUN.get(v.ibge);
  if (c) sub.append(botao('lk', `${c.nome} - ${c.uf}`, () => ctx.mostrarCidade(c)));
  else if (m) sub.append(el('span', '', `${m.nome} - ${m.uf}`));
  box.append(el('h2', 'pl-nome', v.nome), sub);
  if (v.descricao) box.append(el('p', 'loja-desc', v.descricao));
  box.append(el('p', 'nota', v.avisoVirtual));
  return box;
}

function interior(v: EstabelecimentoUI) {
  const box = el('div', 'cartao-b papel');
  box.append(el('h2', '', 'Lá dentro'));
  const grade = el('div', 'pl-mesas'); grade.setAttribute('role', 'img');
  grade.setAttribute('aria-label', `${v.interior.mesas} mesas com ${v.interior.lugaresPorMesa} lugares cada; capacidade ${v.interior.capacidade} pessoas`);
  for (let i = 0; i < v.interior.mesas; i++) {
    const mesa = el('div', 'pl-mesa'); mesa.append(el('span', 'pl-tampo', i + 1));
    const lug = el('div', 'pl-lugares'); for (let k = 0; k < v.interior.lugaresPorMesa; k++) lug.append(el('i'));
    mesa.append(lug); grade.append(mesa);
  }
  box.append(grade, el('p', 'nota', `${v.interior.mesas} mesas · até ${v.interior.capacidade} pessoas ao mesmo tempo no cenário virtual`));
  return box;
}

function contato(v: EstabelecimentoUI) {
  if (!v.endereco && !v.horario && !v.telefone && !v.links.length) return null;
  const box = el('div', 'cartao-b');
  box.append(el('h2', '', 'Contato'));
  const dl = el('dl', 'pl-dados');
  const item = (k: string, val: HTMLElement | string) => { dl.append(el('dt', '', k)); const dd = el('dd'); if (typeof val === 'string') dd.textContent = val; else dd.append(val); dl.append(dd); };
  if (v.endereco) item('endereço', v.endereco);
  if (v.horario) item('horário', v.horario);
  if (v.telefone) { const a = el('a', '', telBR(v.telefone)); a.href = 'tel:+' + (v.telefone.length <= 11 ? '55' : '') + v.telefone.replace(/\D/g, ''); item('telefone', a); }
  if (dl.childElementCount) box.append(dl);
  for (const l of v.links) {
    const u = urlExternaSegura(l.url); if (!u) continue;   // servidor já validou; aqui é a segunda checagem
    const a = el('a', 'btn bloco pl-link'); a.href = u.href; a.target = '_blank'; a.rel = 'noopener noreferrer nofollow sponsored';
    a.append(el('b', '', l.rotulo || ROTULO_LINK[l.tipo] || 'abrir link'), el('small', '', `sai do jogo e abre ${u.hostname} em nova aba ↗`));
    a.setAttribute('aria-label', `${l.rotulo}: abre ${u.hostname} em nova aba, fora do jogo`);
    a.addEventListener('click', () => { void api.clique(v.id, l.id); });
    box.append(a);
  }
  return box;
}

function cupons(v: EstabelecimentoUI) {
  const box = el('div', 'cartao-b am');
  box.append(el('h2', '', 'Cupons'));
  for (const cp of v.cupons) box.append(cupom(cp));
  box.append(el('p', 'nota', 'um cupom por pessoa. Mostre o código no balcão; as condições são do estabelecimento.'));
  return box;
}
function cupom(cp: CupomUI) {
  const d = el('div', 'pl-cupom');
  d.append(el('b', '', cp.titulo), el('small', '', cp.regras + ' · até ' + dataBR(cp.ate)));
  const area = el('div', 'pl-cupom-acao');
  const mostrar = (codigo: string) => { area.innerHTML = ''; const c = el('code', 'pl-codigo', codigo); area.append(c, botao('btn mini', 'copiar', async () => { try { await navigator.clipboard.writeText(codigo); toast('código copiado'); } catch { toast(codigo); } })); };
  if (cp.meuCodigo) mostrar(cp.meuCodigo);
  else if (cp.esgotado) area.append(el('span', 'etiq', 'esgotado'));
  else {
    const msg = el('span', 'msg');
    const b = botao('btn prim mini', 'pegar cupom', async () => {
      b.disabled = true; const r = await api.resgatar(cp.id); b.disabled = false;
      if (r.ok) { mostrar(r.codigo); if (r.jaResgatado) toast('você já tinha pego este cupom'); }
      else { msg.className = 'msg erro'; msg.textContent = r.status === 401 ? 'entre na sua conta (reivindique sua casa) para pegar o cupom.' : r.erro; }
    });
    area.append(b, msg);
  }
  d.append(area);
  return d;
}

function eventos(v: EstabelecimentoUI) {
  const box = el('div', 'cartao-b');
  box.append(el('h2', '', 'Eventos patrocinados'));
  for (const e of v.eventos) {
    const d = el('div', 'pl-evento');
    d.append(el('b', '', e.titulo), el('small', '', horaBR(e.inicio) + (e.capacidade ? ` · até ${e.capacidade} pessoas` : '')));
    if (e.descricao) d.append(el('p', '', e.descricao));
    d.append(el('span', 'etiq ink', 'patrocinado'));
    box.append(d);
  }
  return box;
}

function rodape(corpo: HTMLElement, ctx: Ctx, v: EstabelecimentoUI) {
  corpo.append(el('p', 'nota', 'Patrocínio é identificado e não compra voto, cargo nem vantagem no jogo.'));
  const linha = el('div', 'pl-rodape');
  linha.append(botao('btn', '+ seu negócio nesta cidade', () => ctx.paineis.abrir('negocio', { ibge: v.ibge })));
  linha.append(botao('btn lk', 'denunciar este local', async () => {
    const r = await api.denunciar(v.id, 'outro', 'denúncia pelo painel do estabelecimento');
    toast(r.ok ? 'denúncia recebida: a moderação vai olhar' : r.status === 401 ? 'entre na sua conta para denunciar' : r.erro);
  }));
  corpo.append(linha);
}
