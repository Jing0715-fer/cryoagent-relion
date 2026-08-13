import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/jobs/[id]/logs
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const logs = await db.jobLog.findMany({
    where: { jobId: id },
    orderBy: { ts: "asc" },
  });
  return NextResponse.json({ logs });
}
