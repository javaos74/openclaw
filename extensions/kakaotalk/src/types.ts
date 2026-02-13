/** DM policy for KakaoTalk channel access control. */
export type DmPolicy = "pairing" | "allowlist" | "open" | "disabled";

/** A chat entry from the KakaoTalk chat list. */
export type KakaoTalkChat = {
  /** 대화방 이름 (상대방 이름 또는 그룹명) */
  name: string;
  /** ISO 8601 또는 KakaoTalk 표시 형식 */
  lastMessageTime: string;
  /** 읽지 않은 메시지 수 */
  unreadCount: number;
};

/** A single message from a KakaoTalk chat room. */
export type KakaoTalkMessage = {
  /** 발신자 이름 */
  sender: string;
  /** 메시지 내용 */
  text: string;
  /** 시간 정보 */
  time: string;
};

/** Per-account configuration for KakaoTalk. */
export type KakaoTalkAccountConfig = {
  name?: string;
  enabled?: boolean;
  dmPolicy?: DmPolicy;
  allowFrom?: string[];
  pollIntervalMs?: number;
  bridgePath?: string;
  textChunkLimit?: number;
};

/**
 * Trim whitespace from a KakaoTalk target (chat room name) and reject empty strings.
 * Throws if the result is empty after trimming.
 */
export function normalizeKakaoTalkTarget(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("KakaoTalk target must not be empty");
  }
  return trimmed;
}
