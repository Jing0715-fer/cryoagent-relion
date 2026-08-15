import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

// GET /api/export?projectId=...
// Exports the entire project data directory (RELION outputs + star files +
// maps + logs) as a downloadable .zip. Useful for reproducibility / sharing.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  if (projectId.includes("..")) return NextResponse.json({ error: "bad projectId" }, { status: 400 });

  const projectRoot = path.resolve(process.cwd(), "data", "projects", projectId);
  if (!fs.existsSync(projectRoot)) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // Use the system `zip` command (fast, handles symlinks). Fall back to a
  // tarball if zip is unavailable.
  const zipPath = `/tmp/cryoagent-${projectId}.zip`;
  try {
    // remove old zip if present
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
    // zip the project dir (relative paths inside the archive)
    await execFileAsync("zip", ["-r", "-q", zipPath, "."], { cwd: projectRoot });
    const stat = fs.statSync(zipPath);
    const buf = fs.readFileSync(zipPath);
    // clean up
    fs.unlinkSync(zipPath);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="cryoagent-${projectId}.zip"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    // fallback: tar.gz
    try {
      const tarPath = `/tmp/cryoagent-${projectId}.tar.gz`;
      if (fs.existsSync(tarPath)) fs.unlinkSync(tarPath);
      await execFileAsync("tar", ["czf", tarPath, "-C", projectRoot, "."]);
      const buf = fs.readFileSync(tarPath);
      fs.unlinkSync(tarPath);
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "Content-Type": "application/gzip",
          "Content-Disposition": `attachment; filename="cryoagent-${projectId}.tar.gz"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e2: any) {
      return NextResponse.json({ error: e2.message }, { status: 500 });
    }
  }
}
