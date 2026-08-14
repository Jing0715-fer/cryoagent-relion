#!/usr/bin/env python3
"""Pre-bin the EMPIAR-10017 micrographs by 2x (instead of 4x) for better
particle signal. At 3.54 Å/px, particles are ~50px diameter (vs 25px at bin4),
giving much better SNR for picking and classification."""
import os, sys
import numpy as np
import mrcfile

SRC = "/home/z/my-project/data/projects/empiar10017"
DST = "/home/z/my-project/data/projects/empiar10017_bin2"
BIN = 2
ANGPIX_ORIG = 1.77
ANGPIX_EFF = ANGPIX_ORIG * BIN  # 3.54

os.makedirs(os.path.join(DST, "Micrographs"), exist_ok=True)
src_mics = sorted([f for f in os.listdir(os.path.join(SRC, "Micrographs")) if f.endswith(".mrc")])
print(f"[bin2] {len(src_mics)} micrographs to bin (4096 -> 2048, angpix {ANGPIX_ORIG} -> {ANGPIX_EFF})")
for i, name in enumerate(src_mics):
    out = os.path.join(DST, "Micrographs", name)
    if os.path.exists(out):
        print(f"[bin2] {i+1}/{len(src_mics)} {name} (cached)")
        continue
    with mrcfile.open(os.path.join(SRC, "Micrographs", name), permissive=True) as m:
        data = np.asarray(m.data, dtype=np.float32)
    if data.ndim == 2:
        h, w = data.shape
        h2 = h // BIN * BIN
        w2 = w // BIN * BIN
        binned = data[:h2, :w2].reshape(h2 // BIN, BIN, w2 // BIN, BIN).mean(axis=(1, 3))
    elif data.ndim == 3:
        d, h, w = data.shape
        h2 = h // BIN * BIN
        w2 = w // BIN * BIN
        binned = data[:, :h2, :w2].reshape(d, h2 // BIN, BIN, w2 // BIN, BIN).mean(axis=(2, 4))
    else:
        print(f"[bin2] SKIP {name}: ndim={data.ndim}")
        continue
    with mrcfile.new(out, overwrite=True) as m:
        m.set_data(binned.astype(np.float32))
        m.voxel_size = (ANGPIX_EFF, ANGPIX_EFF, ANGPIX_EFF)
    print(f"[bin2] {i+1}/{len(src_mics)} {name}: {binned.shape}")

# Scale the known particles.star coords by 1/BIN
src_star = os.path.join(SRC, "particles.star")
dst_star = os.path.join(DST, "particles.star")
scale = 1.0 / BIN
x_col = -1
y_col = -1
n_scaled = 0
with open(src_star) as fin, open(dst_star, "w") as fout:
    in_particles = False
    for line in fin:
        s = line.strip()
        if s.startswith("data_"):
            in_particles = s.startswith("data_particles")
            fout.write(line)
            continue
        if not in_particles:
            fout.write(line)
            continue
        if s.startswith("_rlnCoordinateX"):
            x_col = int(s.split()[-1].lstrip("#")) - 1
            fout.write(line)
            continue
        if s.startswith("_rlnCoordinateY"):
            y_col = int(s.split()[-1].lstrip("#")) - 1
            fout.write(line)
            continue
        parts = line.split()
        if not parts or parts[0].startswith("_") or parts[0] in ("loop_", "#"):
            fout.write(line)
            continue
        try:
            if x_col >= 0 and x_col < len(parts):
                parts[x_col] = f"{float(parts[x_col]) * scale:.2f}"
            if y_col >= 0 and y_col < len(parts):
                parts[y_col] = f"{float(parts[y_col]) * scale:.2f}"
            fout.write(" ".join(parts) + "\n")
            n_scaled += 1
        except (ValueError, IndexError):
            fout.write(line)
print(f"[bin2] scaled {n_scaled} coords by 1/{BIN} -> {dst_star}")
print(f"[bin2] DONE: dataset at {DST}")
