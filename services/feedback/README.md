# FastAiApi 轻量反馈中转

独立 Go 标准库服务，无额外数据库或依赖。普通 Codex++ 只提交反馈；管理员入口不出现在客户端。用户登录、支付接口仍使用现有平台，不修改充值项目。

## 启动

```sh
cd services/feedback
go test ./...
go build -o /tmp/fastaiapi-feedback .
/tmp/fastaiapi-feedback -listen 127.0.0.1:6099 -state /absolute/private/feedback-state
```

打开 `http://127.0.0.1:6099/admin`，账号 `admin`。首次启动生成 256 位随机密码，保存在数据目录 `admin-password`（0600），不输出到日志。会话有效 8 小时，重启后需重新登录。更换密码时停止服务，由管理员更新该文件（至少 20 字符）后重启。

后台支持反馈搜索、状态筛选、详情与截图、Lark 配置及测试。Webhook 与签名密钥仅保存在数据目录 `lark.json`（0600），不回显。建议机器人启用签名校验，并限制仅群主/创建者编辑。

## 部署

单实例运行，持久挂载并备份数据目录；不要将它放入仓库或静态网站。用进程管理器托管，生产使用 HTTPS 反向代理。

客户端生产请求固定为 `https://fastaiapi.cloud/fastaiapi/api/feedback`。在该域名网关添加精确匹配路由，不覆盖充值路径：

```nginx
location = /fastaiapi/api/feedback {
    client_max_body_size 5m;
    proxy_pass http://127.0.0.1:6099;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

后台可通过 SSH 端口转发访问回环地址 `/admin`，无需公网开放。若使用专用管理域名，将该域名所有路径代理到此服务，开启 HTTPS 并传递 Host / X-Forwarded-Proto。不要挂在子路径（后台资源使用 `/admin.js` 和 `/admin/api/*`）。

本机固定开发 bundle 的 `FASTAIAPI_FEEDBACK_LOCAL=1` 仅将反馈切到 `http://127.0.0.1:6099`；发布包不可设置此变量。账户验证始终请求官方 `/api/v1/auth/me`，不会保存用户 token。

## 行为与边界

- 每用户每小时最多 10 条；请求 ID 幂等，网络重试不重复保存。
- 每条最多 3 张 PNG/JPG/WebP、每张 1 MB；服务端检查类型/大小，整体请求限制 5 MB。
- 原子落盘后返回成功；每 15 秒处理一条通知，失败每 5 分钟重试。至少一次投递：发送成功和状态保存之间崩溃可能重复通知。
- Lark 收到标题、内容、联系方式、用户 ID、截图数量；截图留在管理员认证保护的后台。
- 管理员 Cookie 使用 HttpOnly / SameSite=Strict，HTTPS 下 Secure；写操作校验来源和自定义请求头，登录限频。
- 单机文件存储适用于轻量反馈；多副本部署需要共享数据库/队列。
- 本地测试不代表上线；部署后必须再次验证正式域名路由。

## Docker 部署

`Dockerfile` 使用服务器现有的官方 `golang:1.27.0-alpine` 镜像构建并测试，运行层为 scratch，非 root 用户。准备专用目录 `/opt/fastaiapi-feedback-data`，属主 `65532:65532`、权限 `0700`，然后在本目录执行 `docker compose up -d --build`。端口只绑定主机回环地址。只更新这一项服务，不重启其他项目容器。
