/* Textos parametrizados (moldes) por template. Determinísticos: sem IA, sem fato inventado. A IA (se configurada)
   só poderia propor VARIAÇÕES destes moldes; os números vêm sempre do snapshot. Sem ataque a cidades, sem ridicularizar. */
import type { TemplateId, RenderInput } from './contrato';

type V = Record<string, number | string>;
type Molde = (esc: { nome: string; uf?: string }, v: V) => { title: string; gancho: string; evidencia: string; acao: string; cta: RenderInput['cta'] };
const fmt = (x: unknown) => typeof x === 'number' ? x.toLocaleString('pt-BR') : String(x);
const dataHora = (iso: unknown) => {
  const d = new Date(String(iso)); if (Number.isNaN(+d)) return String(iso);
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const comentar = (uf?: string): RenderInput['cta'] => ({ texto: 'Comente CIDADE + UF para criar sua casa virtual', tipo: 'comentar_cidade', aceita_comentario_cidade: true });
const abrir: RenderInput['cta'] = { texto: 'Abra o jogo pelo link da bio', tipo: 'abrir_jogo', aceita_comentario_cidade: false };

export const MOLDES: Record<TemplateId, Molde> = {
  casa: (e, v) => ({ title: `${e.nome} ganhou mais uma casa`, gancho: `Uma casa nova acabou de nascer em ${e.nome}.`, evidencia: `${fmt(v.moradores_reivindicados)} casas reivindicadas na cidade virtual.`, acao: 'Você comenta sua cidade, ganha uma casa e monta seu avatar.', cta: comentar() }),
  avatar: (_e, v) => ({ title: 'Cada casa tem um morador', gancho: 'Seu avatar mora na sua casa virtual.', evidencia: `${fmt(v.avatares_salvos)} avatares já foram montados no jogo.`, acao: 'Escolha cabelo, roupa e acessório. Muda quando quiser.', cta: abrir }),
  convite: (e, v) => ({ title: `${e.nome} tem vaga`, gancho: `Sua turma já tem uma rua: ${e.nome}.`, evidencia: `${fmt(v.moradores)} moradores e ${fmt(v.vagas)} vagas livres agora.`, acao: 'Sua casa pode ser a próxima. Peça o convite para quem mora lá.', cta: { texto: 'Marque quem precisa morar nessa rua', tipo: 'convidar', aceita_comentario_cidade: false } }),
  obra: (e, v) => ({ title: `${e.nome} mudou de cara`, gancho: `${e.nome} não é mais a mesma.`, evidencia: `Saiu de ${fmt(v.casas_antes)} para ${fmt(v.casas_depois)} casas reivindicadas.`, acao: 'Os moradores juntaram esforço e a obra saiu do papel.', cta: { texto: 'Visite a rua no jogo', tipo: 'visitar', aceita_comentario_cidade: false } }),
  exploracao: (_e, v) => ({ title: 'O Brasil virtual cresceu', gancho: 'Dá para viajar de casa em casa pelo Brasil.', evidencia: `${fmt(v.cidades_com_casas)} cidades com casas e ${fmt(v.visitas_semana)} visitas nesta semana.`, acao: 'Escolha um destino e chegue na hora, sem andar.', cta: { texto: 'Visite uma cidade no jogo', tipo: 'visitar', aceita_comentario_cidade: false } }),
  desafio: (e, v) => ({ title: `Desafio em ${e.nome}`, gancho: `${e.nome} tem uma meta até ${dataHora(v.prazo)}.`, evidencia: `${fmt(v.progresso)} de ${fmt(v.meta)} já foram feitos.`, acao: 'Cada morador que ajuda empurra a barra.', cta: abrir }),
  votacao: (e, v) => ({ title: `${e.nome} está escolhendo`, gancho: `${e.nome} está escolhendo no jogo virtual.`, evidencia: `${fmt(v.candidaturas)} candidaturas e ${fmt(v.diferenca_votos)} votos de diferença.`, acao: `A votação fecha ${dataHora(v.prazo)}. Morador vota uma vez.`, cta: { texto: 'Vote no jogo pelo link da bio', tipo: 'votar', aceita_comentario_cidade: false } }),
  virada: (e, v) => ({ title: `Mudou a liderança em ${e.nome}`, gancho: `A liderança mudou em ${e.nome}. Placar parcial.`, evidencia: `Agora são ${fmt(v.diferenca_votos)} votos de diferença.`, acao: `Ainda não acabou: a votação fecha ${dataHora(v.prazo)}.`, cta: { texto: 'Vote no jogo pelo link da bio', tipo: 'votar', aceita_comentario_cidade: false } }),
  resultado: (e, v) => ({ title: `Resultado oficial em ${e.nome}`, gancho: `${e.nome} tem resultado oficial no jogo virtual.`, evidencia: `${fmt(v.vencedor)} foi eleito para ${fmt(v.cargo)} virtual.`, acao: `Mandato de ${fmt(v.mandato_dias)} dias. Cargo do jogo, sem relação com política real.`, cta: abrir }),
  inauguracao: (e, v) => ({ title: `${fmt(v.local)} chegou em ${e.nome}`, gancho: `Inauguração em ${e.nome}.`, evidencia: `${fmt(v.local)} abre ${dataHora(v.horario)} no mapa.`, acao: 'Passe lá com seu avatar no horário da festa.', cta: { texto: 'Visite no jogo no horário marcado', tipo: 'visitar', aceita_comentario_cidade: false } }),
  agenda: (e, v) => ({ title: `${fmt(v.evento)}`, gancho: `${fmt(v.evento)} em ${e.nome}.`, evidencia: `Começa ${dataHora(v.inicio)} (horário de Brasília).`, acao: 'Entre no jogo na hora e participe com sua rua.', cta: { texto: 'Salve o horário e entre no jogo', tipo: 'agenda', aceita_comentario_cidade: false } }),
  retrospectiva: (e, v) => ({ title: `${e.nome}: como foi`, gancho: `O que ${e.nome} construiu até aqui.`, evidencia: `${fmt(v.casas_reivindicadas)} casas, ${fmt(v.ruas_ativas)} ruas ativas, ${fmt(v.obras_concluidas)} obras.`, acao: 'Tudo isso feito por moradores reais do jogo.', cta: comentar() }),
};

/** legenda do post (sem dado sensível, com identificação de jogo virtual e de patrocínio) */
export function legenda(i: Pick<RenderInput, 'title' | 'lines' | 'cta' | 'sponsorship_label' | 'demo' | 'data_timestamp' | 'election_status'>) {
  const partes = [i.title, '', i.lines.evidencia, i.lines.acao, '', i.cta.texto];
  if (i.election_status === 'em_andamento' || i.election_status === 'provisorio') partes.push('', 'Placar parcial do jogo virtual; o resultado só vale depois da apuração.');
  if (i.sponsorship_label) partes.push('', `#publi · ${i.sponsorship_label}`);
  partes.push('', `Jogo virtual Seu Mundo Novo · dados de ${dataHora(i.data_timestamp)}`);
  if (i.demo) partes.unshift('DEMONSTRAÇÃO · dados fictícios', '');
  return partes.join('\n');
}
