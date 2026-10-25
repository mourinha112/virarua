// Copia o contrato canônico do servidor (server/src/modulos/conteudo/contrato.ts) para contrato/contrato.ts.
// O estúdio não importa código do servidor em build; o teste tests/contrato.test.ts falha se as cópias divergirem.
import { copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
copyFileSync(resolve(raiz, '../server/src/modulos/conteudo/contrato.ts'), resolve(raiz, 'contrato/contrato.ts'));
console.log('contrato sincronizado');
