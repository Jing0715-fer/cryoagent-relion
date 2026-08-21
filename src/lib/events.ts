// In-process pub-sub for SSE job events.
// The agent engine emits events here; the SSE route subscribes and
// streams them to the browser. In dev (Turbopack/HMR) and prod
// (single-server) this runs in the same Node process. For horizontal
// scaling, swap the listeners Map for Redis Pub/Sub.

import type * as http from "http";

export type JobEventKind = "started" | "progress" | "log" | "done" | "error";

export interface JobEvent {
  kind: JobEventKind;
  projectId: string;
  jobId: string;
  taskType: string;
  status?: string;
  progress?: number;
  data?: Record<string, unknown>;
}

type Listener = (ev: JobEvent) => void;
const listeners = new Map<string, Set<Listener>>();

// Ring buffer for late-attaching subscribers (e.g. reconnecting SSE clients).
const RECENT = 200;
const recent: JobEvent[] = [];
function pushRecent(ev: JobEvent): void {
  recent.push(ev);
  if (recent.length > RECENT) recent.shift();
}

function addListener(projectId: string, fn: Listener): void {
  let set = listeners.get(projectId);
  if (!set) {
    set = new Set();
    listeners.set(projectId, set);
  }
  set.add(fn);
}
function removeListener(projectId: string, fn: Listener): void {
  const set = listeners.get(projectId);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) listeners.delete(projectId);
}

export function emitJobEvent(ev: JobEvent): void {
  pushRecent(ev);
  const set = listeners.get(ev.projectId);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(ev);
    } catch {
      // never let a buggy subscriber kill the emitter
    }
  }
}

/** Subscribe to events for a project. Returns an unsubscribe function. */
export function subscribeProject(
  projectId: string,
  fn: Listener,
): () => void {
  addListener(projectId, fn);
  return () => removeListener(projectId, fn);
}

/** Get the recent-event buffer (for SSE replay). */
export function getRecentEvents(): readonly JobEvent[] {
  return recent;
}

// Silence unused-import warning when http is only used as a type
void (null as unknown as http.ServerResponse);
