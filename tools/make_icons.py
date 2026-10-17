"""Génère les icônes de Révi (PNG) : fiche bristol blanche + trait de surligneur sur fond bleu stylo.
Usage : python3 tools/make_icons.py  (depuis le dossier du projet)"""
from PIL import Image, ImageDraw

INK = (36, 67, 181)       # --pen
PAPER = (255, 255, 255)
RULE = (205, 217, 240)
MARGIN = (239, 140, 128)
HL = (255, 233, 74)

def draw(size, safe=1.0, rounded=True):
    S = size * 4
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(S * 0.22) if rounded else 0
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=INK)
    # Fiche (dessinée sur un calque puis tournée)
    card = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    c = ImageDraw.Draw(card)
    w, hgt = S * 0.66 * safe, S * 0.46 * safe
    x0, y0 = (S - w) / 2, (S - hgt) / 2 - S * 0.02
    c.rounded_rectangle([x0, y0, x0 + w, y0 + hgt], radius=S * 0.025, fill=PAPER)
    line_y = y0 + hgt * 0.24
    c.rectangle([x0, line_y, x0 + w, line_y + S * 0.012], fill=MARGIN)
    for k in (0.48, 0.70):
        yy = y0 + hgt * k
        c.rectangle([x0 + w * 0.08, yy, x0 + w * 0.92, yy + S * 0.007], fill=RULE)
    # Trait de surligneur (forme légèrement irrégulière)
    hy = y0 + hgt * 0.56
    hx0, hx1 = x0 + w * 0.12, x0 + w * 0.80
    th = hgt * 0.17
    c.polygon([(hx0, hy + th * 0.15), (hx1, hy - th * 0.05), (hx1 + w * 0.02, hy + th * 0.95), (hx0 - w * 0.01, hy + th * 1.05)], fill=HL)
    card = card.rotate(6, resample=Image.BICUBIC, center=(S / 2, S / 2))
    im.alpha_composite(card)
    return im.resize((size, size), Image.LANCZOS)

draw(192).save("icons/icon-192.png")
draw(512).save("icons/icon-512.png")
draw(512, safe=0.78, rounded=False).save("icons/maskable-512.png")
draw(180, rounded=False).convert("RGB").save("icons/apple-touch-icon.png")
draw(32).save("icons/favicon-32.png")
print("ok")
