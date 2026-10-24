# FastAiApi 定制客户端更新与后台发布方案

日期：2026-10-24
状态：设计完成，更新服务和客户端切源尚未实施。
范围：本仓库 FastAiApi 定制 Codex++ 桌面客户端整包更新；不包含官方 Codex 本体、第三方脚本市场和皮肤市场。

## 1. 目标与现状

用户在管理后台上传并发布版本后，官网和桌面客户端从同一套发布记录获取安装包。客户端检查更新、下载和查看发布说明均使用 FastAiApi 自有域名；请求失败显示错误并允许重试，不自动回退到原作者链接。

已检查的现有实现：

- `crates/codex-plus-core/src/update.rs`：`DEFAULT_LATEST_JSON_URL` 指向原作者 GitHub Release 的 `latest.json`；已有版本比较、平台附件筛选、下载进度、安装器启动。
- `apps/codex-plus-manager/src-tauri/src/commands.rs`：`check_update` / `perform_update_inner` 连接前端与更新库；安装参数目前由前端传入 `Release`。
- `crates/codex-plus-core/src/update/macos.rs`：已有 bundle、架构、最低系统版本与签名检查，以及替换失败恢复旧应用的逻辑；应复用并补充来源验证。
- `.github/workflows/release-assets.yml`：已有 Windows 安装器、macOS universal DMG 与 GitHub 发布元数据流水线。
- `../sub2api-creator-engine`：已有独立 Go 扩展服务、充值后台、管理员角色校验，可扩展版本发布模块；无需修改上游 Sub2API 的业务代码。
- `../fastai-website/config/site.json` 当前下载配置用于其他产品，不可直接覆盖；本产品使用独立命名空间与独立下载入口。

## 2. 部署与入口

建议复用现有域名和扩展服务，新增独立产品 `fastaiapi-codexplus`：

| 入口 | 建议路径 | 用途 |
| --- | --- | --- |
| 官网下载 | `https://fastaiapi.cloud/fastaiapi/downloads/codexplus` | 平台安装包、版本说明、历史版本 |
| 管理后台 | `https://fastaiapi.cloud/fastaiui/admin/client-releases` | 草稿、上传、校验、发布、撤回 |
| 版本检查 | `GET /fastaiapi/api/client-updates/v1/check` | 按产品、平台、架构、渠道返回更新 |
| 静态兼容清单 | `GET /fastaiapi/updates/codexplus/stable/latest.json` | 兼容现有元数据结构的过渡入口 |
| 安装包 | `/fastaiapi/downloads/codexplus/{version}/{sha256}/{filename}` | 不可变文件；服务端生成 URL |
| 管理接口 | `/fastaiapi/api/admin/client-releases` | 管理员专用 CRUD 与发布操作 |

安装包首期放在持久化文件卷，由 Nginx 提供下载；接口和数据库保存元数据。未来可以把文件迁到对象存储并接自有 CDN 域名，客户端只允许明确配置的 FastAiApi 下载域名。禁止生成指向 GitHub 的安装包 URL 或重定向。

官网与客户端共用发布数据库，避免“官网新版本、客户端旧版本”两套来源。更新检查匿名可用，不依赖账户登录或余额；安装包请求不携带用户账户 Token。

## 3. 管理后台体验与发布流程

后台新增「客户端版本」菜单，列表显示版本号、渠道、各平台包状态、发布时间和发布人。

一轮发布：

1. 创建草稿，填写版本、渠道、发布说明、支持的最低系统与最低客户端版本。
2. 上传 Windows x64 安装器和 macOS universal DMG（以后可增加 ARM64 / x64 独立包）；上传进度、文件大小、校验结果分别显示。
3. 后台检查签名、SHA-256、版本、产品标识、操作系统和架构是否一致；缺少任一必需平台时禁止发布。
4. 预览官网下载页与客户端更新卡片，明确展示哪些平台会收到此版本。
5. 点击发布，原子更新渠道指针，记录审计日志；官网和版本检查接口同时生效。
6. 发现问题可撤回，阻止新的下载与更新；已安装用户采用更高版本的修复包恢复。

后台提供「保存草稿」「校验」「预览」「发布」「撤回」和历史记录，不提供任意外部下载 URL。后台发布安装包，不直接执行管理员上传的构建脚本。

状态：`draft → validating → ready → published → withdrawn`。校验失败回到草稿并标出具体原因；同一产品、渠道、版本号不得发布不同文件。正式包不可覆盖；修复内容必须使用新版本号。

已发布的受签名保护字段不能在后台直接改写。需修改版本、包或受保护发布说明时，重新生成签名；普通运营提示可作为不参与安装决策的独立字段保存。

## 4. 数据与接口

建议数据表：

- `client_releases`：id、product_id、version、channel、release_sequence、status、notes、min_client_version、created_by、published_by、published_at。
- `client_release_assets`：release_id、platform、arch、filename、size_bytes、sha256、storage_key、signature、signing_key_id、min_os_version、validation_status。
- `client_release_channels`：product_id、channel、current_release_id、revision；发布事务内更新。
- `client_release_audits`：操作者、动作、前后版本、结果、时间；不记录用户凭据。

数据库唯一约束：`(product_id, channel, version)`、`(release_id, platform, arch)`。并发发布以 revision 乐观锁或行锁串行化，重复请求使用幂等键。

管理接口建议：

| 方法与资源 | 行为 |
| --- | --- |
| `GET/POST /admin/client-releases` | 列表 / 创建草稿 |
| `PATCH /admin/client-releases/{id}` | 修改草稿 |
| `POST /admin/client-releases/{id}/assets` | 流式上传，限制大小和类型 |
| `POST /admin/client-releases/{id}/validate` | 校验产品、版本、平台、摘要和签名 |
| `GET /admin/client-releases/{id}/preview` | 预览最终元数据 |
| `POST /admin/client-releases/{id}/publish` | 校验通过后原子发布 |
| `POST /admin/client-releases/{id}/withdraw` | 撤回并记录原因 |

所有管理接口沿用服务端管理员角色检查；不能凭前端隐藏按钮或客户端自称管理员授权。草稿和暂存文件不进入公共下载目录。清理暂存和历史包需保留可恢复归档及审计记录。

检查请求参数：`product_id`、`current_version`、`platform`、`arch`、`channel`。响应包含 `update_available`、`reason`、签名清单；无匹配平台或渠道无版本是明确状态，不能错误显示“已是最新”。首次发布仅启用 stable，保留 beta 字段作为后续扩展。

签名清单示意（占位数据，不代表已经上线）：

```json
{
  "schema_version": 1,
  "product_id": "fastaiapi-codexplus",
  "version": "1.11.3",
  "channel": "stable",
  "release_sequence": 1,
  "published_at": "2026-10-24T12:00:00Z",
  "notes": "本版本更新说明",
  "assets": [{
    "platform": "macos",
    "arch": "universal",
    "name": "CodexPlusPlus-1.11.3-macos-universal.dmg",
    "url": "https://fastaiapi.cloud/fastaiapi/downloads/codexplus/1.11.3/<sha256>/CodexPlusPlus-1.11.3-macos-universal.dmg",
    "size_bytes": 123456789,
    "sha256": "<64位十六进制摘要>"
  }]
}
```

签名封装保存原始 manifest 字节（例如 base64）及 Ed25519 签名、key_id；客户端验证相同原始字节后再解析，不依赖重新序列化 JSON 的字段顺序。过渡 `latest.json` 的 assets 字段继续兼容当前解析器，但正式更新必须升级到签名验证链路。

## 5. 构建、签名与可信发布

- 复用现有构建流水线，改为输出「安装包 + 摘要 + 签名清单」，供后台上传；可以继续使用 GitHub Actions 构建，但用户下载源只用自有网站。
- 签名私钥只放隔离的 CI 签名环境或专用签名服务，不能放在桌面客户端、网页、代码仓库或发布数据库。后台上传已签名发布物并验证；后台不持有任意重签包的私钥。
- 客户端内置产品公钥与允许的下载域名。HTTPS 和 SHA-256 用于传输及完整性，包和清单签名用于确认发布者。
- macOS 生产包使用稳定的开发者签名身份并走公证；Windows 使用稳定发布者的代码签名证书。签名校验不应通过关闭系统安全校验实现。
- 后台验证包内版本及产品标识与清单一致；首期把可信 CI 的平台验证报告一并存档，Windows/macOS 的实际安装验证由相应平台 CI 执行。
- 上传失败、文件缺失、摘要不匹配、签名无效、平台不匹配均禁止进入 ready；发布后文件和元数据必须保持不可变。
- 密钥轮换通过已信任密钥签署新公钥过渡版本，再逐步退休旧密钥。新客户端必须保留有效的旧版验证测试。

## 6. 客户端改造

在现有更新模块增量实现：

1. 替换默认版本检查入口；元数据与包下载只允许 HTTPS 和自有域名，逐跳验证重定向；不保留原作者更新源的自动回退。
2. 产品和平台使用显式字段匹配，未知架构返回不支持，不按模糊文件名猜包；首期 Windows x64、macOS universal。
3. 验证清单签名、产品、渠道、版本及防回放序号，再向 UI 展示更新。
4. 安装命令接收 release_id 或已验证清单的句柄，原生层重新确认发布仍有效；不直接信任前端传入任意 `asset_url`。
5. 流式写入 `.part` 文件并计算摘要，限制下载大小，完成后校验实际长度和 SHA-256，再原子改名为正式文件；校验通过前不执行。
6. 复用当前下载进度；补上「正在验证」「等待退出」「正在安装」「安装失败」状态，提供取消下载和重试。更新需用户点击，不在后台静默启动安装器。
7. macOS 复用现有替换与恢复逻辑，并保持当前安装目标、bundle 身份和数据目录；Windows 安装器保留现有安装目录、配置与账户凭据。
8. 更新过程中不改 `.codex`、供应商配置、Key、账户状态和本地应用数据。启动健康标记以本地应用就绪为准，不能把平台网络故障判为新版本损坏。
9. 发布说明显示来源「FastAiApi 官方更新」，官网入口链接自有下载页。原作者项目介绍、开源署名与许可证按各自用途保留，不混作更新源。

## 7. 首次接管、版本策略与回滚

已经安装且仍指向原作者 GitHub 的旧客户端，无法凭服务器单方面修改获得自有源。需要先在官网下载一个「接管版」并覆盖安装；接管版内置自有更新源与公钥，后续才可后台发布、客户端更新。

接管版沿用现有定制版的系统安装身份和数据路径，避免一次性丢失配置。不要为这项改造更名本地固定测试 bundle。原版与定制版并存所需的独立 bundle/安装器身份，另做一次显式数据迁移，不夹在本轮更新源切换里。

版本号由定制分支维护，独立于上游发布节奏。即使上游版本更高，也不会触发原作者版本覆盖定制功能。

撤回版本后，服务端可把渠道指针恢复到上一可用版本，阻止尚未升级用户下载坏包；已安装更高版本的用户默认不会自动降级，应发布更高版本号的修复包。紧急降级需要独立的签名授权、用户确认与安装兼容校验，首期不开放静默降级。

macOS 在替换/验证失败时恢复旧应用；安装成功后若需启动失败恢复，增加更新事务记录、备份及健康握手。Windows 先保留旧包与恢复入口，不宣称现有安装器已具备完整自动回滚。

## 8. 运维与容量

- 版本检查入口使用 ETag；发布清单短缓存，撤回立即失效。安装包内容寻址、长缓存，支持 Range 便于后续断点续传。
- 上传使用流式处理及可配置大小上限，暂存目录与公共目录隔离；文件名规范化，拒绝路径穿越和外部 URL 上传。
- 不将包文件存入数据库；备份数据库、签名元数据和安装包，发布记录与文件清单定期对账。
- 保留近期多个可恢复版本；后台撤回只是停止分发，不能立即永久删除用户可能仍在下载的包。
- 发布审计至少能追溯版本、文件摘要、签名 key_id、发布人和撤回原因；下载统计仅用聚合数据，不采集 API Key 或账户 Token。

## 9. 分阶段实施与验收

| 阶段 | 交付 | 验收 |
| --- | --- | --- |
| A：发布服务 | 数据表、管理员上传/校验/发布/撤回、自有文件下载 | 非管理员拒绝；坏包不能发布；并发发布原子化；其他产品不受影响 |
| B：可信客户端 | 固定自有源、签名与摘要校验、平台匹配、下载安装状态 | 恶意 URL、篡改、截断、错架构、未知密钥、旧清单重放均拒绝 |
| C：官网与接管版 | 同源下载页、接管版、配置保留验证、操作说明 | 官网与客户端版本一致；升级保留登录和配置；无原作者更新请求 |
| D：端到端演练 | stable 测试发布、覆盖更新、撤回、修复版恢复 | Windows 与 macOS 真机通过后再公开推广 |

测试包括：版本比较与缺少平台、真实流式进度、取消/失败重试、SHA-256/签名、重定向白名单、草稿不可下载、管理员失效、同版本不可覆盖、撤回缓存失效、保留配置、安装失败恢复。复用现有 Rust `cargo test` 和 macOS 更新测试；服务端扩展沿用现有 Go 测试约定，后台沿用既有前端检查。

上线顺序：先部署发布服务与下载路由 → 上传并演练接管版 → 公开官网入口 → 推送接管安装指引 → 发布下一版本验证完整自动更新链路。

本次仅完成方案设计与支付图标修复；没有修改生产更新地址、上传安装包、部署服务或发布线上版本。
