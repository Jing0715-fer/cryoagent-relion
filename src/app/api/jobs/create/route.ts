import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getTask } from "@/lib/relion/tasks";

// POST /api/jobs/create
// Manually create a job in an existing workflow (for the manual job builder UI).
// Body: { projectId, taskType, alias, dependsOn (array of jobIds), parameters }
export async function POST(req: NextRequest) {
  const { projectId, taskType, alias, dependsOn, parameters } = await req.json();
  if (!projectId || !taskType) {
    return NextResponse.json({ error: "projectId and taskType required" }, { status: 400 });
  }
  const task = getTask(taskType);
  if (!task) {
    return NextResponse.json({ error: `unknown task type: ${taskType}` }, { status: 400 });
  }
  // Find the latest workflow for this project
  const workflow = await db.workflow.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
  });
  if (!workflow) {
    return NextResponse.json({ error: "no workflow found for project" }, { status: 404 });
  }
  // Build parameters from task defaults + provided overrides
  const params: Record<string, string | number | boolean> = {};
  for (const p of task.parameters) params[p.key] = p.default;
  if (parameters) {
    for (const [k, v] of Object.entries(parameters)) {
      params[k] = v as string | number | boolean;
    }
  }
  // Inherit optics params from import job if available
  const importJob = await db.job.findFirst({
    where: { workflowId: workflow.id, taskType: "import", status: "done" },
  });
  if (importJob && taskType !== "import") {
    const importParams = JSON.parse(importJob.parameters) as Record<string, string | number | boolean>;
    for (const key of ["angpix", "kV", "Cs", "Q0"]) {
      if (importParams[key] !== undefined && params[key] !== undefined) {
        const taskDefault = task.parameters.find((p) => p.key === key)?.default;
        if (params[key] === taskDefault) {
          params[key] = importParams[key];
        }
      }
    }
  }
  const inputJobIds = dependsOn || [];
  const job = await db.job.create({
    data: {
      workflowId: workflow.id,
      taskType,
      alias: alias || "",
      status: "queued",
      parameters: JSON.stringify(params),
      inputJobIds: JSON.stringify(inputJobIds),
    },
  });
  await db.project.update({ where: { id: projectId }, data: { status: "running" } });
  await db.workflow.update({ where: { id: workflow.id }, data: { status: "running" } });
  await db.message.create({
    data: {
      projectId,
      role: "tool",
      content: `📝 Manually added job: ${task.name} (depends on ${inputJobIds.length} job(s))`,
      meta: JSON.stringify({ kind: "manual-job", jobId: job.id, taskType }),
    },
  });
  return NextResponse.json({ ok: true, jobId: job.id });
}
