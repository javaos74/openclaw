#!/usr/bin/env node
/**
 * kiro-openai-proxy
 *
 * Spawns `kiro-cli acp` and exposes an OpenAI-compatible
 * POST /v1/chat/completions endpoint so OpenClaw can use
 * Kiro CLI as an LLM provider.
 */

import { ClientSideConnection, PROTOCOL_VERSION, ndJsonStream } from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { Readable, Writable } from "node:stream";

const PORT = parseInt(process.env.KIRO_PROXY_PORT || "18800", 10);
const KIRO_CMD = process.env.KIRO_CMD || "kiro-cli";

// ── ACP connection to kiro-cli ──────────────────────────────────

let client = null;
let sessionId = null;
let acpProcess = null;
/** Chunks collected during a prompt turn */
let pendingChunks = [];
/** Resolve function for the current prompt's streaming collector */
let chunkListener = null;

function onSessionUpdate(notification) {
  const u = notification.update;
  if (u.sessionUpdate === "agent_message_chunk" && u.content?.type === "text") {
    const text = u.content.text;
    if (chunkListener) chunkListener(text);
    else pendingChunks.push(text);
  }
}

async function ensureAcp() {
  if (client) return;

  console.log(`[proxy] spawning: ${KIRO_CMD} acp`);
  acpProcess = spawn(KIRO_CMD, ["acp"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const input = Writable.toWeb(acpProcess.stdin);
  const output = Readable.toWeb(acpProcess.stdout);
  const stream = ndJsonStream(input, output);

  client = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params) => onSessionUpdate(params),
      requestPermission: async (params) => {
        const opts = params.options ?? [];
        const pick = opts.find((o) => o.kind === "allow_once") ?? opts[0];
        return { outcome: { outcome: "selected", optionId: pick?.optionId ?? "allow" } };
      },
    }),
    stream,
  );

  await client.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
    clientInfo: { name: "kiro-openai-proxy", version: "1.0.0" },
  });

  const sess = await client.newSession({ cwd: process.cwd(), mcpServers: [] });
  sessionId = sess.sessionId;
  console.log(`[proxy] ACP session ready: ${sessionId}`);
}

// ── HTTP server ─────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

/** Extract the last user message text from OpenAI messages array */
function extractPromptText(messages) {
  if (!Array.isArray(messages)) return "";
  // Walk backwards to find the last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    if (Array.isArray(m.content)) {
      return m.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    }
  }
  return "";
}

/** Build the full conversation context as a single prompt string */
function buildFullPrompt(messages) {
  if (!Array.isArray(messages)) return "";
  // For the first turn just send the user message.
  // For multi-turn, concatenate system + history so Kiro has context.
  const parts = [];
  for (const m of messages) {
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((b) => b.type === "text")
              .map((b) => b.text)
              .join("\n")
          : "";
    if (!text) continue;
    if (m.role === "system") parts.push(`[System]\n${text}`);
    else if (m.role === "user") parts.push(`[User]\n${text}`);
    else if (m.role === "assistant") parts.push(`[Assistant]\n${text}`);
  }
  return parts.join("\n\n");
}

async function handleChatCompletions(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return sendJson(res, 400, { error: { message: "Invalid JSON" } });
  }

  await ensureAcp();

  const promptText = buildFullPrompt(body.messages);
  if (!promptText) {
    return sendJson(res, 400, { error: { message: "No user message found" } });
  }

  const stream = Boolean(body.stream);
  const model = body.model || "kiro-default";
  const requestId = `chatcmpl-${Date.now()}`;

  if (stream) {
    // ── SSE streaming ───────────────────────────────────────
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const writeSse = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    // Drain any chunks that arrived before we set up the listener
    pendingChunks = [];

    // Set up chunk listener before sending prompt
    chunkListener = (text) => {
      writeSse({
        id: requestId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      });
    };

    try {
      await client.prompt({ sessionId, prompt: [{ type: "text", text: promptText }] });
    } catch (err) {
      writeSse({
        id: requestId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{ index: 0, delta: { content: `[error] ${err.message}` }, finish_reason: null }],
      });
    }

    chunkListener = null;

    // Send final chunk with finish_reason
    writeSse({
      id: requestId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write("data: [DONE]\n\n");
    res.end();
  } else {
    // ── Non-streaming ───────────────────────────────────────
    const collected = [];
    pendingChunks = [];
    chunkListener = (text) => collected.push(text);

    try {
      await client.prompt({ sessionId, prompt: [{ type: "text", text: promptText }] });
    } catch (err) {
      collected.push(`[error] ${err.message}`);
    }

    chunkListener = null;
    const fullText = collected.join("");

    sendJson(res, 200, {
      id: requestId,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: fullText },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    });
  }
}

async function handleModels(_req, res) {
  sendJson(res, 200, {
    object: "list",
    data: [
      {
        id: "kiro-default",
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "kiro",
      },
    ],
  });
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      return await handleChatCompletions(req, res);
    }
    if (url.pathname === "/v1/models" && req.method === "GET") {
      return await handleModels(req, res);
    }
    sendJson(res, 404, { error: { message: "Not found" } });
  } catch (err) {
    console.error("[proxy] error:", err);
    sendJson(res, 500, { error: { message: err.message } });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[kiro-openai-proxy] listening on http://127.0.0.1:${PORT}`);
  console.log(`[kiro-openai-proxy] OpenClaw config:`);
  console.log(
    JSON.stringify(
      {
        models: {
          providers: {
            kiro: {
              baseUrl: `http://127.0.0.1:${PORT}/v1`,
              apiKey: "dummy",
              api: "openai-completions",
              models: [
                {
                  id: "kiro-default",
                  name: "Kiro CLI",
                  contextWindow: 200000,
                  maxTokens: 16384,
                  input: ["text"],
                },
              ],
            },
          },
        },
        agent: { model: "kiro/kiro-default" },
      },
      null,
      2,
    ),
  );
});

process.on("SIGINT", () => {
  acpProcess?.kill();
  process.exit(0);
});
process.on("SIGTERM", () => {
  acpProcess?.kill();
  process.exit(0);
});
