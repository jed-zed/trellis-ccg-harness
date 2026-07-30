#!/usr/bin/env python3
"""Fan in registered Pro watchers and continue the same Codex Desktop task."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
THREAD_ID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
WATCHER_ID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
TERMINAL_STATUSES = {
    "completed",
    "stopped-unverified",
    "probe-failed",
    "conversation-changed",
    "timeout",
    "worker-crashed",
}
REGISTRY_DIRECTORY_NAME = "stop-hook-v2"
LEGACY_REGISTRY_DIRECTORY_NAME = "stop-hook-v1"
EVENT_FILE_NAME = "watch-event.json"
STATE_FILE_NAME = "watch-state.json"
CLAIM_FILE_NAME = "watch-stop-hook.claim"
CALLBACK_FILE_NAME = "watch-callback.json"
ACK_FILE_NAME = "watch-continuation-ack.json"
LOG_FILE_NAME = "stop-hook.log"
DEFAULT_MAX_WAIT_SECONDS = 7_400
DEFAULT_POLL_MILLISECONDS = 1_000
MAX_REASON_REGISTRATIONS = 8


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _utc_text(value: dt.datetime | None = None) -> str:
    return (value or _utc_now()).isoformat().replace("+00:00", "Z")


def _decode_stdin_bytes(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe\x00\x00", b"\x00\x00\xfe\xff")):
        return raw.decode("utf-32")
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    if raw.startswith(b"\xef\xbb\xbf"):
        return raw.decode("utf-8-sig")

    sample = raw[:256]
    if sample.count(b"\x00") >= max(2, len(sample) // 4):
        for encoding in ("utf-16-le", "utf-16-be"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
    return raw.decode("utf-8-sig")


def _parse_json_object(raw: str) -> dict[str, Any]:
    text = raw.strip().lstrip("\ufeff")
    if not text:
        return {}

    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except json.JSONDecodeError:
        pass

    for line in reversed(text.splitlines()):
        candidate = line.strip().lstrip("\ufeff")
        if not candidate:
            continue
        try:
            value = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value

    decoder = json.JSONDecoder()
    for index, character in enumerate(text):
        if character != "{":
            continue
        try:
            value, _ = decoder.raw_decode(text, index)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise json.JSONDecodeError("No JSON object found in hook input.", text, 0)


def _read_stdin_json() -> dict[str, Any]:
    if sys.stdin is None or sys.stdin.isatty():
        return {}
    binary_stream = getattr(sys.stdin, "buffer", None)
    if binary_stream is not None:
        raw_bytes = binary_stream.read()
        if not raw_bytes:
            return {}
        return _parse_json_object(_decode_stdin_bytes(raw_bytes))

    raw_text = sys.stdin.read()
    return _parse_json_object(raw_text)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def _write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _append_log(root: Path, status: str, **fields: Any) -> None:
    try:
        root.mkdir(parents=True, exist_ok=True)
        record = {"atUtc": _utc_text(), "status": status, **fields}
        with (root / LOG_FILE_NAME).open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError:
        pass


def _registry_root(explicit_root: str) -> Path:
    if explicit_root:
        return Path(explicit_root).resolve()
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is unavailable.")
    return (
        Path(local_app_data)
        / "ChatGptProSidebar"
        / REGISTRY_DIRECTORY_NAME
    ).resolve()


def _thread_id(payload: dict[str, Any]) -> str:
    for key in ("session_id", "thread_id", "threadId", "sessionId"):
        value = payload.get(key)
        if isinstance(value, str) and THREAD_ID_PATTERN.fullmatch(value):
            return value.lower()
    return ""


def _safe_child(root: Path, candidate: Path) -> Path:
    root = root.resolve()
    candidate = candidate.resolve()
    candidate.relative_to(root)
    return candidate


def _parse_deadline(registration: dict[str, Any], max_wait_seconds: int) -> dt.datetime:
    bounded = _utc_now() + dt.timedelta(seconds=max_wait_seconds)
    raw = registration.get("hookDeadlineUtc")
    if not isinstance(raw, str) or not raw.strip():
        return bounded
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return bounded
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return min(parsed.astimezone(dt.timezone.utc), bounded)


def _claim_once(
    path: Path,
    thread_id: str,
    watcher_id: str,
    status: str,
) -> bool:
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "claimedAtUtc": _utc_text(),
        "codexThreadId": thread_id,
        "watcherId": watcher_id,
        "terminalStatus": status,
    }
    try:
        descriptor = os.open(
            path,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
            0o600,
        )
    except FileExistsError:
        return False
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(payload, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    return True


def _claim_continuation(
    *,
    registry_root: Path,
    registration_path: Path,
    registration: dict[str, Any],
    evidence_directory: Path,
    event_path: Path,
    thread_id: str,
    status: str,
) -> dict[str, Any] | None:
    claim_path = evidence_directory / CLAIM_FILE_NAME
    watcher_id = str(registration.get("watcherId") or "").lower()
    created = _claim_once(claim_path, thread_id, watcher_id, status)
    if not created:
        claim = _read_json(claim_path)
        if (
            claim is None
            or str(claim.get("codexThreadId") or "").lower() != thread_id
            or str(claim.get("watcherId") or "").lower() != watcher_id
            or str(claim.get("terminalStatus") or "") != status
        ):
            _append_log(
                registry_root,
                "continuation_claim_conflict",
                codexThreadId=thread_id,
                watcherId=watcher_id,
                evidenceDirectory=str(evidence_directory),
            )
            return None
        _append_log(
            registry_root,
            "continuation_replayed",
            codexThreadId=thread_id,
            watcherId=watcher_id,
            evidenceDirectory=str(evidence_directory),
        )

    callback = {
        "schemaVersion": SCHEMA_VERSION,
        "transport": "codex-stop-hook",
        "registered": True,
        "continuationRequested": True,
        "requestedAtUtc": _utc_text(),
        "codexThreadId": thread_id,
        "watcherId": watcher_id,
        "terminalStatus": status,
        "eventFile": EVENT_FILE_NAME,
        "claimFile": CLAIM_FILE_NAME,
        "ackFile": ACK_FILE_NAME,
    }
    _write_json_atomic(evidence_directory / CALLBACK_FILE_NAME, callback)

    registration["phase"] = "continuation-requested"
    registration["continuationRequestedAtUtc"] = callback["requestedAtUtc"]
    _write_json_atomic(registration_path, registration)
    _append_log(
        registry_root,
        "continuation_requested",
        codexThreadId=thread_id,
        terminalStatus=status,
        evidenceDirectory=str(evidence_directory),
    )
    return {
        "status": status,
        "watcherId": watcher_id,
        "eventPath": str(event_path),
        "evidenceDirectory": str(evidence_directory),
    }


def _continuation_reason(claimed: list[dict[str, Any]]) -> str:
    lines = [
        (
            f"{len(claimed)} ChatGPT Pro watcher registration(s) reached a "
            "terminal state in this same Codex Desktop task."
        )
    ]
    for item in claimed:
        lines.append(
            f'- watcher "{item["watcherId"]}" status "{item["status"]}": '
            f'read "{item["eventPath"]}" and '
            f'the bounded evidence under "{item["evidenceDirectory"]}".'
        )
    lines.append(
        "Independently classify every claimed result and continue this same "
        "Codex Desktop task. Do not automatically resend a Pro prompt, do not "
        "use CLI resume, and do not ask the user to relay technical details."
    )
    return " ".join(lines)


def _registration_paths(registry_root: Path, thread_id: str) -> list[Path]:
    candidates: list[Path] = []
    thread_directory = registry_root / thread_id
    if thread_directory.is_dir():
        for candidate in sorted(thread_directory.glob("*.json")):
            if WATCHER_ID_PATTERN.fullmatch(candidate.stem):
                candidates.append(candidate)

    # Tests and explicitly configured legacy roots may still place the v1 file
    # directly below the selected root.
    candidates.append(registry_root / f"{thread_id}.json")

    # Production v1 compatibility: the old registry is a sibling of v2.
    if registry_root.name != LEGACY_REGISTRY_DIRECTORY_NAME:
        candidates.append(
            registry_root.parent
            / LEGACY_REGISTRY_DIRECTORY_NAME
            / f"{thread_id}.json"
        )

    seen: set[Path] = set()
    result: list[Path] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen or not resolved.is_file():
            continue
        seen.add(resolved)
        result.append(resolved)
    return result


def _load_registrations(
    registry_root: Path,
    thread_id: str,
    max_wait_seconds: int,
) -> list[dict[str, Any]]:
    registrations: list[dict[str, Any]] = []
    for registration_path in _registration_paths(registry_root, thread_id):
        registration = _read_json(registration_path)
        if registration is None:
            continue
        if str(registration.get("codexThreadId", "")).lower() != thread_id:
            _append_log(
                registry_root,
                "registration_thread_mismatch",
                codexThreadId=thread_id,
                registrationPath=str(registration_path),
            )
            continue
        raw_evidence = registration.get("evidenceDirectory")
        if not isinstance(raw_evidence, str) or not raw_evidence.strip():
            _append_log(
                registry_root,
                "registration_missing_evidence",
                codexThreadId=thread_id,
                registrationPath=str(registration_path),
            )
            continue
        try:
            evidence_directory = Path(raw_evidence).resolve()
        except OSError as exc:
            _append_log(
                registry_root,
                "registration_evidence_unavailable",
                codexThreadId=thread_id,
                registrationPath=str(registration_path),
                error=type(exc).__name__,
            )
            continue
        if not evidence_directory.is_dir():
            _append_log(
                registry_root,
                "registration_evidence_unavailable",
                codexThreadId=thread_id,
                registrationPath=str(registration_path),
                evidenceDirectory=str(evidence_directory),
            )
            continue
        acknowledgement = _read_json(evidence_directory / ACK_FILE_NAME)
        if (
            acknowledgement is not None
            and acknowledgement.get("acknowledged") is True
            and str(acknowledgement.get("codexThreadId") or "").lower() == thread_id
            and str(acknowledgement.get("watcherId") or "").lower()
            == str(registration.get("watcherId") or "").lower()
        ):
            continue
        registrations.append(
            {
                "path": registration_path,
                "registration": registration,
                "evidenceDirectory": evidence_directory,
                "eventPath": _safe_child(
                    evidence_directory,
                    evidence_directory / EVENT_FILE_NAME,
                ),
                "statePath": _safe_child(
                    evidence_directory,
                    evidence_directory / STATE_FILE_NAME,
                ),
                "deadline": _parse_deadline(
                    registration,
                    max_wait_seconds,
                ),
            }
        )
    return registrations


def _has_matching_claim(entry: dict[str, Any], thread_id: str) -> bool:
    claim = _read_json(entry["evidenceDirectory"] / CLAIM_FILE_NAME)
    if claim is None:
        return False
    registration = entry["registration"]
    return (
        str(claim.get("codexThreadId") or "").lower() == thread_id
        and str(claim.get("watcherId") or "").lower()
        == str(registration.get("watcherId") or "").lower()
    )


def _terminal_registration(
    entry: dict[str, Any],
) -> tuple[str, Path, Path] | None:
    evidence_directory = entry["evidenceDirectory"]
    event_path = entry["eventPath"]
    state_path = entry["statePath"]

    event = _read_json(event_path)
    if event is not None:
        status = str(event.get("status", "")).strip()
        if status not in TERMINAL_STATUSES:
            status = "worker-crashed"
        return status, event_path, evidence_directory

    state = _read_json(state_path)
    phase = "" if state is None else str(state.get("phase", ""))
    if phase in {"launch-failed", "terminal"}:
        return "worker-crashed", event_path, evidence_directory

    if _utc_now() >= entry["deadline"]:
        return "timeout", event_path, evidence_directory
    return None


def run_hook(
    payload: dict[str, Any],
    *,
    registry_root: Path,
    max_wait_seconds: int,
    poll_milliseconds: int,
) -> int:
    thread_id = _thread_id(payload)
    if not thread_id:
        return 0

    registrations = _load_registrations(
        registry_root,
        thread_id,
        max_wait_seconds,
    )
    if not registrations:
        return 0
    if bool(payload.get("stop_hook_active")):
        registrations = [
            entry
            for entry in registrations
            if not _has_matching_claim(entry, thread_id)
        ]
        if not registrations:
            _append_log(
                registry_root,
                "continued_stop_no_pending_watchers",
                codexThreadId=thread_id,
            )
            return 0
        _append_log(
            registry_root,
            "continued_stop_waiting_for_pending_watchers",
            codexThreadId=thread_id,
            registrationCount=len(registrations),
        )

    _append_log(
        registry_root,
        "wait_started",
        codexThreadId=thread_id,
        registrationCount=len(registrations),
        deadlineUtc=_utc_text(min(item["deadline"] for item in registrations)),
    )

    while True:
        terminal: list[tuple[dict[str, Any], str, Path, Path]] = []
        for entry in registrations:
            result = _terminal_registration(entry)
            if result is None:
                continue
            status, event_path, evidence_directory = result
            terminal.append((entry, status, event_path, evidence_directory))

        if terminal:
            claimed: list[dict[str, Any]] = []
            for entry, status, event_path, evidence_directory in terminal[
                :MAX_REASON_REGISTRATIONS
            ]:
                claimed_item = _claim_continuation(
                    registry_root=registry_root,
                    registration_path=entry["path"],
                    registration=entry["registration"],
                    evidence_directory=evidence_directory,
                    event_path=event_path,
                    thread_id=thread_id,
                    status=status,
                )
                if claimed_item is not None:
                    claimed.append(claimed_item)
            if claimed:
                print(
                    json.dumps(
                        {
                            "decision": "block",
                            "reason": _continuation_reason(claimed),
                        },
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                )
            return 0

        if _utc_now() >= min(item["deadline"] for item in registrations):
            # The next pass classifies every expired registration as timeout.
            continue
        time.sleep(poll_milliseconds / 1_000)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--registry-root", default="")
    parser.add_argument(
        "--max-wait-seconds",
        type=int,
        default=DEFAULT_MAX_WAIT_SECONDS,
    )
    parser.add_argument(
        "--poll-milliseconds",
        type=int,
        default=DEFAULT_POLL_MILLISECONDS,
    )
    arguments = parser.parse_args()
    if not 1 <= arguments.max_wait_seconds <= DEFAULT_MAX_WAIT_SECONDS:
        raise SystemExit("--max-wait-seconds must be between 1 and 7400.")
    if not 25 <= arguments.poll_milliseconds <= 5_000:
        raise SystemExit("--poll-milliseconds must be between 25 and 5000.")

    try:
        payload = _read_stdin_json()
        root = _registry_root(arguments.registry_root)
        return run_hook(
            payload,
            registry_root=root,
            max_wait_seconds=arguments.max_wait_seconds,
            poll_milliseconds=arguments.poll_milliseconds,
        )
    except Exception as exc:
        try:
            root = _registry_root(arguments.registry_root)
            _append_log(root, "hook_failed", error=type(exc).__name__)
        except Exception:
            pass
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
