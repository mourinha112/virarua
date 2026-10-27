/* Repasse de webhook: eventos da conta do outro projeto (mesmo app da Meta) vão com corpo e assinatura originais. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { config } from '../src/config';
import { repassar } from '../src/modulos/instagram/rotas';

afterEach(() => { vi.restoreAllMocks(); config.instagram.repasse.contaId = ''; config.instagram.repasse.url = ''; });
const corpo = (id: string) => ({ object: 'instagram', entry: [{ id, time: 1, changes: [{ field: 'comments', value: { id: 'c1', text: 'Recife 🏮', from: { id: 'u1', username: 'ana' } } }] }] });

describe('repasse de webhook', () => {
  it('só repassa a conta configurada, com o corpo bruto e a assinatura originais', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    config.instagram.repasse.contaId = '999'; config.instagram.repasse.url = 'https://ceu.exemplo/webhook/instagram';
    const bruto = Buffer.from(JSON.stringify(corpo('999')));
    expect(repassar(corpo('999'), bruto, 'sha256=abc')).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ceu.exemplo/webhook/instagram');
    expect((init.headers as Record<string, string>)['x-hub-signature-256']).toBe('sha256=abc');
    expect(Buffer.from(init.body as Uint8Array).equals(bruto)).toBe(true);
    expect(repassar(corpo('123'), Buffer.from('{}'), 'sha256=x')).toBe(false);   // outra conta (a do ViraRua): não repassa
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('desligado quando não configurado', () => {
    const f = vi.spyOn(globalThis, 'fetch');
    expect(repassar(corpo('999'), Buffer.from('{}'), 'sha256=x')).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
