# FastAiApi 接口来源与验证边界

站点分配来自用户指定：
- 主站 https://fastaiapi.cloud：GPT Image 与 Grok。
- H3 https://newapi.fastaiapi.cloud：minimax-h3。

本次基于用户提供的 media-api 附件修改品牌、凭据存储和模型路由；
提示词模板、图片及视频请求构造器保留包内实现。旧供应商文档链接与付费成功记录不适用于本站，已移除。
不为不存在的本站文档路径生成替代链接。

2026-10-24 验证范围：Python 离线模拟测试、CLI、固定 origin 分流、密钥隔离、
跨域鉴权限制、持久化和重复提交防护；未使用真实密钥发起付费生成。
模型可见性不等于协议兼容。H3 的参数、输出字段、保留期限与服务端幂等保证，
须按本站实际渠道确认；POST 自动重试保持关闭。

本站模型广场已核对 minimax-h3 可见，视频端点示例为 /v1/videos；示例正文为通用模板，不能据此验证全部 H3 字段。

## 2026-10-24 本机实际验收补充

从教程下载、安装到 Codex 用户技能目录后，用主站图片分组 Key 完成 gpt-image-2 的一次实际生成；PNG 已保存并打开核验，1254×1254，1,610,313 字节。
Grok 分组 Key 可读取模型目录，但一次6秒 grok-imagine-video-1.5 提交返回 HTTP 503，没有任务ID。对应 grok 分组渠道暂停且调度关闭；用户要求保持暂停，因此未验证视频生成和下载，未重复提交。
实测发现同一主站不同分组需要不同 Key，本机修正版增加 --provider grok（FASTAIAPI_GROK_API_KEY）独立配置，防止覆盖图片 main Key。两个 API origin 保持不变。此记录不代表 H3 已完成付费实测。

## 2026-11-04 Windows 图片请求修复

FastAiApi 前置 Cloudflare 会以 Error 1010 拦截 Python urllib 默认浏览器签名。客户端现对 API 请求和下载统一发送稳定的浏览器 User-Agent；同一 Key 的 `/v1/models` 请求已由 403 恢复为 200，并完成一次 `gpt-image-2` 图片生成和本地 PNG 校验。

## 2026-11-07 Codex++ New API 托管实测

使用当前 New API 路线2（tumeiapi.com）的托管 default Key 完成 gpt-6-sol 文本调用、gpt-image-2 图片生成和精确 minimax-h3 视频生成。
图片保存并目视检查，实际1254×1254；以该图片作参考生成5秒864×480视频，H.264/24fps、AAC双声道，下载后完整解码无错误，逐秒画面确认机器人挥手动作。

首次 H3 旧 content 协议提交返回400。根据本站 New API 源码的公共视频协议修正为 prompt、seconds、size、reference_images，之后单次提交成功；未修改旧回执或重发未知结果。
成功响应为 completed，下载使用服务返回的同源 content_url 并携带模型 Key；外部下载地址不带鉴权。任务回执可跨进程由安装后的技能继续查询、下载。
New API 默认480p，明确指定720p会在联网前拒绝，不自动升档；独立包原协议不变。

默认独立语音 gpt-4o-mini-tts 的 /v1/audio/speech 仍返回503，未产生可验收的WAV，不将视频内的音轨算作独立语音接口通过。
SubAPI 本轮没有真实账号生成测试，不能套用以上 New API 结果。安装后技能的54项离线测试通过，并用禁止系统凭据调用的方式验证自测隔离。

## 2026-11-07 Codex 内部完整调用补测

使用已安装 Codex CLI 0.165.0-alpha.1.2 与当前托管连接启动隔离验收，由 Codex 自己读取已安装技能、查询 main/h3 配置，调用 image（gpt-image-2）、观察实际参考图、离线 prepare（省略型号）、单次 submit、查询和 download（精确 minimax-h3）。图片实际1254×1254；视频5秒864×480，H.264/AAC，完整解码通过，并观察到抬手、挥手、放下。过程和回执保存在本机测试目录，不含 Git 中的凭据或完整请求。

新增的 UI 默认模型会按平台保存并跨同平台路线保留，CLI 显式 --model 优先。New API 公共协议兼容路径的其他型号、H3 -f 等仅完成离线契约验证，未逐个真实生成；不能使用 minimax-h3 的成功记录替代其他型号。macOS 环境写入实际验证；Windows 注册表／权限失败为模拟验证，Linux 仅独立模式与配置错误处理验证，均未做对应系统机器验收。独立语音接口前次503仍未通过。
