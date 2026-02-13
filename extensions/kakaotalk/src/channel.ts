import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import {
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  normalizeAccountId,
  PAIRING_APPROVED_MESSAGE,
  setAccountEnabledInConfigSection,
  applyAccountNameToChannelSection,
} from "openclaw/plugin-sdk";
import {
  listKakaoTalkAccountIds,
  resolveDefaultKakaoTalkAccountId,
  resolveKakaoTalkAccount,
  type ResolvedKakaoTalkAccount,
} from "./accounts.js";
import { KakaoTalkConfigSchema } from "./config-schema.js";
import { monitorKakaoTalkProvider } from "./monitor.js";
import { kakaotalkOnboardingAdapter } from "./onboarding.js";
import { probeKakaoTalk, type KakaoTalkProbe } from "./probe.js";
import { sendMessageKakaoTalk } from "./send.js";
import { normalizeKakaoTalkTarget } from "./types.js";

const meta = {
  id: "kakaotalk",
  label: "KakaoTalk",
  selectionLabel: "KakaoTalk (macOS Accessibility)",
  detailLabel: "KakaoTalk",
  blurb: "KakaoTalk via macOS Accessibility API bridge.",
  aliases: ["kt", "kakao"],
  systemImage: "message.fill",
  order: 80,
};

const isMacOS = process.platform === "darwin";
/**
 * KakaoTalk channel plugin for OpenClaw.
 *
 * Req 9.1: Register KakaoTalk channel with OpenClaw plugin API
 * Req 9.3: dmPolicy "allowlist" — only accept from allowFrom list
 * Req 9.4: dmPolicy "open" — accept from all chat rooms
 * Req 13.1: On non-macOS, register as disabled with platform warning
 * Req 13.2: On non-macOS, skip gateway start
 */
export const kakaotalkPlugin: ChannelPlugin<ResolvedKakaoTalkAccount, KakaoTalkProbe> = {
  id: "kakaotalk",
  meta,
  capabilities: {
    chatTypes: ["direct"],
    media: false,
  },
  reload: { configPrefixes: ["channels.kakaotalk"] },
  configSchema: buildChannelConfigSchema(KakaoTalkConfigSchema),
  onboarding: kakaotalkOnboardingAdapter,
  config: {
    listAccountIds: (cfg) => listKakaoTalkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveKakaoTalkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultKakaoTalkAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({
        cfg,
        sectionKey: "kakaotalk",
        accountId,
        enabled,
        allowTopLevel: true,
      }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({
        cfg,
        sectionKey: "kakaotalk",
        accountId,
        clearBaseFields: ["name", "bridgePath", "pollIntervalMs"],
      }),
    isConfigured: (account) => account.configured,
    // Req 13.1: non-macOS → disabled
    isEnabled: (account) => isMacOS && account.enabled,
    disabledReason: () => (isMacOS ? "" : "KakaoTalk requires macOS (Accessibility API)"),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: isMacOS && account.enabled,
      configured: account.configured,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveKakaoTalkAccount({ cfg, accountId }).config.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^kakaotalk:/i, "")),
  },
  security: {
    // Req 9.3 + 9.4: dmPolicy-based access control
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.kakaotalk?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.kakaotalk.accounts.${resolvedAccountId}.`
        : "channels.kakaotalk.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: formatPairingApproveHint("kakaotalk"),
        normalizeEntry: (raw) => raw.replace(/^kakaotalk:/i, "").trim(),
      };
    },
  },
  pairing: {
    idLabel: "kakaotalkChatName",
    normalizeAllowEntry: (entry) => entry.replace(/^kakaotalk:/i, "").trim(),
    notifyApproval: async ({ cfg, id }) => {
      const account = resolveKakaoTalkAccount({ cfg });
      const { createKakaoTalkRpcClient } = await import("./client.js");
      const client = await createKakaoTalkRpcClient({
        bridgePath: account.config.bridgePath,
      });
      try {
        await sendMessageKakaoTalk(id, PAIRING_APPROVED_MESSAGE, { client });
      } finally {
        await client.stop();
      }
    },
  },
  messaging: {
    normalizeTarget: (raw) => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return undefined;
      }
      const stripped = trimmed.replace(/^kakaotalk:/i, "").trim();
      return stripped || undefined;
    },
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) {
          return false;
        }
        return /^kakaotalk:/i.test(trimmed) || !trimmed.includes(":");
      },
      hint: "<chat room name>",
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: 4000,
    resolveTarget: ({ to }) => {
      const trimmed = to?.trim();
      if (!trimmed) {
        return {
          ok: false,
          error: new Error("Delivering to KakaoTalk requires --to <chat room name>"),
        };
      }
      try {
        const normalized = normalizeKakaoTalkTarget(trimmed);
        return { ok: true, to: normalized };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err : new Error(String(err)),
        };
      }
    },
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveKakaoTalkAccount({ cfg, accountId });
      const { createKakaoTalkRpcClient } = await import("./client.js");
      const client = await createKakaoTalkRpcClient({
        bridgePath: account.config.bridgePath,
      });
      try {
        const result = await sendMessageKakaoTalk(to, text, { client });
        return { channel: "kakaotalk", ...result };
      } finally {
        await client.stop();
      }
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const issues: Array<{
          channel: string;
          accountId: string;
          kind: string;
          message: string;
        }> = [];
        if (!isMacOS) {
          issues.push({
            channel: "kakaotalk",
            accountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
            kind: "platform",
            message: "KakaoTalk requires macOS (Accessibility API)",
          });
        }
        const lastError = typeof account.lastError === "string" ? account.lastError.trim() : "";
        if (lastError) {
          issues.push({
            channel: "kakaotalk",
            accountId: account.accountId ?? DEFAULT_ACCOUNT_ID,
            kind: "runtime",
            message: `Channel error: ${lastError}`,
          });
        }
        return issues;
      }),
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) =>
      probeKakaoTalk({
        bridgePath: account.config.bridgePath,
        timeoutMs,
      }),
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const running = runtime?.running ?? false;
      const probeOk = (probe as KakaoTalkProbe | undefined)?.ok;
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: isMacOS && account.enabled,
        configured: account.configured,
        running,
        connected: probeOk ?? running,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        lastProbeAt: runtime?.lastProbeAt ?? null,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) =>
      applyAccountNameToChannelSection({
        cfg,
        channelKey: "kakaotalk",
        accountId,
        name,
      }),
    validateInput: () => null,
    applyAccountConfig: ({ cfg, accountId }) => {
      if (accountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            kakaotalk: {
              ...cfg.channels?.kakaotalk,
              enabled: true,
            },
          },
        } as OpenClawConfig;
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          kakaotalk: {
            ...cfg.channels?.kakaotalk,
            enabled: true,
            accounts: {
              ...cfg.channels?.kakaotalk?.accounts,
              [accountId]: {
                ...cfg.channels?.kakaotalk?.accounts?.[accountId],
                enabled: true,
              },
            },
          },
        },
      } as OpenClawConfig;
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      // Req 13.2: skip gateway start on non-macOS
      if (!isMacOS) {
        ctx.log?.info(
          `[${ctx.accountId}] skipping KakaoTalk — platform not supported (requires macOS)`,
        );
        return;
      }
      const account = ctx.account;
      ctx.setStatus({ accountId: account.accountId });
      ctx.log?.info(`[${account.accountId}] starting KakaoTalk provider`);
      return monitorKakaoTalkProvider({
        account,
        config: ctx.cfg,
        runtime: {
          log: (msg) => ctx.log?.info(msg),
          error: (msg) => ctx.log?.error(msg),
        },
        abortSignal: ctx.abortSignal,
      });
    },
  },
};
