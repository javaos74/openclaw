import { z } from "zod";

export const kakaotalkAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  dmPolicy: z.enum(["pairing", "allowlist", "open", "disabled"]).optional(),
  allowFrom: z.array(z.string()).optional(),
  pollIntervalMs: z.number().int().min(500).max(60000).optional(),
  bridgePath: z.string().optional(),
  textChunkLimit: z.number().int().positive().optional(),
});

export const KakaoTalkConfigSchema = kakaotalkAccountSchema.extend({
  accounts: z.object({}).catchall(kakaotalkAccountSchema).optional(),
});
