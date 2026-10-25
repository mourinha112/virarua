/* Os 12 templates abrem no Chrome sem erro, respeitam a duração do input, mostram os números do input nos quadros
   certos (consequência → evidência → ação → CTA) e o selo de demonstração em todos os quadros. */
import { describe, it, expect } from 'vitest';
import { HtmlRenderer } from '../renderers/html.ts';
import { TEMPLATE_IDS, type TemplateId } from '../contrato/contrato.ts';
import { exemplo } from '../storyboards/exemplos.ts';

const r = new HtmlRenderer();
const partes = (D: number) => { const cta = D - (D >= 15 ? 3 : D >= 12 ? 2.5 : 2); return { acao: 2 + (cta - 2) * 0.5, cta }; };

describe('templates', () => {
  it.each(TEMPLATE_IDS)('%s: estrutura criativa e números do input', async (id: TemplateId) => {
    const i = exemplo(id), D = i.duration_s, p = partes(D);
    const t = await r.textos(i, [1.0, p.acao - 0.3, p.acao + 1.0, D - 0.04]);
    const juntar = (k: number) => t[k].join(' | ');
    expect(juntar(1.0)).toContain(i.lines.gancho);                       // 0–2 s
    expect(juntar(p.acao - 0.3)).toContain(i.lines.evidencia);           // evidência
    expect(juntar(p.acao + 1.0)).toContain(i.lines.acao);                // ação
    expect(juntar(D - 0.04)).toContain(i.cta.texto);                     // UM CTA no fim
    expect(t[D - 0.04].filter((x) => x === i.cta.texto)).toHaveLength(1);
    for (const k of Object.keys(t)) { expect(t[k]).toContain('jogo virtual'); expect(t[k]).toContain('DEMONSTRAÇÃO · dados fictícios'); }
    // o número do snapshot aparece na evidência
    const num = i.metrics.find((m) => typeof m.valor === 'number' && m.chave !== 'mandato_dias');
    if (num) expect(juntar(p.acao - 0.3)).toContain((num.valor as number).toLocaleString('pt-BR'));
    if (i.sponsorship_label) expect(juntar(1.0)).toContain('patrocinado · ' + i.sponsorship_label);
    if (i.election_status === 'em_andamento') expect(juntar(1.0)).toContain('placar parcial');
    if (i.election_status === 'oficial') expect(juntar(1.0)).toContain('resultado oficial do jogo');
  });

  it('input inválido não renderiza (falha antes de abrir o Chrome)', async () => {
    await expect(r.render({ ...exemplo('resultado'), election_status: 'provisorio' }, { saida: 'out/tmp/nunca.mp4' })).rejects.toThrow(/input inválido/);
  });
});
