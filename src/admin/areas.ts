/* Áreas do painel. Cada uma desenha em `main` e só chama rotas que o servidor autoriza pelo papel.
   Não há — de propósito — "editar votos" nem "dar cargo". */
import { get, post } from './api';
import { el, botao, cartao, tabela, formulario, pedirMotivo, executar, erroArea } from './ui';

export type Desenhar = (main: HTMLElement) => Promise<void>;
const recarregar = (main: HTMLElement, f: Desenhar) => () => { void f(main); };

/* ---------- saúde da integração ---------- */
export const saude: Desenhar = async (main) => {
  const r = await get('/saude'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  if (r.alertas.length) { const ul = el('ul', 'adm-alertas'); for (const a of r.alertas) ul.append(el('li', '', a)); main.append(cartao('Alertas', ul)); }
  else main.append(cartao('Alertas', el('p', 'msg ok', 'nenhum alerta.')));
  main.append(cartao('Conta oficial', tabela([['conta_id', 'conta'], ['username', '@'], ['status', 'status'], ['tem_token', 'token'], ['token_expira_em', 'expira']], r.conexoes)));
  main.append(cartao('Webhooks (24h)', el('p', 'nota', 'último recebido: ' + (r.ultimoWebhook || 'nunca')), tabela([['estado', 'estado'], ['n', 'qtd']], r.webhooks24h)));
  main.append(cartao('Fila', el('p', 'nota', r.atrasoFilaSeg == null ? 'fila em dia' : `job mais antigo esperando há ${Math.round(r.atrasoFilaSeg / 60)} min`), tabela([['estado', 'estado'], ['n', 'qtd']], r.jobs)));
  main.append(cartao('Mensagens (24h)', tabela([['estado', 'estado'], ['n', 'qtd']], r.mensagens24h)));
  main.append(cartao('Onboarding', tabela([['estado', 'estado'], ['n', 'qtd']], r.onboarding)));
  main.append(cartao('Guia do operador', el('p', 'nota', 'Conta profissional oficial → app Meta → domínio HTTPS e callbacks → permissões (conferir na documentação vigente) → webhook de comentários → conectar e testar token → habilitar mídia de campanha (área Mídias) → testar comentário, cidade ambígua, casa e acesso → só então ligar automação real.')));
};

/* ---------- mídias habilitadas ---------- */
export const midias: Desenhar = async (main) => {
  const r = await get('/midias'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const de = recarregar(main, midias);
  main.append(cartao('Habilitar mídia de campanha',
    el('p', 'nota', 'Só posts habilitados aqui viram onboarding. O texto de consentimento é o aviso publicado no post (cria registro e usa o @ público).'),
    formulario([{ k: 'media_id', rot: 'id da mídia', ph: '1790…' }, { k: 'campanha', rot: 'campanha' }, { k: 'texto_consentimento', rot: 'texto de consentimento publicado', tipo: 'textarea' }, { k: 'aceita_comentario_cidade', rot: 'aceita comentário de cidade', tipo: 'checkbox' }],
      'habilitar', (v) => post('/midias', v), de)));
  main.append(cartao('Mídias', tabela([['media_id', 'mídia'], ['campanha', 'campanha'], ['status', 'status'], ['aceita_comentario_cidade', 'cidade?'], ['texto_consentimento', 'consentimento']], r.midias, (m) => [
    ...(['ativa', 'pausada', 'encerrada'].filter((s) => s !== m.status).map((s) => botao('btn mini', s, () => { const mo = pedirMotivo('mídia → ' + s); if (mo) void executar(post('/midias/' + m.media_id, { status: s, motivo: mo }), 'mídia ' + s, de); }))),
  ])));
};

/* ---------- comentários pendentes / ambíguos ---------- */
export const comentarios: Desenhar = async (main) => {
  const r = await get('/comentarios'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const de = recarregar(main, comentarios);
  main.append(cartao('Pendentes de cidade / revisão', el('p', 'nota', 'Escolher a cidade grava o motivo e reenfileira o processamento (Fase 1). Nunca escolha por palpite: confira o comentário original.'),
    tabela([['username', '@'], ['estado', 'estado'], ['detalhe', 'detalhe'], ['atualizado_em', 'desde']], r.itens, (i) => [
      botao('btn mini prim', 'escolher cidade', () => {
        const ibge = window.prompt('Código IBGE da cidade (7 dígitos):', ''); if (!ibge) return;
        const mo = pedirMotivo('escolher cidade'); if (mo) void executar(post(`/comentarios/${i.identity_id}/cidade`, { ibge: Number(ibge), motivo: mo }), 'cidade escolhida, job reenfileirado', de);
      }),
    ])));
};

/* ---------- reservas / reivindicações ---------- */
export const reservas: Desenhar = async (main) => {
  const r = await get('/reservas'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  main.append(cartao('Casas', tabela([['status', 'status'], ['n', 'qtd']], r.casas)));
  main.append(cartao('Links de reivindicação', tabela([['abertos', 'abertos'], ['consumidos', 'consumidos'], ['expirados', 'expirados']], r.claims ? [r.claims] : [])));
  main.append(cartao('Desafios por código', tabela([['abertos', 'abertos'], ['consumidos', 'consumidos']], r.desafios ? [r.desafios] : [])));
  main.append(cartao('Reservas a expirar', tabela([['username', '@'], ['cidade', 'cidade'], ['uf', 'UF'], ['expira_em', 'expira']], r.reservasAExpirar)));
};

/* ---------- denúncias ---------- */
export const denuncias: Desenhar = async (main) => {
  const r = await get('/denuncias'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const de = recarregar(main, denuncias);
  const acao = (id: string, a: string, extra: Record<string, unknown> = {}) => { const mo = pedirMotivo(a); if (mo) void executar(post(`/denuncias/${id}/acao`, { acao: a, motivo: mo, ...extra }), 'ação registrada', de); };
  main.append(cartao('Denúncias abertas', tabela([['alvo_tipo', 'alvo'], ['alvo_id', 'id'], ['categoria', 'categoria'], ['texto', 'texto'], ['total_no_alvo', 'nº'], ['criado_em', 'quando']], r.itens, (d) => [
    botao('btn mini', 'advertir', () => acao(d.id, 'advertir')),
    ...(d.alvo_tipo === 'user' ? [botao('btn mini', 'suspender', () => { const dias = Number(window.prompt('Dias de suspensão (1–365):', '7')); if (dias) acao(d.id, 'suspender_usuario', { dias }); })] : []),
    ...(d.alvo_tipo === 'venue' ? [botao('btn mini', 'suspender local', () => acao(d.id, 'suspender_estabelecimento'))] : []),
    ...(['comentario', 'conteudo'].includes(d.alvo_tipo) ? [botao('btn mini', 'ocultar', () => acao(d.id, 'ocultar_conteudo'))] : []),
    botao('btn mini', 'descartar', () => acao(d.id, 'descartar')),
  ])));
  main.append(cartao('Últimas ações de moderação', tabela([['acao', 'ação'], ['alvo_tipo', 'alvo'], ['motivo', 'motivo'], ['criado_em', 'quando'], ['expira_em', 'até']], r.acoes)));
};

/* ---------- cidades / ruas ---------- */
export const cidades: Desenhar = async (main) => {
  main.innerHTML = '';
  const res = el('div');
  const busca = formulario([{ k: 'q', rot: 'buscar cidade', ph: 'vitória' }], 'buscar', async (v) => {
    const r = await get('/cidades?q=' + encodeURIComponent(v.q)); res.innerHTML = '';
    if (r.ok) res.append(tabela([['ibge', 'IBGE'], ['nome', 'cidade'], ['uf', 'UF'], ['casas', 'casas'], ['ruas', 'ruas']], r.cidades, (c) => [botao('btn mini', 'ruas', () => void ruas(c.ibge))]));
    return r;
  });
  const ruasBox = el('div');
  async function ruas(ibge: number) {
    const r = await get(`/cidades/${ibge}/ruas`); ruasBox.innerHTML = ''; if (!r.ok) return;
    ruasBox.append(tabela([['nome', 'rua'], ['status', 'status'], ['ocupadas', 'ocupadas'], ['capacidade', 'cap.']], r.ruas, (s) => [
      s.status === 'pausada' ? botao('btn mini', 'reativar', () => { const mo = pedirMotivo('reativar rua'); if (mo) void executar(post(`/ruas/${s.id}/status`, { status: 'ativa', motivo: mo }), 'rua reativada', () => void ruas(ibge)); })
        : botao('btn mini', 'pausar', () => { const mo = pedirMotivo('pausar rua'); if (mo) void executar(post(`/ruas/${s.id}/status`, { status: 'pausada', motivo: mo }), 'rua pausada', () => void ruas(ibge)); }),
    ]));
  }
  main.append(cartao('Cidades', busca, res), cartao('Ruas da cidade', ruasBox));
  main.append(cartao('Apelido revisado de cidade', el('p', 'nota', 'Ex.: "caxias" + RJ → 3301702. Ajuda a resolver comentários futuros.'),
    formulario([{ k: 'alias', rot: 'apelido' }, { k: 'uf', rot: 'UF' }, { k: 'ibge', rot: 'IBGE', tipo: 'number' }, { k: 'motivo', rot: 'motivo' }], 'salvar apelido', (v) => post('/cidades/alias', v))));
};

/* ---------- patrocinadores ---------- */
export const patrocinadores: Desenhar = async (main) => {
  const r = await get('/estabelecimentos'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const de = recarregar(main, patrocinadores);
  const k = r.contadoresProducao;
  main.append(cartao('Produção (sem demonstração)', el('p', '', `${k.estabelecimentos_vigentes} no ar · ${k.patrocinios_ativos} patrocínios ativos · ${k.visitantes_unicos} visitantes únicos · ${k.cliques} cliques · ${k.resgates} resgates`), el('p', 'nota', 'Visitas virtuais e cliques de contas autenticadas, deduplicados. Não indicam vendas. Contratos e status são manuais: nada é cobrado pelo sistema.')));
  const ped = await get('/estabelecimentos/pedidos?status=novo');
  if (ped.ok) main.append(cartao('Pedidos novos', tabela([['codigo', 'código'], ['nome', 'nome'], ['cidade', 'cidade'], ['uf', 'UF'], ['categoria', 'tipo'], ['instagram', '@'], ['whatsapp', 'zap']], ped.pedidos, (p) => [
    botao('btn mini prim', 'criar local', () => void executar(post('/estabelecimentos', { nome: p.nome, categoria: p.categoria, ibge: p.ibge, pedido_id: p.id }), 'local criado (pendente de verificação)', de)),
    botao('btn mini', 'em análise', () => void executar(post(`/estabelecimentos/pedidos/${p.id}/status`, { status: 'em_analise' }), 'ok', de)),
    botao('btn mini', 'recusar', () => { const n = pedirMotivo('recusar pedido'); if (n) void executar(post(`/estabelecimentos/pedidos/${p.id}/status`, { status: 'recusado', nota: n }), 'recusado', de); }),
  ])));
  main.append(cartao('Novo estabelecimento', formulario([
    { k: 'nome', rot: 'nome' }, { k: 'categoria', rot: 'categoria', tipo: 'select', opcoes: ['cafeteria', 'restaurante', 'loja', 'pet', 'eventos', 'bar'] }, { k: 'ibge', rot: 'IBGE', tipo: 'number' },
    { k: 'descricao', rot: 'descrição', tipo: 'textarea' }, { k: 'cor', rot: 'cor da marca', valor: '#ffd23f' }, { k: 'endereco', rot: 'endereço comercial' }, { k: 'horario', rot: 'horário' }, { k: 'telefone', rot: 'telefone comercial' },
    { k: 'mesas', rot: 'mesas', tipo: 'number', valor: '4' }, { k: 'lugares_por_mesa', rot: 'lugares por mesa', tipo: 'number', valor: '4' }, { k: 'capacidade', rot: 'capacidade', tipo: 'number', valor: '16' },
    { k: 'logo_ref', rot: 'logo (referência do arquivo, opcional)' }, { k: 'logo_licenca', rot: 'declaração de licença do logo' }, { k: 'logo_declarado_por', rot: 'quem declarou' },
  ], 'criar', (v) => post('/estabelecimentos', v), de)));
  for (const v of r.estabelecimentos) main.append(cartaoVenue(v, de));
  main.append(cartao('Domínios permitidos para links', el('p', 'nota', r.dominios.join(' · ')),
    formulario([{ k: 'dominio', rot: 'domínio', ph: 'padariadoze.com.br' }, { k: 'motivo', rot: 'motivo' }], 'permitir domínio', (x) => post('/estabelecimentos/dominios', x), de)));
};

function cartaoVenue(v: any, de: () => void) {
  const titulo = `${v.nome} · ${v.categoria} · ${v.cidade}-${v.uf}${v.demo ? ' · DEMO' : ''}`;
  const b = cartao(titulo);
  const st = el('p', '', `verificação: ${v.verificacao} · cupons ativos: ${v.cupons_ativos}`); b.append(st);
  const acoes = el('div', 'adm-acoes');
  for (const s of ['verificado', 'rejeitado', 'suspenso']) if (s !== v.verificacao) acoes.append(botao('btn mini', s, () => { const n = pedirMotivo('verificação → ' + s); if (n) void executar(post(`/estabelecimentos/${v.id}/verificacao`, { verificacao: s, nota: n }), 'verificação: ' + s, de); }));
  acoes.append(botao('btn mini', 'métricas 30d', async () => { const m = await get(`/estabelecimentos/${v.id}/metricas`); if (m.ok) window.alert(`${m.aviso}\n\nvisitantes únicos: ${m.visitantes_unicos}\ncliques: ${m.cliques}\nresgates: ${m.resgates}`); }));
  b.append(acoes);
  b.append(el('h3', '', 'Patrocínios (status manual)'), tabela([['modalidade', 'modalidade'], ['status', 'status'], ['inicio', 'início'], ['fim', 'fim'], ['contrato_ref', 'contrato']], v.patrocinios, (p) =>
    (['ativo', 'pausado', 'encerrado'] as const).filter((s) => s !== p.status && p.status !== 'encerrado' && p.status !== 'cancelado').map((s) => botao('btn mini' + (s === 'ativo' ? ' prim' : ''), s === 'ativo' ? 'aprovar' : s === 'pausado' ? 'pausar' : 'encerrar', () => { const mo = pedirMotivo('patrocínio → ' + s); if (mo) void executar(post(`/patrocinios/${p.id}/status`, { status: s, motivo: mo }), 'patrocínio ' + s, de); }))));
  const det = el('details', 'adm-det'); det.append(el('summary', '', 'novo patrocínio · link · cupom · evento'));
  det.append(el('h3', '', 'Patrocínio'), formulario([{ k: 'modalidade', rot: 'modalidade', tipo: 'select', opcoes: ['presenca', 'personalizacao', 'evento'] }, { k: 'contrato_ref', rot: 'referência do contrato assinado' }, { k: 'inicio', rot: 'início', tipo: 'date' }, { k: 'fim', rot: 'fim', tipo: 'date' }, { k: 'observacao', rot: 'observação' }], 'criar rascunho', (x) => post(`/estabelecimentos/${v.id}/patrocinios`, x), de));
  det.append(el('h3', '', 'Link externo'), formulario([{ k: 'tipo', rot: 'tipo', tipo: 'select', opcoes: ['instagram', 'site', 'whatsapp', 'cardapio', 'mapa'] }, { k: 'url', rot: 'URL (https, domínio permitido)' }, { k: 'rotulo', rot: 'rótulo visível' }], 'adicionar link', (x) => post(`/estabelecimentos/${v.id}/links`, x), de));
  det.append(el('h3', '', 'Cupom'), formulario([{ k: 'titulo', rot: 'título' }, { k: 'regras', rot: 'regras visíveis', tipo: 'textarea' }, { k: 'fim', rot: 'válido até', tipo: 'datetime-local' }, { k: 'limite_total', rot: 'limite total', tipo: 'number' }], 'criar cupom', (x) => post(`/estabelecimentos/${v.id}/cupons`, x), de));
  det.append(el('h3', '', 'Evento patrocinado'), formulario([{ k: 'titulo', rot: 'título' }, { k: 'descricao', rot: 'descrição', tipo: 'textarea' }, { k: 'inicio', rot: 'início', tipo: 'datetime-local' }, { k: 'fim', rot: 'fim', tipo: 'datetime-local' }, { k: 'capacidade', rot: 'capacidade', tipo: 'number' }], 'criar evento', (x) => post(`/estabelecimentos/${v.id}/eventos`, x), de));
  b.append(det);
  return b;
}

/* ---------- flags e kill switches ---------- */
export const flags: Desenhar = async (main) => {
  const r = await get('/flags'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const de = recarregar(main, flags);
  main.append(cartao('Feature flags e kill switches', el('p', 'nota', 'kill_* ligado = pausa aquele sistema. Bares exigem revisão da política etária antes de ligar.'),
    tabela([['chave', 'flag'], ['ligada', 'ligada'], ['nota', 'nota'], ['atualizado_em', 'alterada']], r.flags, (f) => [
      botao('btn mini' + (f.ligada ? '' : ' prim'), f.ligada ? 'desligar' : 'ligar', () => {
        const mo = pedirMotivo(`${f.ligada ? 'desligar' : 'ligar'} ${f.chave}`); if (!mo) return;
        const extra = f.chave === 'bares' && !f.ligada ? { confirmo_politica_etaria: window.confirm('Confirmo que a política etária foi revisada e só contas adultas confirmadas verão bares.') } : {};
        void executar(post('/flags/' + f.chave, { ligada: !f.ligada, motivo: mo, ...extra }), 'flag alterada', de);
      }),
    ])), cartao('Kill switches do ambiente (env, só leitura)', tabela([['k', 'switch'], ['v', 'ligado']], Object.entries(r.killEnv).map(([k, v]) => ({ k, v })))));
};

/* ---------- fila ---------- */
export const fila: Desenhar = async (main) => {
  const r = await get('/fila'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const de = recarregar(main, fila);
  main.append(cartao('Resumo', tabela([['tipo', 'tipo'], ['estado', 'estado'], ['n', 'qtd']], r.resumo)));
  main.append(cartao('Fila morta', tabela([['id', 'id'], ['tipo', 'tipo'], ['tentativas', 'tent.'], ['erro', 'erro (redigido)'], ['campos', 'campos']], r.mortos, (j) => [
    botao('btn mini prim', 'reprocessar', () => { const mo = pedirMotivo('reprocessar job ' + j.id); if (mo) void executar(post(`/fila/${j.id}/reprocessar`, { motivo: mo }), 'job de volta na fila', de); }),
  ])));
};

/* ---------- auditoria ---------- */
export const auditoria: Desenhar = async (main) => {
  const r = await get('/auditoria'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const exp = el('div', 'adm-acoes');
  for (const f of ['csv', 'json']) { const a = el('a', 'btn mini', 'exportar ' + f); a.href = `/api/admin/auditoria/exportar?formato=${f}`; exp.append(a); }
  main.append(cartao('Auditoria (dados pessoais protegidos)', el('p', 'nota', 'Ids viram pseudônimos estáveis; @, telefones, e-mails e textos livres são mascarados. A própria exportação é auditada.'), exp,
    tabela([['id', '#'], ['criado_em', 'quando'], ['ator', 'ator'], ['acao', 'ação'], ['alvo', 'alvo'], ['motivo', 'motivo']], r.linhas)));
};

/* ---------- métricas: visitas ao site (separado), Instagram e casas, engajamento ---------- */
const nf = (n: number) => n.toLocaleString('pt-BR');
const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) + '%' : '—');
function kpis(itens: [string, string, string?][]) {
  const g = el('div', 'adm-kpis');
  for (const [rot, v, sub] of itens) { const k = el('div', 'adm-kpi'); k.append(el('b', '', v), el('span', '', rot)); if (sub) k.append(el('small', '', sub)); g.append(k); }
  return g;
}
/** colunas por dia (uma série; tooltip no hover; a tabela abaixo é a visão em texto) */
function colunas(dados: { rot: string; v: number; dica: string }[]) {
  const max = Math.max(1, ...dados.map((d) => d.v));
  const g = el('div', 'adm-cols'); g.setAttribute('role', 'img'); g.setAttribute('aria-label', 'gráfico de colunas; os números estão na tabela');
  for (const d of dados) {
    const c = el('div', 'adm-col'); c.title = d.dica;
    const b = el('i'); b.style.height = Math.max(d.v ? 3 : 0, Math.round((d.v / max) * 100)) + '%'; c.append(b, el('small', '', d.rot)); g.append(c);
  }
  return g;
}
function barrasH(dados: { rot: string; v: number; extra?: string }[]) {
  const max = Math.max(1, ...dados.map((d) => d.v)); const w = el('div', 'adm-barras');
  for (const d of dados) { const l = el('div', 'adm-bl'); const t = el('div', 'adm-bt'); const i = el('i'); i.style.width = Math.round((d.v / max) * 100) + '%'; t.append(i); l.append(el('span', '', d.rot), t, el('b', '', nf(d.v) + (d.extra ? ' · ' + d.extra : ''))); w.append(l); }
  return w;
}
const ORIGEM: Record<string, string> = { instagram: 'Instagram', whatsapp: 'WhatsApp', facebook: 'Facebook', google: 'Google', tiktok: 'TikTok', direto: 'direto / link salvo', outro: 'outros sites' };

export const metricas: Desenhar = async (main) => {
  let dias = 30;
  const desenhar = async () => {
    const r = await get(`/metricas?dias=${dias}`); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
    const t = r.totais, serie = [...r.serie].reverse() as any[];
    const soma = (k: string) => serie.reduce((s, x) => s + (x[k] || 0), 0);
    const per = el('div', 'hub-bts');
    for (const d of [7, 30, 90]) per.append(botao('btn mini' + (d === dias ? ' prim' : ''), `últimos ${d} dias`, () => { dias = d; void desenhar(); }));
    per.append(botao('btn mini', 'atualizar', () => void desenhar()));
    main.append(per);

    // 1) visitas ao site
    const hoje = r.serie[0] || {};
    main.append(cartao('🌐 Visitas ao site',
      kpis([['pessoas hoje', nf(t.visitantes_hoje), `${nf(hoje.novos || 0)} novas · ${nf(hoje.voltaram || 0)} voltaram`], ['pessoas em 7 dias', nf(t.visitantes_7d)], ['pessoas em 30 dias', nf(t.visitantes_30d)],
        [`novas (${dias}d)`, nf(soma('novos'))], [`voltaram (${dias}d)`, nf(soma('voltaram'))], [`no celular (${dias}d)`, pct(soma('celular'), soma('visitantes'))], [`páginas abertas (${dias}d)`, nf(soma('aberturas'))]]),
      el('h3', '', 'pessoas por dia'),
      colunas(serie.map((x) => ({ rot: x.dia.slice(0, 2), v: x.visitantes, dica: `${x.sem} ${x.dia}: ${x.visitantes} pessoas (${x.novos} novas, ${x.voltaram} voltaram)` }))),
      el('p', 'nota', 'pessoa = aparelho que abriu o site no dia (id aleatório do navegador, sem IP). Passe o mouse na coluna para ver o dia. A contagem começou nesta versão.')));
    const sv = el('div', 'adm-2col');
    sv.append(cartao('de onde vieram', r.origens.length ? barrasH(r.origens.map((o: any) => ({ rot: ORIGEM[o.origem] || o.origem, v: o.pessoas, extra: o.visitas + ' visitas' }))) : el('p', 'nota', 'sem dados ainda.'), el('p', 'nota', 'dica: no link da bio use ?utm_source=instagram e no WhatsApp ?utm_source=whatsapp.')));
    sv.append(cartao('horário que entram (Brasília)', r.horas.length ? colunas(Array.from({ length: 24 }, (_, h) => { const v = r.horas.find((x: any) => x.hora === h)?.visitas || 0; return { rot: h % 3 === 0 ? String(h) : '', v, dica: `${h}h: ${v} visitas` }; })) : el('p', 'nota', 'sem dados ainda.')));
    main.append(sv);

    // 2) instagram e casas
    main.append(cartao('🏠 Instagram e casas',
      kpis([['casas no mapa', nf(t.casas)], ['confirmadas', nf(t.confirmadas), pct(t.confirmadas, t.casas) + ' do total'], ['cidades com casa', nf(t.cidades)], ['ruas', nf(t.ruas)],
        [`comentários (${dias}d)`, nf(soma('comentarios'))], [`casas novas (${dias}d)`, nf(soma('casas_novas'))], [`confirmadas (${dias}d)`, nf(soma('confirmadas'))]]),
      el('h3', '', 'casas novas por dia'),
      colunas(serie.map((x) => ({ rot: x.dia.slice(0, 2), v: x.casas_novas, dica: `${x.sem} ${x.dia}: ${x.casas_novas} casas novas, ${x.comentarios} comentários, ${x.confirmadas} confirmadas` })))));

    // 3) engajamento
    main.append(cartao('🎮 Engajamento',
      kpis([['contas', nf(t.contas)], [`logins (${dias}d)`, nf(soma('logins'))], [`missões (${dias}d)`, nf(soma('missoes'))], [`votos (${dias}d)`, nf(soma('votos'))], ['pets', nf(t.pets)]])));

    main.append(cartao('Tabela por dia', tabela([['dia', 'dia'], ['sem', ''], ['visitantes', 'pessoas'], ['novos', 'novas'], ['voltaram', 'voltaram'], ['celular', 'celular'], ['aberturas', 'páginas'], ['comentarios', 'comentários'], ['casas_novas', 'casas novas'], ['confirmadas', 'confirmadas'], ['logins', 'logins'], ['missoes', 'missões'], ['votos', 'votos'], ['pets', 'pets']], r.serie)));
    main.append(cartao('Cidades com mais casas', tabela([['cidade', 'cidade'], ['casas', 'casas'], ['confirmadas', 'confirmadas']], r.cidades)));
  };
  await desenhar();
};

/* ---------- divulgar: baú da semana (secreto) com as dicas do dia e ultrapassagens com legenda pronta ---------- */
function copiar(txt: string) { return botao('btn mini', 'copiar legenda', async (ev) => { try { await navigator.clipboard.writeText(txt); (ev.currentTarget as HTMLButtonElement).textContent = 'copiado ✓'; } catch { window.prompt('copie:', txt); } }); }
export const divulgar: Desenhar = async (main) => {
  const r = await get('/divulgar'); main.innerHTML = ''; if (!r.ok) { main.append(erroArea(r)); return; }
  const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
  const t = r.tesouro, lt = el('div');
  for (const d of t.dicas) {
    const l = el('div', 'linha'); l.style.cssText = 'display:flex;gap:8px;align-items:center;justify-content:space-between;padding:6px 0;border-top:1px solid #0001' + (d.dia === hoje ? ';background:#fff3c4' : '');
    l.append(el('span', '', `${d.dia.split('-').reverse().slice(0, 2).join('/')}${d.dia === hoje ? ' (HOJE)' : ''} · ${d.texto}`), copiar(d.legenda)); lt.append(l);
  }
  main.append(cartao(`🗝️ Caça ao tesouro · semana ${t.semana}`, el('p', '', `🤫 o baú está em ${t.cidade} · ${t.achados} já acharam`), el('p', 'nota', 'poste 1 dica por dia nos stories (a do dia está em amarelo). O jogo libera a mesma dica sozinho.'), lt));
  const g = r.guerra, le = el('div');
  if (!g.eventos.length) le.append(el('p', 'nota', 'nenhuma ultrapassagem ainda nesta semana.'));
  for (const e of g.eventos) { const l = el('div'); l.style.cssText = 'padding:6px 0;border-top:1px solid #0001'; l.append(el('p', '', e.legenda), copiar(e.legenda)); le.append(l); }
  main.append(cartao('⚔️ Ultrapassagens (posts prontos)', le));
  main.append(cartao('Top cidades da semana', tabela([['nome', 'cidade'], ['uf', 'UF'], ['pts', 'pontos'], ['casas_novas', 'casas novas'], ['xp', 'XP']], g.top)));
  main.append(cartao('Estados', tabela([['uf', 'UF'], ['pts', 'pontos'], ['cidades', 'cidades']], g.estados)));
};

export const AREAS: Record<string, { rot: string; f: Desenhar }> = {
  metricas: { rot: 'Métricas', f: metricas },
  divulgar: { rot: 'Divulgar', f: divulgar },
  saude: { rot: 'Saúde', f: saude }, midias: { rot: 'Mídias', f: midias }, comentarios: { rot: 'Comentários', f: comentarios }, reservas: { rot: 'Reservas', f: reservas },
  denuncias: { rot: 'Denúncias', f: denuncias }, cidades: { rot: 'Cidades/ruas', f: cidades }, patrocinadores: { rot: 'Patrocinadores', f: patrocinadores },
  flags: { rot: 'Flags', f: flags }, fila: { rot: 'Fila', f: fila }, auditoria: { rot: 'Auditoria', f: auditoria },
};
