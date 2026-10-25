# Seu Mundo Novo

Jogo social do Brasil virtual em 3D: cada jogador tem uma casa na sua cidade, ganha pontos, vota a cada hora e disputa cargos (vereador → presidente). Reimplementação original inspirada em naoeummapa.app (ver `docs/engenharia-reversa/`).

## Rodar

```bash
npm install
npm run geo          # (já feito) gera src/data/terreno.json e municipios.json a partir do IBGE
npm run dados:mock   # gera public/dados/* com dados sintéticos
npm run dev          # http://localhost:5173
```

## Estrutura

- `src/` — front (Vite + TypeScript + Three.js)
- `scripts/geo/` — pipeline geográfico (IBGE → km)
- `scripts/build-dados.ts` — gera o pacote de dados estático a partir do banco (ou mock)
- `api/` — funções Vercel (voto, frase, missão, seguir, visita, decisão, negócio)
- `supabase/` — schema SQL e funções
- `docs/engenharia-reversa/` — especificações do original e decisões
