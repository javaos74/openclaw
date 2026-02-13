import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { kakaotalkPlugin } from "./src/channel.js";
import { setKakaoTalkRuntime } from "./src/runtime.js";

const plugin = {
  id: "kakaotalk",
  name: "KakaoTalk",
  description: "KakaoTalk channel plugin (macOS Accessibility)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setKakaoTalkRuntime(api.runtime);
    api.registerChannel({ plugin: kakaotalkPlugin });
  },
};

export default plugin;
