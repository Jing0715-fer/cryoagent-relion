"use client";

import { useCallback, useEffect, useState } from "react";
import { Header } from "@/components/cryo/header";
import { ProjectSidebar } from "@/components/cryo/project-sidebar";
import { ChatPanel } from "@/components/cryo/chat-panel";
import { WorkflowDag } from "@/components/cryo/workflow-dag";
import { JobDetail } from "@/components/cryo/job-detail";
import { ResultsGallery } from "@/components/cryo/results-gallery";
import { VisualizationsDashboard } from "@/components/cryo/visualizations-dashboard";
import { NewProjectDialog } from "@/components/cryo/new-project-dialog";
import { Icon } from "@/components/cryo/icon";
import { Project, Message, Workflow, Job, Decision } from "@/lib/types";
import { RELION_TASKS } from "@/lib/relion/tasks";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("workflow");

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

        {/* right: workflow + job detail (tabbed) */}
        <section className="flex flex-col min-h-0">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
            <div className="border-b border-border/60 px-2 pt-2">
              <TabsList className="bg-transparent p-0 h-9">
                <TabsTrigger value="workflow" className="gap-1.5 text-xs">
                  <Icon name="Workflow" className="h-3.5 w-3.5" />
                  Workflow
                </TabsTrigger>
                <TabsTrigger value="job" className="gap-1.5 text-xs">
                  <Icon name="Terminal" className="h-3.5 w-3.5" />
                  Job inspector
                </TabsTrigger>
                <TabsTrigger value="viz" className="gap-1.5 text-xs">
                  <Icon name="BarChart3" className="h-3.5 w-3.5" />
                  Visualizations
                </TabsTrigger>
                <TabsTrigger value="results" className="gap-1.5 text-xs">
                  <Icon name="FolderOpen" className="h-3.5 w-3.5" />
                  Results
                </TabsTrigger>
                <TabsTrigger value="catalog" className="gap-1.5 text-xs">
                  <Icon name="Library" className="h-3.5 w-3.5" />
                  RELION tasks
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="workflow" className="flex-1 min-h-0 m-0 p-0">
              <div className="h-full min-h-0">
                <WorkflowDag
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  onSelectJob={(id) => { setSelectedJobId(id); setActiveTab("job"); }}
                />
              </div>
            </TabsContent>

            <TabsContent value="job" className="flex-1 min-h-0 m-0 p-0">
              <JobDetail job={selectedJob} />
            </TabsContent>

            <TabsContent value="viz" className="flex-1 min-h-0 m-0 p-0">
              {selectedId && <VisualizationsDashboard projectId={selectedId} refreshKey={jobs.length + nDone} />}
            </TabsContent>

            <TabsContent value="results" className="flex-1 min-h-0 m-0 p-0">
              {selectedId && <ResultsGallery projectId={selectedId} refreshKey={jobs.length + nDone} />}
            </TabsContent>

            <TabsContent value="catalog" className="flex-1 min-h-0 m-0 p-0 overflow-y-auto cryo-scroll">
              <TaskCatalog />
            </TabsContent>
          </Tabs>
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
    </div>
  );
}

// ---- RELION task catalog (right tab) --------------------------------------
function TaskCatalog() {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="p-3 space-y-1.5">
      <div className="text-[11px] text-muted-foreground mb-1 px-1">
        The full RELION task set the agent can plan with. Click to expand parameters.
      </div>
      {RELION_TASKS.map((t) => (
        <div key={t.key} className="rounded-md border border-border/50 bg-muted/20 overflow-hidden">
          <button
            onClick={() => setOpen((o) => ({ ...o, [t.key]: !o[t.key] }))}
            className="w-full flex items-center gap-2.5 px-2.5 py-2 text-left hover:bg-muted/40"
          >
            <div className={`h-7 w-7 rounded-md grid place-items-center bg-background/60 ${t.color}`}>
              <Icon name={t.icon} className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium">{t.name}</div>
              <div className="text-[10px] text-muted-foreground truncate">{t.description}</div>
            </div>
            <Icon name={open[t.key] ? "ChevronDown" : "ChevronRight"} className="h-4 w-4 text-muted-foreground" />
          </button>
          {open[t.key] && (
            <div className="px-2.5 pb-2.5 pt-1 border-t border-border/40">
              <div className="text-[11px] text-muted-foreground mb-1.5">{t.decisionHints.when}</div>
              <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] mb-2">
                {t.parameters.map((p) => (
                  <div key={p.key} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                    <span className="font-mono text-muted-foreground shrink-0">--{p.key}</span>
                    <span className="font-mono text-foreground text-right truncate">{String(p.default)}</span>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-amber-300/80 bg-amber-500/5 border border-amber-500/20 rounded px-2 py-1">
                <span className="font-medium">Decides:</span> {t.decisionHints.decides}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
