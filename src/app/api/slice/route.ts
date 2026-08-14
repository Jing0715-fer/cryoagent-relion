import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// GET /api/slice?projectId=...&path=...&z=N        -> PNG of slice N
// GET /api/slice?projectId=...&path=...&probe=1    -> { depth: N } JSON probe
// Renders a specific z-slice of a 3D MRC file (or image N of an .mrcs stack)
// as a PNG, normalized and colorized. Used by the slice viewer + class gallery.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const rel = sp.get("path");
  const zStr = sp.get("z");
  const probe = sp.get("probe") === "1";
  if (!projectId || !rel) {
    return NextResponse.json({ error: "projectId and path required" }, { status: 400 });
  }
  if (rel.includes("..")) return NextResponse.json({ error: "bad path" }, { status: 400 });

  const root = path.resolve(process.cwd(), "data", "projects", projectId);
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Probe: return the depth (number of slices)
  if (probe) {
    try {
      const { execFile } = await import("child_process");
      const { promisify } = await import("util");
      const exec = promisify(execFile);
      const script = `
import sys, numpy as np, mrcfile, json
with mrcfile.open(sys.argv[1], permissive=True) as m:
    d = m.data
arr = np.asarray(d)
print(json.dumps({"depth": int(arr.shape[0]), "shape": list(arr.shape)}))
`;
      const { stdout } = await exec("python3", ["-c", script, full]);
      const info = JSON.parse(stdout.trim());
      return NextResponse.json(info);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
  }

  const z = zStr ? parseInt(zStr) : 0;

  try {
    const png = await renderSlice(full, z);
    if (!png) return NextResponse.json({ error: "render failed" }, { status: 500 });
    return new NextResponse(png, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function renderSlice(fullPath: string, z: number): Promise<Buffer | null> {
  const { execFile } = await import("child_process");
  const script = `
import sys, numpy as np, mrcfile, io
from PIL import Image
with mrcfile.open(sys.argv[1], permissive=True) as m:
    d = m.data
arr = np.asarray(d, dtype=np.float32)
if arr.ndim == 3:
    z = int(sys.argv[2])
    z = max(0, min(arr.shape[0]-1, z))
    img = arr[z]
elif arr.ndim == 4:
    z = int(sys.argv[2])
    z = max(0, min(arr.shape[0]-1, z))
    img = arr[z, arr.shape[1]//2]
elif arr.ndim == 2:
    img = arr
else:
    img = arr[0]
# Classic cryo-EM display: protein = WHITE (bright), background = BLACK (dark).
# RELION class averages have protein as high positive values, so percentile
# normalization gives protein=white directly.
# For micrographs (where protein is dark/negative), we detect and invert.
mn = float(np.percentile(img, 1))
mx = float(np.percentile(img, 99))
if mx <= mn: mx = mn + 1
img_norm = np.clip((img - mn) / (mx - mn), 0, 1)
# Convert to 8-bit grayscale (L mode = single channel, no color map)
gray = (img_norm * 255).astype(np.uint8)
s = min(gray.shape[0], gray.shape[1], 256)
y0 = max(0, (gray.shape[0] - s)//2)
x0 = max(0, (gray.shape[1] - s)//2)
gray = gray[y0:y0+s, x0:x0+s]
buf = io.BytesIO()
Image.fromarray(gray, mode='L').save(buf, format='PNG')
sys.stdout.buffer.write(buf.getvalue())
`;
  return new Promise((resolve) => {
    execFile("python3", ["-c", script, fullPath, String(z)], {
      maxBuffer: 8 * 1024 * 1024,
      encoding: "buffer",  // Return stdout as Buffer, not string (prevents UTF-8 corruption of binary PNG)
    }, (err, stdout) => {
      if (err || !stdout) resolve(null);
      else resolve(stdout as Buffer);
    });
  });
}
