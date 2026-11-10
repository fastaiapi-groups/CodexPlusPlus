# FastAiApi 定制保护清单

初始盘点：2026-11-11，自有代码基线 `4ed1f862`。这是行为保护清单，不是「这些文件永远不能修改」的白名单。每次同步先检查新增自有提交并补齐，下面路径仅为当前入口；上游可重构路径，原有能力与数据兼容必须保留。

与 [上游同步维护方案](upstream-sync.md) 配合使用。每轮在同步记录中填写各项状态：通过 / 有意替代且已验证 / 阻塞 / 未验证，并附命令或人工验收证据。不能默认勾选全部通过。

| 编号 | 要保留的用户行为 | 当前关键入口 | 验收重点 |
| --- | --- | --- | --- |
| F01 | FastAiApi 账号登录、恢复、退出，New API/SubAPI 分平台，登录平台固定、路线可切换 | `apps/codex-plus-manager/src/fastaiapi/`；Tauri `src/fastaiapi_commands.rs`；core `fastaiapi_platform.rs`、`fastaiapi_session.rs`、`fastaiapi_credentials.rs`、`fastaiapi_secret_store.rs` | 平台凭据不串用；切路线保留正确状态；退出/重启不复活历史会话；系统凭据失败有明确提示 |
| F02 | 自动接入供应商、选择 Key/模型、分组与模型说明、人民币价格含阶梯定价 | 前端 `KeySelector.tsx`、`ModelPicker.tsx`、`ModelDialog.tsx`、`GroupDescription.tsx`、`onboarding.ts`；core `fastaiapi.rs`、`fastaiapi_subapi.rs`、`fastaiapi_pricing.rs` | 使用正确平台与 Key 分组；不覆盖未知现有配置；保留供应商切换保护、回滚及备份；不虚构价格 |
| F03 | 充值、订单恢复、支付标识、兑换码、订阅与客服入口 | 前端 `NewApiRecharge.tsx`、`SubApiRecharge.tsx`、`SubApiSubscriptions.tsx`、`paymentState.ts`、`ContactQr.tsx` | 金额输入可见、支付状态/恢复正确、平台接口隔离；离线回归不真实下单 |
| F04 | 平台反馈、二维码、私有管理入口及服务端隔离 | 前端 `Feedback.tsx`；`services/` 及已有反向代理配置 | 保留客服和反馈；私有管理接口不意外公开；不随桌面同步自动部署服务器 |
| F05 | 媒体技能安装、图片/视频默认型号按平台保存、显式型号覆盖、托管 H3/Grok/公共协议 | `integrations/fastaiapi/media-api/`；前端 `MediaModels.tsx`、`MediaTestDialog.tsx`；core `fastaiapi_media_env.rs` | 重启/切路线保存正确默认；原任务沿用回执；不重复提交；跨域下载不携带 Key；安装技能与仓库产物一致 |
| F06 | 系统环境变量/凭据检查和修复、失败回滚、配置引导、手册与内嵌 Codex 指南 | core `fastaiapi_media_env.rs`、`fastaiapi_secret_store.rs`；前端 `MediaSetupGuide.tsx`、`Manual.tsx`、`ApiGuide.tsx` | 超时/拒绝可恢复且不泄露凭据；不把旧平台 Key 当有效连接；真实平台支持边界如实展示 |
| F07 | 自有安装包、签名更新源、公钥、下载与升级后的账号/状态延续 | `assets/update/fastaiapi-release-public-key.txt`；`.github/workflows/fastaiapi-client-build.yml`；`scripts/package-fastaiapi-macos.mjs`；`scripts/installer/windows/`；core 更新模块 | 不切回官方更新源/公钥；不误发官方 release；版本一致；升级状态兼容；签名私钥不进入仓库 |
| F08 | 模型级窗口/压缩阈值、catalog 指针与旧 per-profile 单值兼容 | core `settings.rs`、`relay_config.rs`、`model_catalog.rs`；前端模型列表；`docs/model-window-overrides.md` | `model_list` 窗口后缀、手工窗口、导入及外部 catalog 兼容；旧配置无需迁移即可继续使用 |
| F09 | 拓展接口兼容、路由白名单、持久注册与扫描安全 | `assets/inject/renderer-inject/91-extension-api.js`、`01-registry.js` 及汇编产物 | 已发布类名/constants 不更名；写路由不开放；插入节点带 `data-codex-plus-ext`；重建 DOM 不丢注册 |
| F10 | 用户当前的其他本地适配与上游既有能力继续可用 | 每轮相对共同祖先的自有侧 diff；`App.tsx`、Tauri 注册入口、配置生成、工作流等共享接入点 | 包含供应商名称保留、注入重试/日志、Computer Use 接入等历史改动；核实来源和当前行为，不能仅以 FastAiApi 文件名过滤定制 |

## 已有验证入口

- 前端：`apps/codex-plus-manager/src/fastaiapi-*.test.ts`；在前端目录运行既有 `npm test`、`npm run check`。
- 核心：`cargo test -p codex-plus-core` 包含平台、凭据、媒体、定价等现有单测，以及 `tests/relay_config.rs`、`tests/model_catalog.rs`、`tests/updater.rs` 等集成测试。按变动检查数据层和 Tauri 既有测试，不能仅测前端。
- 媒体：`integrations/fastaiapi/media-api/scripts/test_media_api.py` 与 `test_managed_media.py`。先检查测试隔离方式再运行，不加载真实连接或进行付费生成。
- 安装升级：参考 `docs/plans/2026-10-24-client-upgrade-acceptance.md`、自有 Windows 构建工作流和现有平台验收脚本；不能在 macOS 上声称已完成 Windows 验收。
- 历史证据：`docs/verification/2026-11-07-app-media/report.md`、`docs/verification/2026-11-05-platforms/report.md`。历史成功不等于本次通过；报告尾部已有未完成的钥匙串授权与真实 App 联测，后续仍需据实核验。

## 每次清单更新规则

新增定制时登记入口、兼容要求、离线测试及需要用户参与的验收；共享文件里的薄接入也要记。上游替代实现时记录替代依据和数据迁移验证，不静默删除保护项。列表不完备时以自有历史和用户现有功能为准，先补盘点再合并。
