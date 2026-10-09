#!/usr/bin/env python3
"""Claude-only host adapter. Browser code lives in the private, pinned transport.

Local commands do not call a model. run-root/upload are explicit external actions.
No CCG/Harness lifecycle state, global configuration, auth, or hooks are changed.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import ctypes
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
import zipfile
from pathlib import PurePosixPath
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "scripts" / "vendor"
NAME = "ccg-gptpro-bridge"
UUID_RE = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
URL_RE = re.compile(r"https://chatgpt\.com/c/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\Z")
SECRET_RE = re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{24,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b")
MAX_RESPONSE = 2 * 1024 * 1024
LAUNCHER = "ccg-gptpro-claude.exe"


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def utc() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_id(value: str) -> str:
    if not UUID_RE.fullmatch(value):
        raise ValueError("Claude session ID must be the canonical UUID substituted by Claude Code; never invent a Codex thread.")
    return value


def transport_id(value: str) -> str:
    value = session_id(value)
    h = sha(("ccg-gptpro-bridge/claude/" + value).encode())
    return f"{h[:8]}-{h[8:12]}-8{h[13:16]}-8{h[17:20]}-{h[20:32]}"


def atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".bridge-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def write_json(path: Path, data: dict) -> None:
    atomic(path, (json.dumps(data, indent=2, ensure_ascii=False) + "\n").encode())


def read_json(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > MAX_RESPONSE:
        raise ValueError(f"Missing, linked, or oversized JSON: {path.name}")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError(f"Expected JSON object: {path.name}")
    return data


@contextlib.contextmanager
def lock(directory: Path):
    path = directory / ".claude-bridge.lock"
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        path.unlink()


def identity(data: dict, sid: str) -> None:
    expected = {"hostKind": "claude", "hostSessionId": session_id(sid), "transportThreadId": transport_id(sid), "legacyTransportThreadField": "codexThreadId"}
    for name, value in expected.items():
        if data.get(name) != value:
            raise ValueError(f"Host/session/transport mismatch: {name}")
    if "codexThreadId" in data and data["codexThreadId"] != expected["transportThreadId"]:
        raise ValueError("Legacy protocol UUID does not match the real Claude host binding.")


def target(value: dict, url: str | None = None) -> dict:
    if not isinstance(value, dict):
        raise ValueError("Exact target binding is required.")
    result = {}
    for key in ("browserId", "profileId", "tabId", "sessionKey"):
        v = value.get(key)
        if not isinstance(v, str) or not v or len(v) > 512 or any(c in v for c in "\r\n"):
            raise ValueError(f"Invalid target identity: {key}")
        result[key] = v
    if value.get("origin") != "https://chatgpt.com":
        raise ValueError("Target origin must be canonical ChatGPT.")
    actual = value.get("url")
    if actual != "https://chatgpt.com/" and (not isinstance(actual, str) or not URL_RE.fullmatch(actual)):
        raise ValueError("Target URL must be canonical homepage or an exact conversation UUID.")
    if url is not None and actual != url:
        raise ValueError("Target URL does not match the exact conversation.")
    return {**result, "origin": value["origin"], "url": actual}


def ordinary_file(path: Path, limit: int = MAX_RESPONSE) -> bytes:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > limit:
        raise ValueError(f"Missing, linked, or oversized artifact: {path.name}")
    return path.read_bytes()


def artifact(directory: Path, value: str, basename: str) -> Path:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Missing artifact reference: {basename}")
    path = Path(value)
    candidate = path if path.is_absolute() else directory / path
    if candidate.resolve() != directory / basename:
        raise ValueError(f"Artifact escapes its exact round: {basename}")
    ordinary_file(candidate)
    return candidate


def bridge_round(path: Path, sid: str) -> tuple[Path, dict]:
    directory = path.resolve()
    manifest = read_json(directory / "claude-round.json")
    identity(manifest, sid)
    workdir = Path(manifest["workdir"]).resolve()
    expected = workdir / ".ccg" / "gptpro-bridge" / "claude" / sid / manifest["roundId"]
    if not UUID_RE.fullmatch(manifest["roundId"]) or expected != directory:
        raise ValueError("Round path does not match its canonical local project/session/round.")
    if manifest.get("schemaVersion") != 1 or manifest.get("automaticResendAllowed") is not False:
        raise ValueError("Invalid round schema or no-resend boundary.")
    if sha(ordinary_file(directory / "prompt.md")) != manifest["promptSha256"]:
        raise ValueError("Prepared prompt changed.")
    return directory, manifest


def contained_path(base: Path, path: Path) -> None:
    if not path.is_relative_to(base) or path.resolve() != path:
        raise ValueError('Bridge path must be the exact contained project path; links are not allowed.')
    for component in (path, *path.parents):
        if linked(component):
            raise ValueError('Bridge path contains a link or reparse point.')
        if component == base:
            break


def prepare(workdir: Path, sid: str, prompt_path: Path, mode: str, binding: dict | None = None) -> dict:
    sid = session_id(sid)
    workdir = workdir.resolve(strict=True)
    prompt = ordinary_file(prompt_path, 96000).decode("utf-8-sig").strip()
    if not prompt or len(prompt) > 23000 or SECRET_RE.search(prompt):
        raise ValueError("Prompt must be bounded, nonempty, UTF-8, and free of recognized credentials.")
    if mode not in {"plan", "review", "exc"}:
        raise ValueError("Unknown bridge mode.")
    text = (f"# Original Claude CCG: GPT Pro {mode} evidence\n\n"
            "You are an untrusted, read-only adviser. Claude Code remains the local workspace writer and final verifier. "
            "You cannot read local paths unless their bounded contents were explicitly included or attached. "
            "Do not authorize model calls, permissions, execution, commits, deployment, or changes to the user's CCG workflow. "
            "State missing evidence and separate recommendations from verified facts.\n\n" + prompt + "\n")
    if len(text) > 24000:
        raise ValueError("Composed prompt exceeds the existing transport bound.")
    rid = str(uuid.uuid4())
    directory = workdir / ".ccg" / "gptpro-bridge" / "claude" / sid / rid
    contained_path(workdir, directory)
    directory.mkdir(parents=True, exist_ok=False)
    contained_path(workdir, directory)
    atomic(directory / "prompt.md", text.encode())
    manifest = {"schemaVersion": 1, "hostKind": "claude", "hostSessionId": sid,
                "transportThreadId": transport_id(sid), "legacyTransportThreadField": "codexThreadId",
                "roundId": rid, "mode": mode, "workdir": str(workdir), "promptSha256": sha(text.encode()),
                "idempotencyKey": f"claude.{sid}.{rid}", "automaticResendAllowed": False,
                "externalOutputIsUntrusted": True, "claudeIsSoleWorkspaceWriter": True,
                "createdAtUtc": utc(), "requestState": "prepared"}
    if binding is not None:
        manifest["targetBinding"] = target(binding)
    write_json(directory / "claude-round.json", manifest)
    return {"roundDirectory": str(directory), **manifest}


def powershell(script: str, sid: str, args: list[str], timeout: int | None = None) -> subprocess.CompletedProcess:
    if os.name != "nt":
        raise ValueError("This transport snapshot requires Windows PowerShell; other hosts are not verified.")
    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-File", str(VENDOR / script), *args,
               "-HostKind", "claude", "-HostSessionId", session_id(sid), "-CodexThreadId", transport_id(sid)]
    return subprocess.run(command, capture_output=True, text=True, encoding="utf-8-sig", timeout=timeout, check=False)


def parsed_process(result: subprocess.CompletedProcess) -> dict:
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    try:
        payload = json.loads(lines[-1])
    except (ValueError, IndexError) as exc:
        raise ValueError("Transport returned no structured terminal result; preserve evidence and do not resend.") from exc
    if not isinstance(payload, dict):
        raise ValueError("Transport returned an invalid result.")
    return {"exitCode": result.returncode, "result": payload}


def binding_arguments(binding: dict) -> list[str]:
    b = target(binding)
    return ["-BrowserId", b["browserId"], "-Profile", b["profileId"], "-TabId", b["tabId"], "-SessionKey", b["sessionKey"]]


def seal_attachments(directory: Path, manifest: dict, path: Path, receipt_path: Path | None = None) -> dict:
    raw = ordinary_file(path, 65536)
    source = read_json(path)
    b = target(source.get("targetBinding"), "https://chatgpt.com/")
    if b != target(manifest.get("targetBinding")):
        raise ValueError("Attachment manifest belongs to another exact target.")
    files = source.get("files")
    if source.get("schemaVersion") != 1 or not isinstance(files, list) or not 1 <= len(files) <= 6:
        raise ValueError("A schema-v1 explicit ZIP manifest is required.")
    names = set()
    total = 0
    for item in files:
        p = Path(item["path"])
        data = ordinary_file(p, 1048576)
        if not p.is_absolute() or p.suffix.lower() != ".zip" or p.name != item["filename"] or p.name.lower() in names:
            raise ValueError("Attachments must have distinct exact ordinary ZIP basenames and absolute paths.")
        names.add(p.name.lower())
        total += len(data)
        if not data or total > 4194304 or item.get("sizeBytes") != len(data) or item.get("sha256") != sha(data):
            raise ValueError("Attachment bytes do not match the explicit bounded manifest.")
        with zipfile.ZipFile(p) as archive:
            expanded = 0
            for entry in archive.infolist():
                name = entry.filename.replace("\\", "/")
                expanded += entry.file_size
                if name.startswith("/") or ".." in name.split("/") or re.match(r"^[A-Za-z]:", name) or expanded > 8388608:
                    raise ValueError("Unsafe or oversized ZIP contents.")
                if SECRET_RE.search(archive.read(entry).decode("utf-8", errors="replace")):
                    raise ValueError("Attachment credential pattern found; no upload may start.")
    record = {"manifestFile": str(path.resolve()), "manifestSha256": sha(raw), "fileCount": len(files), "targetBinding": b}
    previous = manifest.get("attachments")
    if previous and previous["manifestSha256"] != record["manifestSha256"]:
        raise ValueError("The original attachment manifest cannot change.")
    if receipt_path is not None:
        receipt = read_json(receipt_path)
        if receipt.get("schemaVersion") != 1 or receipt.get("ready") is not True or receipt.get("messageSubmitted") is not False:
            raise ValueError("Completed unsent attachment receipt is required.")
        if receipt.get("manifestSha256") != record["manifestSha256"] or target(receipt.get("targetBinding")) != b:
            raise ValueError("Attachment receipt manifest/target mismatch.")
        rows = receipt.get("files")
        proof = receipt.get("stabilityProof") or {}
        if not isinstance(rows, list) or len(rows) != len(files) or proof.get("schemaVersion") != 1 or proof.get("intervalMilliseconds", 0) < 500 or not proof.get("cardSetSignature"):
            raise ValueError("Attachment set lacks its original stable receipt.")
        for source_file, row in zip(files, rows):
            if row.get("filename") != source_file["filename"] or row.get("phase") != "ready" or not row.get("cardSignature") or row.get("sha256") != source_file["sha256"] or row.get("sizeBytes") != source_file["sizeBytes"]:
                raise ValueError("Attachment receipt does not contain the exact ready ZIP set.")
        record.update(receiptFile=str(receipt_path.resolve()), receiptSha256=sha(ordinary_file(receipt_path)))
        if previous and previous.get("receiptSha256") and previous["receiptSha256"] != record["receiptSha256"]:
            raise ValueError("The original attachment receipt cannot change.")
    return record


def upload(path: Path, sid: str, attachment_manifest: Path, observe_only: bool = False) -> dict:
    directory, manifest = bridge_round(path, sid)
    with lock(directory):
        directory, manifest = bridge_round(path, sid)
        if manifest["requestState"] != "prepared":
            raise ValueError("Uploads cannot mutate a started or completed round.")
        manifest["attachments"] = seal_attachments(directory, manifest, attachment_manifest)
        write_json(directory / "claude-round.json", manifest)
        args = ["upload-status" if observe_only else "upload", "-EvidenceDir", str(directory / "upload"),
                "-AttachmentManifestPath", str(attachment_manifest.resolve()), *binding_arguments(manifest["targetBinding"])]
        result = parsed_process(powershell("chatgpt-pro-sidebar.ps1", sid, args))
        write_json(directory / "upload-result.json", result)
        receipt = directory / "upload" / "attachment-receipt.json"
        if result["exitCode"] == 0 and receipt.is_file():
            manifest["attachments"] = seal_attachments(directory, manifest, attachment_manifest, receipt)
            write_json(directory / "claude-round.json", manifest)
        return result


def run_root(path: Path, sid: str, timeout: int = 7200) -> dict:
    directory, manifest = bridge_round(path, sid)
    with lock(directory):
        directory, manifest = bridge_round(path, sid)
        if manifest["requestState"] != "prepared":
            raise ValueError("A logical request may start once. Diagnose/import its original evidence; never resend.")
        binding = target(manifest.get("targetBinding"), "https://chatgpt.com/")
        args = ["run-root", "-PromptPath", str(directory / "prompt.md"), "-EvidenceDir", str(directory / "sidebar"),
                "-IdempotencyKey", manifest["idempotencyKey"], "-FreshConversation", "-TimeoutSeconds", str(timeout),
                *binding_arguments(binding)]
        attachments = manifest.get("attachments")
        if attachments:
            checked = seal_attachments(directory, manifest, Path(attachments["manifestFile"]), Path(attachments["receiptFile"]))
            if checked != attachments:
                raise ValueError("Attachment seal drift.")
            args += ["-AttachmentManifestPath", checked["manifestFile"], "-AttachmentReceiptPath", checked["receiptFile"]]
        # Persist before invoking the transport. Even a lost launch/result never permits caller resend.
        manifest.update(requestState="started", startedAtUtc=utc())
        write_json(directory / "claude-round.json", manifest)
        result = parsed_process(powershell("chatgpt-pro-sidebar-watch.ps1", sid, args))
        write_json(directory / "run-root-result.json", result)
        return result


def import_response(path: Path, sid: str) -> dict:
    directory, manifest = bridge_round(path, sid)
    with lock(directory):
        directory, manifest = bridge_round(path, sid)
        evidence_dir = directory / "sidebar"
        state = read_json(evidence_dir / "state.json")
        evidence = read_json(evidence_dir / "evidence.json")
        event = read_json(evidence_dir / "watch-event.json")
        watch = read_json(evidence_dir / "watch-state.json")
        for record in (state, evidence, event, watch):
            identity(record, sid)
        if manifest["requestState"] != "started" or state.get("phase") != "completed" or event.get("status") != "completed":
            raise ValueError("Only the original started round and completed watcher can be imported.")
        for record in (state, event):
            if record.get("terminalOutcome", "completed") != "completed" or record.get("automaticResendAllowed") is not False:
                raise ValueError("Terminal outcome is not completed/no-resend.")
        if event.get("requiresHostReview") is not True or event.get("requiresCodexReview") is not False:
            raise ValueError("Claude host review boundary is required; Codex ownership is invalid.")
        if event.get("watcherId") != watch.get("watcherId") or not UUID_RE.fullmatch(str(event.get("watcherId", ""))):
            raise ValueError("Watcher identity mismatch.")
        if watch.get("rootWait") is not True or watch.get("noWake") is not True or watch.get("agentMonitor") is not False:
            raise ValueError("Only local RootWait evidence without model/hook continuation is accepted.")
        if Path(event.get("evidenceDirectory", "")).resolve() != evidence_dir:
            raise ValueError("Watcher evidence directory mismatch.")
        for record in (state, evidence):
            if record.get("live") is not True or record.get("transport") != "agent-browser-cli-v2":
                raise ValueError("A live approved transport result is required; fixtures do not prove real execution.")
        if event.get("transport") != "agent-browser-cli-v2":
            raise ValueError("Watcher transport mismatch.")
        authority = evidence.get("authority") or {}
        if authority != {"externalOutputIsUntrusted": True, "workspaceOwnerHost": "claude", "workspaceOwnerSessionId": sid,
                         "codexIsSoleWorkspaceWriter": False, "claudeIsSoleWorkspaceWriter": True}:
            raise ValueError("Evidence must honestly record Claude workspace ownership.")
        entries = {"prompt.md": evidence.get("prompt") or {}, "response.md": evidence.get("response") or {}, "url.txt": evidence.get("conversation") or {}}
        state_fields = {"prompt.md": ("promptFile", "promptSha256"), "response.md": ("responseFile", "responseSha256"), "url.txt": ("urlFile", "urlSha256")}
        for name, entry in entries.items():
            file_key, hash_key = state_fields[name]
            raw = ordinary_file(artifact(evidence_dir, state.get(file_key), name))
            artifact(evidence_dir, entry.get("file"), name)
            if sha(raw) != state.get(hash_key) or sha(raw) != entry.get("sha256"):
                raise ValueError(f"Artifact hash mismatch: {name}")
        artifact(evidence_dir, state.get("evidenceFile"), "evidence.json")
        if state.get("evidenceSha256") != sha(ordinary_file(evidence_dir / "evidence.json")):
            raise ValueError("Raw evidence hash mismatch.")
        if entries["prompt.md"]["sha256"] != manifest["promptSha256"] or watch.get("promptSha256") != manifest["promptSha256"]:
            raise ValueError("Prompt does not bind this prepared round.")
        response = ordinary_file(evidence_dir / "response.md")
        if not response.decode("utf-8").strip():
            raise ValueError("Response is empty or invalid UTF-8.")
        url = ordinary_file(evidence_dir / "url.txt").decode().strip()
        if not URL_RE.fullmatch(url):
            raise ValueError("An exact canonical conversation URL is required.")
        conversation = entries["url.txt"]
        if conversation.get("url") != url or conversation.get("boundAtSend") != url or conversation.get("exact") is not True or conversation.get("matchedBoundUrl") is not True:
            raise ValueError("Exact conversation binding mismatch.")
        if any(record.get(field) != url for record, field in ((state,"conversationUrl"),(state,"conversationUrlBound"),(event,"conversationUrl"))):
            raise ValueError("Conversation drift in state or watcher.")
        bindings = [target(state.get("targetBinding"), url), target((evidence.get("extractor") or {}).get("targetBinding"), url), target(event.get("targetBinding"), url), target(watch.get("targetBinding"), url)]
        if any(b != bindings[0] for b in bindings):
            raise ValueError("Browser/profile/tab/session bindings differ.")
        start_target = target(manifest.get("targetBinding"))
        if any(bindings[0][k] != start_target[k] for k in ("browserId","profileId","tabId","sessionKey")):
            raise ValueError("Response belongs to another prepared browser target.")
        submission = evidence.get("submission") or {}
        if submission.get("automaticResendAllowed") is not False or not (submission.get("acknowledged") is True or submission.get("observationalRecovery") is True):
            raise ValueError("No-resend submission acknowledgement or observational recovery is required.")
        attachments = manifest.get("attachments")
        if attachments:
            checked = seal_attachments(directory, manifest, Path(attachments["manifestFile"]), Path(attachments["receiptFile"]))
            if checked != attachments or state.get("attachmentManifestSha256") != attachments["manifestSha256"] or state.get("attachmentReceiptSha256") != attachments["receiptSha256"]:
                raise ValueError("Attachment hashes do not bind the original send.")
            if evidence.get("attachments") != {"manifestSha256": attachments["manifestSha256"], "receiptSha256": attachments["receiptSha256"]}:
                raise ValueError("Raw evidence does not bind the original attachment set.")
        elif state.get("attachmentManifestSha256") or state.get("attachmentReceiptSha256"):
            raise ValueError("Unexpected attachments were not authorized in this round.")
        imported = {"schemaVersion": 1, "hostKind": "claude", "hostSessionId": sid,
                    "transportThreadId": transport_id(sid), "legacyTransportThreadField": "codexThreadId",
                    "roundId": manifest["roundId"], "conversationUrl": url, "targetBinding": bindings[0],
                    "watcherId": event["watcherId"], "responseSha256": sha(response),
                    "rawEvidenceSha256": sha(ordinary_file(evidence_dir / "evidence.json")),
                    "rawWatchEventSha256": sha(ordinary_file(evidence_dir / "watch-event.json")),
                    "automaticResendAllowed": False, "externalOutputIsUntrusted": True,
                    "claudeIsSoleWorkspaceWriter": True, "codexIsSoleWorkspaceWriter": False, "attachments": attachments,
                    "verificationScope": "completed transport evidence; host must independently review the response"}
        destination = directory / "imported-evidence.json"
        if destination.exists():
            if read_json(destination) != imported or ordinary_file(directory / "response.md") != response:
                raise ValueError("Imported content cannot be overwritten by a different response.")
            return {"imported": True, "idempotent": True, **imported}
        atomic(directory / "response.md", response)
        write_json(destination, imported)
        return {"imported": True, "idempotent": False, **imported}


def file_inventory(directory: Path, exclude_receipt: bool = False, source_files: bool = False) -> dict[str, str]:
    result = {}
    for item in directory.rglob("*"):
        if item.is_symlink() or (getattr(item.lstat(), "st_file_attributes", 0) & 0x400):
            raise ValueError("Links/reparse points are not allowed in an owned plugin directory.")
        if item.is_file():
            if item.stat().st_nlink != 1:
                raise ValueError("Hard links are not allowed in an owned plugin directory.")
            rel = item.relative_to(directory).as_posix()
            if exclude_receipt and rel == ".bridge-ownership.json":
                continue
            if source_files and ("__pycache__" in item.parts or item.suffix == ".pyc"):
                continue
            if source_files and item.relative_to(directory).parts[:2] == ("tests", "results"):
                continue
            result[rel] = sha(item.read_bytes())
    return result


def linked(path: Path) -> bool:
    return path.is_symlink() or (path.exists() and bool(getattr(path.lstat(), "st_file_attributes", 0) & 0x400))


def pinned_file(path: Path) -> dict:
    path = Path(os.path.abspath(path))
    if path.resolve(strict=True) != path or not path.is_file() or any(linked(p) for p in (path, *path.parents)):
        raise ValueError("Launcher executable must be an absolute ordinary physical file.")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return {"path": str(path), "sha256": digest.hexdigest()}


def launcher_contract(claude_executable: Path, claude_runtime: Path | None = None) -> dict:
    executable = pinned_file(claude_executable)
    if claude_runtime is not None:
        if claude_executable.suffix.lower() not in {".js", ".mjs", ".cjs"}:
            raise ValueError("An explicit runtime is only supported for a Claude JavaScript entry.")
        runtime = pinned_file(claude_runtime)
        command = [runtime["path"], executable["path"]]
        pins = [runtime, executable]
    else:
        if os.name == "nt" and claude_executable.suffix.lower() != ".exe":
            raise ValueError("Use the physical Claude executable or its JavaScript entry with an explicit Node runtime; shell shims are not supported.")
        command = [executable["path"]]
        pins = [executable]
    python = pinned_file(Path(sys.executable).resolve(strict=True))
    return {"schemaVersion": 1, "command": command, "commandFiles": pins, "python": python,
            "pluginArgument": "--plugin-dir", "shell": False, "settingsChanged": False}


def owned_install(destination: Path) -> dict | None:
    if not destination.exists():
        return None
    owned = destination / ".bridge-ownership.json"
    if not owned.is_file():
        raise ValueError("Existing plugin directory is unowned; refusing to overwrite or delete it.")
    receipt = read_json(owned)
    if receipt.get("schemaVersion") not in {1, 2} or receipt.get("owner") != NAME or receipt.get("target") != str(destination) or file_inventory(destination, True) != receipt.get("files"):
        raise ValueError("Owned plugin drift detected; preserve user changes and repair explicitly.")
    return receipt


def launch(arguments: list[str], directory: Path = ROOT) -> int:
    directory = Path(os.path.abspath(directory))
    if directory.name != NAME or directory.parent.name != "local" or directory.parents[1].name != "plugins":
        raise ValueError("Launch accepts only the installed local plugin layout.")
    with lifecycle_lock(directory.parents[2], shared=True):
        return _launch_unlocked(arguments, directory)


def _launch_unlocked(arguments: list[str], directory: Path) -> int:
    directory = Path(os.path.abspath(directory))
    if directory.resolve(strict=True) != directory or any(linked(p) for p in (directory, *directory.parents)):
        raise ValueError("Launcher plugin root changed or contains a link.")
    receipt = owned_install(directory)
    contract = receipt.get("launcher") if receipt else None
    if not isinstance(contract, dict) or contract.get("schemaVersion") != 1 or contract.get("shell") is not False:
        raise ValueError("This install has no owned launcher contract; reinstall with the physical Claude entry.")
    for pin in [*contract["commandFiles"], contract["python"]]:
        if pinned_file(Path(pin["path"])) != pin:
            raise ValueError("Launcher executable changed; review and reinstall to update its provenance.")
    if Path(sys.executable).resolve(strict=True) != Path(contract["python"]["path"]):
        raise ValueError("Launch must use the recorded Python runtime.")
    if any(not isinstance(arg, str) or "\0" in arg for arg in arguments):
        raise ValueError("Claude arguments must be ordinary argv strings.")
    result = subprocess.run([*contract["command"], "--plugin-dir", str(directory), *arguments], check=False, shell=False)
    return result.returncode


@contextlib.contextmanager
def lifecycle_lock(home: Path, shared: bool = False):
    home = home.resolve(strict=True)
    parent = home / "plugins" / "local"
    if any(linked(p) for p in (home / "plugins", parent)) or parent.resolve() != parent:
        raise ValueError("Lifecycle lock path contains a link.")
    parent.mkdir(parents=True, exist_ok=True)
    path = parent / ".ccg-gptpro-bridge-runtime.lock"
    if linked(path) or path.exists() and (not path.is_file() or path.stat().st_nlink != 1 or path.stat().st_size != 0):
        raise ValueError("Lifecycle lock must be an ordinary empty owned lock file.")
    if os.name == "nt":
        from ctypes import wintypes
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        handle = kernel.CreateFileW(str(path), 0x80000000 if shared else 0xC0000000, 1 if shared else 0, None, 4, 0x80, None)
        if handle == ctypes.c_void_p(-1).value:
            raise ValueError("Active Claude launcher or another lifecycle operation holds this install; no files changed.")
        try:
            yield
        finally:
            kernel.CloseHandle(handle)
    else:
        import fcntl
        with path.open("a+b") as stream:
            try:
                fcntl.flock(stream.fileno(), (fcntl.LOCK_SH if shared else fcntl.LOCK_EX) | fcntl.LOCK_NB)
            except OSError as error:
                raise ValueError("Another lifecycle operation holds this install.") from error
            try:
                yield
            finally:
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def lifecycle(home: Path, operation: str, source: Path = ROOT, claude_executable: Path | None = None, claude_runtime: Path | None = None,
              launcher_file: Path | None = None, launcher_sha256: str | None = None) -> dict:
    with lifecycle_lock(home):
        return _lifecycle_unlocked(home, operation, source, claude_executable, claude_runtime, launcher_file, launcher_sha256)


def _lifecycle_unlocked(home: Path, operation: str, source: Path = ROOT, claude_executable: Path | None = None, claude_runtime: Path | None = None,
                        launcher_file: Path | None = None, launcher_sha256: str | None = None) -> dict:
    home = home.resolve(strict=True)
    destination = home / "plugins" / "local" / NAME
    if destination.resolve() != home / "plugins" / "local" / NAME or any(linked(p) for p in (home / "plugins", home / "plugins" / "local", destination)):
        raise ValueError("Owned target must be the exact contained Claude local plugin directory.")
    owned = destination / ".bridge-ownership.json"
    existing = owned_install(destination)
    if operation == "uninstall" and existing is None:
        return {"operation": operation, "changed": False, "target": str(destination)}
    wanted = file_inventory(source, True, True) if operation == "install" else None
    contract = None
    native_bytes = None
    native_artifact = None
    if operation == "install":
        if claude_executable is not None:
            contract = launcher_contract(claude_executable, claude_runtime)
        elif existing and isinstance(existing.get("launcher"), dict):
            contract = existing["launcher"]
            for pin in [*contract["commandFiles"], contract["python"]]:
                if pinned_file(Path(pin["path"])) != pin:
                    raise ValueError("Launcher executable changed; provide the reviewed entry explicitly.")
        else:
            raise ValueError("Initial install requires --claude-executable with a reviewed physical Claude entry.")
        wanted.pop(LAUNCHER, None)  # Built executable is a separately pinned distribution input.
        if launcher_file is not None:
            native_bytes = ordinary_file(launcher_file, 16 * 1024 * 1024)
            if not launcher_sha256 or not re.fullmatch(r"[0-9a-f]{64}", launcher_sha256) or sha(native_bytes) != launcher_sha256 or not native_bytes.startswith(b"MZ"):
                raise ValueError("Native launcher artifact must match its explicit reviewed SHA256 and Windows PE header.")
            pinned_file(launcher_file)
            native_artifact = {"sha256": launcher_sha256, "bytes": len(native_bytes)}
        elif existing and isinstance(existing.get("launcherArtifact"), dict):
            native_artifact = existing["launcherArtifact"]
            native_bytes = ordinary_file(destination / LAUNCHER, 16 * 1024 * 1024)
            if native_artifact != {"sha256": sha(native_bytes), "bytes": len(native_bytes)}:
                raise ValueError("Owned native launcher artifact differs from its distribution receipt.")
        else:
            raise ValueError("Initial install requires --launcher-file and --launcher-sha256 for the reviewed native artifact.")
        wanted[LAUNCHER] = native_artifact["sha256"]
    if existing and wanted == existing["files"] and existing.get("launcher") == contract:
        return {"operation": operation, "changed": False, "target": str(destination), "loadArguments": ["--plugin-dir", str(destination)],
                "launcher": str(destination / LAUNCHER), "settingsChanged": False, "upstreamCcgChanged": False}
    # Read and hash-check the complete source before replacing an existing install.
    source_bytes = {rel: ordinary_file(source / rel) for rel in wanted if rel != LAUNCHER} if wanted else {}
    if wanted:
        source_bytes[LAUNCHER] = native_bytes
    if wanted and any(sha(source_bytes[rel]) != wanted[rel] for rel in wanted):
        raise ValueError("Plugin source changed while preparing installation.")
    backup = None
    before_inventory = None
    if existing:
        before_inventory = file_inventory(destination)
        if read_json(owned) != existing:
            raise ValueError("Ownership receipt changed before backup; no plugin files changed.")
        backup_dir = home / "plugins" / "local" / ".ccg-gptpro-bridge-backups"
        if linked(backup_dir) or backup_dir.resolve() != backup_dir or not backup_dir.resolve().is_relative_to(home):
            raise ValueError("Backup directory must be the exact contained ordinary Claude plugin backup directory.")
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / (str(uuid.uuid4()) + ".zip")
        if linked(backup_dir) or backup.resolve().parent != backup_dir or linked(backup):
            raise ValueError("Backup target changed before archive creation.")
        with zipfile.ZipFile(backup, "x", zipfile.ZIP_DEFLATED) as archive:
            for rel in sorted({*existing["files"], ".bridge-ownership.json"}):
                archive.write(destination / rel, rel)
        with zipfile.ZipFile(backup) as archive:
            saved_inventory = {row.filename: sha(archive.read(row)) for row in archive.infolist()}
        if saved_inventory != before_inventory:
            raise ValueError("Backup content differs from the complete owned before state; no plugin files changed.")
    # Resolve and re-check before recursive removal. No other Claude path is touched.
    if destination.exists():
        if destination.resolve() != home / "plugins" / "local" / NAME or file_inventory(destination) != before_inventory:
            raise ValueError("Target changed before removal.")
        shutil.rmtree(destination)
    if operation == "install":
        destination.mkdir(parents=True)
        for rel in sorted(wanted):
            atomic(destination / rel, source_bytes[rel])
        write_json(owned, {"schemaVersion": 2, "owner": NAME, "target": str(destination), "files": wanted, "launcher": contract, "launcherArtifact": native_artifact,
                           "sourceFilesSha256": sha(json.dumps(file_inventory(source, True, True), sort_keys=True).encode()), "installedAtUtc": utc()})
    return {"operation": operation, "changed": True, "target": str(destination), "backup": str(backup) if backup else None,
            "backupSha256": sha(backup.read_bytes()) if backup else None,
            "loadArguments": ["--plugin-dir", str(destination)] if operation == "install" else None,
            "launcher": str(destination / LAUNCHER) if operation == "install" else None,
            "settingsChanged": False, "upstreamCcgChanged": False}


def rollback(home: Path, backup: Path, expected_sha256: str) -> dict:
    with lifecycle_lock(home):
        return _rollback_unlocked(home, backup, expected_sha256)


def _rollback_unlocked(home: Path, backup: Path, expected_sha256: str) -> dict:
    home = home.resolve(strict=True)
    destination = home / "plugins" / "local" / NAME
    backup_root = home / "plugins" / "local" / ".ccg-gptpro-bridge-backups"
    backup = Path(os.path.abspath(backup))
    if backup.parent != backup_root or backup.resolve(strict=True) != backup or any(linked(p) for p in (backup, *backup.parents)):
        raise ValueError("Rollback accepts only the exact ordinary owned backup path.")
    if not re.fullmatch(r"[0-9a-f]{64}", expected_sha256) or pinned_file(backup)["sha256"] != expected_sha256:
        raise ValueError("Rollback backup hash does not match the saved lifecycle result.")
    if destination.resolve() != destination or any(linked(p) for p in (home / "plugins", home / "plugins" / "local", destination)):
        raise ValueError("Rollback target contains a link.")
    # Check all current files before any write; later user edits leave the whole install intact.
    existing = owned_install(destination)
    content = {}
    total_size = 0
    folded = set()
    with zipfile.ZipFile(backup) as archive:
        for info in archive.infolist():
            rel = PurePosixPath(info.filename)
            if rel.is_absolute() or rel.as_posix() != info.filename or any(p in {"", ".", ".."} or p.endswith((" ", ".")) or re.match(r"(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", p) for p in rel.parts) or any(c in info.filename for c in '\\:<>"|?*') or any(ord(c) < 32 for c in info.filename) or info.is_dir() or info.filename.casefold() in folded or (info.external_attr >> 16) & 0o170000 == 0o120000:
                raise ValueError("Rollback archive has an unsafe entry.")
            folded.add(info.filename.casefold())
            total_size += info.file_size
            if info.file_size > (16 * 1024 * 1024 if info.filename == LAUNCHER else MAX_RESPONSE) or len(content) >= 200 or total_size > 32 * 1024 * 1024:
                raise ValueError("Rollback archive exceeds the bounded plugin inventory.")
            content[info.filename] = archive.read(info)
    previous = json.loads(content.get(".bridge-ownership.json", b"null"))
    inventory = {rel: sha(data) for rel, data in content.items() if rel != ".bridge-ownership.json"}
    if not isinstance(previous, dict) or previous.get("schemaVersion") not in {1, 2} or previous.get("owner") != NAME or previous.get("target") != str(destination) or previous.get("files") != inventory:
        raise ValueError("Rollback archive is not the complete owned install for this exact target.")
    if existing and existing == previous:
        return {"operation": "rollback", "changed": False, "target": str(destination)}
    # Save the current valid owned state so rollback itself remains reversible.
    reverse = _lifecycle_unlocked(home, "uninstall") if existing else None
    if destination.exists():
        raise ValueError("Rollback target became occupied after validation.")
    destination.mkdir(parents=True)
    for rel, data in sorted(content.items()):
        atomic(destination / rel, data)
    if owned_install(destination) != previous:
        raise ValueError("Restored ownership verification failed; retain backup evidence.")
    return {"operation": "rollback", "changed": True, "target": str(destination), "restoredBackupSha256": expected_sha256,
            "reverseBackup": reverse.get("backup") if reverse else None, "reverseBackupSha256": reverse.get("backupSha256") if reverse else None,
            "settingsChanged": False, "upstreamCcgChanged": False, "userEditsOverwritten": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    p = commands.add_parser("prepare")
    p.add_argument("--workdir", type=Path, required=True)
    p.add_argument("--claude-session-id", required=True)
    p.add_argument("--prompt-file", type=Path, required=True)
    p.add_argument("--mode", choices=["plan","review","exc"], required=True)
    p.add_argument("--target-file", type=Path)
    for action in ("run-root","import","acknowledge","upload","upload-status"):
        p = commands.add_parser(action)
        p.add_argument("--round-dir", type=Path, required=True)
        p.add_argument("--claude-session-id", required=True)
        if action.startswith("upload"):
            p.add_argument("--attachment-manifest", type=Path, required=True)
        if action == "run-root":
            p.add_argument("--timeout-seconds", type=int, default=7200, choices=range(1,7201), metavar="1..7200")
    for action in ("status", "new-chat"):
        p = commands.add_parser(action)
        p.add_argument("--claude-session-id", required=True)
        p.add_argument("--target-file", type=Path, required=action == "new-chat")
    for action in ("install","uninstall"):
        p = commands.add_parser(action)
        p.add_argument("--claude-home", type=Path, required=True)
        if action == "install":
            p.add_argument("--claude-executable", type=Path)
            p.add_argument("--claude-runtime", type=Path)
            p.add_argument("--launcher-file", type=Path)
            p.add_argument("--launcher-sha256")
    p = commands.add_parser("rollback")
    p.add_argument("--claude-home", type=Path, required=True)
    p.add_argument("--backup", type=Path, required=True)
    p.add_argument("--backup-sha256", required=True)
    p = commands.add_parser("launch")
    p.add_argument("--arguments-json-base64")
    p.add_argument("arguments", nargs=argparse.REMAINDER)
    commands.add_parser("doctor")
    args = parser.parse_args()
    try:
        if args.command == "prepare":
            result = prepare(args.workdir, args.claude_session_id, args.prompt_file, args.mode, read_json(args.target_file) if args.target_file else None)
        elif args.command == "import":
            result = import_response(args.round_dir, args.claude_session_id)
        elif args.command == "acknowledge":
            import_response(args.round_dir, args.claude_session_id)
            result = parsed_process(powershell("chatgpt-pro-sidebar-watch.ps1", args.claude_session_id, ["acknowledge-root", "-EvidenceDir", str(args.round_dir.resolve() / "sidebar")], 60))
            write_json(args.round_dir.resolve() / "review-ack-result.json", result)
        elif args.command == "run-root":
            result = run_root(args.round_dir, args.claude_session_id, args.timeout_seconds)
        elif args.command.startswith("upload"):
            result = upload(args.round_dir, args.claude_session_id, args.attachment_manifest, args.command == "upload-status")
        elif args.command in ("status", "new-chat"):
            arguments = [args.command]
            if args.target_file:
                arguments += binding_arguments(read_json(args.target_file))
            result = parsed_process(powershell("chatgpt-pro-sidebar.ps1", args.claude_session_id, arguments, 60))
        elif args.command in ("install","uninstall"):
            result = lifecycle(args.claude_home, args.command, claude_executable=getattr(args, "claude_executable", None), claude_runtime=getattr(args, "claude_runtime", None),
                               launcher_file=getattr(args, "launcher_file", None), launcher_sha256=getattr(args, "launcher_sha256", None))
        elif args.command == "rollback":
            result = rollback(args.claude_home, args.backup, args.backup_sha256)
        elif args.command == "launch":
            if args.arguments_json_base64 is not None:
                if args.arguments or len(args.arguments_json_base64) > 128 * 1024:
                    raise ValueError("Use one bounded launcher argument transport.")
                arguments = json.loads(base64.b64decode(args.arguments_json_base64, validate=True).decode("utf-8"))
                if not isinstance(arguments, list):
                    raise ValueError("Launcher argument transport must contain an argv array.")
            else:
                arguments = args.arguments[1:] if args.arguments[:1] == ["--"] else args.arguments
            return launch(arguments)
        else:
            result = {"hostKind": "claude", "windowsTransport": os.name == "nt", "browserInvoked": False,
                      "pluginFiles": len(file_inventory(ROOT, source_files=True)), "hasHooks": (ROOT / "hooks").exists(), "hasMcpRegistration": (ROOT / ".mcp.json").exists(),
                      "liveClaudeHostVerified": False, "liveBrowserVerified": False}
        print(json.dumps(result, ensure_ascii=True))
        return result.get("exitCode", 0)
    except (ValueError, OSError, KeyError, UnicodeError, zipfile.BadZipFile) as error:
        print(json.dumps({"ok": False, "category": type(error).__name__, "message": str(error), "automaticResendAllowed": False}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
