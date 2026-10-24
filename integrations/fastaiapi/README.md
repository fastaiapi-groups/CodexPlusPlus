# FastAiApi 桌面集成

## 来源与结构

- `logo.svg`：用户提供的 `fastapapi.svg`。
- `media-api/`：用户提供的 `media-api-fastaiapi-20261024-tested (1).zip`；仅将技能名改为 `fastaiapi-media`，避免与用户已有 media-api 冲突。
- 账户传输：`crates/codex-plus-core/src/fastaiapi.rs`。
- 原生命令及技能嵌入：`apps/codex-plus-manager/src-tauri/src/fastaiapi_commands.rs`。
- 账户和充值界面：`apps/codex-plus-manager/src/fastaiapi/`。

## 账户与额度

模型接口固定为 `https://fastaiapi.cloud/v1`；账户 API 为同站 `/api/v1`，充值扩展为 `/fastaiapi/api/recharge`。注册遵守线上邮箱验证开关。未登录时展示独立全屏登录入口。macOS 登录令牌保存到系统钥匙串，密码不保存；访问令牌过期后需重新登录。其他系统或钥匙串不可用时仅保持当前进程登录。API Key 按原有供应商配置机制保存。登录后优先复用名为 Codex++ FastAiApi 的有效专用 Key，没有时在 gpt-pro 分组创建；自动应用对话模型并保留已有选择。没有对应分组或对话模型时进入概览显示错误，可手动选择其他 Key 或重试。

美元 API 额度与人民币支付金额分别标注。支付宝使用 `alipay`，微信使用 `wxpay`。创建订单沿用同一 request_id，继续支付沿用原订单；扫码页面只根据后端订单状态展示到账，不在客户端修改余额。订单查询每三秒进行，最多 200 次，关闭页面后停止。

## 内置技能

14 个技能文件在编译时嵌入可执行文件，启动时自动部署到当前 Codex home 的 `skills/fastaiapi-media`。已有同名目录不覆盖。先在暂存目录写完再发布，安装失败会报告错误。

客户端依赖 Python 3.10+ 标准库，不依赖 pip。Python 运行时不包含在应用中。图片、Grok、H3 的密钥分别配置，H3 使用 `https://newapi.fastaiapi.cloud`，不会复用对话 Key。安装不执行付费生成。

## 验证

- `npm run check --prefix apps/codex-plus-manager`
- `cargo test --locked -p codex-plus-core --lib fastaiapi::tests`
- `cargo test --locked -p codex-plus-manager --lib fastaiapi_commands::tests`
- `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s integrations/fastaiapi/media-api/scripts -p test_media_api.py`

真实注册、登录、余额、付款到账、模型请求需要测试账号与用户邮箱验证码配合。离线测试不代表线上交易已验收。


## 2026-10-24 实机回归

已验证邮箱验证码注册、退出后重新登录、专用 Key 创建、模型列表、配置应用、独立 Codex 进程启动，以及非流式/流式 Responses 请求。两种支付渠道均可生成订单及付款码；未执行真实付款，不能据此声明支付回调到账已通过。

模型列表排除媒体及内部审核模型，优先 gpt-5.6-sol；切换模型保留供应商的上下文设置。充值提供服务端手动查单，续付失败会重新读取状态。旧订单续付曾返回 409、查单曾返回 429，客户端保留错误并提示勿重复付款。

参考 1.7.6 安装包的账户模块使用 /api/user/desktop/ 和 /api/user/self，与当前平台接口不同。当前实现是功能适配，不是复制该安装包二进制。参考配套客户端为官方签名的旧版，未覆盖本机更新版本。

## 上游合并边界

登录门控仅在 main.tsx 包装根组件；概览通过已有 Account 插入点消费共享账户卡片。样式、模型搜索、自动配置流程、测试均放在 fastaiapi 独立模块中；App.tsx 不新增本轮路由改动。原生凭据管理独立于原有供应商模块，使用已锁定的 security-framework 系统接口，不写明文会话文件。
