"use client";

import { useEffect, useState } from "react";
import { Job, JobLog } from "@/lib/types";
import { RELION_TASK_MAP } from "@/lib/relion/tasks";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  job: Job | null;
}

const LOG_LEVEL_COLOR: Record<JobLog["level"], string> = {
  info: "text-slate-300",
  warn: "text-amber-400",
  error: "text-rose-400",
  success: "text-emerald-400",
};

export function JobDetail({ job }: Props) {
  if (!job) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground p-6">
        <div>
          <div className="mx-auto mb-3 h-11 w-11 rounded-full bg-muted/40 grid place-items-center">
            <Icon name="Terminal" className="h-5 w-5 text-muted-foreground" />
          </div>
          Select a job in the workflow to inspect its parameters, outputs and live log.
        </div>
      </div>
    );
  }
  return <JobDetailInner job={job} />;
}

function JobDetailInner({ job }: { job: Job }) {
  const [logs, setLogs] = useState<JobLog[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/jobs/${job.id}/logs`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setLogs(data.logs || []);
      } catch {
        if (!cancelled) setLogs([]);
      }
    }
    load();
    const timer = setInterval(load, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [job.id]);

  const t = RELION_TASK_MAP[job.taskType];

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={cn("h-8 w-8 rounded-md grid place-items-center bg-muted/40", t?.color)}>
            <Icon name={t?.icon || "Box"} className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{t?.name}</span>
              {job.alias && <Badge variant="secondary" className="text-[10px]">{job.alias}</Badge>}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">{job.id.slice(-12)}</div>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "capitalize",
              job.status === "running" && "border-emerald-500/50 text-emerald-400",
              job.status === "done" && "border-emerald-600/40 text-emerald-300",
              job.status === "failed" && "border-rose-500/50 text-rose-400",
              job.status === "queued" && "border-slate-500/40 text-slate-400",
            )}
          >
            {job.status}
          </Badge>
        </div>
        {job.status === "running" && (
          <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${job.progress}%` }} />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto cryo-scroll">
        {/* parameters */}
        <Section title="Parameters" icon="SlidersHorizontal">
          <dl className="grid grid-cols-1 gap-1">
            {Object.entries(job.parameters).slice(0, 14).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-[12px] py-0.5 border-b border-border/30 last:border-0">
                <dt className="font-mono text-muted-foreground shrink-0">--{k}</dt>
                <dd className="font-mono text-foreground text-right truncate">{String(v)}</dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* outputs */}
        {job.status === "done" && Object.keys(job.outputSummary).length > 0 && (
          <Section title="Outputs" icon="Package">
            <dl className="grid grid-cols-1 gap-1">
              {Object.entries(job.outputSummary).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 text-[12px] py-0.5 border-b border-border/30 last:border-0">
                  <dt className="text-muted-foreground shrink-0">{k}</dt>
                  <dd className="font-mono text-emerald-400 text-right">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </Section>
        )}

        {/* logs */}
        <Section title="Live log" icon="Terminal">
          <div className="rounded-md bg-black/60 border border-border/40 font-mono text-[11.5px] leading-relaxed p-3 min-h-[140px] max-h-[360px] overflow-y-auto log-scroll">
            {logs.length === 0 ? (
              <span className="text-slate-500">$ waiting for output…</span>
            ) : (
              logs.map((l) => (
                <div key={l.id} className={cn("whitespace-pre-wrap break-words", LOG_LEVEL_COLOR[l.level])}>
                  <span className="text-slate-600 select-none">{new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })} </span>
                  {l.line}
                </div>
              ))
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3 border-b border-border/40">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        <Icon name={icon} className="h-3 w-3" />
        {title}
      </div>
      {children}
    </div>
  );
}
