import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "openclaw/plugin-sdk";
import type { KakaoTalkAccountConfig } from "./types.js";

export type ResolvedKakaoTalkAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  config: KakaoTalkAccountConfig;
  configured: boolean;
};

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = cfg.channels?.kakaotalk?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listKakaoTalkAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultKakaoTalkAccountId(cfg: OpenClawConfig): string {
  const ids = listKakaoTalkAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): KakaoTalkAccountConfig | undefined {
  const accounts = cfg.channels?.kakaotalk?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as KakaoTalkAccountConfig | undefined;
}

function mergeKakaoTalkAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): KakaoTalkAccountConfig {
  const base = (cfg.channels?.kakaotalk ?? {}) as KakaoTalkAccountConfig & {
    accounts?: unknown;
  };
  const { accounts: _ignored, ...rest } = base;
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return {
    ...rest,
    ...account,
    bridgePath: account.bridgePath ?? rest.bridgePath ?? "kakaotalk-bridge",
    pollIntervalMs: account.pollIntervalMs ?? rest.pollIntervalMs ?? 3000,
    dmPolicy: account.dmPolicy ?? rest.dmPolicy ?? "pairing",
    textChunkLimit: account.textChunkLimit ?? rest.textChunkLimit ?? 4000,
  };
}

export function resolveKakaoTalkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedKakaoTalkAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.kakaotalk?.enabled;
  const merged = mergeKakaoTalkAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const configured = Boolean(merged.bridgePath?.trim());
  return {
    accountId,
    enabled: baseEnabled !== false && accountEnabled,
    name: merged.name?.trim() || undefined,
    config: merged,
    configured,
  };
}

export function listEnabledKakaoTalkAccounts(cfg: OpenClawConfig): ResolvedKakaoTalkAccount[] {
  return listKakaoTalkAccountIds(cfg)
    .map((accountId) => resolveKakaoTalkAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}
