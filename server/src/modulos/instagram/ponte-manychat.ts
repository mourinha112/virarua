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
import { q1, tx } from '../../db/db';
import { iguais, sha256, tokenForte } from '../../seguranca/cripto';
import { resolverCidade } from '../cidades/resolver';
import { provisionar } from '../mundo/provisionar';

const chave = () => process.env.PONTE_MANYCHAT_CHAVE || '';
const url = () => config.urlPublica.replace(/\/+$/, '');

export function registrarPonteManychat(app: App) {
  app.post('/api/ponte/manychat', limite(120), async (c) => {
    const k = chave();
    if (!k) throw new ErroHttp(404, 'não encontrado');
    if (!iguais(sha256(String(c.req.header('x-ponte-chave') || '')), sha256(k))) throw new ErroHttp(401, 'chave inválida');
    const b = await c.req.json().catch(() => ({} as any));
    // aceita o corpo simples {username, texto} ou o "Full Contact Data" do ManyChat (ig_username + custom_fields.cidade)
    const cf = b.custom_fields && typeof b.custom_fields === 'object' ? b.custom_fields : {};
    const handle = String(b.username || b.ig_username || '').replace(/^@/, '').trim().toLowerCase();
    const texto = String(b.texto || b.comentario || b.text || cf.cidade || cf.Cidade || b.last_input_text || '').slice(0, 300);
    if (!/^[a-z0-9._]{1,30}$/.test(handle)) throw new ErroHttp(400, 'username inválido');

    const res = await resolverCidade(texto);
    if (res.tipo !== 'ok') {
      const exemplo = res.tipo === 'ambigua' ? `${res.candidatos[0].nome} - ${res.candidatos[0].uf}` : 'Duque de Caxias - RJ';
      return c.json({ ok: true, resultado: 'cidade_nao_achada', cidade: '', link: '',
        mensagem: `Não achei essa cidade 😅 Comenta de novo com cidade e estado, assim: ${exemplo}` });
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
