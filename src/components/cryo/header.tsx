"use client";

import { Icon } from "./icon";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Props {
  projectName: string;
  status: string;
  resolution: string | null;
  nJobs: number;
  nDone: number;
  taskCatalogCount: number;
  projectId: string | null;
  onExport?: () => void;
  exporting?: boolean;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  idle: { label: "Idle", color: "text-slate-400 border-slate-500/40" },
  planning: { label: "Planning", color: "text-amber-400 border-amber-500/50" },
  running: { label: "Running", color: "text-emerald-400 border-emerald-500/50" },
  paused: { label: "Paused", color: "text-slate-400 border-slate-500/40" },
  done: { label: "Complete", color: "text-emerald-300 border-emerald-600/50" },
  error: { label: "Error", color: "text-rose-400 border-rose-500/50" },
};

export function Header({ projectName, status, resolution, nJobs, nDone, taskCatalogCount, projectId, onExport, exporting }: Props) {
  const st = STATUS_LABEL[status] || STATUS_LABEL.idle;
  return (
    <header className="border-b border-border/60 bg-card/40 backdrop-blur cryo-grid-bg">
      <div className="flex items-center gap-3 px-4 h-14">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-md bg-gradient-to-br from-emerald-500/30 to-cyan-500/20 grid place-items-center border border-emerald-500/30">
            <Icon name="Microscope" className="h-4 w-4 text-emerald-300" />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight flex items-center gap-2">
              CryoAgent
              <span className="text-[10px] font-normal text-muted-foreground border border-border/60 rounded px-1 py-px">
                RELION
              </span>
            </div>
            <div className="text-[10px] text-muted-foreground leading-tight">
              autonomous cryo-EM pipeline agent
            </div>
          </div>
        </div>

        <div className="h-6 w-px bg-border/60 mx-1" />

        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate">{projectName}</div>
          <div className="text-[10px] text-muted-foreground">
            {nJobs > 0 ? `${nDone}/${nJobs} jobs done` : "no workflow yet"}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {resolution && (
            <Badge variant="outline" className="gap-1 border-emerald-500/40 text-emerald-300 font-mono">
              <Icon name="Ruler" className="h-3 w-3" />
              {resolution} Å
            </Badge>
          )}
          <Badge variant="outline" className="gap-1 border-border/60 text-muted-foreground">
            <Icon name="Boxes" className="h-3 w-3" />
            {taskCatalogCount} tasks
          </Badge>
          {projectId && nJobs > 0 && (
            <button
              onClick={onExport}
              disabled={exporting}
              className="flex items-center gap-1 text-[11px] rounded-md border border-border/60 bg-muted/30 hover:bg-emerald-500/10 hover:border-emerald-500/40 hover:text-emerald-300 px-2 py-1 text-muted-foreground transition-colors disabled:opacity-50"
              title="Download all project outputs as a .zip"
            >
              <Icon name={exporting ? "Loader2" : "Download"} className={cn("h-3 w-3", exporting && "animate-spin")} />
              {exporting ? "zipping…" : "Export"}
            </button>
          )}
          <Badge variant="outline" className={cn("gap-1 capitalize", st.color)}>
            {status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 cryo-pulse" />}
            {st.label}
          </Badge>
        </div>
      </div>
    </header>
  );
}
