/**
 * KakaoTalk inbound message monitor.
 *
 * Creates an RPC client, starts the bridge process, and routes incoming
 * `new_message` notifications to the OpenClaw runtime.
 *
 * Req 10.1: RPC_Client 생성 및 Bridge 시작
 * Req 10.2: new_message 알림 수신 시 런타임 라우팅
 * Req 10.3: 발신자 ID, 메시지 텍스트, 채널 식별자 포함
 * Req 10.4: Bridge 비정상 종료 시 에러 로깅
 */

import type { OpenClawConfig, ReplyPayload } from "openclaw/plugin-sdk";
import { createReplyPrefixOptions } from "openclaw/plugin-sdk";
import type { ResolvedKakaoTalkAccount } from "./accounts.js";
import { KakaoTalkRpcClient, type KakaoTalkRpcNotification } from "./client.js";
import { getKakaoTalkRuntime } from "./runtime.js";
import { sendMessageKakaoTalk } from "./send.js";
import { normalizeKakaoTalkTarget } from "./types.js";

export type KakaoTalkMonitorOptions = {
  account: ResolvedKakaoTalkAccount;
  config: OpenClawConfig;
  runtime: { log?: (msg: string) => void; error?: (msg: string) => void };
  abortSignal: AbortSignal;
};

type NewMessageParams = {
  chatName?: string;
  sender?: string;
  text?: string;
  time?: string;
};

/**
 * Monitor KakaoTalk for inbound messages via the bridge RPC.
 *
 * The function resolves when the bridge process exits or the abort signal fires.
 */
export async function monitorKakaoTalkProvider(opts: KakaoTalkMonitorOptions): Promise<void> {
  const { account, config: cfg, runtime, abortSignal } = opts;
  const core = getKakaoTalkRuntime();
  const accountCfg = account.config;
  const textLimit = core.channel.text.resolveTextChunkLimit(cfg, "kakaotalk", account.accountId);

  if (abortSignal.aborted) {
    return;
  }

  // Req 10.1: create RPC client and start bridge
  const client = new KakaoTalkRpcClient({
    bridgePath: accountCfg.bridgePath,
    pollIntervalMs: accountCfg.pollIntervalMs,
    onNotification: (msg: KakaoTalkRpcNotification) => {
      if (msg.method === "new_message") {
        void handleNewMessage(msg.params as NewMessageParams).catch((err) => {
          runtime.error?.(`kakaotalk: message handler failed: ${String(err)}`);
        });
      }
    },
    onStderr: (line: string) => {
      runtime.log?.(`kakaotalk-bridge stderr: ${line}`);
    },
  });

  /**
   * Req 10.2 + 10.3: route inbound message to OpenClaw runtime.
   */
  async function handleNewMessage(params: NewMessageParams): Promise<void> {
    const chatName = params.chatName?.trim();
    const sender = params.sender?.trim();
    const text = params.text?.trim();

    if (!chatName || !sender || !text) {
      return;
    }

    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "kakaotalk",
      accountId: account.accountId,
      peer: { kind: "dm", id: chatName },
    });

    const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(cfg);
    const body = core.channel.reply.formatAgentEnvelope({
      channel: "KakaoTalk",
      from: sender,
      timestamp: params.time ? Date.parse(params.time) : undefined,
      envelope: envelopeOptions,
      body: text,
    });

    const ctxPayload = core.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: text,
      CommandBody: text,
      From: `kakaotalk:${chatName}`,
      To: `kakaotalk:${chatName}`,
      SessionKey: route.sessionKey,
      AccountId: route.accountId,
      ChatType: "direct",
      ConversationLabel: chatName,
      SenderName: sender,
      SenderId: chatName,
      Provider: "kakaotalk",
      Surface: "kakaotalk",
      OriginatingChannel: "kakaotalk",
      OriginatingTo: `kakaotalk:${chatName}`,
    });

    const storePath = core.channel.session.resolveStorePath(cfg.session?.store, {
      agentId: route.agentId,
    });
    await core.channel.session.recordInboundSession({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
      onRecordError: (err) => {
        runtime.error?.(`kakaotalk: failed updating session meta: ${String(err)}`);
      },
    });

    const { onModelSelected, ...prefixOptions } = createReplyPrefixOptions({
      cfg,
      agentId: route.agentId,
      channel: "kakaotalk",
      accountId: route.accountId,
    });

    await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: ctxPayload,
      cfg,
      dispatcherOptions: {
        ...prefixOptions,
        deliver: async (payload: ReplyPayload) => {
          if (!payload.text) {
            return;
          }
          const target = normalizeKakaoTalkTarget(chatName);
          const chunks = core.channel.text.chunkText(payload.text, textLimit);
          for (const chunk of chunks) {
            const result = await sendMessageKakaoTalk(target, chunk, { client });
            if (!result.success) {
              runtime.error?.(`kakaotalk: send failed: ${result.error}`);
            }
          }
        },
      },
      replyOptions: { onModelSelected },
    });
  }

  // Abort handler: graceful shutdown
  const onAbort = () => {
    void client.stop().catch(() => {
      // Ignore errors during shutdown
    });
  };
  abortSignal.addEventListener("abort", onAbort, { once: true });

  try {
    await client.start();
    runtime.log?.(`kakaotalk: bridge started for account ${account.accountId}`);

    // Block until the bridge process exits
    await client.waitForClose();
  } catch (err) {
    if (abortSignal.aborted) {
      return;
    }
    // Req 10.4: log error on bridge abnormal exit
    runtime.error?.(`kakaotalk: bridge exited unexpectedly: ${String(err)}`);
    throw err;
  } finally {
    abortSignal.removeEventListener("abort", onAbort);
    await client.stop();
  }
}
