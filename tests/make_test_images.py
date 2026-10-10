"""Membuat gambar uji sintetis (tanpa foto asli): ilustrasi chibi ala anime + latar rumit + glow + artefak JPEG, dan cincin."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import sys, os
out = sys.argv[1] if len(sys.argv) > 1 else 'tests/img'
os.makedirs(out, exist_ok=True)
S = 900
rng = np.random.default_rng(7)

def chibi():
    im = Image.new('RGB', (S, S), (30, 14, 90))                 # latar indigo
    d = ImageDraw.Draw(im)
    for x in range(0, S, 90):                                     # blok coklat di atas seperti screenshot
        d.rectangle([x, 0, x + 70, 90 + (x * 7) % 60], fill=(48, 24, 22))
    d.rectangle([0, 700, S, S], fill=(200, 180, 190))             # badan/baju bawah
    d.polygon([(250, 900), (300, 640), (600, 640), (650, 900)], fill=(205, 182, 192))
    d.ellipse([200, 190, 700, 700], fill=(206, 180, 190))         # wajah
    d.polygon([(190, 420), (230, 190), (450, 120), (680, 190), (710, 440), (640, 300), (560, 420), (500, 280), (430, 460), (330, 300), (260, 480)], fill=(40, 20, 22))  # rambut
    d.ellipse([330, 470, 380, 560], fill=(40, 20, 22)); d.ellipse([520, 470, 570, 560], fill=(40, 20, 22))   # mata
    d.ellipse([343, 485, 358, 505], fill=(255, 255, 255)); d.ellipse([533, 485, 548, 505], fill=(255, 255, 255))
    d.arc([400, 560, 500, 620], 20, 160, fill=(70, 30, 40), width=7)  # mulut
    glow = Image.new('L', (S, S), 0); ImageDraw.Draw(glow).ellipse([150, 120, 750, 760], outline=255, width=26)
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    im = Image.composite(Image.new('RGB', (S, S), (235, 215, 255)), im, glow.point(lambda v: int(v * 0.5)))
    # re-draw face above glow edge for crisp shapes
    d = ImageDraw.Draw(im)
    d.ellipse([200, 190, 700, 700], fill=(206, 180, 190))
    d.polygon([(190, 420), (230, 190), (450, 120), (680, 190), (710, 440), (640, 300), (560, 420), (500, 280), (430, 460), (330, 300), (260, 480)], fill=(40, 20, 22))
    d.ellipse([330, 470, 380, 560], fill=(40, 20, 22)); d.ellipse([520, 470, 570, 560], fill=(40, 20, 22))
    d.ellipse([343, 485, 358, 505], fill=(255, 255, 255)); d.ellipse([533, 485, 548, 505], fill=(255, 255, 255))
    d.arc([400, 560, 500, 620], 20, 160, fill=(70, 30, 40), width=7)
    a = np.asarray(im).astype(np.int16) + rng.integers(-6, 7, (S, S, 3))
    Image.fromarray(np.clip(a, 0, 255).astype(np.uint8)).save(f'{out}/chibi.jpg', quality=62)   # artefak JPEG sungguhan
    Image.open(f'{out}/chibi.jpg').resize((S, S)).save(f'{out}/chibi.png')

def ring():
    im = Image.new('RGBA', (400, 400), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.ellipse([60, 60, 340, 340], fill=(220, 30, 30, 255)); d.ellipse([140, 140, 260, 260], fill=(0, 0, 0, 0))   # cincin: lubang transparan
    d.rectangle([20, 20, 70, 70], fill=(30, 90, 220, 255)); d.rectangle([70, 20, 120, 70], fill=(30, 200, 90, 255))  # dua kotak bersebelahan (uji celah)
    im.save(f'{out}/ring.png')

def letters():
    im = Image.new('RGB', (600, 300), (255, 255, 255)); d = ImageDraw.Draw(im)
    d.ellipse([40, 40, 240, 260], fill=(0, 0, 0)); d.ellipse([90, 90, 190, 210], fill=(255, 255, 255))   # huruf O
    d.rectangle([300, 40, 360, 260], fill=(0, 0, 0)); d.polygon([(380, 260), (480, 40), (580, 260), (540, 260), (480, 120), (420, 260)], fill=(0, 0, 0))
    im.filter(ImageFilter.GaussianBlur(0.8)).save(f'{out}/letters.png')

chibi(); ring(); letters(); print('ok', os.listdir(out))
