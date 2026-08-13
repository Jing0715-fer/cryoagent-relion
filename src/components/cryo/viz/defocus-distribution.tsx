"use client";

import { Skeleton } from "./skeletons";
import { useEffect, useRef, useState } from "react";

interface Props {
  projectId: string;
  jobId: string;
}

// CryoSPARC-style defocus distribution histogram for ctffind jobs.
// Reads the micrographs_ctf.star file and plots a histogram of defocus values.
export function DefocusDistribution({ projectId, jobId }: Props) {
  const [data, setData] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch the micrographs_ctf.star via the job-files API
        const res = await fetch("/api/job-files?projectId=" + projectId);
        const d = await res.json();
        const group = (d.groups || []).find((g: any) => g.jobId === jobId);
        if (!group) { if (!cancelled) setData([]); return; }
        const ctfStar = (group.files || []).find((f: any) => /micrographs_ctf\.star$/.test(f.path));
        if (!ctfStar) { if (!cancelled) setData([]); return; }
        // Fetch the star file content
        const starRes = await fetch("/api/files?projectId=" + projectId + "&path=" + encodeURIComponent(ctfStar.path));
        const text = await starRes.text();
        // Parse defocus values from the star
        const defocuses: number[] = [];
        let inMics = false;
        const colIdx: Record<string, number> = {};
        for (const line of text.split("\n")) {
          const s = line.trim();
          if (s.startsWith("data_micrographs")) { inMics = true; continue; }
          if (s.startsWith("data_") && inMics) break;
          if (!inMics) continue;
          if (s.startsWith("_rln")) {
            const m = s.match(/^(_\S+)\s+#(\d+)/);
            if (m) colIdx[m[1]] = parseInt(m[2]);
            continue;
          }
          if (!s || s.startsWith("#") || s.startsWith("loop_")) continue;
          const parts = s.split(/\s+/);
          const duCol = colIdx["_rlnDefocusU"] || 3;
          if (duCol <= parts.length) {
            const v = parseFloat(parts[duCol - 1]);
            if (!isNaN(v) && v > 0 && v < 100000) defocuses.push(v);
          }
        }
        if (!cancelled) setData(defocuses);
      } catch {
        if (!cancelled) setData([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
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

    const pad = { l: 50, r: 16, t: 12, b: 32 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    // histogram bins
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const nBins = 20;
    const bins = new Array(nBins).fill(0);
    for (const v of data) {
      const b = Math.min(nBins - 1, Math.floor(((v - min) / range) * nBins));
      bins[b]++;
    }
    const maxCount = Math.max(...bins);

    // draw bars
    const barW = plotW / nBins;
    for (let i = 0; i < nBins; i++) {
      const x = pad.l + i * barW;
      const barH = (bins[i] / maxCount) * plotH;
      const y = pad.t + plotH - barH;
      // gradient fill
      const grad = ctx.createLinearGradient(0, y, 0, pad.t + plotH);
      grad.addColorStop(0, "rgba(52, 211, 153, 0.8)");
      grad.addColorStop(1, "rgba(52, 211, 153, 0.3)");
      ctx.fillStyle = grad;
      ctx.fillRect(x + 1, y, barW - 2, barH);
    }

    // grid + axes
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      const v = Math.round(maxCount * (1 - i / 4));
      ctx.fillText(String(v), 6, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      const v = min + (i / 4) * range;
      ctx.fillText((v / 1000).toFixed(1) + "μm", x - 18, h - pad.b + 14);
    }

    // labels
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("Defocus (μm)", w / 2 - 40, h - 4);
    ctx.save();
    ctx.translate(14, h / 2 + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Count", 0, 0);
    ctx.restore();

    // stats annotation
    const mean = data.reduce((a, b) => a + b, 0) / data.length;
    ctx.fillStyle = "#34d399";
    ctx.font = "bold 11px ui-monospace, monospace";
    ctx.fillText("n=" + data.length + "  mean=" + (mean / 1000).toFixed(2) + "μm", w - pad.r - 120, pad.t + 14);
  }, [data]);

  if (loading) return <Skeleton className="h-[180px] w-full" />;
  if (!data.length) return <div className="text-xs text-muted-foreground p-3">No CTF data available.</div>;
  return <canvas ref={canvasRef} className="w-full h-[180px]" />;
}
