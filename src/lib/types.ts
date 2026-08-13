// Shared frontend types — mirror of the Prisma models (post-JSON-parse).

export interface Project {
  id: string;
  name: string;
  description: string;
  datasetMeta: Record<string, unknown>;
  sourceDataset: string;
  executorMode: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  _count?: { messages: number; workflows: number };
}

export interface Message {
  id: string;
  projectId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface Job {
  id: string;
  workflowId: string;
  taskType: string;
  alias: string;
  status: "queued" | "running" | "done" | "failed" | "skipped";
  progress: number;
  parameters: Record<string, string | number | boolean>;
  inputJobIds: string[];
  outputSummary: Record<string, number | string>;
  primaryOutput: string;
  outputFiles: { path: string; size: number }[];
  duration: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface Workflow {
  id: string;
  projectId: string;
  name: string;
  status: string;
  jobs: Job[];
  createdAt: string;
}

export interface Decision {
  id: string;
  projectId: string;
  jobId: string | null;
  kind: string;
  reason: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: string;
}

export interface JobLog {
  id: string;
  jobId: string;
  level: "info" | "warn" | "error" | "success";
  line: string;
  ts: string;
}
