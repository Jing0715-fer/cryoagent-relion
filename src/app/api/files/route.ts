import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// GET /api/files?projectId=...&path=relpath[&thumb=1]
// Serves a file from the project's data directory (data/projects/<projectId>/<path>).
// With thumb=1, generates a PNG thumbnail for .mrc/.mrcs files using Python+mrcfile.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const projectId = sp.get("projectId");
  const rel = sp.get("path");
  const thumb = sp.get("thumb") === "1";
  if (!projectId || !rel) {
    return NextResponse.json({ error: "projectId and path required" }, { status: 400 });
  }
  if (rel.includes("..")) {
    return NextResponse.json({ error: "bad path" }, { status: 400 });
  }
  const root = path.resolve(process.cwd(), "data", "projects", projectId);
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (thumb) {
    const ext = path.extname(full).toLowerCase();
    if (ext === ".mrc" || ext === ".mrcs") {
      try {
        const png = await makeMrcThumbnail(full);
        if (png) {
          return new NextResponse(png, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": "public, max-age=60",
            },
          });
        }
      } catch {
        // fall through to raw download
      }
    }
    return NextResponse.json({ error: "no thumbnail for this file type" }, { status: 400 });
  }

  const stat = fs.statSync(full);
  const buf = fs.readFileSync(full);
  const isText = rel.endsWith(".star") || rel.endsWith(".log") || rel.endsWith(".bild") || rel.endsWith(".json");
  const mime = isText ? "text/plain; charset=utf-8" : "application/octet-stream";
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Content-Disposition": `attachment; filename="${path.basename(full)}"`,
      "Cache-Control": "no-store",
    },
  });
}

async function makeMrcThumbnail(fullPath: string): Promise<Buffer | null> {
  const { execFile } = await import("child_process");
  const script = `
import sys, numpy as np, mrcfile, io
from PIL import Image
with mrcfile.open(sys.argv[1], permissive=True) as m:
    d = m.data
if d is None:
    sys.exit(1)
arr = np.asarray(d, dtype=np.float32)
if arr.ndim == 3:
    z = arr.shape[0] // 2
    img = arr[z]
elif arr.ndim == 2:
    img = arr
elif arr.ndim == 4:
    img = arr[0, arr.shape[1]//2]
else:
    img = arr.reshape(arr.shape[-2:])
# Classic cryo-EM convention: protein = white, background = black.
# Micrographs have protein as dark (low values); invert so protein is bright.
# Class averages already have protein as high values; no inversion needed.
# Detect: if the center (likely protein) is darker than the edges (background),
# invert the contrast.
mn, mx = float(np.percentile(img, 2)), float(np.percentile(img, 98))
if mx <= mn: mx = mn + 1
img = np.clip((img - mn) / (mx - mn), 0, 1)
# Check if center is darker than edges — if so, invert (micrograph convention)
h, w = img.shape
cy, cx = h // 2, w // 2
center_val = float(img[cy-h//8:cy+h//8, cx-w//8:cx+w//8].mean())
edge_val = float(np.concatenate([img[:h//8].ravel(), img[-h//8:].ravel()]).mean())
if center_val < edge_val:
    img = 1.0 - img
img = (img * 255).astype(np.uint8)
h, w = img.shape
s = min(h, w, 256)
y0 = max(0, (h - s)//2); x0 = max(0, (w - s)//2)
img = img[y0:y0+s, x0:x0+s]
buf = io.BytesIO()
Image.fromarray(img, mode='L').save(buf, format='PNG')
sys.stdout.buffer.write(buf.getvalue())
`;
  return new Promise((resolve) => {
    execFile("python3", ["-c", script, fullPath], {
      maxBuffer: 8 * 1024 * 1024,
      encoding: "buffer",
    }, (err, stdout) => {
      if (err || !stdout) resolve(null);
      else resolve(stdout as Buffer);
    });
  });
}
