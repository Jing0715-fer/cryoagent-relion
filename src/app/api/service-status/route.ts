import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// GET /api/service-status — check health of dev:3000, runner:3004, shim:3005
// POST /api/service-status — start a specific service (runner or shim)

const SERVICES = [
  { id: "dev", name: "Next.js Dev Server", port: 3000, healthPath: "/api/projects", color: "emerald" },
  { id: "runner", name: "RELION Runner", port: 3004, healthPath: "/healthz", color: "sky" },
  { id: "shim", name: "Z.AI LLM Shim", port: 3005, healthPath: "/healthz", color: "violet" },
];

async function checkHealth(port: number, healthPath: string): Promise<{ ok: boolean; responseTime: number; detail: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://127.0.0.1:${port}${healthPath}`, { signal: controller.signal });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    if (res.ok) {
      let detail = "";
      try { detail = (await res.text()).slice(0, 80); } catch {}
      return { ok: true, responseTime: elapsed, detail };
    }
    return { ok: false, responseTime: elapsed, detail: `HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, responseTime: Date.now() - start, detail: e.code === "ABORT_ERR" ? "timeout" : "connection refused" };
  }
}

export async function GET() {
  const results = await Promise.all(
    SERVICES.map(async (s) => {
      const health = await checkHealth(s.port, s.healthPath);
      return {
        id: s.id,
        name: s.name,
        port: s.port,
        color: s.color,
        ...health,
      };
    })
  );
  const allOk = results.every((r) => r.ok);
  return NextResponse.json({ services: results, allOk });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { action, service } = body;

  if (action === "start" && service) {
    const cwd = process.cwd();
    if (service === "runner") {
      // Start relion-runner mini-service
      const devSh = path.join(cwd, "mini-services", "relion-runner", "dev.sh");
      if (!fs.existsSync(devSh)) {
        return NextResponse.json({ error: "runner dev.sh not found" }, { status: 404 });
      }
      const child = spawn("bash", [devSh], {
        cwd: path.dirname(devSh),
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
      return NextResponse.json({ ok: true, message: "RELION Runner starting on port 3004", pid: child.pid });
    }
    if (service === "shim") {
      // Start zai-llm-shim
      const shimDir = path.join(cwd, "mini-services", "zai-llm-shim");
      const indexJs = path.join(shimDir, "index.mjs");
      if (!fs.existsSync(indexJs)) {
        return NextResponse.json({ error: "shim index.mjs not found" }, { status: 404 });
      }
      const child = spawn("node", [indexJs], {
        cwd: shimDir,
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });
      child.unref();
      return NextResponse.json({ ok: true, message: "Z.AI LLM Shim starting on port 3005", pid: child.pid });
    }
    return NextResponse.json({ error: `Unknown service: ${service}` }, { status: 400 });
  }

  if (action === "start-all") {
    const results: any[] = [];
    for (const s of SERVICES) {
      if (s.id === "dev") continue; // can't restart dev from within dev
      const health = await checkHealth(s.port, s.healthPath);
      if (!health.ok) {
        if (s.id === "runner") {
          const devSh = path.join(cwd, "mini-services", "relion-runner", "dev.sh");
          if (fs.existsSync(devSh)) {
            const child = spawn("bash", [devSh], { cwd: path.dirname(devSh), detached: true, stdio: "ignore", env: { ...process.env } });
            child.unref();
            results.push({ service: s.id, action: "started", pid: child.pid });
          }
        } else if (s.id === "shim") {
          const shimDir = path.join(cwd, "mini-services", "zai-llm-shim");
          const indexJs = path.join(shimDir, "index.mjs");
          if (fs.existsSync(indexJs)) {
            const child = spawn("node", [indexJs], { cwd: shimDir, detached: true, stdio: "ignore", env: { ...process.env } });
            child.unref();
            results.push({ service: s.id, action: "started", pid: child.pid });
          }
        }
      } else {
        results.push({ service: s.id, action: "already-running" });
      }
    }
    return NextResponse.json({ ok: true, results });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
