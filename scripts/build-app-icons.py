#!/usr/bin/env python3
"""Regenerate the Irgatos app icon set from a single geometry definition.

The mark is the selected "ır" design: the Turkish dotless ı and an r joined
into one flat geometric ligature, near-black on a white tile. Everything below is derived from the two SVGs this script writes,
so the committed vector art and the shipped
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
  * `public/apple-touch-icon.png` is a full-bleed square, because iOS masks
    home-screen icons itself and would show the tile's transparent corners.
  * `macos/AppIcon.icon` carries the mark alone on transparency, drawn white so
    the menu-bar template keeps it; Icon Composer paints it with MARK_SOLID
    on the BG_SOLID fill, and `menu_bar_icon()` in
    `src-tauri/src/irgat_chat.rs` turns the same PNG into the menu-bar template.
"""

from __future__ import annotations

import shutil
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

# Colors and geometry of the approved 15 / ır concept.
BG_STOPS = [(0.0, "#FFFFFF"), (1.0, "#F4F4F6")]
BG_SOLID = "#FFFFFF"
MARK_SOLID = "#111111"
TILE_RADIUS = 98 * CANVAS / 432
MAC_CONTENT = 824
SHADOW_BLUR = 22
SHADOW_OFFSET = 20
SHADOW_ALPHA = 40


def _stops(stops: list[tuple[float, str]]) -> str:
    return "".join(
        f'<stop offset="{offset:.2f}" stop-color="{color}"/>' for offset, color in stops
    )


def mark_body(color: str = MARK_SOLID) -> str:
    # Stem and shoulder of "ır", centred on the 1024 canvas at 1.2x the preview.
    return (
        f'<g fill="{color}" transform="translate(512 512) scale(1.2) translate(-518 -590)">'
        '<rect x="330" y="404" width="118" height="372" rx="8"/>'
        '<path d="M490 776 L490 620 Q490 404 706 404 L706 520 Q608 520 608 620 L608 776 Z"/>'
        "</g>"
    )


def mark_svg(color: str = MARK_SOLID) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" '
        f'viewBox="0 0 {CANVAS} {CANVAS}">{mark_body(color)}</svg>\n'
    )


def tile_svg(radius: float = TILE_RADIUS) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{CANVAS}" height="{CANVAS}" '
        f'viewBox="0 0 {CANVAS} {CANVAS}">'
        f'<defs><linearGradient id="paper" x2="0" y2="1">{_stops(BG_STOPS)}</linearGradient></defs>'
        f'<rect width="1024" height="1024" rx="{radius}" fill="url(#paper)"/>'
        f"{mark_body()}</svg>\n"
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
    ImageDraw.Draw(silhouette).rounded_rectangle(
        (offset, offset + SHADOW_OFFSET, offset + MAC_CONTENT - 1,
         offset + SHADOW_OFFSET + MAC_CONTENT - 1),
        radius=TILE_RADIUS * MAC_CONTENT / CANVAS,
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
    """NSIS installer sidebar: paper panel, mark, wordmark."""
    width, height = SIDEBAR_SIZE
    panel = Image.new("RGB", (width, height), (0, 0, 0))
    top, bottom = (255, 255, 255), (244, 244, 246)
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
    draw.text(((width - text_width) / 2, 192), label, font=font, fill=(17, 17, 17))
    panel.save(path, "BMP")
    print(f"  {path.relative_to(ROOT)} {width}x{height}")


def main() -> None:
    print("writing vector sources")
    tile_source, mark_source = tile_svg(), mark_svg()
    (ICONS / "irgatos-icon.svg").write_text(tile_source)
    (ICONS / "irgatos-mark.svg").write_text(mark_source)
    print("  src-tauri/icons/irgatos-icon.svg\n  src-tauri/icons/irgatos-mark.svg")

    tile = render(tile_source, CANVAS)
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
    write_png(render(mark_svg("#FFFFFF"), CANVAS), APPICON / "Assets" / "icon.png")
    write_png(downscale(tile, 512), PUBLIC / "irgat.png")
    write_png(render(tile_svg(radius=0), 180), PUBLIC / "apple-touch-icon.png")

    icon_json = APPICON / "icon.json"
    text = icon_json.read_text()
    background, mark_fill = (
        "extended-srgb:{:.5f},{:.5f},{:.5f},1.00000".format(
            *(int(color[i : i + 2], 16) / 255 for i in (1, 3, 5))
        )
        for color in (BG_SOLID, MARK_SOLID)
    )
    start = text.index('"solid" : "') + len('"solid" : "')
    text = text[:start] + background + text[text.index('"', start) :]
    layer_fill = text.index('"fill" : ', start)
    text = (
        text[:layer_fill]
        + f'"fill" : {{\n            "solid" : "{mark_fill}"\n          }}'
        + text[text.index(",", layer_fill) :]
    )
    icon_json.write_text(text)
    print(f"  src-tauri/macos/AppIcon.icon/icon.json fill {background}, mark {mark_fill}")

    print(
        "\nreminder: src-tauri/macos/Assets.car is compiled from AppIcon.icon by\n"
        "Icon Composer / actool and can only be rebuilt on macOS:\n"
        "  ./scripts/build-macos-assets-car.sh"
    )
    if sys.platform == "darwin" and shutil.which("xcrun"):
        compiler = subprocess.run(["xcrun", "--find", "actool"], capture_output=True)
        if compiler.returncode == 0:
            subprocess.run([str(ROOT / "scripts" / "build-macos-assets-car.sh")], check=True)
        else:
            print("actool unavailable; macOS release and dev bundles use the generated ICNS.")


if __name__ == "__main__":
    main()
