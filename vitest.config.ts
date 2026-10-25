import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['server/test/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
    fileParallelism: false,          // um banco de teste compartilhado: arquivos em sequência
    testTimeout: 30000, hookTimeout: 120000,
    env: { SMN_AMBIENTE: 'teste', DATABASE_URL: process.env.DATABASE_URL_TEST || 'postgres://smn@127.0.0.1:54329/smn_test', IG_APP_SECRET: 'segredo-de-teste', IG_VERIFY_TOKEN: 'verifica-teste', IG_CONTA_ID: '17840000000000000', SMN_CHAVE_CRIPTO: 'a'.repeat(64) },
  },
});
