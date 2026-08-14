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
# Normalize: for class averages (2D images), the protein should be white
# (high values) and background black (low values). Use percentile-based
# normalization that preserves the sign of values.
mn = float(np.percentile(img, 1))
mx = float(np.percentile(img, 99))
if mx <= mn: mx = mn + 1
# For class averages, values can be negative (solvent-subtracted).
# Map to 0..1 with protein (positive) as bright, background as dark.
img_norm = np.clip((img - mn) / (mx - mn), 0, 1)
def viridis_lut(t):
    stops = [(68,1,84),(59,82,139),(33,144,141),(94,201,98),(253,231,37)]
    n = len(stops)-1
    i = min(n-1, int(t*n))
    f = t*n - i
    a, b = stops[i], stops[i+1]
    return (a[0]+(b[0]-a[0])*f, a[1]+(b[1]-a[1])*f, a[2]+(b[2]-a[2])*f)
h, w = img_norm.shape
rgb = np.zeros((h, w, 3), dtype=np.uint8)
for c in range(3):
    lut = np.array([viridis_lut(i/255)[c] for i in range(256)], dtype=np.uint8)
    rgb[:,:,c] = lut[(img_norm*255).astype(np.uint8)]
s = min(h, w, 256)
y0 = max(0, (h - s)//2)
x0 = max(0, (w - s)//2)
rgb = rgb[y0:y0+s, x0:x0+s]
buf = io.BytesIO()
Image.fromarray(rgb).save(buf, format='PNG')
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
