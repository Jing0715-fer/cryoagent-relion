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

import ZAI from "z-ai-web-dev-sdk";
import path from "path";
import { db } from "@/lib/db";
import { getTask } from "@/lib/relion/tasks";
import { buildContext, getLogPlan, getOutput, taskDuration } from "@/lib/relion/executor";
import { CHAT_SYSTEM_PROMPT, DECIDER_SYSTEM_PROMPT, PLANNER_SYSTEM_PROMPT, FIRST_JOB_SYSTEM_PROMPT, NEXT_JOB_SYSTEM_PROMPT } from "./prompts";

let _zai: Awaited<ReturnType<typeof ZAI.create>> | null = null;
async function zai() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

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

  const client = await zai();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: PLANNER_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    thinking: { type: "disabled" },
  });
  const raw = completion.choices[0]?.message?.content ?? "";
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
  try {
    const base = process.env.RUNNER_URL || "http://localhost:3004";
    const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

// Build the "inputs" map (key -> absolute path) for the runner from a job's
// upstream input job ids. Each input key is named after the upstream task type.
// Also walks the full dependency DAG so we can find required upstream stars
// (e.g. extract needs both autopick_star AND motioncorr_star even if the LLM
// only listed autopick as a direct dep).
async function buildRunnerInputs(job: any, allJobs: any[]): Promise<Record<string, string>> {
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
          const refMap = path.join(project.sourceDataset, "reference.mrc");
          inputs[key] = refMap;
        }
      }
      continue;
    }
    const dep = candidates[candidates.length - 1];
    const abs = path.join(
      path.resolve(process.cwd(), "data", "projects", dep.workflow.projectId || ""),
      dep.primaryOutput,
    );
    inputs[key] = abs;
  }

  return inputs;
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
    // Skip slow tasks (initialmodel uses denovo_3dref which is impractical on CPU
    // for small datasets — we fall back to the dataset's reference.mrc instead).
    const CPU_SKIPPED = new Set(["initialmodel", "class3d", "refine3d", "multibody", "polish", "movierefine", "localres"]);
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
            content: `⏭️ ${j.taskType} skipped on CPU — this task requires a GPU for practical runtime. The agent will decide the next CPU-feasible step.`,
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
      const inputs = await buildRunnerInputs(
        { ...next, inputJobIds: next.inputJobIds, workflow: { projectId } },
        allJobs.map((j) => ({ ...j, workflow: { projectId } })),
      );
      const params = JSON.parse(next.parameters);
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
        finishedNow.push(next.id);
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
    // Fallback: if the workflow is idle (no queued/running) but we haven't
    // triggered planNextJob this tick, check if the last terminal job needs
    // a next-step decision (e.g. it was skipped/completed in a prior tick).
    if (triggerIds.length === 0 && !hasQueued && !hasRunning && refreshed.length > 0) {
      const terminal = refreshed.filter((j) => ["done", "skipped", "failed"].includes(j.status));
      if (terminal.length > 0) {
        const lastTerminal = terminal[terminal.length - 1];
        // only trigger if this job was completed very recently (within 5s)
        // to avoid re-triggering on every idle tick
        if (lastTerminal.finishedAt) {
          const ageSec = (Date.now() - lastTerminal.finishedAt.getTime()) / 1000;
          if (ageSec < 10) {
            triggerIds.push(lastTerminal.id);
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
      await db.job.update({
        where: { id: job.id },
        data: {
          status: "done",
          progress: 100,
          outputSummary: JSON.stringify(output),
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

  // Try LLM decision
  let decision: Decision | null = null;
  try {
    const client = await zai();
    const userPrompt = `Decision point after: ${fullJob.taskType}
Job output summary:
${JSON.stringify(outputSummary, null, 2)}

Job parameters:
${JSON.stringify(params, null, 2)}

Decide the next action.`;
    const completion = await client.chat.completions.create({
      messages: [
        { role: "assistant", content: DECIDER_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      thinking: { type: "disabled" },
    });
    const raw = completion.choices[0]?.message?.content ?? "";
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

  const client = await zai();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: CHAT_SYSTEM_PROMPT },
      {
        role: "user",
        content: `The pipeline finished. Final state:
- Refined resolution: ${refineOut.resolution_A ?? "n/a"} Å
- Postprocess resolution: ${postOut.resolution_A ?? "n/a"} Å
- Particles: ${refineOut.n_particles ?? "n/a"}
- Symmetry: ${refineOut.symmetry ?? "C1"}

Write a concise final summary (2-3 sentences) for the user, in markdown.`,
      },
    ],
    thinking: { type: "disabled" },
  });
  const summary = completion.choices[0]?.message?.content ?? "Pipeline complete.";
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

  // Decide the FIRST job via the LLM
  const client = await zai();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: FIRST_JOB_SYSTEM_PROMPT },
      {
        role: "user",
        content: `User request:
"""
${userMessage}
"""

Dataset metadata:
${JSON.stringify(datasetMeta, null, 2)}

Source dataset path: ${project?.sourceDataset || "unknown"}

Decide the single first RELION job now.`,
      },
    ],
    thinking: { type: "disabled" },
  });
  const raw = completion.choices[0]?.message?.content ?? "";
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
  // Inherit critical optics parameters (angpix, kV, Cs, Q0) from the import
  // job if the LLM didn't specify them — every downstream task needs the
  // correct pixel size / voltage to work.
  if (job.task !== "import" && inputJobIds.length > 0) {
    // walk back to find the import job
    const allJobs = await db.job.findMany({ where: { workflowId } });
    const importJob = allJobs.find((j) => j.taskType === "import");
    if (importJob) {
      const importParams = JSON.parse(importJob.parameters) as Record<string, string | number | boolean>;
      for (const key of ["angpix", "kV", "Cs", "Q0"]) {
        if (importParams[key] !== undefined && params[key] !== undefined) {
          // only override if the LLM left the default (didn't explicitly set it)
          const taskDefault = task.parameters.find((p) => p.key === key)?.default;
          if (params[key] === taskDefault) {
            params[key] = importParams[key];
          }
        }
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

  const client = await zai();
  const completion = await client.chat.completions.create({
    messages: [
      { role: "assistant", content: NEXT_JOB_SYSTEM_PROMPT },
      {
        role: "user",
        content: `User's original goal:
"""
${userGoal}
"""

Pipeline history so far:
${jobHistory || "(no jobs completed yet)"}

NOTE: On this CPU-only deployment, the heavy 3D tasks (initialmodel, class3d, refine3d,
multibody, polish, localres) are AUTOMATICALLY SKIPPED because they require a GPU. When they
are skipped, the pipeline falls back to the dataset's reference.mrc as the 3D reference, so
maskcreate and postprocess can still run. Do NOT re-run class2d or try 3D tasks again —
proceed to maskcreate (using the reference map) and postprocess instead.

The just-completed/skipped job was: ${completedJob.taskType} (${completedJob.status})
Its output summary: ${JSON.stringify(justOut)}

Decide the SINGLE next RELION job to run (or declare done). If all feasible steps are done, declare done.`,
      },
    ],
    thinking: { type: "disabled" },
  });
  const raw = completion.choices[0]?.message?.content ?? "";
  const parsed = parseJsonLoose(raw) as
    | { nextJob?: PlannedJob; done?: boolean; summary?: string }
    | null;

  if (parsed?.done) {
    // pipeline complete
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

  if (parsed?.nextJob) {
    const nj = parsed.nextJob;
    // Cycle detection: if this task type has already been run 2+ times, don't
    // create another — declare done to prevent infinite loops.
    const sameTypeCount = doneJobs.filter((j) => j.taskType === nj.task).length;
    if (sameTypeCount >= 2) {
      await db.workflow.update({ where: { id: workflow.id }, data: { status: "done" } });
      await db.project.update({ where: { id: projectId }, data: { status: "done" } });
      await db.message.create({
        data: {
          projectId,
          role: "assistant",
          content: `## ✅ Pipeline complete\n\nThe agent has run all feasible steps. ${nj.task} was already attempted ${sameTypeCount} times — stopping to avoid a cycle.`,
          meta: JSON.stringify({ kind: "summary", cycleBreak: true }),
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
