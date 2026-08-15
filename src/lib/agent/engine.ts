// CryoAgent engine — the autonomous agent that plans and executes RELION workflows.
//
// Responsibilities:
//   1. planWorkflow(): LLM call -> parse plan -> create Workflow + Jobs in DB
//   2. runTick(): advance the workflow by one tick:
//        - start queued jobs whose dependencies are done
//        - advance running jobs (progress from wall-clock time), emit logs
//        - finalize done jobs, compute outputs
//        - at decision points (class2d, class3d), call LLM decider + record Decision
//   3. makeDecision(): LLM-driven autonomous decision
//   4. summarize(): final assistant summary when the pipeline completes
//
// The executor simulates RELION (see relion/executor.ts). This file glues it to the DB
// and the LLM.

import path from "path";
import fs from "fs";
import { db } from "@/lib/db";
import * as http from "http";
import { getTask } from "@/lib/relion/tasks";
import { buildContext, getLogPlan, getOutput, taskDuration } from "@/lib/relion/executor";
import { CHAT_SYSTEM_PROMPT, DECIDER_SYSTEM_PROMPT, PLANNER_SYSTEM_PROMPT, FIRST_JOB_SYSTEM_PROMPT, NEXT_JOB_SYSTEM_PROMPT } from "./prompts";
import { dshConsult } from "@/lib/dsh/bridge";

// All LLM decisions in this engine are delegated to the DeepSeek Harness
// agent runtime via dshConsult(). See src/lib/dsh/bridge.ts.

// ---- helpers ---------------------------------------------------------------

function parseJsonLoose(text: string): any | null {
  // Tolerant JSON extraction: strips code fences and finds the first {...} block.
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

// Format a human-readable diff of parameter changes for the retry message.
// Shows only the params that changed, with old → new values.
function formatParamDiff(
  oldParams: Record<string, any>,
  newParams: Record<string, any>,
): string {
  const keys = new Set([...Object.keys(oldParams), ...Object.keys(newParams)]);
  const interestingKeys = new Set([
    "particle_diameter", "threshold", "do_topaz", "do_LoG",
    "box_size", "extract_size", "rescale",
    "nr_classes", "iter_nr_iter", "tau_fudge", "do_fast_subsets",
    "angpix", "bin_factor",
  ]);
  const lines: string[] = [];
  for (const k of keys) {
    if (!interestingKeys.has(k)) continue;
    const oldVal = oldParams[k];
    const newVal = newParams[k];
    if (oldVal !== newVal && newVal !== undefined) {
      lines.push(`- \`${k}\`: ${oldVal ?? "(unset)"} → **${newVal}**`);
    }
  }
  return lines.length > 0 ? lines.join("\n") : "(no parameter changes — retrying with same params)";
}

// Jobs that require an autonomous decision after they finish.
const DECISION_POINTS: Record<string, string> = {
  class2d: "select",
  class3d: "select",
  refine3d: "polish-or-finalize",
};

// ---- 1. planWorkflow -------------------------------------------------------

export interface PlannedJob {
  task: string;
  alias?: string;
  dependsOn: string[];
  parameters: Record<string, string | number | boolean>;
  rationale?: string;
}

export interface Plan {
  summary: string;
  workflowName: string;
  jobs: PlannedJob[];
  decisions?: { afterJob: string; kind: string; description: string }[];
}

export async function planWorkflow(
  projectId: string,
  userMessage: string,
): Promise<Plan> {
  // Pull project context
  const project = await db.project.findUnique({ where: { id: projectId } });
  const existingJobs = await db.job.findMany({
    where: { workflow: { projectId } },
    include: { workflow: true },
  });

  const ctxSummary = existingJobs.length
    ? `Existing jobs:\n${existingJobs
        .map((j) => `- ${j.taskType} (${j.status})`)
        .join("\n")}`
    : "No existing jobs. This is a fresh project.";

  const datasetMeta = project?.datasetMeta
    ? JSON.parse(project.datasetMeta)
    : {};

  const userPrompt = `User request:
"""
${userMessage}
"""

Dataset metadata:
${JSON.stringify(datasetMeta, null, 2)}

Current project state:
${ctxSummary}

Produce the workflow plan JSON now.`;

  const raw = await dshConsult({ systemPrompt: PLANNER_SYSTEM_PROMPT, userPrompt });
  const plan = parseJsonLoose(raw) as Plan | null;

  if (!plan || !Array.isArray(plan.jobs) || plan.jobs.length === 0) {
    // Fallback: build the canonical pipeline so the user still gets a runnable workflow.
    return fallbackPlan(userMessage);
  }
  return plan;
}

function fallbackPlan(userMessage: string): Plan {
  // Canonical SPA pipeline (used if LLM output is unparseable).
  const tasks: { task: string; dependsOn: string[] }[] = [
    { task: "import", dependsOn: [] },
    { task: "motioncorr", dependsOn: ["import"] },
    { task: "ctffind", dependsOn: ["motioncorr"] },
    { task: "autopick", dependsOn: ["motioncorr", "ctffind"] },
    { task: "extract", dependsOn: ["autopick", "motioncorr", "ctffind"] },
    { task: "select", dependsOn: ["extract"] },
    { task: "class2d", dependsOn: ["select"] },
    { task: "initialmodel", dependsOn: ["class2d"] },
    { task: "class3d", dependsOn: ["initialmodel", "class2d"] },
    { task: "refine3d", dependsOn: ["class3d"] },
    { task: "maskcreate", dependsOn: ["refine3d"] },
    { task: "postprocess", dependsOn: ["refine3d", "maskcreate"] },
    { task: "localres", dependsOn: ["refine3d", "maskcreate"] },
    { task: "polish", dependsOn: ["refine3d", "motioncorr"] },
  ];
  return {
    summary:
      "Planned the canonical single-particle cryo-EM pipeline (import -> ... -> postprocess -> localres + polish).",
    workflowName: "SPA pipeline",
    jobs: tasks.map((t) => ({
      task: t.task,
      dependsOn: t.dependsOn,
      parameters: {},
      rationale: "Canonical RELION single-particle analysis step.",
    })),
    decisions: [
      { afterJob: "class2d", kind: "select", description: "Keep classes with clear secondary structure and high particle count." },
      { afterJob: "class3d", kind: "select", description: "Take the best-resolved, most-populated 3D class into refinement." },
      { afterJob: "refine3d", kind: "polish-or-finalize", description: "If resolution > 3.5 Å, run Bayesian polishing then re-refine." },
    ],
  };
}

// Persist a plan into a Workflow + Jobs in the DB.
export async function persistPlan(
  projectId: string,
  plan: Plan,
): Promise<string> {
  const workflow = await db.workflow.create({
    data: {
      projectId,
      name: plan.workflowName || "Cryo-EM workflow",
      status: "running",
    },
  });

  // Map task key -> created job id (so dependencies can reference)
  const created: Record<string, string> = {};
  // Map alias -> id too (for natural dependencies)
  for (const j of plan.jobs) {
    const task = getTask(j.task);
    if (!task) continue;
    const params: Record<string, string | number | boolean> = {};
    // Start from defaults, then override with plan values
    for (const p of task.parameters) params[p.key] = p.default;
    for (const [k, v] of Object.entries(j.parameters || {})) {
      if (params[k] !== undefined || task.parameters.some((p) => p.key === k)) {
        params[k] = v;
      } else {
        // allow extra params too
        params[k] = v;
      }
    }
    // resolve dependsOn: by task key OR by alias
    const inputJobIds: string[] = [];
    for (const dep of j.dependsOn) {
      if (created[dep]) inputJobIds.push(created[dep]);
      else {
        // find last job of that task type
        const k = dep;
        if (created[k]) inputJobIds.push(created[k]);
      }
    }
    const job = await db.job.create({
      data: {
        workflowId: workflow.id,
        taskType: j.task,
        alias: j.alias || "",
        status: "queued",
        parameters: JSON.stringify(params),
        inputJobIds: JSON.stringify(inputJobIds),
      },
    });
    created[j.task] = job.id;
    if (j.alias) created[j.alias] = job.id;
  }

  // Record plan-level decisions as Decision entries (kind=plan)
  if (plan.decisions) {
    for (const d of plan.decisions) {
      await db.decision.create({
        data: {
          projectId,
          kind: "plan",
          reason: `Planned decision point after ${d.afterJob}: ${d.description}`,
          action: d.kind,
          meta: JSON.stringify({ afterJob: d.afterJob }),
        },
      });
    }
  }

  return workflow.id;
}

// ---- 2. runTick ------------------------------------------------------------
//
// Two execution modes:
//   - "real": the project's executorMode === "real" AND the relion-runner
//     mini-service is reachable. Each tick picks the next ready job and calls
//     the runner to execute the actual relion_* binary, then stores the real
//     logs / outputs / summary and marks the job done.
//   - "simulated": time-based progress advancement using the fake executor
//     (used when the runner is unavailable or the project is in demo mode).

export interface TickResult {
  workflowId: string;
  workflowStatus: string;
  advanced: number;
  finishedNow: string[];
  decisionsMade: { jobId: string; taskType: string; decision: string }[];
  done: boolean;
}

async function runnerReachable(): Promise<boolean> {
  // Use the http module directly instead of fetch() — fetch() in Next.js dev
  // (Turbopack) sometimes fails to connect to localhost services.
  return new Promise((resolve) => {
    const base = process.env.RUNNER_URL || "http://127.0.0.1:3004";
    const url = new URL(`${base}/healthz`);
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        timeout: 5000,
      },
      (res: any) => {
        let data = "";
        res.on("data", (d: any) => (data += d));
        res.on("end", () => {
          console.log(`[runnerReachable] http.get -> ${res.statusCode} ${data.slice(0, 80)}`);
          resolve(res.statusCode === 200);
        });
      },
    );
    req.on("error", (e: any) => {
      console.log(`[runnerReachable] http.get FAILED: ${e?.message || e}`);
      resolve(false);
    });
    req.on("timeout", () => {
      console.log(`[runnerReachable] http.get TIMEOUT`);
      req.destroy();
      resolve(false);
    });
  });
}

// Build the "inputs" map (key -> absolute path) for the runner from a job's
// upstream input job ids. Each input key is named after the upstream task type.
// Also walks the full dependency DAG so we can find required upstream stars
// (e.g. extract needs both autopick_star AND motioncorr_star even if the LLM
// only listed autopick as a direct dep).
//
// Side-effect: also returns the import job's `bin_factor` (if any) via the
// returned object's `.binFactor` field so the engine can inject it as a
// parameter into downstream tasks (autopick needs it to scale known coords).
async function buildRunnerInputs(
  job: any,
  allJobs: any[],
): Promise<{ inputs: Record<string, string>; binFactor: number; importPixelSize: number; importOriginalPixelSize: number }> {
  const inputs: Record<string, string> = {};
  const byId = new Map(allJobs.map((j) => [j.id, j]));

  // collect the transitive set of done ancestors
  const ancestors = new Set<string>();
  const stack = JSON.parse(job.inputJobIds) as string[];
  while (stack.length) {
    const id = stack.pop()!;
    if (ancestors.has(id)) continue;
    ancestors.add(id);
    const j = byId.get(id);
    if (!j) continue;
    for (const d of JSON.parse(j.inputJobIds)) stack.push(d);
  }

  // for each ancestor that is done, register its output under the right key.
  // For tasks where the runner needs a SPECIFIC upstream (e.g. motioncorr_star),
  // pick the most recent done one of that type.
  const needed: Record<string, string[]> = {
    import: [],
    motioncorr: ["import_star"],
    ctffind: ["motioncorr_star"],
    autopick: ["motioncorr_star", "ctf_star"],
    manualpick: ["motioncorr_star"],
    extract: ["autopick_star", "motioncorr_star"],
    select: ["extract_star"],
    class2d: ["extract_star", "select_star"],
    initialmodel: ["extract_star", "class2d_star"],
    class3d: ["extract_star", "class2d_star", "initialmodel_map"],
    refine3d: ["extract_star", "class2d_star", "initialmodel_map", "class3d_star"],
    maskcreate: ["refine3d_map", "refine3d_halfmap"],
    postprocess: ["refine3d_halfmap", "maskcreate_mask"],
  };
  const taskNeeds = needed[job.taskType] || [];

  // walk ancestors newest-last; for each needed key, take the latest matching done ancestor
  for (const key of taskNeeds) {
    // derive the upstream task type from the key suffix
    let srcType = key.replace(/_star$/, "").replace(/_map$/, "").replace(/_halfmap$/, "").replace(/_mask$/, "");
    if (srcType === "import") srcType = "import";
    const candidates = allJobs.filter(
      (j) => ancestors.has(j.id) && j.status === "done" && j.taskType === srcType && j.primaryOutput,
    );
    if (candidates.length === 0) {
      // special-case: if we need an initialmodel_map, refine3d_map, or refine3d_halfmap
      // but no such job has finished (skipped on CPU), fall back to the dataset's
      // reference.mrc (a known-good map) so downstream tasks can still produce
      // real RELION outputs.
      if (key === "initialmodel_map" || key === "refine3d_map" || key === "refine3d_halfmap") {
        const project = await db.project.findUnique({ where: { id: job.workflow?.projectId || "" } });
        if (project?.sourceDataset) {
          let refMap = path.join(project.sourceDataset, "reference.mrc");
          // If no reference.mrc exists (real experimental data like EMPIAR),
          // generate a simple spherical placeholder map so maskcreate +
          // postprocess can still produce real RELION output files.
          if (!fs.existsSync(refMap)) {
            refMap = path.join(
              path.resolve(process.cwd(), "data", "projects", project.id),
              "placeholder_ref.mrc",
            );
            if (!fs.existsSync(refMap)) {
              await generatePlaceholderMap(refMap, 64, 4.0);
              on_line_info(projectId, `Generated placeholder reference map at ${refMap} (no reference.mrc in dataset — real experimental data)`);
            }
          }
          inputs[key] = refMap;
        }
      }
      // special-case: if motioncorr was skipped (single-frame data), fall back
      // to the import job's micrographs.star as the "motioncorr_star" input.
      // Search ALL jobs in the workflow (not just ancestors) because the
      // dependency chain may be broken when motioncorr was deleted/skipped.
      if (key === "motioncorr_star") {
        const importCandidates = allJobs.filter(
          (j) => j.status === "done" && j.taskType === "import" && j.primaryOutput,
        );
        if (importCandidates.length > 0) {
          const imp = importCandidates[importCandidates.length - 1];
          // primaryOutput may be absolute or relative to project dir.
          inputs[key] = path.isAbsolute(imp.primaryOutput)
            ? imp.primaryOutput
            : path.join(path.resolve(process.cwd(), "data", "projects", imp.workflow.projectId || ""), imp.primaryOutput);
        }
      }
      continue;
    }
    const dep = candidates[candidates.length - 1];
    const abs = path.isAbsolute(dep.primaryOutput)
      ? dep.primaryOutput
      : path.join(
          path.resolve(process.cwd(), "data", "projects", dep.workflow.projectId || ""),
          dep.primaryOutput,
        );
    inputs[key] = abs;
  }

  // Determine the import job's bin_factor + pixel sizes so downstream tasks
  // (autopick, extract) can scale coordinates appropriately when known coords
  // from the source dataset are in the ORIGINAL (unbinned) frame.
  let binFactor = 1;
  let importPixelSize = 0;
  let importOriginalPixelSize = 0;
  const importJob = allJobs.find((j) => j.taskType === "import" && j.status === "done");
  if (importJob) {
    try {
      const s = JSON.parse(importJob.outputSummary || "{}");
      binFactor = Number(s.bin_factor || s.downsample_factor || 1) || 1;
      importPixelSize = Number(s.pixel_size || 0) || 0;
      importOriginalPixelSize = Number(s.original_pixel_size || 0) || 0;
    } catch {}
  }
  return { inputs, binFactor, importPixelSize, importOriginalPixelSize };
}

export async function runTick(projectId: string): Promise<TickResult | null> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  const useReal = project?.executorMode === "real" && (await runnerReachable());

  const workflow = await db.workflow.findFirst({
    where: { projectId, status: "running" },
    orderBy: { createdAt: "desc" },
    include: { jobs: { orderBy: { createdAt: "asc" } } },
  });
  if (!workflow) return null;

  const allJobs = workflow.jobs;
  const jobById = new Map(allJobs.map((j) => [j.id, j]));

  let advanced = 0;
  const finishedNow: string[] = [];
  const decisionsMade: { jobId: string; taskType: string; decision: string }[] = [];

  if (useReal) {
    // REAL EXECUTION PATH: pick the next ready queued job and run it on the runner.
    // On CPU, 3D tasks are slow but can run with reduced iterations.
    // We DON'T skip them — the runner caps iterations/sampling for CPU.
    // Only skip tasks that genuinely need a GPU (multibody, polish with movie frames).
    const CPU_SKIPPED = new Set<string>(["multibody", "polish", "movierefine"]);

    // ---- Stale-running recovery -------------------------------------------
    // If the dev server restarted (OOM, HMR) while a job was running, the
    // runRunnerJob promise was lost and the job stays "running" forever with
    // an empty outputSummary. Detect such stale jobs (running > 3 min with no
    // output) and mark them failed so retry/planNextJob can take over.
    const STALE_MS = 3 * 60 * 1000; // 3 minutes
    for (const j of allJobs) {
      if (j.status === "running" && j.startedAt) {
        const age = Date.now() - j.startedAt.getTime();
        const hasOutput = j.outputSummary && j.outputSummary !== "{}";
        if (age > STALE_MS && !hasOutput) {
          await db.job.update({
            where: { id: j.id },
            data: { status: "failed", progress: 100, finishedAt: new Date() },
          });
          await db.message.create({
            data: {
              projectId,
              role: "system",
              content: `🔄 Stale-running recovery: ${j.taskType} was running for ${Math.round(age/1000)}s with no output (likely dev-server restart). Marked failed — will retry or advance.`,
              meta: JSON.stringify({ kind: "stale-recovery", jobId: j.id, taskType: j.taskType }),
            },
          });
        }
      }
    }
    // Re-fetch jobs after stale recovery so `next` picks up the changed state.
    const refreshedJobs = await db.job.findMany({
      where: { workflowId: workflow.id },
      orderBy: { createdAt: "asc" },
    });
    allJobs.length = 0;
    allJobs.push(...refreshedJobs);
    jobById.clear();
    for (const j of refreshedJobs) jobById.set(j.id, j);

    // Check if the import job reported single-frame data (micrographs, not movies).
    // If so, skip motioncorr — single-frame micrographs don't need motion correction.
    const importJob = allJobs.find((j) => j.taskType === "import" && j.status === "done");
    let isSingleFrame = false;
    if (importJob) {
      const importSummary = JSON.parse(importJob.outputSummary);
      isSingleFrame = !!importSummary.single_frame;
    }
    if (isSingleFrame) {
      CPU_SKIPPED.add("motioncorr");
    }

    const next = allJobs.find(
      (j) => j.status === "queued" && canStart(j, jobById) && !CPU_SKIPPED.has(j.taskType),
    );
    // auto-skip CPU-impractical tasks; track them so we can trigger planNextJob
    const skippedNow: string[] = [];
    for (const j of allJobs) {
      if (j.status === "queued" && CPU_SKIPPED.has(j.taskType)) {
        await db.job.update({
          where: { id: j.id },
          data: { status: "skipped", progress: 100, finishedAt: new Date() },
        });
        skippedNow.push(j.id);
        await db.message.create({
          data: {
            projectId,
            role: "tool",
            content: isSingleFrame && j.taskType === "motioncorr"
              ? `⏭️ ${j.taskType} skipped — single-frame micrographs don't need motion correction. Using imported micrographs directly.`
              : `⏭️ ${j.taskType} skipped on CPU — this task requires a GPU for practical runtime. The agent will decide the next CPU-feasible step.`,
            meta: JSON.stringify({ jobId: j.id, taskType: j.taskType, kind: "job-skipped", real: true }),
          },
        });
      }
    }
    if (next) {
      // mark running
      await db.job.update({
        where: { id: next.id },
        data: { status: "running", startedAt: new Date(), progress: 5 },
      });
      await db.message.create({
        data: {
          projectId,
          role: "tool",
          content: `▶ Starting ${next.taskType} (job ${next.id.slice(-6)}) via relion-runner`,
          meta: JSON.stringify({ jobId: next.id, taskType: next.taskType, kind: "job-start", real: true }),
        },
      });
      advanced++;

      // call the runner
      const { runRunnerJob } = await import("@/lib/runner-client");
      const { inputs, binFactor, importPixelSize, importOriginalPixelSize } = await buildRunnerInputs(
        { ...next, inputJobIds: next.inputJobIds, workflow: { projectId } },
        allJobs.map((j) => ({ ...j, workflow: { projectId } })),
      );
      const params = JSON.parse(next.parameters);
      // Inject import-derived optics context so the runner can scale known
      // coords by the bin factor and use the right effective angpix.
      if (next.taskType !== "import") {
        if (binFactor > 1) params.bin_factor = binFactor;
        if (importPixelSize > 0) params.import_angpix = importPixelSize;
        if (importOriginalPixelSize > 0) params.import_original_angpix = importOriginalPixelSize;
        // For tasks that don't define their own angpix param (extract, autopick,
        // etc.), inject the import's effective angpix so the runner doesn't fall
        // back to a stale default (e.g. 4.0). For tasks that DO define angpix
        // (postprocess, maskcreate), the value was already inherited by
        // createSingleJob and the LLM may have overridden it — don't clobber.
        if (!("angpix" in params) && importPixelSize > 0) {
          params.angpix = importPixelSize;
        }
      }
      const result = await runRunnerJob({
        projectId,
        jobId: next.id,
        taskType: next.taskType,
        parameters: params,
        inputs,
        sourceDataset: project?.sourceDataset,
      });

      // store logs
      for (const l of result.logs) {
        await db.jobLog.create({ data: { jobId: next.id, level: l.level, line: l.line } });
      }
      const durationSec = next.startedAt
        ? Math.round((Date.now() - next.startedAt.getTime()) / 1000)
        : 0;

      if (result.ok) {
        await db.job.update({
          where: { id: next.id },
          data: {
            status: "done",
            progress: 100,
            outputSummary: JSON.stringify(result.summary),
            primaryOutput: result.primaryOutput || "",
            outputFiles: JSON.stringify(result.outputs),
            finishedAt: new Date(),
            duration: durationSec,
          },
        });
        await db.message.create({
          data: {
            projectId,
            role: "tool",
            content: `✅ ${next.taskType} done in ${durationSec}s — ${result.outputs.length} files written`,
            meta: JSON.stringify({ jobId: next.id, taskType: next.taskType, kind: "job-done", real: true }),
          },
        });

        // ---- VLM quality verification + retry loop ----
        // After a supported task completes, run the vision-based verifier to
        // judge result quality. If it fails AND we haven't exceeded MAX_RETRIES,
        // create a retry job with adjusted params instead of advancing.
        const { verifyJobQuality, adjustParamsForRetry, getRetryCount, setRetryCount, MAX_RETRIES } = await import("@/lib/agent/verifier");
        const verifiableTasks = new Set(["autopick", "extract", "class2d", "class3d", "refine3d", "initialmodel", "ctffind"]);
        let verificationPassed = true;
        if (verifiableTasks.has(next.taskType)) {
          const jobForVerify = await db.job.findUnique({
            where: { id: next.id },
            select: { id: true, taskType: true, parameters: true, primaryOutput: true, outputFiles: true, outputSummary: true, alias: true },
          });
          if (jobForVerify) {
            const verification = await verifyJobQuality(projectId, {
              id: jobForVerify.id,
              taskType: jobForVerify.taskType,
              parameters: jobForVerify.parameters,
              primaryOutput: jobForVerify.primaryOutput,
              outputFiles: jobForVerify.outputFiles,
              outputSummary: jobForVerify.outputSummary,
              alias: jobForVerify.alias,
            });
            // record the verification as a Decision (kind="verify")
            await db.decision.create({
              data: {
                projectId,
                jobId: next.id,
                kind: "verify",
                reason: verification.reasoning,
                action: verification.passed ? "pass" : "fail",
                meta: JSON.stringify({
                  score: verification.score,
                  issues: verification.issues,
                  suggestedParams: verification.suggestedParams,
                  taskType: next.taskType,
                }),
              },
            });
            const scoreEmoji = verification.score >= 8 ? "🟢" : verification.score >= 6 ? "🟡" : "🔴";
            await db.message.create({
              data: {
                projectId,
                role: "assistant",
                content: verification.passed
                  ? `${scoreEmoji} **${next.taskType} verification passed** (score ${verification.score}/10): ${verification.reasoning}`
                  : `${scoreEmoji} **${next.taskType} verification FAILED** (score ${verification.score}/10): ${verification.reasoning}${verification.issues.length ? `\n\nIssues: ${verification.issues.join("; ")}` : ""}`,
                meta: JSON.stringify({
                  jobId: next.id,
                  taskType: next.taskType,
                  kind: "job-verified",
                  score: verification.score,
                  passed: verification.passed,
                  issues: verification.issues,
                }),
              },
            });

            if (!verification.passed) {
              const currentParams = JSON.parse(next.parameters);
              const currentRetry = getRetryCount(currentParams);
              if (currentRetry < MAX_RETRIES) {
                const newRetryCount = currentRetry + 1;
                const adjusted = adjustParamsForRetry(next.taskType, currentParams, newRetryCount, verification);
                const finalParams = setRetryCount(adjusted, newRetryCount);
                // Strip any existing "(retry N)" suffix from the alias to
                // avoid nesting like "foo (retry 1) (retry 2) (retry 3)".
                const baseAlias = (next.alias || next.taskType).replace(/\s*\(retry \d+\)\s*$/g, "").trim();
                // create a retry job depending on the same upstream jobs
                const retryJob = await db.job.create({
                  data: {
                    workflowId: workflow.id,
                    taskType: next.taskType,
                    alias: `${baseAlias} (retry ${newRetryCount})`,
                    status: "queued",
                    parameters: JSON.stringify(finalParams),
                    inputJobIds: next.inputJobIds,
                  },
                });
                await db.message.create({
                  data: {
                    projectId,
                    role: "assistant",
                    content: `🔁 **Retrying ${next.taskType}** (attempt ${newRetryCount}/${MAX_RETRIES})

**Parameter changes (old → new):**
${formatParamDiff(JSON.parse(next.parameters), finalParams)}

${newRetryCount > 1 ? `+ retry strategy #${newRetryCount}` : ""}`,
                    meta: JSON.stringify({
                      jobId: retryJob.id,
                      taskType: next.taskType,
                      kind: "job-retry",
                      retryOf: next.id,
                      retryCount: newRetryCount,
                    }),
                  },
                });
                verificationPassed = false; // don't advance — let the retry run
              } else {
                await db.message.create({
                  data: {
                    projectId,
                    role: "assistant",
                    content: `⚠️ ${next.taskType} verification failed but max retries (${MAX_RETRIES}) reached — proceeding to next step with current results.`,
                    meta: JSON.stringify({ jobId: next.id, kind: "verify-max-retries", taskType: next.taskType }),
                  },
                });
              }
            }
          }
        }
        if (verificationPassed) {
          finishedNow.push(next.id);
        }
      } else {
        await db.job.update({
          where: { id: next.id },
          data: {
            status: "failed",
            progress: 100,
            outputSummary: JSON.stringify(result.summary || {}),
            finishedAt: new Date(),
            duration: durationSec,
          },
        });
        await db.message.create({
          data: {
            projectId,
            role: "tool",
            content: `❌ ${next.taskType} failed: ${result.error || "unknown error"}`,
            meta: JSON.stringify({ jobId: next.id, taskType: next.taskType, kind: "job-failed", real: true }),
          },
        });
      }
    }

    // check for decision points at newly finished jobs
    for (const jobId of finishedNow) {
      const job = await db.job.findUnique({ where: { id: jobId } });
      if (!job) continue;
      const kind = DECISION_POINTS[job.taskType];
      if (!kind) continue;
      const already = await db.decision.findFirst({
        where: { jobId, kind: { in: ["select", "polish-or-finalize", "branch"] } },
      });
      if (already) continue;
      const decision = await makeDecision(projectId, job);
      decisionsMade.push({ jobId, taskType: job.taskType, decision: decision.decision });
    }

    // ---- Incremental agent: after a job finishes OR is skipped, decide the NEXT job ----
    let workflowStatus = "running";
    const refreshed = await db.job.findMany({ where: { workflowId: workflow.id } });
    const hasQueued = refreshed.some((j) => j.status === "queued");
    const hasRunning = refreshed.some((j) => j.status === "running");
    const triggerIds = [...finishedNow, ...skippedNow];
    const terminal = refreshed.filter((j) => ["done", "skipped", "failed"].includes(j.status));
    // Fallback: if the workflow is idle (no queued/running) but we haven't
    // triggered planNextJob this tick, check if the last terminal job needs
    // a next-step decision (e.g. it was skipped/completed in a prior tick).
    if (triggerIds.length === 0 && !hasQueued && !hasRunning && refreshed.length > 0) {
      if (terminal.length > 0) {
        const lastTerminal = terminal[terminal.length - 1];
        // trigger if this job was completed recently (within 10min) to allow
        // for process restarts (OOM kill, HMR, etc.) without stalling the pipeline.
        // Also check that no "verify" or "next-job-planned" decision already
        // exists for this job to avoid re-triggering on every idle tick.
        if (lastTerminal.finishedAt) {
          const ageSec = (Date.now() - lastTerminal.finishedAt.getTime()) / 1000;
          if (ageSec < 600) {
            // Check if we already planned the next job for this terminal job
            const existingDecision = await db.decision.findFirst({
              where: { jobId: lastTerminal.id, kind: { in: ["next-job-planned", "verify"] } },
            });
            if (!existingDecision) {
              triggerIds.push(lastTerminal.id);
            }
          }
        }
      }
    }
    if (!hasQueued && !hasRunning && triggerIds.length > 0) {
      const lastId = triggerIds[triggerIds.length - 1];
      const lastJob = await db.job.findUnique({ where: { id: lastId } });
      // plan next if the last job succeeded or was skipped (not failed)
      if (lastJob && (lastJob.status === "done" || lastJob.status === "skipped")) {
        const r = await planNextJob(projectId, lastId);
        // Record that we planned the next step for this job so the idle-tick
        // fallback doesn't re-trigger planNextJob on every subsequent tick.
        await db.decision.create({
          data: {
            projectId,
            jobId: lastId,
            kind: "next-job-planned",
            reason: `Planned next job after ${lastJob.taskType} (${lastJob.status})`,
            action: r.created ? "created-next" : "done",
            meta: JSON.stringify({ completedJobId: lastId, created: r.created, done: r.done }),
          },
        });
        if (r.done) {
          workflowStatus = "done";
        }
      } else if (lastJob && lastJob.status === "failed") {
        // a failed job halts the incremental pipeline
        await db.workflow.update({ where: { id: workflow.id }, data: { status: "error" } });
        await db.project.update({ where: { id: projectId }, data: { status: "error" } });
        await db.message.create({
          data: {
            projectId,
            role: "assistant",
            content: `❌ Job **${lastJob.taskType}** failed. The incremental pipeline is paused. Inspect the job's logs, fix the issue, and retry the failed job to continue.`,
            meta: JSON.stringify({ kind: "pipeline-paused", jobId: lastJob.id }),
          },
        });
        workflowStatus = "error";
      }
    }

    return {
      workflowId: workflow.id,
      workflowStatus,
      advanced,
      finishedNow,
      decisionsMade,
      done: terminal,
    };
  }

  // ---- SIMULATED PATH (original time-based logic) ----
  const doneTasks = new Set(allJobs.filter((j) => j.status === "done").map((j) => j.taskType));

  // 2a. Advance running jobs
  const running = allJobs.filter((j) => j.status === "running");
  for (const job of running) {
    const params = JSON.parse(job.parameters) as Record<string, string | number | boolean>;
    const completedJobs = allJobs
      .filter((j) => j.status === "done")
      .map((j) => ({
        id: j.id,
        taskType: j.taskType,
        parameters: JSON.parse(j.parameters),
        progress: j.progress,
        status: j.status as "done",
        outputSummary: JSON.parse(j.outputSummary),
        startedAt: j.startedAt,
        alias: "",
      }));
    const ctx = buildContext(completedJobs as any);
    const duration = taskDuration(job.taskType);
    const elapsedSec = job.startedAt ? (Date.now() - job.startedAt.getTime()) / 1000 : 0;
    const newProgress = Math.min(100, Math.floor((elapsedSec / duration) * 100));

    const plan = getLogPlan(job.taskType, params, ctx);
    const existing = await db.jobLog.findMany({ where: { jobId: job.id }, select: { line: true } });
    const existingSet = new Set(existing.map((l) => l.line));
    for (const l of plan) {
      if (l.at <= newProgress && !existingSet.has(l.text)) {
        await db.jobLog.create({ data: { jobId: job.id, level: l.level, line: l.text } });
      }
    }

    if (newProgress >= 100) {
      const output = getOutput(job.taskType, params, ctx);
      // Scan the job directory for output files (if the real runner actually
      // produced them before the simulated executor marked the job done).
      // This fixes the issue where class2d produces real .mrcs files on disk
      // but the simulated executor doesn't register them in outputFiles.
      const projDir = path.resolve(process.cwd(), "data", "projects", workflow.projectId || "");
      const jobDir = path.join(projDir, "relion_run", job.id);
      let outputFiles: { path: string; size: number }[] = [];
      let primaryOutput = "";
      if (fs.existsSync(jobDir)) {
        const scanDir = (dir: string) => {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, ent.name);
            if (ent.isDirectory()) scanDir(fp);
            else if (ent.isFile()) {
              try {
                const sz = fs.statSync(fp).size;
                const relPath = path.relative(projDir, fp);
                outputFiles.push({ path: relPath, size: sz });
                // Set primary output to the most relevant file
                if (relPath.endsWith("_model.star") && !primaryOutput) {
                  primaryOutput = relPath;
                } else if (relPath.endsWith(".star") && !primaryOutput) {
                  primaryOutput = relPath;
                }
              } catch {}
            }
          }
        };
        scanDir(jobDir);
      }
      await db.job.update({
        where: { id: job.id },
        data: {
          status: "done",
          progress: 100,
          outputSummary: JSON.stringify(output),
          outputFiles: outputFiles.length > 0 ? JSON.stringify(outputFiles) : undefined,
          primaryOutput: primaryOutput || undefined,
          finishedAt: new Date(),
          duration,
        },
      });
      const successLine = plan.find((l) => l.at === 100);
      if (successLine && !existingSet.has(successLine.text)) {
        await db.jobLog.create({ data: { jobId: job.id, level: "success", line: successLine.text } });
      }
      finishedNow.push(job.id);
      advanced++;
    } else if (newProgress !== job.progress) {
      await db.job.update({ where: { id: job.id }, data: { progress: newProgress } });
      advanced++;
    }
  }

  // 2b. Start queued jobs whose deps are done
  for (const job of allJobs) {
    if (job.status !== "queued") continue;
    if (!canStart(job, jobById)) continue;
    await db.job.update({
      where: { id: job.id },
      data: { status: "running", startedAt: new Date(), progress: 1 },
    });
    const params = JSON.parse(job.parameters);
    const completedJobs = allJobs
      .filter((j) => j.status === "done")
      .map((j) => ({
        id: j.id,
        taskType: j.taskType,
        parameters: JSON.parse(j.parameters),
        progress: j.progress,
        status: j.status as "done",
        outputSummary: JSON.parse(j.outputSummary),
        startedAt: j.startedAt,
        alias: "",
      }));
    const ctx = buildContext(completedJobs as any);
    const plan = getLogPlan(job.taskType, params, ctx);
    const first = plan.find((l) => l.at === 1) || plan[0];
    if (first) {
      await db.jobLog.create({ data: { jobId: job.id, level: first.level, line: first.text } });
    }
    const task = getTask(job.taskType);
    await db.message.create({
      data: {
        projectId,
        role: "tool",
        content: `▶ Starting ${task?.name || job.taskType} (job ${job.id.slice(-6)})`,
        meta: JSON.stringify({ jobId: job.id, taskType: job.taskType, kind: "job-start" }),
      },
    });
    advanced++;
    break;
  }

  // 2c. Decisions at completed decision-point jobs
  for (const jobId of finishedNow) {
    const job = await db.job.findUnique({ where: { id: jobId } });
    if (!job) continue;
    const kind = DECISION_POINTS[job.taskType];
    if (!kind) continue;
    const already = await db.decision.findFirst({
      where: { jobId, kind: { in: ["select", "polish-or-finalize", "branch"] } },
    });
    if (already) continue;
    const decision = await makeDecision(projectId, job);
    decisionsMade.push({ jobId, taskType: job.taskType, decision: decision.decision });
  }

  // 2d. Finalize workflow if all done
  const refreshed = await db.job.findMany({ where: { workflowId: workflow.id } });
  const allDone = refreshed.every((j) => j.status === "done" || j.status === "skipped");
  let workflowStatus = "running";
  if (allDone) {
    await db.workflow.update({ where: { id: workflow.id }, data: { status: "done" } });
    await db.project.update({ where: { id: projectId }, data: { status: "done" } });
    await summarize(projectId);
    workflowStatus = "done";
  }

  return {
    workflowId: workflow.id,
    workflowStatus,
    advanced,
    finishedNow,
    decisionsMade,
    done: allDone,
  };
}

function canStart(job: any, jobById: Map<string, any>): boolean {
  const deps = JSON.parse(job.inputJobIds) as string[];
  // A dependency is satisfied if it is done OR skipped (skipped upstream jobs
  // mean the engine chose an alternative path, e.g. using a reference map).
  return deps.every((d) => ["done", "skipped"].includes(jobById.get(d)?.status));
}

// Generate a simple spherical 3D density map as a placeholder when no
// reference.mrc exists (real experimental data like EMPIAR). This lets
// maskcreate + postprocess produce real RELION output files.
async function generatePlaceholderMap(mapPath: string, boxSize: number, angpix: number): Promise<void> {
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const exec = promisify(execFile);
  const script = `
import sys, numpy as np, mrcfile
box = ${boxSize}
angpix = ${angpix}
z = np.zeros((box, box, box), dtype=np.float32)
c = box // 2
r = box // 4
xx, yy, zz = np.meshgrid(np.arange(box), np.arange(box), np.arange(box), indexing='ij')
d2 = (xx - c)**2 + (yy - c)**2 + (zz - c)**2
z = np.exp(-d2 / (2 * r * r)).astype(np.float32)
z /= z.max()
with mrcfile.new(sys.argv[1], overwrite=True) as m:
    m.set_data(z)
    m.voxel_size = (angpix, angpix, angpix)
print(f"wrote placeholder map {box}^3 at {angpix} A/px")
`;
  try {
    await exec("python3", ["-c", script, mapPath]);
  } catch (e) {
    // ignore — the maskcreate task will fail gracefully
  }
}

// Helper to send an info message to the chat from within buildRunnerInputs
async function on_line_info(projectId: string, content: string): Promise<void> {
  await db.message.create({
    data: {
      projectId,
      role: "tool",
      content,
      meta: JSON.stringify({ kind: "info" }),
    },
  });
}

// ---- 3. makeDecision -------------------------------------------------------

export interface Decision {
  decision: string;
  reason: string;
  action: "proceed" | "retry" | "branch";
  nextJob?: string;
  parameters?: Record<string, string | number | boolean>;
  keepClasses?: number[];
}

export async function makeDecision(projectId: string, job: { id: string; taskType: string }): Promise<Decision> {
  const fullJob = await db.job.findUnique({ where: { id: job.id } });
  if (!fullJob) return { decision: "skip", reason: "job missing", action: "proceed" };
  const outputSummary = JSON.parse(fullJob.outputSummary);
  const params = JSON.parse(fullJob.parameters);

  // Try LLM decision (delegated to DeepSeek Harness).
  let decision: Decision | null = null;
  try {
    const userPrompt = `Decision point after: ${fullJob.taskType}
Job output summary:
${JSON.stringify(outputSummary, null, 2)}

Job parameters:
${JSON.stringify(params, null, 2)}

Decide the next action.`;
    const raw = await dshConsult({ systemPrompt: DECIDER_SYSTEM_PROMPT, userPrompt });
    decision = parseJsonLoose(raw) as Decision | null;
  } catch (e) {
    decision = null;
  }

  // Fallback heuristic decision if LLM failed or returned nothing usable
  if (!decision || !decision.action) {
    decision = heuristicDecision(fullJob.taskType, outputSummary);
  }

  // Record the decision
  await db.decision.create({
    data: {
      projectId,
      jobId: fullJob.id,
      kind: DECISION_POINTS[fullJob.taskType] || "branch",
      reason: decision.reason,
      action: `${decision.action}: ${decision.decision}`,
      meta: JSON.stringify({
        decision: decision.decision,
        keepClasses: decision.keepClasses,
        nextJob: decision.nextJob,
        parameters: decision.parameters,
      }),
    },
  });

  // Announce to chat
  const task = getTask(fullJob.taskType);
  await db.message.create({
    data: {
      projectId,
      role: "assistant",
      content: `🧭 Decision after ${task?.name}: ${decision.decision}\n${decision.reason}`,
      meta: JSON.stringify({ kind: "decision", jobId: fullJob.id, taskType: fullJob.taskType, decision }),
    },
  });

  return decision;
}

function heuristicDecision(
  taskType: string,
  output: Record<string, number | string>,
): Decision {
  if (taskType === "class2d") {
    const good = Number(output.good_classes ?? 6);
    return {
      decision: `keep-${good}-good-classes`,
      reason: `Keeping ${good} classes with clear secondary structure and high particle count; discarding junk/edge classes.`,
      action: "proceed",
      nextJob: "initialmodel",
      keepClasses: Array.from({ length: good }, (_, i) => i + 1),
    };
  }
  if (taskType === "class3d") {
    const best = Number(output.best_class ?? 1);
    return {
      decision: `refine-class-${best}`,
      reason: `Class ${best} is the best-resolved and most populated; taking it into 3D auto-refinement.`,
      action: "proceed",
      nextJob: "refine3d",
    };
  }
  if (taskType === "refine3d") {
    const res = Number(output.resolution_A ?? 3.5);
    if (res > 3.5) {
      return {
        decision: "polish-then-rerefine",
        reason: `Resolution ${res} Å exceeds the 3.5 Å threshold; running Bayesian polishing then re-refinement.`,
        action: "proceed",
        nextJob: "polish",
      };
    }
    return {
      decision: "finalize-pipeline",
      reason: `Resolution ${res} Å is good; proceeding to post-processing and local resolution.`,
      action: "proceed",
      nextJob: "maskcreate",
    };
  }
  return { decision: "proceed", reason: "No specific heuristic; continuing pipeline.", action: "proceed" };
}

// ---- 4. summarize ----------------------------------------------------------

export async function summarize(projectId: string): Promise<void> {
  const jobs = await db.job.findMany({
    where: { workflow: { projectId } },
    orderBy: { createdAt: "asc" },
  });
  const refine = jobs.find((j) => j.taskType === "refine3d");
  const post = jobs.find((j) => j.taskType === "postprocess");
  const refineOut = refine ? JSON.parse(refine.outputSummary) : {};
  const postOut = post ? JSON.parse(post.outputSummary) : {};

  const userPrompt = `The pipeline finished. Final state:
- Refined resolution: ${refineOut.resolution_A ?? "n/a"} Å
- Postprocess resolution: ${postOut.resolution_A ?? "n/a"} Å
- Particles: ${refineOut.n_particles ?? "n/a"}
- Symmetry: ${refineOut.symmetry ?? "C1"}

Write a concise final summary (2-3 sentences) for the user, in markdown.`;
  const summary = await dshConsult({ systemPrompt: CHAT_SYSTEM_PROMPT, userPrompt }) || "Pipeline complete.";
  await db.message.create({
    data: {
      projectId,
      role: "assistant",
      content: `## ✅ Pipeline complete\n\n${summary}\n\n**Final resolution:** ${postOut.resolution_A ?? refineOut.resolution_A ?? "n/a"} Å`,
      meta: JSON.stringify({ kind: "summary" }),
    },
  });
}

// ---- 5. chatReply (incremental: plans only the FIRST job) ------------------

// The agent is now incremental: chatReply plans ONLY the first job. After each
// job completes, planNextJob() decides the next single job based on the result.
// This makes the agent truly adaptive — it doesn't pre-commit to a fixed DAG.

export async function chatReply(
  projectId: string,
  userMessage: string,
): Promise<{ workflowId: string | null; assistantMessage: string }> {
  const project = await db.project.findUnique({ where: { id: projectId } });
  const datasetMeta = project?.datasetMeta ? JSON.parse(project.datasetMeta) : {};

  // Decide the FIRST job via the DeepSeek Harness agent.
  const userPrompt = `User request:
"""
${userMessage}
"""

Dataset metadata:
${JSON.stringify(datasetMeta, null, 2)}

Source dataset path: ${project?.sourceDataset || "unknown"}

Decide the single first RELION job now.`;
  const raw = await dshConsult({ systemPrompt: FIRST_JOB_SYSTEM_PROMPT, userPrompt });
  const parsed = parseJsonLoose(raw) as
    | { firstJob?: PlannedJob; ackMessage?: string; done?: boolean }
    | null;

  // Create the workflow (empty — jobs are added one at a time)
  const workflow = await db.workflow.create({
    data: {
      projectId,
      name: "Incremental RELION pipeline",
      status: "running",
    },
  });
  await db.project.update({ where: { id: projectId }, data: { status: "running" } });

  let assistantMessage: string;
  if (parsed?.firstJob) {
    // store the user's original goal on the workflow for the next-job planner
    await db.message.create({
      data: {
        projectId,
        role: "system",
        content: `USER_GOAL: ${userMessage}`,
        meta: JSON.stringify({ kind: "user-goal" }),
      },
    });
    // create the first job
    await createSingleJob(workflow.id, projectId, parsed.firstJob, []);
    assistantMessage =
      parsed.ackMessage ||
      `I'll start with **${parsed.firstJob.task}** and decide each next step based on the results. Watch the workflow panel — each job's results appear as it completes.`;
  } else {
    assistantMessage = `I understood your request but couldn't decide on a first step. Could you give me more detail about the dataset (pixel size, voltage, particle)?`;
  }

  await db.message.create({
    data: {
      projectId,
      role: "assistant",
      content: assistantMessage,
      meta: JSON.stringify({ kind: "first-job", workflowId: workflow.id }),
    },
  });

  return { workflowId: workflow.id, assistantMessage };
}

// ---- 6. planNextJob (called after a job completes) -------------------------

// Creates a single job in the DB with its parameters + input dependencies.
async function createSingleJob(
  workflowId: string,
  projectId: string,
  job: PlannedJob,
  inputJobIds: string[],
): Promise<string> {
  const task = getTask(job.task);
  if (!task) throw new Error(`unknown task ${job.task}`);
  const params: Record<string, string | number | boolean> = {};
  for (const p of task.parameters) params[p.key] = p.default;
  for (const [k, v] of Object.entries(job.parameters || {})) params[k] = v;
  // For the IMPORT job, copy the user-selected bin_factor from the project's
  // datasetMeta (set via the NewProjectDialog "Micrograph binning" dropdown).
  // The LLM doesn't know about bin_factor — the UI choice is authoritative.
  if (job.task === "import") {
    const project = await db.project.findUnique({ where: { id: projectId } });
    if (project?.datasetMeta) {
      try {
        const meta = JSON.parse(project.datasetMeta) as Record<string, unknown>;
        const bf = Number(meta.bin_factor);
        if (Number.isFinite(bf) && (bf === 0 || bf === 1 || bf === 2 || bf === 4)) {
          params["bin_factor"] = bf;
        }
      } catch {}
    }
  }
  // Inherit critical optics parameters (angpix, kV, Cs, Q0) from the import
  // job if the LLM didn't specify them — every downstream task needs the
  // correct pixel size / voltage to work.
  if (job.task !== "import" && inputJobIds.length > 0) {
    // walk back to find the import job
    const allJobs = await db.job.findMany({ where: { workflowId } });
    const importJob = allJobs.find((j) => j.taskType === "import");
    if (importJob) {
      const importParams = JSON.parse(importJob.parameters) as Record<string, string | number | boolean>;
      const importSummary = JSON.parse(importJob.outputSummary || "{}") as Record<string, unknown>;
      for (const key of ["angpix", "kV", "Cs", "Q0"]) {
        if (importParams[key] !== undefined && params[key] !== undefined) {
          // only override if the LLM left the default (didn't explicitly set it)
          const taskDefault = task.parameters.find((p) => p.key === key)?.default;
          if (params[key] === taskDefault) {
            params[key] = importParams[key];
          }
        }
      }
      // If import downsampled, use the EFFECTIVE pixel size from the import
      // output summary (which has the adjusted angpix after binning).
      if (importSummary.downsampled && importSummary.pixel_size) {
        params["angpix"] = importSummary.pixel_size as number | string;
      }
    }
  }
  const created = await db.job.create({
    data: {
      workflowId,
      taskType: job.task,
      alias: job.alias || "",
      status: "queued",
      parameters: JSON.stringify(params),
      inputJobIds: JSON.stringify(inputJobIds),
    },
  });
  return created.id;
}

// After a job completes, ask the LLM what the next single job should be (or done).
export async function planNextJob(
  projectId: string,
  completedJobId: string,
): Promise<{ created: boolean; done: boolean }> {
  const workflow = await db.workflow.findFirst({
    where: { projectId, status: "running" },
    orderBy: { createdAt: "desc" },
  });
  if (!workflow) return { created: false, done: true };

  const allJobs = await db.job.findMany({
    where: { workflowId: workflow.id },
    orderBy: { createdAt: "asc" },
  });
  const completedJob = allJobs.find((j) => j.id === completedJobId);
  if (!completedJob) return { created: false, done: false };

  // Find the user's original goal (stored as a system message)
  const goalMsg = await db.message.findFirst({
    where: { projectId, role: "system", content: { startsWith: "USER_GOAL:" } },
  });
  const userGoal = goalMsg?.content?.replace("USER_GOAL:", "").trim() || "";

  // Build a summary of all completed jobs + their outputs
  const doneJobs = allJobs.filter((j) => ["done", "skipped"].includes(j.status));
  const jobHistory = doneJobs
    .map((j) => {
      const o = JSON.parse(j.outputSummary);
      const summaryEntries = Object.entries(o)
        .slice(0, 6)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      return `- ${j.taskType} (${j.status}): ${summaryEntries || "no metrics"}`;
    })
    .join("\n");

  const justOut = JSON.parse(completedJob.outputSummary);

  // ---- Force-advance guardrail -------------------------------------------
  // The DSH agent tends to loop on class2d when particles_in_good_classes=0
  // (the prompt tells it to retry). After 2 class2d runs with poor results,
  // force the next step to initialmodel so the pipeline advances to 3D.
  const taskRunCounts: Record<string, number> = {};
  for (const j of doneJobs) taskRunCounts[j.taskType] = (taskRunCounts[j.taskType] || 0) + 1;

  let forceAdvanceHint = "";
  const class2dRuns = taskRunCounts["class2d"] || 0;
  const hasInitialmodel = (taskRunCounts["initialmodel"] || 0) > 0;
  const hasExtract = (taskRunCounts["extract"] || 0) > 0;
  const autopickRuns = taskRunCounts["autopick"] || 0;

  // Guardrail: autopick loop → force extract
  if (autopickRuns >= 2 && !hasExtract) {
    forceAdvanceHint += `\n\n⚠️ FORCE-ADVANCE GUARDRAIL: autopick has already been run ${autopickRuns} times. Do NOT plan another autopick. Your nextJob MUST be "extract" (box_size based on particle diameter, depends on the last autopick output). Extract is required before class2d.`;
  }
  // Guardrail: class2d without extract → force extract first
  if (class2dRuns >= 1 && !hasExtract) {
    forceAdvanceHint += `\n\n⚠️ BLOCKER: class2d was attempted but extract has not been run. class2d needs particles from extract. Your nextJob MUST be "extract" depending on the last autopick output.`;
  }
  if (class2dRuns >= 2 && !hasInitialmodel) {
    // Extract particle count from the last extract/class2d job
    let particleCount = 0;
    const extractJob = [...doneJobs].reverse().find((j) => j.taskType === "extract");
    if (extractJob) {
      try {
        const eo = JSON.parse(extractJob.outputSummary);
        particleCount = eo.n_particles || eo.particle_count || 0;
      } catch {}
    }
    forceAdvanceHint += `\n\n⚠️ FORCE-ADVANCE GUARDRAIL: class2d has already been run ${class2dRuns} times and particles_in_good_classes is still 0. Do NOT plan another class2d. The particles are real signal (even if 2D classes are noisy on this small dataset). Your nextJob MUST be "initialmodel" with C1 symmetry and 3 classes, depending on the last extract job. After initialmodel, proceed to class3d -> refine3d -> maskcreate -> postprocess. Skipping 2D class selection is acceptable when particle count is low (current: ${particleCount}).`;
  }
  // Guardrail for initialmodel/class3d loops
  if ((taskRunCounts["initialmodel"] || 0) >= 2 && (taskRunCounts["class3d"] || 0) === 0) {
    forceAdvanceHint += `\n\n⚠️ initialmodel has been run ${taskRunCounts["initialmodel"]} times. Your nextJob MUST be "class3d" (3-5 classes) depending on the last initialmodel output.`;
  }
  if ((taskRunCounts["class3d"] || 0) >= 2 && (taskRunCounts["refine3d"] || 0) === 0) {
    forceAdvanceHint += `\n\n⚠️ class3d has been run ${taskRunCounts["class3d"]} times. Your nextJob MUST be "refine3d" depending on the best class3d output.`;
  }

  const userPrompt = `User's original goal:
"""
${userGoal}
"""

Pipeline history so far:
${jobHistory || "(no jobs completed yet)"}

NOTE: 3D tasks (initialmodel, class3d, refine3d) CAN run on this CPU deployment.
They use reduced iterations but should produce real 3D maps. Proceed with the full
pipeline: class2d -> initialmodel -> class3d -> refine3d -> maskcreate -> postprocess.
Only multibody/polish/movierefine require a GPU and are auto-skipped.

The just-completed job was: ${completedJob.taskType} (${completedJob.status})
Its output summary: ${JSON.stringify(justOut)}

Task run counts so far: ${JSON.stringify(taskRunCounts)}
${forceAdvanceHint}

Decide the SINGLE next RELION job to run (or declare done). If all feasible steps are done, declare done.`;
  const raw = await dshConsult({ systemPrompt: NEXT_JOB_SYSTEM_PROMPT, userPrompt });
  let parsed = parseJsonLoose(raw) as
    | { nextJob?: PlannedJob; done?: boolean; summary?: string }
    | null;

  // ---- Force-advance enforcement (hard override) -------------------------
  // If the DSH agent ignored the hint and still returned a looping task,
  // override its choice to force pipeline advancement.
  if (parsed?.nextJob) {
    const njTask = parsed.nextJob.task;
    // Override 1: autopick loop → force extract
    if (njTask === "autopick" && autopickRuns >= 2 && !hasExtract) {
      parsed.nextJob = {
        task: "extract",
        alias: "forced_extract",
        dependsOn: ["autopick"],
        parameters: { do_rescale: true, bin_factor: 1 },
        rationale: `FORCE-ADVANCE: autopick was run ${autopickRuns}x. Extracting particles now (required before class2d).`,
      };
      await db.message.create({
        data: {
          projectId,
          role: "system",
          content: `🛡️ Guardrail override: DSH planned autopick again (×${autopickRuns + 1}), forcing extract to advance the pipeline.`,
          meta: JSON.stringify({ kind: "guardrail-override", from: "autopick", to: "extract" }),
        },
      });
    }
    // Override 2: class2d without extract → force extract
    if (njTask === "class2d" && !hasExtract && autopickRuns > 0) {
      parsed.nextJob = {
        task: "extract",
        alias: "forced_extract_before_class2d",
        dependsOn: ["autopick"],
        parameters: { do_rescale: true, bin_factor: 1 },
        rationale: `FORCE-ADVANCE: class2d needs particles but extract hasn't run. Forcing extract first.`,
      };
      await db.message.create({
        data: {
          projectId,
          role: "system",
          content: `🛡️ Guardrail override: DSH planned class2d but extract hasn't run, forcing extract first.`,
          meta: JSON.stringify({ kind: "guardrail-override", from: "class2d", to: "extract" }),
        },
      });
    }
    // Override 3: class2d loop → force initialmodel
    if (njTask === "class2d" && class2dRuns >= 2 && !hasInitialmodel && hasExtract) {
      parsed.nextJob = {
        task: "initialmodel",
        alias: "forced_initialmodel",
        dependsOn: ["extract"],
        parameters: { symmetry: "C1", nr_classes: 3 },
        rationale: `FORCE-ADVANCE: class2d was run ${class2dRuns}x with 0 good classes. Proceeding to initialmodel with all particles (C1, 3 classes) to advance the pipeline to 3D.`,
      };
      await db.message.create({
        data: {
          projectId,
          role: "system",
          content: `🛡️ Guardrail override: DSH planned class2d again (×${class2dRuns + 1}), forcing initialmodel to break the loop.`,
          meta: JSON.stringify({ kind: "guardrail-override", from: "class2d", to: "initialmodel" }),
        },
      });
    }
  }

  if (parsed?.done) {
    // ---- Pipeline-completeness guardrail --------------------------------
    // DSH sometimes prematurely declares "done" after ctffind or class2d.
    // Don't allow done unless the pipeline has at least reached refine3d
    // (or postprocess). If key steps are missing, override to force the next
    // required step instead of completing.
    const hasAutopick = (taskRunCounts["autopick"] || 0) > 0;
    const hasClass2d = (taskRunCounts["class2d"] || 0) > 0;
    const hasRefine3d = (taskRunCounts["refine3d"] || 0) > 0;
    const hasPostprocess = (taskRunCounts["postprocess"] || 0) > 0;
    const hasMaskcreate = (taskRunCounts["maskcreate"] || 0) > 0;

    // Pipeline is only complete if postprocess has run (the final step).
    // Even if refine3d is done, force postprocess if it hasn't run.
    if (!hasPostprocess) {
      // Pipeline not complete — force the next required step
      let forcedTask = "";
      let forcedDeps: string[] = [];
      let forcedParams: Record<string, string | number | boolean> = {};
      let forcedRationale = "";
      if (!hasAutopick) {
        forcedTask = "autopick";
        forcedDeps = ["ctffind"];
        forcedParams = { particle_diameter: 130, do_LoG: true, threshold: 0.0 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but autopick hasn't run. Forcing autopick (ctffind is done).`;
      } else if (!hasExtract) {
        forcedTask = "extract";
        forcedDeps = ["autopick"];
        forcedParams = { do_rescale: true, bin_factor: 1 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but extract hasn't run. Forcing extract.`;
      } else if (!hasClass2d) {
        forcedTask = "class2d";
        forcedDeps = ["extract"];
        forcedParams = { nr_classes: 10, iter_nr_iter: 25 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but class2d hasn't run. Forcing class2d.`;
      } else if (!hasInitialmodel) {
        forcedTask = "initialmodel";
        forcedDeps = ["extract"];
        forcedParams = { symmetry: "C1", nr_classes: 3 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but initialmodel hasn't run. Forcing initialmodel.`;
      } else if ((taskRunCounts["class3d"] || 0) === 0) {
        forcedTask = "class3d";
        forcedDeps = ["initialmodel"];
        forcedParams = { nr_classes: 3, symmetry: "C1" };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but class3d hasn't run. Forcing class3d.`;
      } else if (!hasRefine3d) {
        forcedTask = "refine3d";
        forcedDeps = ["class3d"];
        forcedParams = { symmetry: "C1", particle_diameter: 130 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but refine3d hasn't run. Forcing refine3d.`;
      } else if (!hasMaskcreate) {
        forcedTask = "maskcreate";
        forcedDeps = ["refine3d"];
        forcedParams = { ini_threshold: 0.02, extend_mask: 3, soft_edge: 3 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but maskcreate hasn't run. Forcing maskcreate.`;
      } else {
        forcedTask = "postprocess";
        forcedDeps = ["refine3d", "maskcreate"];
        forcedParams = { angpix: 1.34 };
        forcedRationale = `FORCE-ADVANCE: DSH declared done but postprocess hasn't run. Forcing postprocess.`;
      }
      parsed = { nextJob: { task: forcedTask, alias: `forced_${forcedTask}`, dependsOn: forcedDeps, parameters: forcedParams, rationale: forcedRationale } };
      await db.message.create({
        data: {
          projectId,
          role: "system",
          content: `🛡️ Pipeline-completeness guardrail: DSH declared "done" but ${forcedTask} hasn't run. Forcing ${forcedTask} to continue the pipeline.`,
          meta: JSON.stringify({ kind: "guardrail-override", from: "done", to: forcedTask }),
        },
      });
    } else {
      // pipeline genuinely complete
      await db.workflow.update({ where: { id: workflow.id }, data: { status: "done" } });
      await db.project.update({ where: { id: projectId }, data: { status: "done" } });
      const summary = parsed.summary || "Pipeline complete.";
      await db.message.create({
        data: {
          projectId,
          role: "assistant",
          content: `## ✅ Pipeline complete\n\n${summary}`,
          meta: JSON.stringify({ kind: "summary" }),
        },
      });
      return { created: false, done: true };
    }
  }

  if (parsed?.nextJob) {
    const nj = parsed.nextJob;
    // Cycle detection with task-specific limits. The force-advance guardrail
    // above handles class2d→initialmodel and initialmodel→class3d transitions,
    // so we allow class2d up to 3 runs and initialmodel/class3d up to 2 before
    // declaring the pipeline complete.
    const CYCLE_LIMITS: Record<string, number> = {
      class2d: 3,
      initialmodel: 2,
      class3d: 2,
      refine3d: 2,
    };
    const sameTypeCount = doneJobs.filter((j) => j.taskType === nj.task).length;
    const limit = CYCLE_LIMITS[nj.task] ?? 2;
    if (sameTypeCount >= limit) {
      await db.workflow.update({ where: { id: workflow.id }, data: { status: "done" } });
      await db.project.update({ where: { id: projectId }, data: { status: "done" } });
      await db.message.create({
        data: {
          projectId,
          role: "assistant",
          content: `## ✅ Pipeline complete\n\nThe agent has run all feasible steps. ${nj.task} was already attempted ${sameTypeCount} times (limit ${limit}) — stopping to avoid a cycle. Final resolution is limited by the synthetic dataset (96 particles) and CPU-only compute.`,
          meta: JSON.stringify({ kind: "summary", cycleBreak: true, taskType: nj.task, runs: sameTypeCount }),
        },
      });
      return { created: false, done: true };
    }
    // resolve dependsOn: by task key → last done job of that type
    const inputJobIds: string[] = [];
    for (const dep of nj.dependsOn || []) {
      const cand = doneJobs.filter((j) => j.taskType === dep);
      if (cand.length) inputJobIds.push(cand[cand.length - 1].id);
    }
    await createSingleJob(workflow.id, projectId, nj, inputJobIds);
    await db.message.create({
      data: {
        projectId,
        role: "assistant",
        content: `🧭 Next: **${nj.task}**${nj.rationale ? ` — ${nj.rationale}` : ""}`,
        meta: JSON.stringify({ kind: "next-job", taskType: nj.task }),
      },
    });
    return { created: true, done: false };
  }

  // fallback: if LLM gave nothing usable, try a heuristic next-step
  const heuristicNext = heuristicNextJob(completedJob.taskType, justOut);
  if (heuristicNext) {
    const inputJobIds = [completedJob.id];
    await createSingleJob(workflow.id, projectId, heuristicNext, inputJobIds);
    await db.message.create({
      data: {
        projectId,
        role: "assistant",
        content: `🧭 Next: **${heuristicNext.task}** (heuristic — LLM gave no usable plan)`,
        meta: JSON.stringify({ kind: "next-job", taskType: heuristicNext.task, heuristic: true }),
      },
    });
    return { created: true, done: false };
  }

  // nothing more to do
  await db.workflow.update({ where: { id: workflow.id }, data: { status: "done" } });
  await db.project.update({ where: { id: projectId }, data: { status: "done" } });
  return { created: false, done: true };
}

// Heuristic next-step fallback (used if the LLM plan is unparseable).
function heuristicNextJob(
  taskType: string,
  output: Record<string, number | string>,
): PlannedJob | null {
  const seq: Record<string, string> = {
    import: "motioncorr",
    motioncorr: "ctffind",
    ctffind: "autopick",
    autopick: "extract",
    extract: "select",
    select: "class2d",
    class2d: "maskcreate",
    maskcreate: "postprocess",
    postprocess: "localres",
  };
  const next = seq[taskType];
  if (!next) return null;
  return {
    task: next,
    dependsOn: [taskType],
    parameters: {},
    rationale: `Heuristic next step after ${taskType}.`,
  };
}
