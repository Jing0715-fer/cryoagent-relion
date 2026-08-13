#!/usr/bin/env python3
"""CPU particle extraction stand-in.

Reads an autopick coords.star (coordinates per micrograph), reads corrected
micrographs, slices particle boxes, optionally rescales, and writes a particles.star
+ particles.mrcs that downstream relion_refine can consume.
"""
import os, sys, argparse, re
import numpy as np
import mrcfile

def parse_coords(coords_star):
    """Return [(micrograph_path, x, y, defocus, angle_rot), ...]."""
    coords = []
    current_mic = None
    with open(coords_star) as f:
        in_particles = False
        for line in f:
            s = line.strip()
            if s.startswith("data_particles"):
                in_particles = True
                continue
            if s.startswith("data_") and in_particles:
                break
            if not in_particles:
                continue
            parts = s.split()
            if not parts or parts[0] in ("loop_", "#", "") or parts[0].startswith("_"):
                continue
            try:
                x = float(parts[0]); y = float(parts[1])
                mic = parts[3] if len(parts) > 3 else current_mic
                current_mic = mic
                defocus = float(parts[5]) if len(parts) > 5 else 10000
                angle_rot = float(parts[8]) if len(parts) > 8 else 0
                coords.append((mic, x, y, defocus, angle_rot))
            except (ValueError, IndexError):
                continue
    return coords

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--coords", required=True)
    ap.add_argument("--micrographs", required=True, help="corrected_micrographs.star")
    ap.add_argument("--outdir", required=True)
    ap.add_argument("--box", type=int, default=64)
    ap.add_argument("--final_box", type=int, default=64)
    ap.add_argument("--angpix", type=float, default=4.0)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    coords = parse_coords(args.coords)
    print(f"[extract] {len(coords)} particles to extract")

    # build map of micrograph name -> path, mapping both Movies/ and MotionCorr/ prefixes
    mic_paths = {}
    star_dir = os.path.dirname(os.path.abspath(args.micrographs))
    with open(args.micrographs) as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#") and not s.startswith("_") and not s.startswith("loop_") and not s.startswith("data_") and s.split()[0].endswith(".mrc"):
                parts = s.split()
                name = parts[0]  # e.g. MotionCorr/movie_000.mrc
                # resolve relative to the star file's directory
                if not os.path.isabs(name):
                    full = os.path.join(star_dir, name)
                else:
                    full = name
                mic_paths[name] = full
                # also register basename -> path so Movies/... lookups match
                base = os.path.basename(name)
                mic_paths["Movies/" + base] = full
                mic_paths["MotionCorr/" + base] = full
    print(f"[extract] micrograph index: {len(mic_paths)} entries")
    # cache micrographs
    mic_cache = {}
    particles_data = []
    idx = 1
    for (mic_name, x, y, defocus, angle_rot) in coords:
        # find the micrograph file
        mic_full = mic_paths.get(mic_name)
        if not mic_full:
            # try matching basename
            base = os.path.basename(mic_name)
            for k, v in mic_paths.items():
                if os.path.basename(k) == base:
                    mic_full = v
                    break
        if not mic_full or not os.path.exists(mic_full):
            print(f"[extract] SKIP {mic_name} (not found)")
            continue
        if mic_full not in mic_cache:
            with mrcfile.open(mic_full, permissive=True) as m:
                mic_cache[mic_full] = m.data.copy()
        mic = mic_cache[mic_full]
        cy = int(round(y)); cx = int(round(x))
        half = args.box // 2
        if cy - half < 0 or cy + half > mic.shape[0] or cx - half < 0 or cx + half > mic.shape[1]:
            continue
        box_img = mic[cy-half:cy+half, cx-half:cx+half].astype(np.float32)
        # rescale if needed
        if args.final_box != args.box:
            # simple cropping/scaling via numpy
            from numpy import interp
            yy = np.linspace(0, args.box-1, args.final_box).astype(int)
            xx = np.linspace(0, args.box-1, args.final_box).astype(int)
            box_img = box_img[np.ix_(yy, xx)]
        particles_data.append((idx, box_img, mic_name, x, y, defocus, angle_rot))
        idx += 1

    # write particles.mrcs (stack) into Particles/ subdir so the star file's
    # "000001@Particles/particles.mrcs" references resolve correctly.
    if not particles_data:
        print("[extract] no particles extracted!")
        sys.exit(1)
    stack = np.stack([pd[1] for pd in particles_data], axis=0)
    particles_dir = os.path.join(args.outdir, "Particles")
    os.makedirs(particles_dir, exist_ok=True)
    stack_path = os.path.join(particles_dir, "particles.mrcs")
    with mrcfile.new(stack_path, overwrite=True) as m:
        m.set_data(stack)
        m.voxel_size = (args.angpix, args.angpix, args.angpix)

    # write particles.star in proper RELION 3.1 format (optics block + particles)
    star_path = os.path.join(args.outdir, "particles.star")
    with open(star_path, "w") as f:
        f.write("\n# version 30001\n\ndata_optics\n\nloop_\n")
        f.write("_rlnOpticsGroup #1 \n_rlnOpticsGroupName #2 \n")
        f.write("_rlnOpticsGroupNumber #3 \n_rlnImagePixelSize #4 \n")
        f.write("_rlnImageSize #5 \n_rlnImageDimensionality #6 \n_rlnVoltage #7 \n")
        f.write("_rlnSphericalAberration #8 \n_rlnAmplitudeContrast #9 \n")
        f.write(f"1 opticsGroup1 1 {args.angpix} {args.final_box} 2 300 2.7 0.10 \n \n")
        f.write("\ndata_particles\n\nloop_\n")
        f.write("_rlnImageName #1 \n_rlnMicrographName #2 \n_rlnCoordinateX #3 \n")
        f.write("_rlnCoordinateY #4 \n_rlnOpticsGroup #5 \n_rlnDefocusU #6 \n")
        f.write("_rlnDefocusV #7 \n_rlnAngleRot #8 \n_rlnAngleTilt #9 \n_rlnAnglePsi #10 \n")
        for i, (_, _, mic, x, y, defocus, angle_rot) in enumerate(particles_data, start=1):
            f.write(f"{i:06d}@Particles/particles.mrcs {mic} {x:.1f} {y:.1f} 1 {defocus:.1f} {defocus:.1f} {angle_rot:.2f} 0 0 \n")

    print(f"[extract] wrote {stack_path} ({stack.shape})")
    print(f"[extract] wrote {star_path} ({len(particles_data)} particles)")

if __name__ == "__main__":
    main()
