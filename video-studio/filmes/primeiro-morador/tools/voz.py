"""Voz com tempos reais de cada palavra (fallback sem ElevenLabs: voz neural pt-BR local via edge-tts).
Gera audio/vo.mp3, audio/vo.words.json e audio/vo.lines.json no formato que scripts/sync.mjs da motionmaxxing le."""
import asyncio, json, sys
from pathlib import Path
import edge_tts

D = Path(__file__).resolve().parent.parent
VOZ = sys.argv[1] if len(sys.argv) > 1 else "pt-BR-FranciscaNeural"
linhas = [l.strip() for l in (D / "vo.txt").read_text(encoding="utf-8").splitlines() if l.strip()]

# onde cada fala entra no filme (s): a imagem manda (mapa, chegada, balao, recuo)
COLOCA = [0.25, 3.55, 6.25, 8.55]

async def fala(texto):
    com = edge_tts.Communicate(texto, VOZ, boundary="WordBoundary")
    words, audio = [], bytearray()
    async for ch in com.stream():
        if ch["type"] == "audio":
            audio += ch["data"]
        elif ch["type"] == "WordBoundary":
            s = ch["offset"] / 1e7
            words.append({"word": ch["text"], "start": s, "end": s + ch["duration"] / 1e7})
    return bytes(audio), words

async def main():
    todas, linhas_out = [], []
    for i, (l, at) in enumerate(zip(linhas, COLOCA), 1):
        audio, ws = await fala(l)
        (D / f"audio/vo/line{i:02d}.mp3").write_bytes(audio)
        # a fala comeca de verdade na primeira palavra: o clipe entra em (at - inicio da 1a palavra)
        off = at - ws[0]["start"]
        for w in ws:
            todas.append({"word": w["word"], "start": round(w["start"] + off, 3), "end": round(w["end"] + off, 3)})
        linhas_out.append({"text": l, "clip": f"vo/line{i:02d}.mp3", "clip_at": round(off, 3), "start": round(ws[0]["start"] + off, 3), "end": round(ws[-1]["end"] + off, 3)})
    (D / "audio/vo.words.json").write_text(json.dumps(todas, ensure_ascii=False, indent=1), encoding="utf-8")
    (D / "audio/vo.lines.json").write_text(json.dumps(linhas_out, ensure_ascii=False, indent=1), encoding="utf-8")
    for o in linhas_out: print(f'{o["start"]:6.2f} {o["end"]:6.2f}  clip@{o["clip_at"]:5.2f}  {o["text"]}')
    print(len(todas), "palavras")

(D / "audio/vo").mkdir(parents=True, exist_ok=True)
asyncio.run(main())
