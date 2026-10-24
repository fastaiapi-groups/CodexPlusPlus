// 发行版导航与参考程序一致；保留上游实现，后续合并无需删改功能代码。
const hiddenRoutes = new Set(["relay", "relayEnvironment", "requestLog", "multiLaunch", "computerUse", "recommendations", "agentCollaboration"]);
export const showAccountRoute = (route: string) => !hiddenRoutes.has(route);
export const showAccountTool = (tool: {id: string}) => tool.id === "codex";
