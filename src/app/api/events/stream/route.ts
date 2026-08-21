// SSE endpoint for streaming job events to the browser.
// URL: /api/events/stream?projectId=<id>
import type { NextRequest } from "next/server";
import { subscribeProject, getRecentEvents } from "@/lib/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId query param required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(data));
        } catch {
          /* client gone */
        }
      };
      // Ready event
      send(`event: ready\ndata: ${JSON.stringify({ projectId })}\n\n`);

      // Replay recent events for this project
      for (const ev of getRecentEvents()) {
        if (ev.projectId === projectId) {
          send(`event: job\ndata: ${JSON.stringify(ev)}\n\n`);
        }
      }

      // Heartbeat every 15s
      const heartbeat = setInterval(() => send(":heartbeat\n\n"), 15000);

      // Live subscription
      const unsubscribe = subscribeProject(projectId, (ev) => {
        send(`event: job\ndata: ${JSON.stringify(ev)}\n\n`);
      });

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
