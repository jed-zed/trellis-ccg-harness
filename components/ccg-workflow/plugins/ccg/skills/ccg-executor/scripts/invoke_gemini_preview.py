#!/usr/bin/env python3
"""Run Gemini with a local browser preview.

This is the Codex-side equivalent of CCG's codeagent-wrapper Web UI behavior:
Gemini remains read-only, Codex owns the workspace, and the user can watch
streaming output in a browser while the subprocess runs.
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import queue
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PROMPT_TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "gemini"
PREVIEW_TEMPLATE_PATH = (
    Path(__file__).resolve().parent.parent / "templates" / "live-output.upstream.html"
)
PROMPT_TEMPLATES = (
    "none",
    "general",
    "plan",
    "prototype",
    "review",
    "frontend",
    "analyzer",
    "architect",
    "debugger",
    "optimizer",
    "tester",
)


def configure_utf8_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


class State:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.preview_session_id = f"gemini-preview-{int(time.time() * 1000)}"
        self.backend = "gemini"
        self.model = ""
        self.prompt_preview = ""
        self.session_id = ""
        self.content = ""
        self.response = ""
        self.raw = ""
        self.clients: list[queue.Queue[dict[str, object]]] = []
        self.content_events: list[dict[str, object]] = []
        self.next_event_id = 0
        self.events: list[dict[str, str]] = []
        self.status = "starting"
        self.done = False
        self.exit_code: int | None = None
        self.auto_close_browser_seconds = 3
        self.output_file = ""
        self.response_file = ""
        self.snapshot_path = ""
        self.snapshot_excludes = ""
        self.stream_events = 0
        self.result_seen = False
        self.result_status = ""
        self.started_at = time.strftime("%Y-%m-%d %H:%M:%S")

    def update(self, **kwargs: object) -> None:
        with self.lock:
            for key, value in kwargs.items():
                setattr(self, key, value)

    def add_event(self, message: str) -> None:
        if not message:
            return
        with self.lock:
            self.events.append(
                {
                    "time": time.strftime("%H:%M:%S"),
                    "message": message,
                }
            )
            self.events = self.events[-200:]

    def increment_stream_events(self) -> int:
        with self.lock:
            self.stream_events += 1
            return self.stream_events

    def append_content(
        self, text: str, content_type: str = "message", response_text: bool = True
    ) -> None:
        if not text:
            return
        event = {
            "session_id": self.preview_session_id,
            "backend": self.backend,
            "content": text,
            "content_type": content_type,
        }
        clients: list[queue.Queue[dict[str, object]]]
        with self.lock:
            self.content += text
            if response_text:
                if content_type == "replace_message":
                    self.response = text
                else:
                    self.response += text
            event, clients = self._record_client_event_locked(event)
        for client in clients:
            self._put_client_event(client, event)

    def complete(self, exit_code: int, status: str) -> None:
        clients: list[queue.Queue[dict[str, object]]]
        with self.lock:
            if self.done:
                return
            self.done = True
            self.exit_code = exit_code
            self.status = status
            event, clients = self._record_client_event_locked(
                {
                    "session_id": self.preview_session_id,
                    "backend": self.backend,
                    "done": True,
                    "exit_code": exit_code,
                    "status": status,
                    "auto_close_browser_seconds": self.auto_close_browser_seconds,
                }
            )
        for client in clients:
            self._put_client_event(client, event)

    def _record_client_event_locked(
        self, event: dict[str, object]
    ) -> tuple[dict[str, object], list[queue.Queue[dict[str, object]]]]:
        self.next_event_id += 1
        recorded = {**event, "_event_id": self.next_event_id}
        self.content_events.append(recorded)
        return recorded, list(self.clients)

    def _put_client_event(
        self, client: queue.Queue[dict[str, object]], event: dict[str, object]
    ) -> None:
        client.put_nowait(event)

    def sessions(self) -> list[dict[str, object]]:
        with self.lock:
            return [
                {
                    "id": self.preview_session_id,
                    "backend": self.backend,
                    "task": self.prompt_preview,
                    "done": self.done,
                }
            ]

    def register_client(
        self, session_id: str, last_event_id: int = 0
    ) -> tuple[queue.Queue[dict[str, object]], bool, int | None]:
        if session_id != self.preview_session_id:
            raise KeyError(session_id)
        client: queue.Queue[dict[str, object]] = queue.Queue()
        with self.lock:
            for event in self.content_events:
                if int(event.get("_event_id", 0)) > last_event_id:
                    client.put_nowait(event)
            self.clients.append(client)
            done = self.done
            exit_code = self.exit_code
        return client, done, exit_code

    def unregister_client(self, client: queue.Queue[dict[str, object]]) -> None:
        with self.lock:
            self.clients = [existing for existing in self.clients if existing is not client]

    def append_raw(self, text: str) -> None:
        if not text:
            return
        with self.lock:
            self.raw += text

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            return {
                "backend": self.backend,
                "model": self.model,
                "prompt_preview": self.prompt_preview,
                "preview_session_id": self.preview_session_id,
                "session_id": self.session_id,
                "content": self.content,
                "response": self.response,
                "raw": self.raw,
                "events": list(self.events),
                "status": self.status,
                "done": self.done,
                "exit_code": self.exit_code,
                "auto_close_browser_seconds": self.auto_close_browser_seconds,
                "output_file": self.output_file,
                "response_file": self.response_file,
                "snapshot_path": self.snapshot_path,
                "snapshot_excludes": self.snapshot_excludes,
                "stream_events": self.stream_events,
                "result_seen": self.result_seen,
                "result_status": self.result_status,
                "started_at": self.started_at,
            }


STATE = State()

SNAPSHOT_IGNORED_NAMES = {
    ".git",
    ".hg",
    ".svn",
    ".idea",
    ".vscode",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "node_modules",
    "vendor",
    "dist",
    "build",
    "target",
    "coverage",
    ".venv",
    "venv",
    "env",
    ".aws",
    ".gcp",
    ".azure",
    ".ssh",
    "id_rsa",
    "id_ed25519",
}
SNAPSHOT_IGNORED_SUFFIXES = (
    ".pyc",
    ".pyo",
    ".log",
    ".tmp",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    ".crt",
)
SNAPSHOT_IGNORED_PREFIXES = (
    ".env.",
    "credentials",
    "service-account",
)
SNAPSHOT_EXCLUDE_SUMMARY = (
    ".env,.env.*,*.pem,*.key,*.p12,*.pfx,*.crt,id_rsa,id_ed25519,"
    ".aws,.gcp,.azure,.ssh,credentials*,service-account*.json,symlinks,junctions"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Gemini with browser preview")
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", "gemini-3.1-pro-preview"))
    parser.add_argument("--workdir", default=os.getcwd())
    parser.add_argument("--prompt", default="")
    parser.add_argument("--prompt-file", default="")
    parser.add_argument("--output-file", default="")
    parser.add_argument("--hold-seconds", type=int, default=10)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--auto-close-browser-seconds", type=int, default=3)
    parser.add_argument("--no-auto-close-browser", action="store_true")
    parser.add_argument(
        "--min-preview-hold-seconds",
        type=int,
        default=5,
        help="Minimum final-state time for visible previews before shutting down the local server.",
    )
    parser.add_argument(
        "--max-snapshot-bytes",
        type=int,
        default=0,
        help="Optional cap for copied snapshot bytes. 0 means unlimited.",
    )
    parser.add_argument(
        "--max-snapshot-files",
        type=int,
        default=0,
        help="Optional cap for copied snapshot files. 0 means unlimited.",
    )
    parser.add_argument(
        "--files-from",
        default="",
        help="Optional newline-delimited file containing relative files/directories to include in the snapshot.",
    )
    parser.add_argument(
        "--respect-gitignore",
        action="store_true",
        help="Also apply a lightweight subset of .gitignore rules when creating the snapshot.",
    )
    parser.add_argument(
        "--detach",
        action="store_true",
        help="OS-detach for manual shells; Codex workflows should use a tool-managed background job",
    )
    parser.add_argument("--preview-port", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--approval-mode", default="plan", choices=["default", "auto_edit", "yolo", "plan"])
    parser.add_argument("--prompt-template", default="general", choices=PROMPT_TEMPLATES)
    parser.add_argument(
        "--direct-workdir",
        action="store_true",
        help="Run Gemini directly in --workdir instead of a disposable snapshot. Unsafe unless you trust the prompt.",
    )
    return parser.parse_args()


def get_prompt(args: argparse.Namespace) -> str:
    if args.prompt_file:
        return resolve_cli_file(args.prompt_file).read_text(encoding="utf-8")
    if args.prompt:
        return args.prompt
    if not sys.stdin.isatty():
        return sys.stdin.read()
    raise SystemExit("ERROR: provide --prompt, --prompt-file, or stdin")


def read_prompt_template(name: str) -> str:
    path = PROMPT_TEMPLATE_DIR / f"{name}.md"
    if not path.exists():
        raise SystemExit(f"ERROR: Gemini prompt template not found: {path}")
    return path.read_text(encoding="utf-8")


def apply_prompt_template(args: argparse.Namespace, prompt: str) -> str:
    template_name = getattr(args, "prompt_template", "general")
    if template_name == "none":
        return prompt

    base = read_prompt_template("base")
    role = read_prompt_template(template_name)
    return (
        f"{base.rstrip()}\n\n"
        f"{role.rstrip()}\n\n"
        "# User Task\n\n"
        f"{prompt.strip()}\n"
    )


def resolve_cli_file(value: str) -> Path:
    return Path(value).expanduser().resolve()


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_port(port: int, timeout_seconds: float = 10.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                return True
        except OSError:
            time.sleep(0.15)
    return False


def open_preview_url(url: str) -> bool:
    if os.name == "nt":
        creationflags = 0
        if hasattr(subprocess, "CREATE_NO_WINDOW"):
            creationflags = subprocess.CREATE_NO_WINDOW
        for command in (
            ["cmd", "/c", "start", "", url],
            ["explorer.exe", url],
        ):
            try:
                subprocess.Popen(
                    command,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    creationflags=creationflags,
                )
                return True
            except Exception:
                continue

    try:
        if webbrowser.open_new_tab(url):
            return True
    except Exception:
        pass

    return False


def default_output_file() -> Path:
    root = Path.home() / ".codex" / "ccg" / "logs"
    root.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    return root / f"gemini-preview-{stamp}.txt"


def effective_hold_seconds(args: argparse.Namespace) -> int:
    hold = max(0, int(getattr(args, "hold_seconds", 0) or 0))
    min_preview_hold = max(0, int(getattr(args, "min_preview_hold_seconds", 0) or 0))
    preview_is_visible = not getattr(args, "no_browser", False) or int(getattr(args, "preview_port", 0) or 0) > 0
    if preview_is_visible:
        return max(hold, min_preview_hold)
    return hold


def detach(args: argparse.Namespace, prompt: str, output_path: Path) -> int:
    root = output_path.parent
    root.mkdir(parents=True, exist_ok=True)
    stamp = output_path.stem
    prompt_file = resolve_cli_file(args.prompt_file) if args.prompt_file else root / f"{stamp}.prompt.txt"
    if not args.prompt_file:
        prompt_file.write_text(prompt, encoding="utf-8", errors="replace")

    launcher_log = output_path.with_suffix(".launcher.log")
    preview_port = args.preview_port or free_port()
    preview_url = f"http://127.0.0.1:{preview_port}/"
    workdir_path = resolve_cli_file(args.workdir)
    child_args = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--workdir",
        str(workdir_path),
        "--model",
        args.model,
        "--prompt-file",
        str(prompt_file),
        "--output-file",
        str(output_path),
        "--hold-seconds",
        str(args.hold_seconds),
        "--approval-mode",
        args.approval_mode,
        "--prompt-template",
        args.prompt_template,
        "--auto-close-browser-seconds",
        str(args.auto_close_browser_seconds),
        "--min-preview-hold-seconds",
        str(args.min_preview_hold_seconds),
        "--max-snapshot-bytes",
        str(args.max_snapshot_bytes),
        "--max-snapshot-files",
        str(args.max_snapshot_files),
        "--preview-port",
        str(preview_port),
        "--no-browser",
    ]
    if args.files_from:
        child_args.extend(["--files-from", str(resolve_cli_file(args.files_from))])
    if args.respect_gitignore:
        child_args.append("--respect-gitignore")
    if args.direct_workdir:
        child_args.append("--direct-workdir")
    if args.no_auto_close_browser:
        child_args.append("--no-auto-close-browser")

    creationflags = 0
    if os.name == "nt" and hasattr(subprocess, "CREATE_NO_WINDOW"):
        creationflags = subprocess.CREATE_NO_WINDOW

    log_handle = launcher_log.open("w", encoding="utf-8", errors="replace")
    process_factory = getattr(subprocess, "Popen")
    proc = process_factory(
        child_args,
        cwd=str(workdir_path),
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        creationflags=creationflags,
        close_fds=True,
    )
    log_handle.close()

    print(f"CCG_GEMINI_PREVIEW_PID={proc.pid}", flush=True)
    print(f"CCG_GEMINI_PREVIEW_URL={preview_url}", flush=True)
    print(f"CCG_GEMINI_OUTPUT_FILE={output_path}", flush=True)
    print(f"CCG_GEMINI_RESPONSE_FILE={output_path.with_suffix('.response.txt')}", flush=True)
    print(f"CCG_GEMINI_LAUNCHER_LOG={launcher_log}", flush=True)
    print(f"CCG_GEMINI_PROMPT_TEMPLATE={args.prompt_template}", flush=True)
    auto_close = 0 if args.no_auto_close_browser else max(0, args.auto_close_browser_seconds)
    print(f"CCG_GEMINI_AUTO_CLOSE_BROWSER_SECONDS={auto_close}", flush=True)
    if not args.no_browser:
        ready = wait_for_port(preview_port)
        opened = open_preview_url(preview_url) if ready else False
        print(f"CCG_GEMINI_PREVIEW_READY={1 if ready else 0}", flush=True)
        print(f"CCG_GEMINI_BROWSER_OPENED={1 if opened else 0}", flush=True)
    return 0


SAFE_TASK_RENDERING = """                    const taskLabel = document.createElement('strong');
                    taskLabel.textContent = '📋 Task:';
                    taskEl.appendChild(taskLabel);
                    taskEl.appendChild(document.createElement('br'));
                    const taskText = document.createElement('span');
                    taskText.textContent = session.task;
                    taskEl.appendChild(taskText);"""

PREVIEW_PATCHES = (
    (
        "authoritative assistant replacement",
        """                            case 'message':
                            default:
                                contentEl.style.cssText = 'color: #c9d1d9;';
                                contentEl.textContent = data.content;
                                break;""",
        """                            case 'replace_message':
                                output.querySelectorAll('.assistant-output').forEach((element) => element.remove());
                                contentEl.className = 'assistant-output';
                                contentEl.style.cssText = 'color: #c9d1d9;';
                                contentEl.textContent = data.content;
                                break;
                            case 'message':
                            default:
                                contentEl.className = 'assistant-output';
                                contentEl.style.cssText = 'color: #c9d1d9;';
                                contentEl.textContent = data.content;
                                break;""",
    ),
    (
        "failure status color",
        """        .done-indicator {
            color: #8b949e;
            font-style: italic;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid #30363d;
        }""",
        """        .done-indicator {
            color: #8b949e;
            font-style: italic;
            margin-top: 16px;
            padding-top: 12px;
            border-top: 1px solid #30363d;
        }
        .done-indicator.failed {
            color: #f85149;
        }""",
    ),
    (
        "real completion status",
        """                        const doneEl = document.createElement('div');
                        doneEl.className = 'done-indicator';
                        doneEl.textContent = '✓ 完成 (3秒后自动关闭)';""",
        """                        const exitCode = Number(data.exit_code ?? 0);
                        const ok = exitCode === 0;
                        const autoClose = Number(data.auto_close_browser_seconds ?? 3);
                        const doneEl = document.createElement('div');
                        doneEl.className = ok ? 'done-indicator' : 'done-indicator failed';
                        doneEl.textContent = ok
                            ? (autoClose > 0
                                ? `✓ 完成 (${autoClose}秒后自动关闭)`
                                : '✓ 完成 (可以关闭此页面)')
                            : `✗ 失败 (exit code ${exitCode})`;""",
    ),
    (
        "successful notification only",
        """                        if (Notification.permission === 'granted') {
                            new Notification('任务完成', { body: '代码生成已完成' });
                        }""",
        """                        if (ok && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                            new Notification('任务完成', { body: '代码生成已完成' });
                        }""",
    ),
    (
        "configurable successful close",
        """                        // Auto-close window after 3 seconds
                        setTimeout(() => {
                            window.close();
                            // If window.close() fails (user-opened window), show message
                            setTimeout(() => {
                                doneEl.textContent = '✓ 完成 (可以关闭此页面)';
                            }, 100);
                        }, 3000);""",
        """                        // Only successful runs may close automatically.
                        if (ok && autoClose > 0) {
                            setTimeout(() => {
                                window.close();
                                // If window.close() fails (user-opened window), show message
                                setTimeout(() => {
                                    doneEl.textContent = '✓ 完成 (可以关闭此页面)';
                                }, 100);
                            }, autoClose * 1000);
                        }""",
    ),
)


def render_live_output_html() -> str:
    try:
        html = PREVIEW_TEMPLATE_PATH.read_text(encoding="utf-8")
    except OSError as error:
        raise RuntimeError(
            f"Unable to load upstream Live Output template: {PREVIEW_TEMPLATE_PATH}"
        ) from error

    if html.count(SAFE_TASK_RENDERING) != 1:
        raise RuntimeError(
            "Upstream Live Output template patch drift for safe task rendering: "
            f"expected 1 anchor, found {html.count(SAFE_TASK_RENDERING)}"
        )

    for label, anchor, replacement in PREVIEW_PATCHES:
        count = html.count(anchor)
        if count != 1:
            raise RuntimeError(
                f"Upstream Live Output template patch drift for {label}: "
                f"expected 1 anchor, found {count}"
            )
        html = html.replace(anchor, replacement, 1)
    return html


def make_handler() -> type[BaseHTTPRequestHandler]:
    preview_html = render_live_output_html()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt: str, *args: object) -> None:
            return

        def do_GET(self) -> None:  # noqa: N802
            if self.path == "/" or self.path.startswith("/?"):
                body = self.index_html().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if self.path.startswith("/state"):
                body = json.dumps(STATE.snapshot(), ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if self.path == "/api/sessions" or self.path.startswith("/api/sessions?"):
                body = json.dumps(STATE.sessions(), ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            if self.path.startswith("/api/stream/"):
                session_id = self.path[len("/api/stream/") :].split("?", 1)[0]
                self.stream_session(session_id)
                return

            self.send_response(404)
            self.end_headers()

        def stream_session(self, session_id: str) -> None:
            try:
                last_event_id = int(self.headers.get("Last-Event-ID", "0"))
            except ValueError:
                last_event_id = 0
            try:
                client, done, _ = STATE.register_client(session_id, last_event_id)
            except KeyError:
                self.send_response(404)
                self.end_headers()
                return

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            def send_event(event: dict[str, object]) -> bool:
                try:
                    event_id = int(event.get("_event_id", 0))
                    public_event = {
                        key: value for key, value in event.items() if not key.startswith("_")
                    }
                    data = json.dumps(public_event, ensure_ascii=False).encode("utf-8")
                    if event_id:
                        self.wfile.write(f"id: {event_id}\n".encode("ascii"))
                    self.wfile.write(b"data: " + data + b"\n\n")
                    self.wfile.flush()
                    return True
                except (ConnectionError, OSError):
                    return False

            try:
                if done and client.empty():
                    return
                while True:
                    try:
                        event = client.get(timeout=15)
                    except queue.Empty:
                        try:
                            self.wfile.write(b": keepalive\n\n")
                            self.wfile.flush()
                            continue
                        except (ConnectionError, OSError):
                            return
                    if not send_event(event):
                        return
                    if event.get("done"):
                        return
            finally:
                STATE.unregister_client(client)

        @staticmethod
        def index_html() -> str:
            return preview_html

    return Handler


def start_server(open_browser: bool, port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    port = port or free_port()
    server = ThreadingHTTPServer(("127.0.0.1", port), make_handler())
    url = f"http://127.0.0.1:{port}/"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    STATE.add_event(f"Preview server started: {url}")
    print(f"CCG_GEMINI_PREVIEW_URL={url}", flush=True)
    if open_browser:
        opened = open_preview_url(url)
        print(f"CCG_GEMINI_BROWSER_OPENED={1 if opened else 0}", flush=True)
        STATE.add_event(f"Browser open attempted: {'yes' if opened else 'no'}")
    return server, url


def build_command(args: argparse.Namespace, gemini_workdir: Path) -> list[str]:
    cmd = resolve_gemini_invocation() + [
        "-m",
        args.model,
        "--approval-mode",
        args.approval_mode,
        "--output-format",
        "stream-json",
        "--skip-trust",
    ]
    workdir = str(gemini_workdir.resolve())
    if workdir:
        cmd.extend(["--include-directories", workdir])
    cmd.extend(["-p", "Read the complete task from stdin and respond with the requested output."])
    return cmd


def resolve_gemini_invocation() -> list[str]:
    for name in ("gemini.cmd", "gemini.exe", "gemini"):
        path = shutil.which(name)
        if path:
            return [path]

    ps1 = shutil.which("gemini.ps1")
    if ps1:
        return ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps1]

    raise SystemExit("ERROR: gemini CLI not found in PATH")


def extract_text_node(node: object) -> str:
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, (int, float, bool)):
        return ""
    if isinstance(node, list):
        return "".join(extract_text_node(item) for item in node)
    if isinstance(node, dict):
        text = []
        node_type = str(node.get("type", "")).lower()
        if node_type in {"text", "output_text"} and isinstance(node.get("text"), str):
            text.append(str(node.get("text", "")))
        for key in ("text", "output_text", "content", "parts", "delta"):
            if key in node:
                if key == "text" and node_type in {"text", "output_text"}:
                    continue
                text.append(extract_text_node(node.get(key)))
        return "".join(text)
    return ""


def extract_event_text(event: object) -> str:
    if not isinstance(event, dict):
        return ""

    event_type = str(event.get("type", "")).lower()
    role = str(event.get("role", "")).lower()
    if role and role not in {"assistant", "model", "gemini"}:
        return ""

    if event_type == "message":
        return "".join(
            extract_text_node(event.get(key))
            for key in ("content", "parts", "delta", "text", "output_text")
            if key in event
        )

    if event_type in {"content", "delta", "chunk", "text", "output_text", "response"}:
        return "".join(
            extract_text_node(event.get(key))
            for key in ("content", "parts", "delta", "text", "output_text")
            if key in event
        ) or extract_text_node(event)

    if event_type == "result":
        return "".join(
            extract_text_node(event.get(key))
            for key in ("content", "parts", "response", "text", "output_text")
            if key in event
        )

    return ""


def safe_status_label(value: object, fallback: str) -> str:
    if not isinstance(value, str):
        return fallback
    text = " ".join(value.split())
    return (text[:120] if text else fallback)


def validated_gemini_exit_code(process_code: int, result_seen: bool, result_status: str) -> int:
    if process_code != 0:
        return process_code
    if not result_seen or result_status.lower() not in {"success", "complete"}:
        return 1
    return 0


def stream_output(pipe, output_file, is_stderr: bool = False) -> None:
    assistant_text = ""
    for line in pipe:
        if not line:
            continue
        STATE.append_raw(line)
        output_file.write(line)
        output_file.flush()

        if is_stderr:
            continue

        raw = line.strip()
        if "{" in raw and not raw.startswith("{"):
            raw = raw[raw.find("{") :]
        try:
            event = json.loads(raw)
        except Exception:
            continue

        event_type = event.get("type", "")
        session_id = event.get("session_id") or event.get("sessionId")
        if session_id:
            STATE.update(session_id=session_id)
        event_count = STATE.increment_stream_events()
        if event_count <= 5 or event_count % 25 == 0:
            STATE.add_event(f"stream event {event_count}: {event_type or 'unknown'}")

        if event_type == "init":
            STATE.update(status="running")
            STATE.add_event("Gemini stream initialized")
            continue

        if event_type == "tool_use":
            tool_name = safe_status_label(event.get("tool_name"), "tool")
            STATE.append_content(
                f"tool started: {tool_name}", "command", response_text=False
            )
        elif event_type == "tool_result":
            status = safe_status_label(event.get("status"), "unknown")
            if status not in {"success", "error"}:
                status = "unknown"
            STATE.append_content(
                f"tool result: {status}", "command", response_text=False
            )
        elif event_type == "error":
            severity = safe_status_label(event.get("severity"), "error").lower()
            if severity not in {"warning", "error"}:
                severity = "error"
            STATE.append_content(
                f"Gemini {severity}", "reasoning", response_text=False
            )

        if event_type == "result":
            status = str(event.get("status", "")).lower()
            final_response = extract_event_text(event)
            if final_response:
                if not assistant_text:
                    STATE.append_content(final_response)
                elif final_response.startswith(assistant_text):
                    suffix = final_response[len(assistant_text) :]
                    if suffix:
                        STATE.append_content(suffix)
                elif final_response != assistant_text:
                    STATE.add_event(
                        "Gemini terminal response did not match streamed assistant text; using terminal response"
                    )
                    STATE.append_content(final_response, "replace_message")
            authoritative_response = final_response or assistant_text
            STATE.update(
                response=authoritative_response,
                result_seen=True,
                result_status=status,
                status=status or "error",
            )
            STATE.add_event(f"Gemini result status: {status or 'missing'}")
            continue

        extracted = extract_event_text(event)
        if extracted:
            assistant_text += extracted
            STATE.update(status="streaming")
            STATE.append_content(extracted)
            STATE.add_event(f"parsed assistant text chunk: {len(extracted)} chars")


def is_snapshot_ignored(name: str) -> bool:
    lower = name.lower()
    if lower in SNAPSHOT_IGNORED_NAMES:
        return True
    if lower == ".env" or lower.startswith(SNAPSHOT_IGNORED_PREFIXES):
        return True
    if lower.endswith(SNAPSHOT_IGNORED_SUFFIXES):
        return True
    if lower.startswith("service-account") and lower.endswith(".json"):
        return True
    return False


def is_snapshot_link(path: Path) -> bool:
    try:
        if path.is_symlink():
            return True
        is_junction = getattr(path, "is_junction", None)
        if is_junction and is_junction():
            return True
        if os.name == "nt":
            attrs = getattr(path.lstat(), "st_file_attributes", 0)
            reparse = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
            return bool(attrs & reparse)
        return False
    except OSError:
        return True


def normalize_relative_path(value: str) -> str:
    return value.replace("\\", "/").strip("/")


def load_pattern_file(path: Path) -> list[str]:
    if not path.exists() or not path.is_file():
        return []
    patterns = []
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line)
    return patterns


def load_snapshot_patterns(source: Path, respect_gitignore: bool) -> list[str]:
    patterns = load_pattern_file(source / ".ccgignore")
    if respect_gitignore:
        patterns.extend(load_pattern_file(source / ".gitignore"))
    return patterns


def pattern_matches(pattern: str, rel_path: str, name: str, is_dir: bool) -> bool:
    directory_only = pattern.strip().endswith("/")
    normalized = normalize_relative_path(pattern)
    if not normalized:
        return False
    if directory_only:
        if not is_dir:
            return False
    if normalized.startswith("/"):
        normalized = normalized.lstrip("/")

    candidates = {rel_path, name}
    if fnmatch.fnmatch(rel_path, normalized) or fnmatch.fnmatch(name, normalized):
        return True
    if "/" in normalized:
        return rel_path == normalized or rel_path.startswith(normalized + "/")
    return normalized in candidates


def is_user_ignored(patterns: list[str], rel_path: str, name: str, is_dir: bool) -> bool:
    return any(pattern_matches(pattern, rel_path, name, is_dir) for pattern in patterns)


def load_include_paths(files_from: str, source: Path) -> set[str]:
    if not files_from:
        return set()
    include_file = resolve_cli_file(files_from)
    includes = set()
    for raw in include_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        candidate = Path(line)
        if candidate.is_absolute():
            try:
                line = str(candidate.resolve().relative_to(source.resolve()))
            except ValueError:
                continue
        includes.add(normalize_relative_path(line))
    return includes


def is_included_by_files_from(rel_path: str, includes: set[str], is_dir: bool) -> bool:
    if not includes:
        return True
    if rel_path in includes:
        return True
    for include in includes:
        if rel_path.startswith(include + "/"):
            return True
        if is_dir and include.startswith(rel_path + "/"):
            return True
    return False


def copy_snapshot_tree(source: Path, target: Path, args: argparse.Namespace) -> dict[str, object]:
    patterns = load_snapshot_patterns(source, bool(getattr(args, "respect_gitignore", False)))
    includes = load_include_paths(str(getattr(args, "files_from", "") or ""), source)
    max_bytes = max(0, int(getattr(args, "max_snapshot_bytes", 0) or 0))
    max_files = max(0, int(getattr(args, "max_snapshot_files", 0) or 0))
    stats: dict[str, object] = {
        "files": 0,
        "dirs": 0,
        "bytes": 0,
        "skipped_secret_or_link": 0,
        "skipped_user_ignore": 0,
        "skipped_include_filter": 0,
        "skipped_cap": 0,
        "skipped_error": 0,
        "patterns": len(patterns),
        "includes": len(includes),
    }

    def bump(key: str, amount: int = 1) -> None:
        stats[key] = int(stats.get(key, 0)) + amount

    def copy_dir(src: Path, dst: Path, rel: str = "") -> None:
        try:
            entries = sorted(src.iterdir(), key=lambda item: item.name.lower())
        except OSError:
            bump("skipped_error")
            return

        dst.mkdir(parents=True, exist_ok=True)
        bump("dirs")
        for entry in entries:
            entry_rel = normalize_relative_path(f"{rel}/{entry.name}" if rel else entry.name)
            is_dir = entry.is_dir() and not is_snapshot_link(entry)

            if is_snapshot_ignored(entry.name) or is_snapshot_link(entry):
                bump("skipped_secret_or_link")
                continue
            if not is_included_by_files_from(entry_rel, includes, is_dir):
                bump("skipped_include_filter")
                continue
            if is_user_ignored(patterns, entry_rel, entry.name, is_dir):
                bump("skipped_user_ignore")
                continue

            if is_dir:
                copy_dir(entry, dst / entry.name, entry_rel)
                continue
            if not entry.is_file():
                bump("skipped_error")
                continue

            try:
                size = entry.stat().st_size
            except OSError:
                bump("skipped_error")
                continue
            if max_files and int(stats["files"]) + 1 > max_files:
                bump("skipped_cap")
                continue
            if max_bytes and int(stats["bytes"]) + size > max_bytes:
                bump("skipped_cap")
                continue

            try:
                target_file = dst / entry.name
                target_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(entry, target_file)
                bump("files")
                bump("bytes", int(size))
            except OSError:
                bump("skipped_error")

    copy_dir(source, target)
    return stats


def snapshot_ignore(directory: str, names: list[str]) -> set[str]:
    ignored = set()
    base = Path(directory)
    for name in names:
        if is_snapshot_ignored(name) or is_snapshot_link(base / name):
            ignored.add(name)
    return ignored


def prepare_gemini_workdir(args: argparse.Namespace) -> tuple[Path, tempfile.TemporaryDirectory[str] | None]:
    source = resolve_cli_file(args.workdir)
    if args.direct_workdir:
        STATE.add_event(f"Using direct workdir: {source}")
        return source, None

    temp_dir = tempfile.TemporaryDirectory(prefix="ccg-gemini-snapshot-")
    snapshot_path = Path(temp_dir.name) / source.name
    STATE.update(status="snapshotting")
    STATE.add_event(f"Creating Gemini snapshot from {source}")
    stats = copy_snapshot_tree(source, snapshot_path, args)
    print(f"CCG_GEMINI_SNAPSHOT_PATH={snapshot_path}", flush=True)
    print(f"CCG_GEMINI_SNAPSHOT_EXCLUDES={SNAPSHOT_EXCLUDE_SUMMARY}", flush=True)
    print(f"CCG_GEMINI_SNAPSHOT_FILES={stats['files']}", flush=True)
    print(f"CCG_GEMINI_SNAPSHOT_BYTES={stats['bytes']}", flush=True)
    print(
        "CCG_GEMINI_SNAPSHOT_SKIPPED="
        f"secret_or_link:{stats['skipped_secret_or_link']},"
        f"user_ignore:{stats['skipped_user_ignore']},"
        f"include_filter:{stats['skipped_include_filter']},"
        f"cap:{stats['skipped_cap']},"
        f"error:{stats['skipped_error']}",
        flush=True,
    )
    STATE.update(
        snapshot_path=str(snapshot_path),
        snapshot_excludes=SNAPSHOT_EXCLUDE_SUMMARY,
        status="snapshot-ready",
    )
    STATE.add_event(
        f"Snapshot ready: {stats['files']} files, {stats['bytes']} bytes, "
        f"skipped cap={stats['skipped_cap']}"
    )
    STATE.update(status="snapshot-ready")
    return snapshot_path, temp_dir


def cleanup_snapshot(temp_dir: tempfile.TemporaryDirectory[str]) -> None:
    for attempt in range(5):
        try:
            temp_dir.cleanup()
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.25 * (attempt + 1))


def build_prompt_for_gemini(args: argparse.Namespace, prompt: str, gemini_workdir: Path) -> str:
    if args.direct_workdir:
        return prompt

    original = resolve_cli_file(args.workdir)
    return (
        "You are running inside a disposable read-only-style snapshot of the user's workspace.\n"
        f"Snapshot path: {gemini_workdir}\n"
        f"Original workspace path, for reference only: {original}\n"
        "Do not attempt to modify files. Provide analysis, review findings, "
        "test ideas, or unified diffs in your response.\n"
        "Codex will inspect your output and apply any final changes itself.\n\n"
        f"{prompt}"
    )


def run_gemini(args: argparse.Namespace, prompt: str, output_path: Path, gemini_workdir: Path) -> int:
    cmd = build_command(args, gemini_workdir)
    env = os.environ.copy()
    env.setdefault("GOOGLE_CLOUD_LOCATION", "global")
    STATE.update(model=args.model, status="starting")
    STATE.add_event(f"Launching Gemini model {args.model}")

    with output_path.open("w", encoding="utf-8", errors="replace") as out:
        out.write(f"$ {' '.join(cmd)}\n\n")
        STATE.add_event("Gemini process started")
        proc = subprocess.Popen(
            cmd,
            cwd=str(gemini_workdir.resolve()),
            env=env,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        assert proc.stdin is not None
        assert proc.stdout is not None
        assert proc.stderr is not None

        stdout_thread = threading.Thread(
            target=stream_output,
            args=(proc.stdout, out, False),
            daemon=True,
        )
        stderr_thread = threading.Thread(
            target=stream_output,
            args=(proc.stderr, out, True),
            daemon=True,
        )
        stdout_thread.start()
        stderr_thread.start()

        proc.stdin.write(prompt)
        proc.stdin.close()
        STATE.add_event("Prompt sent to Gemini stdin")
        code = proc.wait()
        stdout_thread.join(timeout=2)
        stderr_thread.join(timeout=2)
        STATE.add_event(f"Gemini process exited with code {code}")
        snapshot = STATE.snapshot()
        validated_code = validated_gemini_exit_code(
            int(code),
            bool(snapshot.get("result_seen")),
            str(snapshot.get("result_status", "")),
        )
        if validated_code != int(code):
            STATE.add_event("Gemini stream missing a successful terminal result")
        return validated_code


def main() -> int:
    configure_utf8_stdio()
    args = parse_args()
    raw_prompt = get_prompt(args)
    prompt_preview = raw_prompt[:1200] + ("..." if len(raw_prompt) > 1200 else "")
    STATE.update(model=args.model, prompt_preview=prompt_preview)
    auto_close = 0 if args.no_auto_close_browser else max(0, args.auto_close_browser_seconds)
    STATE.update(auto_close_browser_seconds=auto_close)

    output_path = resolve_cli_file(args.output_file) if args.output_file else default_output_file()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    response_path = output_path.with_suffix(".response.txt")
    STATE.update(output_file=str(output_path), response_file=str(response_path))
    STATE.add_event(f"Output file: {output_path}")
    STATE.add_event(f"Response file: {response_path}")
    if args.detach:
        return detach(args, raw_prompt, output_path)

    prompt = apply_prompt_template(args, raw_prompt)

    print(f"CCG_GEMINI_OUTPUT_FILE={output_path}", flush=True)
    print(f"CCG_GEMINI_PROMPT_TEMPLATE={args.prompt_template}", flush=True)
    print(f"CCG_GEMINI_AUTO_CLOSE_BROWSER_SECONDS={auto_close}", flush=True)

    server, _ = start_server(open_browser=not args.no_browser, port=args.preview_port)
    temp_dir: tempfile.TemporaryDirectory[str] | None = None
    try:
        gemini_workdir, temp_dir = prepare_gemini_workdir(args)
        gemini_prompt = build_prompt_for_gemini(args, prompt, gemini_workdir)
        code = run_gemini(args, gemini_prompt, output_path, gemini_workdir)
        STATE.update(status="writing-response")
        STATE.add_event("Writing parsed Gemini response file")
        response = str(STATE.snapshot().get("response", ""))
        response_path.write_text(response, encoding="utf-8", errors="replace")
        STATE.add_event(f"Response file written: {response_path}")
        STATE.complete(code, "complete" if code == 0 else "failed")
        close_event = "Preview will auto-close after completion" if auto_close > 0 else "Preview auto-close disabled"
        STATE.add_event(close_event)
        print(f"CCG_GEMINI_RESPONSE_FILE={response_path}", flush=True)
        print(f"CCG_GEMINI_EXIT_CODE={code}", flush=True)
        print("CCG_GEMINI_RESPONSE_BEGIN", flush=True)
        print(response, flush=True)
        print("CCG_GEMINI_RESPONSE_END", flush=True)
        time.sleep(effective_hold_seconds(args))
        return code
    finally:
        server.shutdown()
        if temp_dir is not None:
            cleanup_snapshot(temp_dir)


if __name__ == "__main__":
    raise SystemExit(main())
