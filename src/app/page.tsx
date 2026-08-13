"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/cryo/header";
import { ProjectSidebar } from "@/components/cryo/project-sidebar";
import { ChatPanel } from "@/components/cryo/chat-panel";
import { WorkflowDag } from "@/components/cryo/workflow-dag";
import { JobResultsView } from "@/components/cryo/job-results-view";
import { WorkflowTimeline } from "@/components/cryo/workflow-timeline";
import { AddJobDialog } from "@/components/cryo/add-job-dialog";
import { NewProjectDialog } from "@/components/cryo/new-project-dialog";
import { Icon } from "@/components/cryo/icon";
import { Project, Message, Workflow, Job, Decision } from "@/lib/types";
import { RELION_TASKS } from "@/lib/relion/tasks";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [viewJobId, setViewJobId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [addJobOpen, setAddJobOpen] = useState(false);

  // ---- load project list on mount -----------------------------------------
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setProjects(data.projects || []);
      } catch {
        // transient — retry on next interval
      }
    })();
  }, []);

  // auto-select first project, or open the new-project dialog if there are none
  useEffect(() => {
    if (projects.length > 0 && !selectedId) {
      setSelectedId(projects[0].id);
    } else if (projects.length === 0 && !selectedId) {
      setNewProjectOpen(true);
    }
  }, [projects, selectedId]);

  // ---- messages + workflow + decisions polling ----------------------------
  const refreshProject = useCallback(async (id: string) => {
    // Defensive: wrap each fetch in try/catch so transient network errors
    // (e.g. dev server restarting) don't throw "Failed to fetch" out of the
    // polling loop and kill the UI.
    async function safeJson(url: string): Promise<any> {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) return null;
        return await r.json();
      } catch {
        return null;
      }
    }
    const [m, w, d] = await Promise.all([
      safeJson(`/api/messages?projectId=${id}`),
      safeJson(`/api/workflow?projectId=${id}`),
      safeJson(`/api/decisions?projectId=${id}`),
    ]);
    if (m) setMessages(m.messages || []);
    if (w) setWorkflow(w.workflow || null);
    if (d) setDecisions(d.decisions || []);
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    refreshProject(selectedId);
    // Poll while project is running
    const iv = setInterval(() => refreshProject(selectedId), 1500);
    return () => clearInterval(iv);
  }, [selectedId, refreshProject]);

  const isRunning = workflow?.status === "running";

  // ---- trigger agent run ticks while running ------------------------------
  useEffect(() => {
    if (!selectedId || !isRunning) return;
    let cancelled = false;
    async function tick() {
      try {
        await fetch(`/api/agent/run?projectId=${selectedId}`, { method: "POST" });
      } catch {
        /* ignore */
      }
      if (!cancelled) setTimeout(tick, 1100);
    }
    tick();
    return () => {
      cancelled = true;
    };
  }, [selectedId, isRunning]);

  // ---- refresh project list occasionally to update statuses ---------------
  useEffect(() => {
    const t = setInterval(async () => {
      try {
        const res = await fetch("/api/projects", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        setProjects(data.projects || []);
      } catch {
        // ignore transient errors
      }
    }, 4000);
    return () => clearInterval(t);
  }, []);

  // ---- handlers -----------------------------------------------------------
  async function handleNewProject(data: { name: string; description: string; datasetMeta: Record<string, unknown>; sourceDataset?: string; executorMode?: string }) {
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const { project } = await res.json();
      setProjects((p) => [project, ...p]);
      setSelectedId(project.id);
      setNewProjectOpen(false);
      toast.success(`Created project "${project.name}" — running real RELION on CPU`);
    } catch {
      toast.error("Failed to create project");
    }
  }

  async function handleSend(content: string) {
    if (!selectedId) return;
    setSending(true);
    // optimistic user message
    setMessages((m) => [...m, {
      id: `opt-${Date.now()}`,
      projectId: selectedId,
      role: "user",
      content,
      meta: {},
      createdAt: new Date().toISOString(),
    }]);
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: selectedId, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      await refreshProject(selectedId);
      toast.success("Workflow planned");
    } catch (e: any) {
      toast.error(e.message || "Agent failed to plan");
    } finally {
      setSending(false);
    }
  }

  // ---- export project as zip ----------------------------------------------
  async function handleExport() {
    if (!selectedId) return;
    setExporting(true);
    try {
      const res = await fetch(`/api/export?projectId=${selectedId}`);
      if (!res.ok) throw new Error("export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cryoagent-${selectedId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Project exported as .zip");
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  // ---- derived ------------------------------------------------------------
  const selectedProject = projects.find((p) => p.id === selectedId) || null;
  const jobs = workflow?.jobs || [];
  const nDone = jobs.filter((j) => j.status === "done" || j.status === "skipped").length;
  const resolution = (() => {
    const post = jobs.find((j) => j.taskType === "postprocess");
    const refine = jobs.find((j) => j.taskType === "refine3d");
    const r = post?.outputSummary.resolution_A ?? refine?.outputSummary.resolution_A;
    return r != null ? String(r) : null;
  })();

  const selectedJob: Job | null = jobs.find((j) => j.id === selectedJobId) || null;
  const viewJob: Job | null = jobs.find((j) => j.id === viewJobId) || null;

  // ---- retry a failed job -------------------------------------------------
  async function handleRetry(jobId: string) {
    try {
      const res = await fetch(`/api/jobs/retry?jobId=${jobId}`, { method: "POST" });
      if (!res.ok) throw new Error("retry failed");
      // reset workflow + project to running so the tick loop resumes
      if (selectedId) {
        await db_updateProjectRunning(selectedId);
      }
      toast.success("Job retried — agent will continue");
      setViewJobId(null);
    } catch (e: any) {
      toast.error(e.message || "Retry failed");
    }
  }
  // helper to flip project/workflow back to running after a retry
  async function db_updateProjectRunning(pid: string) {
    try {
      await fetch(`/api/agent/run?projectId=${pid}`, { method: "POST" });
    } catch { /* ignore */ }
  }

  // auto-select running or last done job for convenience
  useEffect(() => {
    if (!selectedJobId && jobs.length) {
      const running = jobs.find((j) => j.status === "running");
      const lastDone = [...jobs].reverse().find((j) => j.status === "done");
      const t = running || lastDone;
      if (t) setSelectedJobId(t.id);
    }
  }, [jobs, selectedJobId]);

  return (
    <div className="h-screen flex flex-col bg-background text-foreground">
      <Header
        projectName={selectedProject?.name || "—"}
        status={selectedProject?.status || "idle"}
        resolution={resolution}
        nJobs={jobs.length}
        nDone={nDone}
        taskCatalogCount={RELION_TASKS.length}
        projectId={selectedId}
        onExport={handleExport}
        exporting={exporting}
      />

      {/* 3-pane body */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)_minmax(0,1.35fr)] xl:grid-cols-[240px_minmax(0,1fr)_minmax(0,1.5fr)]">
        {/* left: projects + decisions */}
        <aside className="hidden lg:flex flex-col border-r border-border/60 bg-card/20 min-h-0">
          <ProjectSidebar
            projects={projects}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onNew={() => setNewProjectOpen(true)}
            decisions={decisions}
          />
        </aside>

        {/* center: chat */}
        <main className="flex flex-col min-h-0 border-r border-border/60">
          {selectedId ? (
            <ChatPanel
              projectId={selectedId}
              messages={messages}
              sending={sending}
              onSend={handleSend}
              running={!!isRunning}
            />
          ) : (
            <div className="flex-1 grid place-items-center text-muted-foreground text-sm">
              Create a project to get started.
            </div>
          )}
        </main>

        {/* right: workflow DAG (click a job → per-job results page) */}
        <section className="flex flex-col min-h-0">
          {viewJob ? (
            <JobResultsView
              projectId={selectedId}
              job={viewJob}
              onBack={() => setViewJobId(null)}
              onRetry={handleRetry}
            />
          ) : (
            <div className="flex flex-col h-full min-h-0">
              <div className="border-b border-border/60 px-3 py-2 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                  <Icon name="Workflow" className="h-3.5 w-3.5" />
                  Workflow
                </div>
                <div className="flex items-center gap-2">
                  {jobs.length > 0 && (
                    <div className="text-[10px] text-muted-foreground">
                      {nDone}/{jobs.length} done · click a job to inspect
                    </div>
                  )}
                  {selectedId && (
                    <Button variant="outline" size="sm" onClick={() => setAddJobOpen(true)} className="h-7 gap-1 text-[11px]">
                      <Icon name="Plus" className="h-3 w-3" />
                      Add job
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <WorkflowDag
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  onSelectJob={(id) => { setSelectedJobId(id); setViewJobId(id); }}
                />
              </div>
              {jobs.length > 0 && (
                <div className="shrink-0 max-h-[240px] overflow-y-auto cryo-scroll border-t border-border/60 p-2">
                  <WorkflowTimeline
                    jobs={jobs}
                    onSelectJob={(id) => { setSelectedJobId(id); setViewJobId(id); }}
                    selectedJobId={selectedJobId}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* footer */}
      <footer className="border-t border-border/60 bg-card/40 px-4 py-1.5 flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <Icon name="Cpu" className="h-3 w-3" />
            simulated RELION executor
          </span>
          <span className="flex items-center gap-1">
            <Icon name="Brain" className="h-3 w-3" />
            LLM-driven planning & decisions
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span>{RELION_TASKS.length} RELION tasks available</span>
          <span className="text-muted-foreground/70">CryoAgent · built on Prime Agent framework</span>
        </div>
      </footer>

      <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} onCreate={handleNewProject} />
      {selectedId && (
        <AddJobDialog
          open={addJobOpen}
          onOpenChange={setAddJobOpen}
          projectId={selectedId}
          existingJobs={jobs}
          onCreated={() => { if (selectedId) refreshProject(selectedId); }}
        />
      )}
    </div>
  );
}
