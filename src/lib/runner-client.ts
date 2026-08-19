// Client for the relion-runner mini-service (port 3004).
// Uses Node.js http module instead of fetch() — fetch() in Next.js dev
// (Turbopack) sometimes fails to connect to localhost services.

import * as http from "http";

export interface RunnerLogLine {
  level: "info" | "warn" | "error" | "success";
  line: string;
}

export interface RunnerResult {
  ok: boolean;
  logs: RunnerLogLine[];
  outputs: { path: string; size: number }[];
  summary: Record<string, number | string>;
  primaryOutput?: string;
  error?: string;
}

export interface RunnerJobRequest {
  projectId: string;
  jobId: string;
  taskType: string;
  parameters: Record<string, string | number | boolean>;
  inputs: Record<string, string>;
  sourceDataset?: string;
}

// Default timeout: 4 hours. CPU-only RELION tasks can take a while
// (class2d: 18700 particles × 25 iter ≈ 2 hours; class3d / refine3d similar).
// The previous default of 30 min caused the engine to mark long-running
// jobs as failed while relion_refine was still happily chugging on the disk.
export async function runRunnerJob(req: RunnerJobRequest, timeoutMs = 4 * 60 * 60 * 1000): Promise<RunnerResult> {
  const base = process.env.RUNNER_URL || "http://127.0.0.1:3004";
  const url = new URL(`${base}/run`);
  const body = JSON.stringify(req);

  return new Promise((resolve) => {
    const req_obj = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res: http.IncomingMessage) => {
        let data = "";
        res.on("data", (d: any) => (data += d));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data) as RunnerResult);
          } catch (e: any) {
            resolve({ ok: false, logs: [], outputs: [], summary: {}, error: `parse error: ${e?.message}` });
          }
        });
      },
    );
    req_obj.on("error", (e: any) => {
      resolve({ ok: false, logs: [], outputs: [], summary: {}, error: `http error: ${e?.message || e}` });
    });
    req_obj.on("timeout", () => {
      req_obj.destroy();
      resolve({ ok: false, logs: [], outputs: [], summary: {}, error: "timeout" });
    });
    req_obj.write(body);
    req_obj.end();
  });
}

export function fileDownloadUrl(projectId: string, relPath: string): string {
  return `/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relPath)}`;
}

export function fileThumbUrl(projectId: string, relPath: string): string {
  return `/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relPath)}&thumb=1`;
}
