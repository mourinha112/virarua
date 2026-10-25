/* Painel das eleições virtuais (líder da rua, prefeito, presidente) ligado ao servidor.
   Uso: montarPainelEleicoes(corpo, ctx) — quem pluga em paineis.ts decide onde abrir. Só classes de estilo.css. */
import type { Ctx } from './app';
import { el, botao, toast } from './dom';
import { eleicoesApi, type EleicaoV, type CalendarioV, type CargoId } from '../api/eleicoes';

const SELO = 'eleição virtual — jogo, sem vínculo com eleições reais';
const ABAS: { id: CargoId; rot: string }[] = [{ id: 'lider', rot: 'rua' }, { id: 'prefeito', rot: 'cidade' }, { id: 'presidente', rot: 'Brasil' }];
const FASE: Record<string, string> = { inscricoes: 'inscrições e campanha', eleitorado_congelado: 'eleitorado congelado', votacao: 'votação aberta', apuracao: 'apuração', resultado: 'resultado publicado' };
const fmtData = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const quando = (iso: string | null | undefined) => (iso ? fmtData.format(new Date(iso)) : '—');
function falta(iso: string) {
  const ms = Math.max(0, new Date(iso).getTime() - Date.now());
  return `${Math.floor(ms / 86400000)}d ${String(Math.floor((ms % 86400000) / 3600000)).padStart(2, '0')}h ${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}min`;
}

export function montarPainelEleicoes(corpo: HTMLElement, _ctx?: Ctx, abaInicial?: CargoId, entrar?: () => void) {
  corpo.innerHTML = '';
  let aba: CargoId = abaInicial || 'prefeito';
  let lista: EleicaoV[] = [], publico = true;

  const topo = el('div', 'cartao-b escuro');
  topo.append(el('h2', '', 'eleições virtuais'), el('p', '', 'líder da rua, prefeito e presidente são cargos do jogo. Um voto por pessoa em cada cargo, sempre com peso 1.'));
  const selo = el('span', 'etiq am', SELO); topo.append(selo);
  const cont = el('p', 'contagem'); topo.append(cont);
  corpo.append(topo);
  const guia = el('div', 'cartao-b'); corpo.append(guia);

  const cal = el('div', 'cartao-b'); cal.append(el('h2', '', 'calendário da semana'), el('p', 'nota', 'carregando…'));
  corpo.append(cal);

  const tabs = el('div', 'seg'); tabs.setAttribute('role', 'tablist');
  const caixa = el('div', 'cartao-b'); caixa.setAttribute('aria-live', 'polite');
  for (const a of ABAS) { const b = botao('', a.rot, () => { aba = a.id; pintar(); }); b.dataset.k = a.id; b.setAttribute('role', 'tab'); tabs.append(b); }
  corpo.append(tabs, caixa);
  const meuCargo = el('div'); corpo.append(meuCargo);
  corpo.append(el('p', 'contagem', SELO));

  async function carregar() {
    const [rc, rl] = await Promise.all([eleicoesApi.calendario(), eleicoesApi.listar()]);
    desenharCalendario(rc.ok ? rc : null, rc.ok ? '' : rc.erro);
    if (!rl.ok) { lista = []; caixa.innerHTML = ''; caixa.append(el('p', 'msg erro', rl.erro || 'servidor de eleições indisponível agora.')); return; }
    lista = rl.eleicoes; publico = rl.publico;
    // sem aba pedida: abre na primeira com algo pra fazer (votar ou se candidatar)
    if (!abaInicial) { const alvo = lista.find((e) => (e.status === 'votacao' && !e.meuVoto) || (e.status === 'inscricoes' && !e.minhaCandidatura)); if (alvo) aba = alvo.cargo; }
    if (rc.ok && rc.meuCargo) desenharMeuCargo();
    desenharGuia(rc.ok ? rc.fase : '');
    pintar();
  }

  function desenharCalendario(c: CalendarioV | null, erro: string) {
    cal.innerHTML = ''; cal.append(el('h2', '', 'calendário da semana'));
    if (!c) { cal.append(el('p', 'msg erro', erro || 'calendário indisponível')); return; }
    const t = c.temporada;
    const alvo = c.fase === 'inscricoes' ? t.inscricoesFecham : c.fase === 'eleitorado_congelado' ? t.votacaoAbre : c.fase === 'votacao' ? t.votacaoFecha : c.fase === 'apuracao' ? t.publicaEm : t.mandatoFim;
    const pinta = () => { cont.textContent = `${FASE[c.fase] || c.fase} · próxima etapa em ${falta(alvo)}`; };
    pinta(); const tm = setInterval(() => (cont.isConnected ? pinta() : clearInterval(tm)), 30000);
    const linhas: [string, string][] = [
      ['inscrições até', quando(t.inscricoesFecham)], ['votação abre', quando(t.votacaoAbre)], ['votação fecha', quando(t.votacaoFecha)],
      ['resultado e posse', quando(t.publicaEm)], ['mandato vai até', quando(t.mandatoFim)],
    ];
    for (const [k, v] of linhas) { const l = el('div', 'linha'); l.append(el('span', '', k), el('b', '', v)); cal.append(l); }
    cal.append(el('p', 'nota', 'horários de Brasília, pelo relógio do servidor do jogo.'));
    const mand = el('section', 'bloco'); mand.append(el('h3', '', 'mandatos vigentes'));
    for (const m of c.mandatos) {
      const l = el('div', 'linha'); const s = el('span'); s.append(el('b', '', m.cargoNome), el('small', '', ' · ' + m.escopoNome));
      l.append(s, el('span', m.vago ? 'chip' : 'chip am', m.vago ? 'vago · calendário neutro' : '@' + m.ocupante + ' até ' + quando(m.fim)));
      mand.append(l);
    }
    cal.append(mand);
  }

  const irPara = (cargo: CargoId) => { aba = cargo; pintar(); caixa.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  /** guia no topo: no dia de votar, um botão por cargo; sempre, o passo a passo de como se candidatar */
  function desenharGuia(fase: string) {
    guia.innerHTML = ''; guia.className = 'cartao-b';
    const votando = lista.filter((e) => e.status === 'votacao');
    if (votando.length) {
      guia.className = 'cartao-b am';
      guia.append(el('h2', '', '🗳️ hoje é dia de votar'), el('p', '', 'escolha o cargo e toque no nome de quem você quer. Dá pra trocar o voto até fechar.'));
      const bts = el('div', 'hub-bts');
      for (const a of ABAS) {
        const e = votando.find((x) => x.cargo === a.id); if (!e) continue;
        bts.append(botao(e.meuVoto && !e.meuVoto.invalido ? 'btn' : 'btn prim', `${e.meuVoto && !e.meuVoto.invalido ? '✅' : '🗳️'} ${e.cargoNome} · ${a.rot}${e.meuVoto && !e.meuVoto.invalido ? ' (já votei)' : ''}`, () => irPara(a.id)));
      }
      guia.append(bts);
      if (publico) guia.append(el('p', 'nota', 'para votar, confirme a sua casa primeiro.'));
    }
    const det = el('details', 'hub-como'); det.open = !votando.length;
    det.append(el('summary', '', '✋ como me candidatar?'));
    const passos: [string, string][] = [
      ['🏠', 'confirme a sua casa (link do direct ou código de verificação)'],
      ['📅', 'inscrições de segunda a quinta; votação de sexta a domingo; resultado domingo 21h'],
      ['👆', 'escolha a aba do cargo: rua (líder), cidade (prefeito) ou Brasil (presidente)'],
      ['📣', 'toque em "quero me candidatar" e confirme. Vale um cargo por semana'],
      ['🤝', 'para presidente, outros moradores precisam te apoiar antes da votação'],
      ['📲', 'peça votos: mande o link do jogo pros vizinhos da sua rua e da sua cidade'],
    ];
    for (const [ic, t] of passos) { const l = el('div', 'expl-p'); l.append(el('span', 'expl-ic', ic), el('span', '', t)); det.append(l); }
    const alvo = lista.find((e) => e.status === 'inscricoes' && e.turno === 1 && !e.minhaCandidatura);
    const minha = lista.find((e) => e.minhaCandidatura?.estado === 'inscrito');
    if (publico) { if (entrar) det.append(botao('btn prim bloco', 'confirmar minha casa', entrar)); }
    else if (minha) det.append(el('p', 'msg ok', `você é candidato a ${minha.cargoNome} (${minha.escopoNome}). Agora é pedir votos!`));
    else if (alvo) det.append(botao('btn prim bloco', `📣 quero me candidatar a ${alvo.cargoNome}`, () => irPara(alvo.cargo)));
    else det.append(el('p', 'nota', fase === 'inscricoes' ? 'nenhuma vaga aberta para você agora.' : 'as inscrições abrem na segunda-feira.'));
    guia.append(det);
  }
  /** selo da aba: votar, já votou ou inscrições abertas */
  function seloAba(cargo: CargoId) {
    const es = lista.filter((e) => e.cargo === cargo);
    if (es.some((e) => e.status === 'votacao' && (!e.meuVoto || e.meuVoto.invalido))) return ' 🗳️';
    if (es.some((e) => e.status === 'votacao')) return ' ✅';
    if (es.some((e) => e.status === 'inscricoes')) return ' ✋';
    return '';
  }

  function pintar() {
    tabs.querySelectorAll<HTMLButtonElement>('button').forEach((b) => { const on = b.dataset.k === aba; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); b.textContent = (ABAS.find((a) => a.id === b.dataset.k)?.rot || '') + seloAba(b.dataset.k as CargoId); });
    caixa.innerHTML = '';
    const doCargo = lista.filter((e) => e.cargo === aba);
    if (publico) { caixa.append(el('p', 'nota', 'para se candidatar e votar, confirme a sua casa (link do direct ou código de verificação).')); if (entrar) caixa.append(botao('btn prim bloco', 'confirmar minha casa', entrar)); }
    if (!doCargo.length) { caixa.append(el('p', 'msg', aba === 'presidente' ? 'nenhuma eleição virtual nacional aberta agora.' : 'nenhuma eleição virtual deste escopo para você agora.')); return; }
    for (const e of doCargo) caixa.append(desenharEleicao(e));
  }

  function desenharEleicao(e: EleicaoV) {
    const b = el('section', 'bloco');
    b.append(el('h3', '', `${e.cargoNome} · ${e.escopoNome}${e.turno === 2 ? ' · segundo turno' : ''}`));
    const tags = el('div', 'voto-chips'); tags.append(el('span', 'etiq', e.statusTexto), el('span', 'chip', 'eleição virtual'));
    if (e.modo === 'confirmacao') tags.append(el('span', 'chip am', 'candidatura única'));
    b.append(tags);
    const p = e.prazos;
    const prazo = e.status === 'inscricoes' ? `inscrições até ${quando(p.inscricoesFecham)}` : e.status === 'congelada' ? `votação abre ${quando(p.votacaoAbre)}`
      : e.status === 'votacao' ? `votação fecha ${quando(p.votacaoFecha)} (faltam ${falta(p.votacaoFecha)})` : e.status === 'apuracao' ? `resultado ${quando(p.publicaEm)}` : '';
    if (prazo) b.append(el('p', 'nota', prazo));
    if (e.eleitorado !== null) b.append(el('p', 'nota', `eleitorado congelado: ${e.eleitorado} · quorum: ${e.quorum}`));

    if (e.resultado) {
      const r = el('div', 'bloco am'); r.append(el('h3', '', e.resultado.corrigido ? 'resultado (corrigido em revisão pública)' : 'resultado'));
      r.append(el('p', '', (e.resultado.vencedor ? '@' + e.resultado.vencedor + ' · ' : '') + e.resultado.texto));
      if (e.resultado.votosValidos !== null) r.append(el('p', 'nota', `votos válidos: ${e.resultado.votosValidos}`));
      b.append(r);
    }
    if (e.meuVoto?.invalido && e.status === 'votacao') b.append(el('p', 'msg erro', 'a candidatura em que você votou saiu da disputa: seu voto ficou inválido. Escolha de novo até o fechamento.'));
    else if (e.meuVoto) b.append(el('p', 'msg ok', `seu voto está registrado (${quando(e.meuVoto.em)}). Você pode trocar até o fechamento; só você vê sua escolha.`));
    if (e.souEleitor === false && e.status === 'votacao') b.append(el('p', 'nota', 'você não está no eleitorado congelado desta eleição virtual (novos moradores votam na próxima).'));

    const max = Math.max(1, ...e.candidatos.map((c) => c.votos ?? 0));
    const confirma = el('div', 'voto-box');
    if (!e.candidatos.length) b.append(el('p', 'msg', e.status === 'inscricoes' ? 'ainda sem candidaturas. Sem candidato, o cargo fica vago e o calendário neutro segue.' : 'sem candidaturas.'));
    e.candidatos.forEach((c, i) => {
      const meu = e.meuVoto?.candidato === c.id;
      const podeVotar = e.status === 'votacao' && !publico && e.souEleitor !== false;
      const item = botao('v3-bar', '', podeVotar ? () => pedirConfirmacao(e, c.id, '@' + c.handle) : undefined, podeVotar ? `votar em ${c.handle}` : undefined);
      if (!podeVotar) item.disabled = e.status !== 'votacao';
      const bb = el('span', 'b'); bb.append(el('b', '', '@' + c.handle + (meu ? ' · seu voto' : '')));
      if (c.apoios !== undefined && e.status === 'inscricoes') bb.append(el('small', '', `${c.apoios}/${c.apoiosNecessarios} apoios (apoio não é voto)`));
      if (c.votos !== null) { const bar = el('i'); const s = el('s'); s.style.width = Math.round(((c.votos ?? 0) / max) * 100) + '%'; bar.append(s); bb.append(bar); }
      item.append(el('span', 'pos', i + 1), bb, el('span', 'n', c.votos !== null ? `${c.votos} votos` : ''));
      b.append(item);
      if (e.cargo === 'presidente' && e.status === 'inscricoes' && !publico && e.minhaCandidatura?.id !== c.id)
        b.append(botao('btn mini', `apoiar @${c.handle}`, async () => { const r = await eleicoesApi.apoiar(e.id, c.id); toast(r.ok ? `${r.mensagem}: ${r.apoios}/${r.necessarios}` : r.erro); if (r.ok) carregar(); }));
    });
    if (e.modo === 'confirmacao' && e.status === 'votacao' && !publico && e.souEleitor !== false)
      b.append(botao('btn mini', e.meuVoto?.candidato === 'rejeitar' ? 'rejeitar (seu voto)' : 'rejeitar a candidatura única', () => pedirConfirmacao(e, 'rejeitar', 'rejeitar a candidatura única')));
    if (e.placarVisivel) b.append(el('p', 'nota', `${e.placarProvisorio ? 'placar provisório' : 'placar'} · atualizado ${quando(e.placarAtualizadoEm)}`));
    else if (e.status === 'votacao') b.append(el('p', 'nota', `placar oculto: eleitorado menor que ${e.placarMinEleitorado} pessoas (protege o voto de cada um).`));
    b.append(confirma);

    function pedirConfirmacao(ev: EleicaoV, cand: string, rotulo: string) {
      confirma.innerHTML = '';
      const trocar = !!ev.meuVoto && !ev.meuVoto.invalido;
      confirma.append(el('p', '', `${trocar ? 'trocar seu voto para' : 'confirmar voto:'} ${rotulo}? (${ev.cargoNome} · ${ev.escopoNome})`));
      const linha = el('div', 'voto-chips');
      linha.append(
        botao('btn prim', trocar ? 'trocar voto' : 'confirmar voto', async () => { const r = await eleicoesApi.votar(ev.id, cand); toast(r.ok ? r.mensagem : r.erro, 3500); if (r.ok) carregar(); else confirma.append(el('p', 'msg erro', r.erro)); }),
        botao('btn', 'cancelar', () => { confirma.innerHTML = ''; }),
      );
      confirma.append(linha);
    }

    // candidatura com intenção explícita
    if (!publico && e.status === 'inscricoes' && e.turno === 1) {
      const minha = e.minhaCandidatura?.estado === 'inscrito';
      if (minha) b.append(botao('btn mini', 'retirar minha candidatura', async () => { if (!confirm('retirar sua candidatura desta eleição virtual?')) return; const r = await eleicoesApi.retirar(e.id); toast(r.ok ? r.mensagem : r.erro); if (r.ok) carregar(); }));
      else b.append(botao('btn prim bloco', `📣 quero me candidatar a ${e.cargoNome}`, () => pedirCandidatura(e, false)));
    }
    function pedirCandidatura(ev: EleicaoV, trocar: boolean) {
      confirma.innerHTML = '';
      confirma.append(el('p', '', `confirmar: quero concorrer a ${ev.cargoNome} de ${ev.escopoNome} nesta eleição virtual. Só é possível concorrer a um cargo por temporada.`));
      const linha = el('div', 'voto-chips');
      linha.append(
        botao('btn prim', trocar ? 'confirmar troca de candidatura' : 'confirmar candidatura', async () => {
          const r = await eleicoesApi.candidatar(ev.id, ev.cargo, trocar);
          if (r.ok) { toast(r.mensagem); carregar(); return; }
          confirma.append(el('p', 'msg erro', r.erro));
          if (/um cargo só/.test(r.erro) && !trocar) confirma.append(botao('btn mini', 'trocar para este cargo (apoios antigos caem)', () => pedirCandidatura(ev, true)));
        }),
        botao('btn', 'cancelar', () => { confirma.innerHTML = ''; }),
      );
      confirma.append(linha);
    }

    // regras visíveis (carregadas sob demanda)
    const det = el('details'); const sum = el('summary', '', 'regras desta eleição virtual'); det.append(sum);
    let carregou = false;
    det.addEventListener('toggle', async () => {
      if (!det.open || carregou) return; carregou = true;
      const r = await eleicoesApi.detalhe(e.id);
      if (!r.ok) { det.append(el('p', 'msg erro', r.erro)); return; }
      const ul = el('ul'); for (const s of r.eleicao.regras) ul.append(el('li', 'nota', s)); det.append(ul, el('p', 'nota', `versão ${r.eleicao.regraId}; mudanças valem para a próxima temporada.`));
      for (const c of r.eleicao.correcoes) det.append(el('p', 'msg', `correção pública (${quando(c.em)}): ${c.motivo}`));
    });
    b.append(det);
    return b;
  }

  async function desenharMeuCargo() {
    meuCargo.innerHTML = '';
    const r = await eleicoesApi.catalogo();
    if (!r.ok || !r.cargo) return;
    const box = el('div', 'cartao-b'); box.append(el('h2', '', `seu cargo virtual: ${r.cargoNome} · ${r.escopoNome}`), el('p', 'nota', `mandato até ${quando(r.fim)}. Escolhas só do catálogo aprovado; cargo não modera, não expulsa e não mexe em votos, regras ou moedas.`));
    const tipos = [...new Set(r.opcoes.map((o) => o.tipo))];
    for (const t of tipos) {
      const sec = el('section', 'bloco'); const vig = r.vigentes[t];
      sec.append(el('h3', '', t.replace('_', ' ')), el('p', 'nota', vig ? `em vigor: ${vig.nome}${vig.fonte === 'calendario_neutro' ? ' (calendário neutro)' : ''}` : ''));
      const chips = el('div', 'voto-chips');
      for (const o of r.opcoes.filter((x) => x.tipo === t)) chips.append(botao('voto-chip' + (vig?.opcao === o.id ? ' on' : ''), o.nome, async () => { const a = await eleicoesApi.acao(t, o.id); toast(a.ok ? `${a.nome}: ${a.mensagem}` : a.erro, 3500); if (a.ok) desenharMeuCargo(); }, o.descricao));
      sec.append(chips); box.append(sec);
    }
    box.append(botao('btn mini lk', 'renunciar ao cargo', async () => { if (!confirm('renunciar? o cargo fica vago até a próxima eleição virtual.')) return; const x = await eleicoesApi.renunciar(); toast(x.ok ? x.mensagem : x.erro); if (x.ok) carregar(); }));
    meuCargo.append(box);
  }

  pintar();
  carregar();
}
