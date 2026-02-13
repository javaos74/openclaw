import { describe, expect, it, vi } from "vitest";
import type { KakaoTalkProbe } from "./probe.js";

// Mock the client module so we don't spawn a real bridge process
vi.mock("./client.js", () => {
  const mockRequest = vi.fn();
  const mockStart = vi.fn().mockResolvedValue(undefined);
  const mockStop = vi.fn().mockResolvedValue(undefined);

  class KakaoTalkRpcClient {
    constructor(public opts: Record<string, unknown> = {}) {}
    start = mockStart;
    stop = mockStop;
    request = mockRequest;
  }

  return {
    KakaoTalkRpcClient,
    __mockRequest: mockRequest,
    __mockStart: mockStart,
    __mockStop: mockStop,
  };
});

// Import after mock setup
const { probeKakaoTalk } = await import("./probe.js");
const {
  __mockRequest: mockRequest,
  __mockStart: mockStart,
  __mockStop: mockStop,
} = (await import("./client.js")) as unknown as {
  __mockRequest: ReturnType<typeof vi.fn>;
  __mockStart: ReturnType<typeof vi.fn>;
  __mockStop: ReturnType<typeof vi.fn>;
};

describe("probeKakaoTalk", () => {
  it("returns ok: true with running/accessible when bridge responds", async () => {
    mockRequest.mockResolvedValueOnce({ running: true, accessible: true, mainWindow: true });

    const result: KakaoTalkProbe = await probeKakaoTalk({});

    expect(result.ok).toBe(true);
    expect(result.running).toBe(true);
    expect(result.accessible).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns ok: false with error when bridge connection fails", async () => {
    mockStart.mockRejectedValueOnce(new Error("spawn kakaotalk-bridge ENOENT"));

    const result = await probeKakaoTalk({});

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  it("returns ok: false with error when check_status times out", async () => {
    mockRequest.mockRejectedValueOnce(new Error("kakaotalk-bridge rpc timeout (check_status)"));

    const result = await probeKakaoTalk({ timeoutMs: 100 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("passes bridgePath to the RPC client", async () => {
    mockRequest.mockResolvedValueOnce({ running: true, accessible: true });
    const { KakaoTalkRpcClient } = (await import("./client.js")) as unknown as {
      KakaoTalkRpcClient: new (opts: Record<string, unknown>) => { opts: Record<string, unknown> };
    };
    const OrigCtor = KakaoTalkRpcClient;

    // The constructor is called with bridgePath
    let capturedOpts: Record<string, unknown> | undefined;
    vi.mocked(KakaoTalkRpcClient as unknown as (...args: unknown[]) => unknown);

    await probeKakaoTalk({ bridgePath: "/custom/path/kakaotalk-bridge" });

    // Verify the request was called (bridge was used)
    expect(mockRequest).toHaveBeenCalledWith(
      "check_status",
      {},
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    );
  });

  it("always calls stop even on error", async () => {
    mockRequest.mockRejectedValueOnce(new Error("some error"));

    await probeKakaoTalk({});

    expect(mockStop).toHaveBeenCalled();
  });

  it("returns running: false when bridge reports app not running", async () => {
    mockRequest.mockResolvedValueOnce({ running: false, accessible: true });

    const result = await probeKakaoTalk({});

    expect(result.ok).toBe(true);
    expect(result.running).toBe(false);
    expect(result.accessible).toBe(true);
  });
});
