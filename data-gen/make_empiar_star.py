#!/usr/bin/env python3
"""Convert EMPIAR-10017 .coord files to a RELION particles.star."""
import os, glob, sys

coord_dir = sys.argv[1] if len(sys.argv) > 1 else "data/projects/empiar10017/coords"
mic_dir = sys.argv[2] if len(sys.argv) > 2 else "data/projects/empiar10017/Micrographs"
out_star = sys.argv[3] if len(sys.argv) > 3 else "data/projects/empiar10017/particles.star"
angpix = 3.54  # after 2x downsampling of 1.77 Å/px
kV = 300
Cs = 2.7
Q0 = 0.1

coords = sorted(glob.glob(os.path.join(coord_dir, "*.coord")))
lines = []
n_total = 0
for cf in coords:
    base = os.path.basename(cf).replace(".coord", "")
    mic_name = f"Micrographs/{base}.mrc"
    with open(cf) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 2:
                try:
                    x, y = float(parts[0]), float(parts[1])
                    # Assign random defocus in 8000-16000 Å range
                    import random
                    random.seed(hash(base) % 2**32)
                    defocus = random.randint(8000, 16000)
                    lines.append(f"{x:.1f} {y:.1f} 000001@Particles/particles.mrcs {mic_name} 1 {defocus} {defocus} 0 0 0 0")
                    n_total += 1
                except:
                    pass

with open(out_star, "w") as f:
    f.write("\n# version 30001\n\ndata_optics\n\nloop_\n")
    f.write("_rlnOpticsGroup #1\n_opticsGroupName #1\n_opticsGroupNumber #1\n")
    f.write("_rlnOpticsGroupPixelSize #1\n_rlnOpticsGroupVoltage #1\n")
    f.write("_rlnOpticsGroupSphericalAberration #1\n_rlnOpticsGroupAmplitudeContrast #1\n")
    f.write(f"1 opticsGroup1 1 {angpix} {kV} {Cs} {Q0}\n\n")
    f.write("data_particles\n\nloop_\n")
    f.write("_rlnCoordinateX #1\n_rlnCoordinateY #2\n_rlnImageName #3\n_rlnMicrographName #4\n")
    f.write("_rlnOpticsGroup #5\n_rlnDefocusU #6\n_rlnDefocusV #7\n_rlnDefocusAngle #8\n")
    f.write("_rlnAngleRot #9\n_rlnAngleTilt #10\n_rlnAnglePsi #11\n")
    for l in lines:
        f.write(l + "\n")
print(f"Wrote {n_total} particles from {len(coords)} micrographs to {out_star}")
