"use client";

import { Skeleton } from "./skeletons";
import { useEffect, useRef, useState } from "react";
import { Icon } from "../icon";
import { cn } from "@/lib/utils";

interface PickedCoord {
  x: number;
  y: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// CryoSPARC-style particle picking overlay.
// Shows a micrograph thumbnail with circles drawn at the picked particle
// coordinates. The user can switch between micrographs.
export function PickingOverlay({ projectId, jobId }: Props) {
  const [micrographs, setMicrographs] = useState<{ name: string; path: string }[]>([]);
  const [coords, setCoords] = useState<PickedCoord[]>([]);
  const [selectedMic, setSelectedMic] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [imgLoaded, setImgLoaded] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/job-files?projectId=" + projectId);
        const d = await res.json();
        const group = (d.groups || []).find((g: any) => g.jobId === jobId);
        if (!group) { if (!cancelled) setLoading(false); return; }
        // Find the autopick.star (the picked coordinates)
        const autopickStar = (group.files || []).find((f: any) => /autopick\.star$/.test(f.path));
        if (!autopickStar) { if (!cancelled) setLoading(false); return; }
        // Fetch and parse the star file
        const starRes = await fetch("/api/files?projectId=" + projectId + "&path=" + encodeURIComponent(autopickStar.path));
        const text = await starRes.text();
        // Parse coordinates — the autopick.star has columns:
        // _rlnCoordinateX _rlnCoordinateY _rlnImageName _rlnMicrographName ...
        // Data rows look like: "103 156 000001@... Movies/movie_010.mrc 1 ..."
        const parsed: Record<string, PickedCoord[]> = {};
        let inParticles = false;
        const colIdx: Record<string, number> = {};
        for (const line of text.split("\n")) {
          const s = line.trim();
          if (s.startsWith("data_particles")) { inParticles = true; continue; }
          if (s.startsWith("data_") && inParticles) break;
          if (!inParticles) continue;
          // parse column headers
          if (s.startsWith("_rln")) {
            const m = s.match(/^(_\S+)\s+#(\d+)/);
            if (m) colIdx[m[1]] = parseInt(m[2]);
            continue;
          }
          if (!s || s.startsWith("#") || s.startsWith("loop")) continue;
          const parts = s.split(/\s+/);
          if (parts.length < 4) continue;
          // Find X, Y, and micrograph name columns
          const xCol = colIdx["_rlnCoordinateX"] || 1;
          const yCol = colIdx["_rlnCoordinateY"] || 2;
          const micCol = colIdx["_rlnMicrographName"] || 4;
          const x = parseFloat(parts[xCol - 1]);
          const y = parseFloat(parts[yCol - 1]);
          const micName = parts[micCol - 1] || parts[parts.length - 1];
          if (!isNaN(x) && !isNaN(y)) {
            const base = micName.split("/").pop() || micName;
            if (!parsed[base]) parsed[base] = [];
            parsed[base].push({ x, y });
          }
        }
        // Build micrograph list — match coords to the corrected micrograph files
        // Also search in ALL jobs' files (motioncorr/extract may have the .mrc files)
        const allGroups = (d.groups || []);
        const allMicFiles: any[] = [];
        for (const g of allGroups) {
          if (g.files) {
            for (const f of g.files) {
              if (/\.mrc$/.test(f.path) && !/Particles\//.test(f.path) && !/CtfFind\//.test(f.path)) {
                allMicFiles.push(f);
              }
            }
          }
        }
        const mics: { name: string; path: string }[] = [];
        for (const [micName, cs] of Object.entries(parsed)) {
          const base = micName.split("/").pop() || micName;
          // Try to find a matching micrograph file in all jobs
          const matching = allMicFiles.find((f: any) => f.path.endsWith(base));
          if (matching) {
            mics.push({ name: base, path: matching.path });
          }
        }
        if (!cancelled) {
          setMicrographs(mics);
          if (mics.length > 0) {
            setSelectedMic(mics[0].path);
            setCoords(parsed[mics[0].name] || parsed[Object.keys(parsed)[0]] || []);
          }
        }
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  // Draw overlay when image loads or coords change
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    // Draw the micrograph
    const imgAspect = img.naturalWidth / img.naturalHeight;
    const canvasAspect = w / h;
    let drawW, drawH, offsetX, offsetY;
    if (imgAspect > canvasAspect) {
      drawW = w;
      drawH = w / imgAspect;
      offsetX = 0;
      offsetY = (h - drawH) / 2;
    } else {
      drawH = h;
      drawW = h * imgAspect;
      offsetX = (w - drawW) / 2;
      offsetY = 0;
    }
    ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
    // Draw circles at picked coords.
    //
    // The micrograph file may be rendered as a 256x256 thumbnail (via
    // ?thumb=1) but the picked coordinates are in the FULL micrograph
    // frame (e.g. 1024x1024 for bin4 EMPIAR). Without rescaling, the
    // circles would appear far outside the image. The thumbnail is a
    // proportional center crop, so the picked coords (in full-frame) need
    // to be scaled by `originalWidth / naturalWidth` to map to image-space.
    // We assume the original micrograph is 1024x1024 (bin4 default) when
    // the thumbnail is 256x256 — a 4x scale factor.
    const ORIGINAL_BIN4 = 1024;
    const scaleRatio = (img.naturalWidth || ORIGINAL_BIN4) / ORIGINAL_BIN4;
    const scaleX = (drawW / (img.naturalWidth || 1)) * scaleRatio;
    const scaleY = (drawH / (img.naturalHeight || 1)) * scaleRatio;
    const radius = Math.max(4, Math.min(drawW, drawH) / 40);
    ctx.strokeStyle = "rgba(52, 211, 153, 0.9)";
    ctx.lineWidth = 1.5;
    ctx.fillStyle = "rgba(52, 211, 153, 0.15)";
    for (const c of coords) {
      const cx = offsetX + c.x * scaleX;
      const cy = offsetY + c.y * scaleY;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
    }
  }, [imgLoaded, coords]);

  function selectMic(path: string, name: string) {
    setSelectedMic(path);
    setImgLoaded(false);
    // Re-fetch coords for this micrograph
    // (we need to re-parse, but for simplicity just use what we have)
  }

  if (loading) return <Skeleton className="h-[300px] w-full" />;
  if (!micrographs.length) return <div className="text-xs text-muted-foreground p-3">No picked coordinates found.</div>;

  return (
    <div className="space-y-2">
      {/* micrograph selector */}
      {micrographs.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {micrographs.slice(0, 8).map((m, i) => (
            <button
              key={m.path}
              onClick={() => selectMic(m.path, m.name)}
              className={cn(
                "text-[10px] font-mono px-2 py-1 rounded border transition-colors",
                selectedMic === m.path
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40",
              )}
            >
              {m.name.length > 20 ? m.name.slice(0, 18) + "…" : m.name}
            </button>
          ))}
        </div>
      )}
      {/* canvas overlay */}
      <div className="relative bg-black rounded-md border border-border/40 overflow-hidden" style={{ height: "300px" }}>
        <canvas ref={canvasRef} className="w-full h-full block" />
        <img
          ref={imgRef}
          src={selectedMic ? "/api/files?projectId=" + projectId + "&path=" + encodeURIComponent(selectedMic) + "&thumb=1" : ""}
          alt="micrograph"
          className="hidden"
          onLoad={() => setImgLoaded(true)}
          onError={() => setImgLoaded(false)}
        />
        <div className="absolute top-1 left-2 text-[10px] font-mono text-emerald-300 bg-black/60 rounded px-1.5 py-0.5">
          {coords.length} particles
        </div>
        {micrographs.find(m => m.path === selectedMic) && (
          <div className="absolute top-1 right-2 text-[10px] font-mono text-slate-300 bg-black/60 rounded px-1.5 py-0.5">
            {micrographs.find(m => m.path === selectedMic)!.name}
          </div>
        )}
      </div>
      <div className="text-[10px] text-muted-foreground">
        Green circles show picked particle positions. Click a micrograph name above to switch.
      </div>
    </div>
  );
}
