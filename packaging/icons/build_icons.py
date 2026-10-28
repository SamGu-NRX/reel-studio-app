#!/usr/bin/env python3
"""Regenerate every Reel Studio icon file from the design below.

    python -m venv .venv && .venv/bin/pip install pillow resvg-py
    .venv/bin/python packaging/icons/build_icons.py

Writes icon.svg, icon.png (1024), icon.icns and icon.ico next to this file, and the nightly's set in nightly/.
"""
import io
import math
import struct
from pathlib import Path

import resvg_py
from PIL import Image

OUT = Path(__file__).resolve().parent

INK, PAPER, CORAL = "#1d1b18", "#f7f5f1", "#e8603c"

# plate, phone, keyline round the sparkle, and the plate's edge line. The nightly is the same mark at night: the
# plate and the phone swap, so it is told apart at a glance in the Dock and the taskbar and still reads at 16 px.
STABLE = dict(plate=PAPER, phone=INK, keyline=PAPER, edge=INK)
NIGHTLY = dict(plate=INK, phone=PAPER, keyline=INK, edge=PAPER)


def squircle(cx, cy, half, n=5.0, steps=240):
    """Superellipse path (|x|^n + |y|^n = half^n), close to Apple's icon plate."""
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = cx + half * math.copysign(abs(c) ** (2 / n), c)
        y = cy + half * math.copysign(abs(s) ** (2 / n), s)
        pts.append(f"{x:.1f},{y:.1f}")
    return "M" + " L".join(pts) + " Z"


def sparkle(cx, cy, r, pinch=0.2):
    """Four-point star with concave sides."""
    k = r * pinch
    return (f"M{cx},{cy - r} Q{cx + k},{cy - k} {cx + r},{cy} "
            f"Q{cx + k},{cy + k} {cx},{cy + r} Q{cx - k},{cy + k} {cx - r},{cy} "
            f"Q{cx - k},{cy - k} {cx},{cy - r} Z")


def make_svg(shadow=True, scale=1.0, edge=0.10, colors=STABLE):
    """scale > 1 grows the plate/glyph about the centre (tighter padding for Windows)."""
    shadow_defs = (
        '<filter id="sh" x="-20%" y="-20%" width="140%" height="150%">'
        '<feGaussianBlur stdDeviation="14"/></filter>'
    ) if shadow else ""
    shadow_el = (
        f'<path d="{squircle(512, 512, 412)}" transform="translate(0 14)" '
        'fill="#000" fill-opacity="0.28" filter="url(#sh)"/>'
    ) if shadow else ""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>{shadow_defs}</defs>
  <g transform="translate(512 512) scale({scale}) translate(-512 -512)">
  {shadow_el}
  <!-- plate: 824 px squircle on a 1024 canvas (macOS Big Sur+ grid) -->
  <path d="{squircle(512, 512, 412)}" fill="{colors['plate']}"/>
  <path d="{squircle(512, 512, 411)}" fill="none" stroke="{colors['edge']}" stroke-opacity="{edge}" stroke-width="2"/>
  <!-- 9:16 phone / reel frame -->
  <rect x="332" y="192" width="360" height="640" rx="72" fill="{colors['phone']}"/>
  <!-- play triangle -->
  <path d="M462 424 L462 600 L606 512 Z" fill="{CORAL}" stroke="{CORAL}" stroke-width="34" stroke-linejoin="round"/>
  <!-- sparkle, knocked out of the phone with a plate-coloured keyline -->
  <path d="{sparkle(710, 246, 104)}" fill="{CORAL}" stroke="{colors['keyline']}" stroke-width="26" stroke-linejoin="round" paint-order="stroke"/>
  </g>
</svg>
"""


def render(svg, size):
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size, height=size)
    return Image.open(io.BytesIO(bytes(png))).convert("RGBA")


def write_icns(path, svg):
    """Hand-built .icns from PNG chunks (Pillow's writer is lossy about @2x slots)."""
    slots = [  # (type, pixel size)
        (b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128), (b"ic08", 256),
        (b"ic09", 512), (b"ic10", 1024), (b"ic11", 32), (b"ic12", 64),
        (b"ic13", 256), (b"ic14", 512),
    ]
    body = b""
    for tag, px in slots:
        buf = io.BytesIO()
        render(svg, px).save(buf, "PNG")
        data = buf.getvalue()
        body += tag + struct.pack(">I", len(data) + 8) + data
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)


def build(out, colors, edge_mac, edge_win):
    out.mkdir(exist_ok=True)
    mac = make_svg(edge=edge_mac, colors=colors)
    (out / "icon.svg").write_text(mac, encoding="utf-8")
    render(mac, 1024).save(out / "icon.png")
    write_icns(out / "icon.icns", mac)

    # Windows: no soft shadow, plate grown to fill more of the tiny sizes.
    win = make_svg(shadow=False, scale=1.18, edge=edge_win, colors=colors)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [render(win, s) for s in sizes]
    imgs[-1].save(out / "icon.ico", format="ICO", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
    return mac, win


def main():
    mac, win = build(OUT, STABLE, 0.10, 0.25)
    # A paper edge line keeps the ink plate from sinking into a dark Dock or taskbar.
    night_mac, night_win = build(OUT / "nightly", NIGHTLY, 0.16, 0.30)

    # Previews for eyeballing (not committed).
    prev = OUT / "_preview"
    prev.mkdir(exist_ok=True)
    for s in (64, 32, 16):
        render(mac, s).save(prev / f"mac-{s}.png")
        render(win, s).save(prev / f"win-{s}.png")
    sheet = Image.new("RGBA", (1400, 560), "#ffffff")
    for row, pair in enumerate(((mac, win), (night_mac, night_win))):
        x = 20
        for s in (16, 32, 64):
            for svg in pair:
                im = render(svg, s).resize((s * 4, s * 4), Image.NEAREST)
                sheet.paste(im, (x, 20 + row * 280), im)
                x += s * 4 + 20
    sheet.save(prev / "sheet.png")


if __name__ == "__main__":
    main()

