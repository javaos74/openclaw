import { describe, expect, it } from "vitest";
import { normalizeKakaoTalkTarget } from "./types.js";

describe("normalizeKakaoTalkTarget", () => {
  it("returns trimmed string for valid input", () => {
    expect(normalizeKakaoTalkTarget("홍길동")).toBe("홍길동");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeKakaoTalkTarget("  홍길동  ")).toBe("홍길동");
    expect(normalizeKakaoTalkTarget("\t개발팀\n")).toBe("개발팀");
  });

  it("throws on empty string", () => {
    expect(() => normalizeKakaoTalkTarget("")).toThrow("KakaoTalk target must not be empty");
  });

  it("throws on whitespace-only string", () => {
    expect(() => normalizeKakaoTalkTarget("   ")).toThrow("KakaoTalk target must not be empty");
    expect(() => normalizeKakaoTalkTarget("\t\n")).toThrow("KakaoTalk target must not be empty");
  });
});
