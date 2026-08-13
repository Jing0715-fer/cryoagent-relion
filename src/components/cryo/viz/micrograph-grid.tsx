"use client";

import { useEffect, useState } from "react";
import { Icon } from "../icon";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeletons";

interface MicrographInfo {
  name: string;
  path: string;
  defocus?: number;
  resolution?: number;
  fom?: number;
}

interface Props {
  projectId: string;
  jobId: string;
  jobType: string;
}

// CryoSPARC-style micrograph thumbnail grid — shows corrected micrographs
// (motioncorr) or CTF-fit micrographs (ctffind) with per-micrograph metrics.
// For import jobs, searches ALL jobs in the project for .mrc files since
// the import job itself only outputs a .star file.
export function MicrographGrid({ projectId, jobId, jobType }: Props) {
  const [micrographs, setMicrographs] = useState<MicrographInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/job-files?projectId=${projectId}`);
        const d = await res.json();
        const allGroups = d.groups || [];
        // Search ALL jobs for .mrc micrograph files (not just this job)
        // because import outputs a .star, not .mrc files directly.
        const allMrcs: MicrographInfo[] = [];
        const seen = new Set<string>();
        for (const g of allGroups) {
          if (!g.files) continue;
          for (const f of g.files) {
            if (/\.mrc$/.test(f.path) && !/Particles\//.test(f.path) && !/CtfFind\//.test(f.path)) {
              const name = f.path.split("/").pop();
              if (!seen.has(name)) {
                seen.add(name);
                allMrcs.push({ name, path: f.path });
              }
            }
          }
        }
        if (!cancelled) setMicrographs(allMrcs);
      } catch { if (!cancelled) setMicrographs([]); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  if (loading) return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
      {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="aspect-square" />)}
    </div>
  );
  if (!micrographs.length) return (
    <div className="text-xs text-muted-foreground p-3 text-center">
      No micrograph files found. The imported data may be in movie format (.mrcs) —
      micrograph thumbnails will appear after motion correction.
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {micrographs.slice(0, 20).map((m) => (
          <button
            key={m.path}
            onClick={() => setSelected(selected === m.path ? null : m.path)}
            className={cn(
              "relative aspect-square rounded-md overflow-hidden border bg-black group transition-all",
              selected === m.path ? "border-emerald-400 ring-1 ring-emerald-400" : "border-border/40 hover:border-emerald-500/40",
            )}
          >
            <img
              src={`/api/files?projectId=${projectId}&path=${encodeURIComponent(m.path)}&thumb=1`}
              alt={m.name}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-[8px] font-mono text-slate-300 truncate px-1 py-0.5">
              {m.name}
            </div>
          </button>
        ))}
      </div>
      {micrographs.length > 20 && (
        <div className="text-[10px] text-muted-foreground">+ {micrographs.length - 20} more</div>
      )}
      {selected && (
        <div className="rounded-lg border border-emerald-500/30 bg-black overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/30 bg-muted/20">
            <span className="text-[11px] font-mono text-emerald-300">{micrographs.find(m => m.path === selected)?.name}</span>
            <button onClick={() => setSelected(null)} className="text-muted-foreground hover:text-foreground">
              <Icon name="X" className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="p-2">
            <img
              src={`/api/files?projectId=${projectId}&path=${encodeURIComponent(selected)}&thumb=1`}
              alt="micrograph preview"
              className="w-full max-h-[400px] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
