import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatReply } from "@/lib/agent/engine";

// GET /api/messages?projectId=...
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const messages = await db.message.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    messages: messages.map((m) => ({ ...m, meta: JSON.parse(m.meta) })),
  });
}

// POST /api/messages — store a user message and get the agent's planning reply
export async function POST(req: NextRequest) {
  const { projectId, content } = await req.json();
  if (!projectId || !content) {
    return NextResponse.json({ error: "projectId and content required" }, { status: 400 });
  }
  // persist the user message
  await db.message.create({
    data: { projectId, role: "user", content },
  });
  // agent plans + replies
  await db.project.update({ where: { id: projectId }, data: { status: "running" } });
  const { plan, workflowId, assistantMessage } = await chatReply(projectId, content);
  return NextResponse.json({ plan, workflowId, assistantMessage });
}
