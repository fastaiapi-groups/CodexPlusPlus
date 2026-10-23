# FastAiApi 按模型分组保存凭据

| provider | 使用模型 | Key 页面 | 环境变量 |
| --- | --- | --- | --- |
| main | GPT Image（图片分组） | https://fastaiapi.cloud/keys | `FASTAIAPI_API_KEY` |
| grok | Grok（其他 → grok 分组） | https://fastaiapi.cloud/keys | `FASTAIAPI_GROK_API_KEY` |
| h3 | minimax-h3 | https://newapi.fastaiapi.cloud/keys | `FASTAIAPI_H3_API_KEY` |

只向用户索取当前任务所需站点的密钥，不假定两个站点的 Key 互通。
Key 需要有目标模型/分组权限；主站不同模型的权限以账户实际设置为准。

## 保存

由智能体用写文件工具把用户提供的 Key 写入工作目录的临时文件（不要在命令行参数或日志中放 Key），再运行：

```bash
python3 <skill>/scripts/media_api.py configure --provider main --key-file <project>/.main-key.txt
python3 <skill>/scripts/media_api.py configure --provider grok --key-file <project>/.grok-key.txt
python3 <skill>/scripts/media_api.py configure --provider h3 --key-file <project>/.h3-key.txt
```

只运行需要的那条。脚本读完文件后无论保存成功失败都会删除临时文件；
若 Python 根本未启动，由智能体清理临时文件。隐藏终端提示或标准输入也可用。
保留 Key 原值，只剥离可选 Bearer 前缀和首尾空白，不猜测或补全 sk- 前缀。

```bash
python3 <skill>/scripts/media_api.py config-status --provider main
python3 <skill>/scripts/media_api.py config-status --provider grok
python3 <skill>/scripts/media_api.py config-status --provider h3
python3 <skill>/scripts/media_api.py models --provider h3
```

config-status 不输出 Key。models 只读列出该站账户可见模型，不进行生成；
可见模型不代表当前适配器或账户渠道一定能完成生成。

## 存储和隔离

main 使用系统配置目录 `fastaiapi-media/config.json`，grok 使用 `fastaiapi-media-grok/config.json`，h3 使用 `fastaiapi-media-h3/config.json`。
macOS 根目录为 `~/Library/Application Support/`，Windows 为 `%APPDATA%`，
Linux 为 `$XDG_CONFIG_HOME` 或 `~/.config`。

无法写系统目录时分别回退到当前项目 `.fastaiapi-media/config.json` 或
`.fastaiapi-media-h3/config.json`（Grok 为 `.fastaiapi-media-grok/config.json`），自动写入忽略该目录的 .gitignore。
读取顺序为当前目录及父目录的对应项目配置、对应系统配置、对应环境变量。
两站互不回退；保存到系统目录后同步刷新已有的对应项目副本。
旧供应商 Key 和旧版 media-api 配置不能迁移使用，请配置目标站自己的 Key。

401/403 时核对对应站点、密钥和模型分组权限，402 时核对余额。
网络错误先检查网络、代理、站点和宿主实际权限；不为验证密钥发起付费生成。

同一主站不同分组 Key 也不能互换；分别配置图片和 Grok，不能覆盖 main 来切换视频。
