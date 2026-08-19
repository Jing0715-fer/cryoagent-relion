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
    """Return [(micrograph_path, x, y, defocus, angle_rot, angle_tilt, angle_psi), ...].
    Parses the column headers to find the correct column indices for each field,
    rather than hard-coding positions (which breaks when the star file has
    different column orders)."""
    coords = []
    current_mic = None
    col_idx = {}  # map column name -> 0-based index
    with open(coords_star) as f:
        in_particles = False
        for line in f:
            s = line.strip()
            if s.startswith("data_"):
                in_particles = s.startswith("data_particles")
                continue
            if s.startswith("data_") and in_particles:
                break
            if not in_particles:
                continue
            # Parse column headers like "_rlnCoordinateX #1"
            if s.startswith("_rln"):
                m = s.replace("#", "").split()
                if len(m) >= 2:
                    try:
                        col_idx[m[0]] = int(m[-1]) - 1  # 0-based
                    except ValueError:
                        pass
                continue
            parts = s.split()
            if not parts or parts[0] in ("loop_", "#", "") or parts[0].startswith("_"):
                continue
            try:
                x_col = col_idx.get("_rlnCoordinateX", 0)
                y_col = col_idx.get("_rlnCoordinateY", 1)
                mic_col = col_idx.get("_rlnMicrographName", 2)
                defocus_col = col_idx.get("_rlnDefocusU", -1)
                rot_col = col_idx.get("_rlnAngleRot", -1)
                tilt_col = col_idx.get("_rlnAngleTilt", -1)
                psi_col = col_idx.get("_rlnAnglePsi", -1)
                x = float(parts[x_col]) if x_col < len(parts) else 0
                y = float(parts[y_col]) if y_col < len(parts) else 0
                mic = parts[mic_col] if mic_col < len(parts) else current_mic
                current_mic = mic
                defocus = float(parts[defocus_col]) if defocus_col >= 0 and defocus_col < len(parts) else 10000
                angle_rot = float(parts[rot_col]) if rot_col >= 0 and rot_col < len(parts) else 0
                angle_tilt = float(parts[tilt_col]) if tilt_col >= 0 and tilt_col < len(parts) else 0
                angle_psi = float(parts[psi_col]) if psi_col >= 0 and psi_col < len(parts) else 0
                coords.append((mic, x, y, defocus, angle_rot, angle_tilt, angle_psi))
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
    # also try the parent dir (relion_run root) for symlinks like Micrographs/ or Movies/
    star_parent = os.path.dirname(star_dir)
    with open(args.micrographs) as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#") and not s.startswith("_") and not s.startswith("loop_") and not s.startswith("data_") and (s.split()[0].endswith(".mrc") or s.split()[0].endswith(".mrcs")):
                parts = s.split()
                name = parts[0]  # e.g. MotionCorr/movie_000.mrc or Micrographs/foo.mrc
                # resolve relative to the star file's directory, then parent,
                # then grandparent, then cwd, then search up for a project root
                # (data/projects/<id>/relion_run) and try there.
                if not os.path.isabs(name):
                    full = os.path.join(star_dir, name)
                    if not os.path.exists(full):
                        full = os.path.join(star_parent, name)
                    if not os.path.exists(full):
                        full = os.path.join(os.path.dirname(star_parent), name)
                    if not os.path.exists(full):
                        full = os.path.join(os.getcwd(), name)
                    if not os.path.exists(full):
                        # Walk up from star_dir to find a relion_run dir that has Movies/
                        d = star_dir
                        for _ in range(6):
                            candidate = os.path.join(d, name)
                            if os.path.exists(candidate):
                                full = candidate
                                break
                            # also try Movies/ at this level
                            base_name = os.path.basename(name)
                            cand2 = os.path.join(d, "Movies", base_name)
                            if os.path.exists(cand2):
                                full = cand2
                                break
                            d = os.path.dirname(d)
                            if d == "/":
                                break
                else:
                    full = name
                mic_paths[name] = full
                # also register all common prefix -> path mappings so lookups match
                base = os.path.basename(name)
                mic_paths["Movies/" + base] = full
                mic_paths["MotionCorr/" + base] = full
                mic_paths["Micrographs/" + base] = full
                mic_paths[base] = full
                # If the micrograph is a .mrcs movie, also register a .mrc alias
                # so coords referencing "Movies/movie_000.mrc" (corrected micrograph
                # naming) resolve to the .mrcs movie when motioncorr was skipped.
                if base.endswith(".mrcs"):
                    mrc_base = base.replace(".mrcs", ".mrc")
                    mrc_full = full.replace(".mrcs", ".mrc")
                    mic_paths["Movies/" + mrc_base] = full  # point .mrc to .mrcs file
                    mic_paths["MotionCorr/" + mrc_base] = full
                    mic_paths["Micrographs/" + mrc_base] = full
                    mic_paths[mrc_base] = full
                    _ = mrc_full  # (unused; the .mrc file doesn't exist, but .mrcs does)
    print(f"[extract] micrograph index: {len(mic_paths)} entries")
    # cache micrographs
    mic_cache = {}
    particles_data = []
    idx = 1
    for (mic_name, x, y, defocus, angle_rot, angle_tilt, angle_psi) in coords:
        # find the micrograph file
        mic_full = mic_paths.get(mic_name)
        if not mic_full:
            # try matching basename
            base = os.path.basename(mic_name)
            for k, v in mic_paths.items():
                if os.path.basename(k) == base:
                    mic_full = v
                    break
        # If the micrograph name ends in .mrc but only .mrcs exists (motioncorr
        # was skipped, so corrected .mrc wasn't produced), try the .mrcs variant.
        if mic_full and not os.path.exists(mic_full) and mic_name.endswith(".mrc"):
            mrcs_alt = mic_full.replace(".mrc", ".mrcs")
            if os.path.exists(mrcs_alt):
                mic_full = mrcs_alt
            # also try in the mic_paths map with .mrcs suffix
            if not os.path.exists(mic_full):
                mrcs_name = mic_name.replace(".mrc", ".mrcs")
                mrcs_entry = mic_paths.get(mrcs_name)
                if mrcs_entry and os.path.exists(mrcs_entry):
                    mic_full = mrcs_entry
        if not mic_full or not os.path.exists(mic_full):
            print(f"[extract] SKIP {mic_name} (not found)")
            continue
        if mic_full not in mic_cache:
            with mrcfile.open(mic_full, permissive=True) as m:
                data = m.data.copy()
                # If this is a multi-frame movie (.mrcs, 3D), take the first frame
                # (motioncorr was skipped, so no averaged micrograph exists).
                if data.ndim == 3:
                    data = data[0]
                mic_cache[mic_full] = data
        mic = mic_cache[mic_full]
        cy = int(round(y)); cx = int(round(x))
        half = args.box // 2
        # Clamp the box to the micrograph bounds instead of skipping the
        # particle entirely. Particles near the edge get a box shifted inward
        # (the particle may be slightly off-center, but that's better than
        # losing it entirely — especially on small 256x256 test micrographs
        # where most coords are near the edge).
        cy = max(half, min(cy, mic.shape[0] - half))
        cx = max(half, min(cx, mic.shape[1] - half))
        box_img = mic[cy-half:cy+half, cx-half:cx+half].astype(np.float32)
        # Invert contrast so protein is white (high values) and background
        # is dark (low values) — cryo-EM micrographs have dark protein on
        # bright background, RELION expects the opposite.
        box_img = -box_img
        # Normalize: subtract mean and divide by stddev so background ~ 0
        box_img = (box_img - box_img.mean()) / max(box_img.std(), 1e-6)
        # rescale if needed
        if args.final_box != args.box:
            # simple cropping/scaling via numpy
            from numpy import interp
            yy = np.linspace(0, args.box-1, args.final_box).astype(int)
            xx = np.linspace(0, args.box-1, args.final_box).astype(int)
            box_img = box_img[np.ix_(yy, xx)]
        particles_data.append((idx, box_img, mic_name, x, y, defocus, angle_rot, angle_tilt, angle_psi))
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
        for i, (_, _, mic, x, y, defocus, angle_rot, angle_tilt, angle_psi) in enumerate(particles_data, start=1):
            f.write(f"{i:06d}@Particles/particles.mrcs {mic} {x:.1f} {y:.1f} 1 {defocus:.1f} {defocus:.1f} {angle_rot:.2f} {angle_tilt:.2f} {angle_psi:.2f} \n")

    print(f"[extract] wrote {stack_path} ({stack.shape})")
    print(f"[extract] wrote {star_path} ({len(particles_data)} particles)")

if __name__ == "__main__":
    main()
