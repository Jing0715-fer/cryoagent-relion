"use client";

import { useEffect, useState } from "react";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RELION_TASK_MAP } from "@/lib/relion/tasks";

interface FileGroup {
  jobId: string;
  taskType: string;
  alias: string;
  status: string;
  duration: number;
  finishedAt: string | null;
  primaryOutput: string;
  outputSummary: Record<string, number | string>;
  files: { path: string; size: number }[];
}

interface Props {
  projectId: string;
  refreshKey: number;
}

const IMG_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".webp"];
const MAP_EXTS = [".mrc", ".mrcs"];
const TEXT_EXTS = [".star", ".log", ".bild", ".json", ".txt"];

export function ResultsGallery({ projectId, refreshKey }: Props) {
  const [groups, setGroups] = useState<FileGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<{ path: string; kind: "image" | "text" | "map" | "binary" } | null>(null);
  const [previewContent, setPreviewContent] = useState<string>("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/job-files?projectId=${projectId}`, { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setGroups(data.groups || []);
      } catch {
        if (!cancelled) setGroups([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const t = setInterval(load, 15000);
    return () => { cancelled = true; clearInterval(t); };
  }, [projectId, refreshKey]);

  useEffect(() => {
    if (!preview) return;
    let cancelled = false;
    async function load() {
      const ext = preview.path.split(".").pop()?.toLowerCase() || "";
      if (TEXT_EXTS.includes("." + ext)) {
        try {
          const res = await fetch(`/api/files?projectId=${projectId}&path=${encodeURIComponent(preview.path)}`);
          const txt = await res.text();
          if (!cancelled) setPreviewContent(txt.slice(0, 20000));
        } catch {
          if (!cancelled) setPreviewContent("(failed to load)");
        }
      } else {
        setPreviewContent("");
      }
    }
    load();
    return () => { cancelled = true; };
  }, [preview, projectId]);

  const totalFiles = groups.reduce((n, g) => n + g.files.length, 0);
  const totalBytes = groups.reduce((n, g) => n + g.files.reduce((m, f) => m + f.size, 0), 0);

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading results…</div>;
  }

  if (groups.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-center text-sm text-muted-foreground p-8">
        <div>
          <div className="mx-auto mb-3 h-12 w-12 rounded-full bg-muted/40 grid place-items-center">
            <Icon name="FolderOpen" className="h-6 w-6 text-muted-foreground" />
          </div>
          No output files yet. Once the agent starts running jobs, real RELION outputs (star files, density maps, logs) will appear here for download and preview.
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex">
      {/* file tree */}
      <div className="flex-1 min-h-0 overflow-y-auto cryo-scroll p-3">
        <div className="flex items-center justify-between mb-3 px-1">
          <div className="text-[11px] text-muted-foreground">
            {totalFiles} files · {formatBytes(totalBytes)} · {groups.length} jobs
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] gap-1.5"
            onClick={() => setCollapsed((c) => {
              const allCollapsed = groups.every((g) => c[g.jobId]);
              const next: Record<string, boolean> = {};
              groups.forEach((g) => { next[g.jobId] = !allCollapsed; });
              return next;
            })}
          >
            <Icon name="FoldVertical" className="h-3 w-3" />
            Toggle all
          </Button>
        </div>

        {groups.map((g) => (
          <FileGroupRow
            key={g.jobId}
            group={g}
            projectId={projectId}
            collapsed={!!collapsed[g.jobId]}
            onToggle={() => setCollapsed((c) => ({ ...c, [g.jobId]: !c[g.jobId] }))}
            onPreview={(p) => setPreview(p)}
            activePreview={preview?.path}
          />
        ))}
      </div>

      {/* preview pane */}
      {preview && (
        <div className="w-[420px] shrink-0 border-l border-border/60 flex flex-col bg-card/30">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
            <Icon name="Eye" className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-[11px] font-mono truncate flex-1">{preview.path.split("/").pop()}</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setPreview(null)}>
              <Icon name="X" className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto cryo-scroll p-3">
            <PreviewBody
              preview={preview}
              content={previewContent}
              projectId={projectId}
            />
          </div>
          <div className="border-t border-border/60 p-2 flex gap-2">
            <Button
              size="sm"
              className="h-7 text-[11px] gap-1.5 flex-1"
              asChild
            >
              <a href={`/api/files?projectId=${projectId}&path=${encodeURIComponent(preview.path)}`} download>
                <Icon name="Download" className="h-3 w-3" />
                Download
              </a>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FileGroupRow({
  group, projectId, collapsed, onToggle, onPreview, activePreview,
}: {
  group: FileGroup; projectId: string; collapsed: boolean; onToggle: () => void;
  onPreview: (p: { path: string; kind: "image" | "text" | "map" | "binary" }) => void;
  activePreview: string | undefined;
}) {
  const t = RELION_TASK_MAP[group.taskType];
  const primary = group.primaryOutput;
  return (
    <div className="mb-2 rounded-md border border-border/50 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-2 bg-muted/30 hover:bg-muted/50 text-left"
      >
        <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <div className={cn("h-6 w-6 rounded grid place-items-center bg-background/60", t?.color)}>
          <Icon name={t?.icon || "Box"} className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-medium flex items-center gap-1.5">
            {t?.name || group.taskType}
            {group.alias && <span className="text-[10px] text-muted-foreground">· {group.alias}</span>}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {group.files.length} files · {formatBytes(group.files.reduce((n, f) => n + f.size, 0))}
            {group.duration > 0 && ` · ${group.duration}s`}
            {group.outputSummary.resolution_A != null && ` · ${group.outputSummary.resolution_A} Å`}
            {group.outputSummary.n_particles != null && ` · ${Number(group.outputSummary.n_particles).toLocaleString()} prt`}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "text-[9px] capitalize",
            group.status === "done" && "border-emerald-500/40 text-emerald-300",
            group.status === "failed" && "border-rose-500/40 text-rose-400",
            group.status === "running" && "border-amber-500/40 text-amber-300",
          )}
        >
          {group.status}
        </Badge>
      </button>
      {!collapsed && (
        <div className="divide-y divide-border/30">
          {group.files.map((f) => {
            const ext = "." + f.path.split(".").pop()?.toLowerCase();
            const kind: "image" | "text" | "map" | "binary" =
              IMG_EXTS.includes(ext) ? "image" :
              TEXT_EXTS.includes(ext) ? "text" :
              MAP_EXTS.includes(ext) ? "map" : "binary";
            const isPrimary = f.path === primary;
            return (
              <div
                key={f.path}
                className={cn(
                  "flex items-center gap-2 px-2.5 py-1.5 hover:bg-muted/30 group",
                  activePreview === f.path && "bg-emerald-500/10",
                )}
              >
                <FileIcon kind={kind} />
                <button
                  onClick={() => onPreview({ path: f.path, kind })}
                  className="text-[11px] font-mono truncate flex-1 text-left hover:text-emerald-300"
                  title={f.path}
                >
                  {f.path.split("/").pop()}
                </button>
                {isPrimary && (
                  <Badge variant="outline" className="text-[8px] px-1 py-0 border-emerald-500/40 text-emerald-300">
                    PRIMARY
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground shrink-0">{formatBytes(f.size)}</span>
                <a
                  href={`/api/files?projectId=${projectId}&path=${encodeURIComponent(f.path)}`}
                  download
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Download"
                >
                  <Icon name="Download" className="h-3.5 w-3.5 text-muted-foreground hover:text-emerald-300" />
                </a>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function FileIcon({ kind }: { kind: "image" | "text" | "map" | "binary" }) {
  const icon = kind === "image" ? "Image" : kind === "text" ? "FileText" : kind === "map" ? "Box" : "File";
  const color = kind === "image" ? "text-sky-400" : kind === "text" ? "text-amber-300" : kind === "map" ? "text-emerald-400" : "text-muted-foreground";
  return <Icon name={icon} className={cn("h-3.5 w-3.5 shrink-0", color)} />;
}

function PreviewBody({
  preview, content, projectId,
}: {
  preview: { path: string; kind: "image" | "text" | "map" | "binary" };
  content: string;
  projectId: string;
}) {
  if (preview.kind === "text") {
    return (
      <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-words text-slate-300 leading-relaxed">
        {content || "Loading…"}
      </pre>
    );
  }
  if (preview.kind === "map") {
    return (
      <div className="space-y-3">
        <div className="text-[11px] text-muted-foreground">
          MRC density map / particle stack — central slice preview:
        </div>
        {/* central slice preview */}
        <img
          src={`/api/files?projectId=${projectId}&path=${encodeURIComponent(preview.path)}&thumb=1`}
          alt={preview.path}
          className="w-full rounded-md border border-border/50 bg-black"
        />
        <div className="text-[10px] text-muted-foreground font-mono break-all">
          {preview.path}
        </div>
        <div className="text-[10px] text-muted-foreground">
          Download the .mrc/.mrcs file to open in ChimeraX, UCSF Chimera or relion_display.
        </div>
      </div>
    );
  }
  if (preview.kind === "image") {
    return (
      <img src={`/api/files?projectId=${projectId}&path=${encodeURIComponent(preview.path)}`} alt={preview.path} className="w-full rounded-md border border-border/50" />
    );
  }
  return (
    <div className="text-[11px] text-muted-foreground text-center py-8">
      <Icon name="File" className="h-8 w-8 mx-auto mb-2 opacity-40" />
      Binary file — use the Download button to inspect locally.
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
