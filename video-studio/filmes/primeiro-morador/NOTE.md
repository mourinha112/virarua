# NOTE — "Primeiro morador" (Seu Mundo Novo) · 13 s · 1080×1920 · 30 fps · com som

Feito com a skill **motionmaxxing** (commit `8c8ec0f`, runtime `motion.js` + GSAP 3.12.5 em `runtime/`, `render.mjs`, `sync.mjs`,
`look.py`, `lint.mjs`) e o método do PDF "From A to Z" (voz primeiro e linha do tempo travada nela; tudo na tela renderizado
por código; trilha feita em código; um som por movimento visível; um plano contínuo, zero cortes duros). Referência de formato:
`Downloads/264353.mp4` (13,3 s, mapa → mergulho → cidade → recuo, pílula + título + legenda karaokê + marca no rodapé).

## A ideia, e por quê
A pergunta do jogo é "quem chega primeiro na sua cidade?". O filme **mostra** isso acontecendo no jogo de verdade: do Brasil inteiro
a câmera mergulha numa cidade que tem **uma casa só** (São Miguel dos Milagres, AL, na praia), o balão diz de quem é, e a câmera
volta para o Brasil com a chamada. Tirando a logo, só funciona para um jogo de casas por cidade num mapa do Brasil.

## Beats e o que cada um compra
| s | beat | compra |
|---|---|---|
| 0–1,0 | gancho: Brasil já em movimento, título em 3 linhas | o espectador entende o tabuleiro (o Brasil) e a pergunta |
| 1,0–3,4 | mergulho com foco ancorado (a cidade fica no lugar da tela) | "isso é um lugar de verdade, dá para chegar perto" |
| 3,4–8,3 | órbita de 70° em volta da casa, balão `@ · cidade · UF` | prova: existe uma casa, com dono, numa cidade quase vazia |
| 8,3–11,4 | recuo acelerando e pousando no mapa | "e a sua?" — da casa dele para todas as cidades |
| 11,4–13 | mapa respirando + "COMENTA SUA CIDADE / SEJA O PRIMEIRO DE LÁ" | a ação (comentar) |

## O que é real e o que é ilustrativo
- **Real:** todo o mundo 3D é o motor do jogo (Three.js do repositório), desenhado quadro a quadro pelo modo `?filme`
  (`src/filme.ts`), câmera determinística, sem mola. Casa, praia, coqueiros, guarda-sóis, placas de estado, rios: tudo do jogo.
- **Dados de demonstração:** o `@demo.lucas_vieira26` e a casa vêm de `public/dados/mundo.json` (fictício, prefixo `demo.`).
  **Antes de publicar**, troque pelo fundador real (com autorização dele): `index.html?ibge=<IBGE>&arroba=<handle>`.
- **Voz:** sem chave ElevenLabs. Fallback: voz neural pt-BR (Microsoft, `pt-BR-FranciscaNeural` via edge-tts) com tempos
  **reais** por palavra (não estimados). Trilha e SFX: sintetizados em numpy (`tools/_synth.py`), sem samples de terceiros.
- **Oferta da pílula** ("COMENTA TUA CIDADE: GANHA UMA CASA COM TEU @"): copiada do formato pedido; só publique se o jogo cumprir.
- Não usei números do tipo "mais de 50 cidades": seria estatística inventada para um lançamento.

## Gates (números dos scripts, `final.mp4`)
- **G0 PASS** 13,00 s = esperado; áudio presente. **G2 PASS** nenhuma sequência > 3 quadros parados.
- **G3 PASS** termina em movimento (hold 0,00 s); plano final 2,33 s = 18 % (≤ 25 %).
- **G5 FAIL (C6, C7)** — `lint.mjs`: a pílula no topo (barra cheia) e a pílula acima do título (kicker). **Mantidos de propósito:**
  é exatamente o formato da referência que o Anderson pediu. Também em conflito com a skill e mantidos pelo mesmo motivo:
  legenda karaokê igual à fala (a skill pede tela ≠ fala) e a marca fixa no rodapé por 3+ planos.
- **G1 / G4 (a olho, sem número):** texto ≥ 0,04 H em todos os quadros (título 5–5,8 % H, legenda 3,9 % H, balão 2,4 % H — o
  balão é rótulo, não prova); um herói por quadro (mapa → casa → mapa).
- **Movimento:** variação média 3,1/255 (banda humana 4,4–9,8: abaixo). A referência mede **2,3** no mesmo script; o chão do jogo
  tem grandes áreas lisas (gramado, mar), o que puxa a média para baixo mesmo com a câmera sempre andando.
- **Áudio:** −14,0 LUFS integrado, pico −4,2 dBFS, 100 % audível, sem cauda muda.

## Os quadros (uma frase cada, de `look/sheet.jpg`)
Brasil inteiro com o título entrando; Brasil maior, a câmera já descendo; litoral do Nordeste com rios; costa de Alagoas com as
cidades vizinhas; a casa branca na praia com o balão no "São Miguel"; a mesma casa vista girando, praia à direita; a casa com o
mar entrando no quadro no "ainda tá vazia?"; a câmera subindo pela costa no "Comenta"; o Brasil de volta com a chamada amarela.

## Mudanças no jogo (opt-in, só com `?filme`)
`src/filme.ts` (novo), `src/main.ts` (ativa o modo), `src/mundo/mundo.ts` (laço virou `quadro()` + `filmar()`), `nuvens.ts`
(posição em função de t), `cidades3d.ts` (`fixar`/`vizinhasDe`), `estilo.css` (esconde a interface). Modo normal conferido
(`tools/checar-jogo.mjs`: câmera com mola, HUD, nenhuma exceção).

## O que eu ainda melhoraria
- Voz ElevenLabs (o PDF pede); só trocar `audio/vo/lineNN` e rodar `sync.mjs` + `tools/audio.py`.
- A versão com uma cidade de verdade com fundador real.
- Uma versão 16:9 com re-layout (não recorte), como o PDF pede.

## Como refazer
```bash
npm run dev                                   # na raiz do jogo (porta 5173)
python tools/voz.py                           # se mudar o roteiro (vo.txt)
node <mm>/scripts/sync.mjs audio/vo.words.json --fps 30 --lead 2 --out beats.json
python tools/audio.py
node <mm>/scripts/render.mjs "file:///.../primeiro-morador/index.html?ibge=2708709" final.mp4 --audio audio/mix.wav --crf 17
python <mm>/scripts/look.py final.mp4 --out look-final --expect 13 --expect-audio
```
(`<mm>` = pasta da skill; no Windows defina `CHROME_PATH` e rode o Python com `PYTHONUTF8=1`.)
