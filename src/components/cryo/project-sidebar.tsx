"use client";

import { Project, Decision } from "@/lib/types";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  projects: Project[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  decisions: Decision[];
}

const STATUS_COLOR: Record<string, string> = {
  idle: "bg-slate-500",
  planning: "bg-amber-400 cryo-pulse",
  running: "bg-emerald-400 cryo-pulse",
  paused: "bg-slate-400",
  done: "bg-emerald-500",
  error: "bg-rose-500",
};

export function ProjectSidebar({ projects, selectedId, onSelect, onNew, decisions }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3 border-b border-border/60">
        <Button onClick={onNew} className="w-full gap-2" size="sm">
          <Icon name="Plus" className="h-4 w-4" />
          New project
        </Button>
      </div>

      {/* projects */}
      <div className="px-2 py-2">
        <div className="px-2 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Projects
        </div>
        <div className="space-y-0.5 max-h-[40%] overflow-y-auto cryo-scroll pr-1">
          {projects.length === 0 && (
            <div className="text-[11px] text-muted-foreground px-2 py-3">
              No projects yet.
            </div>
          )}
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              className={cn(
                "w-full text-left px-2 py-1.5 rounded-md text-[12px] flex items-center gap-2 transition-colors",
                p.id === selectedId
                  ? "bg-emerald-500/15 text-foreground"
                  : "hover:bg-muted/50 text-muted-foreground",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", STATUS_COLOR[p.status] || "bg-slate-500")} />
              <span className="truncate flex-1">{p.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* decisions log */}
      <div className="flex-1 min-h-0 border-t border-border/60 px-2 py-2 flex flex-col">
        <div className="px-2 mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          <Icon name="Compass" className="h-3 w-3" />
          Autonomous decisions
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto cryo-scroll pr-1 space-y-1.5">
          {decisions.length === 0 ? (
            <div className="text-[11px] text-muted-foreground px-2 py-3">
              The agent will record its decisions here as the pipeline runs.
            </div>
          ) : (
            decisions.map((d) => (
              <div key={d.id} className="rounded-md border border-border/50 bg-muted/20 px-2 py-1.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    {d.kind}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {new Date(d.createdAt).toLocaleTimeString("en-US", { hour12: false })}
                  </span>
                </div>
                <div className="text-[11px] text-foreground/90 leading-snug">{d.reason}</div>
                {d.action && (
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">→ {d.action}</div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
