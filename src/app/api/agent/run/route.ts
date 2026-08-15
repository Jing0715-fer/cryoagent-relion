import { NextRequest, NextResponse } from "next/server";
import { runTick } from "@/lib/agent/engine";

// POST /api/agent/run?projectId=...
// Advances the active workflow by one tick (start jobs, advance progress, finalize,
// make decisions). The frontend polls this every ~1.5s.
export async function POST(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  try {
    const result = await runTick(projectId);
    return NextResponse.json({ ok: true, result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
