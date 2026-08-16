import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const SETTINGS_PATH = path.resolve(process.cwd(), ".dsh-home", "settings.yaml");

const PROVIDERS = [
  { id: "deepseek-official", name: "DeepSeek (Official)", ns: "llm-deepseek", models: [
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash", contextWindow: 1000000 },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", contextWindow: 1000000 },
  ]},
  { id: "openai", name: "OpenAI", ns: "llm-pi-ai", models: [
    { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000 },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000 },
    { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1047576 },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 1047576 },
    { id: "o3-mini", name: "o3-mini", contextWindow: 200000 },
  ]},
  { id: "anthropic", name: "Anthropic (Claude)", ns: "llm-pi-ai", models: [
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000 },
    { id: "claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000 },
  ]},
  { id: "google", name: "Google (Gemini)", ns: "llm-pi-ai", models: [
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1048576 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1048576 },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1048576 },
  ]},
  { id: "mistral", name: "Mistral AI", ns: "llm-pi-ai", models: [
    { id: "mistral-large-latest", name: "Mistral Large", contextWindow: 128000 },
    { id: "codestral-latest", name: "Codestral", contextWindow: 256000 },
    { id: "mistral-small-latest", name: "Mistral Small", contextWindow: 128000 },
  ]},
  { id: "groq", name: "Groq", ns: "llm-pi-ai", models: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", contextWindow: 128000 },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant", contextWindow: 128000 },
  ]},
  { id: "together", name: "Together AI", ns: "llm-pi-ai", models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", contextWindow: 128000 },
  ]},
  { id: "fireworks", name: "Fireworks AI", ns: "llm-pi-ai", models: [
    { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 128000 },
  ]},
  { id: "xai", name: "xAI (Grok)", ns: "llm-pi-ai", models: [
    { id: "grok-3", name: "Grok 3", contextWindow: 131072 },
    { id: "grok-3-mini", name: "Grok 3 Mini", contextWindow: 131072 },
  ]},
  { id: "openrouter", name: "OpenRouter", ns: "llm-pi-ai", models: [
    { id: "auto", name: "Auto (route to best)", contextWindow: 200000 },
  ]},
  { id: "zai", name: "Z.AI (GLM)", ns: "llm-pi-ai", models: [
    { id: "glm-4.6", name: "GLM-4.6", contextWindow: 128000 },
    { id: "glm-4.5v", name: "GLM-4.5V (Vision)", contextWindow: 128000 },
  ]},
  { id: "custom", name: "Custom (OpenAI-compatible)", ns: "llm-pi-ai", models: [] },
];

export async function GET() {
  try {
    let settings: Record<string, any> = {};
    if (fs.existsSync(SETTINGS_PATH)) {
      const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
      settings = yaml.load(raw) as Record<string, any> || {};
    }
    const ds = settings["llm-deepseek"] || {};
    const pi = settings["llm-pi-ai"]?.providers || {};
    let activeProvider = "deepseek-official";
    let activeModel = "deepseek-v4-flash";
    let apiKeyEnv = ds.apiKeyEnv || "DEEPSEEK_API_KEY";
    let baseURL = ds.baseURL || "";
    for (const [pid, cfg] of Object.entries(pi)) {
      if (cfg && typeof cfg === "object") {
        activeProvider = pid;
        apiKeyEnv = (cfg as any).apiKeyEnv || `${pid.toUpperCase().replace(/-/g, "_")}_API_KEY`;
        baseURL = (cfg as any).baseURL || "";
        if ((cfg as any).models?.[0]?.id) activeModel = (cfg as any).models[0].id;
        break;
      }
    }
    const apiKey = process.env[apiKeyEnv] || "";
    return NextResponse.json({ activeProvider, activeModel, apiKey, apiKeyEnv, baseURL, providers: PROVIDERS });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider: providerId, model: modelId, apiKey, baseURL } = body;
    const provider = PROVIDERS.find((p) => p.id === providerId);
    if (!provider) return NextResponse.json({ error: `Unknown provider: ${providerId}` }, { status: 400 });

    const envVarName = providerId === "deepseek-official" ? "DEEPSEEK_API_KEY"
      : providerId === "custom" ? "CUSTOM_API_KEY"
      : `${providerId.toUpperCase().replace(/-/g, "_")}_API_KEY`;

    // Write API key to .env
    const envPath = path.resolve(process.cwd(), ".env");
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
    const envLines = envContent.split("\n").filter((l) => !l.startsWith(`${envVarName}=`));
    if (apiKey) envLines.push(`${envVarName}=${apiKey}`);
    fs.writeFileSync(envPath, envLines.filter((l) => l.trim()).join("\n") + "\n");
    if (apiKey) process.env[envVarName] = apiKey;

    // Load + update settings.yaml
    let settings: Record<string, any> = {};
    if (fs.existsSync(SETTINGS_PATH)) settings = yaml.load(fs.readFileSync(SETTINGS_PATH, "utf8")) as Record<string, any> || {};

    if (provider.ns === "llm-deepseek") {
      settings["llm-deepseek"] = { apiKeyEnv: envVarName, baseURL: baseURL || "https://api.deepseek.com", thinking: "disabled", reasoningEffort: "off" };
      delete settings["llm-pi-ai"];
    } else {
      if (!settings["llm-pi-ai"]) settings["llm-pi-ai"] = {};
      if (!settings["llm-pi-ai"].providers) settings["llm-pi-ai"].providers = {};
      const cfg: Record<string, any> = { apiKeyEnv: envVarName };
      if (providerId === "custom") {
        cfg.api = "openai-completions";
        cfg.baseURL = baseURL || "";
        cfg.displayName = "Custom Provider";
        cfg.models = body.models || [];
      } else {
        if (baseURL) cfg.baseURL = baseURL;
        if (modelId) {
          const m = provider.models.find((m) => m.id === modelId);
          if (m) cfg.models = [{ id: m.id, name: m.name, contextWindow: m.contextWindow }];
        }
      }
      // Clear all other pi-ai providers (only one active at a time)
      settings["llm-pi-ai"].providers = { [providerId]: cfg };
      // Keep deepseek pointing at the shim as fallback
      settings["llm-deepseek"] = settings["llm-deepseek"] || { apiKeyEnv: "DEEPSEEK_API_KEY", baseURL: "http://127.0.0.1:3005/v1", thinking: "disabled", reasoningEffort: "off" };
    }

    fs.mkdirSync(path.dirname(SETTINGS_PATH), { recursive: true });
    fs.writeFileSync(SETTINGS_PATH, yaml.dump(settings, { indent: 2, lineWidth: 120 }));

    return NextResponse.json({ ok: true, provider: providerId, model: modelId, apiKeyEnv: envVarName, baseURL: baseURL || "", settings });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
