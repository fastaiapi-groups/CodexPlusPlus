---
name: fastaiapi-media
description: 通过 FastAiApi 生成、编辑或批量制作图片及参考图视频；支持 GPT Image、Grok 和 MiniMax H3，含提示词准备与异步任务恢复。
---

# FastAiApi Media API

可移植的 Python 3.10+ 标准库客户端，不依赖其他技能或 pip 包。
`<skill>` 指本目录，`<project>` 指产物目录；路径含空格时加引号。
Windows 用 `py -3` 或可用的 Python 3.10+ 命令，macOS/Linux 用 `python3`。

## 模型与站点

| 模型 | provider | 固定接口站点 | 资料 |
| --- | --- | --- | --- |
| `gpt-image-2`、`gpt-image-2.5` | `main` | https://fastaiapi.cloud | [图片](references/images.md) |
| `grok-imagine-video-1.5`（别名 `grok`） | `grok` | https://fastaiapi.cloud | [Grok](references/grok.md) |
| `minimax-h3` | `h3` | https://newapi.fastaiapi.cloud | [H3](references/h3.md) |

图片 main、Grok grok、H3 h3 三种凭据分别配置，不自动共用、不读取旧平台配置或旧环境变量。
模型决定提交、查询、恢复、下载的站点；不能因失败自动换站点、模型或账号。
配置命令见 [首次使用](references/setup.md)。主站 Key 页面为 https://fastaiapi.cloud/keys，
H3 Key 页面为 https://newapi.fastaiapi.cloud/keys。主站图片 Key 需选图片分组，Grok Key 选“其他 → grok”分组；图片 Key 的模型权限不代表能调用 Grok。

## 使用流程

1. 沿用用户指定模型、素材、时长、比例和数量。安装、分析或测试技能不意味着授权付费生成。
2. 根据模型运行 `config-status --provider main`、`config-status --provider grok` 或 `config-status --provider h3`。
   未配置时请用户提供对应站点的 Key，按 setup.md 保存；不复述密钥。
3. 检查实际参考素材。H3 必须有 1–9 张参考图；提交前按 [H3](references/h3.md) 的专用规则优化提示词。
   纯文生视频可用 Grok；用户明确指定 H3 时不静默替换模型。
4. 视频先离线 `prepare`，再 `submit`。任务 ID 立即持久化，用 `status` 或最多60秒的 `wait` 查询。
   图片可用 `image`，或 `prepare` / `submit`。完整命令见 [工作流](references/workflow.md)。
5. 成功后下载、检查实际画面和声音，返回本地绝对文件路径；未检查或未实测要明确说明。

提交结果不确定时不重发 POST；从对应平台核对任务 ID，再用 `recover` 恢复。
H3 请求携带稳定的 Idempotency-Key，但新站服务端幂等性尚未验证，因此禁用自动 POST 重试和未知结果重发。
旧版回执不允许拿到新站继续查询或提交，防止串站。

## 权限和验证边界

遵守当前宿主实际的文件、联网和审批设置，不预设所有环境都需要提权。
联网错误也可能来自代理或服务不可达，不能直接判定为沙箱拦截。
不把 Key 写进技能包、日志或生成产物。没有 Key 时仍能离线准备和测试。

本包已完成离线模拟测试；接口域名按用户指定分流。请求字段仍需与实际渠道契约一致，
未进行付费端到端生成验证，不把原供应商的成功记录写成本站实测。
模型目录中出现其他 ID 不代表本适配器已支持。详见 [来源与验证边界](references/sources.md)。
