# Codex++ 用户反馈

新增 `POST /api/feedback`，经现有 `/fastaiapi/` 代理访问。请求使用 FastAiApi 账户 Bearer Token，服务端调用现有 auth/me 验证用户身份。

字段：request_id（客户端 UUID，重试复用）、category、title（1–100 字）、content（1–5000 字）、contact（1–200 字）、screenshots（最多 3 张，每张最多 1 MB，PNG/JPEG/WebP data URL）。每用户每小时最多 10 条。

数据持久化到扩展数据库的 fastai_feedback 表；仅新增独立表，不改官方用户表。相同用户和 request_id 重试不重复创建。截图保存在 payload 中，不公开暴露 URL；通知文本包括反馈内容、联系方式和截图数量，截图原件由后台维护人员按反馈编号查询。反馈涉及个人信息，数据库及备份仅授权客服维护人员访问。

## Lark

在 AiApi Fast 所在组织的桌面 Lark 中，打开「FastAiApi 用户反馈」群，添加自定义机器人。设置签名校验后，在服务器 .env 中配置：

```
FEEDBACK_LARK_WEBHOOK_URL=<机器人 Webhook>
FEEDBACK_LARK_SECRET=<签名密钥>
```

不要把这些值写入源码、桌面客户端或文档。Webhook 限制为官方 HTTPS 地址，客户端不得覆盖。

使用现有生产 compose 参数，仅重建 api 服务：`docker compose up -d --build api`。如原部署带 compose.production.yml，必须沿用。服务启动自动建表；通知队列每 15 秒处理一条，失败 5 分钟后重试。成功以 Lark 响应业务码为准。配置缺失时反馈仍保存，等待配置后发送。

## 验证

使用 Go 1.22 或更新版本执行 `go test ./internal/feedback ./cmd/server`。开发机 Go 1.18 可执行独立 feedback 包测试，但不能编译已有 pgx/recharge 代码。

上线后用专用测试账号提交非敏感标题、正文、测试联系地址及测试截图。核对响应编号、数据库记录及 Lark 消息相同，再重复提交同一编号，确认只有一条记录。不要把本地模拟通知成功当作线上送达。
