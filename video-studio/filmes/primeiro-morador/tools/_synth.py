"""Instrumentos e efeitos sintetizados em numpy (sem samples de terceiros)."""
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
SR = 48000
rng = np.random.default_rng(7)


def t_(d):
    return np.arange(int(SR * d)) / SR


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lp(x, f, o=2):
    return sosfilt(butter(o, f, "low", fs=SR, output="sos"), x)


def hp(x, f, o=2):
    return sosfilt(butter(o, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, o=2):
    return sosfilt(butter(o, [lo, hi], "band", fs=SR, output="sos"), x)


def add(bus, sig, at, gain=1.0):
    i = int(at * SR)
    if i >= len(bus):
        return
    j = min(len(bus), i + len(sig))
    bus[i:j] += sig[: j - i] * gain


def reverb(x, secs=1.6, mix=0.25):
    ir = rng.standard_normal(int(SR * secs)) * np.exp(-np.linspace(0, 7, int(SR * secs)))
    ir = lp(ir, 6000)
    wet = fftconvolve(x, ir)[: len(x)]
    wet *= np.max(np.abs(x)) / (np.max(np.abs(wet)) + 1e-9)
    return x * (1 - mix) + wet * mix


# ---------------------------------------------------------------- instrumentos
def marimba(m, d=0.6, bright=1.0):
    t = t_(d)
    f = hz(m)
    s = np.sin(2 * np.pi * f * t) * np.exp(-t * 7)
    s += 0.35 * bright * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 30)
    s += 0.15 * np.sin(2 * np.pi * f * 10 * t) * np.exp(-t * 80)
    return s * np.minimum(1, t * 400)


def bell(m, d=1.4):
    t = t_(d)
    f = hz(m)
    s = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * k)
            for a, r, k in [(1, 1, 3), (0.5, 2.0, 5), (0.3, 3.01, 8), (0.15, 5.4, 14)])
    return s * np.minimum(1, t * 600)


def pad(notes, d, cutoff=1800):
    t = t_(d)
    s = np.zeros_like(t)
    for m in notes:
        for det in (-0.08, 0.0, 0.08):
            ph = (hz(m + det) * t) % 1.0
            s += 2 * ph - 1
    s = lp(s / (len(notes) * 3), cutoff, 2)
    env = np.minimum(1, t / 0.35) * np.minimum(1, (d - t) / 0.4).clip(0)
    return s * env


def bass(m, d):
    t = t_(d)
    s = np.tanh(1.8 * np.sin(2 * np.pi * hz(m) * t)) * np.exp(-t * 1.2)
    return s * np.minimum(1, t * 200) * np.minimum(1, (d - t) * 40).clip(0)


def kick():
    t = t_(0.45)
    f = 45 + 120 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.tanh(2.2 * np.sin(ph) * np.exp(-t * 7))


def clap():
    t = t_(0.25)
    n = bp(rng.standard_normal(len(t)), 900, 3500)
    env = np.exp(-t * 22) * (1 + 0.6 * (np.sin(2 * np.pi * 90 * t) > 0) * (t < 0.03))
    return n * env * 2.2


def hat(d=0.06):
    t = t_(d)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * 70)


# ---------------------------------------------------------------- sfx
def whoosh(d=0.6, f0=300, f1=3000, peak=0.7):
    t = t_(d)
    n = rng.standard_normal(len(t))
    out = np.zeros_like(t)
    steps = 24
    for k in range(steps):
        a, b_ = k * len(t) // steps, (k + 1) * len(t) // steps
        fc = f0 * (f1 / f0) ** (k / steps)
        out[a:b_] = bp(n, fc * 0.6, min(fc * 1.6, 20000))[a:b_]
    x = t / d
    env = np.where(x < peak, (x / peak) ** 2, ((1 - x) / (1 - peak)) ** 1.5)
    return out * env * 1.6


def thud(f=70, d=0.4):
    t = t_(d)
    fr = f + 90 * np.exp(-t * 35)
    s = np.sin(2 * np.pi * np.cumsum(fr) / SR) * np.exp(-t * 9)
    s += lp(rng.standard_normal(len(t)), 900) * np.exp(-t * 60) * 0.5
    return np.tanh(1.5 * s)


def click(f=2400):
    t = t_(0.05)
    return (np.sin(2 * np.pi * f * t) + 0.5 * hp(rng.standard_normal(len(t)), 3000)) * np.exp(-t * 160)


def pop(m=79, d=0.18):
    t = t_(d)
    f = hz(m) * (1 + 0.6 * np.exp(-t * 60))
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 22)


def boing(f0=180, f1=520, d=0.45):
    t = t_(d)
    f = f0 + (f1 - f0) * (1 - np.exp(-t * 9))
    vib = 1 + 0.04 * np.sin(2 * np.pi * 14 * t)
    return np.sin(2 * np.pi * np.cumsum(f * vib) / SR) * np.exp(-t * 6)


def sparkle(d=1.0, n=40):
    out = np.zeros(int(SR * d))
    for _ in range(n):
        at = rng.uniform(0, d * 0.8)
        m = rng.choice([84, 86, 88, 91, 93, 96, 98])
        add(out, bell(m, 0.35) * rng.uniform(0.2, 0.5), at)
    return out * np.linspace(1, 0.3, len(out))


def riser(d):
    t = t_(d)
    return whoosh(d, 200, 8000, 0.97) * 0.7 + 0.25 * np.sin(2 * np.pi * np.cumsum(200 + 900 * (t / d) ** 2) / SR) * (t / d) ** 2


def fire(d=0.9):
    t = t_(d)
    n = lp(rng.standard_normal(len(t)), 1400) * (0.6 + 0.4 * rng.random(len(t)) ** 8)
    return n * np.sin(np.pi * t / d) ** 0.7 * 1.8


