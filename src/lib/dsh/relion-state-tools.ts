// DSH RELION read-only state tools plugin.
//
// This module registers read-only tools that the DeepSeek Harness agent can
// call during planNextJob / makeDecision to inspect the current pipeline state.
// Tools are registered via defineTool() and exposed through the DSH tool
// registry. All tools are READ-ONLY — they query the Prisma database and
// return JSON; they never mutate state or shell out to RELION.
//
// Registered tools:
//   - get_project_state: project metadata + dataset config + status
//   - get_workflow_jobs: all jobs in the active workflow with their status/outputs
//   - get_job_details: a single job's parameters, logs, and output summary
//   - get_decisions: the autonomous decision log (next-job-planned, verify, guardrail)
//   - get_relion_task_catalog: the 18 RELION tasks with their params/prereqs
//
// Usage from engine.ts:
//   import { registerRelionStateTools, getRelionToolsPatchPath } from "@/lib/dsh/relion-state-tools";
//   The patch file is passed to dsh --patch so the tools are available to the
//   agent loop. Tool execution is handled here (queries Prisma directly).

import { defineTool } from "@deepseek-ai/dsh-tools";
import { db } from "@/lib/db";
import { getTask } from "@/lib/relion/tasks";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

const PATCH_DIR = path.join(os.tmpdir(), "dsh-cryo-relion-tools");

/**
 * The RELION state tools patch file. This patch loads the relion-state-tools
 * plugin into the headless profile so the DSH agent can call the tools.
 * The tool implementations are imported dynamically by the bridge before
 * each dshConsult call.
 */
export function getRelionToolsPatchPath(): string {
  fs.mkdirSync(PATCH_DIR, { recursive: true });
  const p = path.join(PATCH_DIR, "relion-state-tools.yml");
  if (!fs.existsSync(p)) {
    const doc = [
      `# Register the RELION read-only state tools plugin.`,
      `# The plugin (src/lib/dsh/relion-state-tools.ts) registers tools that`,
      `# let the DSH agent query project/job/workflow state during planning.`,
      `- id: relion-state-tools`,
      `  name: '@deepseek-ai/dsh-relion-state-tools'`,
      ``,
    ].join("\n");
    fs.writeFileSync(p, doc, "utf8");
  }
  return p;
}

/**
 * Tool: get_project_state
 * Returns the project metadata, dataset config, and current status.
 */
export const getProjectStateTool = defineTool({
  name: "get_project_state",
  description:
    "Get the current cryo-EM project state: name, status, dataset metadata (pixel size, voltage, symmetry, particle, target resolution), and source dataset path. Use this to understand the dataset before planning RELION jobs.",
  parameters: {
    projectId: {
      type: "string",
      description: "The project ID to query",
      required: true,
    },
  },
  output: {
    schema: { type: "object" },
    render: (_args: any, value: any) => [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args: { projectId: string }) {
    const project = await db.project.findUnique({
      where: { id: args.projectId },
    });
    if (!project) {
      return { error: "Project not found", projectId: args.projectId };
    }
    const datasetMeta = project.datasetMeta
      ? JSON.parse(project.datasetMeta)
      : {};
    return {
      id: project.id,
      name: project.name,
      status: project.status,
      description: project.description,
      executorMode: project.executorMode,
      sourceDataset: project.sourceDataset,
      datasetMeta,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  },
});

/**
 * Tool: get_workflow_jobs
 * Returns all jobs in the active workflow with their status, task type,
 * parameters, and output summaries.
 */
export const getWorkflowJobsTool = defineTool({
  name: "get_workflow_jobs",
  description:
    "Get all jobs in the active workflow: task type, status (queued/running/done/failed/skipped), parameters, output summary, and timestamps. Use this to see pipeline progress before deciding the next job.",
  parameters: {
    projectId: {
      type: "string",
      description: "The project ID to query",
      required: true,
    },
  },
  output: {
    schema: { type: "object" },
    render: (_args: any, value: any) => [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args: { projectId: string }) {
    const workflow = await db.workflow.findFirst({
      where: { projectId: args.projectId, status: "running" },
      orderBy: { createdAt: "desc" },
    });
    if (!workflow) {
      return { error: "No active workflow", projectId: args.projectId };
    }
    const jobs = await db.job.findMany({
      where: { workflowId: workflow.id },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        taskType: true,
        alias: true,
        status: true,
        progress: true,
        parameters: true,
        outputSummary: true,
        primaryOutput: true,
        startedAt: true,
        finishedAt: true,
        duration: true,
      },
    });
    return {
      workflowId: workflow.id,
      workflowStatus: workflow.status,
      jobCount: jobs.length,
      jobs: jobs.map((j) => ({
        id: j.id,
        taskType: j.taskType,
        alias: j.alias,
        status: j.status,
        progress: j.progress,
        parameters: j.parameters ? JSON.parse(j.parameters) : {},
        outputSummary: j.outputSummary ? JSON.parse(j.outputSummary) : {},
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        durationSec: j.duration,
      })),
    };
  },
});

/**
 * Tool: get_job_details
 * Returns a single job's full details including logs.
 */
export const getJobDetailsTool = defineTool({
  name: "get_job_details",
  description:
    "Get detailed information about a specific job: parameters, output summary, output files, and the last N log lines. Use this to diagnose why a job failed or to inspect its results.",
  parameters: {
    jobId: {
      type: "string",
      description: "The job ID to inspect",
      required: true,
    },
    logLimit: {
      type: "number",
      description: "Maximum number of log lines to return (default 20)",
      required: false,
    },
  },
  output: {
    schema: { type: "object" },
    render: (_args: any, value: any) => [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args: { jobId: string; logLimit?: number }) {
    const job = await db.job.findUnique({
      where: { id: args.jobId },
    });
    if (!job) {
      return { error: "Job not found", jobId: args.jobId };
    }
    const limit = args.logLimit || 20;
    const logs = await db.jobLog.findMany({
      where: { jobId: args.jobId },
      orderBy: { id: "desc" },
      take: limit,
    });
    return {
      id: job.id,
      taskType: job.taskType,
      alias: job.alias,
      status: job.status,
      progress: job.progress,
      parameters: job.parameters ? JSON.parse(job.parameters) : {},
      outputSummary: job.outputSummary ? JSON.parse(job.outputSummary) : {},
      primaryOutput: job.primaryOutput,
      outputFiles: job.outputFiles ? JSON.parse(job.outputFiles) : [],
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationSec: job.duration,
      recentLogs: logs.reverse().map((l) => ({ level: l.level, line: l.line })),
    };
  },
});

/**
 * Tool: get_decisions
 * Returns the autonomous decision log (next-job-planned, verify, guardrail
 * overrides, stale-recovery).
 */
export const getDecisionsTool = defineTool({
  name: "get_decisions",
  description:
    "Get the autonomous decision log: next-job-planned decisions, verify (pass/fail) results, guardrail overrides, and stale-recovery events. Use this to understand the agent's reasoning history before planning the next step.",
  parameters: {
    projectId: {
      type: "string",
      description: "The project ID to query",
      required: true,
    },
    limit: {
      type: "number",
      description: "Maximum number of decisions to return (default 30)",
      required: false,
    },
  },
  output: {
    schema: { type: "object" },
    render: (_args: any, value: any) => [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute(args: { projectId: string; limit?: number }) {
    const limit = args.limit || 30;
    const decisions = await db.decision.findMany({
      where: { projectId: args.projectId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return {
      count: decisions.length,
      decisions: decisions.map((d) => ({
        id: d.id,
        kind: d.kind,
        action: d.action,
        reason: d.reason,
        jobId: d.jobId,
        meta: d.meta ? JSON.parse(d.meta) : {},
        createdAt: d.createdAt,
      })),
    };
  },
});

/**
 * Tool: get_relion_task_catalog
 * Returns the 18 RELION tasks with their parameters, prerequisites, and
 * decision hints. Lets the agent know what tasks are available.
 */
export const getRelionTaskCatalogTool = defineTool({
  name: "get_relion_task_catalog",
  description:
    "Get the RELION task catalog: all 18 supported tasks (import, motioncorr, ctffind, autopick, extract, select, class2d, initialmodel, class3d, refine3d, maskcreate, postprocess, localres, multibody, polish, movierefine, external, manualpick) with their parameters, prerequisites, outputs, and decision hints. Use this to know what RELION jobs are available for planning.",
  parameters: {},
  output: {
    schema: { type: "object" },
    render: (_args: any, value: any) => [
      { type: "text", text: JSON.stringify(value, null, 2) },
    ],
  },
  async execute() {
    const taskKeys = [
      "import", "motioncorr", "ctffind", "manualpick", "autopick", "extract",
      "select", "class2d", "initialmodel", "class3d", "refine3d", "maskcreate",
      "postprocess", "localres", "multibody", "polish", "movierefine", "external",
    ];
    const catalog = taskKeys.map((key) => {
      const task = getTask(key);
      return {
        key,
        name: task?.name || key,
        description: task?.description || "",
        parameters: task?.parameters || [],
        prereq: task?.prereq || [],
        outputs: task?.outputs || [],
        decisionHint: task?.decisionHint || "",
      };
    });
    return { taskCount: catalog.length, tasks: catalog };
  },
});

/**
 * All registered tools. Exported for the bridge to reference.
 */
export const RELION_STATE_TOOLS = [
  getProjectStateTool,
  getWorkflowJobsTool,
  getJobDetailsTool,
  getDecisionsTool,
  getRelionTaskCatalogTool,
];
