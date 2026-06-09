#!/usr/bin/env python3
"""Genera le icone PWA (PNG) senza dipendenze esterne.

Sfondo scuro (#0a0a0c) + glifo Euro in oro (#d4a24a), come il tema dell'app.
PNG scritto a mano (solo zlib di stdlib), glifo con supersampling 4x per bordi morbidi.
"""
import math
import struct
import zlib

BG = (0x0a, 0x0a, 0x0c)
GOLD = (0xd4, 0xa2, 0x4a)
SS = 4  # fattore di supersampling


def euro_coverage(px, py, size, pad):
    """Ritorna copertura [0..1] del glifo Euro nel pixel (coord. in unità size)."""
    # area utile (per maskable lasciamo padding maggiore)
    inner = size * (1 - 2 * pad)
    # piccolo offset a destra: le barre sporgono a sinistra, così il glifo
    # risulta otticamente centrato
    cx = size / 2.0 + inner * 0.05
    cy = size / 2.0
    R = inner * 0.34          # raggio esterno dell'anello
    thick = inner * 0.135     # spessore anello
    r = R - thick
    gap_half = math.radians(38)  # apertura della "C" verso destra
    bar_t = inner * 0.115        # spessore barre orizzontali
    bar_b = R * 0.30             # distanza barre dal centro
    bar_x0 = cx - R * 1.18
    bar_x1 = cx + R * 0.18

    dx = px - cx
    dy = py - cy
    dist = math.hypot(dx, dy)

    # anello (C): dentro lo spessore e fuori dall'apertura destra
    in_ring = (r <= dist <= R) and (abs(math.atan2(dy, dx)) > gap_half)

    # due barre orizzontali
    in_bar = (bar_x0 <= px <= bar_x1) and (
        abs(py - (cy - bar_b)) <= bar_t / 2 or
        abs(py - (cy + bar_b)) <= bar_t / 2
    )
    return 1.0 if (in_ring or in_bar) else 0.0


def render(size, pad):
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            # supersampling
            acc = 0.0
            for sy in range(SS):
                for sx in range(SS):
                    px = x + (sx + 0.5) / SS
                    py = y + (sy + 0.5) / SS
                    acc += euro_coverage(px, py, size, pad)
            cov = acc / (SS * SS)
            r = round(BG[0] + (GOLD[0] - BG[0]) * cov)
            g = round(BG[1] + (GOLD[1] - BG[1]) * cov)
            b = round(BG[2] + (GOLD[2] - BG[2]) * cov)
            row += bytes((r, g, b))
        rows.append(row)
    return rows


def write_png(path, size, pad):
    rows = render(size, pad)
    raw = bytearray()
    for row in rows:
        raw.append(0)  # filter type 0
        raw += row
    comp = zlib.compress(bytes(raw), 9)

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        c += struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
        return c

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + \
        chunk(b"IDAT", comp) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print("wrote", path, size)


if __name__ == "__main__":
    import os
    os.makedirs("icons", exist_ok=True)
    write_png("icons/apple-touch-icon.png", 180, 0.10)
    write_png("icons/icon-192.png", 192, 0.10)
    write_png("icons/icon-512.png", 512, 0.10)
    # maskable: glifo più piccolo, padding di sicurezza per il crop
    write_png("icons/icon-512-maskable.png", 512, 0.20)
