---
name: fastaiapi-media
description: 通过 FastAiApi 生成、编辑或批量制作图片及参考图视频；支持 GPT Image、Grok 和 MiniMax H3，含提示词准备与异步任务恢复。
---

# FastAiApi Media API

可移植的 Python 3.10+ 标准库客户端，不依赖其他技能或 pip 包。
`<skill>` 指本目录，`<project>` 指产物目录；路径含空格时加引号。
Windows 用 `py -3` 或可用的 Python 3.10+ 命令，macOS/Linux 用 `python3`。

## Codex++ 内置模式（优先于下述独立包配置）

本包以用户提供的 fastaiapi-media-fixed-20261104.zip 为基础。Codex++ 先选择 New API 或 SubAPI 平台，登录后自动复用或创建对应可用分组 Key（New API 优先 default），并配置 FASTAIAPI_API_KEY、FASTAIAPI_GROK_API_KEY、FASTAIAPI_H3_API_KEY 与 FASTAIAPI_BASE_URL。New API 路线为 http://8.137.194.180:90、https://tumeiapi.com 或 https://newapi.fastaiapi.cloud，SubAPI 入口为 https://fastaiapi.cloud；有 connection.json 时，三种 provider 均使用当前路线，忽略旧项目/全局凭据，避免串站。没有托管连接时，独立包仍按下表分流。

**视频初始默认使用 minimax-h3**。用户可在 Codex++ 概览选择默认图片／视频模型，`image` 或 `prepare` 省略 `--model` 时读取 connection.json 中当前平台的 model_defaults；对话中明确指定型号时传 `--model`，优先于界面选择。缺少参考图时先向用户补齐，不自动换成 Grok 或 -f / -x。未保存过选择时，prepare 默认 minimax-h3，image 默认 gpt-image-2。当前路线未开放该精确模型时，提示用户在平台开通或明确选择其他型号，不静默替换。

New API 托管模式使用当前站点公共视频协议（`prompt`、`seconds`、参考图数组），默认480p，可显式选择768p或1080p；不再向 New API 发送旧 `content` 协议。独立包及 SubAPI 仍保留原有720p协议，兼容性分别验收。协议和当前素材限制见 [H3](references/h3.md)。

环境变量 Key 失效或路线不一致时，请用户在 Codex++ 概览“媒体创作与环境配置”中点击“一键配置／修复”；也支持手动输入 Key，再分别进行文本测试与图片测试。权限不足会提示系统凭据库或环境变量写入错误，不要求 sudo。新环境变量供重启后的 Codex/终端使用；不可用时可读取系统凭据库中的当前路线凭据，Key 不输出到日志。

自动写入会先快照并校验四项用户级变量，失败时回滚；回滚不完整会明确提示。`connection.json` 的 `environment_configured: false` 表示系统环境尚未配置完成，此时技能只尝试读取该连接的系统凭据，不使用继承的旧 Key。macOS 环境查询限时3秒、凭据查询限时15秒；被拒绝或超时均停止并提示授权／修复，不绕过系统弹窗。Windows 读取 HKCU 用户环境和当前用户凭据管理器，不写系统级变量；Linux 当前不支持应用自动凭据保存，需按独立包教程配置。`config-status` 会检查凭据是否可读，不代表模型联网验证已通过。

音频生成：`python3 <skill>/scripts/media_api.py audio --text-file <project>/speech.txt --output <project>/speech.wav`。默认语音模型 gpt-4o-mini-tts，可用 --model 指定；需要当前站点开放语音模型及 /v1/audio/speech。原包没有单独音频生成接口，此为 Codex++ 补充；视频引用音频仍按原有 H3/Grok 工作流处理。

## 模型与站点

| 模型 | provider | 固定接口站点 | 资料 |
| --- | --- | --- | --- |
| `gpt-image-2`、`gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` | `main` | https://fastaiapi.cloud | [图片](references/images.md) |
| `grok-imagine-video-1.5`（别名 `grok`） | `grok` | https://fastaiapi.cloud | [Grok](references/grok.md) |
| `minimax-h3` | `h3` | https://newapi.fastaiapi.cloud | [H3](references/h3.md) |

图片 main、Grok grok、H3 h3 三种凭据分别配置，不自动共用、不读取旧平台配置或旧环境变量。
独立包由模型决定服务站点；Codex++ 托管模式中，同一平台的路线属于同一后台，切换保留账号和任务，只改变请求入口。不因失败自动换模型或账号。
配置命令见 [首次使用](references/setup.md)。主站 Key 页面为 https://fastaiapi.cloud/keys，
H3 Key 页面为 https://newapi.fastaiapi.cloud/keys。主站图片 Key 需选图片分组，Grok Key 选“其他 → grok”分组；图片 Key 的模型权限不代表能调用 Grok。

## 使用流程

1. 沿用用户指定模型、素材、时长、比例和数量。安装、分析或测试技能不意味着授权付费生成。
2. 根据模型运行 `config-status --provider main`、`config-status --provider grok` 或 `config-status --provider h3`。
   未配置时请用户提供对应站点的 Key，按 setup.md 保存；不复述密钥。
3. 检查实际参考素材。H3 必须有 1–9 张参考图；提交前按 [H3](references/h3.md) 的专用规则优化提示词。
   视频未保存选择时默认 H3；保存过选择时跟随该型号。用户选择 Grok 时按 Grok 规则调用，其他 New API 兼容型号按公共协议构造，不能擅自更换成 H3。缺少 H3 参考图先补齐素材。
   图片默认使用 `1024x1024` 小图；只有用户明确指定尺寸时才改用该尺寸，不因“高清”“最终稿”等泛化表述自行升级到 2K 或 4K。
4. 视频先离线 `prepare`，再 `submit`。任务 ID 立即持久化，用 `status` 或最多60秒的 `wait` 查询。
   图片可用 `image`，或 `prepare` / `submit`。完整命令见 [工作流](references/workflow.md)。
5. 成功后下载、检查实际画面和声音，返回本地绝对文件路径；未检查或未实测要明确说明。

提交结果不确定时不重发 POST；从对应平台核对任务 ID，再用 `recover` 恢复。
H3 请求携带稳定的 Idempotency-Key，但新站服务端幂等性尚未验证，因此禁用自动 POST 重试和未知结果重发。
独立包旧站任务不能迁移到新后台；Codex++ 同一平台的托管路线共用任务状态；New API 与 SubAPI 的任务不可混用。

## 权限和验证边界

遵守当前宿主实际的文件、联网和审批设置，不预设所有环境都需要提权。
联网错误也可能来自代理或服务不可达，不能直接判定为沙箱拦截。
不把 Key 写进技能包、日志或生成产物。没有 Key 时仍能离线准备和测试。

本包包含隔离用户配置的离线模拟测试；安装后可在技能目录直接运行，不读取真实系统凭据。
实际生成结果按平台、型号及日期记录在 [来源与验证边界](references/sources.md)，不把其他平台或原供应商的成功记录写成当前站点实测。
New API 托管模式另提供公共协议兼容路径：图片通过 /v1/images/generations（编辑走 /v1/images/edits），其他视频通过 /v1/videos 的 prompt/seconds/size 和可选参考图／音频数组；H3 系列沿用参考图与专用提示词规则，精确 Grok 型号沿用其专用参数。兼容路径保留精确型号，服务端拒绝参数时报告限制，不换型号；不能据此声称全部目录型号已付费验收。SubAPI 视频仍仅支持包内 H3/Grok 协议。详见 [来源与验证边界](references/sources.md)。
