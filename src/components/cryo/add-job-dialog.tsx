"use client";

import { useState } from "react";
import { RELION_TASKS } from "@/lib/relion/tasks";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { toast } from "sonner";

interface Job { id: string; taskType: string; status: string; alias: string; }

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  projectId: string;
  existingJobs: Job[];
  onCreated: () => void;
}

// Manual job creation dialog — lets the user pick a RELION task type,
// set parameters, and choose which existing jobs to depend on.
export function AddJobDialog({ open, onOpenChange, projectId, existingJobs, onCreated }: Props) {
  const [selectedTask, setSelectedTask] = useState<string>("");
  const [alias, setAlias] = useState("");
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  function toggleDep(jobId: string) {
    setSelectedDeps(prev =>
      prev.includes(jobId) ? prev.filter(d => d !== jobId) : [...prev, jobId]
    );
  }

  async function create() {
    if (!selectedTask) { toast.error("Select a task type"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskType: selectedTask,
          alias: alias.trim(),
          dependsOn: selectedDeps,
          parameters: {},
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Job added: ${RELION_TASKS.find(t => t.key === selectedTask)?.name}`);
      onCreated();
      onOpenChange(false);
      setSelectedTask("");
      setAlias("");
      setSelectedDeps([]);
    } catch (e: any) {
      toast.error(e.message || "Failed to create job");
    } finally {
      setCreating(false);
    }
  }

  const doneJobs = existingJobs.filter(j => j.status === "done" || j.status === "skipped");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto cryo-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="PlusCircle" className="h-4 w-4 text-emerald-400" />
            Add job manually
          </DialogTitle>
          <DialogDescription>
            Choose a RELION task and connect it to upstream jobs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* task selector */}
          <div>
            <Label className="text-xs mb-1.5 block">RELION task</Label>
            <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto cryo-scroll">
              {RELION_TASKS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setSelectedTask(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-[12px] transition-colors text-left",
                    selectedTask === t.key
                      ? "border-emerald-500/60 bg-emerald-500/10 text-foreground"
                      : "border-border/60 bg-muted/30 text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  <Icon name={t.icon} className={cn("h-3 w-3 shrink-0", t.color)} />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* alias */}
          <div>
            <Label className="text-xs mb-1.5 block">Alias (optional)</Label>
            <Input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="e.g. class2d_round2" className="text-[12px] font-mono" />
          </div>

          {/* dependency selector */}
          {doneJobs.length > 0 && (
            <div>
              <Label className="text-xs mb-1.5 block">Depends on (upstream jobs)</Label>
              <div className="space-y-1 max-h-[150px] overflow-y-auto cryo-scroll">
                {doneJobs.map((j) => (
                  <button
                    key={j.id}
                    onClick={() => toggleDep(j.id)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-[11px] transition-colors",
                      selectedDeps.includes(j.id)
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                        : "border-border/40 bg-muted/20 text-muted-foreground hover:bg-muted/40",
                    )}
                  >
                    <Icon
                      name={selectedDeps.includes(j.id) ? "CheckSquare" : "Square"}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    <span className="truncate">{j.taskType}</span>
                    {j.alias && <span className="text-muted-foreground/60 text-[10px]">{j.alias}</span>}
                    <span className="ml-auto text-[9px] capitalize px-1 py-0.5 rounded bg-muted/40">{j.status}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={create} disabled={creating || !selectedTask} className="gap-1.5">
            <Icon name={creating ? "Loader2" : "Plus"} className={cn("h-4 w-4", creating && "animate-spin")} />
            {creating ? "Creating…" : "Add job"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
