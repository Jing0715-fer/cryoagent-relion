"use client";

import { useEffect, useState } from "react";
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
  const [relionStatus, setRelionStatus] = useState<{ installed: boolean; version: string; installing: boolean }>({
    installed: false,
    version: "",
    installing: false,
  });

  // Check RELION installation status on mount
  useEffect(() => {
    let cancelled = false;
    async function checkStatus() {
      try {
        const res = await fetch("/api/install-relion");
        const d = await res.json();
        if (!cancelled) {
          setRelionStatus(prev => ({ ...prev, installed: d.installed, version: d.version }));
        }
      } catch {}
    }
    checkStatus();
    // Poll every 10s if installing
    const interval = setInterval(() => {
      if (relionStatus.installing) checkStatus();
    }, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [relionStatus.installing]);

  async function installRelion() {
    setRelionStatus(prev => ({ ...prev, installing: true }));
    try {
      const res = await fetch("/api/install-relion", { method: "POST" });
      const d = await res.json();
      if (d.ok) {
        // Poll for completion
        const poll = setInterval(async () => {
          try {
            const check = await fetch("/api/install-relion");
            const status = await check.json();
            if (status.installed) {
              clearInterval(poll);
              setRelionStatus({ installed: true, version: status.version, installing: false });
            }
          } catch {}
        }, 15000); // check every 15s
        // Stop polling after 15 min
        setTimeout(() => clearInterval(poll), 900000);
      }
    } catch (e) {
      setRelionStatus(prev => ({ ...prev, installing: false }));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3 border-b border-border/60 space-y-2">
        <Button onClick={onNew} className="w-full gap-2" size="sm">
          <Icon name="Plus" className="h-4 w-4" />
          New project
        </Button>
        {/* RELION installation status */}
        <div className={cn(
          "rounded-md border px-2.5 py-2 text-[10px]",
          relionStatus.installed
            ? "border-emerald-500/30 bg-emerald-500/5"
            : relionStatus.installing
            ? "border-amber-500/30 bg-amber-500/5"
            : "border-border/50 bg-muted/30"
        )}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Icon name="Package" className="h-3 w-3 shrink-0" />
              <span className="font-medium text-muted-foreground">RELION</span>
            </div>
            {relionStatus.installed ? (
              <span className="text-emerald-300 font-mono text-[9px]">
                {relionStatus.version.includes("5.") ? "5.0 ✓" : "3.1 ✓"}
              </span>
            ) : relionStatus.installing ? (
              <span className="text-amber-300 flex items-center gap-1 text-[9px]">
                <Icon name="Loader2" className="h-2.5 w-2.5 animate-spin" />
                building...
              </span>
            ) : (
              <button
                onClick={installRelion}
                className="text-sky-300 hover:text-sky-200 font-medium text-[9px] flex items-center gap-0.5"
              >
                <Icon name="Download" className="h-2.5 w-2.5" />
                install 5.0
              </button>
            )}
          </div>
          {relionStatus.installing && (
            <div className="text-[8px] text-muted-foreground mt-1">
              Building from source (~5-10 min). Check relion5-install.log
            </div>
          )}
        </div>
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
            decisions.map((d) => {
              const isVerify = d.kind === "verify";
              const isPass = isVerify && d.action === "pass";
              const isFail = isVerify && d.action === "fail";
              const isRetry = d.kind === "retry" || (d.meta && typeof d.meta === "object" && (d.meta as any).kind === "job-retry");
              const isNextJob = d.kind === "next-job-planned";
              const badgeColor = isPass
                ? "bg-emerald-500/20 text-emerald-300"
                : isFail
                ? "bg-rose-500/20 text-rose-300"
                : isRetry
                ? "bg-amber-500/20 text-amber-300"
                : isNextJob
                ? "bg-sky-500/20 text-sky-300"
                : "bg-amber-500/20 text-amber-300";
              return (
                <div
                  key={d.id}
                  className={cn(
                    "rounded-md border px-2 py-1.5",
                    isFail ? "border-rose-500/30 bg-rose-500/5" : isPass ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/50 bg-muted/20",
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={cn("text-[9px] uppercase tracking-wider px-1 py-0.5 rounded", badgeColor)}>
                      {isPass ? "✓ pass" : isFail ? "✗ fail" : d.kind}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {new Date(d.createdAt).toLocaleTimeString("en-US", { hour12: false })}
                    </span>
                  </div>
                  <div className="text-[11px] text-foreground/90 leading-snug">{d.reason}</div>
                  {d.action && !isVerify && (
                    <div className="text-[10px] text-muted-foreground font-mono mt-0.5">→ {d.action}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
