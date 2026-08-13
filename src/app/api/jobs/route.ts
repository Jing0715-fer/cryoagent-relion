import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/jobs?jobId=...
export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  const job = await db.job.findUnique({
    where: { id: jobId },
    include: { logs: { orderBy: { ts: "asc" } } },
  });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    job: {
      ...job,
      parameters: JSON.parse(job.parameters),
      inputJobIds: JSON.parse(job.inputJobIds),
      outputSummary: JSON.parse(job.outputSummary),
    },
  });
}
