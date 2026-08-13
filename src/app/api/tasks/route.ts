import { NextRequest, NextResponse } from "next/server";
import { RELION_TASKS } from "@/lib/relion/tasks";

// GET /api/tasks — the full RELION task catalog (for the UI palette)
export async function GET() {
  return NextResponse.json({ tasks: RELION_TASKS });
}
