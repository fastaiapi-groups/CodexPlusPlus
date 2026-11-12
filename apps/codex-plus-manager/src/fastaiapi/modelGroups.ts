import type { AccountGroup } from "./groupCache";

export type ModelKind = "text" | "image" | "video";
export type ModelGroupKey = { id: number; name: string; status: string; group?: string | null; group_id?: number | null };
export type ModelChoice = { model: string; groupId: string | null; keyId?: number };

export function keyGroup(key: ModelGroupKey, platform: string): string | null {
  if (platform === "subapi") return key.group_id == null ? null : String(key.group_id);
  return key.group || "default";
}

export function initialGroup(groups: AccountGroup[], current: string | null) {
  return groups.find(group => group.id === current)
    ?? groups.find(group => group.name.toLowerCase() === "default")
    ?? groups.find(group => group.recommended)
    ?? groups[0];
}

export function modelKind(id: string): ModelKind | "other" {
  const name = id.toLowerCase();
  if (/video|sora|veo|kling|wan|seedance|minimax-h3|ltx|hunyuan|sd2\.5|muze/.test(name)) return "video";
  if (/image|dall-e|flux|midjourney|stable-diffusion|sdxl|imagen|ideogram/.test(name)) return "image";
  if (/audio|tts|embedding|realtime|whisper|dubbing|transcribe|moderation|auto-review|reserve/.test(name)) return "other";
  return "text";
}

export function supportsModel(platform: string, kind: ModelKind, id: string, detected = modelKind(id)) {
  return detected === kind
    && (platform !== "subapi" || kind !== "video" || ["minimax-h3", "grok-imagine-video-1.5"].includes(id));
}

export function selectableGroupModels(platform: string, kind: ModelKind, ids: string[], current: string[] = [],
  kinds?: ReadonlyMap<string, ModelKind | "other">) {
  return [...new Set([...current, ...ids])].filter(id => supportsModel(platform, kind, id, kinds?.get(id)));
}
