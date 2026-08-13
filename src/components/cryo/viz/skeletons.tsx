"use client";

import { cn } from "@/lib/utils";

// Loading skeleton component for better UX while data loads.
// Shows animated shimmer placeholders instead of blank spaces.
export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted/40", className)}>
      <div className="h-full w-full rounded-md bg-gradient-to-r from-transparent via-muted/60 to-transparent shimmer" />
      <style jsx>{`
        .shimmer {
          background-size: 200% 100%;
          animation: shimmer 1.5s infinite;
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  );
}

// Card skeleton — for viz panels that are loading
export function VizSkeleton({ title }: { title?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-card/30 overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-muted/20">
        <Skeleton className="h-3 w-3 rounded" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-[180px] w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// Grid skeleton — for class averages gallery
export function GridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className="aspect-square" />
      ))}
    </div>
  );
}

// Log skeleton — for live log panel
export function LogSkeleton() {
  return (
    <div className="rounded-md bg-black/60 border border-border/40 p-3 space-y-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-3" style={{ width: `${60 + Math.random() * 40}%` }} />
      ))}
    </div>
  );
}
