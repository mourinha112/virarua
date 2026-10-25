import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RAIZ_ESTUDIO } from '../renderers/html.ts';
import { TEMPLATE_IDS, TEMPLATES, validarRenderInput } from '../contrato/contrato.ts';
import { exemplo } from '../storyboards/exemplos.ts';

const erros = (x: unknown) => { const v = validarRenderInput(x); return v.ok ? [] : v.erros; };

describe('contrato do render', () => {
  it('cópia do estúdio é idêntica à canônica do servidor (npm run contrato)', () => {
    const a = readFileSync(resolve(RAIZ_ESTUDIO, 'contrato/contrato.ts'), 'utf8');
    const b = readFileSync(resolve(RAIZ_ESTUDIO, '../server/src/modulos/conteudo/contrato.ts'), 'utf8');
    expect(a).toBe(b);
  });

  it('há 12 templates e cada um tem pasta com index.html e cena.js', () => {
    expect(TEMPLATE_IDS).toHaveLength(12);
    expect(TEMPLATE_IDS.sort()).toEqual(['agenda', 'avatar', 'casa', 'convite', 'desafio', 'exploracao', 'inauguracao', 'obra', 'resultado', 'retrospectiva', 'virada', 'votacao']);
    for (const id of TEMPLATE_IDS) {
      expect(readFileSync(resolve(RAIZ_ESTUDIO, 'templates', id, 'index.html'), 'utf8')).toContain('cena.js');
      expect(readFileSync(resolve(RAIZ_ESTUDIO, 'templates', id, 'cena.js'), 'utf8')).toContain(`SMN.montar('${id}'`);
      expect(TEMPLATES[id].duracao).toBeGreaterThanOrEqual(10); expect(TEMPLATES[id].duracao).toBeLessThanOrEqual(20);
    }
  });

  it.each(TEMPLATE_IDS)('input de demonstração de %s é válido', (id) => { expect(erros(exemplo(id))).toEqual([]); });

  it('métrica obrigatória ausente é rejeitada em cada template', () => {
    for (const id of TEMPLATE_IDS) {
      const i = exemplo(id); i.metrics = i.metrics.slice(1);
      expect(erros(i).join(' ')).toMatch(/métrica obrigatória ausente/);
    }
  });

  it('template não recebe token, email, voto individual nem ids internos', () => {
    expect(erros({ ...exemplo('casa'), extra: { token: 'x' } }).join(' ')).toMatch(/campo proibido/);
    expect(erros({ ...exemplo('casa'), title: 'fale com fulano@exemplo.com' }).join(' ')).toMatch(/email/);
    expect(erros({ ...exemplo('casa'), title: 'EAAB1234567890abcdef' }).join(' ')).toMatch(/token/);
    expect(erros({ ...exemplo('votacao'), metrics: [...exemplo('votacao').metrics, { chave: 'x', rotulo: 'x', valor: 1, origem: { tipo: 'demo', ref: 'r', apurado_em: '2026-10-24T18:00:00-03:00' }, voto: 'A' }] }).join(' ')).toMatch(/campo proibido/);
    expect(erros({ ...exemplo('resultado'), permitted_public_profiles: [{ nome_publico: 'Fulano', handle: null, user_id: 'abc' }] }).join(' ')).toMatch(/campo proibido/);
  });

  it('placar provisório não vira resultado/posse', () => {
    expect(erros({ ...exemplo('resultado'), election_status: 'provisorio' }).join(' ')).toMatch(/exige election_status em \[oficial\]/);
    expect(erros({ ...exemplo('virada'), title: 'Fulano venceu a eleição' }).join(' ')).toMatch(/vencedor\/posse sem resultado oficial/);
    expect(erros({ ...exemplo('votacao'), election_status: 'oficial' }).join(' ')).toMatch(/exige election_status/);
  });

  it('regras de honestidade: demo, placeholder, patrocínio, vagas, CTA de cidade, duração', () => {
    expect(erros({ ...exemplo('casa'), demo: false }).join(' ')).toMatch(/dado demo num conteúdo real/);
    expect(erros({ ...exemplo('obra'), demo: false }).join(' ')).toMatch(/placeholder em conteúdo real/);
    expect(erros({ ...exemplo('inauguracao'), sponsorship_label: null }).join(' ')).toMatch(/exige sponsorship_label/);
    const c = exemplo('convite'); c.metrics = c.metrics.map((m) => (m.chave === 'vagas' ? { ...m, valor: 0 } : m));
    expect(erros(c).join(' ')).toMatch(/vagas realmente disponíveis/);
    expect(erros({ ...exemplo('casa'), cta: { texto: 'Comente', tipo: 'comentar_cidade', aceita_comentario_cidade: false } }).join(' ')).toMatch(/não aceita comentários de cidade/);
    expect(erros({ ...exemplo('casa'), duration_s: 25 }).join(' ')).toMatch(/duration_s/);
    expect(erros({ ...exemplo('casa'), event_ids: [], demo: false, metrics: exemplo('casa').metrics.map((m) => ({ ...m, origem: { ...m.origem, tipo: 'consulta' } })), background_asset: null }).join(' ')).toMatch(/sem event_ids/);
    const o = exemplo('obra'); o.before_after_assets = { antes: o.before_after_assets!.depois, depois: o.before_after_assets!.antes };
    expect(erros(o).join(' ')).toMatch(/antes deve ser anterior/);
  });
});
