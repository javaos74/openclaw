import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setKakaoTalkRuntime(next: PluginRuntime) {
  runtime = next;
}

export function getKakaoTalkRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("KakaoTalk runtime not initialized");
  }
  return runtime;
}
