/* validação mínima de corpo JSON das rotas do módulo (sem dependência nova) */
import { ErroHttp } from '../../http/app';
type Campo<T> = (v: unknown, nome: string) => T;
export const z = {
  textoOpc: (max: number): Campo<string | undefined> => (v, nome) => {
    if (v === undefined || v === null || v === '') return undefined;
    if (typeof v !== 'string' || v.length > max) throw new ErroHttp(400, `${nome} inválido`);
    return v.trim();
  },
  objeto<S extends Record<string, Campo<any>>>(b: unknown, s: S): { [K in keyof S]: ReturnType<S[K]> } {
    const o: any = b && typeof b === 'object' ? b : {}; const r: any = {};
    for (const [k, f] of Object.entries(s)) r[k] = f(o[k], k);
    return r;
  },
};
