/* InstagramProvider desacoplado.
   - 'oficial': Instagram API with Instagram Login (graph.instagram.com). Envia private reply ao comentário via
     POST /{versao}/{IG_ID}/messages com recipient.comment_id. Implementado conforme a documentação consultada
     (docs/meta-instagram.md), mas NÃO verificado ao vivo: exige app Live, permissões aprovadas e conta conectada.
   - 'dev': adaptador de DESENVOLVIMENTO. Nunca chama rede; o envio vira outbound_messages com modo 'dry_run'. */
import { config } from '../../config';
import { q1, type Exec, db } from '../../db/db';
import { cifrar, decifrar, redigir } from '../../seguranca/cripto';

export type EnvioResultado = { ok: boolean; transitorio?: boolean; erro?: string; resposta: Record<string, unknown> };
export interface InstagramProvider {
  readonly nome: 'oficial' | 'dev';
  /** modo gravado em outbound_messages */
  readonly modo: 'oficial' | 'dry_run';
  enviarPrivateReply(a: { commentId: string; texto: string }): Promise<EnvioResultado>;
  /** resposta PÚBLICA embaixo do comentário (POST /{comment-id}/replies). Opcional: provedores de teste podem não ter. */
  responderComentario?(a: { commentId: string; texto: string }): Promise<EnvioResultado>;
}

// ---------- conexão (token cifrado em repouso) ----------
export async function salvarConexao(contaId: string, token: string, opts: { username?: string; expiraEm?: Date | null } = {}, ex: Exec = db()) {
  await q1(
    `insert into instagram_connections (conta_id, username, token_cifrado, token_expira_em, status) values ($1, $2, $3, $4, 'ativa')
     on conflict (conta_id) do update set token_cifrado = excluded.token_cifrado, token_expira_em = excluded.token_expira_em,
       username = coalesce(excluded.username, instagram_connections.username), status = 'ativa', atualizado_em = now()`,
    [contaId, opts.username ?? null, cifrar(token), opts.expiraEm ?? null], ex);
}
export async function obterToken(contaId: string, ex: Exec = db()): Promise<string | null> {
  const r = await q1<{ token_cifrado: Buffer | null; status: string; token_expira_em: Date | null }>(`select token_cifrado, status, token_expira_em from instagram_connections where conta_id = $1`, [contaId], ex);
  if (r?.token_cifrado && r.status === 'ativa' && (!r.token_expira_em || r.token_expira_em > new Date())) return decifrar(r.token_cifrado);
  if (!r && config.instagram.tokenBootstrap) { await salvarConexao(contaId, config.instagram.tokenBootstrap, {}, ex); return config.instagram.tokenBootstrap; }
  return null;
}
async function marcarConexao(contaId: string, status: 'expirada' | 'revogada') { await q1(`update instagram_connections set status = $2, atualizado_em = now() where conta_id = $1`, [contaId, status]); }

// ---------- adaptador oficial ----------
export class ProvedorOficial implements InstagramProvider {
  readonly nome = 'oficial' as const; readonly modo = 'oficial' as const;
  constructor(private timeoutMs = 10_000) {}
  async responderComentario(a: { commentId: string; texto: string }): Promise<EnvioResultado> {
    return this.postar(`${encodeURIComponent(a.commentId)}/replies`, { message: a.texto });
  }
  async enviarPrivateReply(a: { commentId: string; texto: string }): Promise<EnvioResultado> {
    return this.postar(`${encodeURIComponent(config.instagram.contaId || '')}/messages`, { recipient: { comment_id: a.commentId }, message: { text: a.texto } });
  }
  private async postar(caminho: string, corpo: unknown): Promise<EnvioResultado> {
    const conta = config.instagram.contaId;
    if (!conta) return { ok: false, erro: 'IG_CONTA_ID não configurado', resposta: {} };
    const token = await obterToken(conta);
    if (!token) return { ok: false, erro: 'conexão do Instagram sem token ativo', resposta: {} };
    const url = `https://graph.instagram.com/${config.instagram.graphVersao}/${caminho}`;
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const r = await fetch(url, {
        method: 'POST', signal: ac.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(corpo),
      });
      let j: any = null; try { j = await r.json(); } catch { /* corpo vazio */ }
      const resposta = JSON.parse(redigir(JSON.stringify({ status: r.status, corpo: j })));
      if (r.ok) return { ok: true, resposta };
      const code = j?.error?.code;
      if (code === 190) await marcarConexao(conta, 'expirada');           // token inválido/expirado
      const transitorio = r.status >= 500 || r.status === 429 || code === 4 || code === 17 || code === 32 || code === 613 || code === 2;
      return { ok: false, transitorio, erro: `graph ${r.status}${code ? ' código ' + code : ''}`, resposta };
    } catch (e: any) {
      // timeout/rede: resultado incerto. Tratado como transitório; a Meta aceita uma só resposta por comentário,
      // então uma repetição pós-entrega volta com erro definitivo e não gera mensagem duplicada.
      return { ok: false, transitorio: true, erro: e?.name === 'AbortError' ? 'timeout' : 'rede: ' + redigir(String(e?.message || e)), resposta: {} };
    } finally { clearTimeout(t); }
  }
}

// ---------- adaptador de desenvolvimento ----------
type OuvinteDev = (m: { commentId: string; texto: string }) => void;
const ouvintesDev: OuvinteDev[] = [];
/** só para testes/demonstração local: recebe o texto (com o link) que SERIA enviado. Nada sai da máquina. */
export function aoEnvioDev(f: OuvinteDev) { ouvintesDev.push(f); return () => { const i = ouvintesDev.indexOf(f); if (i >= 0) ouvintesDev.splice(i, 1); }; }
export class ProvedorDev implements InstagramProvider {
  readonly nome = 'dev' as const; readonly modo = 'dry_run' as const;
  async enviarPrivateReply(a: { commentId: string; texto: string }): Promise<EnvioResultado> {
    for (const f of ouvintesDev) f(a);
    if (config.ambiente === 'dev') console.log(`[instagram-dev · DRY-RUN, nada enviado] private reply ao comentário ${a.commentId}: ${a.texto}`);
    return { ok: true, resposta: { adaptador: 'dev', dry_run: true } };
  }
  async responderComentario(a: { commentId: string; texto: string }): Promise<EnvioResultado> {
    if (config.ambiente === 'dev') console.log(`[instagram-dev · DRY-RUN, nada enviado] resposta pública ao comentário ${a.commentId}: ${a.texto}`);
    return { ok: true, resposta: { adaptador: 'dev', dry_run: true } };
  }
}

let atual: InstagramProvider | null = null;
export function provedorInstagram(): InstagramProvider {
  if (atual) return atual;
  return config.instagram.adaptador === 'oficial' ? new ProvedorOficial() : new ProvedorDev();
}
/** substitui o provedor (testes/diagnóstico). null volta ao configurado. */
export function definirProvedor(p: InstagramProvider | null) { atual = p; }
