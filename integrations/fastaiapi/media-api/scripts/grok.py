#!/usr/bin/env python3
"""Prepare FastAiApi Grok video JSON offline; never read keys or call the API."""

from __future__ import annotations

import base64
import json
from pathlib import Path


MODEL = "grok-imagine-video-1.5"
MAX_MEDIA_BYTES = 100 * 1024 * 1024
DURATIONS = {6, 12, 18, 24, 30}
IMAGE_MIME = {ext: "image/" + subtype for ext, subtype in (
    (".avif", "avif"), (".bmp", "bmp"), (".gif", "gif"), (".jpeg", "jpeg"),
    (".jpg", "jpeg"), (".png", "png"), (".webp", "webp"))}
AUDIO_MIME = {ext: "audio/" + subtype for ext, subtype in (
    (".aac", "aac"), (".flac", "flac"), (".m4a", "mp4"), (".mp3", "mpeg"),
    (".mpeg", "mpeg"), (".oga", "ogg"), (".ogg", "ogg"), (".wav", "wav"),
    (".webm", "webm"))}


def encode_media(source: str, kind: str, remaining: int) -> tuple[dict, int]:
    if "://" in source or source.startswith("data:"):
        raise ValueError("Supply a local media file; the builder encodes it as a Data URL.")
    path = Path(source).expanduser()
    mime = (IMAGE_MIME if kind == "image" else AUDIO_MIME).get(path.suffix.lower())
    if mime is None:
        raise ValueError(f"Unsupported {kind} file extension.")
    if not path.is_file():
        raise ValueError(f"Local {kind} reference is not a file.")
    prefix = f"data:{mime};base64,"
    # Reject an over-budget input before reading it; measure the actual encoded bytes again below.
    size = path.stat().st_size
    if size == 0 or len(prefix) + 4 * ((size + 2) // 3) > remaining:
        raise ValueError("Empty media or encoded media exceeds the 100 MiB budget.")
    with path.open("rb") as handle:
        raw = handle.read(size + 1)
    if len(raw) != size:
        raise ValueError("Media file changed while reading; prepare again from stable inputs.")
    data = prefix + base64.b64encode(raw).decode("ascii")
    if len(data) > remaining:
        raise ValueError("Encoded media exceeds the 100 MiB budget.")
    return {"b64": data}, len(data)


def build_request(prompt: str, *, mode: str, duration: int = 6,
                  aspect_ratio: str = "16:9", images=(), audios=()) -> tuple[bytes, int]:
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("A nonempty video prompt is required.")
    if mode not in {"first-frame", "reference"}:
        raise ValueError("Mode must be first-frame or reference.")
    if aspect_ratio not in {"16:9", "9:16"}:
        raise ValueError("Aspect ratio must be 16:9 or 9:16.")
    if type(duration) is not int or duration not in DURATIONS:
        raise ValueError("Duration must be an integer: 6, 12, 18, 24 or 30 seconds.")
    images, audios = list(images), list(audios)
    if mode == "first-frame" and (len(images) > 1 or audios):
        raise ValueError("First-frame mode accepts at most one image and no audio references.")
    if mode == "reference" and (duration != 6 or len(images) > 6 or len(audios) > 3):
        raise ValueError("Reference mode requires 6 seconds, at most 6 images and 3 audio files.")
    payload = {"model": MODEL, "prompt": prompt.strip(), "duration": duration,
               "resolution": "720p", "aspect_ratio": aspect_ratio}
    media_bytes = 0
    encoded = {"image": [], "audio": []}
    for kind, sources in (("image", images), ("audio", audios)):
        for source in sources:
            item, length = encode_media(source, kind, MAX_MEDIA_BYTES - media_bytes)
            encoded[kind].append(item)
            media_bytes += length
    if mode == "first-frame" and encoded["image"]:
        payload["image"] = encoded["image"][0]
    if mode == "reference":
        for kind in encoded:
            if encoded[kind]:
                payload[f"reference_{kind}s"] = encoded[kind]
    body = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    return body, media_bytes
