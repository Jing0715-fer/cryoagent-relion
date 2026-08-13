import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/projects — list all projects
export async function GET() {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    include: { _count: { select: { messages: true, workflows: true } } },
  });
  return NextResponse.json({ projects });
}

// POST /api/projects — create a project (and seed an initial agent greeting)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = body.name || "Untitled cryo-EM project";
  const description = body.description || "";
  const datasetMeta = body.datasetMeta || {};
  // source dataset path (where the movies live). Default to the bundled
  // synthetic test dataset if not provided.
  const sourceDataset = body.sourceDataset || "/home/z/my-project/data/projects/test_d4";
  // executor mode: "real" (use relion-runner) or "simulated" (time-based fake)
  const executorMode = body.executorMode || "real";

  const project = await db.project.create({
    data: {
      name,
      description,
      datasetMeta: JSON.stringify(datasetMeta),
      sourceDataset,
      executorMode,
      status: "idle",
    },
  });

  // Seed a greeting message
  await db.message.create({
    data: {
      projectId: project.id,
      role: "assistant",
      content: `👋 Hi! I'm **CryoAgent**, your autonomous cryo-EM data-processing agent.\n\nTell me about your dataset (movies, pixel size, particle, target resolution) and I'll plan and execute the full RELION pipeline for you. I'll decide parameters autonomously and intervene at decision points (class selection, refinement target, polishing).\n\n🧬 This project is configured to run the **real RELION 3.1.3 binaries** (CPU) via the relion-runner mini-service. Dataset: \`${sourceDataset}\`.`,
    },
  });

  return NextResponse.json({ project });
}
