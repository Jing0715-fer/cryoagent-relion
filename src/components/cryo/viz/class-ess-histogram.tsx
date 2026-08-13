"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  projectId: string;
  jobId: string;
}

// CryoSPARC-style "Class ESS (Effective Sample Size) Histogram" + "Probability
// of Best Class Histogram". Both are derived from RELION's data.star columns:
//   _rlnMaxValueProbDistribution (max probability across classes per particle)
//   _rlnNrOfSignificantSamples (effective sample size per particle)
export function ClassEssHistogram({ projectId, jobId }: Props) {
  const [data, setData] = useState<{ ess: number[]; maxProb: number[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/analyze?projectId=${projectId}&jobId=${jobId}`);
        const d = await res.json();
        if (!cancelled && d.orientations && d.orientations.length > 0) {
          // We need the full data.star columns — the analyze API only returns
          // orientations. Fetch the data.star directly and parse ESS + maxProb.
          const jobFiles = await fetch(`/api/job-files?projectId=${projectId}`).then(r => r.json());
          const group = (jobFiles.groups || []).find((g: any) => g.jobId === jobId);
          if (group) {
            const dataStar = (group.files || []).filter((f: any) => /_data\.star$/.test(f.path)).pop();
            if (dataStar) {
              const starText = await fetch(`/api/files?projectId=${projectId}&path=${encodeURIComponent(dataStar.path)}`).then(r => r.text());
              const parsed = parseEssFromDataStar(starText);
              if (!cancelled) setData(parsed);
            }
          }
        }
      } catch { if (!cancelled) setData(null); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  useEffect(() => {
    if (!data || !canvasRef.current) return;
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

    const pad = { l: 40, r: 12, t: 12, b: 32 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    // ESS histogram (0..nr_classes)
    const nrClasses = 10;
    const essBins = new Array(nrClasses).fill(0);
    const probBins = new Array(10).fill(0);
    for (const e of data.ess) {
      const b = Math.min(nrClasses - 1, Math.floor(e));
      essBins[b]++;
    }
    for (const p of data.maxProb) {
      const b = Math.min(9, Math.floor(p * 10));
      probBins[b]++;
    }
    const maxCount = Math.max(...essBins, ...probBins);

    // draw bars — ESS in blue, maxProb in green
    function drawBars(bins: number[], color: string, offsetX: number, barW: number) {
      ctx.fillStyle = color;
      bins.forEach((c, i) => {
        const x = pad.l + offsetX + i * (plotW / bins.length) + 2;
        const barH = (c / maxCount) * plotH;
        const y = pad.t + plotH - barH;
        ctx.fillRect(x, y, barW, barH);
      });
    }
    const halfW = (plotW / nrClasses) / 2 - 2;
    drawBars(essBins, "rgba(56, 189, 248, 0.7)", 0, halfW);
    drawBars(probBins, "rgba(52, 211, 153, 0.7)", halfW + 2, halfW);

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
    for (let i = 0; i <= nrClasses; i += 2) {
      const x = pad.l + (i / nrClasses) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.fillText(String(i), x - 4, h - pad.b + 14);
    }
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("ESS / Max-prob", w / 2 - 40, h - 4);

    // legend
    ctx.fillStyle = "rgba(56, 189, 248, 0.9)";
    ctx.fillRect(w - 100, pad.t + 4, 8, 8);
    ctx.fillText("ESS", w - 88, pad.t + 11);
    ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
    ctx.fillRect(w - 100, pad.t + 20, 8, 8);
    ctx.fillText("MaxProb", w - 88, pad.t + 27);
  }, [data]);

  if (loading) return <div className="text-xs text-muted-foreground p-3">Loading ESS histogram…</div>;
  if (!data) return <div className="text-xs text-muted-foreground p-3">No ESS data available.</div>;

  return <canvas ref={canvasRef} className="w-full h-[180px]" />;
}

function parseEssFromDataStar(text: string): { ess: number[]; maxProb: number[] } {
  const ess: number[] = [];
  const maxProb: number[] = [];
  const lines = text.split("\n");
  // find column indices
  let inParticles = false;
  const colIdx: Record<string, number> = {};
  for (const line of lines) {
    const s = line.trim();
    if (s.startsWith("data_particles")) { inParticles = true; continue; }
    if (s.startsWith("data_") && inParticles) break;
    if (!inParticles) continue;
    if (s.startsWith("_rln")) {
      const m = s.match(/^(_\S+)\s+#(\d+)/);
      if (m) colIdx[m[1]] = parseInt(m[2]);
      continue;
    }
    if (!s || s.startsWith("#") || s.startsWith("loop_")) continue;
    const parts = s.split(/\s+/);
    const essCol = colIdx["_rlnNrOfSignificantSamples"];
    const probCol = colIdx["_rlnMaxValueProbDistribution"];
    if (essCol && essCol <= parts.length) {
      const e = parseFloat(parts[essCol - 1]);
      if (!isNaN(e)) ess.push(e);
    }
    if (probCol && probCol <= parts.length) {
      const p = parseFloat(parts[probCol - 1]);
      if (!isNaN(p)) maxProb.push(p);
    }
  }
  return { ess, maxProb };
}
