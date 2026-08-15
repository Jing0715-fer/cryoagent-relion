"use client";

import { useEffect, useRef, useState } from "react";
import { Message } from "@/lib/types";
import { Markdown } from "./markdown";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

interface Props {
  projectId: string;
  messages: Message[];
  sending: boolean;
  onSend: (content: string) => void;
  running: boolean;
}

const SUGGESTIONS = [
  "Process a 300kV dataset, 0.885 Å/px movies of apoferritin (480 kDa), target 2.5 Å. Symmetry D4.",
  "Run motion correction + CTF + LoG autopicking on my groEL movies. I want 2D classes and an initial model.",
  "Take my 4 Å refine3d map and decide whether Bayesian polishing would help. Report the final resolution.",
  "Build the full SPA pipeline from import to local resolution for a membrane protein (~120 kDa), C1.",
];

export function ChatPanel({ projectId, messages, sending, onSend, running }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function submit() {
    const v = draft.trim();
    if (!v || sending) return;
    onSend(v);
    setDraft("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* messages */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto cryo-scroll px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground text-sm mt-10">
            <Icon name="MessageSquare" className="h-8 w-8 mx-auto mb-2 opacity-40" />
            Start the conversation to plan a workflow.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
        {sending && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground pl-1">
            <span className="h-2 w-2 rounded-full bg-emerald-400 cryo-pulse" />
            CryoAgent is planning…
          </div>
        )}
      </div>

      {/* suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s, i) => (
            <button
              key={i}
              onClick={() => setDraft(s)}
              className="text-[11px] rounded-full border border-border/60 bg-muted/40 hover:bg-muted/70 hover:border-emerald-500/40 px-2.5 py-1 text-muted-foreground transition-colors"
            >
              {s.length > 64 ? s.slice(0, 64) + "…" : s}
            </button>
          ))}
        </div>
      )}

      {/* input */}
      <div className="border-t border-border/60 p-3">
        <div className="relative">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe your cryo-EM dataset and goal — the agent will plan & run the full RELION pipeline…"
            className="min-h-[58px] max-h-[160px] resize-none bg-muted/30 pr-24 text-sm"
            disabled={sending}
          />
          <div className="absolute right-2 bottom-2 flex items-center gap-1.5">
            {running && (
              <span className="text-[10px] text-emerald-400 flex items-center gap-1 pr-1">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 cryo-pulse" />
                running
              </span>
            )}
            <Button size="sm" onClick={submit} disabled={sending || !draft.trim()} className="h-8 gap-1.5">
              <Icon name="Send" className="h-3.5 w-3.5" />
              Send
            </Button>
          </div>
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground px-1">
          Enter to send · Shift+Enter for a new line
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const isUser = m.role === "user";
  const isTool = m.role === "tool";
  const kind = (m.meta?.kind as string) || "";

  if (isTool) {
    // compact system/tool line (job-start announcements)
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono pl-2 border-l-2 border-emerald-500/40">
        <Icon name="PlayCircle" className="h-3 w-3 text-emerald-500/70" />
        {m.content}
      </div>
    );
  }

  return (
    <div className={cn("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "shrink-0 h-7 w-7 rounded-md grid place-items-center mt-0.5",
          isUser ? "bg-sky-500/20 text-sky-300" : "bg-emerald-500/15 text-emerald-300",
        )}
      >
        <Icon name={isUser ? "User" : "Microscope"} className="h-3.5 w-3.5" />
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3.5 py-2.5 border",
          isUser
            ? "bg-sky-500/10 border-sky-500/30 text-foreground"
            : "bg-card/60 border-border/60",
          kind === "decision" && "border-amber-500/40 bg-amber-500/5",
          kind === "summary" && "border-emerald-500/40 bg-emerald-500/5",
        )}
      >
        {isUser ? (
          <div className="text-sm whitespace-pre-wrap">{m.content}</div>
        ) : (
          <Markdown>{m.content}</Markdown>
        )}
      </div>
    </div>
  );
}
