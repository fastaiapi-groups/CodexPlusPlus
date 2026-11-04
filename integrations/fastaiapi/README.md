# Codex++ 的 FastAiApi / New API 接入

账户、模型与充值随右上角路线切换：

| 路线 | 服务来源 | 模型地址 |
|---|---|---|
| 路线1 | http://8.137.194.180:90 | http://8.137.194.180:90/v1 |
| 路线2 | https://tumeiapi.com | https://tumeiapi.com/v1 |
| 路线3 | https://newapi.fastaiapi.cloud | https://newapi.fastaiapi.cloud/v1 |

路线选择保存在应用状态目录。所有路线指向同一个 New API 后台，共用账号会话、Key、余额、分组和模型选择；切换仅改变请求来源，不退出登录、不重建页面状态。完整密码、会话和媒体 Key 使用系统凭据库保存；不复用原 Sub2API 账号会话。账户生成的 Codex 连接随路线更新，保留上下文等高级设置；其他供应商配置不受影响。

注册直接调用 `/api/user/register`，用户名精确取用户邮箱 `@` 前的内容，不另设用户名输入框、不自动截断。用户名冲突或超出站点限制时由站点拒绝；不会静默换名。邮箱验证码紧随邮箱字段，通过 `/api/verification?email=...` 发送，使用 `verification_code` 提交；邀请码对应 `aff_code`。注册成功后使用自动生成的用户名登录。后续支持邮箱或用户名登录。

账户使用 `/api/user/login`、`/api/user/self`；兼容旧 session cookie 和新版 JWT + refresh cookie。访问令牌、Cookie、密码和 API Key 不输出到日志；仅在勾选“记住账号密码”且认证成功后保存密码。退出会话保留记住的登录信息，取消勾选立即清除。

分组来自 `/api/user/self/groups`，保持 New API 的字符串分组名称；Key 通过 `/api/token/` 管理，仅原生层读取完整密钥。自动配置优先复用名为 `Codex++ FastAiApi` 的有效专用 Key，没有时优先选 `default` 或已开放的对话分组。余额使用站点 `quota_per_unit` 与货币设置换算；定价来自 `/api/pricing`，按当前 Key 分组倍率显示，未知价格不填为零。

充值使用 `/api/user/topup/info`、`/api/user/amount`、`/api/user/topup/self`、`/api/user/topup`。按后台开关支持易支付收银台、多彩付款码与兑换码。多彩沿用原 `request_id` 和订单号；易支付提交结果未知时先查订单，不自动重建。其他支付渠道可从当前路线的平台钱包继续。

## 图片与视频

概览按 default Key 权限分别展示文字、图片和视频模型，只有文字模型可写入 Codex 默认配置。

内置技能以用户提供的 `fastaiapi-media-fixed-20261104.zip` 为基础，安装到 `skills/fastaiapi-media`，保留图片、Grok、H3 的提示词与异步任务工作流，并增加 Codex++ 托管连接与音频生成。新版本会备份被替换的旧文件；同版本安装保留用户编辑。

登录成功后自动复用可用的 default 分组 Key；没有时创建专用 Key。系统环境变量为 `FASTAIAPI_API_KEY`、`FASTAIAPI_GROK_API_KEY`、`FASTAIAPI_H3_API_KEY` 及 `FASTAIAPI_BASE_URL`，三种 provider 使用同一后台和 Key，来源跟随路线。媒体 Key 同时保存在系统凭据库；技能的 `connection.json` 只记录来源及凭据命名空间，不含密钥。macOS 使用用户级 launchctl 环境和不含 Key 的登录恢复项，Windows 使用当前用户环境注册表；不修改其他服务的 OPENAI_*。权限不足显示明确提示。

概览支持手动输入 Key、检查连接、独立文本与图片测试。每分钟检查环境变量与当前 Key；丢失、改动、失效时显示一键修复入口。修复复用有效 default Key，避免无谓创建。已运行的 Codex/终端需要重启才能继承新环境；不会为测试自动重启用户 Codex。

视频默认 `minimax-h3`，只有用户明确指定时才换模型。H3 缺少参考图时先补齐素材，未开放该型号时明确提示，不自动改用 -f 或 -x。图片支持 base64 与 URL 响应，保存原响应后可恢复下载，避免付费提交后因下载失败而重发。音频补充 `/v1/audio/speech` 的 WAV 生成入口；实际可用性取决于后台模型和渠道。

## 网页开发

先启动原生接口联调桥（仅回环，凭据从无回显标准输入读取），再启动前端：

```sh
cargo run -p codex-plus-core --example serve_newapi_preview
node scripts/preview-newapi.mjs
```

网页地址为 `http://127.0.0.1:1439`，注册布局预览为 `http://127.0.0.1:1439/?register`。联调桥只接受该来源，账户与生成请求走真实后台；默认模型应用仅预览，充值订单与兑换写入关闭，因此网页调试不会改动本机 Codex 配置。测试账号不写在示例或脚本中。

## 验证边界

离线测试覆盖用户名规则、分组/余额/定价适配、原生层密钥保护、配置切换与上下文保留、图片与视频请求协议、任务恢复约束及下载凭据隔离。公开状态和模型目录可只读检查；真实验证码投递、账户注册登录、付费模型生成、支付与到账需要相应测试账号及实际交易验证，离线测试不能代替这些验收。

客户端更新仍使用原有签名更新服务，用户反馈仍使用独立反馈服务；New API 会话不会发送给这两个独立服务。
