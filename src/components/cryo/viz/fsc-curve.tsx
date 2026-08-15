"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "./skeletons";

interface FscPoint {
  resolution: number;
  frequency: number;
  fsc: number;
  fscRandom: number;
  fscUnmasked: number;
  fscMasked: number;
  fscParticleMask: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// FSC (Fourier-Shell Correlation) curve plot — CryoSPARC-style.
// Plots FSC vs resolution (1/Å), with the 0.143 cutoff line and the
// resolution at which the curve crosses it.
export function FscCurve({ projectId, jobId }: Props) {
  const [data, setData] = useState<FscPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; point: FscPoint } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`);
        const d = await res.json();
        if (!cancelled) {
          setData(d.fsc || []);
          setError(d.fsc && d.fsc.length === 0 ? "No FSC curve available — postprocess.star not found or refine3d was skipped on CPU." : null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  // draw the curve on canvas
  useEffect(() => {
    if (!data.length || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const pad = { l: 48, r: 16, t: 16, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    // x axis: resolution (Å) — invert so high-res (low Å) on right
    const resMin = Math.min(...data.map((d) => d.resolution));
    const resMax = Math.max(...data.map((d) => d.resolution));
    const xScale = (r: number) => pad.l + ((resMax - r) / (resMax - resMin)) * plotW;
    // y axis: FSC 0..1
    const yScale = (f: number) => pad.t + (1 - f) * plotH;

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    for (let f = 0; f <= 1; f += 0.2) {
      const y = yScale(f);
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();
      ctx.fillText(f.toFixed(1), 8, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const r = resMin + (i / 4) * (resMax - resMin);
      const x = xScale(r);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, h - pad.b);
      ctx.stroke();
      ctx.fillText(`${r.toFixed(1)}Å`, x - 14, h - pad.b + 14);
    }

    // 0.143 cutoff line
    const cutoffY = yScale(0.143);
    ctx.strokeStyle = "rgba(251, 191, 36, 0.6)";
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(pad.l, cutoffY);
    ctx.lineTo(w - pad.r, cutoffY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
    ctx.fillText("FSC=0.143", w - pad.r - 56, cutoffY - 4);

    // FSC curve (corrected) — main emerald line
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xScale(d.resolution);
      const y = yScale(d.fsc);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // FSC unmasked maps (blue, dashed)
    if (data.some((d) => d.fscUnmasked > 0)) {
      ctx.strokeStyle = "rgba(96, 165, 250, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = xScale(d.resolution);
        const y = yScale(d.fscUnmasked);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // FSC masked maps (amber, dashed)
    if (data.some((d) => d.fscMasked > 0)) {
      ctx.strokeStyle = "rgba(251, 191, 36, 0.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 2]);
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = xScale(d.resolution);
        const y = yScale(d.fscMasked);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // FSC random/phase-randomized (gray, dotted)
    if (data.some((d) => d.fscRandom > 0)) {
      ctx.strokeStyle = "rgba(148, 163, 184, 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      data.forEach((d, i) => {
        const x = xScale(d.resolution);
        const y = yScale(d.fscRandom);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // axis labels
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("Resolution (Å) →", w / 2 - 40, h - 4);
    ctx.save();
    ctx.translate(12, h / 2 + 24);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("FSC", 0, 0);
    ctx.restore();

    // find resolution at FSC=0.143
    let crossRes: number | null = null;
    for (let i = 1; i < data.length; i++) {
      if (data[i - 1].fsc >= 0.143 && data[i].fsc < 0.143) {
        // linear interpolate
        const t = (0.143 - data[i].fsc) / (data[i - 1].fsc - data[i].fsc);
        crossRes = data[i].resolution + t * (data[i - 1].resolution - data[i].resolution);
        break;
      }
    }
    if (crossRes) {
      const x = xScale(crossRes);
      ctx.strokeStyle = "rgba(52, 211, 153, 0.4)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.t);
      ctx.lineTo(x, h - pad.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#34d399";
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.fillText(`${crossRes.toFixed(2)} Å`, x + 4, pad.t + 12);
    }
  }, [data]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!data.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // find nearest data point
    const pad = { l: 48, r: 16 };
    const resMin = Math.min(...data.map((d) => d.resolution));
    const resMax = Math.max(...data.map((d) => d.resolution));
    const t = (x - pad.l) / (rect.width - pad.l - pad.r);
    const res = resMax - t * (resMax - resMin);
    let nearest = data[0];
    let best = Infinity;
    for (const d of data) {
      const dd = Math.abs(d.resolution - res);
      if (dd < best) { best = dd; nearest = d; }
    }
    setHover({ x, y, point: nearest });
  }

  if (loading) return <Skeleton className="h-[220px] w-full" />;
  if (error) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      <div className="opacity-60">{error}</div>
    </div>
  );
  if (!data.length) return null;

  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[220px] cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="absolute pointer-events-none bg-black/90 border border-emerald-500/40 rounded px-2 py-1 text-[10px] font-mono"
          style={{ left: hover.x + 10, top: hover.y - 24 }}
        >
          <div className="text-emerald-300">{hover.point.resolution.toFixed(2)} Å</div>
          <div className="text-slate-300">FSC: {hover.point.fsc.toFixed(3)}</div>
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-2 pb-1 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400" /> corrected FSC</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-400" style={{ borderTop: "2px dashed" }} /> unmasked maps</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400" style={{ borderTop: "2px dashed" }} /> masked maps</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400" style={{ borderTop: "1px dotted" }} /> phase-randomized</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400" style={{ borderTop: "1px dashed" }} /> 0.143 cutoff</span>
      </div>
    </div>
  );
}
