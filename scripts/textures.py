"""Genera las 2 texturas WebP del ramo (H7.5, decisión A). Deterministas (semilla fija). Uso: python3 -I textures.py <carpeta>"""
import sys, os
import numpy as np
from PIL import Image

out = sys.argv[1]
rng = np.random.default_rng(20261030)

def blur_wrap(a, sigma):
    """Desenfoque gaussiano periódico (por FFT): el resultado es repetible sin costuras."""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))

def norm(a):
    a = a - a.min()
    return a / (a.max() or 1)

# 1. Papel: grano fino + nubes suaves + fibras, repetible en mosaico (256 px).
S = 256
grain = norm(blur_wrap(rng.standard_normal((S, S)), 0.7))
cloud = norm(blur_wrap(rng.standard_normal((S, S)), 14))
fib = np.zeros((S, S))
for _ in range(70):
    x, y = rng.integers(0, S, 2)
    ang = rng.uniform(0, np.pi)
    ln = rng.integers(6, 22)
    for t in range(ln):
        fib[int(y + t * np.sin(ang)) % S, int(x + t * np.cos(ang)) % S] += 1
fib = norm(blur_wrap(fib, 0.6))
lum = 0.5 * grain + 0.35 * cloud - 0.25 * fib
lum = (lum - lum.mean()) / (lum.std() or 1)
base = np.array([248, 246, 241], dtype=float)
warm = np.array([238, 232, 222], dtype=float)
t = np.clip(0.5 + lum * 0.3, 0, 1)[..., None]
paper = base * t + warm * (1 - t)
# Gris neutro relativo (multiplicar sobre el marfil): 255 = sin cambio.
mult = np.clip(255 - (255 - paper) * 0.9 + 4, 0, 255)
img = Image.fromarray(mult.astype(np.uint8), 'RGB')
img.save(os.path.join(out, 'paper.webp'), 'WEBP', quality=85, method=6)

# 2. Mancha de acuarela (512 px, con alfa): manchas lila, rosa y salvia con borde más oscuro.
S = 512
yy, xx = np.mgrid[0:S, 0:S] / S
def stain(cx, cy, rx, ry, rough, seed_sigma):
    n = norm(blur_wrap(rng.standard_normal((S, S)), seed_sigma)) - 0.5
    fine = norm(blur_wrap(rng.standard_normal((S, S)), 2.5)) - 0.5
    d = np.sqrt(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) + n * rough + fine * 0.12
    inside = np.clip((1 - d) / 0.05, 0, 1)            # interior con borde suave
    edge = np.exp(-((d - 0.97) / 0.035) ** 2)           # cerco más oscuro del agua al secarse
    pool = norm(blur_wrap(rng.standard_normal((S, S)), 6)) # pigmento desigual
    return inside * (0.28 + 0.4 * pool) + edge * 0.6 * inside.clip(0.2, 1)
layers = [
    (np.array([200, 184, 232]), stain(0.5, 0.46, 0.42, 0.40, 0.35, 22)),
    (np.array([232, 196, 210]), stain(0.36, 0.6, 0.26, 0.24, 0.4, 16)),
    (np.array([196, 214, 190]), stain(0.66, 0.62, 0.24, 0.22, 0.4, 16)),
]
rgb = np.zeros((S, S, 3)); alpha = np.zeros((S, S))
for color, a in layers:
    a = np.clip(a, 0, 1)
    rgb = rgb * (1 - a[..., None]) + color * a[..., None]
    alpha = alpha + a * (1 - alpha)
rgb = np.where(alpha[..., None] > 0, rgb / np.maximum(alpha[..., None], 1e-6) * alpha[..., None] / np.maximum(alpha[..., None], 1e-6), 255)
rgba = np.dstack([np.clip(rgb, 0, 255), np.clip(alpha * 0.75 * 255, 0, 255)]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').resize((384, 384), Image.LANCZOS).save(os.path.join(out, 'wash.webp'), 'WEBP', quality=55, method=6, alpha_quality=50)
for f in ('paper.webp', 'wash.webp'):
    print(f, os.path.getsize(os.path.join(out, f)), 'bytes')
