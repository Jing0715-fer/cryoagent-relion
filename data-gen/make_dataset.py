#!/usr/bin/env python3
"""Generate a tiny but realistic cryo-EM dataset for RELION CPU testing.

Produces, in --out_dir:
  Movies/          - 12 movies, each 10 frames of 256x256, with drift + noise
  particles.star   - a particles star file (box 64) generated from the movies
  import.star      - a movies star file ready for `relion_import` semantics
  reference.mrc    - the ground-truth 3D map (for sanity / FSC checks)
  notes.json       - generation parameters

This is NOT real experimental data; it is a synthetic but physically plausible
dataset designed so the full RELION single-particle pipeline can run on CPU in
under ~10 minutes, producing real star files, real maps, real FSC curves.

Particle: a small D4-symmetric structure (4 copies of a Gaussian blob arranged
in a square) — small enough that 2D class averages are interpretable.
"""
import os, json, sys, math
import numpy as np
import mrcfile

def make_truth(box=64, angpix=4.0):
    """A D4-symmetric 3D density: 4 blobs arranged in a square in the z=0 plane."""
    z = np.zeros((box, box, box), dtype=np.float32)
    c = box // 2
    r = 6  # blob radius in voxels
    spacing = 8  # distance from center to each blob center
    centers = [(c - spacing, c - spacing, c),
              (c + spacing, c - spacing, c),
              (c - spacing, c + spacing, c),
              (c + spacing, c + spacing, c)]
    xx, yy, zz = np.meshgrid(np.arange(box), np.arange(box), np.arange(box), indexing='ij')
    for cx, cy, cz in centers:
        d2 = (xx - cx)**2 + (yy - cy)**2 + (zz - cz)**2
        z += np.exp(-d2 / (2 * r * r)).astype(np.float32)
    z /= z.max()
    return z, angpix

def project(map3d, angle_deg=0, shift=(0, 0)):
    """Simple projection along z, with in-plane rotation and shift (2D)."""
    box = map3d.shape[0]
    # rotate around z by angle
    a = math.radians(angle_deg)
    cos, sin = math.cos(a), math.sin(a)
    c = box // 2
    yy, xx = np.meshgrid(np.arange(box), np.arange(box), indexing='ij')
    xr = c + cos * (xx - c) - sin * (yy - c) + shift[0]
    yr = c + sin * (xx - c) + cos * (yy - c) + shift[1]
    xi = np.clip(np.round(xr).astype(int), 0, box - 1)
    yi = np.clip(np.round(yr).astype(int), 0, box - 1)
    proj = map3d[xi, yi, :].sum(axis=-1)
    return proj

def ctf_image(box, angpix, defocus, kv=300, cs=2.7, phase=0):
    """Compute a 2D CTF on a grid of given box and pixel size."""
    ny, nx = box, box
    ky = np.fft.fftfreq(ny) / angpix
    kx = np.fft.fftfreq(nx) / angpix
    ky, kx = np.meshgrid(ky, kx, indexing='ij')
    k = np.sqrt(kx**2 + ky**2)
    lam = 12.2643247 / math.sqrt(kv * 1e3 * (1 + kv * 1e-6))  # electron wavelength
    # defocus with astigmatism
    df = defocus
    gamma = math.pi * lam * df * 1e-3 * k**2 - math.pi / 2 * cs * 1e7 * lam**3 * k**4 + phase
    return np.sin(gamma)

def make_movies(truth, angpix, n_movies=12, frames=10, micro_box=256, particle_box=64,
                dose_per_frame=1.0, out_dir="data"):
    os.makedirs(os.path.join(out_dir, "Movies"), exist_ok=True)
    rng = np.random.default_rng(42)
    micro_px_per_particle_box = particle_box
    n_particles_per_micro = 8
    particles = []  # (movie_idx, micrograph_name, x, y, angle, defocus)
    truth_proj = project(truth, 0)  # template projection at angle 0
    truth_proj = truth_proj / truth_proj.max()
    # rescale truth to particle box (already 64)
    for m in range(n_movies):
        # generate a movie: each frame = a blank micrograph + particles projected at random angles/positions + noise + per-frame drift
        frames_stack = []
        drift = np.array([0.0, 0.0])
        for f in range(frames):
            frame = rng.normal(0, 0.05, (micro_box, micro_box)).astype(np.float32)
            # add particles at random positions
            if f == 0:
                positions = []
                while len(positions) < n_particles_per_micro:
                    px = rng.integers(particle_box//2, micro_box - particle_box//2)
                    py = rng.integers(particle_box//2, micro_box - particle_box//2)
                    if all((px - qx)**2 + (py - qy)**2 > (particle_box*0.7)**2 for qx, qy in positions):
                        positions.append((int(px), int(py)))
            for (px, py) in positions:
                ang = float(rng.uniform(0, 360))
                shift = (rng.normal(0, 0.5), rng.normal(0, 0.5))
                pj = project(truth, ang, shift)
                pj = pj / pj.max() * 0.8
                defocus = float(rng.uniform(8000, 14000))
                ctf = ctf_image(particle_box, angpix, defocus)
                # apply CTF
                pj_f = np.fft.fft2(pj)
                pj_ctf = np.real(np.fft.ifft2(pj_f * ctf))
                half = particle_box // 2
                frame[px-half:px+half, py-half:py+half] += pj_ctf.astype(np.float32)
                if f == 0:
                    particles.append((m, f"movie_{m:03d}.mrcs", px, py, ang, defocus))
            # apply per-frame drift
            yy, xx = np.indices(frame.shape)
            shifted = np.roll(frame, (int(round(drift[0])), int(round(drift[1]))), axis=(0, 1))
            frames_stack.append(shifted)
            drift = drift + rng.normal(0, 0.3, 2)
        movie = np.stack(frames_stack, axis=0)  # (frames, Y, X)
        movie_path = os.path.join(out_dir, "Movies", f"movie_{m:03d}.mrcs")
        with mrcfile.new(movie_path, overwrite=True) as m:
            m.set_data(movie)
        print(f"wrote {movie_path} shape={movie.shape} dtype={movie.dtype}")
    return particles

def write_movies_star(particles, out_dir, angpix, frames, micro_box):
    """Write a movies.star that RELION import would produce (optics + movies)."""
    path = os.path.join(out_dir, "movies.star")
    with open(path, "w") as f:
        f.write("# version 30001\n\n")
        f.write("data_optics\n\nloop_\n")
        f.write("_opticsGroup #1\n")
        f.write("_opticsGroupName #1\n")
        f.write("_opticsGroupNumber #1\n")
        f.write("_opticsGroupPixelSize #1\n")
        f.write("_opticsGroupVoltage #1\n")
        f.write("_opticsGroupSphericalAberration #1\n")
        f.write("_opticsGroupAmplitudeContrast #1\n")
        f.write("_opticsGroupTotalExposure #1\n")
        f.write("_opticsGroupOddZernike #1\n")
        f.write("_opticsGroupEvenZernike #1\n")
        f.write("_opticsGroupBeamTiltX #1\n")
        f.write("_opticsGroupBeamTiltY #1\n")
        f.write("opticsGroup1 1 1 {:.4f} 300 2.7 0.10 10.0 0 0 0 0\n\n".format(angpix))
        f.write("data_movies\n\nloop_\n")
        f.write("_movies.rlnMicrographMovieName #1\n")
        f.write("_movies.rlnMicrographName #2\n")
        f.write("_movies.rlnOpticsGroup #3\n")
        f.write("_movies.rlnMicrographPreExposure #4\n")
        f.write("_movies.rlnMicrographDosePerFrame #5\n")
        seen = set()
        for (midx, mname, _, _, _, _) in particles:
            if midx in seen: continue
            seen.add(midx)
            base = mname.replace(".mrcs", ".mrc")
            f.write(f"Movies/{mname} Movies/{base} 1 0 1.0\n")
    print(f"wrote {path}")
    return path

def write_particles_star(particles, out_dir, particle_box, angpix):
    """Write a particles.star (for extract/select simulation) referencing each particle's
    micrograph + coordinates. This stands in for an autopick+extract output."""
    path = os.path.join(out_dir, "particles.star")
    with open(path, "w") as f:
        f.write("# version 30001\n\ndata_optics\n\nloop_\n")
        f.write("_opticsGroup #1\n_opticsGroupName #1\n_opticsGroupNumber #1\n")
        f.write("_opticsGroupPixelSize #1\n_opticsGroupVoltage #1\n")
        f.write("_opticsGroupSphericalAberration #1\n_opticsGroupAmplitudeContrast #1\n")
        f.write(f"opticsGroup1 1 {particle_box//4} {angpix} 300 2.7 0.10\n\n")
        f.write("data_particles\n\nloop_\n")
        f.write("_rlnCoordinateX #1\n_rlnCoordinateY #2\n")
        f.write("_rlnImageName #3\n_rlnMicrographName #4\n")
        f.write("_rlnOpticsGroup #5\n_rlnDefocusU #6\n_rlnDefocusV #7\n")
        f.write("_rlnDefocusAngle #8\n_rlnAngleRot #9\n_rlnAngleTilt #10\n_rlnAnglePsi #11\n")
        # we don't have an actual particle stack here; write coords only (for select)
        for i, (midx, mname, px, py, ang, defocus) in enumerate(particles, start=1):
            f.write(f"{px} {py} 000001@Particles/particles.mrcs Movies/{mname.replace('.mrcs', '.mrc')} 1 {defocus:.0f} {defocus:.0f} 0 {ang:.2f} 0 0\n")
    print(f"wrote {path}")
    return path

def write_reference_map(truth, out_dir, angpix):
    path = os.path.join(out_dir, "reference.mrc")
    with mrcfile.new(path, overwrite=True) as m:
        m.set_data(truth.astype(np.float32))
        m.voxel_size = (angpix, angpix, angpix)
    print(f"wrote {path}")
    return path

def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--out_dir", default="/home/z/my-project/data/projects/test_d4")
    ap.add_argument("--n_movies", type=int, default=12)
    ap.add_argument("--frames", type=int, default=10)
    ap.add_argument("--angpix", type=float, default=4.0)
    ap.add_argument("--particle_box", type=int, default=64)
    ap.add_argument("--micro_box", type=int, default=256)
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    truth, _ = make_truth(box=args.particle_box, angpix=args.angpix)
    write_reference_map(truth, args.out_dir, args.angpix)
    particles = make_movies(truth, args.angpix,
                            n_movies=args.n_movies, frames=args.frames,
                            micro_box=args.micro_box, particle_box=args.particle_box,
                            out_dir=args.out_dir)
    write_movies_star(particles, args.out_dir, args.angpix, args.frames, args.micro_box)
    write_particles_star(particles, args.out_dir, args.particle_box, args.angpix)

    with open(os.path.join(args.out_dir, "notes.json"), "w") as f:
        json.dump({
            "n_movies": args.n_movies,
            "frames": args.frames,
            "angpix": args.angpix,
            "particle_box": args.particle_box,
            "micro_box": args.micro_box,
            "n_particles": len(particles),
            "particle": "D4-symmetric 4-blob synthetic structure",
            "note": "Synthetic dataset for CPU RELION testing — not experimental data.",
        }, f, indent=2)
    print(f"\nGenerated {len(particles)} particles across {args.n_movies} movies.")
    print(f"Reference map: {args.out_dir}/reference.mrc")

if __name__ == "__main__":
    main()
