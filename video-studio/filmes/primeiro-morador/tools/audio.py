"""Trilha + SFX + mix do filme "primeiro morador", tudo gerado em codigo (sem samples de terceiros).
Tempos vem do roteiro (beats.json) e dos eventos da imagem. Saida: audio/mix.wav (~ -14 LUFS, pico -1.25 dBTP).
uso: python tools/audio.py"""
import json, subprocess, sys, wave
from pathlib import Path
import numpy as np

D = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(D / "tools"))
from _synth import SR, add, bass, bell, clap, click, hat, hz, kick, lp, marimba, pad, pop, reverb, riser, sparkle, t_, thud, whoosh

DUR = 13.0
N = int(SR * DUR)
BEATS = json.loads((D / "beats.json").read_text(encoding="utf-8"))
W = BEATS["words"]
LINES = json.loads((D / "audio/vo.lines.json").read_text(encoding="utf-8"))
on = lambda i: W[i]["onsetFrame"] / 30

POUSO, RECUO, HIT, MAPA = 3.4, 8.3, on(28), 11.4   # chegada na cidade, recuo, "SEJA O PRIMEIRO DE LA", mapa pousa
BAL = on(9)                                         # balao entra no "Sao"

# ---------------------------------------------------------------- musica: 120 BPM, grade ancorada no pouso (3.4 s cai no tempo 1)
music, drums = np.zeros(N), np.zeros(N)
beat, bar = 0.5, 2.0
t0 = POUSO - 2 * bar          # -0.6: o primeiro compasso ja esta tocando no quadro 0
prog = [(60, 64, 67), (57, 60, 64), (53, 57, 60, 65), (55, 59, 62, 67)]   # C Am F G: claro, otimista
roots = [36, 45, 41, 43]
k = 0
while t0 + k * bar < MAPA:
    a = t0 + k * bar
    ch = prog[k % 4]
    s0 = max(0.0, a)
    end = min(a + bar, MAPA)
    if end > s0:
        bright = 0.35 if a < POUSO else 1.0
        add(music, pad([n - 12 for n in ch], end - s0 + 0.25, 900 + 2400 * min(1, max(0, (a + 1) / POUSO))), s0, 0.16)
        arp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1] + 12, ch[0] + 12, ch[2] + 12]
        for i in range(16):
            at = a + i * bar / 16
            if at < 0 or at >= end - 0.02:
                continue
            add(music, marimba(arp[i % 8] + 12, 0.45, bright), at, 0.13 * (1.0 if i % 4 == 0 else 0.6))
        if a >= POUSO - 0.01:
            add(music, bass(roots[k % 4], end - s0), s0, 0.26)
    k += 1

# bateria entra no pouso (som amarrado a algo visivel); no recuo fica so o bumbo, segurando o ar
t = POUSO
while t < MAPA - 0.01:
    i = round((t - POUSO) / beat)
    full = t < RECUO
    add(drums, kick(), t, 0.85 if full or i % 2 == 0 else 0.5)
    if full:
        if i % 2 == 1:
            add(drums, clap(), t, 0.28)
        add(drums, hat(), t + beat / 2, 0.14)
        add(drums, hat(0.03), t + beat * 0.75, 0.06)
    t += beat
add(music, riser(POUSO - 1.0), 1.0, 0.16)            # o mergulho puxa para o pouso
add(music, riser(HIT - RECUO - 0.05), RECUO, 0.14)   # o recuo puxa para a chamada

# respiro de 0.25 s antes do hit, depois acorde cheio que fica ate o fim (cauda nao silenciosa)
fim = DUR - MAPA + 1.6
big = pad([36, 48, 55, 60, 64, 67, 72], DUR - HIT + 0.3, 3800)
add(music, big, HIT, 0.45)
for m in (72, 76, 79, 84):
    add(music, bell(m, 2.6), HIT, 0.12)
add(music, thud(42, 1.6), HIT, 0.55)
for m in (60, 64, 67, 72):
    add(music, marimba(m, 1.6), MAPA, 0.16)
music = reverb(music, 1.6, 0.28) + drums

# ---------------------------------------------------------------- sfx: 4 tipos reutilizados como sistema (sopro, pancada, pop, brilho)
sfx = np.zeros(N)
add(sfx, whoosh(0.5, 400, 3000, 0.7), 0.0, 0.18)                      # o mapa ja chega em movimento
add(sfx, whoosh(POUSO - 1.0, 120, 2200, 0.8), 1.0, 0.42)              # mergulho: vento descendo
add(sfx, thud(70, 0.4), POUSO - 0.02, 0.5)                             # pousa
add(sfx, whoosh(0.25, 1500, 6000, 0.5), 3.33 - 0.12, 0.12)             # titulo encolhe para o topo
add(sfx, pop(79, 0.22), BAL, 0.45)                                     # balao
add(sfx, sparkle(0.6, 14), BAL + 0.05, 0.18)
for ln in BEATS["lines"]:                                              # textura: um toque por bloco de legenda, bem baixo
    add(sfx, click(2200), ln["onsetFrame"] / 30, 0.08)
add(sfx, whoosh(0.3, 3000, 600, 0.3), on(23) - 4 / 30, 0.2)           # balao sai
add(sfx, whoosh(HIT - RECUO, 200, 5000, 0.92), RECUO, 0.35)            # recuo: vento subindo
add(sfx, pop(72, 0.2), on(23), 0.35)                                   # "COMENTA SUA CIDADE"
add(sfx, pop(79, 0.22), HIT, 0.4)                                      # "SEJA O PRIMEIRO DE LA" (hit)
add(sfx, sparkle(0.9, 22), HIT + 0.03, 0.25)
add(sfx, thud(55, 0.5), MAPA - 0.05, 0.3)                              # o mapa assenta
sfx = reverb(sfx, 0.8, 0.15)

# ---------------------------------------------------------------- voz
def ler(mp3):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(mp3), "-f", "s16le", "-ac", "1", "-ar", str(SR), "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768

voice = np.zeros(N)
for ln in LINES:
    a = ler(D / "audio" / ln["clip"])
    a = a / (np.sqrt(np.mean(a[np.abs(a) > 0.01] ** 2)) + 1e-9) * 0.14
    add(voice, a, ln["clip_at"])

# duck: musica 8-10 dB abaixo da fala; antes do hit limpa o ar
env = np.convolve(np.abs(voice), np.ones(int(SR * 0.06)) / (SR * 0.06), "same")
env = np.convolve((env > 0.01).astype(float), np.ones(int(SR * 0.22)) / (SR * 0.22), "same").clip(0, 1)
duck = 1 - 0.66 * env
pre = np.ones(N)
i0, i1 = int((HIT - 0.25) * SR), int(HIT * SR)
pre[i0:i1] = np.linspace(1, 0.35, i1 - i0)
mix = voice + music * 0.5 * duck * pre + sfx * 0.6 * (1 - 0.3 * env)
mix = np.tanh(mix * 1.05) / 1.05
fade = int(SR * 0.35)
mix[-fade:] *= np.linspace(1, 0.55, fade)            # termina vivo, sem cair no silencio

raw = D / "audio/mix_raw.wav"
with wave.open(str(raw), "w") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix / np.max(np.abs(mix)) * 0.9 * 32767).astype(np.int16).tobytes())
subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", "loudnorm=I=-14:TP=-1.25:LRA=9", "-ar", str(SR), "-ac", "2", str(D / "audio/mix.wav")], check=True)
raw.unlink()
print("ok", D / "audio/mix.wav", "hit", round(HIT, 2), "balao", round(BAL, 2))
