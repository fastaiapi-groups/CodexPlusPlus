# 独立工作流与恢复

## 文件和命令

`scripts/media_api.py` 为唯一 CLI 入口，其余脚本是包内适配器。
只需要 Python 3.10+，所有命令支持 `--help`。

每个 `prepare` 创建一个新的任务目录（已有目录拒绝覆盖）：

```text
run/
  request.json   完整不可变请求，可能含私人提示词和 Base64；不贴到聊天或日志
  receipt.json   请求摘要、幂等键（仅 H3）、状态、公共任务 ID、成功文件路径
  .lock          系统文件锁；文件存在不表示被占用，进程退出后操作系统自动释放
```

`prepare` 完全离线且不加载凭据。`submit` 会产生计费请求，`status` / `wait` / `recover`
只查已有任务，`download` 查询并保存结果。相同目录重复 `submit` 发现已有 ID 时直接返回，不重发。
回执记录固定 origin；提交前核对站点，完整请求不包含密钥。

```bash
python3 <skill>/scripts/media_api.py status --run <project>/runs/h3-01
python3 <skill>/scripts/media_api.py wait --run <project>/runs/h3-01 --timeout 50
```

`wait` 的超时最多 60 秒，退出码 2 表示仍未完成，可继续调用并向用户说明当前进度。
退出码 1 表示错误/终态失败；0 表示命令成功。单次状态 HTTP 调用也有超时。
如果需要跨会话定期跟进，使用宿主提供的监控能力；没有监控能力时不要声称会自动醒来。

## 提交结果不确定

回执先落 `submitting` 再发送 POST；中断或异常保留 `submission_unknown` 或 `submitting`。
多个进程不能同时提交同一任务。不要手工把回执改回 prepared。

- H3 / Grok：提交结果未知时都不自动重发。即使 H3 带 Idempotency-Key，也未核实新站幂等性。
  在对应站点核对本次提交的公共任务 ID 后执行：

  ```bash
  python3 <skill>/scripts/media_api.py recover --run <project>/runs/video-01 --job-id PUBLIC_ID
  ```

  此操作查询并检查返回模型/ID；调用者须确保 ID 属于本次请求，客户端无法证明内容完全一致。
- 图片：同步结果丢失没有已知任务恢复接口。保留已有文件与回执，确认必要的失败项后创建新请求；
  不重跑成功项，也不把图片重试策略套到视频。

状态 GET 对网络错误、429、5xx 进行最多三次有限重试并尊重 Retry-After；
服务端要求等待超过 60 秒时返回等待信息，供后续恢复。失败任务不会自动重新生成。

## 下载与交付

H3 的公共输出 URL 不带密钥；Grok 使用 FastAiApi `/content` 带鉴权；跨域重定向移除鉴权。
下载使用 `.part` 文件并检查非空和已提供的 Content-Length；中断保留部分文件。
选择新的输出路径可重试下载，不需要重新生成。已有目标文件拒绝覆盖。
成功回执记录本地文件；重复下载命令会返回已保存文件。
传输成功不代表视频画面/声音质量通过，需要检查实际交付文件。

导入剪辑/制作工具时使用下载后的本地文件，不再同时创建新的模型生成任务。
生成技能只负责媒体，不绑定特定项目格式、时间线系统或制作工具。

## 配置迁移与可移植性

默认首次使用流程见 [首次使用教程](setup.md)：用户在对话里提供自己的 API Key，
智能体写入临时文件后用 `configure --key-file` 保存（临时文件随即删除）。系统配置目录被沙箱拦截时
自动改存当前项目 `.fastaiapi-media/`（Grok 为 `.fastaiapi-media-grok/`，H3 为 `.fastaiapi-media-h3/`）；无需用户操作终端。

两站配置与环境变量独立，不导入旧供应商密钥。详见 [首次使用](setup.md)。
本包模块按脚本目录导入，无须固定安装路径。旧版任务回执拒绝用于新站，以防串站。

## 验证

```bash
python3 -B -m unittest discover -s <skill>/scripts -p 'test_*.py' -v
```

测试通过模拟 HTTP 验证请求、凭据边界、持久化、重复提交防护和恢复；不会付费生成。
