"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Icon } from "./icon";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreate: (data: { name: string; description: string; datasetMeta: Record<string, unknown>; sourceDataset?: string; executorMode?: string }) => void;
}

const TEMPLATES = [
  {
    label: "Apoferritin (D4)",
    name: "Apoferritin SPA",
    description: "480 kDa apoferritin, 300 kV Krios, 0.885 Å/px, 32-frame movies",
    meta: { angpix: 0.885, kV: 300, Cs: 2.7, particle_diameter: 120, symmetry: "D4", target_resolution: 2.5 },
  },
  {
    label: "GroEL (D7)",
    name: "GroEL SPA",
    description: "800 kDa groEL, 300 kV, 0.83 Å/px, 40-frame movies, target 3 Å",
    meta: { angpix: 0.83, kV: 300, Cs: 2.7, particle_diameter: 140, symmetry: "D7", target_resolution: 3.0 },
  },
  {
    label: "Membrane protein (C1)",
    name: "Membrane protein SPA",
    description: "120 kDa membrane protein in nanodisc, 300 kV, 0.885 Å/px, C1",
    meta: { angpix: 0.885, kV: 300, Cs: 2.7, particle_diameter: 130, symmetry: "C1", target_resolution: 3.5 },
  },
  {
    label: "Custom",
    name: "Untitled cryo-EM project",
    description: "",
    meta: {},
  },
];

export function NewProjectDialog({ open, onOpenChange, onCreate }: Props) {
  const [tplIdx, setTplIdx] = useState(0);
  const [name, setName] = useState(TEMPLATES[0].name);
  const [description, setDescription] = useState(TEMPLATES[0].description);

  function pickTemplate(i: number) {
    setTplIdx(i);
    setName(TEMPLATES[i].name);
    setDescription(TEMPLATES[i].description);
  }

  function create() {
    onCreate({
      name: name.trim() || "Untitled cryo-EM project",
      description: description.trim(),
      datasetMeta: TEMPLATES[tplIdx].meta,
      sourceDataset: "/home/z/my-project/data/projects/test_d4",
      executorMode: "real",
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="Microscope" className="h-4 w-4 text-emerald-400" />
            New cryo-EM project
          </DialogTitle>
          <DialogDescription>
            Describe the dataset. The agent will use this to plan parameters automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs mb-1.5 block">Template</Label>
            <div className="grid grid-cols-2 gap-1.5">
              {TEMPLATES.map((t, i) => (
                <button
                  key={i}
                  onClick={() => pickTemplate(i)}
                  className={`text-left px-2.5 py-2 rounded-md border text-[12px] transition-colors ${
                    i === tplIdx
                      ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label htmlFor="np-name" className="text-xs mb-1.5 block">Project name</Label>
            <Input id="np-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <Label htmlFor="np-desc" className="text-xs mb-1.5 block">Description</Label>
            <Textarea
              id="np-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[60px] text-sm"
              placeholder="Microscope, sample, pixel size, target resolution…"
            />
          </div>

          {tplIdx < TEMPLATES.length - 1 && (
            <div className="rounded-md border border-border/50 bg-muted/20 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                Auto-filled metadata
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono">
                {Object.entries(TEMPLATES[tplIdx].meta).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="text-foreground">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} className="gap-1.5">
            <Icon name="Plus" className="h-4 w-4" />
            Create project
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
