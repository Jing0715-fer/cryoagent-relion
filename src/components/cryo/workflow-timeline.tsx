"use client";

import { useEffect, useState } from "react";
import { Job } from "@/lib/types";
import { RELION_TASK_MAP } from "@/lib/relion/tasks";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

interface Props {
  jobs: Job[];
  onSelectJob: (id: string) => void;
  selectedJobId: string | null;
}

// CryoSPARC-style workflow timeline — shows each job as a horizontal bar
// with its duration, status color, and key metric. Clicking navigates to the
// job results page.
export function WorkflowTimeline({ jobs, onSelectJob, selectedJobId }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);

  if (!jobs.length) return null;

  const statusColor: Record<string, string> = {
    done: "bg-emerald-500",
    running: "bg-amber-400",
    queued: "bg-slate-600",
    failed: "bg-rose-500",
    skipped: "bg-slate-700",
  };
  const statusRing: Record<string, string> = {
    done: "border-emerald-500/40",
    running: "border-amber-400/50",
    queued: "border-slate-600/40",
    failed: "border-rose-500/40",
    skipped: "border-slate-700/30",
  };

  // find max duration for scaling (default 1s if all 0)
  const maxDuration = Math.max(1, ...jobs.map(j => j.duration || 1));

  return (
    <div className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/20">
        <Icon name="GitBranch" className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
          Pipeline timeline
        </span>
      </div>
      <div className="p-2 space-y-1">
        {jobs.map((j) => {
          const t = RELION_TASK_MAP[j.taskType];
          const isHovered = hovered === j.id;
          const isSelected = selectedJobId === j.id;
          const widthPct = Math.max(5, ((j.duration || 1) / maxDuration) * 100);
          return (
            <button
              key={j.id}
              onClick={() => onSelectJob(j.id)}
              onMouseEnter={() => setHovered(j.id)}
              onMouseLeave={() => setHovered(null)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md transition-all group",
                isHovered ? "bg-muted/30" : "",
                isSelected ? "ring-1 ring-emerald-400/40 bg-emerald-500/5" : "",
              )}
            >
              {/* icon */}
              <div className={cn(
                "shrink-0 h-6 w-6 rounded grid place-items-center bg-background/60",
                t?.color || "text-muted-foreground",
              )}>
                <Icon name={t?.icon || "Box"} className="h-3 w-3" />
              </div>
              {/* name */}
              <div className="shrink-0 w-24 text-[11px] font-medium truncate">
                {t?.short || j.taskType}
              </div>
              {/* duration bar */}
              <div className="flex-1 h-5 rounded bg-muted/30 overflow-hidden relative">
                <div
                  className={cn("h-full transition-all", statusColor[j.status] || "bg-slate-600")}
                  style={{ width: widthPct + "%" }}
                />
                <div className="absolute inset-0 flex items-center px-2">
                  <span className="text-[9px] font-mono text-white/80">
                    {j.status === "running" ? j.progress + "%" : j.duration > 0 ? j.duration + "s" : ""}
                  </span>
                </div>
              </div>
              {/* status badge */}
              <div className={cn(
                "shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded border capitalize",
                statusRing[j.status] || "border-slate-600/30",
                j.status === "done" && "text-emerald-400",
                j.status === "running" && "text-amber-400",
                j.status === "failed" && "text-rose-400",
                j.status === "queued" && "text-slate-400",
                j.status === "skipped" && "text-slate-500",
              )}>
                {j.status}
              </div>
              {/* key metric */}
              {j.status === "done" && j.outputSummary.resolution_A != null && (
                <span className="shrink-0 text-[10px] font-mono text-emerald-400 w-12 text-right">
                  {j.outputSummary.resolution_A} Å
                </span>
              )}
              {j.status === "done" && j.outputSummary.n_particles != null && j.outputSummary.resolution_A == null && (
                <span className="shrink-0 text-[10px] font-mono text-emerald-400 w-12 text-right">
                  {Number(j.outputSummary.n_particles).toLocaleString()} prt
                </span>
              )}
              {j.status === "done" && j.outputSummary.n_micrographs != null && j.outputSummary.resolution_A == null && j.outputSummary.n_particles == null && (
                <span className="shrink-0 text-[10px] font-mono text-emerald-400 w-12 text-right">
                  {Number(j.outputSummary.n_micrographs).toLocaleString()} mic
                </span>
              )}
              {(j.status !== "done" || (j.outputSummary.resolution_A == null && j.outputSummary.n_particles == null && j.outputSummary.n_micrographs == null)) && j.status !== "done" && (
                <span className="shrink-0 w-12" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
