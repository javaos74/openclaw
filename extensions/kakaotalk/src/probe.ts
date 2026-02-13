import { KakaoTalkRpcClient } from "./client.js";

/**
 * Result of a KakaoTalk status probe.
 *
 * - `ok`: true when the bridge responded within the timeout
 * - `running`: whether KakaoTalk desktop app is running (from bridge)
 * - `accessible`: whether macOS Accessibility access is granted (from bridge)
 * - `error`: human-readable error when `ok` is false
 */
export type KakaoTalkProbe = {
  ok: boolean;
  running?: boolean;
  accessible?: boolean;
  error?: string | null;
};

/** Default probe timeout (5 seconds). */
const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

type CheckStatusResult = {
  running?: boolean;
  accessible?: boolean;
  mainWindow?: boolean;
};

/**
 * Probe KakaoTalk bridge availability by spawning a temporary RPC client
 * and calling `check_status`.
 *
 * Req 12.1: calls `check_status` via RPC_Client
 * Req 12.2: returns `ok` boolean + optional error
 * Req 12.3: returns `ok: false` with error on connection failure
 */
export async function probeKakaoTalk(params: {
  bridgePath?: string;
  timeoutMs?: number;
}): Promise<KakaoTalkProbe> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
  const client = new KakaoTalkRpcClient({
    bridgePath: params.bridgePath,
  });

  try {
    await client.start();
    const status = await client.request<CheckStatusResult>("check_status", {}, { timeoutMs });
    return {
      ok: true,
      running: status?.running,
      accessible: status?.accessible,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  } finally {
    await client.stop();
  }
}
