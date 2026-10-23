# 图片生成与编辑

`gpt-image-2` 与 `gpt-image-2.5` 共用以下全部逻辑，仅请求 `model` 不同。

- 文生图：`POST /v1/images/generations`。
- 本地参考图编辑：`POST /v1/images/edits`，最多四张参考图。
- JSON 字段：`model`, `prompt`, `n: 1`, `size`, `response_format: "b64_json"`。
- 编辑添加 `images` 数组，每项为完整 `data:image/...;base64,...` 字符串。
- 同步响应从 `data[].b64_json` 解码，按实际文件头保存 PNG/JPEG/WebP/GIF。
- 不发送 multipart、`image_urls`、未约定的遮罩或其他模型的参数。

将用户需求展开为具体主体、构图、光线、风格、文字、需保留/改变的参考内容。
已有完整提示词时保留；不得将普通图片任务改写为视频或强加 H3 字段。

```bash
python3 <skill>/scripts/media_api.py image \
  --model gpt-image-2.5 --prompt-file <project>/image-prompt.txt \
  --size 1440x2560 --output-dir <project>/images

python3 <skill>/scripts/media_api.py image \
  --model gpt-image-2 --prompt-file <project>/edit-prompt.txt \
  --reference <project>/product.png --reference <project>/background.png \
  --count 4 --concurrency 4 --output-dir <project>/images
```

每张图片发一个 `n=1` 请求；默认并发 10、最大 50，每次调度间隔 300ms。
失败的请求保留独立回执，成功文件保留，批次写入 `manifest.json`；部分失败退出码为 1。
图片 POST 不自动重试，避免同步请求超时或网关 5xx 后重复计费；需要重试时先解释已知状态，
按现有授权重新准备所需失败项，而非重跑整个批次。

默认 `1024x1024`。允许尺寸：

```text
1024x1024 720x1280 1280x720 1248x832 1152x864 864x1152 832x1248
2048x2048 1440x2560 2560x1440 2496x1664 2304x1728 1728x2304 1664x2496
2160x3840 3840x2160
```

要离线审查请求，可使用 `prepare --model gpt-image-2.5 --prompt-file ... --run ...`，
参考图在此命令使用 `--image`，随后用 `submit --run ...` 执行。
请求若返回任务 ID 而非同步图片，停止并核实账号所用接口版本，不能猜测异步图片查询路由。

实测提示：主站 gpt-image-2 请求 1024×1024 时曾返回 1254×1254 PNG；请求尺寸不保证与实际像素完全一致，交付前检查文件尺寸。
