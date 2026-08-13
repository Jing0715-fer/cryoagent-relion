"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";

interface ModelClass {
  classNumber: number;
  distribution: number;
  accuracyRotations: number;
  accuracyTranslations: number;
  estimatedResolution: number;
  fourierCompleteness: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// Class-averages gallery + per-class metrics table — CryoSPARC-style.
// Renders the 2D class averages from the _classes.mrcs stack as a grid of
// thumbnails, with a metrics table below (distribution, resolution, accuracy).
export function ClassAveragesGallery({ projectId, jobId }: Props) {
  const [classes, setClasses] = useState<ModelClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasClassesMrcs, setHasClassesMrcs] = useState(false);
  const [nParticles, setNParticles] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`);
        const d = await res.json();
        if (!cancelled) {
          setClasses(d.modelClasses || []);
          setHasClassesMrcs(!!d.hasClassesMrcs);
          setNParticles(d.nParticles || 0);
        }
      } catch {
        if (!cancelled) setClasses([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  if (loading) return <div className="text-xs text-muted-foreground p-4">Loading class averages…</div>;
  if (!classes.length) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      No class data — class2d did not produce a model.star.
    </div>
  );

  // find the job's primary output dir to construct the classes.mrcs path
  // (we look it up from the analyze result's jobId and rely on the API to
  // also return the classes mrcs path)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="text-[11px] text-muted-foreground">
          {nParticles} particles · {classes.length} classes
        </div>
        {hasClassesMrcs && (
          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300">
            classes.mrcs present
          </Badge>
        )}
      </div>

      {/* class averages thumbnails grid */}
      {hasClassesMrcs && (
        <div className="grid grid-cols-5 gap-1.5">
          {classes.slice(0, 25).map((c) => (
            <ClassThumb key={c.classNumber} projectId={projectId} jobId={jobId} cls={c} />
          ))}
        </div>
      )}

      {/* metrics table */}
      <div className="rounded-md border border-border/50 overflow-hidden">
        <table className="w-full text-[11px] font-mono">
          <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 text-left">Class</th>
              <th className="px-2 py-1.5 text-right">Particles</th>
              <th className="px-2 py-1.5 text-right">%</th>
              <th className="px-2 py-1.5 text-right">Res (Å)</th>
              <th className="px-2 py-1.5 text-right">Acc rot (°)</th>
              <th className="px-2 py-1.5 text-right">Acc trans (Å)</th>
            </tr>
          </thead>
          <tbody>
            {classes.slice(0, 25).map((c) => {
              const pct = nParticles > 0 ? (c.distribution * 100).toFixed(1) : "0";
              const nP = Math.round(c.distribution * nParticles);
              return (
                <tr key={c.classNumber} className="border-t border-border/30 hover:bg-muted/20">
                  <td className="px-2 py-1 text-emerald-300">#{c.classNumber}</td>
                  <td className="px-2 py-1 text-right">{nP}</td>
                  <td className="px-2 py-1 text-right">{pct}%</td>
                  <td className="px-2 py-1 text-right text-amber-300">
                    {c.estimatedResolution > 0 && c.estimatedResolution < 999 ? c.estimatedResolution.toFixed(1) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {c.accuracyRotations < 999 ? c.accuracyRotations.toFixed(2) : "—"}
                  </td>
                  <td className="px-2 py-1 text-right">
                    {c.accuracyTranslations < 999 ? c.accuracyTranslations.toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClassThumb({ projectId, jobId, cls }: { projectId: string; jobId: string; cls: ModelClass }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    // The classes.mrcs is a stack; ask the slice API for slice N
    // (we need to find the path first; we look it up by hitting /api/analyze
    // which already told us classesMrcs exists)
    async function load() {
      // The classes.mrcs is at <jobDir>/run_it<N>_classes.mrcs; we use the
      // /api/files?thumb=1 endpoint which renders the central slice. For a
      // stack, central slice == middle image. To show class N, we'd need a
      // per-index slice endpoint — use /api/slice with z=N.
      // First find the actual path:
      try {
        const res = await fetch(`/api/job-files?projectId=${projectId}`);
        const d = await res.json();
        const group = (d.groups || []).find((g: any) => g.jobId === jobId);
        if (!group) return;
        const classesFile = (group.files || []).find((f: any) => /_classes\.mrcs$/.test(f.path));
        if (!classesFile) return;
        const p = classesFile.path;
        setSrc(`/api/slice?projectId=${projectId}&path=${encodeURIComponent(p)}&z=${cls.classNumber - 1}`);
      } catch { /* ignore */ }
    }
    load();
  }, [projectId, jobId, cls.classNumber]);

  return (
    <div className="relative aspect-square rounded bg-black border border-border/40 overflow-hidden group">
      {src && (
        <img src={src} alt={`class ${cls.classNumber}`} className="w-full h-full object-contain" />
      )}
      <div className="absolute top-0.5 left-1 text-[9px] font-mono text-emerald-300 bg-black/60 rounded px-1">
        #{cls.classNumber}
      </div>
      <div className="absolute bottom-0.5 right-1 text-[8px] font-mono text-slate-300 bg-black/60 rounded px-1">
        {(cls.distribution * 100).toFixed(0)}%
      </div>
    </div>
  );
}
