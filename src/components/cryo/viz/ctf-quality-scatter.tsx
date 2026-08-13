"use client";

import { Skeleton } from "./skeletons";
import { useEffect, useRef, useState } from "react";

interface CtfPoint {
  micrograph: string;
  defocus: number;     // Å
  resolution: number;  // Å (CTF fit resolution)
  fom: number;         // figure of merit
}

interface Props {
  projectId: string;
  jobId: string;
}

// CryoSPARC-style CTF fit quality scatter plot.
// Plots defocus vs CTF fit resolution for each micrograph, colored by FOM.
// Helps identify micrographs with poor CTF fits that should be excluded.
export function CtfQualityScatter({ projectId, jobId }: Props) {
  const [data, setData] = useState<CtfPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number; point: CtfPoint } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/job-files?projectId=" + projectId);
        const d = await res.json();
        const group = (d.groups || []).find((g: any) => g.jobId === jobId);
        if (!group) { if (!cancelled) setData([]); return; }
        const ctfStar = (group.files || []).find((f: any) => /micrographs_ctf\.star$/.test(f.path));
        if (!ctfStar) { if (!cancelled) setData([]); return; }
        const starRes = await fetch("/api/files?projectId=" + projectId + "&path=" + encodeURIComponent(ctfStar.path));
        const text = await starRes.text();
        // Parse CTF data
        const points: CtfPoint[] = [];
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
            points.push({
              micrograph: micName.split("/").pop() || micName,
              defocus,
              resolution: resolution > 0 && resolution < 999 ? resolution : 0,
              fom,
            });
          }
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

    const pad = { l: 55, r: 16, t: 16, b: 36 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    // axes ranges
    const defMin = Math.min(...data.map(d => d.defocus)) * 0.9;
    const defMax = Math.max(...data.map(d => d.defocus)) * 1.1;
    const resMax = Math.max(...data.map(d => d.resolution || 10)) * 1.1;
    const fomMax = Math.max(...data.map(d => d.fom), 1);

    const xScale = (def: number) => pad.l + ((def - defMin) / (defMax - defMin)) * plotW;
    const yScale = (res: number) => pad.t + (1 - res / resMax) * plotH;

    // grid
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.fillStyle = "rgba(180,180,200,0.7)";
    ctx.font = "10px ui-monospace, monospace";
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (i / 4) * plotH;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      const v = resMax * (1 - i / 4);
      ctx.fillText(v.toFixed(1) + "Å", 6, y + 3);
    }
    for (let i = 0; i <= 4; i++) {
      const x = pad.l + (i / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      const v = defMin + (i / 4) * (defMax - defMin);
      ctx.fillText((v / 1000).toFixed(1) + "μm", x - 14, h - pad.b + 14);
    }

    // points — color by FOM (red=poor, yellow=ok, green=good)
    for (const d of data) {
      const x = xScale(d.defocus);
      const y = yScale(d.resolution || resMax * 0.5);
      const fomRatio = d.fom / fomMax;
      // viridis-like color
      let r, g, b;
      if (fomRatio > 0.66) { r = 52; g = 211; b = 153; }     // emerald
      else if (fomRatio > 0.33) { r = 251; g = 191; b = 36; } // amber
      else { r = 244; g = 63; b = 94; }                        // rose
      ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.strokeStyle = `rgba(${r},${g},${b},1)`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // axis labels
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.font = "11px ui-sans-serif, system-ui";
    ctx.fillText("Defocus (μm)", w / 2 - 35, h - 4);
    ctx.save();
    ctx.translate(14, h / 2 + 30);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("CTF resolution (Å)", 0, 0);
    ctx.restore();

    // legend
    ctx.fillStyle = "rgba(52, 211, 153, 0.9)";
    ctx.beginPath(); ctx.arc(w - 80, pad.t + 8, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("good", w - 70, pad.t + 11);
    ctx.fillStyle = "rgba(251, 191, 36, 0.9)";
    ctx.beginPath(); ctx.arc(w - 80, pad.t + 24, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("ok", w - 70, pad.t + 27);
    ctx.fillStyle = "rgba(244, 63, 94, 0.9)";
    ctx.beginPath(); ctx.arc(w - 80, pad.t + 40, 4, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = "rgba(180,180,200,0.85)";
    ctx.fillText("poor", w - 70, pad.t + 43);
  }, [data]);

  function onMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!data.length || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // find nearest point
    let nearest = data[0];
    let best = Infinity;
    for (const d of data) {
      const pad = { l: 55, r: 16, t: 16, b: 36 };
      const plotW = rect.width - pad.l - pad.r;
      const plotH = rect.height - pad.t - pad.b;
      const defMin = Math.min(...data.map(d => d.defocus)) * 0.9;
      const defMax = Math.max(...data.map(d => d.defocus)) * 1.1;
      const resMax = Math.max(...data.map(d => d.resolution || 10)) * 1.1;
      const px = pad.l + ((d.defocus - defMin) / (defMax - defMin)) * plotW;
      const py = pad.t + (1 - (d.resolution || resMax * 0.5) / resMax) * plotH;
      const dist = Math.sqrt((px - x) ** 2 + (py - y) ** 2);
      if (dist < best) { best = dist; nearest = d; }
    }
    if (best < 20) setHover({ x, y, point: nearest });
    else setHover(null);
  }

  if (loading) return <Skeleton className="h-[200px] w-full" />;
  if (!data.length) return <div className="text-xs text-muted-foreground p-3">No CTF data available.</div>;
  return (
    <div className="relative">
      <canvas
        ref={canvasRef}
        className="w-full h-[200px] cursor-crosshair"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      />
      {hover && (
        <div
          className="absolute pointer-events-none bg-black/90 border border-emerald-500/40 rounded px-2 py-1 text-[10px] font-mono"
          style={{ left: hover.x + 10, top: hover.y - 28 }}
        >
          <div className="text-emerald-300 truncate max-w-[150px]">{hover.point.micrograph}</div>
          <div className="text-slate-300">def: {(hover.point.defocus / 1000).toFixed(2)}μm</div>
          <div className="text-slate-300">res: {hover.point.resolution.toFixed(1)}Å</div>
          <div className="text-slate-300">FOM: {hover.point.fom.toFixed(3)}</div>
        </div>
      )}
    </div>
  );
}
