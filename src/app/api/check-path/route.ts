import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// GET /api/check-path?path=...
// Verifies a data directory exists and contains Movies/ or Micrographs/ or other
// recognizable cryo-EM data. Returns { ok, type, nFiles, details }.
export async function GET(req: NextRequest) {
  const dataPath = req.nextUrl.searchParams.get("path");
  if (!dataPath) return NextResponse.json({ ok: false, error: "path required" }, { status: 400 });
  if (dataPath.includes("..")) return NextResponse.json({ ok: false, error: "bad path" }, { status: 400 });

  if (!fs.existsSync(dataPath)) {
    return NextResponse.json({ ok: false, error: "path does not exist" });
  }
  const stat = fs.statSync(dataPath);
  if (!stat.isDirectory()) {
    return NextResponse.json({ ok: false, error: "path is not a directory" });
  }

  // check for common cryo-EM data dirs
  const subdirs = fs.readdirSync(dataPath);
  let dataType = "unknown";
  let nFiles = 0;
  let dataDir = "";

  // check Movies/ or Micrographs/
  for (const candidate of ["Movies", "Micrographs", "movies", "micrographs"]) {
    const d = path.join(dataPath, candidate);
    if (fs.existsSync(d) && fs.statSync(d).isDirectory()) {
      const files = fs.readdirSync(d).filter(f => /\.(mrcs?|tiff?|tif)$/.test(f));
      if (files.length > 0) {
        dataType = candidate.toLowerCase().startsWith("movie") ? "movies" : "micrographs";
        nFiles = files.length;
        dataDir = candidate;
        break;
      }
    }
  }

  // also check for direct .mrc/.mrcs files
  if (nFiles === 0) {
    const directFiles = subdirs.filter(f => /\.(mrcs?|tiff?|tif)$/.test(f));
    if (directFiles.length > 0) {
      dataType = directFiles[0].endsWith(".mrcs") ? "movies" : "micrographs";
      nFiles = directFiles.length;
      dataDir = ".";
    }
  }

  // check for a particles.star (known coords)
  const hasCoords = fs.existsSync(path.join(dataPath, "particles.star")) ||
                    fs.existsSync(path.join(dataPath, "coords"));

  if (nFiles === 0 && !hasCoords) {
    return NextResponse.json({
      ok: false,
      error: "No Movies/, Micrographs/, or .mrc/.mrcs files found in this directory. Expected a directory containing movie stacks or micrographs.",
    });
  }

  return NextResponse.json({
    ok: true,
    type: dataType,
    nFiles,
    dataDir,
    hasCoords,
  });
}
