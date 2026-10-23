#!/usr/bin/env python3
"""Standalone FastAiApi images and durable video jobs. Python 3.10+, no pip dependencies."""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import sys
import time
import uuid
from urllib.parse import quote

import common
from common import MediaError, json_bytes, read_json, write_private
import h3
import grok

IMAGE_MODELS = ("gpt-image-2", "gpt-image-2.5")
VIDEO_MODELS = ("minimax-h3", "grok-imagine-video-1.5")
MODELS = IMAGE_MODELS + VIDEO_MODELS
SIZES = ("1024x1024", "720x1280", "1280x720", "1248x832", "1152x864", "864x1152",
         "832x1248", "2048x2048", "1440x2560", "2560x1440", "2496x1664", "2304x1728",
         "1728x2304", "1664x2496", "2160x3840", "3840x2160")
TERMINAL_FAILURE = {"failed", "canceled", "cancelled"}
SUCCESS = {"succeeded", "completed", "success"}
PENDING = {"queued", "dispatching", "running", "retrying", "in_progress", "pending", "processing"}


def canonical_model(value):
    if value == "grok":
        return "grok-imagine-video-1.5"
    if value not in MODELS:
        raise MediaError("Unsupported model; use one of the documented model IDs.")
    return value


def image_request(model, prompt, size="1024x1024", references=()):
    if model not in IMAGE_MODELS or not prompt.strip() or size not in SIZES:
        raise MediaError("Invalid image model, prompt or size.")
    if len(references) > 4:
        raise MediaError("Image generation accepts at most four reference images.")
    value = {"model": model, "prompt": prompt.strip(), "n": 1, "size": size,
             "response_format": "b64_json"}
    if references:
        images = []
        for source in references:
            path = Path(source).expanduser()
            mime, _ = mimetypes.guess_type(path.name)
            if not mime or not mime.startswith("image/"):
                raise MediaError("Image references must be local image files with recognized extensions.")
            raw = path.read_bytes()
            if not raw:
                raise MediaError("Reference image is empty.")
            images.append(f"data:{mime};base64," + base64.b64encode(raw).decode("ascii"))
        value["images"] = images
    return json_bytes(value)


def prepare_run(directory, body):
    value = json.loads(body)
    model = canonical_model(value["model"])
    path = Path(directory).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=False)
    if os.name != "nt":
        path.chmod(0o700)
    record = {"schema": 2, "origin": common.provider_origin(common.provider_for(model)), "model": model, "kind": "image" if model in IMAGE_MODELS else "video",
              "state": "prepared", "request_sha256": hashlib.sha256(body).hexdigest()}
    if model == "minimax-h3":
        record["idempotency_key"] = "media-api-" + str(uuid.uuid4())
    write_private(path / "request.json", body)
    write_private(path / "receipt.json", json_bytes(record))
    return public_record(path, record)


def read_run(directory, verify_body=False):
    path = Path(directory).expanduser().resolve()
    record = read_json(path / "receipt.json")
    if record.get("schema") != 2 or record.get("model") not in MODELS:
        raise MediaError("Unrecognized run receipt.")
    if record.get("origin") != common.provider_origin(common.provider_for(record["model"])):
        raise MediaError("Run provider differs; refusing to send a job to another origin.")
    body = None
    if verify_body:
        body = (path / "request.json").read_bytes()
        if hashlib.sha256(body).hexdigest() != record["request_sha256"]:
            raise MediaError("Request changed after preparation. Prepare a new run for revised content.")
        if json.loads(body).get("model") != record["model"]:
            raise MediaError("Request and receipt models disagree.")
    return path, record, body


def save_record(path, record):
    write_private(path / "receipt.json", json_bytes(record), replace=True)


def public_record(path, record):
    result = {"run": str(path), "model": record["model"], "state": record["state"]}
    for name in ("job_id", "progress", "files", "http_status"):
        if name in record:
            result[name] = record[name]
    return result


def response_job_id(value):
    ident = value.get("id") or value.get("task_id")
    if not isinstance(ident, str) or not ident.strip():
        raise MediaError("Submission returned no public job ID; remote outcome is unknown.")
    if len(ident) > 512 or any(ord(c) < 32 for c in ident) or "://" in ident:
        raise MediaError("Unexpected public job ID format.")
    return ident


def image_extension(raw):
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if raw.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if raw.startswith(b"RIFF") and raw[8:12] == b"WEBP":
        return ".webp"
    if raw.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    raise MediaError("Response is not a recognized PNG/JPEG/WebP/GIF image.")


def collect_image(path, record, value):
    items = value.get("data")
    if not isinstance(items, list) or not items:
        raise MediaError("Image response missing data[].b64_json; preserve run and inspect protocol.")
    files = []
    for index, item in enumerate(items):
        encoded = item.get("b64_json") if isinstance(item, dict) else None
        if not isinstance(encoded, str):
            raise MediaError("Image response missing base64 content.")
        if encoded.startswith("data:"):
            encoded = encoded.partition(",")[2]
        raw = base64.b64decode(encoded, validate=True)
        output = path / f"{record['model']}-{index + 1:03d}{image_extension(raw)}"
        write_private(output, raw)
        files.append({"path": str(output), "bytes": len(raw)})
        record["files"] = files
        save_record(path, record)
    record["state"] = "downloaded"


def submit(directory, *, retry_ambiguous=False, key=None):
    path = Path(directory).expanduser().resolve()
    with common.lock_run(path):
        path, record, body = read_run(path, verify_body=True)
        if record.get("job_id") or record["state"] == "downloaded":
            return public_record(path, record)
        uncertain = record["state"] in {"submitting", "submission_unknown"}
        if uncertain:
            raise MediaError("Submission may already exist. Recover its job ID; provider idempotency has not been verified; repeated submission is disabled.")
        if record["state"] != "prepared" and not uncertain:
            raise MediaError("Run cannot be submitted from its current state.")
        key = key or common.load_key(common.provider_for(record["model"]))
        value = json.loads(body)
        if record["model"] == "minimax-h3":
            content = value.get("content", [])
            has_image = any(isinstance(item, dict) and (
                item.get("type") == "image_b64" and isinstance(item.get("image_b64"), str) and item["image_b64"].strip()
                or item.get("type") == "image_url" and isinstance(item.get("image_url"), dict)
                and isinstance(item["image_url"].get("url"), str) and item["image_url"]["url"].strip()
            ) for item in content)
            if not has_image:
                raise MediaError("MiniMax H3 requires a reference image. Prepare a new run with --image and an optimized H3 prompt.")
        route = "/v1/videos"
        if record["kind"] == "image":
            route = "/v1/images/edits" if value.get("images") else "/v1/images/generations"
        headers = {}
        if record["model"] == "minimax-h3":
            headers["Idempotency-Key"] = record["idempotency_key"]
        record["state"] = "submitting"
        save_record(path, record)  # Durable intent is recorded before the network call.
        try:
            response = common.api_request("POST", route, key, body, headers,
                                          retry=False, timeout=300, provider=common.provider_for(record["model"]))
            if record["kind"] == "image":
                collect_image(path, record, response)
            else:
                record["job_id"] = response_job_id(response)
                record["state"] = "submitted"
            save_record(path, record)
        except Exception as exc:
            record["state"] = "submission_unknown"
            if isinstance(exc, common.HttpError):
                record["http_status"] = exc.status
            save_record(path, record)
            raise
        return public_record(path, record)


def apply_status(record, response):
    response_model = response.get("model")
    if response_model is not None and response_model != record["model"]:
        raise MediaError("Job model differs from the prepared request; do not attach this job.")
    state = response.get("status")
    if state not in SUCCESS | TERMINAL_FAILURE | PENDING:
        raise MediaError("Unrecognized or missing remote job status; do not resubmit.")
    record["remote_status"] = state
    record["state"] = "succeeded" if state in SUCCESS else "failed" if state in TERMINAL_FAILURE else state
    progress = response.get("progress")
    if isinstance(progress, (int, float)) and not isinstance(progress, bool):
        record["progress"] = progress
    return state


def status(directory, *, recover_job_id=None, key=None, timeout=60):
    path = Path(directory).expanduser().resolve()
    with common.lock_run(path):
        path, record, _ = read_run(path)
        if record["kind"] != "video":
            return public_record(path, record)
        if recover_job_id:
            if record.get("job_id") and record["job_id"] != recover_job_id:
                raise MediaError("A different job is already attached to this run.")
            ident = response_job_id({"id": recover_job_id})
        else:
            ident = record.get("job_id")
        if not ident:
            raise MediaError("No known job ID. Use recover with the verified public job ID.")
        if record["state"] == "downloaded":
            return public_record(path, record)
        response = common.api_request("GET", "/v1/videos/" + quote(ident, safe=""),
                                      key or common.load_key(common.provider_for(record["model"])), retry=timeout >= 60, timeout=timeout, provider=common.provider_for(record["model"]))
        returned_id = response.get("id") or response.get("task_id")
        if returned_id is not None and returned_id != ident:
            raise MediaError("Status response belongs to another job.")
        apply_status(record, response)
        record["job_id"] = ident
        save_record(path, record)
        return public_record(path, record)


def wait_for_job(directory, timeout=50, interval=None):
    if timeout < 0 or timeout > 60 or (interval is not None and interval < 1):
        raise MediaError("Use timeout 0–60 seconds and a positive interval; repeat wait to continue.")
    _, record, _ = read_run(directory)
    delay = interval or (30 if record["model"] == "minimax-h3" else 10)
    deadline = time.monotonic() + timeout
    key = common.load_key(common.provider_for(record["model"]))
    while True:
        remaining = max(1, deadline - time.monotonic())
        result = status(directory, key=key, timeout=min(remaining, 30))
        if result["state"] in {"succeeded", "failed", "downloaded"}:
            return result
        remaining = deadline - time.monotonic()
        if remaining <= delay:
            result["wait_expired"] = True
            return result
        time.sleep(delay)


def download(directory, output):
    path = Path(directory).expanduser().resolve()
    with common.lock_run(path):
        path, record, _ = read_run(path)
        if record["state"] == "downloaded":
            if all(Path(item["path"]).is_file() for item in record.get("files", [])):
                return public_record(path, record)
            raise MediaError("Downloaded file is missing; preserve the receipt and inspect its recorded path.")
        if record["kind"] != "video" or not record.get("job_id"):
            raise MediaError("Download requires a submitted video job.")
        key = common.load_key(common.provider_for(record["model"]))
        route = "/v1/videos/" + quote(record["job_id"], safe="")
        response = common.api_request("GET", route, key, retry=True, provider=common.provider_for(record["model"]))
        returned_id = response.get("id") or response.get("task_id")
        if returned_id is not None and returned_id != record["job_id"]:
            raise MediaError("Download status response belongs to another job.")
        apply_status(record, response)
        save_record(path, record)
        if record["state"] != "succeeded":
            raise MediaError("Video is not successful yet; inspect status or continue waiting.")
        if record["model"] == "minimax-h3":
            url = response.get("output_url")
            if not isinstance(url, str) or not url:
                raise MediaError("Successful H3 response has no output_url.")
            result = common.download_file(url, output)
        else:
            result = common.download_file(common.ORIGIN + route + "/content", output, key)
        record["files"] = [result]
        record["state"] = "downloaded"
        save_record(path, record)
        return public_record(path, record)


def build_from_args(args):
    model = canonical_model(args.model)
    prompt = h3.read_prompt(args.prompt_file) if model == "minimax-h3" else args.prompt_file.read_text(encoding="utf-8")
    if model in IMAGE_MODELS:
        if args.video or args.audio or args.duration is not None or args.mode is not None or args.metadata_file or args.ratio or args.resolution:
            raise MediaError("Video/audio/duration/mode/metadata arguments do not apply to images.")
        return image_request(model, prompt, args.size or "1024x1024", args.image)
    if args.size is not None:
        raise MediaError("Video uses ratio and resolution, not image size.")
    if args.duration is None:
        raise MediaError("Video duration is required.")
    if model == "minimax-h3":
        if args.mode is not None:
            raise MediaError("H3 has no API mode field; direct the reference relationship in the prompt.")
        metadata = read_json(args.metadata_file) if args.metadata_file else None
        return h3.build_request(prompt, duration=args.duration, ratio=args.ratio or "16:9",
                                resolution=args.resolution or "720p", images=args.image,
                                videos=args.video, audios=args.audio, metadata=metadata)
    if args.video or args.metadata_file or args.resolution not in {None, "720p"}:
        raise MediaError("Grok supports no video reference/metadata and only 720p in this contract.")
    if args.mode is None:
        raise MediaError("Grok requires --mode first-frame or --mode reference.")
    return grok.build_request(prompt, mode=args.mode, duration=args.duration,
                              aspect_ratio=args.ratio or "16:9", images=args.image, audios=args.audio)[0]


def image_batch(args):
    if args.count < 1 or args.concurrency < 1:
        raise MediaError("Count and concurrency must be positive.")
    model = canonical_model(args.model)
    body = image_request(model, args.prompt_file.read_text(encoding="utf-8"), args.size, args.reference)
    key = common.load_key("main")
    root = args.output_dir.expanduser().resolve() / ("batch-" + uuid.uuid4().hex)
    root.mkdir(parents=True, mode=0o700)
    runs = []
    for index in range(args.count):
        path = root / f"{index + 1:03d}"
        prepare_run(path, body)
        runs.append(path)
    results = []
    def one(path):
        try:
            return submit(path, key=key)
        except Exception:
            # Details, potentially including private filesystem names, stay out of batch logs.
            return {"run": str(path), "state": "error", "error": "Request failed; preserve and inspect this run."}
    with concurrent.futures.ThreadPoolExecutor(max_workers=min(args.concurrency, args.count, 50)) as pool:
        futures = []
        for index, path in enumerate(runs):
            if index:
                time.sleep(0.3)
            futures.append(pool.submit(one, path))
        for future in futures:
            results.append(future.result())
    manifest = {"model": model, "requested": args.count,
                "generated": sum(item["state"] == "downloaded" for item in results), "runs": results}
    write_private(root / "manifest.json", json_bytes(manifest))
    return manifest


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    subs = p.add_subparsers(dest="command", required=True)
    cfg = subs.add_parser("configure", help="Save the API key (key file, stdin or hidden prompt)")
    cfg.add_argument("--provider", choices=("main", "grok", "h3"), default="main")
    cfg.add_argument("--key-file", type=Path, help="Read the key from this file, then delete the file")
    check = subs.add_parser("config-status", help="Report credential presence without printing secrets")
    check.add_argument("--provider", choices=("main", "grok", "h3"), default="main")
    models = subs.add_parser("models", help="Read-only account model discovery")
    models.add_argument("--provider", choices=("main", "grok", "h3"), default="main")
    models.add_argument("--type", choices=("all", "image", "video"), default="all")
    prep = subs.add_parser("prepare", help="Prepare a new immutable request and receipt offline")
    prep.add_argument("--model", required=True, choices=MODELS + ("grok",))
    prep.add_argument("--prompt-file", type=Path, required=True)
    prep.add_argument("--run", type=Path, required=True)
    prep.add_argument("--size", choices=SIZES)
    prep.add_argument("--duration", type=int)
    prep.add_argument("--ratio", choices=("16:9", "9:16"))
    prep.add_argument("--resolution", choices=("720p",), help="720p only; 2k is currently unsupported")
    prep.add_argument("--mode", choices=("first-frame", "reference"))
    prep.add_argument("--metadata-file", type=Path)
    for kind in ("image", "video", "audio"):
        prep.add_argument("--" + kind, action="append", default=[])
    for name in ("submit", "status", "wait", "recover", "download"):
        sub = subs.add_parser(name)
        sub.add_argument("--run", type=Path, required=True)
        if name == "submit":
            sub.add_argument("--retry-ambiguous", action="store_true", help="Deprecated: uncertain POST retries are disabled until provider idempotency is verified")
        elif name == "wait":
            sub.add_argument("--timeout", type=float, default=50)
            sub.add_argument("--interval", type=float)
        elif name == "recover":
            sub.add_argument("--job-id", required=True, help="Verified public task ID from this exact submission")
        elif name == "download":
            sub.add_argument("--output", type=Path, required=True)
    img = subs.add_parser("image", help="Synchronous image generation/editing, optional parallel batch")
    img.add_argument("--model", choices=IMAGE_MODELS, default="gpt-image-2")
    img.add_argument("--prompt-file", type=Path, required=True)
    img.add_argument("--reference", action="append", default=[])
    img.add_argument("--size", choices=SIZES, default="1024x1024")
    img.add_argument("--count", type=int, default=1)
    img.add_argument("--concurrency", type=int, default=10)
    img.add_argument("--output-dir", type=Path, required=True)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "configure":
            result = common.configure(key_file=args.key_file, provider=args.provider)
        elif args.command == "config-status":
            source, path = common.active_config(args.provider)
            result = {"ready": source is not None, "provider": args.provider,
                      "origin": common.provider_origin(args.provider), "active_source": source,
                      "active_config_path": str(path) if path else None}
        elif args.command == "models":
            response = common.api_request("GET", "/v1/models", common.load_key(args.provider),
                                          retry=True, provider=args.provider)
            result = {"provider": args.provider, "models": [item["id"] for item in response.get("data", [])
                                  if isinstance(item, dict) and isinstance(item.get("id"), str)]}
        elif args.command == "prepare":
            result = prepare_run(args.run, build_from_args(args))
        elif args.command == "submit":
            result = submit(args.run, retry_ambiguous=args.retry_ambiguous)
        elif args.command == "status":
            result = status(args.run)
        elif args.command == "recover":
            result = status(args.run, recover_job_id=args.job_id)
        elif args.command == "wait":
            result = wait_for_job(args.run, args.timeout, args.interval)
        elif args.command == "download":
            result = download(args.run, args.output)
        else:
            result = image_batch(args)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        if result.get("state") == "failed" or result.get("generated", 0) < result.get("requested", 0):
            return 1
        return 2 if result.get("wait_expired") else 0
    except (MediaError, ValueError, OSError) as exc:
        if isinstance(exc, MediaError):
            message = str(exc)
        elif isinstance(exc, (json.JSONDecodeError, UnicodeError)):
            message = "Input or response is not valid UTF-8/JSON/base64; private content omitted."
        elif isinstance(exc, PermissionError):
            message = ("没有权限读写文件。若在 Codex 等沙箱中运行，请把输出放在当前项目文件夹内，"
                       "并遵守宿主实际权限设置。")
        elif isinstance(exc, OSError):
            message = "无法访问文件或网络；请检查路径、权限和是否已存在同名输出。"
        else:
            message = str(exc)  # Local request validators return fixed messages, not payloads.
        print(json.dumps({"error": message}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
