import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

/** Default timeout for KakaoTalk RPC operations (10 seconds). */
export const DEFAULT_KAKAOTALK_RPC_TIMEOUT_MS = 10_000;

/** Default polling interval for the bridge (3 seconds). */
const DEFAULT_POLL_INTERVAL_MS = 3_000;

export type KakaoTalkRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

export type KakaoTalkRpcResponse<T> = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: T;
  error?: KakaoTalkRpcError;
  method?: string;
  params?: unknown;
};

export type KakaoTalkRpcNotification = {
  method: string;
  params?: unknown;
};

export type KakaoTalkRpcClientOptions = {
  bridgePath?: string;
  pollIntervalMs?: number;
  onNotification?: (msg: KakaoTalkRpcNotification) => void;
  onStderr?: (line: string) => void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer?: NodeJS.Timeout;
};

export class KakaoTalkRpcClient {
  private readonly bridgePath: string;
  private readonly pollIntervalMs: number;
  private readonly onNotification?: (msg: KakaoTalkRpcNotification) => void;
  private readonly onStderr?: (line: string) => void;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly closed: Promise<void>;
  private closedResolve: (() => void) | null = null;
  private child: ChildProcessWithoutNullStreams | null = null;
  private reader: Interface | null = null;
  private nextId = 1;

  constructor(opts: KakaoTalkRpcClientOptions = {}) {
    this.bridgePath = opts.bridgePath?.trim() || "kakaotalk-bridge";
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onNotification = opts.onNotification;
    this.onStderr = opts.onStderr;
    this.closed = new Promise((resolve) => {
      this.closedResolve = resolve;
    });
  }

  async start(): Promise<void> {
    if (this.child) {
      return;
    }
    const args = ["rpc", "--poll-interval", String(this.pollIntervalMs)];
    const child = spawn(this.bridgePath, args, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    this.reader = createInterface({ input: child.stdout });

    this.reader.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }
      this.handleLine(trimmed);
    });

    child.stderr?.on("data", (chunk) => {
      const lines = chunk.toString().split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }
        this.onStderr?.(line.trim());
      }
    });

    child.on("error", (err) => {
      this.failAll(err instanceof Error ? err : new Error(String(err)));
      this.closedResolve?.();
    });

    child.on("close", (code, signal) => {
      if (code !== 0 && code !== null) {
        const reason = signal ? `signal ${signal}` : `code ${code}`;
        this.failAll(new Error(`kakaotalk-bridge exited (${reason})`));
      } else {
        this.failAll(new Error("kakaotalk-bridge closed"));
      }
      this.closedResolve?.();
    });
  }

  async stop(): Promise<void> {
    if (!this.child) {
      return;
    }
    this.reader?.close();
    this.reader = null;
    this.child.stdin?.end();
    const child = this.child;
    this.child = null;

    await Promise.race([
      this.closed,
      new Promise<void>((resolve) => {
        setTimeout(() => {
          if (!child.killed) {
            child.kill("SIGTERM");
          }
          resolve();
        }, 500);
      }),
    ]);
  }

  async waitForClose(): Promise<void> {
    await this.closed;
  }

  async request<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    opts?: { timeoutMs?: number },
  ): Promise<T> {
    if (!this.child || !this.child.stdin) {
      throw new Error("kakaotalk-bridge rpc not running");
    }
    const id = this.nextId++;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params: params ?? {},
    };
    const line = `${JSON.stringify(payload)}\n`;
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_KAKAOTALK_RPC_TIMEOUT_MS;

    const response = new Promise<T>((resolve, reject) => {
      const key = String(id);
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(key);
              reject(new Error(`kakaotalk-bridge rpc timeout (${method})`));
            }, timeoutMs)
          : undefined;
      this.pending.set(key, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
    });

    this.child.stdin.write(line);
    return await response;
  }

  private handleLine(line: string) {
    let parsed: KakaoTalkRpcResponse<unknown>;
    try {
      parsed = JSON.parse(line) as KakaoTalkRpcResponse<unknown>;
    } catch {
      return;
    }

    // Response with id → match to pending request
    if (parsed.id !== undefined && parsed.id !== null) {
      const key = String(parsed.id);
      const pending = this.pending.get(key);
      if (!pending) {
        return;
      }
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      this.pending.delete(key);

      if (parsed.error) {
        const baseMessage = parsed.error.message ?? "kakaotalk-bridge rpc error";
        const details = parsed.error.data;
        const code = parsed.error.code;
        const suffixes = [] as string[];
        if (typeof code === "number") {
          suffixes.push(`code=${code}`);
        }
        if (details !== undefined) {
          const detailText =
            typeof details === "string" ? details : JSON.stringify(details, null, 2);
          if (detailText) {
            suffixes.push(detailText);
          }
        }
        const msg = suffixes.length > 0 ? `${baseMessage}: ${suffixes.join(" ")}` : baseMessage;
        pending.reject(new Error(msg));
        return;
      }
      pending.resolve(parsed.result);
      return;
    }

    // No id → notification
    if (parsed.method) {
      this.onNotification?.({
        method: parsed.method,
        params: parsed.params,
      });
    }
  }

  private failAll(err: Error) {
    for (const [key, pending] of this.pending.entries()) {
      if (pending.timer) {
        clearTimeout(pending.timer);
      }
      pending.reject(err);
      this.pending.delete(key);
    }
  }
}

export async function createKakaoTalkRpcClient(
  opts: KakaoTalkRpcClientOptions = {},
): Promise<KakaoTalkRpcClient> {
  const client = new KakaoTalkRpcClient(opts);
  await client.start();
  return client;
}
