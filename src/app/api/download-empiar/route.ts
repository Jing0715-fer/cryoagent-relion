import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// POST /api/download-empiar
// Downloads a small subset of EMPIAR-10017 (β-galactosidase) micrographs
// from the EMPIAR FTP server, bins them by 4x, and saves to
// data/projects/empiar10017_bin4/ with a particles.star file.
//
// This gives users a one-click "Load Example Data" button that sets up
// a ready-to-test dataset without manual download.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const maxMicrographs = Math.min(Number(body.maxMicrographs) || 5, 20);
  const binFactor = body.binFactor === 2 ? 2 : 4; // default bin4, allow bin2

  const dstDir = path.resolve(process.cwd(), "data", "projects", binFactor === 2 ? "empiar10017_bin2" : "empiar10017_bin4");
  const microDir = path.join(dstDir, "Micrographs");

  // If data already exists, return immediately
  if (fs.existsSync(microDir)) {
    const existing = fs.readdirSync(microDir).filter(f => f.endsWith(".mrc"));
    if (existing.length > 0) {
      return NextResponse.json({
        ok: true,
        message: `Example data already exists (${existing.length} micrographs)`,
        path: dstDir,
        nMicrographs: existing.length,
        cached: true,
      });
    }
  }

  // EMPIAR-10017 data URLs (FTP via HTTPS)
  const EMPIAR_BASE = "https://ftp.ebi.ac.uk/empiar/world_availability/10017/data";

  // A subset of micrographs with known good particle picks
  const micrographNames = [
    "Falcon_2012_06_12-14_33_35_0",
    "Falcon_2012_06_12-14_57_34_0",
    "Falcon_2012_06_12-15_07_41_0",
    "Falcon_2012_06_12-15_14_01_0",
    "Falcon_2012_06_12-15_17_31_0",
  ].slice(0, maxMicrographs);

  fs.mkdirSync(microDir, { recursive: true });
  const coordsDir = path.join(dstDir, "coords");
  fs.mkdirSync(coordsDir, { recursive: true });

  // Download + bin each micrograph
  const results: { name: string; ok: boolean; error?: string }[] = [];
  for (const name of micrographNames) {
    const mrcUrl = `${EMPIAR_BASE}/${name}.mrc`;
    const coordUrl = `${EMPIAR_BASE}/${name}.coord`;
    const rawPath = path.join(microDir, `${name}_raw.mrc`);
    const binPath = path.join(microDir, `${name}.mrc`);
    const coordPath = path.join(coordsDir, `${name}.coord`);

    try {
      // Download micrograph (use curl for reliability)
      await execFileAsync("curl", ["-sL", "-o", rawPath, mrcUrl], { timeout: 120000 });
      if (!fs.existsSync(rawPath) || fs.statSync(rawPath).size < 1000) {
        throw new Error(`Download failed: ${mrcUrl}`);
      }

      // Bin by BINx using Python + mrcfile
      const binScript = `
import sys, numpy as np, mrcfile
BIN = ${binFactor}
ANGPIX = 1.77 * BIN
with mrcfile.open(sys.argv[1], permissive=True) as m:
    data = np.asarray(m.data, dtype=np.float32)
if data.ndim == 2:
    h, w = data.shape
    h2 = h // BIN * BIN
    w2 = w // BIN * BIN
    binned = data[:h2, :w2].reshape(h2//BIN, BIN, w2//BIN, BIN).mean(axis=(1, 3))
elif data.ndim == 3:
    d, h, w = data.shape
    h2 = h // BIN * BIN
    w2 = w // BIN * BIN
    binned = data[:, :h2, :w2].reshape(d, h2//BIN, BIN, w2//BIN, BIN).mean(axis=(2, 4))
else:
    print(f"Unexpected ndim={data.ndim}", file=sys.stderr)
    sys.exit(1)
with mrcfile.new(sys.argv[2], overwrite=True) as m:
    m.set_data(binned.astype(np.float32))
    m.voxel_size = (ANGPIX, ANGPIX, ANGPIX)
print(f"Binned {data.shape} -> {binned.shape} at {ANGPIX} A/px")
`;
      await execFileAsync("python3", ["-c", binScript, rawPath, binPath], { timeout: 60000 });

      // Clean up raw file to save disk
      fs.unlinkSync(rawPath);

      // Download coordinates
      try {
        await execFileAsync("curl", ["-sL", "-o", coordPath, coordUrl], { timeout: 30000 });
      } catch {
        // coords are optional — we can use known fallback
      }

      results.push({ name, ok: true });
    } catch (e: any) {
      results.push({ name, ok: false, error: e?.message || "unknown" });
    }
  }

  // Generate particles.star from downloaded .coord files
  const successCount = results.filter(r => r.ok).length;
  if (successCount > 0) {
    const starScript = `
import os, sys, glob
DST = sys.argv[1]
COORDS_DIR = os.path.join(DST, "coords")
STAR_PATH = os.path.join(DST, "particles.star")
SCALE = 1.0 / ${binFactor}
ANGPIX = 1.77 * ${binFactor}
coord_files = sorted(glob.glob(os.path.join(COORDS_DIR, "*.coord")))
all_coords = []
for cf in coord_files:
    mic_base = os.path.basename(cf).replace(".coord", "")
    with open(cf) as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) >= 2:
                try:
                    x = float(parts[0]) * SCALE
                    y = float(parts[1]) * SCALE
                    all_coords.append((x, y, f"Micrographs/{mic_base}.mrc"))
                except ValueError:
                    pass
with open(STAR_PATH, "w") as f:
    f.write("# version 30001\\n\\ndata_optics\\n\\nloop_\\n")
    f.write("_rlnOpticsGroup #1\\n_opticsGroupName #1\\n_rlnOpticsGroupNumber #1\\n")
    f.write(f"_rlnOpticsGroupPixelSize #1\\n_rlnOpticsGroupVoltage #1\\n")
    f.write(f"_rlnOpticsGroupSphericalAberration #1\\n_rlnOpticsGroupAmplitudeContrast #1\\n")
    f.write(f"1 opticsGroup1 1 {ANGPIX} 300 2.7 0.1\\n\\n")
    f.write("data_particles\\n\\nloop_\\n")
    f.write("_rlnCoordinateX #1\\n_rlnCoordinateY #2\\n")
    f.write("_rlnMicrographName #3\\n_rlnOpticsGroup #4\\n")
    for x, y, mic in all_coords:
        f.write(f"{x:.2f} {y:.2f} {mic} 1\\n")
print(f"Wrote {len(all_coords)} particles to {STAR_PATH}")
`;
    try {
      await execFileAsync("python3", ["-c", starScript, dstDir], { timeout: 10000 });
    } catch {
      // non-fatal
    }
  }

  return NextResponse.json({
    ok: successCount > 0,
    message: `Downloaded ${successCount}/${micrographNames.length} micrographs (bin4, 1024×1024 @ 7.08 Å/px)`,
    path: dstDir,
    nMicrographs: successCount,
    results,
  });
}

// GET — check if example data is already downloaded
export async function GET() {
  const dstDir = path.resolve(process.cwd(), "data", "projects", "empiar10017_bin4");
  const microDir = path.join(dstDir, "Micrographs");
  let nMicrographs = 0;
  let hasParticles = false;
  if (fs.existsSync(microDir)) {
    nMicrographs = fs.readdirSync(microDir).filter(f => f.endsWith(".mrc")).length;
  }
  if (fs.existsSync(path.join(dstDir, "particles.star"))) {
    hasParticles = true;
  }
  return NextResponse.json({
    downloaded: nMicrographs > 0,
    nMicrographs,
    hasParticles,
    path: dstDir,
  });
}
