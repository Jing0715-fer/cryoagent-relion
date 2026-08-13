import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/workflow?projectId=...
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
      jobs: workflow.jobs.map((j) => ({
        ...j,
        parameters: JSON.parse(j.parameters),
        inputJobIds: JSON.parse(j.inputJobIds),
        outputSummary: JSON.parse(j.outputSummary),
        outputFiles: j.outputFiles ? JSON.parse(j.outputFiles) : [],
        primaryOutput: j.primaryOutput || "",
      })),
    },
  });
}
