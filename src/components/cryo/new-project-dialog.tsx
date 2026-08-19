"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (data: { name: string; description: string; datasetMeta: Record<string, unknown>; sourceDataset?: string; executorMode?: string }) => void;
}

interface Template {
  label: string;
  name: string;
  description: string;
  meta: Record<string, unknown>;
  sourceDataset: string;
}

const TEMPLATES: Template[] = [
  {
    label: "Synthetic D4 (test)",
    name: "Synthetic D4 test",
    description: "Synthetic D4-symmetric 4-blob structure, 12 movies, 4.0 Å/px, 96 particles. For CPU pipeline testing.",
    meta: { angpix: 4.0, kV: 300, Cs: 2.7, Q0: 0.1, particle_diameter: 120, symmetry: "C1" },
    sourceDataset: "/home/z/my-project/data/projects/test_d4",
  },
  {
    label: "EMPIAR-10017 β-gal",
    name: "EMPIAR-10017 beta-galactosidase",
    description: "Real beta-galactosidase micrographs (Henderson lab), 4096×4096, 1.77 Å/px, 300 kV, 3 micrographs with manually-picked coords.",
    meta: {
      angpix: 1.77,
      kV: 300,
      Cs: 2.7,
      Q0: 0.1,
      particle_diameter: 130,
      symmetry: "C1",
      // EMPIAR-10017 complete metadata (from EMPIAR entry + publication)
      empiar_id: "10017",
      empiar_url: "https://www.ebi.ac.uk/empiar/EMPIAR-10017",
      pdb_reference: "5NGK",
      organism: "Escherichia coli",
      particle: "beta-galactosidase",
      molecular_weight_kDa: 465,
      n_micrographs: 3,
      image_size_px: 4096,
      n_frames_per_movie: 38,
      total_dose_e_per_A2: 69,
      dose_per_frame_e_per_A2: 1.8,
      defocus_range_um: [1.0, 3.0],
      target_resolution_A: 3.2,
      microscope: "FEI Polara 300kV",
      detector: "Gatan K2 Summit",
      data_creator: "Scheres lab",
      publication: "Scheres SHW. RELION: implementation of a Bayesian approach to cryo-EM structure determination. J Struct Biol. 2012.",
    },
    sourceDataset: "/home/z/my-project/data/projects/empiar10017",
  },
  {
    label: "EMPIAR-10017 80S ribosome",
    name: "EMPIAR-10017 80S ribosome",
    description: "Plasmodium falciparum 80S ribosome (EMPIAR-10017 alt), 1.34 Å/px, 300 kV, D2 symmetry. Large particle (~300Å) for 3D refinement testing.",
    meta: {
      angpix: 1.34,
      kV: 300,
      Cs: 2.7,
      Q0: 0.1,
      particle_diameter: 300,
      symmetry: "C1",
      empiar_id: "10017",
      empiar_url: "https://www.ebi.ac.uk/empiar/EMPIAR-10017",
      organism: "Plasmodium falciparum",
      particle: "80S ribosome",
      molecular_weight_kDa: 2500,
      image_size_px: 4096,
      n_frames_per_movie: 16,
      total_dose_e_per_A2: 50,
      dose_per_frame_e_per_A2: 3.1,
      defocus_range_um: [1.5, 3.5],
      target_resolution_A: 4.0,
      microscope: "FEI Titan Krios 300kV",
      detector: "Gatan K2 Summit",
      publication: "Wong et al. Cryo-EM structure of the Plasmodium falciparum 80S ribosome bound to cycloheximide. eLife 2014.",
    },
    sourceDataset: "/home/z/my-project/data/projects/test_d4",
  },
  {
    label: "Custom path",
    name: "Custom dataset",
    description: "",
    meta: { angpix: 1.0, kV: 300, Cs: 2.7, Q0: 0.1, particle_diameter: 120, symmetry: "C1" },
    sourceDataset: "",
  },
];

export function NewProjectDialog({ open, onOpenChange, onCreate }: Props) {
  const [tplIdx, setTplIdx] = useState(1); // default to EMPIAR
  const [name, setName] = useState(TEMPLATES[1].name);
  const [description, setDescription] = useState(TEMPLATES[1].description);
  const [sourcePath, setSourcePath] = useState(TEMPLATES[1].sourceDataset);
  const [angpix, setAngpix] = useState(String(TEMPLATES[1].meta.angpix));
  const [kV, setKV] = useState(String(TEMPLATES[1].meta.kV));
  const [particleDiameter, setParticleDiameter] = useState(String(TEMPLATES[1].meta.particle_diameter));
  const [symmetry, setSymmetry] = useState(String(TEMPLATES[1].meta.symmetry));
  const [binFactor, setBinFactor] = useState<string>("0"); // 0=auto,1=1x,2=2x,4=4x
  const [pathError, setPathError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<string>("");

  function pickTemplate(i: number) {
    setTplIdx(i);
    setName(TEMPLATES[i].name);
    setDescription(TEMPLATES[i].description);
    setSourcePath(TEMPLATES[i].sourceDataset);
    setAngpix(String(TEMPLATES[i].meta.angpix));
    setKV(String(TEMPLATES[i].meta.kV));
    setParticleDiameter(String(TEMPLATES[i].meta.particle_diameter));
    setSymmetry(String(TEMPLATES[i].meta.symmetry));
    setPathError(null);
  }

  async function checkPath() {
    if (!sourcePath.trim()) { setPathError("Path is required"); return false; }
    setChecking(true);
    setPathError(null);
    try {
      const res = await fetch(`/api/check-path?path=${encodeURIComponent(sourcePath.trim())}`);
      const d = await res.json();
      if (d.ok) {
        setPathError(null);
        return true;
      } else {
        setPathError(d.error || "Path not accessible");
        return false;
      }
    } catch {
      setPathError("Could not verify path");
      return false;
    } finally {
      setChecking(false);
    }
  }

  function create() {
    if (!sourcePath.trim()) {
      setPathError("Data path is required");
      return;
    }
    onCreate({
      name: name.trim() || "Untitled cryo-EM project",
      description: description.trim(),
      datasetMeta: {
        angpix: parseFloat(angpix) || 1.0,
        kV: parseFloat(kV) || 300,
        Cs: 2.7,
        Q0: 0.1,
        particle_diameter: parseFloat(particleDiameter) || 120,
        symmetry: symmetry || "C1",
        bin_factor: parseInt(binFactor, 10) || 0,
      },
      sourceDataset: sourcePath.trim(),
      executorMode: "real",
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto cryo-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="Microscope" className="h-4 w-4 text-emerald-400" />
            New cryo-EM project
          </DialogTitle>
          <DialogDescription>
            Select a dataset or enter a custom path. The agent will plan and run the RELION pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* template selector */}
          <div>
            <Label className="text-xs mb-1.5 block">Dataset</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => pickTemplate(i)}
                  className={cn(
                    "text-left px-2.5 py-2 rounded-md border text-[12px] transition-colors",
                    i === tplIdx
                      ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Load Example Data button */}
          <div className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <Icon name="Download" className="h-3.5 w-3.5 text-sky-400" />
                <span className="text-[11px] font-medium text-sky-300">Quick Start: Load Example Data</span>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={downloading}
                onClick={async () => {
                  setDownloading(true);
                  setDownloadProgress("Checking existing data...");
                  try {
                    setDownloadProgress("Downloading EMPIAR-10017 micrographs (bin2, 3.54 Å/px)...");
                    const res = await fetch("/api/download-empiar", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ maxMicrographs: 5, binFactor: 2 }),
                    });
                    const d = await res.json();
                    if (d.ok) {
                      setDownloadProgress(`✅ ${d.message}`);
                      // Auto-fill the form with the downloaded data path + params
                      setSourcePath(d.path);
                      setAngpix("3.54");
                      setKV("300");
                      setParticleDiameter("130");
                      setSymmetry("C1");
                      setBinFactor("1"); // data is already pre-binned
                      setName("EMPIAR-10017 β-gal (bin2 auto-loaded)");
                      setDescription(`Auto-downloaded EMPIAR-10017 bin2 data: ${d.nMicrographs} micrographs, 2048×2048 @ 3.54 Å/px — better particle signal than bin4`);
                      setPathError(null);
                      setTplIdx(1);
                    } else {
                      setDownloadProgress(`❌ Download failed: ${d.message || "unknown error"}`);
                    }
                  } catch (e: any) {
                    setDownloadProgress(`❌ Error: ${e?.message || "unknown"}`);
                  } finally {
                    setDownloading(false);
                    setTimeout(() => setDownloadProgress(""), 8000);
                  }
                }}
                className="shrink-0 gap-1.5 border-sky-500/40 text-sky-300 hover:bg-sky-500/10"
              >
                <Icon name={downloading ? "Loader2" : "Download"} className={cn("h-3.5 w-3.5", downloading && "animate-spin")} />
                {downloading ? "Downloading..." : "Download bin2"}
              </Button>
            </div>
            {downloadProgress && (
              <div className="text-[10px] text-muted-foreground mt-1.5 font-mono">{downloadProgress}</div>
            )}
            <div className="text-[9px] text-muted-foreground mt-1">
              Downloads 5 micrographs from EMPIAR-10017 (β-galactosidase), pre-binned to 2048×2048 @ 3.54 Å/px. Bin2 gives better particle signal than bin4 for clearer 2D classification.
            </div>
          </div>

          {/* data path */}
          <div>
            <Label htmlFor="np-path" className="text-xs mb-1.5 block flex items-center gap-1.5">
              <Icon name="FolderInput" className="h-3 w-3" />
              Data directory path
            </Label>
            <div className="flex gap-2">
              <Input
                id="np-path"
                value={sourcePath}
                onChange={(e) => { setSourcePath(e.target.value); setPathError(null); }}
                placeholder="/path/to/your/data (must contain Movies/ or Micrographs/ dir)"
                className={cn("font-mono text-[12px]", pathError && "border-rose-500/50")}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={checkPath}
                disabled={checking || !sourcePath.trim()}
                className="shrink-0 gap-1.5"
              >
                <Icon name={checking ? "Loader2" : "Check"} className={cn("h-3.5 w-3.5", checking && "animate-spin")} />
                {checking ? "…" : "Verify"}
              </Button>
            </div>
            {pathError ? (
              <div className="text-[10px] text-rose-400 mt-1 flex items-center gap-1">
                <Icon name="AlertCircle" className="h-3 w-3" />
                {pathError}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground mt-1">
                Path should contain a <code className="text-emerald-300">Movies/</code> (for .mrcs movie stacks) or <code className="text-emerald-300">Micrographs/</code> (for single-frame .mrc) directory.
              </div>
            )}
          </div>

          {/* project name */}
          <div>
            <Label htmlFor="np-name" className="text-xs mb-1.5 block">Project name</Label>
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          {/* description */}
          <div>
            <Label htmlFor="np-desc" className="text-xs mb-1.5 block">Description</Label>
            <Textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[50px] text-sm"
              placeholder="Microscope, sample, target resolution…"
            />
          </div>

          {/* optics parameters grid */}
          <div className="rounded-md border border-border/50 bg-muted/20 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <Icon name="Settings" className="h-3 w-3" />
              Acquisition parameters
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">Pixel size (Å)</Label>
                <Input value={angpix} onChange={(e) => setAngpix(e.target.value)} className="h-7 text-[12px] font-mono" type="number" step="0.001" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Voltage (kV)</Label>
                <Input value={kV} onChange={(e) => setKV(e.target.value)} className="h-7 text-[12px] font-mono" type="number" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Particle diameter (Å)</Label>
                <Input value={particleDiameter} onChange={(e) => setParticleDiameter(e.target.value)} className="h-7 text-[12px] font-mono" type="number" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Symmetry</Label>
                <Input value={symmetry} onChange={(e) => setSymmetry(e.target.value)} className="h-7 text-[12px] font-mono" placeholder="C1, D4, O…" />
              </div>
              <div className="col-span-2">
                <Label className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                  <Icon name="Layers" className="h-3 w-3" />
                  Micrograph binning (CPU speedup)
                </Label>
                <div className="grid grid-cols-4 gap-1.5 mt-1">
                  {[
                    { v: "0", label: "Auto", hint: "2x if >2048px" },
                    { v: "1", label: "1×", hint: "No binning" },
                    { v: "2", label: "2×", hint: "Half size" },
                    { v: "4", label: "4×", hint: "Quarter size" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setBinFactor(opt.v)}
                      className={cn(
                        "px-2 py-1.5 rounded-md border text-[11px] transition-colors text-center",
                        binFactor === opt.v
                          ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                          : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60",
                      )}
                      title={opt.hint}
                    >
                      <div className="font-semibold">{opt.label}</div>
                      <div className="text-[9px] text-muted-foreground mt-0.5">{opt.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} className="gap-1.5" disabled={!sourcePath.trim()}>
            <Icon name="Plus" className="h-4 w-4" />
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
