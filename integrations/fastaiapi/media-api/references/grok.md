# Grok Imagine Video 1.5

实际模型为 `grok-imagine-video-1.5`，CLI 的 `grok` 只是该精确 ID 的简写。

| 模式 | 参考输入 | 时长 |
| --- | --- | --- |
| `first-frame` | 无素材，或一张首帧；无音频 | 6、12、18、24、30 秒 |
| `reference` | 0–6 张图片、0–3 个音频，允许纯音频参考或无素材 | 只能 6 秒 |

统一 `720p`，比例 `16:9` 或 `9:16`。不支持此契约以外的尾帧、视频参考或更高分辨率。
不要把用户要的 12 秒参考生成静默缩为 6 秒。

## 提示词

用自然语言写主体、景别、动作、镜头、环境光线、节奏和声音。首帧模式描述画面如何继续；
参考模式说明素材各自用于身份、环境或声音。保留用户台词与画面文字。
没有额外优化 API；不要强套 H3 六字段、`<Subject N>` 或 `@图像N` 语法。

## 凭据

站点仍为 https://fastaiapi.cloud，但需“其他 → grok”分组 Key；使用
`configure --provider grok --key-file ...` 独立保存。图片分组 Key 不具备 Grok 权限。

## 协议

`POST /v1/videos`，JSON 为 `model`, `prompt`, `duration`, `resolution: "720p"`, `aspect_ratio`。
CLI `mode` 不进入请求体。

- 首帧：`image: {b64: "data:image/png;base64,..."}`。
- 图片参考：`reference_images: [{b64: "data:image/png;base64,..."}]`。
- 音频参考：`reference_audios: [{b64: "data:audio/mpeg;base64,..."}]`。
- `image` 与参考数组互斥，空数组不发送。
- 输入必须是本地文件；编码为完整 MIME Data URL，不能直接发裸 Base64、路径或远程 URL。
- 编码后素材合计不超过 100 MiB；这不保证服务器接受同样大的整个 HTTP 请求。

```bash
python3 <skill>/scripts/media_api.py prepare --model grok \
  --mode first-frame --duration 12 --ratio 9:16 \
  --prompt-file <project>/grok.txt --image <project>/first-frame.png \
  --run <project>/runs/grok-01
python3 <skill>/scripts/media_api.py submit --run <project>/runs/grok-01
python3 <skill>/scripts/media_api.py wait --run <project>/runs/grok-01 --timeout 50
python3 <skill>/scripts/media_api.py download --run <project>/runs/grok-01 --output <project>/grok.mp4
```

纯文生视频省略 `--image`。参考模式改为 `--mode reference --duration 6`，重复 `--image` / `--audio`。

提交保存公共 `id`，缺失时使用 `task_id`。约每 10 秒查询 `GET /v1/videos/{id}`。
成功 `completed`（兼容 `succeeded` / `success`）；处理中 `queued` / `in_progress`，
兼容 `pending` / `processing` / `running`；`failed` / `canceled` / `cancelled` 为失败终态。
进度不等于成功。未知状态停止自动流程，保留同一个任务。

成功后下载 `GET /v1/videos/{id}/content`，仅向 FastAiApi 同源请求携带 Bearer；
跨域重定向移除凭据，不使用外部输出链接代替此路由。
没有已知幂等键保障，提交中断后禁止自动重发 POST；查找原公共任务 ID 后 `recover`。
