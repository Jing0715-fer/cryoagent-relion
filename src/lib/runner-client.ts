// Client for the relion-runner mini-service (port 3004).
// All requests go through the gateway using XTransformPort=3004.

const RUNNER_PORT = "3004";

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

// In server-side code we can hit the runner directly (bypassing the gateway)
// since we're in the same network namespace. But to honor the gateway contract
// we still use the relative path with XTransformPort so it works regardless of
// how the app is exposed.
export async function runRunnerJob(req: RunnerJobRequest, timeoutMs = 600000): Promise<RunnerResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Server-side fetch needs an absolute URL. The runner is on localhost:3004
    // and the gateway forwards /run?XTransformPort=3004 to it, but to keep this
    // independent of the gateway we hit the runner port directly from the server.
    const base = process.env.RUNNER_URL || "http://localhost:3004";
    const res = await fetch(`${base}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal: controller.signal,
      // @ts-ignore
      next: { revalidate: 0 },
    });
    if (!res.ok) {
      return { ok: false, logs: [], outputs: [], summary: {}, error: `runner HTTP ${res.status}` };
    }
    return (await res.json()) as RunnerResult;
  } catch (e: any) {
    return { ok: false, logs: [], outputs: [], summary: {}, error: e?.message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// Resolve runner output file path -> a downloadable URL through the gateway.
export function fileDownloadUrl(projectId: string, relPath: string): string {
  return `/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relPath)}`;
}

// Resolve runner thumbnail URL for a map/mrcs file.
export function fileThumbUrl(projectId: string, relPath: string): string {
  return `/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relPath)}&thumb=1`;
}
