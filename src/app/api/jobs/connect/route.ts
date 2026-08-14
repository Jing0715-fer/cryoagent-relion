import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/jobs/connect
// Manually connect two jobs (add a dependency edge).
// Body: { fromJobId, toJobId }
export async function POST(req: NextRequest) {
  const { fromJobId, toJobId } = await req.json();
  if (!fromJobId || !toJobId) {
    return NextResponse.json({ error: "fromJobId and toJobId required" }, { status: 400 });
  }
  const job = await db.job.findUnique({ where: { id: toJobId } });
  if (!job) {
    return NextResponse.json({ error: "target job not found" }, { status: 404 });
  }
  const currentDeps = JSON.parse(job.inputJobIds) as string[];
  if (!currentDeps.includes(fromJobId)) {
    currentDeps.push(fromJobId);
    await db.job.update({
      where: { id: toJobId },
      data: { inputJobIds: JSON.stringify(currentDeps) },
    });
  }
  return NextResponse.json({ ok: true, inputJobIds: currentDeps });
}
