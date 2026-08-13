"use client";

import { useMemo } from "react";
import { Job } from "@/lib/types";
import { RELION_TASK_MAP } from "@/lib/relion/tasks";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

interface Props {
  jobs: Job[];
  selectedJobId: string | null;
  onSelectJob: (id: string) => void;
}

const STATUS_STYLE: Record<Job["status"], { ring: string; dot: string; label: string }> = {
  queued: { ring: "border-slate-600/60 bg-slate-800/40", dot: "bg-slate-400", label: "Queued" },
  running: { ring: "border-emerald-400/70 bg-emerald-500/10", dot: "bg-emerald-400 cryo-pulse", label: "Running" },
  done: { ring: "border-emerald-500/40 bg-emerald-500/5", dot: "bg-emerald-500", label: "Done" },
  failed: { ring: "border-rose-500/60 bg-rose-500/10", dot: "bg-rose-500", label: "Failed" },
  skipped: { ring: "border-slate-700/40 bg-slate-900/40", dot: "bg-slate-600", label: "Skipped" },
};

const NODE_W = 196;
const NODE_H = 84;
const COL_GAP = 96;
const ROW_GAP = 22;
const PAD = 24;

export function WorkflowDag({ jobs, selectedJobId, onSelectJob }: Props) {
  const layout = useMemo(() => {
    // Assign each job to a column by its task stage.
    const cols: Record<number, Job[]> = {};
    for (const j of jobs) {
      const t = RELION_TASK_MAP[j.taskType];
      const stage = t?.stage ?? 5;
      (cols[stage] ||= []).push(j);
    }
    const stages = Object.keys(cols).map(Number).sort((a, b) => a - b);
    const pos = new Map<string, { x: number; y: number; col: number; row: number }>();
    let maxX = 0, maxY = 0;
    stages.forEach((stage, ci) => {
      const colJobs = cols[stage];
      colJobs.forEach((j, ri) => {
        const x = PAD + ci * (NODE_W + COL_GAP);
        const y = PAD + ri * (NODE_H + ROW_GAP);
        pos.set(j.id, { x, y, col: ci, row: ri });
        maxX = Math.max(maxX, x + NODE_W);
        maxY = Math.max(maxY, y + NODE_H);
      });
    });
    // edges: each job -> its inputJobIds
    const edges = jobs.flatMap((j) =>
      j.inputJobIds
        .filter((id) => pos.has(id))
        .map((fromId) => ({ from: fromId, to: j.id })),
    );
    return { pos, edges, width: maxX + PAD, height: maxY + PAD };
  }, [jobs]);

  if (jobs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground p-8">
        <div>
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-muted/40 grid place-items-center">
            <Icon name="Workflow" className="h-6 w-6 text-muted-foreground" />
          </div>
          No workflow yet. Describe your cryo-EM dataset in the chat and the agent will
          plan a RELION pipeline here.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto cryo-scroll">
      <svg
        width={layout.width}
        height={layout.height}
        className="block"
        style={{ minWidth: "100%" }}
      >
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="oklch(0.55 0 0)" />
          </marker>
          <marker id="arrow-active" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="oklch(0.7 0.18 150)" />
          </marker>
        </defs>

        {/* edges */}
        {layout.edges.map((e, i) => {
          const from = layout.pos.get(e.from)!;
          const to = layout.pos.get(e.to)!;
          const fromJob = jobs.find((j) => j.id === e.from)!;
          const toJob = jobs.find((j) => j.id === e.to)!;
          const isActive = fromJob.status === "done" && toJob.status === "running";
          const isDone = fromJob.status === "done" && (toJob.status === "done" || toJob.status === "skipped");
          const x1 = from.x + NODE_W;
          const y1 = from.y + NODE_H / 2;
          const x2 = to.x;
          const y2 = to.y + NODE_H / 2;
          const mx = (x1 + x2) / 2;
          const path = `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
          return (
            <path
              key={i}
              d={path}
              fill="none"
              stroke={isActive ? "oklch(0.7 0.18 150)" : isDone ? "oklch(0.55 0.12 150)" : "oklch(0.4 0 0)"}
              strokeWidth={isActive ? 2 : 1.4}
              className={isActive ? "cryo-edge-running" : ""}
              markerEnd={`url(#${isActive ? "arrow-active" : "arrow"})`}
              opacity={isDone ? 0.55 : 1}
            />
          );
        })}

        {/* nodes */}
        {jobs.map((j) => {
          const t = RELION_TASK_MAP[j.taskType];
          const p = layout.pos.get(j.id)!;
          const st = STATUS_STYLE[j.status];
          const selected = j.id === selectedJobId;
          return (
            <foreignObject
              key={j.id}
              x={p.x}
              y={p.y}
              width={NODE_W}
              height={NODE_H}
              className="cryo-node"
            >
              <button
                onClick={() => onSelectJob(j.id)}
                className={cn(
                  "w-full h-full rounded-lg border text-left px-3 py-2 backdrop-blur-sm",
                  "flex flex-col gap-1.5 hover:shadow-lg hover:shadow-black/30",
                  st.ring,
                  selected && "ring-2 ring-offset-2 ring-offset-background ring-emerald-400",
                )}
              >
                <div className="flex items-center gap-2">
                  <div className={cn("shrink-0 h-7 w-7 rounded-md grid place-items-center bg-background/60", t?.color)}>
                    <Icon name={t?.icon || "Box"} className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium leading-tight truncate text-foreground">
                      {t?.short || j.taskType}
                    </div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {t?.category}
                    </div>
                  </div>
                  <span className={cn("h-2 w-2 rounded-full", st.dot)} />
                </div>

                {/* progress bar */}
                <div className="h-1.5 w-full rounded-full bg-background/60 overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      j.status === "done" ? "bg-emerald-500" :
                      j.status === "running" ? "bg-emerald-400" :
                      j.status === "failed" ? "bg-rose-500" : "bg-slate-600",
                    )}
                    style={{ width: `${j.status === "done" ? 100 : j.progress}%` }}
                  />
                </div>

                {/* status + key metric */}
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{st.label}</span>
                  {j.status === "done" && j.outputSummary.resolution_A != null && (
                    <span className="font-mono text-emerald-400">{j.outputSummary.resolution_A} Å</span>
                  )}
                  {j.status === "running" && (
                    <span className="font-mono text-emerald-400">{j.progress}%</span>
                  )}
                  {j.status === "done" && j.outputSummary.method != null && (
                    <span className="font-mono text-orange-400 capitalize">{String(j.outputSummary.method)}</span>
                  )}
                  {j.status === "done" && j.outputSummary.n_particles != null && j.outputSummary.method == null && (
                    <span className="font-mono text-emerald-400">
                      {Number(j.outputSummary.n_particles).toLocaleString()} prt
                    </span>
                  )}
                  {j.status === "done" && j.outputSummary.n_micrographs != null && j.outputSummary.resolution_A == null && j.outputSummary.method == null && (
                    <span className="font-mono text-emerald-400">
                      {Number(j.outputSummary.n_micrographs).toLocaleString()} mic
                    </span>
                  )}
                </div>
              </button>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
