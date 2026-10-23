"""Shared credential, transport and durable-file helpers; Python standard library only."""
from __future__ import annotations

import contextlib
import getpass
import json
import os
from pathlib import Path
import ssl
import sys
import tempfile
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ORIGIN = "https://fastaiapi.cloud"
H3_ORIGIN = "https://newapi.fastaiapi.cloud"
PROVIDERS = {"main": (ORIGIN, "FASTAIAPI_API_KEY"), "grok": (ORIGIN, "FASTAIAPI_GROK_API_KEY"), "h3": (H3_ORIGIN, "FASTAIAPI_H3_API_KEY")}


def provider_for(model):
    return "h3" if model == "minimax-h3" else "grok" if model == "grok-imagine-video-1.5" else "main"


def provider_origin(provider="main"):
    if provider not in PROVIDERS:
        raise MediaError("Unknown provider; use main, grok or h3.")
    return PROVIDERS[provider][0]


def config_name(provider):
    provider_origin(provider)
    return "fastaiapi-media" + ("-" + provider if provider != "main" else "")


class MediaError(Exception):
    pass


NETWORK_HINT = ("无法连接 FastAiApi 接口：请检查目标站点、网络、代理及宿主实际联网权限。"
                "提交结果可能未知：先查平台任务并恢复公共任务 ID，不要重复提交。")


class HttpError(MediaError):
    def __init__(self, status, retry_after=0):
        # Response bodies may echo credentials, signed URLs or inline media: never log them.
        self.status = status
        self.retry_after = retry_after
        if status in (401, 403):
            message = (f"FastAiApi HTTP {status}：API Key 无效、已删除或没有该模型权限。"
                       "请用户核对 Key 是否完整，或发送新的 Key 后重新保存。")
        elif status == 402:
            message = "FastAiApi HTTP 402：账户余额不足，请用户充值后再试。"
        else:
            message = f"FastAiApi HTTP {status}；为保护隐私未输出响应内容。"
        super().__init__(message)


def config_path(name="fastaiapi-media"):
    if sys.platform == "darwin":
        root = Path.home() / "Library" / "Application Support"
    elif sys.platform.startswith("win"):
        root = Path(os.environ.get("APPDATA", str(Path.home() / "AppData" / "Roaming")))
    else:
        root = Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
    return root / name / "config.json"


def normalize_key(key):
    if not isinstance(key, str):
        raise MediaError("API key must be a string.")
    key = key.strip()
    if key.lower().startswith("bearer "):
        key = key[7:].strip()
    if not key or any(c.isspace() for c in key):
        raise MediaError("API key is empty or contains whitespace.")
    return key


PROJECT_DIR = ".fastaiapi-media"


def project_config_path(start=None, provider="main"):
    """Nearest provider-specific project config from the working directory upwards, or None."""
    here = Path(start or Path.cwd()).resolve()
    for directory in (here, *here.parents):
        candidate = directory / (PROJECT_DIR + ("-" + provider if provider != "main" else "")) / "config.json"
        if candidate.is_file():
            return candidate
    return None


def active_config(provider="main"):
    """(source, path) of the key that load_key will use, or (None, None)."""
    # Project copy first: it only exists because the global save was blocked (or refreshed with it),
    # so it is never older than the global file. Environment variable is a CI/server fallback.
    provider_origin(provider)
    project = project_config_path(provider=provider)
    if project:
        return "project", project
    if config_path(config_name(provider)).is_file():
        return "global", config_path(config_name(provider))
    if os.environ.get(PROVIDERS[provider][1]):
        return "environment", None
    return None, None


def load_key(provider="main"):
    source, path = active_config(provider)
    if source == "environment":
        return normalize_key(os.environ[PROVIDERS[provider][1]])
    if source is None:
        raise MediaError(f"尚未配置 {provider} 密钥，请从 {provider_origin(provider)}/keys 获取并使用 configure --provider {provider} 保存。")
    return normalize_key(read_json(path).get("api_key"))


def key_source(provider="main"):
    return active_config(provider)[0]


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")


def read_json(path):
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise MediaError("Expected a JSON object.")
    return value


def write_private(path, data, *, replace=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not replace:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        return
    fd, temporary = tempfile.mkstemp(prefix=".media-api-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def read_key_file(path):
    """Read a key the agent wrote to a temporary file, then always delete that file."""
    path = Path(path)
    try:
        # utf-8-sig tolerates a BOM from Windows editors; strip() in normalize_key drops CRLF.
        return path.read_text(encoding="utf-8-sig")
    except OSError as error:
        raise MediaError(f"Cannot read key file: {error.strerror or error}.") from None
    finally:
        with contextlib.suppress(OSError):
            path.unlink()


def save_global(key, provider="main"):
    target = config_path(config_name(provider))
    target.parent.mkdir(parents=True, exist_ok=True)
    if os.name != "nt":
        target.parent.chmod(0o700)
    write_private(target, json_bytes({"api_key": key}), replace=True)
    return target


def save_project(key, directory=None, provider="main"):
    folder = Path(directory or Path.cwd()) / (PROJECT_DIR + ("-" + provider if provider != "main" else ""))
    folder.mkdir(parents=True, exist_ok=True)
    ignore = folder / ".gitignore"
    if not ignore.exists():
        ignore.write_text("# Contains a private API key; never commit.\n*\n", encoding="utf-8")
    target = folder / "config.json"
    write_private(target, json_bytes({"api_key": key}), replace=True)
    return target


def configure(import_legacy=False, key_file=None, provider="main"):
    provider_origin(provider)
    if import_legacy:
        raise MediaError("旧平台凭据不可迁移，请配置目标站点自己的密钥。")
    if key_file is not None:
        key = normalize_key(read_key_file(key_file))
    else:
        # Non-interactive hosts pipe the key on stdin; terminals still get a hidden prompt.
        raw = getpass.getpass(f"FastAiApi {provider} API key: ") if sys.stdin.isatty() else sys.stdin.readline()
        key = normalize_key(raw)
    try:
        target = save_global(key, provider=provider)
    except OSError:
        # Sandboxed agents (e.g. Codex workspace-write) may only write inside the project folder.
        try:
            target = save_project(key, provider=provider)
        except OSError:
            raise MediaError("系统配置目录和当前项目文件夹都无法写入，Key 未保存。"
                             "请使用可写目录，并遵守宿主实际权限设置。") from None
        return {"configured": True, "scope": "project", "config_path": str(target), "imported": False,
                "note": "系统配置目录无法写入，Key 已保存在当前项目文件夹，在本项目内立即可用。"
                        "换到其他项目会再次需要 Key；如需全局保存，请使用可写的系统配置目录。"}
    stale = project_config_path(provider=provider)
    if stale:
        # Keep a project copy from an earlier sandboxed save in sync so it cannot shadow the new key.
        with contextlib.suppress(OSError):
            write_private(stale, json_bytes({"api_key": key}), replace=True)
    return {"configured": True, "scope": "global", "config_path": str(target), "imported": False}


@contextlib.contextmanager
def lock_run(directory):
    path = Path(directory) / ".lock"
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    with os.fdopen(fd, "r+b") as handle:
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(handle.fileno()).st_size == 0:
                    handle.write(b"0")
                    handle.flush()
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise MediaError("Another process is using this run; resume after it finishes.") from exc
        try:
            yield
        finally:
            if os.name == "nt":
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def ssl_context():
    context = ssl.create_default_context()
    if context.cert_store_stats().get("x509_ca", 0) == 0:
        for path in ("/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem",
                     "/opt/homebrew/etc/openssl@3/cert.pem", "/usr/local/etc/openssl@3/cert.pem"):
            if Path(path).is_file():
                context.load_verify_locations(cafile=path)
                break
    return context


def validate_url(url):
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise MediaError("Expected an HTTP(S) URL without embedded credentials.")
    return parsed


def origin(url):
    p = validate_url(url)
    return p.scheme, p.hostname, p.port or (443 if p.scheme == "https" else 80)


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        if req.get_method() != "GET":
            raise MediaError("API submission redirected; stopped without resubmitting.")
        if urlsplit(req.full_url).scheme == "https" and urlsplit(newurl).scheme != "https":
            raise MediaError("Refusing an HTTPS downgrade redirect.")
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None and origin(req.full_url) != origin(newurl):
            redirected.remove_header("Authorization")
        return redirected


def opener():
    return urllib.request.build_opener(SafeRedirect(), urllib.request.HTTPSHandler(context=ssl_context()))


def retry_seconds(value):
    try:
        return max(0, float(value))
    except (TypeError, ValueError):
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError, OverflowError):
            return 0


def api_request(method, route, key, body=None, headers=None, *, retry=False, timeout=60, provider="main"):
    if not route.startswith("/v1/") or "://" in route:
        raise MediaError("Invalid API route.")
    request_headers = {"Authorization": "Bearer " + key, "Accept": "application/json"}
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    request_headers.update(headers or {})
    for attempt in range(3 if retry else 1):
        try:
            req = urllib.request.Request(provider_origin(provider) + route, data=body, headers=request_headers, method=method)
            with opener().open(req, timeout=timeout) as response:
                raw = response.read()
            value = json.loads(raw)
            if not isinstance(value, dict):
                raise MediaError("API response is not a JSON object.")
            if value.get("error") and not (method == "GET" and value.get("status") in {"failed", "canceled", "cancelled"}):
                raise MediaError("API reported an error; response omitted for privacy.")
            return value
        except urllib.error.HTTPError as exc:
            failure = HttpError(exc.code, retry_seconds(exc.headers.get("Retry-After")))
            can_retry = exc.code == 429 or 500 <= exc.code <= 599
        except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
            failure = MediaError(NETWORK_HINT)
            can_retry = True
        except (ValueError, UnicodeError) as exc:
            raise MediaError("API response is not valid JSON; preserve the run before any retry.") from exc
        if not retry or not can_retry or attempt == 2:
            raise failure
        delay = max(2 ** attempt, getattr(failure, "retry_after", 0))
        if delay > 60:
            raise MediaError(f"Server requires a {delay:g}-second retry delay; resume later.")
        time.sleep(delay)


def download_file(url, destination, key=None, *, provider="main"):
    validate_url(url)
    if key is not None and origin(url) != origin(provider_origin(provider)):
        raise MediaError("Credentials may only be sent to the FastAiApi origin.")
    path = Path(destination).expanduser().resolve()
    if path.exists():
        raise MediaError("Download destination already exists; select another path.")
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    headers = {"Authorization": "Bearer " + key} if key else {}
    try:
        with opener().open(urllib.request.Request(url, headers=headers), timeout=300) as response:
            content_type = response.headers.get("Content-Type", "").lower()
            if "json" in content_type or "text/" in content_type:
                raise MediaError("Download returned a text/error response instead of media.")
            expected = response.headers.get("Content-Length")
            fd = os.open(part, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            total = 0
            with os.fdopen(fd, "wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)
                    total += len(chunk)
                handle.flush()
                os.fsync(handle.fileno())
            if total == 0 or (expected is not None and total != int(expected)):
                raise MediaError("Incomplete download; partial file retained. Retry to a new destination.")
            # Exclusive destination creation: a concurrent caller's output is never replaced.
            os.link(part, path)
            part.unlink()
    except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
        raise MediaError("Download interrupted; partial file retained. Retry to a new destination.") from exc
    return {"path": str(path), "bytes": total}
