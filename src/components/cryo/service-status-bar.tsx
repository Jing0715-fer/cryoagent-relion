"use client";

import { useEffect, useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

interface ServiceInfo {
  id: string;
  name: string;
  port: number;
  color: string;
  ok: boolean;
  responseTime: number;
  detail: string;
}

const COLOR_MAP: Record<string, { dot: string; text: string; border: string; bg: string }> = {
  emerald: { dot: "bg-emerald-400", text: "text-emerald-300", border: "border-emerald-500/30", bg: "bg-emerald-500/5" },
  sky: { dot: "bg-sky-400", text: "text-sky-300", border: "border-sky-500/30", bg: "bg-sky-500/5" },
  violet: { dot: "bg-violet-400", text: "text-violet-300", border: "border-violet-500/30", bg: "bg-violet-500/5" },
};

export function ServiceStatusBar() {
  const [services, setServices] = useState<ServiceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/service-status", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setServices(data.services || []);
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 10000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function handleStart(serviceId: string) {
    setStarting(serviceId);
    try {
      await fetch("/api/service-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", service: serviceId }),
      });
      // Wait 3s then refresh
      setTimeout(refresh, 3000);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setStarting(null), 5000);
    }
  }

  async function handleStartAll() {
    setStarting("all");
    try {
      await fetch("/api/service-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start-all" }),
      });
      setTimeout(refresh, 3000);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setStarting(null), 5000);
    }
  }

  const downServices = services.filter((s) => !s.ok && s.id !== "dev");
  const allDown = downServices.length > 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <Icon name="Loader2" className="h-3 w-3 animate-spin" />
        Checking services…
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {services.map((s) => {
        const colors = COLOR_MAP[s.color] || COLOR_MAP.emerald;
        return (
          <div
            key={s.id}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px]",
              s.ok ? cn(colors.border, colors.bg) : "border-rose-500/30 bg-rose-500/5"
            )}
            title={s.detail}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                s.ok ? colors.dot : "bg-rose-400"
              )}
            />
            <span className={cn("font-medium", s.ok ? colors.text : "text-rose-300")}>
              {s.name}
            </span>
            <span className="text-muted-foreground font-mono">:{s.port}</span>
            {s.ok && (
              <span className="text-muted-foreground/60">{s.responseTime}ms</span>
            )}
            {!s.ok && s.id !== "dev" && (
              <button
                onClick={() => handleStart(s.id)}
                disabled={starting === s.id}
                className="ml-1 flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 transition-colors"
                title={`Start ${s.name}`}
              >
                {starting === s.id ? (
                  <Icon name="Loader2" className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Icon name="Play" className="h-2.5 w-2.5" />
                )}
                {starting === s.id ? "…" : "Start"}
              </button>
            )}
          </div>
        );
      })}
      {allDown && (
        <Button
          size="sm"
          variant="outline"
          onClick={handleStartAll}
          disabled={starting === "all"}
          className="h-6 gap-1 text-[10px] border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
        >
          {starting === "all" ? (
            <Icon name="Loader2" className="h-3 w-3 animate-spin" />
          ) : (
            <Icon name="Zap" className="h-3 w-3" />
          )}
          Start All
        </Button>
      )}
    </div>
  );
}
