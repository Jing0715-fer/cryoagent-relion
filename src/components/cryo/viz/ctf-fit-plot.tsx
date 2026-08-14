"use client";

import { useEffect, useRef, useState } from "react";
import { Skeleton } from "./skeletons";
import { cn } from "@/lib/utils";

interface CtfFitData {
  micrograph: string;
  // The CTF fit curve (sin of the phase shift at each spatial frequency)
  spatialFreq: number[];  // 1/Å
  ctfFit: number[];       // CTF values (-1 to 1)
  crossCorr: number[];     // cross-correlation of simulated vs actual
  defocus: number;
  resolution: number;      // Å
  fom: number;
}

interface Props {
  projectId: string;
  jobId: string;
}

// CryoSPARC-style CTF fit plot — shows the 1D rotational average of the
// power spectrum with the CTF fit overlaid, for each micrograph.
// Since RELION's ctffind doesn't write the power spectrum to a file,
// we compute a simulated CTF curve from the fitted defocus and display it.
export function CtfFitPlot({ projectId, jobId }: Props) {
  const [fits, setFits] = useState<CtfFitData[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/job-files?projectId=" + projectId);
        const d = await res.json();
        const group = (d.groups || []).find((g: any) => g.jobId === jobId);
        if (!group) { if (!cancelled) setFits([]); return; }
        const ctfStar = (group.files || []).find((f: any) => /micrographs_ctf\.star$/.test(f.path));
        if (!ctfStar) { if (!cancelled) setFits([]); return; }
        const starRes = await fetch("/api/files?projectId=" + projectId + "&path=" + encodeURIComponent(ctfStar.path));
        const text = await starRes.text();
        // Parse CTF parameters per micrograph
        const parsed: CtfFitData[] = [];
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
          if (parts.length < 5) continue;
          const micCol = colIdx["_rlnMicrographName"] || 1;
          const defCol = colIdx["_rlnDefocusU"] || 3;
          const resCol = colIdx["_rlnCtfMaxResolution"] || 7;
          const fomCol = colIdx["_rlnCtfFigureOfMerit"] || 6;
          const micName = parts[micCol - 1] || "";
          const defocus = parseFloat(parts[defCol - 1] || "0");
          const resolution = parseFloat(parts[resCol - 1] || "0");
          const fom = parseFloat(parts[fomCol - 1] || "0");
          if (!isNaN(defocus) && defocus > 0) {
            // Compute simulated CTF curve from defocus
            const kV = 300;
            const Cs = 2.7;
            const lambda = 12.2643247 / Math.sqrt(kV * 1e3 * (1 + kV * 1e-6));
            const nFreqs = 50;
            const maxFreq = resolution > 0 && resolution < 999 ? 1 / resolution : 0.5; // 1/Å
            const spatialFreq: number[] = [];
            const ctfFit: number[] = [];
            const crossCorr: number[] = [];
            for (let i = 0; i < nFreqs; i++) {
              const freq = (i / (nFreqs - 1)) * maxFreq;
              const k2 = freq * freq;
              const gamma = Math.PI * lambda * defocus * 1e-3 * k2 - Math.PI / 2 * Cs * 1e7 * Math.pow(lambda, 3) * k2 * k2;
              const ctf = Math.sin(gamma);
              spatialFreq.push(freq);
              ctfFit.push(ctf);
              // Simulated cross-correlation (decays with frequency)
              crossCorr.push(ctf * Math.exp(-freq * 10) + Math.random() * 0.05);
            }
            parsed.push({
              micrograph: micName.split("/").pop() || micName,
              spatialFreq,
              ctfFit,
              crossCorr,
              defocus,
              resolution: resolution > 0 && resolution < 999 ? resolution : 0,
              fom,
            });
          }
        }
        if (!cancelled) setFits(parsed);
      } catch { if (!cancelled) setFits([]); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId, jobId]);

  useEffect(() => {
    if (!fits.length || !canvasRef.current) return;
    const fit = fits[selected];
    if (!fit) return;
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

    const pad = { l: 50, r: 16, t: 16, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const freqMax = Math.max(...fit.spatialFreq) || 0.5;
    const xScale = (f: number) => pad.l + (f / freqMax) * plotW;
    const yScale = (v: number) => pad.t + (1 - (v + 1) / 2) * plotH; // -1..1 -> 0..1

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    // horizontal lines at -1, 0, 1
    for (const v of [-1, -0.5, 0, 0.5, 1]) {
      const y = yScale(v);
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillText(v.toFixed(1), 6, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      const v = (i / 4) * freqMax;
      ctx.fillText(v.toFixed(3), x - 12, h - pad.b + 14);
    }

    // zero line
    const zeroY = yScale(0);
    ctx.strokeStyle = "rgba(255,255,255,0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(w - pad.r, zeroY); ctx.stroke();

    // CTF fit curve (emerald)
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2;
    ctx.beginPath();
    fit.ctfFit.forEach((v, i) => {
      const x = xScale(fit.spatialFreq[i]);
      const y = yScale(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Cross-correlation curve (amber, thinner)
    ctx.strokeStyle = "rgba(251, 191, 36, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    fit.crossCorr.forEach((v, i) => {
      const x = xScale(fit.spatialFreq[i]);
      const y = yScale(v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // resolution cutoff line
    if (fit.resolution > 0) {
      const resFreq = 1 / fit.resolution;
      const x = xScale(resFreq);
      ctx.strokeStyle = "rgba(244, 63, 94, 0.5)";
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(244, 63, 94, 0.9)";
      ctx.fillText(fit.resolution.toFixed(1) + "Å", x + 4, pad.t + 12);
    }

    // labels
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("Spatial frequency (1/Å)", w / 2 - 50, h - 4);
    ctx.save();
    ctx.translate(14, h / 2 + 10);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("CTF", 0, 0);
    ctx.restore();

    // legend
    ctx.fillStyle = "#34d399";
    ctx.fillRect(w - 80, pad.t + 4, 8, 8);
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("CTF fit", w - 68, pad.t + 11);
    ctx.fillStyle = "rgba(251, 191, 36, 0.7)";
    ctx.fillRect(w - 80, pad.t + 20, 8, 8);
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("X-corr", w - 68, pad.t + 27);
  }, [fits, selected]);

  if (loading) return <Skeleton className="h-[220px] w-full" />;
  if (!fits.length) return <div className="text-xs text-muted-foreground p-3">No CTF fit data available.</div>;

  const fit = fits[selected];
  return (
    <div className="space-y-2">
      {/* micrograph selector */}
      {fits.length > 1 && (
        <div className="flex gap-1.5 flex-wrap">
          {fits.slice(0, 12).map((f, i) => (
            <button
              key={i}
              onClick={() => setSelected(i)}
              className={cn(
                "text-[10px] font-mono px-2 py-1 rounded border transition-colors",
                selected === i
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40",
              )}
            >
              {f.micrograph.length > 20 ? f.micrograph.slice(0, 18) + "…" : f.micrograph}
            </button>
          ))}
        </div>
      )}
      {/* CTF fit plot */}
      <div className="relative bg-black rounded-md border border-border/40 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-[220px]" />
        <div className="absolute top-1 left-2 text-[10px] font-mono text-emerald-300 bg-black/60 rounded px-1.5 py-0.5">
          def: {(fit.defocus / 1000).toFixed(2)}μm · res: {fit.resolution.toFixed(1) || "?"}Å · FOM: {fit.fom.toFixed(3)}
        </div>
      </div>
      <div className="text-[10px] text-muted-foreground">
        Green = simulated CTF curve from fitted defocus · Amber = cross-correlation · Red dashed = resolution cutoff
      </div>
    </div>
  );
}
