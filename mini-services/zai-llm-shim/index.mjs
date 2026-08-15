// z-ai OpenAI-compatible LLM shim
//
// Exposes an OpenAI-compatible /v1/chat/completions endpoint backed by the
// z-ai-web-dev-sdk. Lets DeepSeek Harness's `dsh-llm-deepseek` adapter (which
// speaks the OpenAI /chat/completions protocol) drive the z-ai GLM model
// without a DEEPSEEK_API_KEY.
//
// Routing:
//   - If any message has multimodal content (image_url / video_url / file_url),
//     use client.chat.completions.createVision (the VLM).
//   - Otherwise use client.chat.completions.create (the text LLM).
//
// Endpoints:
//   POST /v1/chat/completions   (OpenAI streaming SSE or full JSON)
//   GET  /v1/models            (declares the zai models)
//   GET  /healthz
//
// Port: 3005 (set by ZAI_SHIM_PORT env).
import http from "node:http";
import ZAI from "z-ai-web-dev-sdk";

const PORT = Number(process.env.ZAI_SHIM_PORT) || 3005;
const MODEL_TEXT = "glm-4.6";
const MODEL_VISION = "glm-4.5v";

let _zai = null;
async function zai() {
  if (!_zai) _zai = await ZAI.create();
  return _zai;
}

// Detect multimodal (vision) messages: any user/assistant message whose
// content is an array containing a non-text part.
function isVisionRequest(messages) {
  return messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((c) => c.type && c.type !== "text"),
  );
}

// Flatten multimodal content into a plain string for text-only LLM fallback.
function flattenContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((c) => {
      if (c.type === "text") return c.text ?? "";
      if (c.type === "image_url") return `[image: ${c.image_url?.url?.slice(0, 40) ?? ""}...]`;
      return `[${c.type}]`;
    })
    .join("\n");
}

// Normalize OpenAI messages to z-ai shape.
function toZaiMessages(messages, vision) {
  return messages.map((m) => {
    if (vision) {
      return { role: m.role, content: m.content };
    }
    return { role: m.role, content: flattenContent(m.content) };
  });
}

function makeChunk(content, model, finish) {
  return {
    id: "chatcmpl-zai-" + Math.random().toString(36).slice(2, 10),
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: finish ? {} : { content },
        finish_reason: finish ?? null,
      },
    ],
  };
}

function makeFullResponse(text, model) {
  return {
    id: "chatcmpl-zai-" + Math.random().toString(36).slice(2, 10),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

async function handleCompletions(req, res, body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return sendJSON(res, 400, { error: { message: "Invalid JSON: " + e.message } });
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const stream = parsed.stream === true;
  const thinking =
    parsed.thinking && parsed.thinking.type
      ? { type: parsed.thinking.type }
      : { type: "disabled" };
  const vision = isVisionRequest(messages);
  const model = vision ? MODEL_VISION : MODEL_TEXT;

  let result;
  try {
    const client = await zai();
    const zaiMessages = toZaiMessages(messages, vision);
    if (vision) {
      result = await client.chat.completions.createVision({
        model,
        messages: zaiMessages,
        thinking,
      });
    } else {
      result = await client.chat.completions.create({
        messages: zaiMessages,
        thinking,
      });
    }
  } catch (e) {
    console.error("[zai-shim] LLM call failed:", e.message);
    return sendJSON(res, 502, {
      error: { message: "z-ai LLM call failed: " + e.message, type: "upstream_error" },
    });
  }

  const text = result?.choices?.[0]?.message?.content ?? "";

  if (!stream) {
    return sendJSON(res, 200, makeFullResponse(text, model));
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  write(makeChunk("", model, null));
  const pieceSize = 8;
  for (let i = 0; i < text.length; i += pieceSize) {
    write(makeChunk(text.slice(i, i + pieceSize), model, null));
  }
  write(makeChunk("", model, "stop"));
  res.write("data: [DONE]\n\n");
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/healthz") {
    return sendJSON(res, 200, { ok: true, service: "zai-llm-shim", port: PORT });
  }
  if (req.method === "GET" && url.pathname === "/v1/models") {
    return sendJSON(res, 200, {
      object: "list",
      data: [
        { id: MODEL_TEXT, object: "model", owned_by: "z-ai" },
        { id: MODEL_VISION, object: "model", owned_by: "z-ai" },
      ],
    });
  }
  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body = "";
    for await (const chunk of req) body += chunk;
    return handleCompletions(req, res, body);
  }
  sendJSON(res, 404, { error: { message: "Not found: " + url.pathname } });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[zai-llm-shim] listening on http://127.0.0.1:${PORT}`);
  console.log(`[zai-llm-shim] text model: ${MODEL_TEXT}, vision model: ${MODEL_VISION}`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
