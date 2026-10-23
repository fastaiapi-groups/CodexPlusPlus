# FastAiApi 桌面集成

## 来源与结构

- `logo.svg`：用户提供的 `fastapapi.svg`。
- `media-api/`：用户提供的 `media-api-fastaiapi-20261024-tested (1).zip`；仅将技能名改为 `fastaiapi-media`，避免与用户已有 media-api 冲突。
- 账户传输：`crates/codex-plus-core/src/fastaiapi.rs`。
- 原生命令及技能嵌入：`apps/codex-plus-manager/src-tauri/src/fastaiapi_commands.rs`。
- 账户和充值界面：`apps/codex-plus-manager/src/fastaiapi/`。

## 账户与额度

模型接口固定为 `https://fastaiapi.cloud/v1`；账户 API 为同站 `/api/v1`，充值扩展为 `/fastaiapi/api/recharge`。注册遵守线上邮箱验证开关。登录令牌仅保存于原生进程内，退出应用后需要重新登录；API Key 按原有供应商配置机制保存。账户只有一个可用 Key 且存在可识别的对话模型时，登录后自动应用配置；多 Key 或分组不明确时，选择具有对话模型权限的 Key 后应用配置。

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
