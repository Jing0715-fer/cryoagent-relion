import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTask } from "@/lib/relion/tasks";

/**
 * Compute live progress for a job based on wall-clock time since startedAt.
 * Used to give real-time progress updates for long-running tasks (class2d, refine3d, etc.)
 * while the runner is still blocked. Once the job is done, the persisted progress
 * is returned unchanged.
 *
 * Importing the executor pulls in heavy deps; compute a minimal duration locally
 * from `tasks.ts` so this endpoint stays lightweight.
 */

function typicalDurationFor(taskType: string): number {
  const task = getTask(taskType);
  return task?.typicalDuration ?? 60;
}

function liveProgress(job: { taskType: string; status: string; startedAt: Date | null; progress: number }): number {
  if (job.status !== "running") return job.progress;
  if (!job.startedAt) return 0;
  const task = getTask(job.taskType);
  const duration = task?.typicalDuration ?? 60;
  const elapsedSec = (Date.now() - job.startedAt.getTime()) / 1000;
  // For long-running jobs, simulate a smooth progress curve that decays
  // logarithmically so the UI doesn't sit at 100% for hours. After 2× the
  // typical duration, progress is capped at 99% so the UI shows it's still
  // running but not finished.
  const scaled = Math.min(99, Math.floor((elapsedSec / Math.max(duration, 1)) * 100));
  return Math.max(job.progress, scaled);
}

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });

  const workflow = await db.workflow.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });
  if (!workflow) return NextResponse.json({ workflow: null });

  return NextResponse.json({
    workflow: {
      ...workflow,
      jobs: workflow.jobs.map((j) => {
        const params = j.parameters ? JSON.parse(j.parameters) : {};
        const outputSummary = j.outputSummary ? JSON.parse(j.outputSummary) : {};
        const outputFiles = j.outputFiles ? JSON.parse(j.outputFiles) : [];
        const inputJobIds = j.inputJobIds ? JSON.parse(j.inputJobIds) : [];
        return {
          ...j,
          progress: liveProgress(j),
          parameters: params,
          inputJobIds,
          outputSummary,
          outputFiles,
          primaryOutput: j.primaryOutput || "",
        };
      }),
    },
  });
}
