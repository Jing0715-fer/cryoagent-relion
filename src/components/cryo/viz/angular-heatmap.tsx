"use client";

import { useEffect, useRef, useState } from "react";

interface Orientation {
  rot: number;
  tilt: number;
  psi: number;
  classNumber: number;
  x: number;
  y: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// Angular distribution heatmap (Euler-angles projection) — CryoSPARC-style.
// Plots each particle's (rot, tilt) on a polar/HEALPix-style map; bins into a
// grid and colors by particle count. Shows orientational coverage.
export function AngularHeatmap({ projectId, jobId }: Props) {
  const [orientations, setOrientations] = useState<Orientation[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; count: number; rot: number; tilt: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`);
        const d = await res.json();
        if (!cancelled) setOrientations(d.orientations || []);
      } catch {
        if (!cancelled) setOrientations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  useEffect(() => {
    if (!orientations.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = Math.min(canvas.clientWidth, canvas.clientHeight);
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 8;

    // Bin orientations into a (rot, tilt) grid; tilt 0..180, rot 0..360
    const nBinsTilt = 36;
    const nBinsRot = 72;
    const bins: number[][] = Array.from({ length: nBinsTilt }, () => new Array(nBinsRot).fill(0));
    for (const o of orientations) {
      const rot = ((o.rot % 360) + 360) % 360;
      const tilt = Math.max(0, Math.min(180, o.tilt));
      const ri = Math.min(nBinsRot - 1, Math.floor((rot / 360) * nBinsRot));
      const ti = Math.min(nBinsTilt - 1, Math.floor((tilt / 180) * nBinsTilt));
      bins[ti][ri]++;
    }
    const maxCount = Math.max(...bins.flat());

    // Draw Mollweide-style ellipse: x = R * (2/π) * lon * cos(lat), y = R * sin(lat)
    // We map rot -> longitude (-π..π), tilt -> latitude (-π/2..π/2).
    function project(rotDeg: number, tiltDeg: number): [number, number] {
      const lon = ((rotDeg / 360) * 2 - 1) * Math.PI; // -π..π
      const lat = ((tiltDeg / 180) - 0.5) * Math.PI;    // -π/2..π/2
      const x = cx + (2 / Math.PI) * lon * Math.cos(lat) * R * 0.9;
      const y = cy + Math.sin(lat) * R * 0.9;
      return [x, y];
    }

    // draw filled bins
    for (let ti = 0; ti < nBinsTilt; ti++) {
      for (let ri = 0; ri < nBinsRot; ri++) {
        const count = bins[ti][ri];
        if (count === 0) continue;
        const rotCenter = ((ri + 0.5) / nBinsRot) * 360;
        const tiltCenter = ((ti + 0.5) / nBinsTilt) * 180;
        const [x, y] = project(rotCenter, tiltCenter);
        const intensity = count / maxCount;
        // viridis-like color ramp
        const color = viridis(intensity);
        ctx.fillStyle = color;
        const binR = Math.max(3, size / 60);
        ctx.beginPath();
        ctx.arc(x, y, binR, 0, 2 * Math.PI);
        ctx.fill();
      }
    }

    // draw ellipse outline
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.9, R * 0.9, 0, 0, 2 * Math.PI);
    ctx.stroke();

    // axes labels
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillText("tilt 0°", cx - 16, cy - R * 0.9 - 2);
    ctx.fillText("tilt 180°", cx - 24, cy + R * 0.9 + 12);
    ctx.fillText("rot 0°", cx + R * 0.9 + 2, cy + 3);
    ctx.fillText("rot 180°", cx - R * 0.9 - 32, cy + 3);

    // color scale
    const scaleW = 80;
    const scaleH = 6;
    const sx = size - scaleW - 8;
    const sy = size - 16;
    for (let i = 0; i < scaleW; i++) {
      ctx.fillStyle = viridis(i / scaleW);
      ctx.fillRect(sx + i, sy, 1, scaleH);
    }
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.fillText("0", sx - 8, sy + 6);
    ctx.fillText(`${maxCount}`, sx + scaleW - 12, sy + 6);
  }, [orientations]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!orientations.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const size = Math.min(rect.width, rect.height);
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 8;
    // inverse project
    const lat = Math.asin((y - cy) / (R * 0.9));
    const lon = ((x - cx) / (R * 0.9)) / (2 / Math.PI) / Math.cos(lat || 0.001);
    if (Math.abs(lon) > Math.PI || isNaN(lat)) { setHover(null); return; }
    const rot = ((lon / Math.PI + 1) / 2) * 360;
    const tilt = (lat / Math.PI + 0.5) * 180;
    // count nearby
    let count = 0;
    for (const o of orientations) {
      const dr = Math.abs(((o.rot - rot + 540) % 360) - 180);
      const dt = Math.abs(o.tilt - tilt);
      if (dr < 5 && dt < 5) count++;
    }
    setHover({ x, y, count, rot: rot % 360, tilt });
  }

  if (loading) return <div className="text-xs text-muted-foreground p-4">Loading orientations…</div>;
  if (!orientations.length) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      No orientation data — refine3d / class3d must run to produce Euler angles. (Skipped on CPU.)
    </div>
  );

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full max-w-[260px] aspect-square mx-auto cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="absolute pointer-events-none bg-black/90 border border-emerald-500/40 rounded px-2 py-1 text-[10px] font-mono"
          style={{ left: hover.x + 12, top: hover.y + 12 }}
        >
          <div className="text-emerald-300">rot {hover.rot.toFixed(0)}° tilt {hover.tilt.toFixed(0)}°</div>
          <div className="text-slate-300">{hover.count} particles</div>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground text-center px-2 pb-1">
        {orientations.length} particles · Mollweide projection
      </div>
    </div>
  );
}

// Viridis-like color ramp (approximation)
function viridis(t: number): string {
  // 5-stop approximation of viridis
  const stops = [
    [68, 1, 84],    // purple
    [59, 82, 139],  // blue
    [33, 144, 141], // teal
    [94, 201, 98],  // green
    [253, 231, 37], // yellow
  ];
  const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const f = t * (stops.length - 1) - i;
  const a = stops[i];
  const b = stops[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}
