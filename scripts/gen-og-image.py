#!/usr/bin/env python3
"""Generate MiniSearch 1200x630 social preview card (brand #1070D0)."""
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BRAND = (16, 112, 208)          # rgba(16,112,208) sampled from favicon
DARK = (10, 22, 40)
WHITE = (255, 255, 255)
FADED = (205, 224, 246)

def font(path, size):
    return ImageFont.truetype(path, size)

# --- background: dark blue radial-ish gradient ---
img = Image.new("RGB", (W, H), DARK)
draw = ImageDraw.Draw(img)
# soft brand glow top-left
glow = Image.new("RGB", (W, H), DARK)
gd = ImageDraw.Draw(glow)
for i in range(60, 0, -1):
    alpha = i
    color = tuple(int(BRAND[c] * (i / 60) + DARK[c] * (1 - i / 60)) for c in range(3))
    r = i * 14
    gd.ellipse([-r, -r, r, r], fill=color)
glow = glow.filter(ImageFilter.GaussianBlur(80))
img = Image.blend(img, glow, 0.55)
draw = ImageDraw.Draw(img)

# --- accent bar bottom ---
draw.rectangle([0, H - 10, W, H], fill=BRAND)

# --- logo: favicon on white rounded tile, top-left ---
fav = Image.open("client/public/favicon.png").convert("RGBA")
fav_crop = fav.crop((48, 48, 208, 208))          # remove transparent padding
tile = 220
fav_bg = Image.new("RGBA", (tile, tile), (255, 255, 255, 255))
mask = Image.new("L", (tile, tile), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([0, 0, tile, tile], radius=48, fill=255)
fav_resized = fav_crop.resize((150, 150), Image.LANCZOS)
fav_bg.paste(fav_resized, ((tile - 150) // 2, (tile - 150) // 2), fav_resized)
img.paste(fav_bg, (72, 78), mask)

# --- headline ---
f_bold = font("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 120)
f_reg = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 96)
f_tag = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 40)
f_meta = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 32)

def text_width(d, s, f):
    b = d.textbbox((0, 0), s, font=f)
    return b[2] - b[0]

# "MiniSearch" with Search accent
full = "MiniSearch"
search = "Search"
search_span = text_width(draw, "Mini", f_bold)
sw = text_width(draw, search, f_bold)
sx = 72 + search_span
sy = 340
draw.text((72, sy), "Mini", font=f_bold, fill=WHITE)
draw.text((sx, sy), "Search", font=f_bold, fill=(96, 178, 255))

# tagline
tagline = "Private AI search that runs in your browser."
tw = text_width(draw, tagline, f_tag)
draw.text((72 + 4, sy + 140), tagline, font=f_tag, fill=FADED)

# bottom-left metadata pill
pill = "No API key  •  No accounts  •  In-browser AI"
pw = text_width(draw, pill, f_meta)
draw.rounded_rectangle([72, H - 110, 72 + pw + 40, H - 56], radius=27, fill=(20, 40, 70, 255))
draw.text((72 + 20, H - 102), pill, font=f_meta, fill=FADED)

# subtle grid dots right side (search-result motif)
for gx in range(850, 1150, 56):
    for gy in range(120, 480, 56):
        draw.ellipse([gx, gy, gx + 6, gy + 6], fill=(45, 70, 110, 255))

img.save("client/public/og-image.png", "PNG")
print("wrote client/public/og-image.png", img.size)
