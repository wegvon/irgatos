#!/usr/bin/env python3
"""Regenerate the Irgatos app icon set from a single geometry definition.

The mark is a capstan drum seen from above: an "irgat" is both a labourer and
the geared winch drum that does the hauling. Everything below is derived from
the two SVGs this script writes, so the committed vector art and the shipped
rasters can never drift apart.

    pip install pillow cairosvg
    python3 scripts/build-app-icons.py

Platform framing differs on purpose:
  * macOS (`icon.icns`, the Tauri PNGs, Linux desktop icons) gets Apple's grid:
    an 824/1024 squircle with a soft contact shadow, so the tile matches the
    optical size of native apps in the Dock.
  * Windows (`icon.ico`, `Square*Logo.png`, `StoreLogo.png`) gets the
    edge-to-edge tile with no shadow, which is what Windows draws its own
    treatment around.
  * `macos/AppIcon.icon` carries the mark alone on transparency; macOS 26's
    Icon Composer supplies the background fill, and `menu_bar_icon()` in
    `src-tauri/src/irgat_chat.rs` turns the same PNG into the menu-bar template.
"""

from __future__ import annotations

import math
import struct
import subprocess
import sys
from io import BytesIO
from pathlib import Path

try:
    import cairosvg
except ImportError:  # pragma: no cover - developer tooling
    sys.exit("cairosvg is required: pip install pillow cairosvg")

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "src-tauri" / "icons"
APPICON = ROOT / "src-tauri" / "macos" / "AppIcon.icon"
PUBLIC = ROOT / "public"

CANVAS = 1024

# Deep copper, so the tile reads as warm metal rather than a greyscale slab.
BG_STOPS = [(0.0, "#E05D1D"), (0.52, "#B33B0C"), (1.0, "#8A2607")]
BG_SOLID = "#B8400F"  # flat stand-in for Icon Composer's background fill
CREAM_STOPS = [(0.0, "#FFFDF9"), (1.0, "#FFE9CE")]

# Capstan geometry, in canvas units on the edge-to-edge 1024 tile. The drum is
# drawn in profile: two rims around a waisted barrel with the rope wound on it.
# That profile is also an I, so the mark doubles as the Irgatos initial.
FLANGE_HALF_W = 252
FLANGE_H = 118
GLYPH_HALF_H = 324
WAIST_HALF_W = 124
TAPER = 46  # tight fillet, so the barrel stays a drum and never an hourglass
RIM_RADIUS = 42
COIL_HALF_W = 98
COIL_H = 38
COIL_PITCH = 92

MAC_CONTENT = 824  # Apple's macOS app icon content box inside 1024
SHADOW_BLUR = 22
SHADOW_OFFSET = 20
SHADOW_ALPHA = 78


def squircle_path(cx: float, cy: float, half: float, n: float = 5.0, steps: int = 720) -> str:
    """Superellipse |x|^n + |y|^n = 1, the continuous-curvature Apple tile shape."""
    points = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        ct, st = math.cos(t), math.sin(t)
        x = math.copysign(abs(ct) ** (2 / n), ct) * half
        y = math.copysign(abs(st) ** (2 / n), st) * half
        points.append(f"{cx + x:.3f},{cy + y:.3f}")
    return "M" + "L".join(points) + "Z"


def _stops(stops: list[tuple[float, str]]) -> str:
    return "".join(
        f'<stop offset="{offset:.2f}" stop-color="{color}"/>' for offset, color in stops
    )


def _coil_subpath(dy: float) -> str:
    """A rope turn across the barrel, knocked out of the cream glyph."""
    radius = COIL_H / 2
    left, right = 512 - COIL_HALF_W, 512 + COIL_HALF_W
    top, bottom = 512 + dy - radius, 512 + dy + radius
    return (
        f"M{left + radius:.0f},{top:.0f}L{right - radius:.0f},{top:.0f}"
        f"A{radius:.0f},{radius:.0f} 0 0 1 {right - radius:.0f},{bottom:.0f}"
        f"L{left + radius:.0f},{bottom:.0f}"
        f"A{radius:.0f},{radius:.0f} 0 0 1 {left + radius:.0f},{top:.0f}Z"
    )


def capstan_path() -> str:
    cx = cy = 512
    outer_x = (cx - FLANGE_HALF_W, cx + FLANGE_HALF_W)
    waist_x = (cx - WAIST_HALF_W, cx + WAIST_HALF_W)
    top, bottom = cy - GLYPH_HALF_H, cy + GLYPH_HALF_H
    rim_in_top, rim_in_bottom = top + FLANGE_H, bottom - FLANGE_H
    waist_top, waist_bottom = rim_in_top + TAPER, rim_in_bottom - TAPER
    r = RIM_RADIUS

    def taper(x_from: float, y_from: float, x_to: float, y_to: float) -> str:
        """Quarter-ellipse fillet off a rim and onto the barrel."""
        k = 0.5523
        return (
            f"C{x_from:.1f},{y_from + k * (y_to - y_from):.1f} "
            f"{x_to + k * (x_from - x_to):.1f},{y_to:.1f} {x_to:.1f},{y_to:.1f}"
        )

    glyph = (
        f"M{outer_x[0] + r:.0f},{top:.0f}"
        f"L{outer_x[1] - r:.0f},{top:.0f}"
        f"A{r:.0f},{r:.0f} 0 0 1 {outer_x[1]:.0f},{top + r:.0f}"
        f"L{outer_x[1]:.0f},{rim_in_top:.0f}"
        f"{taper(outer_x[1], rim_in_top, waist_x[1], waist_top)}"
        f"L{waist_x[1]:.0f},{waist_bottom:.0f}"
        f"{taper(waist_x[1], waist_bottom, outer_x[1], rim_in_bottom)}"
        f"L{outer_x[1]:.0f},{bottom - r:.0f}"
        f"A{r:.0f},{r:.0f} 0 0 1 {outer_x[1] - r:.0f},{bottom:.0f}"
        f"L{outer_x[0] + r:.0f},{bottom:.0f}"
        f"A{r:.0f},{r:.0f} 0 0 1 {outer_x[0]:.0f},{bottom - r:.0f}"
        f"L{outer_x[0]:.0f},{rim_in_bottom:.0f}"
        f"{taper(outer_x[0], rim_in_bottom, waist_x[0], waist_bottom)}"
        f"L{waist_x[0]:.0f},{waist_top:.0f}"
        f"{taper(waist_x[0], waist_top, outer_x[0], rim_in_top)}"
        f"L{outer_x[0]:.0f},{top + r:.0f}"
        f"A{r:.0f},{r:.0f} 0 0 1 {outer_x[0] + r:.0f},{top:.0f}Z"
    )
    return glyph + "".join(_coil_subpath(dy * COIL_PITCH) for dy in (-1, 0, 1))


def mark_defs() -> str:
    return (
        f'<linearGradient id="cream" x1="0" y1="{512 - GLYPH_HALF_H}" x2="0" y2="{512 + GLYPH_HALF_H}" '
        f'gradientUnits="userSpaceOnUse">{_stops(CREAM_STOPS)}</linearGradient>'
    )


def mark_body() -> str:
    return f'<path fill="url(#cream)" fill-rule="evenodd" d="{capstan_path()}"/>'


def mark_svg() -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" '
        f'viewBox="0 0 {CANVAS} {CANVAS}">'
        f"<defs>{mark_defs()}</defs>{mark_body()}</svg>\n"
    )


def tile_svg() -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" '
        f'viewBox="0 0 {CANVAS} {CANVAS}">'
        "<defs>"
        '<linearGradient id="copper" x1="0" y1="0" x2="1024" y2="1024" '
        f'gradientUnits="userSpaceOnUse">{_stops(BG_STOPS)}</linearGradient>'
        '<radialGradient id="sheen" cx="300" cy="226" r="760" gradientUnits="userSpaceOnUse">'
        '<stop offset="0" stop-color="#FFFFFF" stop-opacity="0.16"/>'
        '<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>'
        "</radialGradient>"
        f'<clipPath id="tile"><path d="{squircle_path(512, 512, 512)}"/></clipPath>'
        f"{mark_defs()}"
        "</defs>"
        '<g clip-path="url(#tile)">'
        '<rect width="1024" height="1024" fill="url(#copper)"/>'
        '<rect width="1024" height="1024" fill="url(#sheen)"/>'
        f"{mark_body()}"
        "</g>"
        "</svg>\n"
    )


def render(svg: str, size: int) -> Image.Image:
    png = cairosvg.svg2png(bytestring=svg.encode(), output_width=size, output_height=size)
    return Image.open(BytesIO(png)).convert("RGBA")


def downscale(master: Image.Image, size: int) -> Image.Image:
    if size == master.width:
        return master.copy()
    return master.resize((size, size), Image.LANCZOS)


def mac_master(tile: Image.Image) -> Image.Image:
    """Apple's grid: inset content plus a soft contact shadow."""
    content = tile.resize((MAC_CONTENT, MAC_CONTENT), Image.LANCZOS)
    offset = (CANVAS - MAC_CONTENT) // 2
    shadow = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    silhouette = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    ImageDraw.Draw(silhouette).polygon(
        [
            tuple(float(v) for v in point.split(","))
            for point in squircle_path(512, 512 + SHADOW_OFFSET, MAC_CONTENT / 2)[1:-1].split("L")
        ],
        fill=(0, 0, 0, SHADOW_ALPHA),
    )
    shadow.alpha_composite(silhouette)
    shadow = shadow.filter(ImageFilter.GaussianBlur(SHADOW_BLUR))
    out = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    out.alpha_composite(shadow)
    out.alpha_composite(content, (offset, offset))
    return out


def write_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, "PNG", optimize=True)
    print(f"  {path.relative_to(ROOT)} {image.width}x{image.height}")


def png_bytes(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, "PNG", optimize=True)
    return buffer.getvalue()


def packbits(data: bytes) -> bytes:
    """ICNS ARGB renditions use PackBits with a 130-byte literal cap."""
    out = bytearray()
    i = 0
    while i < len(data):
        run = 1
        while run < 130 and i + run < len(data) and data[i + run] == data[i]:
            run += 1
        if run >= 3:
            out.append(run + 125)
            out.append(data[i])
            i += run
            continue
        literal = 1
        while literal < 128 and i + literal < len(data):
            if (
                i + literal + 2 < len(data)
                and data[i + literal] == data[i + literal + 1] == data[i + literal + 2]
            ):
                break
            literal += 1
        out.append(literal - 1)
        out.extend(data[i : i + literal])
        i += literal
    return bytes(out)


def argb_rendition(image: Image.Image) -> bytes:
    a, r, g, b = (
        bytes(channel.tobytes())
        for channel in (image.getchannel("A"), *image.convert("RGB").split())
    )
    return b"ARGB" + b"".join(packbits(channel) for channel in (a, r, g, b))


ICNS_PNG_TYPES = [
    (b"icp4", 16),
    (b"icp5", 32),
    (b"icp6", 64),
    (b"ic07", 128),
    (b"ic08", 256),
    (b"ic09", 512),
    (b"ic10", 1024),
    (b"ic11", 32),
    (b"ic12", 64),
    (b"ic13", 256),
    (b"ic14", 512),
]
ICNS_ARGB_TYPES = [(b"ic04", 16), (b"ic05", 32)]


def build_icns(master: Image.Image, path: Path) -> None:
    chunks = []
    for kind, size in ICNS_ARGB_TYPES:
        chunks.append((kind, argb_rendition(downscale(master, size))))
    for kind, size in ICNS_PNG_TYPES:
        chunks.append((kind, png_bytes(downscale(master, size))))
    body = b"".join(kind + struct.pack(">I", len(data) + 8) + data for kind, data in chunks)
    path.write_bytes(b"icns" + struct.pack(">I", len(body) + 8) + body)
    print(f"  {path.relative_to(ROOT)} {len(chunks)} renditions, {path.stat().st_size} bytes")


ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def build_ico(master: Image.Image, path: Path) -> None:
    payloads = [png_bytes(downscale(master, size)) for size in ICO_SIZES]
    offset = 6 + 16 * len(payloads)
    header = struct.pack("<HHH", 0, 1, len(payloads))
    directory = b""
    for size, payload in zip(ICO_SIZES, payloads):
        directory += struct.pack(
            "<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(payload), offset
        )
        offset += len(payload)
    path.write_bytes(header + directory + b"".join(payloads))
    print(f"  {path.relative_to(ROOT)} {len(payloads)} entries, {path.stat().st_size} bytes")


WINDOWS_TILES = {
    "Square30x30Logo.png": 30,
    "Square44x44Logo.png": 44,
    "Square71x71Logo.png": 71,
    "Square89x89Logo.png": 89,
    "Square107x107Logo.png": 107,
    "Square142x142Logo.png": 142,
    "Square150x150Logo.png": 150,
    "Square284x284Logo.png": 284,
    "Square310x310Logo.png": 310,
    "StoreLogo.png": 50,
}

SIDEBAR_SIZE = (164, 314)


def _font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
        "/System/Library/Fonts/SFNS.ttf",
    ):
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default()


def build_sidebar(tile: Image.Image, path: Path) -> None:
    """NSIS installer sidebar: copper panel, mark, wordmark."""
    width, height = SIDEBAR_SIZE
    panel = Image.new("RGB", (width, height), (0, 0, 0))
    top, bottom = (222, 93, 29), (122, 33, 8)
    draw = ImageDraw.Draw(panel)
    for y in range(height):
        ratio = y / (height - 1)
        draw.line(
            [(0, y), (width, y)],
            fill=tuple(round(top[i] + (bottom[i] - top[i]) * ratio) for i in range(3)),
        )
    mark = render(mark_svg(), 96)
    panel.paste(mark, ((width - 96) // 2, 74), mark)
    label = "IRGATOS"
    font = _font(19)
    text_width = draw.textlength(label, font=font)
    draw.text(((width - text_width) / 2, 192), label, font=font, fill=(255, 244, 232))
    panel.save(path, "BMP")
    print(f"  {path.relative_to(ROOT)} {width}x{height}")


def main() -> None:
    print("writing vector sources")
    tile_source, mark_source = tile_svg(), mark_svg()
    (ICONS / "irgatos-icon.svg").write_text(tile_source)
    (ICONS / "irgatos-mark.svg").write_text(mark_source)
    print("  src-tauri/icons/irgatos-icon.svg\n  src-tauri/icons/irgatos-mark.svg")

    tile = render(tile_source, CANVAS)
    mark = render(mark_source, CANVAS)
    mac = mac_master(tile)

    print("macOS / Linux rasters (Apple grid, inset + shadow)")
    for name, size in (
        ("32x32.png", 32),
        ("128x128.png", 128),
        ("128x128@2x.png", 256),
        ("icon.png", 256),
    ):
        write_png(downscale(mac, size), ICONS / name)
    build_icns(mac, ICONS / "icon.icns")

    print("Windows rasters (edge-to-edge tile)")
    build_ico(tile, ICONS / "icon.ico")
    for name, size in sorted(WINDOWS_TILES.items(), key=lambda item: item[1]):
        write_png(downscale(tile, size), ICONS / name)
    build_sidebar(tile, ICONS / "installer-sidebar.bmp")

    print("Icon Composer layer + in-app mark")
    write_png(mark, APPICON / "Assets" / "icon.png")
    write_png(downscale(tile, 512), PUBLIC / "irgat.png")

    icon_json = APPICON / "icon.json"
    red, green, blue = (int(BG_SOLID[i : i + 2], 16) / 255 for i in (1, 3, 5))
    fill = f"extended-srgb:{red:.5f},{green:.5f},{blue:.5f},1.00000"
    text = icon_json.read_text()
    start = text.index('"solid" : "') + len('"solid" : "')
    icon_json.write_text(text[:start] + fill + text[text.index('"', start) :])
    print(f"  src-tauri/macos/AppIcon.icon/icon.json fill {fill}")

    print(
        "\nreminder: src-tauri/macos/Assets.car is compiled from AppIcon.icon by\n"
        "Icon Composer / actool and can only be rebuilt on macOS:\n"
        "  ./scripts/build-macos-assets-car.sh"
    )
    if sys.platform == "darwin":
        subprocess.run([str(ROOT / "scripts" / "build-macos-assets-car.sh")], check=False)


if __name__ == "__main__":
    main()
