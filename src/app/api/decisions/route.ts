import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/decisions?projectId=...
export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) return NextResponse.json({ error: "projectId required" }, { status: 400 });
  const decisions = await db.decision.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    decisions: decisions.map((d) => ({ ...d, meta: JSON.parse(d.meta) })),
  });
}
