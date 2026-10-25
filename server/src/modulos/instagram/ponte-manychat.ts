/* Ponte com o ManyChat (provisório, até a Meta aprovar o acesso avançado do app).
   O ManyChat já é aprovado: ele responde o comentário e manda o direct. Na automação, a ação "External Request"
   chama POST /api/ponte/manychat com o @ e o texto do comentário; o servidor cria (ou acha) a casa e devolve
   a mensagem pronta e o link, que o ManyChat coloca no direct.
   Segurança: só funciona com PONTE_MANYCHAT_CHAVE no .env e o cabeçalho X-Ponte-Chave igual (comparação em tempo
   constante). O @ vem do ManyChat (conta conectada), não de digitação no site.
   Identidade: escopo 'manychat' + @. Quando o app oficial receber o 1º comentário real desse @, ele assume essa
   identidade (mesma casa), como acontece com as casas criadas à mão (provisionar.ts). */
import type { App } from '../../http/app';
import { ErroHttp, limite } from '../../http/app';
import { config } from '../../config';
import { q, q1, tx } from '../../db/db';
import { obterToken } from './provedor';
import { iguais, sha256, tokenForte } from '../../seguranca/cripto';
import { resolverCidade } from '../cidades/resolver';
import { provisionar } from '../mundo/provisionar';

const chave = () => process.env.PONTE_MANYCHAT_CHAVE || '';
const url = () => config.urlPublica.replace(/\/+$/, '');

/** texto do comentário mais recente do @ nos posts de campanha ativos (Graph API), ou null */
async function ultimoComentarioDe(handle: string): Promise<string | null> {
  const conta = config.instagram.contaId; if (!conta) return null;
  const token = await obterToken(conta).catch(() => null); if (!token) return null;
  // posts mais recentes da conta (não depende de habilitar cada post no painel) + os habilitados no painel
  const rec: any = await fetch(`https://graph.instagram.com/${config.instagram.graphVersao}/me/media?fields=id&limit=5&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) })
    .then((r) => r.json()).catch(() => null);
  const hab = await q<{ media_id: string }>(`select media_id from enabled_media where conta_id = $1 and status = 'ativa' order by criado_em desc limit 5`, [conta]);
  const ids = [...new Set([...((rec?.data || []) as { id: string }[]).map((x) => String(x.id)), ...hab.map((h) => h.media_id)])];
  const midias = ids.map((media_id) => ({ media_id }));
  let melhor: { t: number; texto: string } | null = null;
  for (const m of midias) {
    let url: string | null = `https://graph.instagram.com/${config.instagram.graphVersao}/${encodeURIComponent(m.media_id)}/comments?fields=text,username,timestamp&limit=50&access_token=${encodeURIComponent(token)}`;
    for (let pag = 0; url && pag < 4; pag++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(8000) }).catch(() => null);
      const j: any = r ? await r.json().catch(() => null) : null;
      if (!j || j.error) break;
      for (const cm of j.data || []) {
        if (String(cm.username || '').toLowerCase() !== handle) continue;
        const t = Date.parse(cm.timestamp || '') || 0;
        if (!melhor || t > melhor.t) melhor = { t, texto: String(cm.text || '') };
      }
      url = j.paging?.next || null;
    }
  }
  return melhor?.texto || null;
}

export function registrarPonteManychat(app: App) {
  app.post('/api/ponte/manychat', limite(120), async (c) => {
    const k = chave();
    if (!k) throw new ErroHttp(404, 'não encontrado');
    if (!iguais(sha256(String(c.req.header('x-ponte-chave') || '')), sha256(k))) throw new ErroHttp(401, 'chave inválida');
    const b = await c.req.json().catch(() => ({} as any));
    // aceita o corpo simples {username, texto} ou o "Full Contact Data" do ManyChat (ig_username + custom_fields.cidade)
    const cf = b.custom_fields && typeof b.custom_fields === 'object' ? b.custom_fields : {};
    const handle = String(b.username || b.ig_username || '').replace(/^@/, '').trim().toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new ErroHttp(400, 'username inválido');
    // ?origem=comentario: o ManyChat não manda o texto do comentário, então lemos o último comentário desse @
    // nos posts de campanha direto da Graph API (posts da própria conta: liberado sem a análise da Meta)
    const origem = c.req.query('origem') || '';
    let texto = '';
    if (origem === 'comentario') {
      // o comentário pode levar alguns segundos para aparecer na Graph API: tenta de novo até 3x
      for (let i = 0; i < 4 && !texto; i++) {
        if (i) await new Promise((r) => setTimeout(r, 2500));
        texto = (await ultimoComentarioDe(handle)) || '';
      }
    }
    if (!texto) texto = String(b.texto || b.comentario || b.text || cf.cidade || cf.Cidade || b.last_input_text || '');
    texto = texto.slice(0, 300);

    const res = await resolverCidade(texto);
    if (res.tipo !== 'ok') {
      const mensagem = res.tipo === 'ambigua'
        ? `Tem mais de uma cidade com esse nome 😅 (${res.candidatos.slice(0, 4).map((x) => `${x.nome} - ${x.uf}`).join(', ')}). Me manda com o estado, assim: ${res.candidatos[0].nome} - ${res.candidatos[0].uf}`
        : origem === 'comentario'
          ? 'Oi! 🏠 Me responde aqui com tua cidade e estado que tua casa nasce no mapa do Brasil virtual. Ex.: Duque de Caxias - RJ'
          : 'Não achei essa cidade 😅 Me manda de novo com o estado, assim: Duque de Caxias - RJ';
      return c.json({ ok: true, resultado: 'cidade_nao_achada', cidade: '', link: '', mensagem });
    }

    const r = await tx(async (t) => {
      const pr = await provisionar(t, { escopo: 'manychat', externalId: 'u:' + handle, username: handle, ibge: res.ibge, origem: 'manychat', provedor: 'instagram' });
      if (pr.resultado === 'revoked') return { tipo: 'revogada' as const };
      const casa = await q1<{ status: string; nome: string; uf: string }>(
        `select h.status, m.nome, m.uf from houses h join plots p on p.id = h.plot_id join municipios m on m.ibge = p.ibge
          where h.dono_identity_id = $1 and h.principal and h.status in ('reservada','reivindicada')`, [pr.identityId], t);
      if (!casa) return { tipo: 'revogada' as const };
      const cidade = `${casa.nome} - ${casa.uf}`;
      if (casa.status === 'reivindicada') return { tipo: 'ja_tinha' as const, cidade, link: `${url()}/?u=${encodeURIComponent(handle)}` };
      // casa reservada: link de uso único para confirmar (só o hash vai ao banco)
      const token = tokenForte(32);
      await t.query(`update identity_claims set expira_em = now() where identity_id = $1 and consumido_em is null and expira_em > now()`, [pr.identityId]);
      await t.query(`insert into identity_claims (identity_id, token_hash, expira_em) values ($1, $2, now() + make_interval(mins => $3))`,
        [pr.identityId, sha256(token), Math.max(config.reivindicacao.validadeLinkMin, 24 * 60)]);
      return { tipo: pr.resultado === 'provisioned' ? 'casa_nova' as const : 'ja_tinha' as const, cidade, link: `${url()}/reivindicar.html?t=${token}` };
    });

    if (r.tipo === 'revogada') return c.json({ ok: true, resultado: 'revogada', cidade: '', link: '', mensagem: 'Seus dados foram removidos do jogo a seu pedido.' });
    const mensagem = r.tipo === 'casa_nova'
      ? `🏠 Pronto! Sua casa em ${r.cidade} nasceu no mapa do Brasil virtual. Toque no link pra confirmar que é você (vale 24h, não compartilhe): ${r.link}`
      : `🏠 Você já tem casa em ${r.cidade}! Veja aqui: ${r.link}`;
    return c.json({ ok: true, resultado: r.tipo, cidade: r.cidade, link: r.link, mensagem });
  });
}
