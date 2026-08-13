#!/usr/bin/env python3
"""CPU-only motion correction stand-in for RELION's motioncor2 (which needs a GPU).

Reads a movie stack (.mrcs, shape F x Y x X), aligns each frame to frame 0 by
phase cross-correlation, averages the aligned frames (optionally dose-weighted),
and writes the corrected micrograph + a logfile in the format RELION expects.

This is intentionally simple — it is a stand-in so the CPU pipeline produces a
real corrected micrograph that downstream REAL relion_ctffind and relion_refine
can consume. It is NOT a replacement for motioncor2 in production.
"""
import os, argparse
import numpy as np
import mrcfile

def align_frame(ref, frame):
    """Phase cross-correlation alignment of `frame` to `ref`. Returns (dy, dx)."""
    from numpy.fft import fft2, ifft2
    ny, nx = ref.shape
    R = fft2(ref)
    F = fft2(frame)
    eps = 1e-12
    xcorr = ifft2(np.conj(R) * F / (np.abs(R) * np.abs(F) + eps)).real
    peak = np.unravel_index(np.argmax(np.fft.fftshift(xcorr)), xcorr.shape)
    cy, cx = ny // 2, nx // 2
    dy = (peak[0] - cy) % ny
    dx = (peak[1] - cx) % nx
    if dy > ny // 2: dy -= ny
    if dx > nx // 2: dx -= nx
    return int(dy), int(dx)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--i", required=True, help="input movie .mrcs")
    ap.add_argument("--o", required=True, help="output corrected micrograph .mrc")
    ap.add_argument("--angpix", type=float, default=4.0)
    ap.add_argument("--dose_per_frame", type=float, default=1.0)
    ap.add_argument("--do_dose_weighting", action="store_true")
    ap.add_argument("--patch_x", type=int, default=1)
    ap.add_argument("--patch_y", type=int, default=1)
    args = ap.parse_args()

    with mrcfile.open(args.i, permissive=True) as m:
        movie = m.data.copy()
    if movie.ndim == 2:
        movie = movie[None, ...]
    nframes, ny, nx = movie.shape

    ref = movie[0].astype(np.float32)
    ref -= ref.mean()
    shifts = []
    aligned = np.zeros_like(movie, dtype=np.float32)
    for f in range(nframes):
        fr = movie[f].astype(np.float32)
        dy, dx = align_frame(ref, fr)
        shifts.append((dy, dx))
        aligned[f] = np.roll(fr, (dy, dx), axis=(0, 1))

    if args.do_dose_weighting and args.dose_per_frame > 0:
        weights = np.exp(-np.arange(nframes) * args.dose_per_frame / 25.0)
        weights /= weights.sum()
        out = (aligned * weights[:, None, None]).sum(axis=0)
    else:
        out = aligned.mean(axis=0)

    os.makedirs(os.path.dirname(args.o) or ".", exist_ok=True)
    with mrcfile.new(args.o, overwrite=True) as m:
        m.set_data(out.astype(np.float32))
        m.voxel_size = (args.angpix, args.angpix, args.angpix)

    logpath = args.o + ".log"
    total = 0
    with open(logpath, "w") as f:
        f.write(f"# motioncorr CPU stand-in\ninput: {args.i}\noutput: {args.o}\nn_frames: {nframes}\n")
        for i, (dy, dx) in enumerate(shifts):
            f.write(f"frame {i:3d}: shift_y={dy:+d} shift_x={dx:+d}\n")
            total += abs(dy) + abs(dx)
        f.write(f"total_drift_px: {total}\n")
    print(f"[motioncorr-cpu] wrote {args.o} (drift total {total}px over {nframes} frames)")

if __name__ == "__main__":
    main()
