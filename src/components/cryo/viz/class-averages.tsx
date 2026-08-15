"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GridSkeleton } from "./skeletons";

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
  const [classesMrcsPath, setClassesMrcsPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch analyze + job-files in parallel
        const [analyzeRes, filesRes] = await Promise.all([
          fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`).then(r => r.json()),
          fetch(`/api/job-files?projectId=${projectId}`).then(r => r.json()),
        ]);
        if (cancelled) return;
        setClasses(analyzeRes.modelClasses || []);
        setHasClassesMrcs(!!analyzeRes.hasClassesMrcs);
        setNParticles(analyzeRes.nParticles || 0);
        // Find the latest classes.mrcs path from the job-files response
        const group = (filesRes.groups || []).find((g: any) => g.jobId === jobId);
        if (group) {
          const classesFiles = (group.files || []).filter((f: any) => /_classes\.mrcs$/.test(f.path));
          if (classesFiles.length > 0) {
            // Sort by iteration number and take the latest
            classesFiles.sort((a: any, b: any) => {
              const aNum = parseInt(a.path.match(/run_it(\d+)_/)?.[1] || "0");
              const bNum = parseInt(b.path.match(/run_it(\d+)_/)?.[1] || "0");
              return aNum - bNum;
            });
            setClassesMrcsPath(classesFiles[classesFiles.length - 1].path);
          }
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

  if (loading) return <GridSkeleton count={10} />;
  if (!classes.length) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      No class data — class2d did not produce a model.star.
    </div>
  );

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
      {classesMrcsPath && (
        <div className="grid grid-cols-5 gap-1.5">
          {classes.slice(0, 25).map((c) => (
            <ClassThumb
              key={c.classNumber}
              projectId={projectId}
              mrcsPath={classesMrcsPath}
              cls={c}
            />
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

// Simple, reliable class thumbnail — sets the img src directly to the slice API
// URL and handles errors via onError. No pre-verification fetch needed.
function ClassThumb({ projectId, mrcsPath, cls }: {
  projectId: string;
  mrcsPath: string;
  cls: ModelClass;
}) {
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = `/api/slice?projectId=${projectId}&path=${encodeURIComponent(mrcsPath)}&z=${cls.classNumber - 1}`;

  return (
    <div className="relative aspect-square rounded bg-black border border-border/40 overflow-hidden group">
      {!error ? (
        <img
          src={src}
          alt={`class ${cls.classNumber}`}
          className="w-full h-full object-contain transition-opacity"
          style={{ opacity: loaded ? 1 : 0.3 }}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center text-[9px] text-muted-foreground p-1 text-center">
          No image
        </div>
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
