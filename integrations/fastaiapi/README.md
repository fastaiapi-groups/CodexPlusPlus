# Codex++ 的 FastAiApi / New API / SubAPI 接入

登录和注册页先选择 New API 或 SubAPI；登录后展示对应平台的账号、余额、Key、分组、模型及充值。两个平台分别保存凭据和记住的登录信息；注册、登录成功或恢复有效会话后固定当前平台，右上角隐藏平台入口，仍可切换该平台路线。退出登录后才能重新选择平台。选择平台不会应用 Codex 配置或接管媒体环境。

New API 路线：

| 路线 | 服务来源 | 模型地址 |
|---|---|---|
| 路线1 | http://8.137.194.180:90 | http://8.137.194.180:90/v1 |
| 路线2 | https://tumeiapi.com | https://tumeiapi.com/v1 |
| 路线3 | https://newapi.fastaiapi.cloud | https://newapi.fastaiapi.cloud/v1 |

路线选择保存在应用状态目录。所有路线指向同一个 New API 后台，共用账号会话、Key、余额、分组和模型选择；切换仅改变请求来源，不退出登录、不重建页面状态。完整密码、会话和媒体 Key 使用系统凭据库保存；与 SubAPI 的会话、Key 和配置命名空间隔离。账户生成的 Codex 连接随路线更新，保留上下文等高级设置；其他供应商配置不受影响。

注册直接调用 `/api/user/register`，用户名精确取用户邮箱 `@` 前的内容，不另设用户名输入框、不自动截断。用户名冲突或超出站点限制时由站点拒绝；不会静默换名。邮箱验证码紧随邮箱字段，通过 `/api/verification?email=...` 发送，使用 `verification_code` 提交；邀请码对应 `aff_code`。注册成功后使用自动生成的用户名登录。后续支持邮箱或用户名登录。

账户使用 `/api/user/login`、`/api/user/self`；兼容旧 session cookie 和新版 JWT + refresh cookie。访问令牌、Cookie、密码和 API Key 不输出到日志；仅在勾选“记住账号密码”且认证成功后保存密码。退出会话保留记住的登录信息，取消勾选立即清除。

New API 退出时将当前会话替换为空会话记录，阻止旧路线的遗留登录被回退恢复；不依赖额外权限删除旧签名应用的历史条目。当前媒体凭据清理失败会明确提示，已完成的账号退出仍生效。登录成功会覆盖空记录保存新会话。

分组来自 `/api/user/self/groups`，保持 New API 的字符串分组名称；Key 通过 `/api/token/` 管理，仅原生层读取完整密钥。自动配置优先复用名为 `Codex++ FastAiApi` 的有效专用 Key，没有时优先选 `default` 或已开放的对话分组。余额使用站点 `quota_per_unit` 与货币设置换算；定价来自 `/api/pricing`，按当前 Key 分组倍率显示；支持 tiered_expr 上下文阶梯价，表达式单价仅叠加分组和币种因子。无法准确展开的专用计价规则提示前往平台查看，未知价格不填为零。

充值使用 `/api/user/topup/info`、`/api/user/amount`、`/api/user/topup/self`、`/api/user/topup`。按后台开关支持易支付收银台、多彩付款码与兑换码。多彩沿用原 `request_id` 和订单号；易支付提交结果未知时先查订单，不自动重建。其他支付渠道可从当前路线的平台钱包继续。

## SubAPI

入口为 `https://fastaiapi.cloud`，界面显示路线1。使用本地 `sub2apiSelf` 的用户接口契约：邮箱登录 `/api/v1/auth/login`、注册 `/api/v1/auth/register`、邮箱验证码 `/api/v1/auth/send-verify-code`。注册后通过 `/api/v1/user` 设置邮箱前缀用户名，失败保留注册成功状态并给出提示；支持 `/auth/login/2fa` 的六位 TOTP。访问 Token 仅在 HTTP401 时用 refresh Token 刷新，网络/5xx 不重放写操作。人机验证开启时提示去平台处理，不绕过验证。

账号来自 `/api/v1/auth/me`，余额保持 SubAPI 的 USD 单位；Key 来自 `/api/v1/keys`，原生层剥离完整 Key 后才返回前端。分组来自 `/groups/available`，保持数字 ID，在前端规范为字符串。自动配置优先复用专用 Key 或默认组 Key；创建时校验当前账号可用分组，选择默认组、推荐 OpenAI/composite 分组或唯一可用分组，不能假设 New API 的 default 名称就是 SubAPI 分组 ID。

模型通过当前 Key 的 `/v1/models` 查询；定价来自 `/api/v1/model-plaza`，按 Key 绑定分组及用户倍率转换为美元/百万 tokens。未公布价格保持未知，不补零。套餐来自 `/api/v1/subscriptions`；充值配置、套餐销售和订单使用 `/api/v1/payment/checkout-info`、`/payment/orders`、`/payment/orders/my`，兑换使用 `/api/v1/redeem`。提交结果不确定时查询原订单，不自动重建。需要 Stripe/Airwallex 等专用网页收银流程时可前往平台钱包继续。

当前登录期间只能使用所选平台，原生层同样拒绝切换平台或请求另一平台的账号/模型配置；完成退出后解除限制。显式应用模型后以 `fastaiapi-newapi-*`、`fastaiapi-subapi-*` 保存各自配置和选择；退出后选择另一个平台不改当前生效配置。媒体凭据同样按平台分别保存，全局 FASTAIAPI_* 和技能连接描述仅指向当前应用的媒体连接。跨面板媒体任务不得互相查询或恢复；同一 New API 后台仍可跨路线查询。SubAPI 不同分组的实际媒体协议和模型权限仍须逐项实测，不能把模型出现在目录视为全部生成接口已验收。

## 图片与视频

概览按 default Key 权限分别展示文字、图片和视频模型，只有文字模型可写入 Codex 默认配置。

内置技能以用户提供的 `fastaiapi-media-fixed-20261104.zip` 为基础，安装到 `skills/fastaiapi-media`，保留图片、Grok、H3 的提示词与异步任务工作流，并增加 Codex++ 托管连接与音频生成。新版本会备份被替换的旧文件；同版本安装保留用户编辑。

登录成功后自动复用可用的 default 分组 Key；没有时创建专用 Key。系统环境变量为 `FASTAIAPI_API_KEY`、`FASTAIAPI_GROK_API_KEY`、`FASTAIAPI_H3_API_KEY` 及 `FASTAIAPI_BASE_URL`，三种 provider 使用同一后台和 Key，来源跟随路线。媒体 Key 同时保存在系统凭据库；技能的 `connection.json` 只记录来源及凭据命名空间，不含密钥。macOS 使用用户级 launchctl 环境和不含 Key 的登录恢复项，Windows 使用当前用户环境注册表；不修改其他服务的 OPENAI_*。权限不足显示明确提示。

概览支持手动输入 Key、检查连接、独立文本与图片测试。每分钟检查环境变量与当前 Key；丢失、改动、失效时显示一键修复入口。修复复用有效 default Key，避免无谓创建。已运行的 Codex/终端需要重启才能继承新环境；不会为测试自动重启用户 Codex。

视频默认 `minimax-h3`，只有用户明确指定时才换模型。H3 缺少参考图时先补齐素材，未开放该型号时明确提示，不自动改用 -f 或 -x。图片支持 base64 与 URL 响应，保存原响应后可恢复下载，避免付费提交后因下载失败而重发。音频补充 `/v1/audio/speech` 的 WAV 生成入口；实际可用性取决于后台模型和渠道。

New API 托管 H3 使用当前公共视频协议 `prompt`、`seconds`、`size`、`reference_images`（可选 `reference_audios`）；默认480p，可显式选择768p或1080p。独立包和 SubAPI 保留原有 content/720p 协议，不能混用验证结果。New API 已于2026-11-07完成真实文本、图片及5秒H3视频生成、下载和解码检查。完整验收及待处理项见 `docs/verification/2026-11-07-app-media/report.md`。

## 网页开发

先启动原生接口联调桥（仅回环，不自动登录、不打开 App），再启动前端：

```sh
cargo run -p codex-plus-core --example serve_newapi_preview
node scripts/preview-newapi.mjs
```

网页地址为 `http://127.0.0.1:1439`，注册布局预览为 `http://127.0.0.1:1439/?register`。联调桥只接受该来源，账户与生成请求走真实后台；默认模型应用仅预览，充值订单与兑换写入关闭，因此网页调试不会改动本机 Codex 配置。测试账号不写在示例或脚本中。`?fixture=1` 为显式启用的离线模拟账号场景，完全不调用真实后台或系统配置，可用于双平台登录、注册、余额、模型和切换验证。

## 验证边界

离线测试覆盖用户名规则、分组/余额/定价适配、原生层密钥保护、配置切换与上下文保留、图片与视频请求协议、任务恢复约束及下载凭据隔离。公开状态和模型目录可只读检查；真实验证码投递、账户注册登录、付费模型生成、支付与到账需要相应测试账号及实际交易验证，离线测试不能代替这些验收。

客户端更新仍使用原有签名更新服务，用户反馈仍使用独立反馈服务；New API 会话不会发送给这两个独立服务。

### 媒体选择、测试与权限指引

概览的图片／视频卡片可分别选择默认模型，选择按平台写入不含密钥的托管描述文件，同一平台跨路线保留；CLI 省略 --model 时跟随选择，对话明确指定时优先。未保存选择时默认 gpt-image-2／minimax-h3。New API 其他目录型号采用公共协议兼容路径，特殊参数和分组权限以平台为准；SubAPI 视频仍限 H3/Grok。已提交任务不随新默认变化。

文本／图片测试先打开独立弹窗，选择型号和测试内容后才发起一次真实调用，结果显示文字或图片预览。媒体价格使用媒体 Key 对应账号分组，无法确定手动 Key 分组时提示查看平台，不冒用文字 Key 的价格。

四项用户环境变量采用快照、写后校验及失败回滚；回滚不完整或系统恢复／通知失败均显示警告。环境命令与技能凭据查询有限时，凭据库回退只读取当前连接。概览和手册提供按系统切换的图文示意、用户权限检查、手动配置与修复验证说明。Windows 为模拟及源代码核对，尚未在 Windows 机器验收；Linux 自动托管连接未支持。
