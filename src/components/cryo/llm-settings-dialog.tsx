"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Icon } from "./icon";
import { cn } from "@/lib/utils";

interface Provider { id: string; name: string; ns: string; models: { id: string; name: string; contextWindow: number }[] }
interface LLMSettings {
  activeProvider: string;
  activeModel: string;
  apiKey: string;
  apiKeyEnv: string;
  baseURL: string;
  providers: Provider[];
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export function LLMSettingsDialog({ open, onOpenChange }: Props) {
  const [settings, setSettings] = useState<LLMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/llm-settings");
        const data = await res.json();
        if (cancelled) return;
        setSettings(data);
        setProvider(data.activeProvider);
        setModel(data.activeModel);
        setApiKey(data.apiKey);
        setBaseURL(data.baseURL);
      } catch { if (!cancelled) setSettings(null); }
      finally { if (!cancelled) setLoading(false); }
    }
    load();
    return () => { cancelled = true; };
  }, [open]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/llm-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, model, apiKey, baseURL }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  }

  const selectedProvider = settings?.providers.find((p) => p.id === provider);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="Settings" className="h-4 w-4" />
            LLM Provider Settings
          </DialogTitle>
          <DialogDescription>
            Configure the LLM provider, model, API key, and endpoint for the DeepSeek Harness agent.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading settings…</div>
        ) : settings ? (
          <div className="space-y-4">
            {/* Provider */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Provider</Label>
              <Select value={provider} onValueChange={(v) => { setProvider(v); const p = settings.providers.find((p) => p.id === v); setModel(p?.models[0]?.id || ""); setBaseURL(""); }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  {settings.providers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-2">
                        <span>{p.name}</span>
                        {p.id === settings.activeProvider && (
                          <Badge variant="outline" className="text-[8px] py-0 px-1 border-emerald-500/40 text-emerald-300">active</Badge>
                        )}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Model — dropdown + manual input toggle */}
            {selectedProvider && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Model</Label>
                  <button
                    onClick={() => setModel("")}
                    className="text-[10px] text-muted-foreground hover:text-violet-300 underline"
                    title="Click to manually type a model ID not in the list"
                  >
                    ✏️ Manual input
                  </button>
                </div>
                {model && selectedProvider.models.length > 0 ? (
                  <Select value={model} onValueChange={setModel}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select model" />
                    </SelectTrigger>
                    <SelectContent>
                      {selectedProvider.models.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          <span className="flex items-center justify-between w-full">
                            <span>{m.name}</span>
                            <span className="text-[10px] text-muted-foreground ml-2">{(m.contextWindow / 1000).toFixed(0)}k ctx</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder="Enter model ID (e.g. MiniMax-M3, gpt-5.5, custom-model)"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="text-sm font-mono"
                  />
                )}
                {model && selectedProvider.models.find((m) => m.id === model) ? null : (
                  <p className="text-[10px] text-amber-300/70">
                    ⚠️ Manual model — not in preset list. Make sure your provider supports this model ID.
                  </p>
                )}
              </div>
            )}

            {/* API Key */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">API Key</Label>
              <Input
                type="password"
                placeholder="Enter API key…"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Stored in <code className="text-emerald-300">.env</code> as <code className="text-emerald-300">{provider === "deepseek-official" ? "DEEPSEEK_API_KEY" : provider === "custom" ? "CUSTOM_API_KEY" : `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`}</code>
              </p>
            </div>

            {/* Base URL */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Base URL (optional override)</Label>
              <Input
                placeholder={provider === "deepseek-official" ? "https://api.deepseek.com" : "Leave empty for provider default"}
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                className="text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground">
                Override the provider's default endpoint. Use this for proxies, gateways, or self-hosted instances.
              </p>
            </div>

            {/* Current settings summary */}
            <div className="rounded-md border border-border/50 bg-muted/20 p-2.5 text-[11px] text-muted-foreground space-y-0.5">
              <div className="flex justify-between">
                <span>Current provider:</span>
                <span className="text-foreground">{settings.activeProvider}</span>
              </div>
              <div className="flex justify-between">
                <span>Current model:</span>
                <span className="text-foreground">{settings.activeModel}</span>
              </div>
              <div className="flex justify-between">
                <span>API key env var:</span>
                <span className="text-emerald-300 font-mono">{settings.apiKeyEnv}</span>
              </div>
              <div className="flex justify-between">
                <span>Base URL:</span>
                <span className="text-foreground font-mono text-[10px]">{settings.baseURL || "(default)"}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-sm text-muted-foreground">Failed to load settings.</div>
        )}

        <DialogFooter className="gap-2">
          {saved && (
            <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300 mr-auto">
              <Icon name="Check" className="h-3 w-3 mr-1" />
              Saved
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={saving || loading}>
            {saving ? (
              <>
                <Icon name="Loader2" className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : "Save & Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
