/* Rua ao vivo (conta logada): vizinhos online aparecem na frente das casas deles, aceno entre vizinhos,
   faixa "sua rua escolhe o líder" com turnout/quorum e troféu nas ruas campeãs. Polling a cada 15 s. */
import type { Ctx } from './app';
import { $, el, botao, toast } from './dom';

type Morador = { user_id: string; lote_index: number; handle: string; avatar: any; estado: string };
type Resp = { ok: true; eu: string; rua: { id: string; nome: string; ibge: number } | null; moradores: Morador[]; acenos: { id: number; de_user: string; handle: string }[]; eleicao: any; campeas: { street_id: string; nome: string; tipo: string; lotes: number[] }[] };

function csrf() { const m = document.cookie.match(/(?:^|; )smn_csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : ''; }
async function get(): Promise<Resp | null> { try { const r = await fetch('/api/rua-viva', { credentials: 'same-origin' }); const j = await r.json(); return j && j.ok ? j : null; } catch { return null; } }
export async function acenar(para: string) { try { const r = await fetch('/api/rua-viva/acenar', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-csrf': csrf() }, body: JSON.stringify({ para }) }); return (await r.json()).ok; } catch { return false; } }

export function iniciarRuaViva(ctx: Ctx, cid3d: any) {
  let ultimoAceno = 0, dados: Resp | null = null;
  const faixa = el('div', 'rv-faixa'); faixa.hidden = true; $('topo').append(faixa);

  async function tick() {
    const r = await get(); dados = r;
    if (!r || !r.rua) { faixa.hidden = true; cid3d.definirVizinhos([]); return; }
    const ibge = r.rua.ibge;
    const online = r.moradores.filter((m) => m.user_id !== r.eu && m.estado !== 'offline');
    cid3d.definirVizinhos(online.map((m) => ({ id: 'v:' + m.user_id, ibge, lote: m.lote_index, config: m.avatar || {} })));
    cid3d.definirCampeas(r.campeas.map((c) => ({ ibge, lotes: c.lotes, tipo: c.tipo, nome: c.nome })));
    // acenos recebidos
    for (const a of r.acenos.slice().reverse()) if (a.id > ultimoAceno) { if (ultimoAceno) { toast(`@${a.handle || 'vizinho'} acenou pra você 👋`); cid3d.animarAvatar('v:' + a.de_user, 'aceno'); } ultimoAceno = Math.max(ultimoAceno, a.id); }
    if (!ultimoAceno) ultimoAceno = r.acenos[0]?.id || 1;
    // faixa da eleição da rua
    const e = r.eleicao; faixa.innerHTML = '';
    if (e && ['inscricoes', 'congelada', 'votacao'].includes(e.estado)) {
      const falta = e.quorum ? Math.max(0, e.quorum - e.votaram) : 0;
      const txt = e.estado === 'votacao'
        ? `🗳️ ${r.rua.nome} escolhe o líder · ${e.votaram} de ${e.eleitorado ?? '?'} votaram${falta ? ` · faltam ${falta} pro quorum` : ' · quorum atingido'}`
        : `🗳️ ${r.rua.nome}: inscrições para líder abertas · ${e.candidatos} candidato${e.candidatos === 1 ? '' : 's'}`;
      faixa.append(el('span', '', txt), botao('rv-btn', e.estado === 'votacao' ? 'votar' : 'ver', () => ctx.paineis.abrir('eleicoes')));
      faixa.hidden = false;
    } else faixa.hidden = true;
    // contador online
    const on = online.length;
    if (on) faixa.hidden = false, faixa.append(el('span', 'rv-on', `🟢 ${on} vizinho${on === 1 ? '' : 's'} online`));
  }
  void tick(); setInterval(tick, 15000);

  return {
    /** toque num avatar vizinho no mapa → acena */
    async tocar(x: number, y: number, projetar: (x: number, y: number, a?: number) => [number, number, boolean]) {
      if (!dados?.rua) return false;
      for (const m of dados.moradores) {
        if (m.user_id === dados.eu || m.estado === 'offline') continue;
        const p = cid3d.posicaoAvatar('v:' + m.user_id); if (!p) continue;
        const [px, py, ok] = projetar(p.x, p.y, 0.6); if (!ok || Math.hypot(px - x, py - y) > 40) continue;
        const ok2 = await acenar(m.user_id); cid3d.animarAvatar('eu', 'aceno');
        toast(ok2 ? `você acenou para @${m.handle || 'vizinho'} 👋` : 'não deu para acenar agora'); return true;
      }
      return false;
    },
    rotulos() { if (!dados?.rua) return [] as { id: string; x: number; y: number; txt: string }[];
      return dados.moradores.filter((m) => m.user_id !== dados!.eu && m.estado !== 'offline').map((m) => { const p = cid3d.posicaoAvatar('v:' + m.user_id); return p ? { id: 'rv' + m.user_id, x: p.x, y: p.y, txt: '🟢 @' + (m.handle || 'vizinho') + ' · toque p/ acenar' } : null; }).filter(Boolean) as any; },
  };
}
