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
    meta: { angpix: 1.77, kV: 300, Cs: 2.7, Q0: 0.1, particle_diameter: 130, symmetry: "C1" },
    sourceDataset: "/home/z/my-project/data/projects/empiar10017",
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
  const [pathError, setPathError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

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
