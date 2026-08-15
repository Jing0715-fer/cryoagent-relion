"use client";

import { useState, useMemo } from "react";
import { RELION_TASKS, getTask } from "@/lib/relion/tasks";
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
// set ALL parameters (matching RELION GUI), and choose upstream dependencies.
export function AddJobDialog({ open, onOpenChange, projectId, existingJobs, onCreated }: Props) {
  const [selectedTask, setSelectedTask] = useState<string>("");
  const [alias, setAlias] = useState("");
  const [selectedDeps, setSelectedDeps] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Parameters state: keyed by param key, value is string (input is always string, converted on submit)
  const [paramValues, setParamValues] = useState<Record<string, string>>({});

  const task = useMemo(() => getTask(selectedTask), [selectedTask]);

  // Group parameters by their group field
  const groupedParams = useMemo(() => {
    if (!task) return {};
    const groups: Record<string, typeof task.parameters> = {};
    for (const p of task.parameters) {
      const g = p.group || "Parameters";
      if (!groups[g]) groups[g] = [];
      groups[g].push(p);
    }
    return groups;
  }, [task]);

  function selectTask(key: string) {
    setSelectedTask(key);
    // Initialize param values with defaults
    const t = getTask(key);
    if (t) {
      const vals: Record<string, string> = {};
      for (const p of t.parameters) {
        vals[p.key] = String(p.default);
      }
      setParamValues(vals);
    }
  }

  function updateParam(key: string, value: string) {
    setParamValues(prev => ({ ...prev, [key]: value }));
  }

  function toggleDep(jobId: string) {
    setSelectedDeps(prev =>
      prev.includes(jobId) ? prev.filter(d => d !== jobId) : [...prev, jobId]
    );
  }

  async function create() {
    if (!selectedTask || !task) { toast.error("Select a task type"); return; }
    setCreating(true);
    try {
      // Convert string values to proper types
      const typedParams: Record<string, string | number | boolean> = {};
      for (const p of task.parameters) {
        const raw = paramValues[p.key];
        if (raw === undefined || raw === "") continue;
        if (p.type === "int") typedParams[p.key] = parseInt(raw, 10);
        else if (p.type === "float") typedParams[p.key] = parseFloat(raw);
        else if (p.type === "bool") typedParams[p.key] = raw === "true" || raw === "1";
        else typedParams[p.key] = raw;
      }
      const res = await fetch("/api/jobs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskType: selectedTask,
          alias: alias.trim(),
          dependsOn: selectedDeps,
          parameters: typedParams,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Job added: ${task.name}`);
      onCreated();
      onOpenChange(false);
      setSelectedTask("");
      setAlias("");
      setSelectedDeps([]);
      setParamValues({});
    } catch (e: any) {
      toast.error(e.message || "Failed to create job");
    } finally {
      setCreating(false);
    }
  }

  const doneJobs = existingJobs.filter(j => j.status === "done" || j.status === "skipped");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto cryo-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="PlusCircle" className="h-4 w-4 text-emerald-400" />
            Add job manually
          </DialogTitle>
          <DialogDescription>
            Choose a RELION task, adjust all parameters (matching RELION GUI), and connect to upstream jobs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* task selector */}
          <div>
            <Label className="text-xs mb-1.5 block">RELION task</Label>
            <div className="grid grid-cols-3 gap-1.5 max-h-[180px] overflow-y-auto cryo-scroll">
              {RELION_TASKS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => selectTask(t.key)}
                  className={cn(
                    "flex items-center gap-1.5 px-2 py-1.5 rounded-md border text-[11px] transition-colors text-left",
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

          {/* parameters */}
          {task && (
            <div className="rounded-md border border-border/50 bg-muted/20 p-2.5">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Icon name="Settings" className="h-3 w-3" />
                  Parameters ({task.parameters.length})
                </Label>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-[10px] text-sky-300 hover:text-sky-200"
                >
                  {showAdvanced ? "Hide advanced" : "Show advanced"}
                </button>
              </div>
              <div className="space-y-3 max-h-[300px] overflow-y-auto cryo-scroll pr-1">
                {Object.entries(groupedParams).map(([group, params]) => {
                  const visibleParams = params.filter(p => showAdvanced || !p.advanced);
                  if (visibleParams.length === 0) return null;
                  return (
                    <div key={group}>
                      <div className="text-[9px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 font-semibold">{group}</div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                        {visibleParams.map((p) => (
                          <div key={p.key} className="space-y-0.5">
                            <Label className="text-[10px] text-muted-foreground flex items-center gap-1" title={p.help}>
                              {p.label}
                              {p.advanced && <span className="text-amber-400/60 text-[8px]">★</span>}
                            </Label>
                            {p.type === "bool" ? (
                              <select
                                value={paramValues[p.key] || "false"}
                                onChange={(e) => updateParam(p.key, e.target.value)}
                                className="w-full h-7 text-[11px] font-mono rounded-md border border-border/60 bg-background px-2"
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : p.type === "select" && p.options ? (
                              <select
                                value={paramValues[p.key] || ""}
                                onChange={(e) => updateParam(p.key, e.target.value)}
                                className="w-full h-7 text-[11px] font-mono rounded-md border border-border/60 bg-background px-2"
                              >
                                {p.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : (
                              <Input
                                value={paramValues[p.key] || ""}
                                onChange={(e) => updateParam(p.key, e.target.value)}
                                type={p.type === "int" || p.type === "float" ? "number" : "text"}
                                step={p.type === "float" ? "0.01" : "1"}
                                className="h-7 text-[11px] font-mono"
                                title={p.help}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* dependency selector */}
          {doneJobs.length > 0 && (
            <div>
              <Label className="text-xs mb-1.5 block">Depends on (upstream jobs)</Label>
              <div className="space-y-1 max-h-[120px] overflow-y-auto cryo-scroll">
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
