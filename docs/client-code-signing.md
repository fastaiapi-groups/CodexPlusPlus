# Codex++ 客户端签名与系统拦截

## macOS 上的 Codex CLI

若安全弹窗只显示 `codex`，先用 macOS 的 `syspolicyd` 和 `CoreServicesUIAgent` 日志确认实际文件路径。本机曾命中 `/usr/local/bin/codex` 指向的全局 npm 安装。系统尝试移入废纸篓时因目录权限失败，再次执行仍会弹窗。Codex++ 查找桌面内置 CLI 时优先识别新版 `Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex`，也支持旧包的资源布局。

可以用以下命令验证本机官方 ChatGPT.app 携带的 CLI，评估通过后以其绝对路径启动。旧的全局安装应由其原安装来源或系统管理员更新处理。

```sh
app='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app'
codesign --verify --strict "$app"
spctl --assess --type execute -vv "$app"
```

## 自有安装包

- macOS 本地开发继续使用固定的 `dist/local-build/Codex++.app`。对外的 `node scripts/package-fastaiapi-macos.mjs` 需要 Developer ID Application 身份 `MACOS_SIGNING_IDENTITY` 和已在钥匙串配置的 `MACOS_NOTARY_PROFILE`。脚本给应用启用 Hardened Runtime，并签名 DMG、提交 Apple 公证、附加和验证公证票据，最后进行 Gatekeeper 评估。
- Windows 的 `FastAiApi client installers` 工作流支持手动选择 `signed_release`。签名使用 Microsoft Artifact Signing。GitHub 仓库需要配置 Azure OIDC 联合身份和签名角色，提供 `AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID` 三项 Secrets，以及 `WINDOWS_SIGNING_ENDPOINT`、`WINDOWS_SIGNING_ACCOUNT`、`WINDOWS_SIGNING_PROFILE` 三项 Variables。主程序在 NSIS 打包前签名，安装器在打包后签名，两者都检查签名链和时间戳，然后执行安装与覆盖升级测试。普通构建产物以 `test-unsigned` 标识。
- 自有 Ed25519 更新清单继续验证下载来源与文件完整性。生成分发清单时应使用最终签名、公证后的文件计算 SHA-256。系统签名与发布步骤分别验收。

Windows 验收应在使用默认保护设置的干净环境中，从真实下载入口获取签名包，再查看 SmartScreen、Smart App Control 或 Defender 的具体提示。新签名文件仍可能因信誉不足出现 SmartScreen 提示。若 Defender 给出恶意软件检测名称，应核对原始文件和签名并向 Microsoft 提交误报样本。 [Microsoft SmartScreen 信誉说明](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
