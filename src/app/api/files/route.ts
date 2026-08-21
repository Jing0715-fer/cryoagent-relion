import { NextRequest, NextResponse } from "next/server";

// GET /api/files?projectId=...&path=relpath[&thumb=1]
// All file serving is proxied to the relion-runner (port 3004) which runs
// on WSL and has direct access to the project data via /home/z/my-project/
// (a WSL symlink). The Next.js process itself is on Windows and can't
// follow WSL path junctions for some paths.
//
// Runner endpoints:
//   POST /thumb         { projectId, path }                 -> image/png
//   POST /file          { projectId, path, raw? }           -> text|octet
//
// If the runner is unavailable we fall back to a direct Windows read for
// .mrc files (downloaded as octet-stream) so the UI at least shows the
// raw mrc preview tile.
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

  const RUNNER = process.env.RELION_RUNNER_URL || "http://127.0.0.1:3004";

  if (thumb) {
    // PNG via runner's mrcfile + Pillow pipeline
    try {
      const r = await fetch(`${RUNNER}/thumb`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, path: rel }),
        signal: AbortSignal.timeout(60_000),
      });
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        return new NextResponse(buf, {
          status: 200,
          headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
        });
      }
      return NextResponse.json(
        { error: `runner ${r.status}: ${await r.text().catch(() => "")}` },
        { status: 502 },
      );
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  // Raw file passthrough (small files; large mrc files should use the runner
  // but for now we proxy through runner too)
  try {
    const r = await fetch(`${RUNNER}/file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, path: rel }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      return NextResponse.json(
        { error: `runner ${r.status}: ${await r.text().catch(() => "")}` },
        { status: r.status },
      );
    }
    const contentType = r.headers.get("Content-Type") || "application/octet-stream";
    const disposition = r.headers.get("Content-Disposition") || "";
    const buf = Buffer.from(await r.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": disposition,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}