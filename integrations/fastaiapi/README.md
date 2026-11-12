# Codex++ 的 TuMeiAPI / FastAiAPI 接入

登录和注册页先选择 New API 或 SubAPI；登录后展示对应平台的账号、余额、Key、分组、模型及充值。两个平台分别保存凭据和记住的登录信息；注册、登录成功或恢复有效会话后固定当前平台，右上角隐藏平台入口，仍可切换该平台路线。退出登录后才能重新选择平台。选择平台不会应用 Codex 配置或接管媒体环境。

TuMeiAPI 路线：

| 路线 | 服务来源 | 图片 API 文档 |
|---|---|---|
| 路线1 | `http://8.137.194.180:90` | [路线1文档](http://8.137.194.180:90/hub/home/help/image-api/) |
| 路线2 | `https://tumeiapi.com` | [路线2文档](https://tumeiapi.com/hub/home/help/image-api/) |
| 路线3 | `https://newapi.fastaiapi.cloud` | [路线3文档](https://newapi.fastaiapi.cloud/hub/home/help/image-api/) |

文档和 API 使用当前线路的服务来源。文字生图、图片编辑和视频提交分别拼接 `/v1/images/generations`、`/v1/images/edits` 和 `/v1/videos`。FastAiAPI 使用自己的 [图片 API 文档](https://fastaiapi.cloud/hub/home/help/image-api/)。路线 1 使用未加密的 HTTP。

路线选择保存在应用状态目录。所有路线指向同一个 New API 后台，共用账号会话、Key、余额、分组和模型选择；切换仅改变请求来源，不退出登录、不重建页面状态。完整密码、会话和媒体 Key 使用系统凭据库保存；与 SubAPI 的会话、Key 和配置命名空间隔离。账户生成的 Codex 连接随路线更新，保留上下文等高级设置；其他供应商配置不受影响。

注册直接调用 `/api/user/register`，用户名精确取用户邮箱 `@` 前的内容，不另设用户名输入框、不自动截断。用户名冲突或超出站点限制时由站点拒绝；不会静默换名。邮箱验证码紧随邮箱字段，通过 `/api/verification?email=...` 发送，使用 `verification_code` 提交；邀请码对应 `aff_code`。注册成功后使用自动生成的用户名登录。后续支持邮箱或用户名登录。

账户使用 `/api/user/login`、`/api/user/self`；兼容旧 session cookie 和新版 JWT + refresh cookie。访问令牌、Cookie、密码和 API Key 不输出到日志；仅在勾选“记住账号密码”且认证成功后保存密码。退出会话保留记住的登录信息，取消勾选立即清除。

New API 退出时将当前会话替换为空会话记录，阻止旧路线的遗留登录被回退恢复；不依赖额外权限删除旧签名应用的历史条目。当前媒体凭据清理失败会明确提示，已完成的账号退出仍生效。登录成功会覆盖空记录保存新会话。

分组来自 `/api/user/self/groups`，保持 New API 的字符串分组名称；Key 通过 `/api/token/` 管理，仅原生层读取完整密钥。确认默认分组和模型时，优先复用该组中具有对应模型权限的有效 Key，必要时创建该平台的专用 Key。余额使用站点 `quota_per_unit` 与货币设置换算；模型描述和定价来自 `/api/pricing`，按当前所选分组与模型匹配。支持模型分组专价、Token 阶梯价及可明确解析的分辨率视频秒价。无法准确展开的专用计价规则提示前往平台查看，未知价格不填为零。

充值使用 `/api/user/topup/info`、`/api/user/amount`、`/api/user/topup/self`、`/api/user/topup`。按后台开关支持易支付收银台、多彩付款码与兑换码。多彩沿用原 `request_id` 和订单号；易支付提交结果未知时先查订单，不自动重建。其他支付渠道可从当前路线的平台钱包继续。

## SubAPI

入口为 `https://fastaiapi.cloud`，界面显示路线1。使用本地 `sub2apiSelf` 的用户接口契约：邮箱登录 `/api/v1/auth/login`、注册 `/api/v1/auth/register`、邮箱验证码 `/api/v1/auth/send-verify-code`。注册后通过 `/api/v1/user` 设置邮箱前缀用户名，失败保留注册成功状态并给出提示；支持 `/auth/login/2fa` 的六位 TOTP。访问 Token 仅在 HTTP401 时用 refresh Token 刷新，网络/5xx 不重放写操作。人机验证开启时提示去平台处理，不绕过验证。

账号来自 `/api/v1/auth/me`，余额保持 SubAPI 的 USD 单位；Key 来自 `/api/v1/keys`，原生层剥离完整 Key 后才返回前端。分组来自 `/groups/available`，保持数字 ID，在前端规范为字符串。自动配置优先复用专用 Key 或默认组 Key；创建时校验当前账号可用分组，选择默认组、推荐 OpenAI/composite 分组或唯一可用分组，不能假设 New API 的 default 名称就是 SubAPI 分组 ID。

模型通过当前 Key 的 `/v1/models` 查询；定价来自 `/api/v1/model-plaza`，按 Key 绑定分组及用户倍率转换为美元/百万 tokens。未公布价格保持未知，不补零。套餐来自 `/api/v1/subscriptions`；充值配置、套餐销售和订单使用 `/api/v1/payment/checkout-info`、`/payment/orders`、`/payment/orders/my`，兑换使用 `/api/v1/redeem`。提交结果不确定时查询原订单，不自动重建。需要 Stripe/Airwallex 等专用网页收银流程时可前往平台钱包继续。

当前登录期间只能使用所选平台，原生层同样拒绝切换平台或请求另一平台的账号/模型配置；完成退出后解除限制。显式应用模型后以 `fastaiapi-newapi-*`、`fastaiapi-subapi-*` 保存各自配置和选择；退出后选择另一个平台不改当前生效配置。媒体凭据同样按平台分别保存，全局 FASTAIAPI_* 和技能连接描述仅指向当前应用的媒体连接。跨面板媒体任务不得互相查询或恢复；同一 New API 后台仍可跨路线查询。SubAPI 不同分组的实际媒体协议和模型权限仍须逐项实测，不能把模型出现在目录视为全部生成接口已验收。

## 图片与视频

Codex++ 内置 Rust 媒体 MCP，覆盖生图、编辑、视频提交、查询、下载和旧回执恢复。选择默认分组和模型时复用或创建 Key，并通过系统凭据库保存。文本测试使用 `/v1/responses`，图片测试使用 `/v1/images/generations`，两者都按当前线路和模型计费。

旧版独立 Python 技能保留在 `media-api/`，供独立使用和音频生成。桌面端不再自动安装它。已经升级的实例仍可能在 `skills/fastaiapi-media/connection.json` 保存连接描述；此文件用于定位现有媒体绑定，里面没有完整 Key。

运行中的视频任务使用原回执绑定的平台、路线和 Key。中断后继续查询或下载原任务。New API 的公共视频协议与 FastAiAPI 的专用适配器各自按平台接口处理。

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
