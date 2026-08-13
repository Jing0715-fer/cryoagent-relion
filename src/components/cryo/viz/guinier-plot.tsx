"use client";

import { useEffect, useRef, useState } from "react";

interface GuinierPoint {
  resolutionSquared: number;
  resolution: number;
  logAmpOriginal: number;
  logAmpWeighted: number;
  logAmpSharpened: number;
  logAmpIntercept: number;
}

interface GuinierFit {
  slope: number;
  intercept: number;
  correlation: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// Guinier plot — ln(amplitude) vs resolution².
// Shows the original, dose-weighted, and sharpened log-amplitude curves, plus
// the fitted B-factor line. The slope of the linear region gives the B-factor.
// This is the standard RELION postprocess Guinier plot.
export function GuinierPlot({ projectId, jobId }: Props) {
  const [points, setPoints] = useState<GuinierPoint[]>([]);
  const [fit, setFit] = useState<GuinierFit | null>(null);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; p: GuinierPoint } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`);
        const d = await res.json();
        if (!cancelled) {
          setPoints(d.guinier || []);
          setFit(d.guinierFit || null);
        }
      } catch { if (!cancelled) setPoints([]); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  useEffect(() => {
    if (!points.length || !canvasRef.current) return;
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

    const pad = { l: 52, r: 16, t: 16, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const xMax = Math.max(...points.map((p) => p.resolutionSquared));
    const yMin = Math.min(...points.map((p) => Math.min(p.logAmpOriginal, p.logAmpWeighted, p.logAmpSharpened)));
    const yMax = Math.max(...points.map((p) => Math.max(p.logAmpOriginal, p.logAmpWeighted, p.logAmpSharpened, p.logAmpIntercept)));
    const xScale = (x: number) => pad.l + (x / xMax) * plotW;
    const yScale = (y: number) => pad.t + (1 - (y - yMin) / (yMax - yMin)) * plotH;

    // grid + axes
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      const v = (i / 4) * xMax;
      ctx.fillText(v.toFixed(4), x - 14, h - pad.b + 14);
    }
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      const v = yMax - (i / 4) * (yMax - yMin);
      ctx.fillText(v.toFixed(1), 8, y + 3);
    }

    // draw curves
    function drawCurve(field: keyof GuinierPoint, color: string, dash: boolean) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.8;
      if (dash) ctx.setLineDash([3, 2]);
      ctx.beginPath();
      points.forEach((p, i) => {
        const x = xScale(p.resolutionSquared);
        const y = yScale(p[field] as number);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    drawCurve("logAmpOriginal", "rgba(148, 163, 184, 0.7)", false);
    drawCurve("logAmpWeighted", "#38bdf8", false);
    drawCurve("logAmpSharpened", "#34d399", false);

    // fitted B-factor line (intercept + slope * resSq)
    if (fit) {
      ctx.strokeStyle = "rgba(251, 191, 36, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();
      const x0 = 0;
      const x1 = xMax;
      const y0 = fit.intercept;
      const y1 = fit.intercept + fit.slope * x1;
      ctx.moveTo(xScale(x0), yScale(y0));
      ctx.lineTo(xScale(x1), yScale(y1));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // axis labels
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("resolution² (1/Å²)", w / 2 - 50, h - 4);
    ctx.save();
    ctx.translate(14, h / 2 + 30);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("ln(amplitude)", 0, 0);
    ctx.restore();

    // B-factor annotation
    if (fit) {
      // B-factor = -4 * slope
      const bfac = -4 * fit.slope;
      ctx.fillStyle = "#fbbf24";
      ctx.font = "bold 12px ui-monospace, monospace";
      ctx.fillText(`B = ${bfac.toFixed(1)} Å²`, w - pad.r - 90, pad.t + 14);
      ctx.fillStyle = "rgba(251, 191, 36, 0.7)";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(`corr = ${fit.correlation.toFixed(3)}`, w - pad.r - 90, pad.t + 28);
    }
  }, [points, fit]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!points.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const pad = { l: 52, r: 16 };
    const xMax = Math.max(...points.map((p) => p.resolutionSquared));
    const t = (x - pad.l) / (rect.width - pad.l - pad.r);
    const resSq = t * xMax;
    let nearest = points[0];
    let best = Infinity;
    for (const p of points) {
      const d = Math.abs(p.resolutionSquared - resSq);
      if (d < best) { best = d; nearest = p; }
    }
    setHover({ x, y, p: nearest });
  }

  if (loading) return <div className="text-xs text-muted-foreground p-4">Loading Guinier plot…</div>;
  if (!points.length) return (
    <div className="text-xs text-muted-foreground p-4 text-center">
      No Guinier data — postprocess.star not found or refine3d was skipped on CPU.
    </div>
  );

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
          style={{ left: hover.x + 10, top: hover.y - 28 }}
        >
          <div className="text-sky-300">{hover.p.resolution.toFixed(2)} Å</div>
          <div className="text-slate-300">ln(orig): {hover.p.logAmpOriginal.toFixed(2)}</div>
          <div className="text-slate-300">ln(sharp): {hover.p.logAmpSharpened.toFixed(2)}</div>
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground px-2 pb-1 flex-wrap">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-400" /> original</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-sky-400" /> dose-weighted</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400" /> sharpened</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-400" style={{ borderTop: "1px dashed" }} /> B-factor fit</span>
      </div>
    </div>
  );
}
