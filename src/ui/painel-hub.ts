/* "Minha Casa" para conta logada: tudo da pessoa num lugar só e sempre com a PRÓXIMA AÇÃO clara.
   1) casa + avatar + nível (e como subir)  2) minha rua (vizinhos, líder, obra, competição)
   3) eleição da rua (candidatar, votar, ranking)  4) trabalho e empresa virtual  5) compartilhar. */
import type { Ctx } from './app';
import { el, botao, toast } from './dom';
import { criarPreviaAvatar, PADRAO } from '../mundo/avatares3d';
import { compartilharCartao } from './cartao-story';
import { NIVEIS, nivelDe } from '../jogo/regras';

function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function api(metodo: string, url: string, corpo?: unknown): Promise<any> {
  try { const r = await fetch('/api' + url, { method: metodo, credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': csrf() }, body: corpo === undefined ? undefined : JSON.stringify(corpo) }); const j = await r.json().catch(() => null); return j && typeof j === 'object' ? j : { ok: false, erro: 'erro ' + r.status }; }
  catch { return { ok: false, erro: 'servidor fora do ar' }; }
}
const secao = (tit: string, cls = '') => { const s = el('section', 'cartao-b hub ' + cls); s.append(el('h2', '', tit)); return s; };
const linha = (rot: string, val: string | HTMLElement) => { const l = el('div', 'linha'); l.append(el('span', '', rot), typeof val === 'string' ? el('b', '', val) : val); return l; };
const barra = (f: number) => { const b = el('div', 'barra'); const i = el('i'); i.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; b.append(i); return b; };

export async function montarHub(c: HTMLElement, ctx: Ctx, abrir: (id: string, o?: any) => void, fechar: () => void, eu: any) {
  const cs = eu.casa, rua = eu.rua;
  const [rv, el1, tr, rec] = await Promise.all([api('GET', '/rua-viva'), api('GET', '/eleicoes'), api('GET', '/trabalho'), api('GET', '/recompensas/eu')]);

  /* 1) casa e avatar */
  const s1 = secao('minha casa', 'am');
  const topo = el('div', 'hub-topo');
  const cv = el('canvas', 'hub-av'); topo.append(cv);
  const info = el('div', 'hub-info');
  info.append(el('b', 'hub-nome', '@' + (eu.usuario?.usuario_instagram || eu.usuario?.nome_publico || 'você')), el('span', '', `${cs.cidade.nome} · ${cs.cidade.uf}${rua ? ' · ' + rua.nome : ''}`));
  // houses.xp é espelho do ledger (não somar os dois); nível = mesma regra do mapa (nivelDe)
  const xp = rec.ok ? rec.resumo.xp_total : cs.xp || 0;
  const nv = nivelDe(xp), prox = NIVEIS[nv]?.min ?? xp;
  info.append(el('span', 'hub-pts', `⭐ ${xp.toLocaleString('pt-BR')} pontos no total${rec.ok ? ` · +${rec.resumo.xp_hoje} hoje (teto ${rec.resumo.teto_xp_dia})` : ''}`));
  info.append(el('span', 'hub-nv', `casa nível ${nv} · ${NIVEIS[nv - 1].nome}`), barra(xp / Math.max(1, prox)), el('small', 'nota', NIVEIS[nv] ? `${xp} de ${prox} XP para virar ${NIVEIS[nv].nome}` : 'nível máximo'));
  topo.append(info); s1.append(topo);
  setTimeout(() => { try { criarPreviaAvatar(cv, { ...PADRAO, ...(eu.avatar?.config || {}) } as any); } catch { cv.remove(); } }, 30);
  const b1 = el('div', 'hub-bts');
  b1.append(botao('btn prim', 'ver no mapa', () => { fechar(); (window as any).__irMinhaCasa?.(); }), botao('btn', 'editar avatar', () => abrir('avatar')), botao('btn', 'cartão pro story', async () => {
    const r = await compartilharCartao({ nome: eu.usuario?.nome_publico || 'eu', handle: eu.usuario?.usuario_instagram, cidade: cs.cidade.nome, uf: cs.cidade.uf, rua: rua?.nome, nivel: nv, avatar: eu.avatar?.config });
    toast(r === 'baixado' ? 'cartão baixado: poste no seu story' : r === 'compartilhado' ? 'cartão compartilhado' : 'ok');
  }));
  s1.append(b1);
  const como = el('details', 'hub-como'); como.append(el('summary', '', 'como a minha casa melhora?'));
  for (const [ic, t] of [['✅', 'missões do dia: +5 XP cada'], ['💼', 'trabalhar: +10 XP por dia'], ['💬', 'comentar num post do @viraruajogo: +5 XP por post/dia'], ['🤝', 'marcar @amigo que ganha a casa: +50 XP'], ['🏪', 'marcar o @ de uma loja do mapa: +10 XP'], ['🎉', 'eventos da cidade e da semana']]) { const l = el('div', 'expl-p'); l.append(el('span', 'expl-ic', ic), el('span', '', t)); como.append(l); }
  como.append(el('p', 'nota', 'a casa sobe de nível com o XP e nunca desce. Teto de 100 XP por dia para ninguém ganhar no cansaço.'));
  como.append(botao('btn mini', '📊 meus pontos e extrato', () => abrir('pontos')));
  s1.append(como); c.append(s1);

  /* 1b) pet da casa */
  const sp = secao('meu pet'); c.append(sp);
  void api('GET', '/pets/eu').then((p) => {
    if (!p.ok) { sp.remove(); return; }
    if (p.pet) sp.append(el('p', '', `${p.pet.especie === 'gato' ? '🐱' : '🐶'} ${p.pet.nome} está na frente da sua casa.`));
    else if (p.liberado) sp.append(el('p', '', '🔓 liberado! Escolha gato ou cachorro, a cor e o nome.'));
    else sp.append(el('p', '', `🔒 libera com ${p.meta} pontos · você tem ${p.pontos}`), barra(p.pontos / Math.max(1, p.meta)));
    const b = el('div', 'hub-bts'); b.append(botao('btn prim', p.pet ? 'trocar meu pet' : p.liberado ? 'adotar pet 🐾' : 'ver os pets', () => abrir('pet')), botao('btn', '🏛️ o que dá pra construir', () => abrir('construcoes'))); sp.append(b);
  });

  /* 2) minha rua */
  const s2 = secao('minha rua');
  if (rv.ok && rv.rua) {
    const online = rv.moradores.filter((m: any) => m.user_id !== rv.eu && m.estado !== 'offline').length;
    s2.append(linha('rua', rv.rua.nome), linha('moradores', `${rv.moradores.length} de 24`), linha('online agora', `🟢 ${online}`));
    const viz = el('div', 'hub-viz');
    for (const m of rv.moradores.slice(0, 12)) { const d = el('span', 'hub-vz' + (m.estado !== 'offline' ? ' on' : '')); d.textContent = '@' + (m.handle || 'vizinho'); viz.append(d); }
    s2.append(viz);
  } else s2.append(el('p', 'msg', 'sua casa ainda não está numa rua.'));
  const b2 = el('div', 'hub-bts');
  b2.append(botao('btn prim', 'abrir minha rua', () => abrir('ruas', { ruaId: rua?.id, cid: ctx.dados.POR_IBGE.get(cs.cidade.ibge) })), botao('btn', 'convidar amigo', () => abrir('ruas', { ruaId: rua?.id, cid: ctx.dados.POR_IBGE.get(cs.cidade.ibge) })), botao('btn', 'missões', () => abrir('missoes')));
  s2.append(b2); c.append(s2);

  /* 3) eleições */
  const s3 = secao('eleições virtuais', 'escuro');
  const els: any[] = el1.ok ? el1.eleicoes || [] : [];
  const lider = els.find((e) => e.cargo === 'lider');
  if (lider) {
    s3.append(el('p', '', `líder da rua · ${lider.statusTexto || lider.status}`));
    if (lider.eleitorado) s3.append(el('p', 'nota', `eleitorado ${lider.eleitorado} · quorum ${lider.quorum}`));
    const cand = el('div', 'hub-cand');
    for (const k of lider.candidatos || []) {
      const meu = lider.meuVoto?.candidato === k.id;
      const b = botao('v3-bar' + (meu ? ' on' : ''), '', async () => {
        if (lider.status !== 'votacao' && lider.status !== 'votação aberta' && !String(lider.status).includes('votacao')) { toast('a votação ainda não abriu'); return; }
        if (!confirm(`votar em @${k.handle} para líder da rua? dá para trocar até fechar.`)) return;
        const r = await api('POST', `/eleicoes/${lider.id}/voto`, { candidato: k.id }); toast(r.ok ? 'voto registrado ✓' : r.erro || 'não consegui votar'); if (r.ok) abrir('casa');
      });
      b.append(el('span', 'pos', meu ? '✓' : '•'), el('span', 'b', '@' + k.handle), el('span', 'n', k.votos !== null && k.votos !== undefined ? k.votos + ' votos' : meu ? 'seu voto' : 'votar'));
      cand.append(b);
    }
    if (!(lider.candidatos || []).length) cand.append(el('p', 'nota', 'ainda sem candidatos.'));
    s3.append(cand);
    const b3 = el('div', 'hub-bts');
    const inscricoes = String(lider.status).includes('inscri');
    if (!lider.minhaCandidatura && !inscricoes) s3.append(el('p', 'nota', 'candidaturas: de segunda a quinta 20h. Nesta fase dá para votar.'));
    if (!lider.minhaCandidatura && inscricoes) b3.append(botao('btn prim', 'me candidatar a líder', async () => {
      if (!confirm('quero concorrer a líder da minha rua nesta semana (só 1 cargo por semana).')) return;
      const r = await api('POST', `/eleicoes/${lider.id}/candidatura`, { confirmar: true, cargo: 'lider' });
      toast(r.ok ? 'candidatura registrada ✓' : r.erro || 'não deu'); if (r.ok) abrir('casa');
    }));
    else s3.append(el('p', 'nota', 'você é candidato(a) nesta eleição ✓'));
    b3.append(botao('btn', 'todas as eleições', () => abrir('eleicoes')), botao('btn', 'ranking', () => abrir('ranking')));
    s3.append(b3);
  } else { s3.append(el('p', '', 'nenhuma eleição aberta para você agora.')); const b3 = el('div', 'hub-bts'); b3.append(botao('btn', 'ver calendário', () => abrir('eleicoes')), botao('btn', 'ranking', () => abrir('ranking'))); s3.append(b3); }
  c.append(s3);

  /* 4) trabalho e empresa */
  const s4 = secao('trabalho');
  if (tr.ok) {
    const job = tr.emprego, prof = job ? tr.profissoes.find((p: any) => p.id === job.profissao) : null;
    if (!prof) {
      s4.append(el('p', 'nota', 'escolha uma profissão. Todo dia você vai trabalhar, seu boneco sai de casa e você ganha XP.'));
      const g = el('div', 'tipos');
      for (const p of tr.profissoes) {
        g.append(botao('', p.icone + ' ' + p.nome, async () => {
          let empresa: string | undefined;
          if (p.local === 'empresa' && p.id !== 'empreendedor') {
            const livres = tr.empresasDaCidade.filter((x: any) => x.ocupadas < x.vagas);
            if (!livres.length) { toast('nenhuma empresa com vaga na sua cidade agora: abra a sua!'); return; }
            const op = livres.map((x: any, i: number) => `${i + 1}. ${x.nome} (${x.ramo}) · ${x.vagas - x.ocupadas} vaga(s)`).join('\n');
            const k = Number(prompt('em qual empresa você quer trabalhar?\n' + op, '1')); const esc = livres[k - 1]; if (!esc) return; empresa = esc.id;
          }
          const r = await api('POST', '/trabalho/profissao', { profissao: p.id, empresa }); toast(r.ok ? 'agora você é ' + p.nome : r.erro); if (r.ok) abrir('casa');
        }));
      }
      s4.append(g);
    } else {
      s4.append(linha('profissão', prof.icone + ' ' + prof.nome), el('p', 'nota', prof.desc));
      const t = tr.turno, agora = Date.now();
      if (!t) s4.append(botao('btn prim bloco', 'ir trabalhar (' + tr.turnoMin + ' min)', async () => { const r = await api('POST', '/trabalho/ir'); toast(r.ok ? 'bom trabalho! seu boneco saiu de casa' : r.erro); if (r.ok) { (window as any).__trabalhando?.(true); abrir('casa'); } }));
      else if (!t.recompensado && new Date(t.fim).getTime() > agora) { const min = Math.ceil((new Date(t.fim).getTime() - agora) / 60000); s4.append(el('p', 'msg', `trabalhando… faltam ${min} min`), barra(1 - (new Date(t.fim).getTime() - agora) / (tr.turnoMin * 60000))); }
      else if (!t.recompensado) s4.append(botao('btn prim bloco', 'encerrar expediente e receber XP', async () => { const r = await api('POST', '/trabalho/encerrar'); toast(r.ok ? `+${r.xp} XP` : r.erro); (window as any).__trabalhando?.(false); abrir('casa'); }));
      else s4.append(el('p', 'msg ok', 'expediente de hoje concluído ✓ volte amanhã'));
    }
    // empresa virtual
    const emp = tr.minhaEmpresa; const e = el('div', 'hub-emp');
    if (emp) {
      e.append(el('b', '', '🏢 ' + emp.nome), el('span', 'nota', `${emp.ramo} · registro ${emp.registro} (virtual)`));
      const det = await api('GET', '/empresas/minha');
      const fs = det.ok ? det.funcionarios || [] : [];
      e.append(linha('funcionários', `${fs.length} de ${emp.vagas} vagas`));
      for (const f of fs) { const l = el('div', 'linha'); l.append(el('span', '', `@${f.handle || 'morador'} · ${f.turnos_semana} turno(s) na semana`), botao('btn mini', 'dispensar', async () => { if (!confirm('dispensar este funcionário?')) return; const r = await api('POST', '/empresas/minha/demitir', { userId: f.user_id }); toast(r.ok ? 'funcionário dispensado' : r.erro); abrir('casa'); })); e.append(l); }
      if (!fs.length) e.append(el('p', 'nota', 'ninguém trabalha aqui ainda. Moradores da cidade escolhem sua empresa ao virar programador(a).'));
      const vg = el('div', 'hub-bts'); vg.append(botao('btn mini', '− vaga', async () => { const r = await api('POST', '/empresas/minha/vagas', { vagas: emp.vagas - 1 }); if (r.ok) abrir('casa'); else toast(r.erro); }), botao('btn mini', '+ vaga', async () => { const r = await api('POST', '/empresas/minha/vagas', { vagas: emp.vagas + 1 }); if (r.ok) abrir('casa'); else toast(r.erro); }), botao('btn mini', 'ver no mapa', () => { fechar(); (window as any).__irEmpresa?.(emp.id, emp.ibge); }));
      e.append(vg);
    }
    else {
      e.append(el('b', '', 'abra sua empresa virtual'), el('span', 'nota', 'contrate moradores da sua cidade. O registro é do jogo, não é CNPJ.'));
      const nm = el('input', 'frase-inp'); nm.placeholder = 'nome da empresa'; nm.maxLength = 40;
      const rm = el('select', 'frase-inp'); for (const r of tr.ramos) { const o = el('option', '', r); o.value = r; rm.append(o); }
      const cor = el('input'); cor.type = 'color'; cor.value = '#3a86ff'; cor.title = 'cor da marca'; cor.className = 'hub-cor';
      e.append(nm, rm, cor, botao('btn', 'abrir empresa', async () => { const r = await api('POST', '/empresas', { nome: nm.value, ramo: rm.value, cor: cor.value }); toast(r.ok ? 'empresa aberta: ' + r.empresa.registro : r.erro); if (r.ok) abrir('casa'); }));
    }
    s4.append(e);
  } else s4.append(el('p', 'msg erro', tr.erro));
  c.append(s4);
}
