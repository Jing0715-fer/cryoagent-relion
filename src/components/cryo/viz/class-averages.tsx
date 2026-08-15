"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { GridSkeleton } from "./skeletons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "../icon";

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
//
// Features:
// - Iteration selector: view any completed iteration's class averages
// - Live polling: auto-refreshes every 5s while class2d is running
export function ClassAveragesGallery({ projectId, jobId }: Props) {
  const [classes, setClasses] = useState<ModelClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasClassesMrcs, setHasClassesMrcs] = useState(false);
  const [nParticles, setNParticles] = useState(0);
  const [classesMrcsPath, setClassesMrcsPath] = useState<string | null>(null);
  const [allClassesFiles, setAllClassesFiles] = useState<{ path: string; iter: number }[]>([]);
  const [selectedIter, setSelectedIter] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("done");

  const load = useCallback(async () => {
    try {
      const [analyzeRes, filesRes] = await Promise.all([
        fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/job-files?projectId=${projectId}`).then(r => r.ok ? r.json() : null),
      ]);
      if (!analyzeRes || !filesRes) return;

      setClasses(analyzeRes.modelClasses || []);
      setHasClassesMrcs(!!analyzeRes.hasClassesMrcs);
      setNParticles(analyzeRes.nParticles || 0);

      // Find ALL classes.mrcs files (one per iteration)
      const group = (filesRes.groups || []).find((g: any) => g.jobId === jobId);
      if (group) {
        setJobStatus(group.status || "done");
        const classesFiles = (group.files || [])
          .filter((f: any) => /_classes\.mrcs$/.test(f.path))
          .map((f: any) => ({
            path: f.path,
            iter: parseInt(f.path.match(/run_it(\d+)_/)?.[1] || "0"),
          }))
          .sort((a: any, b: any) => a.iter - b.iter);
        setAllClassesFiles(classesFiles);

        // Select the latest iteration (or keep user's selection)
        if (classesFiles.length > 0) {
          const latest = classesFiles[classesFiles.length - 1];
          if (selectedIter === null || selectedIter === -1) {
            setSelectedIter(latest.iter);
            setClassesMrcsPath(latest.path);
          } else {
            const found = classesFiles.find((f: any) => f.iter === selectedIter);
            if (found) setClassesMrcsPath(found.path);
            else { setSelectedIter(latest.iter); setClassesMrcsPath(latest.path); }
          }
        }
      }
    } catch {
      // transient — retry on next poll
    } finally {
      setLoading(false);
    }
  }, [projectId, jobId, selectedIter]);

  useEffect(() => {
    load();
    // Poll every 5s while job is running, otherwise poll once more then stop
    const iv = setInterval(() => {
      if (jobStatus === "running" || jobStatus === "queued") {
        load();
      }
    }, 5000);
    return () => clearInterval(iv);
  }, [load, jobStatus]);

  // Update classesMrcsPath when iteration changes
  useEffect(() => {
    if (selectedIter !== null && allClassesFiles.length > 0) {
      const found = allClassesFiles.find(f => f.iter === selectedIter);
      if (found) setClassesMrcsPath(found.path);
    }
  }, [selectedIter, allClassesFiles]);

  if (loading) return <GridSkeleton count={10} />;
  if (!classes.length && !allClassesFiles.length) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      No class data — class2d did not produce a model.star yet.
      {jobStatus === "running" && <span className="text-emerald-400"> Running, waiting for first iteration...</span>}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Header: particle count + iteration selector */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] text-muted-foreground">
          {nParticles} particles · {classes.length} classes
        </div>
        <div className="flex items-center gap-2">
          {jobStatus === "running" && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300 animate-pulse">
              <Icon name="Loader2" className="h-2.5 w-2.5 mr-1 animate-spin" />
              live
            </Badge>
          )}
          {hasClassesMrcs && (
            <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-300">
              classes.mrcs
            </Badge>
          )}
          {allClassesFiles.length > 0 && (
            <Select
              value={String(selectedIter ?? -1)}
              onValueChange={(v) => setSelectedIter(v === "-1" ? null : parseInt(v))}
            >
              <SelectTrigger className="h-7 w-[140px] text-[11px]">
                <SelectValue placeholder="Iteration" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="-1" className="text-[11px]">Latest</SelectItem>
                {allClassesFiles.map((f) => (
                  <SelectItem key={f.iter} value={String(f.iter)} className="text-[11px]">
                    Iteration {f.iter}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
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
