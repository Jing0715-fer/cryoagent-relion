import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/job-files?projectId=...
// Returns all output files from all jobs in the project, grouped by job.
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const jobs = await db.job.findMany({
    where: { workflow: { projectId } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, taskType: true, alias: true, status: true,
      primaryOutput: true, outputFiles: true, outputSummary: true,
      duration: true, finishedAt: true,
    },
  });

  const groups = jobs.map((j) => ({
    jobId: j.id,
    taskType: j.taskType,
    alias: j.alias,
    status: j.status,
    duration: j.duration,
    finishedAt: j.finishedAt,
    primaryOutput: j.primaryOutput || "",
    outputSummary: j.outputSummary ? JSON.parse(j.outputSummary) : {},
    files: j.outputFiles ? JSON.parse(j.outputFiles) : [],
  }));

  return NextResponse.json({ groups });
}
