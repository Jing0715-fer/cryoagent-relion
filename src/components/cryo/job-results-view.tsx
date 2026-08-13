"use client";

import { useEffect, useState } from "react";
import { Job, JobLog } from "@/lib/types";
import { RELION_TASK_MAP } from "@/lib/relion/tasks";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FscCurve } from "./viz/fsc-curve";
import { GuinierPlot } from "./viz/guinier-plot";
import { AngularHeatmap } from "./viz/angular-heatmap";
import { ClassAveragesGallery } from "./viz/class-averages";
import { ClassEssHistogram } from "./viz/class-ess-histogram";
import { MicrographGrid } from "./viz/micrograph-grid";
import { DefocusDistribution } from "./viz/defocus-distribution";
import { IterationProgress } from "./viz/iteration-progress";
import { PickingOverlay } from "./viz/picking-overlay";
import { CtfQualityScatter } from "./viz/ctf-quality-scatter";
import { SliceViewer } from "./viz/slice-viewer";
import { VolumeRenderer } from "./viz/volume-renderer";

interface Props {
  projectId: string;
  job: Job;
  onBack: () => void;
  onRetry?: (jobId: string) => void;
}

const LOG_LEVEL_COLOR: Record<JobLog["level"], string> = {
  info: "text-slate-300",
  warn: "text-amber-400",
  error: "text-rose-400",
  success: "text-emerald-400",
};

// A dedicated per-job results page: logs + parameters + outputs + the
// visualizations relevant to THIS job (not a global dashboard).
// Reached by clicking a job card in the workflow DAG.
export function JobResultsView({ projectId, job, onBack, onRetry }: Props) {
  const [logs, setLogs] = useState<JobLog[]>([]);
  const t = RELION_TASK_MAP[job.taskType];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/jobs/${job.id}/logs`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setLogs(data.logs || []);
      } catch { if (!cancelled) setLogs([]); }
    }
    load();
    const iv = setInterval(load, 2000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [job.id]);

  const hasViz =
    job.status === "done" &&
    (job.taskType === "import" ||
     job.taskType === "motioncorr" ||
     job.taskType === "ctffind" ||
     job.taskType === "autopick" ||
     job.taskType === "class2d" ||
     job.taskType === "class3d" ||
     job.taskType === "refine3d" ||
     job.taskType === "postprocess" ||
     job.taskType === "maskcreate" ||
     job.taskType === "initialmodel" ||
     job.taskType === "extract");

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* header */}
      <div className="border-b border-border/60 px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 h-8">
          <Icon name="ArrowLeft" className="h-4 w-4" />
          Workflow
        </Button>
        <div className={cn("h-9 w-9 rounded-md grid place-items-center bg-muted/40", t?.color)}>
          <Icon name={t?.icon || "Box"} className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{t?.name}</span>
            {job.alias && <Badge variant="secondary" className="text-[10px]">{job.alias}</Badge>}
            <Badge
              variant="outline"
              className={cn(
                "capitalize text-[10px]",
                job.status === "done" && "border-emerald-500/40 text-emerald-300",
                job.status === "running" && "border-amber-500/40 text-amber-300",
                job.status === "failed" && "border-rose-500/40 text-rose-400",
                job.status === "queued" && "border-slate-500/40 text-slate-400",
                job.status === "skipped" && "border-slate-600/40 text-slate-500",
              )}
            >
              {job.status === "running" && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 cryo-pulse mr-1" />}
              {job.status}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground font-mono">{job.id}</div>
        </div>
        {job.status === "running" && (
          <div className="w-40">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-amber-400 transition-all" style={{ width: `${job.progress}%` }} />
            </div>
            <div className="text-[10px] text-muted-foreground text-center mt-0.5">{job.progress}%</div>
          </div>
        )}
        {job.status === "failed" && onRetry && (
          <Button variant="outline" size="sm" onClick={() => onRetry(job.id)} className="gap-1.5 h-8">
            <Icon name="RotateCcw" className="h-3.5 w-3.5" />
            Retry
          </Button>
        )}
        {job.primaryOutput && (
          <Button variant="outline" size="sm" asChild className="gap-1.5 h-8">
            <a href={`/api/files?projectId=${projectId}&path=${encodeURIComponent(job.primaryOutput)}`} download>
              <Icon name="Download" className="h-3.5 w-3.5" />
              Primary output
            </a>
          </Button>
        )}
      </div>

      {/* body */}
      <div className="flex-1 min-h-0 overflow-y-auto cryo-scroll">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-3">
          {/* left: parameters + outputs + logs */}
          <div className="space-y-3">
            {/* picker method badge (for autopick jobs) */}
            {job.taskType === "autopick" && job.outputSummary?.method && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-orange-500/20 grid place-items-center">
                  <Icon name="Target" className="h-4 w-4 text-orange-400" />
                </div>
                <div>
                  <div className="text-[12px] font-medium">
                    Picking method: <span className="text-orange-400 capitalize">{String(job.outputSummary.method)}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {job.outputSummary.method === "topaz" && "Topaz deep-learning picker (pretrained resnet16)"}
                    {job.outputSummary.method === "log" && "RELION Laplacian-of-Gaussian blob detection"}
                    {job.outputSummary.method === "known" && "Known coordinates (fallback)"}
                  </div>
                </div>
              </div>
            )}

            {/* parameters */}
            <Section title="Parameters" icon="SlidersHorizontal">
              <dl className="grid grid-cols-1 gap-x-3">
                {Object.entries(job.parameters).slice(0, 16).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-[12px] py-0.5 border-b border-border/30 last:border-0">
                    <dt className="font-mono text-muted-foreground shrink-0">--{k}</dt>
                    <dd className="font-mono text-foreground text-right truncate">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </Section>

            {/* outputs */}
            {job.status === "done" && Object.keys(job.outputSummary).length > 0 && (
              <Section title="Output summary" icon="Package">
                <dl className="grid grid-cols-1 gap-x-3">
                  {Object.entries(job.outputSummary).map(([k, v]) => (
                    <div key={k} className="flex items-baseline justify-between gap-3 text-[12px] py-0.5 border-b border-border/30 last:border-0">
                      <dt className="text-muted-foreground shrink-0">{k}</dt>
                      <dd className="font-mono text-emerald-400 text-right">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </Section>
            )}

            {/* output files */}
            {job.outputFiles && job.outputFiles.length > 0 && (
              <Section title={`Output files (${job.outputFiles.length})`} icon="FolderOpen">
                <div className="space-y-0.5 max-h-48 overflow-y-auto log-scroll">
                  {job.outputFiles.slice(0, 30).map((f) => (
                    <div key={f.path} className="flex items-center gap-2 text-[11px] py-0.5 group">
                      <Icon name="File" className="h-3 w-3 text-muted-foreground shrink-0" />
                      <span className="font-mono truncate flex-1 text-muted-foreground">{f.path.split("/").pop()}</span>
                      <span className="text-[10px] text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                      <a
                        href={`/api/files?projectId=${projectId}&path=${encodeURIComponent(f.path)}`}
                        download
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Icon name="Download" className="h-3 w-3 text-muted-foreground hover:text-emerald-300" />
                      </a>
                    </div>
                  ))}
                  {job.outputFiles.length > 30 && (
                    <div className="text-[10px] text-muted-foreground px-1 py-1">
                      + {job.outputFiles.length - 30} more files
                    </div>
                  )}
                </div>
              </Section>
            )}

            {/* logs */}
            <Section title="Live log" icon="Terminal">
              <div className="rounded-md bg-black/60 border border-border/40 font-mono text-[11.5px] leading-relaxed p-3 max-h-[400px] overflow-y-auto log-scroll">
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

          {/* right: visualizations for THIS job */}
          <div className="space-y-3">
            {job.status === "done" && hasViz ? (
              <JobVisualizations projectId={projectId} job={job} />
            ) : job.status === "done" ? (
              <Section title="Visualizations" icon="BarChart3">
                <div className="text-[11px] text-muted-foreground p-4 text-center">
                  No specific visualizations for {t?.name}. The output files on the left are available for download.
                </div>
              </Section>
            ) : (
              <Section title="Visualizations" icon="BarChart3">
                <div className="text-[11px] text-muted-foreground p-4 text-center">
                  {job.status === "running"
                    ? "Visualizations will appear here once the job completes."
                    : job.status === "queued"
                    ? "This job is queued — waiting for upstream jobs to finish."
                    : "No visualizations available."}
                </div>
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// The visualizations relevant to a single job, rendered inline.
// Reference: CryoSPARC job result displays (guide.cryosparc.com)
function JobVisualizations({ projectId, job }: { projectId: string; job: Job }) {
  const t = RELION_TASK_MAP[job.taskType];
  const hasViz =
    ["import", "motioncorr", "ctffind", "autopick", "extract", "select",
     "class2d", "class3d", "refine3d", "maskcreate", "postprocess", "initialmodel"].includes(job.taskType);
  if (!hasViz) return null;
  return (
    <>
      <Section title={t?.name + " visualizations"} icon="BarChart3">
        <div className="space-y-4">
          {/* import / motioncorr: micrograph thumbnail grid */}
          {(job.taskType === "import" || job.taskType === "motioncorr") && (
            <div>
              <div className="text-[11px] text-muted-foreground mb-2">Micrograph preview (click to enlarge)</div>
              <MicrographGrid projectId={projectId} jobId={job.id} jobType={job.taskType} />
            </div>
          )}

          {/* ctffind: micrograph grid + defocus distribution + CTF quality scatter */}
          {job.taskType === "ctffind" && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-2">Micrographs with CTF fits (click to enlarge)</div>
                <MicrographGrid projectId={projectId} jobId={job.id} jobType={job.taskType} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">Defocus distribution</div>
                <DefocusDistribution projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">CTF fit quality (defocus vs resolution, colored by FOM)</div>
                <CtfQualityScatter projectId={projectId} jobId={job.id} />
              </div>
            </>
          )}

          {/* autopick: micrograph grid with picked particles overlay */}
          {job.taskType === "autopick" && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-2">Particle picking overlay (green circles = picked particles)</div>
                <PickingOverlay projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">Micrograph preview</div>
                <MicrographGrid projectId={projectId} jobId={job.id} jobType={job.taskType} />
              </div>
            </>
          )}

          {/* extract: micrograph grid + angular heatmap */}
          {job.taskType === "extract" && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-2">Extracted particles (micrograph preview)</div>
                <MicrographGrid projectId={projectId} jobId={job.id} jobType={job.taskType} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">Angular distribution (ground-truth orientations)</div>
                <AngularHeatmap projectId={projectId} jobId={job.id} />
              </div>
            </>
          )}

          {/* class2d / class3d: class averages + iteration progress + ESS + angular */}
          {(job.taskType === "class2d" || job.taskType === "class3d") && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-2">Iteration progress (log-likelihood convergence)</div>
                <IterationProgress projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">2D class averages (click a class to inspect)</div>
                <ClassAveragesGallery projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">Class ESS & probability histograms</div>
                <ClassEssHistogram projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">Angular distribution</div>
                <AngularHeatmap projectId={projectId} jobId={job.id} />
              </div>
            </>
          )}

          {/* refine3d: angular heatmap + 3D volume */}
          {job.taskType === "refine3d" && job.primaryOutput && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-2">Angular distribution</div>
                <AngularHeatmap projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-2">3D refined map</div>
                <VolumeRenderer projectId={projectId} path={job.primaryOutput} label={job.primaryOutput.split("/").pop()} />
              </div>
            </>
          )}

          {/* postprocess: FSC + Guinier + 3D volume */}
          {job.taskType === "postprocess" && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">FSC curve</div>
                <FscCurve projectId={projectId} jobId={job.id} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-1">Guinier plot (B-factor)</div>
                <GuinierPlot projectId={projectId} jobId={job.id} />
              </div>
              {job.primaryOutput && (
                <div className="border-t border-border/30 pt-3">
                  <div className="text-[11px] text-muted-foreground mb-1">3D volume</div>
                  <VolumeRenderer projectId={projectId} path={job.primaryOutput} label={job.primaryOutput.split("/").pop()} />
                </div>
              )}
            </>
          )}

          {/* maskcreate / initialmodel: slice viewer + 3D volume */}
          {(job.taskType === "maskcreate" || job.taskType === "initialmodel") && job.primaryOutput && (
            <>
              <div>
                <div className="text-[11px] text-muted-foreground mb-1">3D volume</div>
                <VolumeRenderer projectId={projectId} path={job.primaryOutput} label={job.primaryOutput.split("/").pop()} />
              </div>
              <div className="border-t border-border/30 pt-3">
                <div className="text-[11px] text-muted-foreground mb-1">z-slice viewer</div>
                <SliceViewer projectId={projectId} path={job.primaryOutput} label={job.primaryOutput.split("/").pop()} />
              </div>
            </>
          )}
        </div>
      </Section>
    </>
  );
}

function Section({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/20">
        <Icon name={icon} className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">{title}</span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
