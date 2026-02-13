import type { OpenClawConfig } from "openclaw/plugin-sdk";
import { describe, expect, it } from "vitest";
import {
  listKakaoTalkAccountIds,
  resolveKakaoTalkAccount,
  resolveDefaultKakaoTalkAccountId,
  listEnabledKakaoTalkAccounts,
} from "./accounts.js";

function cfg(kakaotalk?: Record<string, unknown>): OpenClawConfig {
  return { channels: { kakaotalk } } as unknown as OpenClawConfig;
}

describe("listKakaoTalkAccountIds", () => {
  it("returns [default] when no accounts configured", () => {
    expect(listKakaoTalkAccountIds(cfg())).toEqual(["default"]);
  });

  it("returns [default] when accounts is empty", () => {
    expect(listKakaoTalkAccountIds(cfg({ accounts: {} }))).toEqual(["default"]);
  });

  it("returns sorted account ids", () => {
    expect(listKakaoTalkAccountIds(cfg({ accounts: { beta: {}, alpha: {} } }))).toEqual([
      "alpha",
      "beta",
    ]);
  });
});

describe("resolveDefaultKakaoTalkAccountId", () => {
  it("returns 'default' when no accounts configured", () => {
    expect(resolveDefaultKakaoTalkAccountId(cfg())).toBe("default");
  });

  it("returns 'default' when it exists in accounts", () => {
    expect(resolveDefaultKakaoTalkAccountId(cfg({ accounts: { default: {}, work: {} } }))).toBe(
      "default",
    );
  });

  it("returns first sorted id when default is absent", () => {
    expect(resolveDefaultKakaoTalkAccountId(cfg({ accounts: { work: {}, home: {} } }))).toBe(
      "home",
    );
  });
});

describe("resolveKakaoTalkAccount", () => {
  it("applies default values for bridgePath, pollIntervalMs, dmPolicy, textChunkLimit", () => {
    const account = resolveKakaoTalkAccount({ cfg: cfg() });
    expect(account.config.bridgePath).toBe("kakaotalk-bridge");
    expect(account.config.pollIntervalMs).toBe(3000);
    expect(account.config.dmPolicy).toBe("pairing");
    expect(account.config.textChunkLimit).toBe(4000);
  });

  it("merges base config with account-specific overrides", () => {
    const config = cfg({
      bridgePath: "/usr/local/bin/kakaotalk-bridge",
      pollIntervalMs: 5000,
      accounts: {
        work: { pollIntervalMs: 1000, dmPolicy: "open" },
      },
    });
    const account = resolveKakaoTalkAccount({ cfg: config, accountId: "work" });
    expect(account.config.bridgePath).toBe("/usr/local/bin/kakaotalk-bridge");
    expect(account.config.pollIntervalMs).toBe(1000);
    expect(account.config.dmPolicy).toBe("open");
  });

  it("account-level bridgePath overrides base", () => {
    const config = cfg({
      bridgePath: "/base/path",
      accounts: { work: { bridgePath: "/work/path" } },
    });
    const account = resolveKakaoTalkAccount({ cfg: config, accountId: "work" });
    expect(account.config.bridgePath).toBe("/work/path");
  });

  it("enabled is true by default", () => {
    const account = resolveKakaoTalkAccount({ cfg: cfg() });
    expect(account.enabled).toBe(true);
  });

  it("disabled when base enabled is false", () => {
    const account = resolveKakaoTalkAccount({ cfg: cfg({ enabled: false }) });
    expect(account.enabled).toBe(false);
  });

  it("disabled when account enabled is false", () => {
    const config = cfg({ accounts: { work: { enabled: false } } });
    const account = resolveKakaoTalkAccount({ cfg: config, accountId: "work" });
    expect(account.enabled).toBe(false);
  });

  it("configured is true when bridgePath is present", () => {
    const account = resolveKakaoTalkAccount({ cfg: cfg() });
    expect(account.configured).toBe(true);
  });

  it("trims name", () => {
    const config = cfg({ accounts: { work: { name: "  Work KT  " } } });
    const account = resolveKakaoTalkAccount({ cfg: config, accountId: "work" });
    expect(account.name).toBe("Work KT");
  });

  it("name is undefined when empty after trim", () => {
    const config = cfg({ accounts: { work: { name: "   " } } });
    const account = resolveKakaoTalkAccount({ cfg: config, accountId: "work" });
    expect(account.name).toBeUndefined();
  });

  it("defaults accountId to 'default' when null", () => {
    const account = resolveKakaoTalkAccount({ cfg: cfg(), accountId: null });
    expect(account.accountId).toBe("default");
  });
});

describe("listEnabledKakaoTalkAccounts", () => {
  it("returns only enabled accounts", () => {
    const config = cfg({
      accounts: {
        a: { enabled: true },
        b: { enabled: false },
        c: {},
      },
    });
    const enabled = listEnabledKakaoTalkAccounts(config);
    const ids = enabled.map((a) => a.accountId);
    expect(ids).toEqual(["a", "c"]);
  });

  it("returns default account when no accounts configured", () => {
    const enabled = listEnabledKakaoTalkAccounts(cfg());
    expect(enabled).toHaveLength(1);
    expect(enabled[0]!.accountId).toBe("default");
  });
});
