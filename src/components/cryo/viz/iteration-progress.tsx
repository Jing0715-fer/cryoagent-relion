"use client";

import { useEffect, useRef, useState } from "react";

interface IterationPoint {
  iteration: number;
  logLikelihood: number;
  avgPmax: number;
  resolution: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// CryoSPARC-style iteration progress chart for class2d/class3d/refine3d.
// Plots the log-likelihood convergence across iterations, parsed from the
// _model.star files (data_model_general block).
export function IterationProgress({ projectId, jobId }: Props) {
  const [data, setData] = useState<IterationPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/job-files?projectId=" + projectId);
        const d = await res.json();
        const group = (d.groups || []).find((g: any) => g.jobId === jobId);
        if (!group) { if (!cancelled) setData([]); return; }
        // Find all _model.star files (one per iteration)
        const modelStars = (group.files || [])
          .filter((f: any) => /_model\.star$/.test(f.path))
          .sort((a: any, b: any) => {
            const aNum = parseInt(a.path.match(/run_it(\d+)_/)?.[1] || "0");
            const bNum = parseInt(b.path.match(/run_it(\d+)_/)?.[1] || "0");
            return aNum - bNum;
          });
        const points: IterationPoint[] = [];
        for (const f of modelStars) {
          const starRes = await fetch("/api/files?projectId=" + projectId + "&path=" + encodeURIComponent(f.path));
          const text = await starRes.text();
          const iterNum = parseInt(f.path.match(/run_it(\d+)_/)?.[1] || "0");
          // Parse data_model_general block
          let ll = 0, pmax = 0, res = 0;
          for (const line of text.split("\n")) {
            const s = line.trim();
            if (s.startsWith("_rlnLogLikelihood")) {
              const m = s.match(/_rlnLogLikelihood\s+([\d.eE+-]+)/);
              if (m) ll = parseFloat(m[1]);
            }
            if (s.startsWith("_rlnAveragePmax")) {
              const m = s.match(/_rlnAveragePmax\s+([\d.eE+-]+)/);
              if (m) pmax = parseFloat(m[1]);
            }
            if (s.startsWith("_rlnCurrentResolution")) {
              const m = s.match(/_rlnCurrentResolution\s+([\d.eE+-]+)/);
              if (m) res = parseFloat(m[1]);
            }
          }
          if (ll !== 0) points.push({ iteration: iterNum, logLikelihood: ll, avgPmax: pmax, resolution: res });
        }
        if (!cancelled) setData(points);
      } catch { if (!cancelled) setData([]); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

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

    const pad = { l: 55, r: 16, t: 16, b: 32 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    // Normalize log-likelihood to 0..1
    const llValues = data.map(d => d.logLikelihood);
    const llMin = Math.min(...llValues);
    const llMax = Math.max(...llValues);
    const llRange = llMax - llMin || 1;
    const pmaxMax = Math.max(...data.map(d => d.avgPmax), 1);

    const xScale = (i: number) => pad.l + (i / Math.max(1, data.length - 1)) * plotW;
    const yScaleLL = (ll: number) => pad.t + (1 - (ll - llMin) / llRange) * plotH;
    const yScalePmax = (p: number) => pad.t + (1 - p / pmaxMax) * plotH;

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
    }
    for (let i = 0; i < data.length; i += Math.max(1, Math.floor(data.length / 5))) {
      const x = xScale(i);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.fillText("it" + data[i].iteration, x - 8, h - pad.b + 14);
    }

    // log-likelihood line (emerald)
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScaleLL(d.logLikelihood);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    // fill area under the curve
    ctx.fillStyle = "rgba(52, 211, 153, 0.1)";
    ctx.lineTo(xScale(data.length - 1), pad.t + plotH);
    ctx.lineTo(xScale(0), pad.t + plotH);
    ctx.closePath();
    ctx.fill();

    // avgPmax line (amber, dashed)
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScalePmax(d.avgPmax);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);

    // points
    data.forEach((d, i) => {
      const x = xScale(i);
      const y = yScaleLL(d.logLikelihood);
      ctx.fillStyle = "#34d399";
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
    });

    // labels
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("Iteration", w / 2 - 30, h - 4);
    ctx.save();
    ctx.translate(14, h / 2 + 20);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Log-likelihood", 0, 0);
    ctx.restore();

    // legend
    ctx.fillStyle = "#34d399";
    ctx.fillRect(w - 100, pad.t + 4, 8, 8);
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("LL", w - 88, pad.t + 11);
    ctx.fillStyle = "#fbbf24";
    ctx.fillRect(w - 100, pad.t + 20, 8, 8);
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("Avg Pmax", w - 88, pad.t + 27);
  }, [data]);

  if (loading) return <div className="text-xs text-muted-foreground p-3">Loading iteration progress…</div>;
  if (!data.length) return <div className="text-xs text-muted-foreground p-3">No iteration data found.</div>;
  return <canvas ref={canvasRef} className="w-full h-[180px]" />;
}
