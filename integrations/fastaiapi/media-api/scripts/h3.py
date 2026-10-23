#!/usr/bin/env python3
"""Prepare a FastAiApi H3 request offline; never load credentials or submit jobs."""

from __future__ import annotations

import base64
import json
import mimetypes
from pathlib import Path
import re
from urllib.parse import urlsplit


MAX_REQUEST_BYTES = 10_000_000
PROMPT_FIELDS = (
    "subject_definitions", "summary", "retention_analysis",
    "detailed_description", "overall_soundscape", "non_diegetic_music",
)
ARRAY_FIELDS = {"subject_definitions", "retention_analysis"}
MEDIA = {"image": (9, "Picture", "图像"), "video": (3, "Video", "视频"),
         "audio": (3, "Audio", "音频")}


def read_prompt(path: Path) -> str:
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        raise ValueError("The optimized prompt must not be empty.")
    if path.suffix.lower() != ".json":
        return raw
    value = json.loads(raw)
    if not isinstance(value, dict) or set(value) != set(PROMPT_FIELDS):
        raise ValueError("A JSON prompt must contain exactly the six documented H3 fields.")
    for key in PROMPT_FIELDS:
        item = value[key]
        if key in ARRAY_FIELDS:
            if not isinstance(item, list) or any(
                not isinstance(line, str) or not line.strip() for line in item
            ):
                raise ValueError(f"{key} must be an array of nonempty strings.")
        elif not isinstance(item, str) or not item.strip():
            raise ValueError(f"{key} must be a nonempty string.")
    # The six keys belong inside a single text string, never at the HTTP body root.
    return json.dumps({key: value[key] for key in PROMPT_FIELDS}, ensure_ascii=False)


def make_media(kind: str, source: str) -> dict:
    parsed = urlsplit(source)
    if parsed.scheme.lower() in {"http", "https"}:
        if not parsed.hostname or parsed.username is not None or parsed.password is not None:
            raise ValueError("Reference URLs must have a host and no embedded credentials.")
        return {"type": f"{kind}_url", f"{kind}_url": {"url": source},
                "role": f"reference_{kind}"}
    if "://" in source:
        raise ValueError("Remote references must use HTTP or HTTPS.")
    path = Path(source).expanduser()
    mime, _ = mimetypes.guess_type(path.name)
    if not mime or not mime.startswith(kind + "/"):
        raise ValueError(f"Local {kind} file needs a matching media extension.")
    if not path.is_file():
        raise ValueError(f"Local {kind} reference is not a file.")
    if path.stat().st_size > MAX_REQUEST_BYTES * 3 // 4:
        raise ValueError("Inline reference exceeds the body budget; use a public URL.")
    # Bound the read even if the file grows after stat().
    with path.open("rb") as handle:
        data = handle.read(MAX_REQUEST_BYTES * 3 // 4 + 1)
    if not data or len(data) > MAX_REQUEST_BYTES * 3 // 4:
        raise ValueError("Inline reference is empty or exceeds the body budget.")
    encoded = base64.b64encode(data).decode("ascii")
    return {"type": f"{kind}_b64", f"{kind}_b64": f"data:{mime};base64,{encoded}",
            "role": f"reference_{kind}"}


def bind_labels(prompt: str, references: dict[str, list[str]]) -> str:
    legend = []
    for kind, (_, english, marker) in MEDIA.items():
        count = len(references[kind])
        markers = "(?:图像|图片)" if kind == "image" else marker
        pattern = rf"<{english}\s+(\d+)>|@{markers}(\d+)"
        for match in re.finditer(pattern, prompt):
            index = int(match.group(1) or match.group(2))
            if not 1 <= index <= count:
                raise ValueError(f"Prompt references {kind} {index}, but only {count} supplied.")
        legend.extend(f"<{english} {i}> corresponds to @{marker}{i}."
                      for i in range(1, count + 1))
    if not legend:
        return prompt
    return "Reference bindings (numbered independently per media type):\n" + "\n".join(legend) + "\n\n" + prompt


def build_request(prompt: str, *, duration: int, ratio: str, resolution: str,
                  images=(), videos=(), audios=(), metadata=None) -> bytes:
    if type(duration) is not int or not 1 <= duration <= 15:
        raise ValueError("H3 duration must be an integer from 1 through 15 seconds.")
    if ratio not in {"16:9", "9:16"} or resolution != "720p":
        raise ValueError("Use ratio 16:9 or 9:16; resolution must be 720p (2k is currently unsupported).")
    if not isinstance(prompt, str) or not prompt.strip():
        raise ValueError("The optimized prompt must not be empty.")
    references = {"image": list(images), "video": list(videos), "audio": list(audios)}
    if not references["image"]:
        raise ValueError("MiniMax H3 requires at least one reference image; text-only or video/audio-only generation is unsupported.")
    for kind, items in references.items():
        if len(items) > MEDIA[kind][0]:
            raise ValueError(f"H3 allows at most {MEDIA[kind][0]} {kind} references.")
    if metadata is not None and (not isinstance(metadata, dict) or any(
        not isinstance(k, str) or not isinstance(v, str) for k, v in metadata.items()
    )):
        raise ValueError("Metadata must be an object with string keys and string values.")
    content = [{"type": "text", "text": bind_labels(prompt.strip(), references)}]
    for kind, items in references.items():
        content.extend(make_media(kind, item) for item in items)
    payload = {"model": "minimax-h3", "content": content, "resolution": resolution,
               "ratio": ratio, "duration": duration}
    if metadata is not None:
        payload["metadata"] = metadata
    body = (json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
    if len(body) > MAX_REQUEST_BYTES:
        raise ValueError("Encoded request exceeds 10 MB; use public URLs for larger references.")
    return body
