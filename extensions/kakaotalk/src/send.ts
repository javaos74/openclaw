import type { KakaoTalkRpcClient } from "./client.js";
import { normalizeKakaoTalkTarget } from "./types.js";

export type KakaoTalkSendOpts = {
  /** Pre-existing RPC client to reuse (caller manages lifecycle). */
  client?: KakaoTalkRpcClient;
  /** Timeout for the RPC call in milliseconds. */
  timeoutMs?: number;
};

export type KakaoTalkSendResult = {
  success: boolean;
  error?: string;
};

/**
 * Send a text message to a KakaoTalk chat room via the bridge RPC.
 *
 * Validates that `text` is non-empty before making the RPC call (Req 6.4).
 * Uses `normalizeKakaoTalkTarget` to trim the target name (Req 11.2).
 * Calls `send_message` on the bridge via RPC_Client (Req 11.1).
 * Returns a result with `success: false` and an error string on failure (Req 11.3).
 */
export async function sendMessageKakaoTalk(
  to: string,
  text: string,
  opts: KakaoTalkSendOpts = {},
): Promise<KakaoTalkSendResult> {
  // Req 6.4: reject empty / whitespace-only text before RPC call
  if (!text || !text.trim()) {
    return { success: false, error: "KakaoTalk send requires non-empty text" };
  }

  const name = normalizeKakaoTalkTarget(to);

  const client = opts.client;
  if (!client) {
    return { success: false, error: "KakaoTalk RPC client not provided" };
  }

  try {
    // Req 11.1: call send_message via RPC_Client
    await client.request<{ success?: boolean }>(
      "send_message",
      { name, text },
      {
        timeoutMs: opts.timeoutMs,
      },
    );
    return { success: true };
  } catch (err) {
    // Req 11.3: return error in send result on failure
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
