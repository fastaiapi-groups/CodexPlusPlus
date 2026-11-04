---
name: fastaiapi-media
description: 通过 FastAiApi 生成、编辑或批量制作图片及参考图视频；支持 GPT Image、Grok 和 MiniMax H3，含提示词准备与异步任务恢复。
---

# FastAiApi Media API

可移植的 Python 3.10+ 标准库客户端，不依赖其他技能或 pip 包。
`<skill>` 指本目录，`<project>` 指产物目录；路径含空格时加引号。
Windows 用 `py -3` 或可用的 Python 3.10+ 命令，macOS/Linux 用 `python3`。

## Codex++ 内置模式（优先于下述独立包配置）

本包以用户提供的 fastaiapi-media-fixed-20261104.zip 为基础。Codex++ 登录后自动复用或创建当前路线的 default 分组 Key，并配置 FASTAIAPI_API_KEY、FASTAIAPI_GROK_API_KEY、FASTAIAPI_H3_API_KEY 与 FASTAIAPI_BASE_URL。路线为 http://8.137.194.180:90 或 https://tumeiapi.com；有 connection.json 时，三种 provider 均使用当前路线，忽略旧项目/全局凭据，避免串站。没有托管连接时，独立包仍按下表分流。

**视频默认使用 minimax-h3**，除非用户明确指定其他模型。缺少参考图时先向用户补齐，不自动换成 Grok 或 -f / -x。prepare 的 --model 可省略，默认 minimax-h3。当前路线未开放该精确模型时，提示用户在平台开通或明确选择其他型号，不静默替换。

环境变量 Key 失效或路线不一致时，请用户在 Codex++ 概览“媒体创作与环境配置”中点击“一键配置／修复”；也支持手动输入 Key，再分别进行文本测试与图片测试。权限不足会提示系统凭据库或环境变量写入错误，不要求 sudo。新环境变量供重启后的 Codex/终端使用；不可用时可读取系统凭据库中的当前路线凭据，Key 不输出到日志。

音频生成：`python3 <skill>/scripts/media_api.py audio --text-file <project>/speech.txt --output <project>/speech.wav`。默认语音模型 gpt-4o-mini-tts，可用 --model 指定；需要当前站点开放语音模型及 /v1/audio/speech。原包没有单独音频生成接口，此为 Codex++ 补充；视频引用音频仍按原有 H3/Grok 工作流处理。

## 模型与站点

| 模型 | provider | 固定接口站点 | 资料 |
| --- | --- | --- | --- |
| `gpt-image-2`、`gpt-image-2.5`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst` | `main` | https://fastaiapi.cloud | [图片](references/images.md) |
| `grok-imagine-video-1.5`（别名 `grok`） | `grok` | https://fastaiapi.cloud | [Grok](references/grok.md) |
| `minimax-h3` | `h3` | https://newapi.fastaiapi.cloud | [H3](references/h3.md) |

图片 main、Grok grok、H3 h3 三种凭据分别配置，不自动共用、不读取旧平台配置或旧环境变量。
独立包由模型决定服务站点；Codex++ 托管模式的两条路线属于同一后台，切换保留账号和任务，只改变请求入口。不因失败自动换模型或账号。
配置命令见 [首次使用](references/setup.md)。主站 Key 页面为 https://fastaiapi.cloud/keys，
H3 Key 页面为 https://newapi.fastaiapi.cloud/keys。主站图片 Key 需选图片分组，Grok Key 选“其他 → grok”分组；图片 Key 的模型权限不代表能调用 Grok。

## 使用流程

1. 沿用用户指定模型、素材、时长、比例和数量。安装、分析或测试技能不意味着授权付费生成。
2. 根据模型运行 `config-status --provider main`、`config-status --provider grok` 或 `config-status --provider h3`。
   未配置时请用户提供对应站点的 Key，按 setup.md 保存；不复述密钥。
3. 检查实际参考素材。H3 必须有 1–9 张参考图；提交前按 [H3](references/h3.md) 的专用规则优化提示词。
   视频默认 H3；只有用户明确指定 Grok 时才用 Grok。缺少 H3 参考图先补齐素材。
   图片默认使用 `1024x1024` 小图；只有用户明确指定尺寸时才改用该尺寸，不因“高清”“最终稿”等泛化表述自行升级到 2K 或 4K。
4. 视频先离线 `prepare`，再 `submit`。任务 ID 立即持久化，用 `status` 或最多60秒的 `wait` 查询。
   图片可用 `image`，或 `prepare` / `submit`。完整命令见 [工作流](references/workflow.md)。
5. 成功后下载、检查实际画面和声音，返回本地绝对文件路径；未检查或未实测要明确说明。

提交结果不确定时不重发 POST；从对应平台核对任务 ID，再用 `recover` 恢复。
H3 请求携带稳定的 Idempotency-Key，但新站服务端幂等性尚未验证，因此禁用自动 POST 重试和未知结果重发。
独立包旧站任务不能迁移到新后台；Codex++ 的两条托管路线共用任务状态。

## 权限和验证边界

遵守当前宿主实际的文件、联网和审批设置，不预设所有环境都需要提权。
联网错误也可能来自代理或服务不可达，不能直接判定为沙箱拦截。
不把 Key 写进技能包、日志或生成产物。没有 Key 时仍能离线准备和测试。

本包已完成离线模拟测试；接口域名按用户指定分流。请求字段仍需与实际渠道契约一致，
未进行付费端到端生成验证，不把原供应商的成功记录写成本站实测。
模型目录中出现其他 ID 不代表本适配器已支持。详见 [来源与验证边界](references/sources.md)。
