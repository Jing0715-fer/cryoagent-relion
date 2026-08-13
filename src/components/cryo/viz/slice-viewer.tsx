"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  projectId: string;
  path: string;          // path to an .mrc file (3D map)
  label?: string;
}

// Slice viewer for 3D MRC maps — CryoSPARC-style.
// Lets the user scrub through z-slices of a 3D density map.
// Server-side: /api/slice?projectId=...&path=...&z=NN renders slice NN as PNG.
export function SliceViewer({ projectId, path, label }: Props) {
  const [z, setZ] = useState(50); // 0..100 percent
  const [depth, setDepth] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imgKey, setImgKey] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);

  // First call: get the depth (Z dimension) of the map via /api/slice?probe=1
  useEffect(() => {
    let cancelled = false;
    async function probe() {
      try {
        const res = await fetch(`/api/slice?projectId=${projectId}&path=${encodeURIComponent(path)}&probe=1`);
        const d = await res.json();
        if (!cancelled) {
          if (d.depth) {
            setDepth(d.depth);
            setZ(Math.floor(d.depth / 2));
          } else {
            setError(d.error || "could not read map");
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    probe();
    return () => { cancelled = true; };
  }, [projectId, path]);

  // refresh the image when z changes
  useEffect(() => {
    setImgKey((k) => k + 1);
  }, [z, projectId, path]);

  if (loading) return <div className="text-xs text-muted-foreground p-4">Probing map dimensions…</div>;
  if (error || !depth) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      {error || "No 3D map available."}
    </div>
  );

  const zIdx = Math.floor((z / 100) * (depth - 1));
  const src = `/api/slice?projectId=${projectId}&path=${encodeURIComponent(path)}&z=${zIdx}`;

  return (
    <div className="flex flex-col gap-2">
      {label && <div className="text-[11px] text-muted-foreground font-mono truncate">{label}</div>}
      <div className="relative bg-black rounded-md border border-border/50 overflow-hidden">
        <img
          ref={imgRef}
          key={imgKey}
          src={src}
          alt={`slice z=${zIdx}`}
          className="w-full block"
          onLoad={() => {}}
        />
        <div className="absolute top-1 left-2 text-[10px] font-mono text-emerald-300 bg-black/60 rounded px-1.5 py-0.5">
          z = {zIdx} / {depth - 1}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground font-mono">0</span>
        <input
          type="range"
          min={0}
          max={100}
          value={z}
          onChange={(e) => setZ(parseInt(e.target.value))}
          className="flex-1 accent-emerald-400 h-1"
        />
        <span className="text-[10px] text-muted-foreground font-mono">{depth - 1}</span>
      </div>
      <div className="text-[10px] text-muted-foreground text-center">
        Drag to scroll through z-slices of the 3D density map.
      </div>
    </div>
  );
}
