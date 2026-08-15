// DeepSeek Harness bridge — the integration seam between the CryoAgent app and
// the deepseek-harness agent runtime.
//
// Every LLM decision in the CryoAgent pipeline (planWorkflow, makeDecision,
// planNextJob, summarize, chatReply) is delegated to a DeepSeek Harness
// `headless` agent run. DSH's ReactLoopAgent owns the loop: it loads the
// cryo persona as the system prompt, calls the LLM through the `llm-deepseek`
// adapter (which points at our z-ai OpenAI-compatible shim on :3005, so the
// model is z-ai's GLM — no DEEPSEEK_API_KEY needed), and prints the final
// assistant text to stdout.
//
// This makes DeepSeek Harness the agent brain: the ReactLoopAgent, the session
// log, and the llm-deepseek adapter all participate in every agent decision.
// RELION execution stays in the tick loop (Next.js API → relion-runner) so the
// UI keeps its job-by-job progress view.
//
// VLM verification (verifier.ts) is a quality-check utility and calls
// z-ai-web-dev-sdk's createVision directly — it is not an "agent activity"
// (no planning/deciding), so it stays on the direct SDK path.

import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const DSH_BIN = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  "dsh",
);

// DSH home: holds settings.yaml with llm-deepseek baseURL → z-ai shim.
const DSH_HOME = path.join(process.cwd(), ".dsh-home");

const DSH_TIMEOUT_MS = Number(process.env.DSH_TIMEOUT_MS) || 180_000;

// Per-call persona patch files live in the OS tmpdir, keyed by a hash of the
// persona so identical personas reuse one file.
const PATCH_DIR = path.join(os.tmpdir(), "dsh-cryo-patches");

function personaPatchPath(persona: string): string {
  fs.mkdirSync(PATCH_DIR, { recursive: true });
  const hash = crypto.createHash("sha1").update(persona).digest("hex").slice(0, 16);
  const p = path.join(PATCH_DIR, `persona-${hash}.yml`);
  if (!fs.existsSync(p)) {
    // YAML patch: override the system-prompt persona AND disable the bash/fs/
    // code-runtime tools so DSH cannot call <read>/<bash> etc. The cryo agent
    // should reason purely from the prompt context and return JSON — it has no
    // need to read files or run shell commands.
    const escaped = persona.replace(/\r\n/g, "\n");
    const indented = escaped.replace(/\n/g, "\n      ");
    const doc = [
      `- id: system-prompt`,
      `  config:`,
      `    persona: |-`,
      `      ${indented}`,
      ``,
      `# Disable tools that let DSH read files / run commands — the cryo agent`,
      `# reasons purely from the prompt and returns JSON. This prevents the`,
      `# "coding agent" persona from leaking through as <read>/<bash> tool calls.`,
      `- id: tool-bash`,
      `  disabled: true`,
      `- id: tool-pwsh`,
      `  disabled: true`,
      `- id: tool-fs`,
      `  disabled: true`,
      `- id: tool-fs-search`,
      `  disabled: true`,
      `- id: tool-str-replace-editor`,
      `  disabled: true`,
      `- id: code-runtime`,
      `  disabled: true`,
      `- id: tool-workflow`,
      `  disabled: true`,
      `- id: tool-skill`,
      `  disabled: true`,
      `- id: tool-todo`,
      `  disabled: true`,
      `- id: tool-goal`,
      `  disabled: true`,
      `- id: tool-jobs`,
      `  disabled: true`,
      `- id: tool-subagent`,
      `  disabled: true`,
      `- id: tool-web`,
      `  disabled: true`,
      ``,
    ].join("\n");
    fs.writeFileSync(p, doc, "utf8");
  }
  return p;
}

export interface DshConsultOptions {
  /** The cryo persona system prompt (one of the PLANNER_/DECIDER_/... prompts). */
  systemPrompt: string;
  /** The user-turn prompt (dataset metadata, project state, the question). */
  userPrompt: string;
  /** AbortSignal to cancel the DSH run. */
  signal?: AbortSignal;
  /** Optional override of the LLM model id. */
  model?: string;
}

/**
 * Consult the DeepSeek Harness agent. Spawns `dsh --profile headless` with the
 * cryo persona as DSH_SYSTEM_PROMPT and the user prompt as the task, then
 * returns the agent's final assistant text from stdout.
 *
 * The DSH ReactLoopAgent runs its full loop (session log, llm-deepseek adapter,
 * tool registry) for this one decision and exits, printing the final answer.
 */
export async function dshConsult(
  opts: DshConsultOptions,
): Promise<string> {
  const { systemPrompt, userPrompt, signal, model } = opts;

  // Write a persona patch file for this call. The headless profile's default
  // persona is "coding agent"; our cryo persona replaces it via --patch, which
  // the cordis loader applies after the profile layer.
  const patchFile = personaPatchPath(systemPrompt);

  const env: Record<string, string> = {
    ...process.env,
    DSH_HOME,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY || "dummy",
    // Limit the dsh node process to 768MB so it cannot OOM the Next.js dev
    // server (the sandbox has 4GB RAM total; next-server uses ~2GB, dsh needs
    // ~500MB to load its 424 packages, shim ~60MB, runner ~50MB).
    NODE_OPTIONS: "--max-old-space-size=512",
    // Permission mode: the cryo-headless agent only reasons; it never writes
    // files or shells out, so workspace-write is safe and keeps the harness
    // from blocking on approval prompts.
    DSH_PERMISSION_MODE: "workspace-write",
    // Disable telemetry / HMR for one-shot runs.
    DSH_TELEMETRY_DISABLED: "1",
  };
  if (model) env.DSH_MODEL = model;

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      DSH_BIN,
      ["--profile", "headless", "--patch", patchFile, userPrompt],
      { env, cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGTERM"); } catch {}
      setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
      }, 5000);
    }, DSH_TIMEOUT_MS);

    const onAbort = () => {
      try { child.kill("SIGTERM"); } catch {}
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`dsh spawn failed: ${err.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
      if (timedOut) {
        return reject(
          new Error(`dsh timed out after ${DSH_TIMEOUT_MS}ms. stderr:\n${stderr.slice(-2000)}`),
        );
      }
      const trimmed = stdout.replace(/\r\n/g, "\n").trimEnd();
      if (code !== 0 && !trimmed) {
        return reject(
          new Error(`dsh exited ${code} with no output. stderr:\n${stderr.slice(-2000)}`),
        );
      }
      if (code !== 0 && stderr.trim()) {
        console.warn(`[dsh-bridge] dsh exited ${code}: ${stderr.trim().slice(0, 500)}`);
      }
      resolve(trimmed);
    });
  });
}

/**
 * A tolerant JSON extractor: strips code fences and pulls the first {...}...}
 * block. DSH's agent returns the answer as the assistant message content; for
 * structured decisions we ask the persona to emit strict JSON and parse it
 * here.
 */
export function parseJsonLoose(text: string): any | null {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  }
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}
