import type { OpenClawPluginApi } from "../../src/plugins/types.js";

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: { title?: string };
};

export default async function register(api: OpenClawPluginApi) {
  const cfg = api.pluginConfig as { endpoint?: string; bearerToken?: string } | undefined;
  if (!cfg?.endpoint || !cfg?.bearerToken) {
    api.logger.warn("uipath-mcp: endpoint and bearerToken required in plugin config");
    return;
  }

  const { endpoint, bearerToken } = cfg;
  const baseHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${bearerToken}`,
  };

  // MCP session state — re-initialized on each tools/call if expired
  let sessionId: string | undefined;

  async function initSession(): Promise<string | undefined> {
    const initRes = await fetch(endpoint, {
      method: "POST",
      headers: baseHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "openclaw-uipath", version: "1.0.0" },
        },
      }),
    });
    const sid = initRes.headers.get("mcp-session-id") ?? undefined;
    await fetch(endpoint, {
      method: "POST",
      headers: { ...baseHeaders, ...(sid ? { "Mcp-Session-Id": sid } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    return sid;
  }

  function reqHeaders() {
    return { ...baseHeaders, ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) };
  }

  function parseSseResult(text: string): any {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    return line ? JSON.parse(line.slice(6)) : undefined;
  }

  // Sanitize tool name to ASCII-safe identifier
  function safeName(name: string, title?: string): string {
    for (const candidate of [name, title]) {
      if (!candidate) continue;
      const ascii = candidate
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
      if (ascii.length >= 3) return ascii;
    }
    // Non-ASCII only: check manual overrides
    return nameOverrides[name] ?? `action_${++toolIndex}`;
  }
  let toolIndex = 0;
  const nameOverrides: Record<string, string> = {
    거래내역확인: "check_transaction_records",
  };

  // Initialize
  try {
    sessionId = await initSession();
  } catch (err) {
    api.logger.error(`uipath-mcp: init failed: ${err}`);
    return;
  }

  // Fetch tools
  let tools: McpTool[] = [];
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: reqHeaders(),
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    const parsed = parseSseResult(await res.text());
    tools = parsed?.result?.tools ?? [];
  } catch (err) {
    api.logger.error(`uipath-mcp: tools/list failed: ${err}`);
    return;
  }

  api.logger.info(`uipath-mcp: discovered ${tools.length} tools`);

  let callId = 10;

  for (const tool of tools) {
    const toolName = `uipath_${safeName(tool.name, tool.annotations?.title)}`;
    const title = tool.annotations?.title ?? tool.name;
    const desc = tool.description ?? "";
    const schema = tool.inputSchema ?? { type: "object" as const, properties: {} };
    const mcpName = tool.name; // preserve original for MCP call

    api.logger.info(`uipath-mcp: registering ${toolName} (mcp: ${mcpName})`);

    api.registerTool({
      name: toolName,
      description: `[UiPath: ${title}] ${desc}`.trim(),
      parameters: schema as any,
      async execute(_id: string, params: Record<string, unknown>) {
        const id = ++callId;
        try {
          let res = await fetch(endpoint, {
            method: "POST",
            headers: reqHeaders(),
            body: JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name: mcpName, arguments: params },
            }),
          });

          // Re-init session on 4xx (session expired)
          if (res.status >= 400 && res.status < 500) {
            api.logger.info(`uipath-mcp: session expired, re-initializing`);
            sessionId = await initSession();
            res = await fetch(endpoint, {
              method: "POST",
              headers: reqHeaders(),
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: id + 1,
                method: "tools/call",
                params: { name: mcpName, arguments: params },
              }),
            });
          }

          const parsed = parseSseResult(await res.text());
          const content = parsed?.result?.content;
          if (Array.isArray(content)) return { content };
          return { content: [{ type: "text", text: JSON.stringify(parsed?.result ?? parsed) }] };
        } catch (err: any) {
          return { content: [{ type: "text", text: `[uipath error] ${err.message}` }] };
        }
      },
    });
  }
}
