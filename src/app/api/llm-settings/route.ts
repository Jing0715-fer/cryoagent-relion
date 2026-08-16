import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

const SETTINGS_PATH = path.resolve(process.cwd(), ".dsh-home", "settings.yaml");

const PROVIDERS = [
  { id: "deepseek-official", name: "DeepSeek (Official)", ns: "llm-deepseek", models: [
    { id: "deepseek-v4-flash", name: "DeepSeek-V4-Flash (Latest)", contextWindow: 1000000 },
    { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro (Latest)", contextWindow: 1000000 },
    { id: "deepseek-chat", name: "DeepSeek-V3 Chat (Legacy)", contextWindow: 64000 },
    { id: "deepseek-reasoner", name: "DeepSeek-R1 Reasoner (Legacy)", contextWindow: 64000 },
  ]},
  { id: "openai", name: "OpenAI", ns: "llm-pi-ai", models: [
    { id: "gpt-5", name: "GPT-5 (Latest)", contextWindow: 200000 },
    { id: "gpt-5-mini", name: "GPT-5 Mini", contextWindow: 200000 },
    { id: "gpt-5-nano", name: "GPT-5 Nano", contextWindow: 200000 },
    { id: "gpt-4.1", name: "GPT-4.1", contextWindow: 1047576 },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini", contextWindow: 1047576 },
    { id: "gpt-4o", name: "GPT-4o", contextWindow: 128000 },
    { id: "o3", name: "o3", contextWindow: 200000 },
    { id: "o4-mini", name: "o4-mini", contextWindow: 200000 },
  ]},
  { id: "anthropic", name: "Anthropic (Claude)", ns: "llm-pi-ai", models: [
    { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5 (Latest)", contextWindow: 200000 },
    { id: "claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000 },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000 },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet (Legacy)", contextWindow: 200000 },
  ]},
  { id: "google", name: "Google (Gemini)", ns: "llm-pi-ai", models: [
    { id: "gemini-3-flash", name: "Gemini 3 Flash (Latest)", contextWindow: 1048576 },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro (Preview)", contextWindow: 1048576 },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 1048576 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1048576 },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1048576 },
  ]},
  { id: "mistral", name: "Mistral AI", ns: "llm-pi-ai", models: [
    { id: "mistral-large-latest", name: "Mistral Large (Latest)", contextWindow: 128000 },
    { id: "mistral-medium-latest", name: "Mistral Medium 3.5", contextWindow: 128000 },
    { id: "mistral-small-latest", name: "Mistral Small", contextWindow: 128000 },
    { id: "codestral-latest", name: "Codestral", contextWindow: 256000 },
    { id: "pixtral-large-latest", name: "Pixtral Large (Vision)", contextWindow: 128000 },
    { id: "magistral-medium-latest", name: "Magistral Medium (Reasoning)", contextWindow: 128000 },
  ]},
  { id: "minimax", name: "MiniMax", ns: "llm-pi-ai", models: [
    { id: "MiniMax-M2", name: "MiniMax-M2 (Latest)", contextWindow: 1000000 },
    { id: "MiniMax-M1", name: "MiniMax-M1", contextWindow: 1000000 },
    { id: "MiniMax-Text-01", name: "MiniMax-Text-01", contextWindow: 1000000 },
    { id: "abab6.5s-chat", name: "abab6.5s Chat (Legacy)", contextWindow: 245760 },
  ]},
  { id: "minimax-cn", name: "MiniMax (China)", ns: "llm-pi-ai", models: [
    { id: "MiniMax-M2", name: "MiniMax-M2 (Latest)", contextWindow: 1000000 },
    { id: "MiniMax-M1", name: "MiniMax-M1", contextWindow: 1000000 },
    { id: "abab6.5s-chat", name: "abab6.5s Chat (Legacy)", contextWindow: 245760 },
  ]},
  { id: "moonshotai", name: "Moonshot AI (Kimi)", ns: "llm-pi-ai", models: [
    { id: "kimi-k3", name: "Kimi K3 (Latest)", contextWindow: 131072 },
    { id: "kimi-k2", name: "Kimi K2 (Legacy)", contextWindow: 131072 },
    { id: "moonshot-v1-128k", name: "Moonshot v1 128K (Legacy)", contextWindow: 131072 },
    { id: "moonshot-v1-32k", name: "Moonshot v1 32K (Legacy)", contextWindow: 32768 },
  ]},
  { id: "moonshotai-cn", name: "Moonshot AI (Kimi China)", ns: "llm-pi-ai", models: [
    { id: "kimi-k3", name: "Kimi K3 (Latest)", contextWindow: 131072 },
    { id: "kimi-k2", name: "Kimi K2 (Legacy)", contextWindow: 131072 },
    { id: "moonshot-v1-128k", name: "Moonshot v1 128K (Legacy)", contextWindow: 131072 },
  ]},
  { id: "qwen-token-plan", name: "Qwen (Alibaba)", ns: "llm-pi-ai", models: [
    { id: "qwen3-max", name: "Qwen3-Max (Latest)", contextWindow: 131072 },
    { id: "qwen3-plus", name: "Qwen3-Plus", contextWindow: 131072 },
    { id: "qwen3-turbo", name: "Qwen3-Turbo", contextWindow: 1000000 },
    { id: "qwen-max", name: "Qwen Max (Legacy)", contextWindow: 32768 },
    { id: "qwen-long", name: "Qwen Long (10M ctx)", contextWindow: 10000000 },
  ]},
  { id: "groq", name: "Groq", ns: "llm-pi-ai", models: [
    { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B (Latest)", contextWindow: 131072 },
    { id: "llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick 17B (Latest)", contextWindow: 131072 },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B Versatile", contextWindow: 128000 },
    { id: "deepseek-r1-distill-llama-70b", name: "DeepSeek R1 Distill 70B", contextWindow: 131072 },
  ]},
  { id: "together", name: "Together AI", ns: "llm-pi-ai", models: [
    { id: "deepseek-ai/DeepSeek-V4-Pro", name: "DeepSeek V4 Pro (Latest)", contextWindow: 128000 },
    { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct-Turbo", name: "Llama 4 Scout (Latest)", contextWindow: 131072 },
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo", contextWindow: 128000 },
    { id: "Qwen/Qwen3-Max-Turbo", name: "Qwen3-Max Turbo (Latest)", contextWindow: 32768 },
  ]},
  { id: "fireworks", name: "Fireworks AI", ns: "llm-pi-ai", models: [
    { id: "accounts/fireworks/models/kimi-k2-7-code", name: "Kimi K2.7 Code (Latest)", contextWindow: 131072 },
    { id: "accounts/fireworks/models/minimax-m3", name: "MiniMax M3 (Latest)", contextWindow: 1000000 },
    { id: "accounts/fireworks/models/qwen3p7-plus", name: "Qwen 3.7 Plus (Latest)", contextWindow: 32768 },
    { id: "accounts/fireworks/models/deepseek-v4-pro", name: "DeepSeek V4 Pro", contextWindow: 128000 },
  ]},
  { id: "xai", name: "xAI (Grok)", ns: "llm-pi-ai", models: [
    { id: "grok-4", name: "Grok 4 (Latest)", contextWindow: 131072 },
    { id: "grok-4-mini", name: "Grok 4 Mini", contextWindow: 131072 },
    { id: "grok-3", name: "Grok 3 (Legacy)", contextWindow: 131072 },
    { id: "grok-2-vision", name: "Grok 2 Vision (Legacy)", contextWindow: 32768 },
  ]},
  { id: "openrouter", name: "OpenRouter", ns: "llm-pi-ai", models: [
    { id: "auto", name: "Auto (route to best)", contextWindow: 200000 },
  ]},
  { id: "zai", name: "Z.AI (GLM)", ns: "llm-pi-ai", models: [
    { id: "glm-5.2", name: "GLM-5.2 (Latest, 1M ctx)", contextWindow: 1000000 },
    { id: "glm-5", name: "GLM-5", contextWindow: 128000 },
    { id: "glm-4.6", name: "GLM-4.6 (Legacy)", contextWindow: 128000 },
    { id: "glm-4-flash", name: "GLM-4 Flash (Free)", contextWindow: 128000 },
  ]},
  { id: "nvidia", name: "NVIDIA NIM", ns: "llm-pi-ai", models: [
    { id: "meta/llama-3.3-70b-instruct", name: "Llama 3.3 70B", contextWindow: 128000 },
    { id: "meta/llama-3.1-405b-instruct", name: "Llama 3.1 405B", contextWindow: 128000 },
    { id: "deepseek-ai/deepseek-r1", name: "DeepSeek R1", contextWindow: 128000 },
    { id: "qwen/qwen2.5-72b-instruct", name: "Qwen 2.5 72B", contextWindow: 32768 },
  ]},
  { id: "cerebras", name: "Cerebras", ns: "llm-pi-ai", models: [
    { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout 17B (Latest)", contextWindow: 131072 },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B", contextWindow: 128000 },
    { id: "llama-3.1-8b", name: "Llama 3.1 8B", contextWindow: 128000 },
  ]},
  { id: "huggingface", name: "Hugging Face", ns: "llm-pi-ai", models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B", contextWindow: 128000 },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", contextWindow: 32768 },
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
