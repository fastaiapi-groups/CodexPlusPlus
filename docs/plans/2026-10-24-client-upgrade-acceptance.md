# 客户端安装与覆盖升级验收

验收版本：FastAiApi Codex++ 1.11.4（旧版 1.11.3）。实际包以官网签名清单及 SHA-256 为准。

## 修复发现

1.11.3 的 Windows `fastaiapi_session` / `fastaiapi_credentials` 在非 macOS 分支直接返回未保存，因此重启会丢登录，与安装器是否保留文件无关。1.11.4 增加 Windows Credential Manager 持久化，使用当前用户的本机凭据，以服务名和状态目录命名空间隔离；不向磁盘写明文会话或记住的密码。macOS 保持既有钥匙串服务名与 account，不迁移或清空条目。

旧版 Windows 没有保存过的内存会话无法事后恢复，首次升级需重新登录一次。此后正常重启、覆盖和重复安装保留已保存的会话；主动退出、服务端令牌过期/撤销、系统凭据库被清空不属于安装器丢数据，不能承诺永久免登录。

## macOS：通过

- 使用两版真实 DMG，执行生产实现的只读挂载、身份/架构/签名校验、完整复制、rename 替换和旧应用备份。
- 1.11.3 → 1.11.4 版本及新应用签名正确，旧 1.11.3 完整备份保留。
- 隔离测试 `settings.json`、Codex `config.toml` / `auth.json`、启动偏好逐字节一致，模型/地址/API Key 通过实际 SettingsStore 重新读取。
- 合成登录会话与记住账号在不同进程中读取成功；退出只清会话，忘记账号可重复执行。
- 两个不同 ad-hoc 签名的本地程序可读取同一隔离钥匙串条目，测试条目结束后清除。
- 固定开发实例实际重启后，原 FastAiApi 账号自动恢复，默认模型保留；未退出真实用户账号或输出凭据。
- 更新安全/事务测试 21 项及 updater 集成测试 10 项通过，包含真实 DMG 安装、替换失败恢复、错误身份/签名/架构及等待批准等情况。

复现（只操作 tempfile 和测试凭据）：

```sh
cargo build -p codex-plus-core --example upgrade_state_probe
CODEX_PLUS_ACCEPTANCE_OLD_DMG=<旧版绝对路径> \
CODEX_PLUS_ACCEPTANCE_NEW_DMG=<新版绝对路径> \
CODEX_PLUS_ACCEPTANCE_PROBE=<target/debug/examples/upgrade_state_probe绝对路径> \
cargo test -p codex-plus-core macos_published_dmg_upgrade_preserves_credentials_and_settings --lib -- --ignored --nocapture
```

发布包仍为 arm64，本次不把 Intel 标记为已验收；Apple 公证不在本次完成范围。

## Windows：14 项检查全部通过

[Windows 实际安装验收运行记录](https://github.com/fastaiapi-groups/CodexPlusPlus/actions/runs/40096512790) 已成功，代码版本 `f5767324`。1.11.4 安装包 SHA-256：`905e5eab700a1923fb68cbf223dae4a78b173642f01b0f682e1ba3fdfecef993`。结果文件 `dist/upgrade-acceptance/windows/result.json` 包含完整检查清单。

工作流 `FastAiApi client installers` 在真实 `windows-latest` 机器执行 `scripts/test-windows-upgrade.ps1`。从本站下载并校验 1.11.3，安装到带空格的非默认目录，启动旧窗口；写入隔离配置和系统合成凭据，覆盖为候选版，验证二进制确实更新、配置字节不变、凭据跨进程读取、新窗口可响应；再次安装候选版并验证保留，再验证退出/忘记账号和安装目录登记。报告不包含用户会话或密码。

Windows 旧版会话没有持久化的限制已在发布说明明确列出，测试不会将人工播种的合成凭据宣称为旧版自带的保存功能。

环境为 GitHub 托管的真实 Windows x64 系统，并实际运行 NSIS 及旧/新桌面窗口；没有宣称已覆盖所有用户电脑、所有 Windows 版本或用真实用户令牌在 CI 登录。

## 分组界面

列表仅显示名称、倍率和问号，移除备注预览。卡片按内容确定行高，长名称正常换行，列表单独滚动。点击问号显示完整备注，关闭后保持原分组选择。真实应用与隔离组件预览均已验证；不点击创建 Key，不新增账户密钥。

本地验收材料位于 `dist/upgrade-acceptance/` 和 `dist/ui-review/`。仅测试报告/界面截图可分享，`user-before/` 是权限受限的本机状态备份，不提交 Git 或上传服务器。
