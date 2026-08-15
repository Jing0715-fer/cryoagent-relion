import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

const INSTALL_DIR = "/home/z/my-project/relion5-pkg";
const INSTALL_SCRIPT = path.resolve(process.cwd(), "scripts", "install-relion5.sh");

// GET /api/install-relion — check installation status
export async function GET() {
  const installed = fs.existsSync(path.join(INSTALL_DIR, "bin", "relion_refine"));
  let version = "";
  if (installed) {
    try {
      const { stdout } = await execFileAsync(path.join(INSTALL_DIR, "bin", "relion_refine"), ["--version"], { timeout: 5000 });
      version = stdout.trim().split("\n")[0];
    } catch {
      version = "installed (version check failed)";
    }
  }
  return NextResponse.json({
    installed,
    version,
    path: INSTALL_DIR,
    scriptExists: fs.existsSync(INSTALL_SCRIPT),
  });
}

// POST /api/install-relion — run the installer
export async function POST(req: NextRequest) {
  const installed = fs.existsSync(path.join(INSTALL_DIR, "bin", "relion_refine"));
  if (installed) {
    return NextResponse.json({
      ok: true,
      message: "RELION 5.0 is already installed",
      path: INSTALL_DIR,
      cached: true,
    });
  }

  if (!fs.existsSync(INSTALL_SCRIPT)) {
    return NextResponse.json({ ok: false, error: "Install script not found" }, { status: 500 });
  }

  // Run the installer in the background — it takes 5-10 minutes to build
  // We can't wait for it in the HTTP request (timeout), so we start it
  // and let the frontend poll GET for status.
  try {
    const child = execFile("bash", [INSTALL_SCRIPT], {
      timeout: 900000, // 15 min timeout
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      // This callback runs when the process completes
      const logFile = path.resolve(process.cwd(), "relion5-install.log");
      fs.writeFileSync(logFile, `=== Install completed ===\nstdout:\n${stdout}\n\nstderr:\n${stderr}\n\nerror: ${error?.message || "none"}\n`);
    });
    // Don't await — let it run in background
    child.unref();

    return NextResponse.json({
      ok: true,
      message: "RELION 5.0 installation started (building from source, ~5-10 min)",
      note: "Poll GET /api/install-relion to check progress. Check relion5-install.log for build output.",
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "unknown" }, { status: 500 });
  }
}
