"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { FscCurve } from "./viz/fsc-curve";
import { AngularHeatmap } from "./viz/angular-heatmap";
import { ClassAveragesGallery } from "./viz/class-averages";
import { SliceViewer } from "./viz/slice-viewer";
import { RELION_TASK_MAP } from "@/lib/relion/tasks";

interface VizGroup {
  jobId: string;
  taskType: string;
  status: string;
  primaryOutput: string;
  files: { path: string; size: number }[];
}

interface Props {
  projectId: string;
  refreshKey: number;
}

// CryoSPARC-style results dashboard. Pulls the per-job output file lists and
// renders the appropriate visualization for each job type:
//   - class2d / class3d: class-averages gallery + per-class metrics table +
//                       angular distribution heatmap
//   - refine3d:        angular distribution heatmap + slice viewer of the map
//   - postprocess:      FSC curve + slice viewer of the sharpened map
//   - maskcreate:       slice viewer of the mask
export function VisualizationsDashboard({ projectId, refreshKey }: Props) {
  const [groups, setGroups] = useState<VizGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/job-files?projectId=${projectId}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setGroups(data.groups || []);
      } catch {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 3000);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId, refreshKey]);

  if (loading) return <div className="p-4 text-sm text-muted-foreground">Loading visualizations…</div>;

  // find jobs that have visualizations
  const class2d = groups.find((g) => g.taskType === "class2d" && g.status === "done");
  const class3d = groups.find((g) => g.taskType === "class3d" && g.status === "done");
  const refine3d = groups.find((g) => g.taskType === "refine3d" && g.status === "done");
  const postprocess = groups.find((g) => g.taskType === "postprocess" && g.status === "done");
  const maskcreate = groups.find((g) => g.taskType === "maskcreate" && g.status === "done");
  const initialmodel = groups.find((g) => g.taskType === "initialmodel" && g.status === "done");

  const hasAny = class2d || class3d || refine3d || postprocess || maskcreate;

  if (!hasAny) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground p-8">
        <div>
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-muted/40 grid place-items-center">
            <Icon name="BarChart3" className="h-6 w-6 text-muted-foreground" />
          </div>
          No visualizations yet. Visualizations (FSC curve, angular distribution, class averages, map slices) appear here once class2d, refine3d, maskcreate or postprocess complete.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto cryo-scroll p-3 space-y-3">
      {/* class2d gallery */}
      {class2d && (
        <VizCard title="2D class averages" taskType="class2d" jobId={class2d.jobId} icon="Layers">
          <ClassAveragesGallery projectId={projectId} jobId={class2d.jobId} />
        </VizCard>
      )}

      {/* angular distribution (from class2d or refine3d) */}
      {(class2d || refine3d) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {(class2d || refine3d) && (
            <VizCard title="Angular distribution" taskType={(refine3d || class2d)!.taskType} jobId={(refine3d || class2d)!.jobId} icon="Compass">
              <AngularHeatmap projectId={projectId} jobId={(refine3d || class2d)!.jobId} />
            </VizCard>
          )}

          {/* postprocess FSC */}
          {postprocess && (
            <VizCard title="FSC curve" taskType="postprocess" jobId={postprocess.jobId} icon="TrendingUp">
              <FscCurve projectId={projectId} jobId={postprocess.jobId} />
            </VizCard>
          )}
        </div>
      )}

      {/* map slices */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {maskcreate && maskcreate.primaryOutput && (
          <VizCard title="Mask (3D)" taskType="maskcreate" jobId={maskcreate.jobId} icon="Hexagon">
            <SliceViewer projectId={projectId} path={maskcreate.primaryOutput} label={maskcreate.primaryOutput.split("/").pop()} />
          </VizCard>
        )}
        {postprocess && postprocess.primaryOutput && (
          <VizCard title="Postprocessed map" taskType="postprocess" jobId={postprocess.jobId} icon="Sparkles">
            <SliceViewer projectId={projectId} path={postprocess.primaryOutput} label={postprocess.primaryOutput.split("/").pop()} />
          </VizCard>
        )}
        {initialmodel && initialmodel.primaryOutput && (
          <VizCard title="Initial model" taskType="initialmodel" jobId={initialmodel.jobId} icon="Box">
            <SliceViewer projectId={projectId} path={initialmodel.primaryOutput} label={initialmodel.primaryOutput.split("/").pop()} />
          </VizCard>
        )}
        {refine3d && refine3d.primaryOutput && (
          <VizCard title="Refined map" taskType="refine3d" jobId={refine3d.jobId} icon="Focus">
            <SliceViewer projectId={projectId} path={refine3d.primaryOutput} label={refine3d.primaryOutput.split("/").pop()} />
          </VizCard>
        )}
      </div>

      {/* fallback: reference.mrc slice viewer (always available for the test dataset) */}
      {!postprocess && !refine3d && !initialmodel && !maskcreate && (
        <VizCard title="Reference map (no postprocess yet)" taskType="import" jobId="" icon="Box">
          <ReferenceMapViewer projectId={projectId} />
        </VizCard>
      )}
    </div>
  );
}

function VizCard({ title, taskType, jobId, icon, children }: {
  title: string; taskType: string; jobId: string; icon: string; children: React.ReactNode;
}) {
  const t = RELION_TASK_MAP[taskType];
  return (
    <div className="rounded-lg border border-border/50 bg-card/40 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/20">
        <div className={cn("h-6 w-6 rounded grid place-items-center bg-background/60", t?.color || "text-muted-foreground")}>
          <Icon name={icon} className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium">{title}</div>
          <div className="text-[10px] text-muted-foreground font-mono">{jobId ? `job ${jobId.slice(-6)}` : "—"}</div>
        </div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// Fallback: show the dataset's reference.mrc when no map jobs have completed.
function ReferenceMapViewer({ projectId }: { projectId: string }) {
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/projects`);
        const data = await res.json();
        const project = (data.projects || []).find((p: any) => p.id === projectId);
        if (project?.sourceDataset) {
          // reference.mrc lives at <sourceDataset>/reference.mrc; we can't serve
          // files outside data/projects/, so we fall back to the postprocess
          // fallback map that was written by the runner.
          setPath(null);
        }
      } catch { /* ignore */ }
    }
    load();
  }, [projectId]);
  if (!path) return <div className="text-[11px] text-muted-foreground p-2">No map available yet.</div>;
  return <SliceViewer projectId={projectId} path={path} label="reference.mrc" />;
}
