export type ConnectionMode = "fastai" | "official";
export const OFFICIAL_PROFILE_ID = "fastaiapi-official";

type Profile = {
  id: string;
  relayMode: string;
  officialMixApiKey: boolean;
};

export function connectionMode(profile: Profile | undefined): ConnectionMode | null {
  if (!profile) return null;
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return "official";
  if (/^fastaiapi-(newapi|subapi)-/.test(profile.id)) return "fastai";
  return null;
}

// 只选择已保存的连接。配置快照、凭据及失败回滚交给既有供应商切换流程。
export function connectionTarget<T extends Profile>(
  profiles: T[],
  activeId: string,
  mode: ConnectionMode,
  platform: string,
  savedProfileId: string | undefined,
  createOfficial: () => T,
): T {
  if (mode === "official") {
    const active = profiles.find(profile => profile.id === activeId);
    if (active && connectionMode(active) === "official") return active;
    const saved = profiles.find(profile => profile.id === OFFICIAL_PROFILE_ID);
    if (saved && connectionMode(saved) !== "official") {
      throw new Error("官方账号连接配置已改变，请先在管理供应商中检查。");
    }
    return saved ?? createOfficial();
  }
  const saved = profiles.find(profile => profile.id === savedProfileId);
  if (!saved || !saved.id.startsWith(`fastaiapi-${platform}-`) || connectionMode(saved) !== "fastai") {
    throw new Error("当前平台没有已保存的连接，请先登录并完成模型配置。");
  }
  return saved;
}
