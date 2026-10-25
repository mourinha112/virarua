/* Comandos de operador para a conta oficial do Instagram (CLI):
   - conectar-ig: grava o IG_TOKEN do .env CIFRADO no banco (substitui o anterior) e confere na Graph API de quem é a conta;
   - midias-ig: lista os posts recentes da conta com o id de mídia (para habilitar no painel, área Mídias). */
import { config } from '../../config';
import { salvarConexao, obterToken } from '../instagram/provedor';

const base = () => `https://graph.instagram.com/${config.instagram.graphVersao}`;

async function getJson(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Graph API: ' + (j.error?.message || r.status));
  return j;
}

export async function conectarIg() {
  const conta = config.instagram.contaId, token = config.instagram.tokenBootstrap;
  if (!conta) throw new Error('IG_CONTA_ID vazio no .env');
  if (!token) throw new Error('IG_TOKEN vazio no .env');
  const eu = await getJson(`${base()}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
  if (String(eu.user_id) !== String(conta)) throw new Error(`o token é da conta ${eu.username} (${eu.user_id}), mas IG_CONTA_ID é ${conta}`);
  await salvarConexao(conta, token, { username: eu.username, expiraEm: new Date(Date.now() + 59 * 86400_000) });
  return eu.username as string;
}

export async function midiasIg() {
  if (!config.instagram.contaId) throw new Error('IG_CONTA_ID vazio no .env');
  const token = await obterToken(config.instagram.contaId);
  if (!token) throw new Error('sem token salvo: rode conectar-ig antes');
  const j = await getJson(`${base()}/me/media?fields=id,caption,timestamp,permalink&limit=10&access_token=${encodeURIComponent(token)}`);
  return (j.data || []) as { id: string; caption?: string; timestamp: string; permalink: string }[];
}
