import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/jobs/retry?jobId=...
// Re-queues a failed job so the runTick loop will pick it up again.
export async function POST(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
  const job = await db.job.findUnique({ where: { id: jobId } });
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (job.status !== "failed") {
    return NextResponse.json({ error: "only failed jobs can be retried" }, { status: 400 });
  }
  await db.job.update({
    where: { id: jobId },
    data: {
      status: "queued",
      progress: 0,
      startedAt: null,
      finishedAt: null,
    },
  });
  // also clear old logs to avoid confusion
  await db.jobLog.deleteMany({ where: { jobId } });
  // If the workflow was marked "error" (set when the job originally failed),
  // restore it to "running" so the tick loop resumes processing.
  if (job.workflowId) {
    const wf = await db.workflow.findUnique({ where: { id: job.workflowId } });
    if (wf && wf.status === "error") {
      await db.workflow.update({
        where: { id: wf.id },
        data: { status: "running" },
      });
    }
    // Also restore the project status if it was marked error.
    if (wf) {
      const proj = await db.project.findUnique({ where: { id: wf.projectId } });
      if (proj && proj.status === "error") {
        await db.project.update({
          where: { id: proj.id },
          data: { status: "running" },
        });
      }
    }
  }
  return NextResponse.json({ ok: true });
}
