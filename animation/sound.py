"""Синтез музики и звуковых эффектов для ролика (всё генерируется кодом, оригинальное).

Результат: music.wav и sfx.wav длиной 56 с (44,1 кГц, стерео) в указанной папке.
Использование: python3 sound.py ВЫХОДНАЯ_ПАПКА
"""
import sys
import wave
import numpy as np

SR = 44100
DUR = 56.0
N = int(SR * DUR)
rng = np.random.default_rng(11)

# Время приземления бумаг в сцене 1: (начало падения, приземление)
PAPERS = [[0.7, 1.706], [1.03, 2.395], [1.36, 2.508], [1.69, 3.071], [2.02, 3.434], [2.35, 3.563],
          [2.68, 4.137], [3.01, 4.423], [3.34, 4.637], [3.67, 4.945], [4, 5.156], [4.33, 5.627],
          [4.66, 5.73], [4.99, 6.358], [5.32, 6.718], [5.65, 6.889], [5.98, 7.067], [6.31, 7.575]]


# ---------- примитивы ----------
def t_axis(dur):
    return np.arange(int(SR * dur)) / SR


def add(buf, sig, t, gain=1.0):
    i = int(t * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(sig))
    buf[i:j] += sig[:j - i] * gain


def decay(dur, rate):
    t = t_axis(dur)
    return np.exp(-t * rate)


def sine(freq, dur, rate=8.0, attack=0.003):
    t = t_axis(dur)
    s = np.sin(2 * np.pi * freq * t) * np.exp(-t * rate)
    a = int(attack * SR)
    if a:
        s[:a] *= np.linspace(0, 1, a)
    return s


def sweep(f0, f1, dur, rate=6.0):
    t = t_axis(dur)
    f = f0 + (f1 - f0) * (t / dur)
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = np.sin(ph) * np.exp(-t * rate)
    a = int(0.004 * SR)
    s[:a] *= np.linspace(0, 1, a)
    return s


def mix(*sigs):
    """Сумма сигналов разной длины."""
    out = np.zeros(max(len(x) for x in sigs))
    for x in sigs:
        out[:len(x)] += x
    return out


def noise(dur):
    return rng.standard_normal(int(SR * dur))


def lowpass(x, k):
    k = max(1, int(k))
    return np.convolve(x, np.ones(k) / k, mode='same')


def whoosh(dur, k0=60, k1=6, peak=0.5):
    """Шум со скользящим фильтром: k0 -> k1 (низкий -> высокий) и огибающей-«горбом»."""
    n = noise(dur)
    out = np.zeros_like(n)
    chunks = 12
    cl = len(n) // chunks + 1
    for c in range(chunks):
        k = k0 + (k1 - k0) * c / (chunks - 1)
        seg_ = lowpass(n, k)[c * cl:(c + 1) * cl]
        out[c * cl:c * cl + len(seg_)] = seg_
    t = t_axis(dur) / dur
    env = np.sin(np.pi * np.clip(t / (2 * peak), 0, 1)) ** 2 * (t < peak) + np.cos(np.pi * np.clip((t - peak) / (2 * (1 - peak)), 0, 1)) ** 2 * (t >= peak)
    out = out / (np.max(np.abs(out)) + 1e-9)
    return out * env


def ding(freq, dur=0.9, rate=5.0, bell=False):
    s = sine(freq, dur, rate) + 0.35 * sine(freq * 2, dur, rate * 1.6) + 0.15 * sine(freq * 3, dur, rate * 2.4)
    if bell:  # неметаллические обертоны для звонка
        s += 0.4 * sine(freq * 2.76, dur, rate * 1.4) + 0.2 * sine(freq * 5.4, dur, rate * 2.2)
    return s / 1.5


def pop(freq=520, dur=0.14):
    return sweep(freq * 1.6, freq * 0.6, dur, rate=22)


def click():
    n = noise(0.03) * decay(0.03, 160)
    return n * 0.8 + sine(1800, 0.03, 140) * 0.5


def tick(freq=2600):
    return (noise(0.012) * decay(0.012, 300)) + sine(freq, 0.012, 300) * 0.4


def thud(low=90, dur=0.22):
    return sweep(low * 1.7, low * 0.5, dur, rate=18) + lowpass(noise(dur), 30) * decay(dur, 25) * 1.5


def paper_slap():
    return mix(thud(110, 0.16) * 0.8, lowpass(noise(0.12), 6) * decay(0.12, 40) * 1.2)


def buzz(dur=0.4, f=110):
    t = t_axis(dur)
    saw = 2 * ((t * f) % 1) - 1
    trem = 0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 18 * t))
    s = saw * trem
    return lowpass(s, 4) * np.exp(-t * 4) * np.minimum(1, t * 200)


def boing(dur=0.55):
    t = t_axis(dur)
    f = 260 + 380 * np.exp(-t * 7) * np.cos(2 * np.pi * 7 * t) + 100 * np.exp(-t * 4)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)


def to_stereo(buf):
    return np.stack([buf, buf], axis=1)


def save(path, buf, norm=0.9):
    peak = np.max(np.abs(buf)) + 1e-9
    data = (buf / peak * norm * 32767).astype(np.int16)
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


# ---------- звуковые эффекты ----------
def make_sfx():
    b = np.zeros(N)
    # --- Сцена 1 (0 с): бумаги, паника, сирена ---
    for ts, land in PAPERS:
        add(b, whoosh(0.5, 40, 8) * 0.5, ts, 0.05)
        add(b, paper_slap(), land - 0.05, 0.22 * (0.8 + 0.4 * rng.random()))
    add(b, whoosh(0.45, 60, 6, peak=0.9), 2.45, 0.18)      # вдох: хватается за голову
    add(b, boing(), 3.2, 0.22)
    t0, k = 2.8, 0
    while t0 < 7.2:                                         # мигающий знак «!»: двухтональная сирена
        add(b, sine(880 if k % 2 == 0 else 660, 0.16, 6) + 0.2 * sine(1760, 0.16, 9), t0, 0.10)
        t0 += 1 / 2.2
        k += 1
    # --- Сцена 2 (12 с): Диск -> блокнот ---
    add(b, pop(520), 12.0, 0.2)
    add(b, pop(440), 12.4, 0.2)
    add(b, pop(330), 12.7, 0.2)
    for i, f in enumerate([1046, 1318, 1568, 2093]):
        ts = 12 + 1.2 + i * 1.2
        add(b, whoosh(0.55, 30, 5, peak=0.4), ts, 0.16)
        add(b, mix(thud(150, 0.12) * 0.5, ding(f, 0.7)), ts + 1.3, 0.16)
    # --- Сцена 3 (21 с): ШІ ---
    add(b, whoosh(0.5, 50, 6), 21.0, 0.16)
    add(b, sweep(300, 760, 0.25, 8), 21.5, 0.2)
    add(b, click(), 22.2, 0.3)
    add(b, sine(330, 0.18, 14), 22.28, 0.14)
    for t0 in (22.4, 24.0, 25.6):                           # сканирование
        add(b, sweep(400, 1300, 0.9, 3.0) * 0.8, t0, 0.07)
    for t0 in (23.6, 25.0, 26.4):
        add(b, ding(1175, 0.5, 7), t0, 0.14)
    add(b, ding(1319, 0.5, 6), 27.2, 0.12)
    add(b, ding(1760, 0.9, 5), 27.34, 0.14)
    add(b, pop(500), 27.2, 0.14)

    def typing(start, text_len, cps, gain=0.05):
        for k in range(text_len):
            add(b, tick(2200 + rng.integers(0, 900)), start + k / cps, gain)
    for s_, n_ in zip([6.5, 7.0, 7.5, 8.0], [15, 16, 14, 32]):
        typing(21 + s_, n_, 34)
    add(b, buzz(0.45, 98), 30.0, 0.16)                      # «Бракує»: тревожный сигнал
    add(b, thud(70, 0.3), 30.0, 0.25)
    for s_, n_ in zip([9.7, 10.8], [20, 19]):
        typing(21 + s_, n_, 28)
    # --- Сцена 4 (38 с): готовое ТЗ ---
    add(b, pop(480), 38.3, 0.2)
    for i, f in enumerate([784, 880, 988, 1047, 1175]):
        add(b, ding(f, 0.35, 10), 38 + 1.8 + i * 0.35, 0.12)
    for i, f in enumerate([523, 659, 784, 1047]):           # печать с галочкой
        add(b, ding(f, 0.9, 4.5), 41.4 + i * 0.07, 0.17)
    add(b, thud(80, 0.25), 41.4, 0.3)
    add(b, pop(420), 42.3, 0.2)
    add(b, whoosh(1.3, 50, 5, peak=0.6), 43.2, 0.2)
    add(b, ding(880, 0.3, 9), 44.6, 0.16)
    add(b, ding(1320, 0.6, 6), 44.72, 0.16)
    add(b, mix((noise(0.25) * decay(0.25, 18)) * 0.8, pop(700, 0.15) * 0.5), 44.7, 0.22)   # хлопушка
    for k in range(7):
        add(b, ding(rng.integers(1800, 3200), 0.3, 12), 44.8 + k * 0.13, 0.05)
    # --- Сцена 5 (47 с): призыв ---
    add(b, pop(500), 47.1, 0.2)
    add(b, pop(420), 47.2, 0.2)
    add(b, click(), 49.1, 0.35)
    for t0, g in ((49.2, 0.2), (52.2, 0.12), (55.2, 0.09)):
        add(b, ding(1318, 1.4, 3.2, bell=True), t0, g)
    for k in range(9):                                      # сердечки: пузырьки
        add(b, sweep(500 + 60 * k, 1100 + 60 * k, 0.12, 20), 49.4 + k * 0.5, 0.06)
    return to_stereo(b)


# ---------- музыка ----------
def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


BPM = 126
BEAT = 60 / BPM
BAR = 4 * BEAT
S16 = BEAT / 4
# прогрессии: (бас MIDI, аккорд MIDI)
MINOR = [(45, (57, 60, 64)), (41, (53, 57, 60)), (48, (60, 64, 67)), (43, (55, 59, 62))]   # Am F C G
MAJOR = [(48, (60, 64, 67)), (43, (55, 59, 62)), (45, (57, 60, 64)), (41, (53, 57, 60))]   # C G Am F


def pad_note(freq, dur):
    t = t_axis(dur)
    s_ = sum(np.sin(2 * np.pi * freq * h * t + h) / h for h in range(1, 7))
    a_ = np.minimum(1, t / 0.2) * np.minimum(1, (dur - t) / 0.2)
    return s_ * a_ * 0.22


def pluck(freq, dur=0.3, rate=9.0):
    t = t_axis(dur)
    return (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * freq * 2 * t)) * np.exp(-t * rate)


def saw_bass(freq, dur=0.22):
    t = t_axis(dur)
    s_ = sum(np.sin(2 * np.pi * freq * h * t) / h for h in range(1, 6))
    return s_ * np.exp(-t * 7) * np.minimum(1, t * 400)


def stab(freqs, dur=0.16):
    t = t_axis(dur)
    s_ = sum(sum(np.sin(2 * np.pi * f * h * t) / h for h in range(1, 5)) for f in freqs)
    return s_ * np.exp(-t * 16) * np.minimum(1, t * 500) * 0.35


def kick():
    return mix(sweep(160, 44, 0.28, 11) * 1.2, click() * 0.3)


def clap():
    out = np.zeros(int(SR * 0.2))
    for k in range(3):
        n = np.diff(noise(0.15), prepend=0) * decay(0.15, 28 if k == 2 else 90)
        out[int(k * 0.011 * SR):int(k * 0.011 * SR) + len(n)] += n[:len(out) - int(k * 0.011 * SR)]
    return out


def hat(dur=0.045, rate=75):
    return np.diff(noise(dur), prepend=0) * decay(dur, rate)


def crash():
    n = np.diff(noise(1.8), prepend=0)
    return n * decay(1.8, 2.4) * 0.9


def riser(dur):
    n = noise(dur)
    out = np.zeros_like(n)
    chunks = 24
    cl = len(n) // chunks + 1
    for c in range(chunks):
        k = 60 - 56 * c / (chunks - 1)
        out[c * cl:(c + 1) * cl] = lowpass(n, k)[c * cl:(c + 1) * cl]
    out = out / (np.max(np.abs(out)) + 1e-9)
    return out * np.linspace(0, 1, len(out)) ** 1.6 * 0.9


def render_section(dur, minor, level, lead=False, clap_from=0.0, hats_from=0.0, ending=False):
    """Секция музыки: level 1 — спокойнее, 2 — полный ритм, 3 — с мелодией."""
    n = int(dur * SR)
    bed = np.zeros(n)      # гармония и бас (с «накачкой» от бочки)
    drums = np.zeros(n)
    prog = MINOR if minor else MAJOR
    nb = int(dur / BAR) + 2
    for bar in range(nb):
        t0 = bar * BAR
        if t0 >= dur:
            break
        bass, chord = prog[bar % 4]
        for note in chord:
            add(bed, pad_note(midi(note), BAR + 0.1), t0, 0.40 if level == 1 else 0.34)
        for s_ in range(8):                                   # бас восьмыми с октавным прыжком
            f = midi(bass) * (2 if s_ in (3, 7) else 1)
            add(bed, saw_bass(f, 0.2), t0 + s_ * BEAT / 2, 0.55)
        steps = 8 if level == 1 else 16                       # арпеджио
        pat = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 2, 1]
        for s_ in range(steps):
            tt = t0 + s_ * (BAR / steps)
            add(bed, pluck(midi(chord[pat[s_] % 3] + 12), 0.2, 14), tt, 0.26)
        if level >= 2:
            for s_ in (3, 6, 10, 14):                         # синкопированные аккорды-стэбы
                add(bed, stab([midi(x + 12) for x in chord]), t0 + s_ * S16, 0.5)
        if lead:
            mel = [chord[2] + 12, chord[1] + 12, chord[2] + 12, chord[0] + 24, chord[2] + 12, chord[1] + 12, chord[0] + 24, chord[2] + 24]
            for s_, nt in enumerate(mel):
                add(bed, pluck(midi(nt), 0.4, 6), t0 + s_ * BEAT / 2, 0.30)
        for beat in range(4):
            tb = t0 + beat * BEAT
            add(drums, kick(), tb, 0.85)
            if tb >= clap_from and beat in (1, 3):
                add(drums, clap(), tb, 0.35)
            if tb >= hats_from:
                for q in range(4 if level >= 2 else 2):
                    th = tb + q * (BEAT / (4 if level >= 2 else 2))
                    add(drums, hat(), th, 0.12 if q % 2 == 0 else 0.07)
                add(drums, hat(0.18, 22), tb + BEAT / 2, 0.10)   # открытый хэт на «и»
    # «накачка»: бас и гармония проседают на каждый удар бочки
    t = np.arange(n) / SR
    pump = 1 - 0.55 * np.exp(-(t % BEAT) / 0.11)
    out = bed * pump + drums
    fade = int(0.08 * SR)
    out[-fade:] *= np.linspace(1, 0, fade)
    return out


def make_music():
    b = np.zeros(N)
    secs = [  # начало, конец, минор, уровень, мелодия, clap_from, hats_from
        (0.0, 12.0, True, 1, False, 3.0, 2.0),
        (12.0, 38.0, False, 2, False, 0.0, 0.0),
        (38.0, 47.0, False, 3, True, 0.0, 0.0),
        (47.0, 56.0, False, 3, True, 0.0, 0.0),
    ]
    for start, end, minor, level, lead, cf, hf in secs:
        add(b, render_section(end - start, minor, level, lead, cf, hf), start, 1.0)
        add(b, riser(1.8), end - 1.8, 0.35) if end < DUR else None
        if start > 0:
            add(b, crash(), start, 0.5)
    add(b, mix(stab([midi(60), midi(64), midi(67), midi(72)], 0.5), pluck(midi(84), 1.2, 3)), 55.2, 0.9)  # финальный аккорд
    env = np.ones(N)
    fi, fo = int(0.3 * SR), int(2.2 * SR)
    env[:fi] = np.linspace(0, 1, fi)
    env[-fo:] = np.linspace(1, 0, fo)
    b *= env
    d = int(0.012 * SR)
    r = np.concatenate([np.zeros(d), b[:-d]])
    return np.stack([b, 0.6 * b + 0.4 * r], axis=1)


if __name__ == '__main__':
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    save(f'{out}/sfx.wav', make_sfx(), 0.9)
    save(f'{out}/music.wav', make_music(), 0.9)
    print('готово:', out)
