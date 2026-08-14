#!/usr/bin/env python3
"""Render preview images for VLM-based quality verification.

Modes:
  picking    — micrograph + green circles at picked coords
  classgrid  — grid of class averages from a .mrcs stack
  particles  — grid of first N particle thumbnails from a .mrcs stack
  slice      — middle z-slice of a 3D volume .mrc

All outputs are PNG files written to the given --output path, downsized
to at most 768px on the longest side (VLM-friendly).

Usage:
  python3 render_preview.py --mode picking --micrograph <mrc> --coords <star> --output <png>
  python3 render_preview.py --mode classgrid --stack <mrcs> --output <png> [--max 10]
  python3 render_preview.py --mode particles --stack <mrcs> --output <png> [--max 12]
  python3 render_preview.py --mode slice --volume <mrc> --output <png>
"""
import os, sys, argparse, re
import numpy as np
import mrcfile
from PIL import Image, ImageDraw

MAX_DIM = 768


def normalize_to_uint8(arr):
    """Percentile-normalize a 2D float array to 0-255 uint8."""
    if arr.size == 0:
        return np.zeros((1, 1), dtype=np.uint8)
    mn = float(np.percentile(arr, 2))
    mx = float(np.percentile(arr, 98))
    if mx <= mn:
        mx = mn + 1
    out = np.clip((arr - mn) / (mx - mn), 0, 1)
    return (out * 255).astype(np.uint8)


def downsample(img_arr, max_dim=MAX_DIM):
    """Crop-center + downsample a 2D uint8 array to fit max_dim on the longest side."""
    h, w = img_arr.shape
    if max(h, w) <= max_dim:
        return img_arr
    scale = max_dim / max(h, w)
    new_h = max(1, int(h * scale))
    new_w = max(1, int(w * scale))
    pil = Image.fromarray(img_arr)
    pil = pil.resize((new_w, new_h), Image.BILINEAR)
    return np.asarray(pil)


def parse_autopick_coords(star_path, micrograph_basename=None):
    """Return list of (x, y) pixel coords from an autopick.star.
    If micrograph_basename is given, only return coords for that micrograph."""
    coords = []
    if not os.path.exists(star_path):
        return coords
    x_col = -1
    y_col = -1
    mic_col = -1
    in_particles = False
    with open(star_path) as f:
        for line in f:
            s = line.strip()
            if s.startswith("data_"):
                in_particles = s.startswith("data_particles")
                continue
            if not in_particles:
                continue
            if s.startswith("_rlnCoordinateX"):
                x_col = int(s.split()[-1].lstrip("#")) - 1
                continue
            if s.startswith("_rlnCoordinateY"):
                y_col = int(s.split()[-1].lstrip("#")) - 1
                continue
            if s.startswith("_rlnMicrographName"):
                mic_col = int(s.split()[-1].lstrip("#")) - 1
                continue
            parts = s.split()
            if not parts or parts[0].startswith("_") or parts[0] in ("loop_", "#"):
                continue
            try:
                x = float(parts[x_col]) if x_col >= 0 and x_col < len(parts) else None
                y = float(parts[y_col]) if y_col >= 0 and y_col < len(parts) else None
                if x is None or y is None:
                    continue
                if micrograph_basename and mic_col >= 0 and mic_col < len(parts):
                    mic_name = parts[mic_col]
                    if os.path.basename(mic_name) != micrograph_basename:
                        continue
                coords.append((x, y))
            except (ValueError, IndexError):
                continue
    return coords


def render_picking(micrograph_path, coords_star, output_path):
    """Render a micrograph with green circles at picked coords."""
    if not os.path.exists(micrograph_path):
        print(f"[render] micrograph not found: {micrograph_path}", file=sys.stderr)
        return False
    with mrcfile.open(micrograph_path, permissive=True) as m:
        data = np.asarray(m.data, dtype=np.float32)
    if data.ndim == 3:
        data = data[data.shape[0] // 2]
    elif data.ndim != 2:
        data = data.reshape(data.shape[-2:])
    h_full, w_full = data.shape
    img_u8 = normalize_to_uint8(data)
    img_arr = downsample(img_u8, MAX_DIM)
    h_ds, w_ds = img_arr.shape
    scale_x = w_ds / w_full
    scale_y = h_ds / h_full
    # Find which micrograph this is (by matching the micrograph path basename
    # to coords in the star file). If the star has coords for multiple micrographs,
    # we use the basename of the micrograph_path.
    mic_base = os.path.basename(micrograph_path)
    coords = parse_autopick_coords(coords_star, mic_base)
    if not coords:
        # fallback: use all coords (might be from a different micrograph but
        # still useful for VLM to see the picking density)
        coords = parse_autopick_coords(coords_star)
    pil = Image.fromarray(img_arr).convert("RGB")
    draw = ImageDraw.Draw(pil, "RGBA")
    n_drawn = 0
    radius = max(4, int(min(w_ds, h_ds) * 0.018))
    for (x, y) in coords[:500]:
        cx = int(x * scale_x)
        cy = int(y * scale_y)
        if 0 <= cx < w_ds and 0 <= cy < h_ds:
            draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius],
                         outline=(0, 255, 100, 220), width=2)
            n_drawn += 1
    pil.save(output_path, format="PNG")
    print(f"[render] picking overlay: {len(coords)} coords, {n_drawn} drawn -> {output_path}")
    return True


def render_classgrid(stack_path, output_path, max_items=10):
    """Render a grid of class averages from a .mrcs particle stack."""
    if not os.path.exists(stack_path):
        print(f"[render] stack not found: {stack_path}", file=sys.stderr)
        return False
    with mrcfile.open(stack_path, permissive=True) as m:
        data = np.asarray(m.data, dtype=np.float32)
    if data.ndim != 3:
        print(f"[render] expected 3D stack, got shape {data.shape}", file=sys.stderr)
        return False
    n = min(data.shape[0], max_items)
    cols = min(5, n)
    rows = (n + cols - 1) // cols
    # Each cell: normalize the slice, downsample to 128x128, pad with black border
    cell = 128
    border = 2
    grid_w = cols * (cell + border) + border
    grid_h = rows * (cell + border) + border
    grid = np.zeros((grid_h, grid_w), dtype=np.uint8)
    for i in range(n):
        sl = data[i]
        sl_u8 = normalize_to_uint8(sl)
        # downsample to cell x cell
        pil = Image.fromarray(sl_u8)
        pil = pil.resize((cell, cell), Image.BILINEAR)
        sl_ds = np.asarray(pil)
        r = i // cols
        c = i % cols
        y0 = border + r * (cell + border)
        x0 = border + c * (cell + border)
        grid[y0:y0 + cell, x0:x0 + cell] = sl_ds
    Image.fromarray(grid).save(output_path, format="PNG")
    print(f"[render] class grid: {n} classes in {rows}x{cols} -> {output_path}")
    return True


def render_particles(stack_path, output_path, max_items=12):
    """Render a grid of first-N particle thumbnails from a .mrcs stack."""
    return render_classgrid(stack_path, output_path, max_items)


def render_slice(volume_path, output_path):
    """Render the middle z-slice of a 3D volume .mrc as a PNG."""
    if not os.path.exists(volume_path):
        print(f"[render] volume not found: {volume_path}", file=sys.stderr)
        return False
    with mrcfile.open(volume_path, permissive=True) as m:
        data = np.asarray(m.data, dtype=np.float32)
    if data.ndim == 3:
        z = data.shape[0] // 2
        sl = data[z]
    elif data.ndim == 2:
        sl = data
    else:
        sl = data.reshape(data.shape[-2:])
    img_u8 = normalize_to_uint8(sl)
    img_arr = downsample(img_u8, MAX_DIM)
    Image.fromarray(img_arr).save(output_path, format="PNG")
    print(f"[render] slice -> {output_path}")
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", required=True, choices=["picking", "classgrid", "particles", "slice"])
    ap.add_argument("--micrograph")
    ap.add_argument("--coords")
    ap.add_argument("--stack")
    ap.add_argument("--volume")
    ap.add_argument("--output", required=True)
    ap.add_argument("--max", type=int, default=10)
    args = ap.parse_args()

    ok = False
    if args.mode == "picking":
        if not args.micrograph or not args.coords:
            print("picking mode requires --micrograph and --coords", file=sys.stderr)
            sys.exit(2)
        ok = render_picking(args.micrograph, args.coords, args.output)
    elif args.mode == "classgrid":
        if not args.stack:
            print("classgrid mode requires --stack", file=sys.stderr)
            sys.exit(2)
        ok = render_classgrid(args.stack, args.output, args.max)
    elif args.mode == "particles":
        if not args.stack:
            print("particles mode requires --stack", file=sys.stderr)
            sys.exit(2)
        ok = render_particles(args.stack, args.output, args.max)
    elif args.mode == "slice":
        if not args.volume:
            print("slice mode requires --volume", file=sys.stderr)
            sys.exit(2)
        ok = render_slice(args.volume, args.output)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
