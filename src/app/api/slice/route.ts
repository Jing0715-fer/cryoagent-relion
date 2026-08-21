import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// GET /api/slice?projectId=...&path=...&z=N        -> PNG of slice N
// GET /api/slice?projectId=...&path=...&probe=1    -> { depth: N } JSON probe
// Proxies to the local relion-runner (port 3004) which has mrcfile + Pillow
// available; the Next.js sandbox doesn't have those libs reliably.
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

  const RUNNER = process.env.RELION_RUNNER_URL || "http://127.0.0.1:3004";

  if (probe) {
    try {
      const proxyRes = await fetch(`${RUNNER}/slice-probe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, path: rel }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!proxyRes.ok) {
        const t = await proxyRes.text().catch(() => "");
        return NextResponse.json({ error: `runner ${proxyRes.status}: ${t}` }, { status: proxyRes.status });
      }
      const j = await proxyRes.json();
      return NextResponse.json(j);
    } catch (e: unknown) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const z = zStr ? parseInt(zStr) : 0;
  try {
    const proxyRes = await fetch(`${RUNNER}/slice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, path: rel, z }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!proxyRes.ok) {
      const t = await proxyRes.text().catch(() => "");
      return NextResponse.json({ error: `runner ${proxyRes.status}: ${t}` }, { status: proxyRes.status });
    }
    const buf = Buffer.from(await proxyRes.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=60" },
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}