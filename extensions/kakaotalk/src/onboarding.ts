import type {
  ChannelOnboardingAdapter,
  ChannelOnboardingDmPolicy,
  OpenClawConfig,
  DmPolicy,
  WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  addWildcardAllowFrom,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  promptAccountId,
} from "openclaw/plugin-sdk";
import {
  listKakaoTalkAccountIds,
  resolveDefaultKakaoTalkAccountId,
  resolveKakaoTalkAccount,
} from "./accounts.js";
import { probeKakaoTalk } from "./probe.js";

const channel = "kakaotalk" as const;

/** Default bridge binary name (Req 9.5). */
const DEFAULT_BRIDGE_PATH = "kakaotalk-bridge";

function setKakaoTalkDmPolicy(cfg: OpenClawConfig, dmPolicy: DmPolicy): OpenClawConfig {
  const allowFrom =
    dmPolicy === "open" ? addWildcardAllowFrom(cfg.channels?.kakaotalk?.allowFrom) : undefined;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      kakaotalk: {
        ...cfg.channels?.kakaotalk,
        dmPolicy,
        ...(allowFrom ? { allowFrom } : {}),
      },
    },
  };
}

function setKakaoTalkAllowFrom(
  cfg: OpenClawConfig,
  accountId: string,
  allowFrom: string[],
): OpenClawConfig {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return {
      ...cfg,
      channels: {
        ...cfg.channels,
        kakaotalk: {
          ...cfg.channels?.kakaotalk,
          allowFrom,
        },
      },
    };
  }
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      kakaotalk: {
        ...cfg.channels?.kakaotalk,
        accounts: {
          ...cfg.channels?.kakaotalk?.accounts,
          [accountId]: {
            ...cfg.channels?.kakaotalk?.accounts?.[accountId],
            allowFrom,
          },
        },
      },
    },
  };
}

function parseKakaoTalkAllowFromInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function promptKakaoTalkAllowFrom(params: {
  cfg: OpenClawConfig;
  prompter: WizardPrompter;
  accountId?: string;
}): Promise<OpenClawConfig> {
  const accountId =
    params.accountId && normalizeAccountId(params.accountId)
      ? (normalizeAccountId(params.accountId) ?? DEFAULT_ACCOUNT_ID)
      : resolveDefaultKakaoTalkAccountId(params.cfg);
  const resolved = resolveKakaoTalkAccount({ cfg: params.cfg, accountId });
  const existing = resolved.config.allowFrom ?? [];
  await params.prompter.note(
    [
      "Allowlist KakaoTalk DMs by chat room name.",
      "Examples:",
      "- 홍길동",
      "- 개발팀",
      "Multiple entries: comma- or newline-separated.",
    ].join("\n"),
    "KakaoTalk allowlist",
  );
  const entry = await params.prompter.text({
    message: "KakaoTalk allowFrom (chat room names)",
    placeholder: "홍길동, 개발팀",
    initialValue: existing[0] ? String(existing[0]) : undefined,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "Required";
      }
      return undefined;
    },
  });
  const parts = parseKakaoTalkAllowFromInput(String(entry));
  const unique = [...new Set(parts)];
  return setKakaoTalkAllowFrom(params.cfg, accountId, unique);
}

const dmPolicy: ChannelOnboardingDmPolicy = {
  label: "KakaoTalk",
  channel,
  policyKey: "channels.kakaotalk.dmPolicy",
  allowFromKey: "channels.kakaotalk.allowFrom",
  getCurrent: (cfg) => cfg.channels?.kakaotalk?.dmPolicy ?? "pairing",
  setPolicy: (cfg, policy) => setKakaoTalkDmPolicy(cfg, policy),
  promptAllowFrom: promptKakaoTalkAllowFrom,
};

export const kakaotalkOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = listKakaoTalkAccountIds(cfg).some((accountId) => {
      const account = resolveKakaoTalkAccount({ cfg, accountId });
      return account.configured;
    });
    return {
      channel,
      configured,
      statusLines: [`KakaoTalk: ${configured ? "configured" : "needs setup"}`],
      selectionHint: configured ? "configured" : "KakaoTalk via macOS Accessibility",
      quickstartScore: configured ? 1 : 0,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const kakaotalkOverride = accountOverrides.kakaotalk?.trim();
    const defaultAccountId = resolveDefaultKakaoTalkAccountId(cfg);
    let accountId = kakaotalkOverride ? normalizeAccountId(kakaotalkOverride) : defaultAccountId;
    if (shouldPromptAccountIds && !kakaotalkOverride) {
      accountId = await promptAccountId({
        cfg,
        prompter,
        label: "KakaoTalk",
        currentId: accountId,
        listAccountIds: listKakaoTalkAccountIds,
        defaultAccountId,
      });
    }

    let next = cfg;
    const resolvedAccount = resolveKakaoTalkAccount({ cfg: next, accountId });

    // Prompt for bridgePath (Req 9.5: default "kakaotalk-bridge")
    let bridgePath = resolvedAccount.config.bridgePath?.trim() || DEFAULT_BRIDGE_PATH;
    if (resolvedAccount.config.bridgePath?.trim()) {
      const keepPath = await prompter.confirm({
        message: `Bridge path already set (${bridgePath}). Keep it?`,
        initialValue: true,
      });
      if (!keepPath) {
        const entered = await prompter.text({
          message: "kakaotalk-bridge path",
          placeholder: DEFAULT_BRIDGE_PATH,
          initialValue: bridgePath,
          validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
        });
        bridgePath = String(entered).trim();
      }
    } else {
      const entered = await prompter.text({
        message: "kakaotalk-bridge path",
        placeholder: DEFAULT_BRIDGE_PATH,
        initialValue: DEFAULT_BRIDGE_PATH,
        validate: (value) => (String(value ?? "").trim() ? undefined : "Required"),
      });
      bridgePath = String(entered).trim() || DEFAULT_BRIDGE_PATH;
    }

    // Probe bridge connectivity
    const probe = await probeKakaoTalk({ bridgePath, timeoutMs: 5_000 });

    if (probe.ok) {
      await prompter.note("Bridge connected. KakaoTalk is ready.", "KakaoTalk status");
    } else {
      // Req 2.5: AX permission guidance when probe fails
      const lines = ["Bridge probe failed."];
      if (probe.error) {
        lines.push(`Error: ${probe.error}`);
      }
      lines.push("");
      lines.push("Troubleshooting:");
      lines.push("1. Ensure KakaoTalk desktop app is running");
      lines.push(
        "2. Grant Accessibility permission: System Settings → Privacy & Security → Accessibility → enable kakaotalk-bridge",
      );
      lines.push("3. Verify the bridge binary is installed and in PATH");
      lines.push("");
      lines.push("You can continue setup and fix connectivity later.");
      await prompter.note(lines.join("\n"), "KakaoTalk status");
    }

    // Apply config
    if (accountId === DEFAULT_ACCOUNT_ID) {
      next = {
        ...next,
        channels: {
          ...next.channels,
          kakaotalk: {
            ...next.channels?.kakaotalk,
            enabled: true,
            bridgePath,
          },
        },
      };
    } else {
      next = {
        ...next,
        channels: {
          ...next.channels,
          kakaotalk: {
            ...next.channels?.kakaotalk,
            enabled: true,
            accounts: {
              ...next.channels?.kakaotalk?.accounts,
              [accountId]: {
                ...next.channels?.kakaotalk?.accounts?.[accountId],
                enabled: next.channels?.kakaotalk?.accounts?.[accountId]?.enabled ?? true,
                bridgePath,
              },
            },
          },
        },
      };
    }

    return { cfg: next, accountId };
  },
  dmPolicy,
  disable: (cfg) => ({
    ...cfg,
    channels: {
      ...cfg.channels,
      kakaotalk: { ...cfg.channels?.kakaotalk, enabled: false },
    },
  }),
};
