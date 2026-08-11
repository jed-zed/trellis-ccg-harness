#!/usr/bin/env python3
"""ChatGPT Pro browser bridge for Codex-native CCG workflows.

This helper creates local prompt/response artifacts and imports bounded output
produced by the separately installed ``chatgpt-pro-sidebar`` Skill. The Skill
uses agent-browser-cli against a user-approved external Chrome tab; this helper
never handles authentication, browser credentials, or
workspace writes from ChatGPT Pro.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import html
import json
import os
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

PROVIDER = "chatgpt-pro-sidebar"
ACTIVE_BROWSER_TRANSPORT = "agent-browser-cli-v2"
HISTORICAL_BROWSER_TRANSPORT = "windows-uia"
LEGACY_PROVIDERS = {"chatgpt-pro-manual", PROVIDER}
MANUAL_QUESTIONS_EXPECTED = 1
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_BATCH_TIMEOUT_SECONDS = 7200
MAX_COMPOSED_PROMPT_CHARS = 24000
_SCRIPT_DIRECTORY = Path(__file__).resolve().parent
TEMPLATE_DIR = (
    _SCRIPT_DIRECTORY / "templates"
    if (_SCRIPT_DIRECTORY / "templates").is_dir()
    else _SCRIPT_DIRECTORY.parent / "templates" / "gptpro"
)
ENDPOINTS = ("GET /", "GET /state", "POST /save-response", "POST /mark-copied")
BOUNDARIES = (
    "Do not automate ChatGPT web login",
    "Use only the installed Skill's fixed bounded ChatGPT DOM extractor",
    "Use only the installed chatgpt-pro-sidebar Skill for UI transport",
)
GEMINI_POLICIES = ("required", "optional", "none")
GEMINI_EVIDENCE_ROLES = ("gate", "frontend-prototype", "frontend-review")
EXTERNAL_INTELLIGENCE_PROVIDER = "grok"
EXTERNAL_INTELLIGENCE_ROLE = "external-intelligence"
CLAUDE_EVIDENCE_STATUSES = ("automatic", "manual_handoff", "skipped_by_user", "blocked")
CLAUDE_EVIDENCE_REQUIRED_STATUSES = {"automatic", "manual_handoff"}
CONTROL_CHAR_PATTERN = re.compile(r"[\x00-\x1f\x7f]")
IDEMPOTENCY_KEY_PATTERN = re.compile(r"[A-Za-z0-9._:-]{1,128}")
WINDOWS_DRIVE_PATTERN = re.compile(r"^[A-Za-z]:[\\/]")
SCP_LIKE_REMOTE_PATTERN = re.compile(r"^(?:([^@/:\\]+)@)?([A-Za-z0-9.-]+):(.+)$")
LOCAL_PREVIEW_HOSTS = {"127.0.0.1", "localhost", "::1"}
TASK_ROOTS = ((".ccg", "tasks"), (".trellis", "tasks"))
CHATGPT_CONVERSATION_PATH_PATTERN = re.compile(
    r"/(?:g/[A-Za-z0-9_-]{1,128}/)?c/[A-Za-z0-9_-]{8,128}"
)
CODEX_THREAD_ID_PATTERN = re.compile(r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


@contextmanager
def locked_file(path: Path, timeout_seconds: float = 30.0):
    """Hold one cross-process byte lock; the lock file itself is durable."""
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+b")
    handle.seek(0, os.SEEK_END)
    if handle.tell() == 0:
        handle.write(b"\0")
        handle.flush()
    deadline = time.monotonic() + timeout_seconds
    acquired = False
    try:
        while not acquired:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except OSError:
                if time.monotonic() >= deadline:
                    raise TimeoutError(f"Timed out acquiring bridge lock: {path}") from None
                time.sleep(0.05)
        yield
    finally:
        if acquired:
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        handle.close()


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(
        f".{path.name}.{os.getpid()}.{threading.get_ident()}.{secrets.token_hex(8)}.tmp"
    )
    try:
        with temporary.open("xb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        for attempt in range(50):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if os.name != "nt" or attempt == 49:
                    raise
                time.sleep(0.02)
    finally:
        temporary.unlink(missing_ok=True)


def write_json_atomic(path: Path, value: dict[str, Any]) -> None:
    payload = (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    write_bytes_atomic(path, payload)


def is_chatgpt_conversation_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    return (
        parsed.scheme == "https"
        and parsed.netloc == "chatgpt.com"
        and parsed.hostname == "chatgpt.com"
        and port is None
        and parsed.username is None
        and parsed.password is None
        and parsed.query == ""
        and parsed.fragment == ""
        and CHATGPT_CONVERSATION_PATH_PATTERN.fullmatch(parsed.path) is not None
    )


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "gptpro-bridge"


def resolve_workdir(value: str) -> Path:
    if CONTROL_CHAR_PATTERN.search(value):
        raise ValueError("--workdir contains control characters")
    try:
        resolved = Path(value).expanduser().resolve(strict=True)
    except OSError as error:
        raise ValueError(f"--workdir does not exist or cannot be resolved: {value}") from error
    if not resolved.is_dir():
        raise ValueError(f"--workdir must be a directory: {resolved}")
    return resolved


def resolve_output_root(workdir: Path, output_root: Path) -> Path:
    candidate = output_root.expanduser()
    resolved = (candidate if candidate.is_absolute() else workdir / candidate).resolve()
    try:
        resolved.relative_to(workdir.resolve())
    except ValueError:
        raise ValueError(f"--output-root must stay inside --workdir: {resolved}") from None
    return resolved


def supported_task_roots(workdir: Path) -> list[Path]:
    return [(workdir.joinpath(*parts)).resolve() for parts in TASK_ROOTS]


def task_root_for(workdir: Path, candidate: Path) -> Path | None:
    for root in supported_task_roots(workdir):
        if candidate.parent == root:
            return root
    return None


def find_active_task_dir(workdir: Path) -> Path | None:
    for tasks_dir in supported_task_roots(workdir):
        if not tasks_dir.exists():
            continue
        candidates: list[Path] = []
        for entry in tasks_dir.iterdir():
            task_file = entry / "task.json"
            if entry.name == "archive" or not entry.is_dir() or not task_file.exists():
                continue
            try:
                task = json.loads(task_file.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                continue
            if task.get("status") not in {"completed", "archived"}:
                candidates.append(entry)
        if candidates:
            return sorted(candidates, key=lambda p: p.name, reverse=True)[0]
    return None


def resolve_task_dir(workdir: Path, task_dir: str = "", task_id: str = "") -> Path | None:
    if task_dir:
        candidate = Path(task_dir).expanduser()
        if not candidate.is_absolute():
            candidate = workdir / candidate
        candidate = candidate.resolve()
    elif task_id:
        matches = [
            root / task_id
            for root in supported_task_roots(workdir)
            if (root / task_id / "task.json").exists()
        ]
        if len(matches) > 1:
            roots = ", ".join(str(path.parent) for path in matches)
            raise ValueError(f"--task-id is ambiguous across task roots ({roots}); pass --task-dir.")
        candidate = matches[0].resolve() if matches else (workdir / ".ccg" / "tasks" / task_id).resolve()
    else:
        candidate = find_active_task_dir(workdir)
    if candidate is None:
        return None
    tasks_root = task_root_for(workdir, candidate)
    if tasks_root is None:
        supported = ", ".join(str(root) for root in supported_task_roots(workdir))
        raise ValueError(f"Task directory must be a direct child of a supported task root ({supported}): {candidate}")
    if not (candidate / "task.json").exists():
        raise ValueError(f"Task directory is missing task.json: {candidate}")
    return candidate


def task_evidence_root(task_dir: Path) -> Path:
    if task_dir.parent.parent.name == ".trellis":
        return task_dir / ".ccg-evidence"
    return task_dir


def default_output_root(workdir: Path, task_dir: Path | None, output_root: str) -> Path:
    if output_root:
        return resolve_output_root(workdir, Path(output_root)).resolve()
    if task_dir is None:
        raise ValueError("--task-dir or --task-id is required when --output-root is omitted.")
    return (task_evidence_root(task_dir) / "gptpro").resolve()


def default_evidence_file(task_dir: Path | None, evidence_file: str = "") -> Path | None:
    if evidence_file:
        path = Path(evidence_file).expanduser()
        if not path.is_absolute() and task_dir is not None:
            path = task_dir / path
        resolved = path.resolve()
        if task_dir is not None:
            ensure_within_dir(resolved, task_dir, "Canonical evidence file")
        return resolved
    if task_dir is None:
        return None
    return (task_evidence_root(task_dir) / "evidence.json").resolve()


def ensure_within_dir(path_value: Path, base_dir: Path, label: str) -> None:
    try:
        path_value.resolve().relative_to(base_dir.resolve())
    except ValueError:
        raise ValueError(f"{label} must stay inside the active task directory: {path_value}") from None


def task_project_root(task_dir: Path) -> Path:
    return task_dir.resolve().parents[2]


def resolve_evidence_artifact(task_dir: Path, artifact_file: str) -> Path:
    if not artifact_file:
        raise ValueError("Canonical evidence is missing an artifact path.")
    candidate = Path(artifact_file).expanduser()
    if candidate.is_absolute():
        resolved = candidate.resolve()
    elif artifact_file.replace("\\", "/").startswith((".ccg/", ".codex/", ".trellis/")):
        resolved = (task_project_root(task_dir) / candidate).resolve()
    else:
        resolved = (task_dir / candidate).resolve()
    ensure_within_dir(resolved, task_project_root(task_dir), "Canonical evidence artifact")
    return resolved


def read_canonical_evidence(evidence_file: Path) -> dict[str, Any]:
    if not evidence_file.exists():
        raise ValueError(f"Canonical evidence file not found: {evidence_file}")
    try:
        evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise ValueError(f"Canonical evidence file is malformed: {evidence_file}") from error
    if not isinstance(evidence.get("items"), list):
        raise ValueError(f"Canonical evidence file has no items array: {evidence_file}")
    return evidence


def concise_text(value: Any, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def concise_string_list(value: Any, *, limit: int = 12, item_chars: int = 240) -> list[str]:
    if not isinstance(value, list):
        return []
    return [concise_text(item, item_chars) for item in value[:limit] if concise_text(item, item_chars)]


def validate_canonical_evidence_item(
    *,
    task_dir: Path,
    evidence_file: Path,
    provider: str,
    role: str,
    policy: str,
    expected_artifact: Path | None = None,
    require_manifest: bool = False,
    artifact_scope: Path | None = None,
) -> dict[str, Any]:
    evidence = read_canonical_evidence(evidence_file)
    candidates = [
        item for item in evidence.get("items") or []
        if item.get("provider") == provider
        and item.get("role") == role
        and item.get("policy") == policy
        and item.get("available") is True
    ]
    if not candidates:
        raise ValueError(f"Canonical evidence.json is missing required {provider}/{role} evidence.")

    failures: list[str] = []
    for item in candidates:
        item_id = str(item.get("id") or "<unknown>")
        try:
            artifact_path = resolve_evidence_artifact(task_dir, str(item.get("artifactFile") or ""))
            if artifact_scope is not None:
                ensure_within_dir(artifact_path, artifact_scope, f"{provider}/{role} evidence artifact")
            if expected_artifact is not None and artifact_path != expected_artifact.resolve():
                raise ValueError(f"candidate {item_id} points to {artifact_path}, not {expected_artifact.resolve()}")
            if not artifact_path.exists():
                raise ValueError(f"Canonical evidence artifact not found: {artifact_path}")
            artifact_bytes = artifact_path.read_bytes()
            if not artifact_bytes:
                raise ValueError(f"Canonical evidence artifact is empty: {artifact_path}")
            artifact_hash = hashlib.sha256(artifact_bytes).hexdigest()
            expected_hash = str(item.get("artifactSha256") or "")
            if not expected_hash or artifact_hash != expected_hash:
                raise ValueError(f"Canonical evidence hash mismatch for {artifact_path}")

            manifest_value = str(item.get("manifestFile") or "")
            manifest_hash = str(item.get("manifestSha256") or "")
            manifest_path: Path | None = None
            manifest: dict[str, Any] | None = None
            if require_manifest or manifest_value or manifest_hash:
                if not manifest_value or not manifest_hash:
                    raise ValueError(f"Canonical evidence item {item_id} is missing manifest provenance")
                manifest_path = resolve_evidence_artifact(task_dir, manifest_value)
                if not manifest_path.exists():
                    raise ValueError(f"Canonical evidence manifest not found: {manifest_path}")
                manifest_bytes = manifest_path.read_bytes()
                if hashlib.sha256(manifest_bytes).hexdigest() != manifest_hash:
                    raise ValueError(f"Canonical evidence manifest hash mismatch for {manifest_path}")
                try:
                    manifest = json.loads(manifest_bytes)
                except json.JSONDecodeError as error:
                    raise ValueError(f"Canonical evidence manifest is malformed: {manifest_path}") from error
                manifest_artifact = (manifest.get("files") or {}).get(artifact_path.name) or {}
                manifest_mismatch = (
                    manifest_artifact.get("sha256") != artifact_hash
                    or manifest_artifact.get("bytes") != len(artifact_bytes)
                )
                if manifest_mismatch:
                    raise ValueError("Canonical evidence manifest does not bind the artifact bytes")
            return {
                "item": dict(item),
                "artifact_path": artifact_path,
                "artifact_bytes": artifact_bytes,
                "artifact_sha256": artifact_hash,
                "manifest_path": manifest_path,
                "manifest": manifest,
                "manifest_sha256": manifest_hash,
            }
        except (ValueError, OSError) as error:
            failures.append(str(error))
    detail = "; ".join(failures[:3]) if failures else "no candidate validated"
    raise ValueError(f"Canonical {provider}/{role} evidence did not validate: {detail}")


def validate_required_gemini_gate(
    *,
    task_dir: Path,
    evidence_file: Path | None,
    response_file: Path,
) -> dict[str, Any]:
    if evidence_file is None:
        evidence_file = default_evidence_file(task_dir)
    evidence_file = evidence_file.resolve()
    if not evidence_file.exists():
        raise ValueError(f"Canonical Gemini gate evidence file not found: {evidence_file}")
    response_path = response_file.resolve()
    ensure_within_dir(response_path, task_dir, "Gemini gate response artifact")
    if not response_path.exists():
        raise ValueError(f"Gemini gate response artifact not found: {response_path}")
    response_bytes = response_path.read_bytes()
    if not response_bytes:
        raise ValueError(f"Gemini gate response artifact is empty: {response_path}")
    validated = validate_canonical_evidence_item(
        task_dir=task_dir,
        evidence_file=evidence_file,
        provider="gemini",
        role="gate",
        policy="required",
        expected_artifact=response_path,
        artifact_scope=task_dir,
    )
    if validated["artifact_sha256"] != hashlib.sha256(response_bytes).hexdigest():
        raise ValueError("Gemini gate response file does not match canonical evidence hash.")
    return dict(validated["item"])


def _parse_exact_utc(value: Any, label: str) -> datetime:
    text = str(value or "")
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError(f"Canonical Grok {label} is not an ISO timestamp") from error
    if parsed.tzinfo is None:
        raise ValueError(f"Canonical Grok {label} must include a UTC offset")
    return parsed.astimezone(timezone.utc)


def _validate_grok_bindings(project_root: Path, bindings: Any) -> list[dict[str, Any]]:
    if not isinstance(bindings, list):
        raise ValueError("Canonical Grok manifest bindings must be an array")
    validated: list[dict[str, Any]] = []
    for binding in bindings:
        if not isinstance(binding, dict):
            raise ValueError("Canonical Grok binding is malformed")
        relative_path = str(binding.get("path") or "")
        expected_hash = str(binding.get("sha256") or "")
        if not relative_path or not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
            raise ValueError("Canonical Grok binding path or sha256 is malformed")
        bound_path = (project_root / relative_path).resolve()
        ensure_within_dir(bound_path, project_root, "Grok bound input")
        try:
            bound_bytes = bound_path.read_bytes()
        except OSError as error:
            raise ValueError(f"Canonical Grok binding is unavailable: {relative_path}") from error
        if hashlib.sha256(bound_bytes).hexdigest() != expected_hash:
            raise ValueError(f"Canonical Grok binding digest drift: {relative_path}")
        if binding.get("bytes") != len(bound_bytes):
            raise ValueError(f"Canonical Grok binding byte count drift: {relative_path}")
        validated.append(dict(binding))
    return validated


def validate_required_external_intelligence(
    *,
    task_dir: Path,
    evidence_file: Path | None,
    expected_action: str = "intel",
    expected_mode: str,
    expected_depth: str,
) -> dict[str, Any]:
    evidence_path = (evidence_file or (task_dir / "evidence.json")).resolve()
    validated = validate_canonical_evidence_item(
        task_dir=task_dir,
        evidence_file=evidence_path,
        provider=EXTERNAL_INTELLIGENCE_PROVIDER,
        role=EXTERNAL_INTELLIGENCE_ROLE,
        policy="required",
        require_manifest=True,
        artifact_scope=task_project_root(task_dir),
    )
    try:
        artifact = json.loads(validated["artifact_bytes"])
    except json.JSONDecodeError as error:
        raise ValueError("Canonical Grok evidence artifact is malformed") from error
    decision = artifact.get("decision") or {}
    if decision.get("requirement") != "required" or decision.get("status") not in {"verified", "received_unverified", "waived"}:
        raise ValueError("Canonical Grok evidence decision is not a usable required receipt")
    action = str(decision.get("action") or "")
    if action != expected_action:
        raise ValueError(f"Canonical Grok evidence action does not match the {expected_action} handoff")
    mode = str(decision.get("investigation_mode") or decision.get("mode") or "")
    if mode not in {"discover", "contract", "incident", "landscape"} or decision.get("mode") != mode:
        raise ValueError("Canonical Grok evidence decision has an invalid investigation mode")
    if mode != expected_mode:
        raise ValueError(f"Canonical Grok evidence investigation mode does not match the {expected_mode} handoff")
    depth = str(decision.get("depth") or "")
    if depth not in {"normal", "deep"}:
        raise ValueError("Canonical Grok evidence decision has an invalid depth")
    if depth != expected_depth:
        raise ValueError(f"Canonical Grok evidence depth does not match the {expected_depth} handoff")
    waiver = decision.get("waiver")
    if decision.get("status") == "waived":
        if (
            not isinstance(waiver, dict)
            or waiver.get("actor") != "user"
            or not str(waiver.get("reason") or "").strip()
            or not str(waiver.get("created_at") or "").strip()
        ):
            raise ValueError("Waived Grok evidence requires explicit user waiver metadata")
    elif waiver is not None:
        raise ValueError("Valid Grok evidence must not carry waiver metadata")

    manifest = validated.get("manifest") or {}
    evidence_id = str(manifest.get("evidenceId") or "")
    if not evidence_id:
        raise ValueError("Canonical Grok manifest is missing evidenceId")
    item = validated["item"]
    for key, expected in {
        "action": action,
        "investigationMode": mode,
        "depth": depth,
        "packageStatus": decision.get("package_status"),
        "verificationOutcome": decision.get("verification_outcome"),
    }.items():
        if item.get(key) != expected:
            label = "verification outcome" if key == "verificationOutcome" else key
            raise ValueError(f"Canonical Grok evidence item {label} drift")
    if item.get("localOnly") is not True or item.get("exported") is not False:
        raise ValueError("Canonical Grok evidence must remain local-only and unexported")
    if manifest.get("localOnly") is not True or manifest.get("exported") is not False:
        raise ValueError("Canonical Grok manifest must remain local-only and unexported")
    expected_policy = "disabled" if manifest.get("effective_x_policy") == "disabled" else manifest.get("effective_x_policy")
    for key, expected in {
        "action": action,
        "investigation_mode": mode,
        "depth": depth,
        "requirement": "required",
        "package_status": decision.get("package_status"),
        "verification_outcome": decision.get("verification_outcome"),
        "validation_outcome": decision.get("verification_outcome"),
    }.items():
        if manifest.get(key) != expected:
            raise ValueError(f"Canonical Grok manifest {key} does not match the evidence decision")
    if expected_policy not in {"required", "preferred", "disabled"}:
        raise ValueError("Canonical Grok manifest has an invalid effective X policy")
    for key in ("cli_version", "model"):
        if not str(manifest.get(key) or "").strip():
            raise ValueError(f"Canonical Grok manifest is missing {key}")
    for key in ("prompt_sha256", "dirty_digest", "cache_fingerprint"):
        if not re.fullmatch(r"[a-f0-9]{64}", str(manifest.get(key) or "")):
            raise ValueError(f"Canonical Grok manifest has an invalid {key}")
    if not str(manifest.get("git_head") or "").strip():
        raise ValueError("Canonical Grok manifest is missing git_head")
    if not isinstance(manifest.get("official_domains"), list):
        raise ValueError("Canonical Grok manifest official_domains must be an array")
    search_counts = manifest.get("search_counts")
    if not isinstance(search_counts, dict) or any(not isinstance(search_counts.get(key), int) or search_counts[key] < 0 for key in ("web", "x")):
        raise ValueError("Canonical Grok manifest search_counts are malformed")
    if not isinstance(manifest.get("attempts"), int) or manifest["attempts"] < 1:
        raise ValueError("Canonical Grok manifest attempts are malformed")
    if not isinstance(manifest.get("cache_contract_versions"), dict) or not manifest["cache_contract_versions"]:
        raise ValueError("Canonical Grok manifest cache contract versions are missing")
    created_at = _parse_exact_utc(manifest.get("createdAt"), "manifest freshness timestamp")
    decision_created_at = _parse_exact_utc(decision.get("created_at"), "decision timestamp")
    if created_at != decision_created_at:
        raise ValueError("Canonical Grok manifest and decision freshness timestamps drift")
    ttl_seconds = 2 * 60 * 60 if action == "verify" else 30 * 60 if mode == "incident" else 72 * 60 * 60 if mode == "contract" else 7 * 24 * 60 * 60
    age_seconds = (datetime.now(timezone.utc) - created_at).total_seconds()
    if age_seconds < -5 * 60 or age_seconds > ttl_seconds:
        raise ValueError("Canonical Grok evidence is stale or outside its freshness window")
    artifact_path = validated["artifact_path"]
    manifest_path = validated["manifest_path"]
    bundle_mismatch = (
        manifest_path is None
        or artifact_path.parent != manifest_path.parent
        or manifest_path.parent.name != evidence_id
    )
    if bundle_mismatch:
        raise ValueError("Canonical Grok artifact and manifest do not share the evidenceId bundle directory")
    task_file = task_dir / "task.json"
    try:
        task = json.loads(task_file.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as error:
        raise ValueError("Active task.json is missing or malformed for Grok pointer validation") from error
    pointer = task.get("intelligence") or task.get("external_intelligence") or {}
    expected_pointer = {
        "requirement": "required",
        "status": decision.get("status"),
        "action": action,
        "investigation_mode": mode,
        "depth": depth,
        "package_status": decision.get("package_status"),
        "verification_outcome": decision.get("verification_outcome"),
        "evidence_id": evidence_id,
        "manifest_file": str(item.get("manifestFile") or ""),
        "manifest_sha256": validated["manifest_sha256"],
        "localOnly": True,
        "exported": False,
    }
    pointer_drift = [key for key, value in expected_pointer.items() if pointer.get(key) != value]
    if pointer_drift:
        raise ValueError(f"Canonical Grok task pointer drift: {', '.join(pointer_drift)}")
    expected_item_id = f"grok-external-intelligence-{evidence_id}"
    if item.get("id") != expected_item_id:
        raise ValueError("Canonical Grok evidence item ID does not bind the active manifest evidenceId")

    evidence_payload = artifact.get("evidence") or {}
    if evidence_payload.get("action") != action or evidence_payload.get("investigation_mode") != mode or evidence_payload.get("depth") != depth:
        raise ValueError("Canonical Grok evidence action, mode, or depth provenance drift")
    if evidence_payload.get("effective_x_policy") != manifest.get("effective_x_policy"):
        raise ValueError("Canonical Grok evidence X policy provenance drift")
    if (evidence_payload.get("model") or {}).get("actual") != manifest.get("model"):
        raise ValueError("Canonical Grok evidence model provenance drift")
    manifest_bindings = _validate_grok_bindings(task_project_root(task_dir), manifest.get("bindings"))
    if expected_action == "verify" and not any(
        binding.get("kind") == "diff" and isinstance(binding.get("bytes"), int) and binding["bytes"] > 0
        for binding in manifest_bindings
    ):
        raise ValueError("Canonical Grok verification evidence must bind a non-empty current diff")
    if evidence_payload.get("bindings") != manifest_bindings:
        raise ValueError("Canonical Grok evidence binding metadata drift")
    registry_sources = {
        str(source.get("id") or ""): source
        for source in list((evidence_payload.get("registry") or {}).get("sources") or [])
        if isinstance(source, dict)
    }
    qualifying_claim_ids: list[str] = []
    all_claims_fully_verified = True
    for claim in list(evidence_payload.get("claims") or []):
        if not isinstance(claim, dict):
            all_claims_fully_verified = False
            continue
        status = str(claim.get("status") or "")
        reputable = any(
            str(registry_sources.get(str(source_id), {}).get("source_tier") or "") in {"A", "B"}
            for source_id in list(claim.get("source_ids") or [])
        )
        applicable = claim.get("observed_applicability") is True or bool(concise_string_list(claim.get("applies_to")))
        qualifies = status in {"verified", "partially_verified"} and reputable and applicable
        if qualifies:
            qualifying_claim_ids.append(str(claim.get("id") or ""))
        if status != "verified" or not qualifies:
            all_claims_fully_verified = False
    recomputed_outcome = "verified" if qualifying_claim_ids and all_claims_fully_verified else "partially_verified" if qualifying_claim_ids else "contradicted" if any(isinstance(claim, dict) and claim.get("status") == "contradicted" for claim in list(evidence_payload.get("claims") or [])) else "unresolved"
    if decision.get("status") == "verified":
        if decision.get("package_status") != "valid":
            raise ValueError("Canonical Grok evidence package status is not valid")
        if recomputed_outcome not in {"verified", "partially_verified"} or not qualifying_claim_ids:
            raise ValueError("Canonical Grok evidence has no qualifying verification outcome")
        if decision.get("verification_outcome") != recomputed_outcome:
            raise ValueError("Canonical Grok verification outcome does not match independently evaluated claims")
    claims = []
    for claim in list(evidence_payload.get("claims") or [])[:12]:
        if not isinstance(claim, dict):
            continue
        concise_claim = {}
        for key, limit in {
            "id": 160, "claim": 800, "status": 80, "severity": 80, "source_tier": 40,
            "published_at": 80, "effective_at": 80, "retrieved_at": 80, "required_action": 600,
        }.items():
            value = concise_text(claim.get(key), limit)
            if value:
                concise_claim[key] = value
        for key in ("source_ids", "sources", "applies_to", "repo_impact"):
            values = concise_string_list(claim.get(key))
            if values:
                concise_claim[key] = values
        if isinstance(claim.get("cross_verified"), bool):
            concise_claim["cross_verified"] = claim["cross_verified"]
        claims.append(concise_claim)
    sources = []
    registry = evidence_payload.get("registry") or {}
    for source in list(registry.get("sources") or [])[:20]:
        if not isinstance(source, dict):
            continue
        concise_source = {}
        for key, limit in {
            "id": 160, "canonical_url": 600, "title": 300, "publisher": 200, "tool": 80,
            "source_tier": 40, "retrieved_at": 80, "published_at": 80, "evidence_note": 500,
        }.items():
            value = concise_text(source.get(key), limit)
            if value:
                concise_source[key] = value
        if isinstance(source.get("official"), bool):
            concise_source["official"] = source["official"]
        sources.append(concise_source)
    return {
        "required": True,
        "available": True,
        "provider": EXTERNAL_INTELLIGENCE_PROVIDER,
        "role": EXTERNAL_INTELLIGENCE_ROLE,
        "evidence_id": evidence_id,
        "mode": mode,
        "action": action,
        "depth": depth,
        "package_status": decision.get("package_status"),
        "verification_outcome": decision.get("verification_outcome"),
        "requirement": "required",
        "status": decision.get("status"),
        "summary": concise_text(item.get("summary") or "Validated current external intelligence evidence.", 2000),
        "claims": claims,
        "sources": sources,
        "artifact_file": str(item.get("artifactFile") or ""),
        "artifact_sha256": validated["artifact_sha256"],
        "manifest_file": str(item.get("manifestFile") or ""),
        "manifest_sha256": validated["manifest_sha256"],
        "waiver": waiver if decision.get("status") == "waived" else None,
    }


def header_hostname(value: str) -> str:
    raw = value.strip()
    if not raw:
        return ""
    if raw.startswith("["):
        return raw[1:].split("]", 1)[0].lower()
    return raw.rsplit(":", 1)[0].lower()


def preview_host_allowed(value: str) -> bool:
    return header_hostname(value) in LOCAL_PREVIEW_HOSTS


def preview_origin_allowed(value: str | None) -> bool:
    if not value:
        return True
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"}:
        return False
    return (parsed.hostname or "").lower() in LOCAL_PREVIEW_HOSTS


def ensure_preview_token(session: "BridgeSession") -> str:
    status = session.status()
    token = str(status.get("preview_token") or "")
    if not token:
        token = secrets.token_urlsafe(32)
        status["preview_token"] = token
        session.write_status(status)
    return token


def display_path(path: Path, workdir: Path) -> str:
    try:
        return path.resolve().relative_to(workdir.resolve()).as_posix()
    except ValueError:
        return str(path.resolve())


def display_gate_response_file(gemini_gate: dict[str, Any], workdir: Path) -> str:
    response_value = str(gemini_gate.get("response_file") or "")
    if not response_value:
        return ""
    response_path = Path(response_value)
    if not response_path.is_absolute():
        return response_value
    return display_path(response_path, workdir)


def display_file_value(value: str, workdir: Path) -> str:
    if not value:
        return ""
    path_value = Path(value)
    if not path_value.is_absolute():
        return value
    return display_path(path_value, workdir)


def run_git_result(workdir: Path, args: list[str]) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            ["git", "-C", str(workdir), *args],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return False, ""
    if result.returncode != 0:
        return False, ""
    return True, result.stdout.strip()


def run_git(workdir: Path, args: list[str]) -> str:
    ok, output = run_git_result(workdir, args)
    return output if ok else ""


def is_local_path_like(value: str) -> bool:
    candidate = value.strip()
    if not candidate:
        return False
    return (
        candidate.startswith("/")
        or candidate.startswith("~")
        or candidate.startswith("\\\\")
        or WINDOWS_DRIVE_PATTERN.match(candidate) is not None
        or ("\\" in candidate and "://" not in candidate)
    )


def normalize_remote_path(path_value: str) -> str:
    path = path_value.strip().split("?", 1)[0].split("#", 1)[0].lstrip("/").removesuffix(".git")
    if not path or path.startswith((".", "~")) or "\\" in path:
        return ""
    return path


def sanitize_repository_url(value: str) -> str:
    raw = value.strip()
    if not raw or CONTROL_CHAR_PATTERN.search(raw):
        return ""
    if raw.lower().startswith("file:") or is_local_path_like(raw):
        return ""

    scp_match = SCP_LIKE_REMOTE_PATTERN.match(raw) if "://" not in raw else None
    if scp_match:
        host = scp_match.group(2).lower()
        path = normalize_remote_path(scp_match.group(3))
        if not path:
            return ""
        return f"https://{host}/{path}"

    try:
        parsed = urlsplit(raw)
    except ValueError:
        return ""
    if not parsed.scheme and not parsed.netloc:
        return ""
    if parsed.scheme not in {"http", "https", "ssh", "git"}:
        return ""
    if not parsed.hostname:
        return ""
    path = normalize_remote_path(parsed.path)
    if not path:
        return ""
    host = parsed.hostname.lower()
    if parsed.port:
        host = f"{host}:{parsed.port}"
    scheme = "https" if parsed.scheme in {"ssh", "git"} else parsed.scheme
    return urlunsplit((scheme, host, "/" + path, "", ""))


def detect_project_context(workdir: str | Path, repo_url: str = "") -> dict[str, Any]:
    workdir_path = Path(workdir).resolve()
    git_root = run_git(workdir_path, ["rev-parse", "--show-toplevel"])
    is_git_worktree = bool(git_root)
    git_root_path = Path(git_root).resolve() if is_git_worktree else workdir_path
    detected_url = repo_url or run_git(git_root_path, ["remote", "get-url", "origin"])
    status_ok, status_short = run_git_result(git_root_path, ["status", "--short"])
    if not is_git_worktree:
        status_summary = "not_git"
        dirty: bool | None = None
    elif not status_ok:
        status_summary = "unknown"
        dirty = None
    elif status_short:
        status_summary = "dirty"
        dirty = True
    else:
        status_summary = "clean"
        dirty = False
    context = {
        "project_name": git_root_path.name,
        "repository_url": sanitize_repository_url(detected_url),
        "branch": run_git(git_root_path, ["branch", "--show-current"]) or "",
        "commit": run_git(git_root_path, ["rev-parse", "HEAD"]) or "",
        "dirty": dirty,
        "status_summary": status_summary,
    }
    context["github_context_hint"] = bool(context["repository_url"])
    return context


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_port(port: int, timeout_seconds: float = 10.0) -> bool:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def read_template(name: str) -> str:
    file_path = TEMPLATE_DIR / f"{name}.md"
    if not file_path.exists():
        return ""
    return file_path.read_text(encoding="utf-8").strip()


def default_gemini_policy(mode: str) -> str:
    return "optional"


def default_gemini_evidence_role(mode: str) -> str:
    return "frontend-prototype" if mode == "exc" else "gate"


def normalize_gemini_policy(policy: str) -> str:
    normalized = (policy or "").strip() or "required"
    if normalized not in GEMINI_POLICIES:
        raise ValueError(f"Invalid Gemini evidence policy: {normalized}")
    return normalized


def normalize_gemini_evidence_role(role: str) -> str:
    normalized = (role or "").strip() or "gate"
    if normalized not in GEMINI_EVIDENCE_ROLES:
        raise ValueError(f"Invalid Gemini evidence role: {normalized}")
    return normalized


def validate_mode_gemini_policy(mode: str, policy: str, role: str) -> None:
    if mode in {"plan", "review"} and role != "gate":
        raise ValueError(
            "Plan/review Gemini evidence must use the gate role when it is present; "
            "use --gemini-evidence-role gate."
        )


def empty_gemini_evidence(policy: str, role: str) -> dict[str, Any]:
    return {
        "required": policy == "required",
        "policy": policy,
        "role": role,
        "available": False,
        "response_file": "",
        "response_non_empty": False,
        "response_chars": 0,
        "response_sha256": "",
        "summary": "",
    }


def normalize_gemini_evidence(gemini_evidence: dict[str, Any], policy: str, role: str) -> dict[str, Any]:
    normalized = dict(gemini_evidence)
    normalized.setdefault("policy", policy)
    normalized.setdefault("role", role)
    normalized.setdefault("available", bool(normalized.get("response_non_empty")))
    normalized.setdefault("required", str(normalized.get("policy")) == "required")
    normalized.setdefault("response_file", "")
    normalized.setdefault("response_non_empty", bool(normalized.get("available")))
    normalized.setdefault("response_chars", 0)
    normalized.setdefault("response_sha256", "")
    normalized.setdefault("summary", "")
    return normalized


def gemini_evidence_title(role: str) -> str:
    if role == "frontend-prototype":
        return "## Gemini Frontend Prototype Evidence"
    if role == "frontend-review":
        return "## Gemini Frontend Review Evidence"
    return "## Gemini Gate Evidence"


def gemini_summary_label(role: str) -> str:
    if role == "frontend-prototype":
        return "Gemini frontend prototype summary:"
    if role == "frontend-review":
        return "Gemini frontend review summary:"
    return "Gemini findings summary:"


def compose_gemini_evidence(gemini_gate: dict[str, Any]) -> str:
    if not gemini_gate.get("available", True):
        return ""
    role = str(gemini_gate.get("role") or "gate")
    return "\n".join(
        [
            gemini_evidence_title(role),
            "",
            f"Gemini response file: {gemini_gate.get('response_file') or ''}",
            f"Gemini response SHA-256: {gemini_gate.get('response_sha256') or ''}",
            f"Gemini response characters: {gemini_gate.get('response_chars') or 0}",
            "",
            gemini_summary_label(role),
            str(gemini_gate.get("summary") or ""),
        ]
    )


def compose_external_intelligence(external_intelligence: dict[str, Any] | None) -> str:
    evidence = external_intelligence or {}
    if not evidence.get("available"):
        return ""
    waiver = evidence.get("waiver") or {}
    waiver_lines = []
    if evidence.get("status") == "waived":
        waiver_lines = [
            "",
            "WARNING: The required Grok external-intelligence gate was explicitly waived by the user.",
            f"Waiver reason: {waiver.get('reason') or ''}",
            "Do not describe this gate as externally verified.",
        ]
    claims = json.dumps(evidence.get("claims") or [], ensure_ascii=False, separators=(",", ":"))
    sources = json.dumps(evidence.get("sources") or [], ensure_ascii=False, separators=(",", ":"))
    return "\n".join([
        "## Received Grok External Intelligence",
        "",
        f"Decision: {evidence.get('requirement') or ''}/{evidence.get('status') or ''}",
        f"Mode: {evidence.get('mode') or ''}",
        f"Evidence ID: {evidence.get('evidence_id') or ''}",
        f"Evidence artifact: {evidence.get('artifact_file') or ''}",
        f"Evidence SHA-256: {evidence.get('artifact_sha256') or ''}",
        f"Manifest: {evidence.get('manifest_file') or ''}",
        f"Manifest SHA-256: {evidence.get('manifest_sha256') or ''}",
        "",
        f"Validated summary: {evidence.get('summary') or ''}",
        f"Validated claims: {claims}",
        f"Validated source provenance: {sources}",
        *waiver_lines,
    ])


def empty_routing_evidence(required: bool = False) -> dict[str, Any]:
    return {
        "required": bool(required),
        "available": False,
        "evidence_file": "",
        "evidence_sha256": "",
        "evidence_chars": 0,
        "summary_file": "",
        "summary": "",
        "summary_chars": 0,
        "claudeEvidenceStatus": "",
    }


def normalize_claude_evidence_status(status: str) -> str:
    raw = str(status or "").strip()
    normalized = re.sub(r"[^a-z0-9]+", "_", raw.lower()).strip("_")
    aliases = {
        "auto": "automatic",
        "automatic": "automatic",
        "manual": "manual_handoff",
        "manual_handoff": "manual_handoff",
        "manual_claude_handoff": "manual_handoff",
        "manual_code_handoff": "manual_handoff",
        "manual_handoff_completed": "manual_handoff",
        "explicitly_skipped": "skipped_by_user",
        "explicitly_skipped_by_user": "skipped_by_user",
        "skipped": "skipped_by_user",
        "skipped_by_user": "skipped_by_user",
        "skip_by_user": "skipped_by_user",
        "blocked": "blocked",
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in CLAUDE_EVIDENCE_STATUSES:
        raise ValueError(
            "Invalid claudeEvidenceStatus: "
            f"{raw}. Expected one of: {', '.join(CLAUDE_EVIDENCE_STATUSES)}."
        )
    return normalized


def extract_claude_evidence_status(raw: str) -> str:
    text = raw.strip()
    if not text:
        return ""
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        status = parsed.get("claudeEvidenceStatus") or parsed.get("claude_evidence_status")
        return normalize_claude_evidence_status(str(status)) if status else ""

    patterns = (
        r"(?im)^\s*(?:[-*]\s*)?`?\s*claudeEvidenceStatus\s*[:=]\s*([A-Za-z0-9 _-]+)\s*`?\s*$",
        r"(?im)^\s*(?:[-*]\s*)?`?\s*claude[\s_-]+evidence[\s_-]+status\s*[:=]\s*([A-Za-z0-9 _-]+)\s*`?\s*$",
    )
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return normalize_claude_evidence_status(match.group(1))
    return ""


def normalize_routing_evidence(routing_evidence: dict[str, Any] | None, required: bool = False) -> dict[str, Any]:
    normalized = dict(routing_evidence or {})
    if required:
        normalized["required"] = True
    else:
        normalized.setdefault("required", False)
    normalized.setdefault("available", False)
    normalized.setdefault("evidence_file", "")
    normalized.setdefault("evidence_sha256", "")
    normalized.setdefault("evidence_chars", 0)
    normalized.setdefault("summary_file", "")
    normalized.setdefault("summary", "")
    normalized.setdefault("summary_chars", len(str(normalized.get("summary") or "")))
    claude_status = normalized.get("claudeEvidenceStatus") or normalized.get("claude_evidence_status") or ""
    normalized["claudeEvidenceStatus"] = (
        normalize_claude_evidence_status(str(claude_status)) if claude_status else ""
    )
    return normalized


def validate_required_claude_evidence(routing_evidence: dict[str, Any]) -> None:
    status = str(routing_evidence.get("claudeEvidenceStatus") or "")
    if status in CLAUDE_EVIDENCE_REQUIRED_STATUSES:
        return
    if not status:
        raise ValueError(
            "claudeEvidenceStatus is required before GPT Pro bridge session creation. "
            "Use automatic or manual_handoff, or omit --require-claude-evidence only when the user "
            "explicitly disabled Claude."
        )
    raise ValueError(
        "Claude evidence is required before GPT Pro bridge session creation; "
        f"claudeEvidenceStatus={status}. Expected automatic or manual_handoff."
    )


def summarize_routing_evidence(raw: str, limit: int = 1200) -> str:
    collapsed = re.sub(r"\s+", " ", raw.strip())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 3].rstrip() + "..."


def read_routing_evidence(
    workdir: str | Path,
    evidence_file: str = "",
    summary_file: str = "",
    *,
    required: bool = False,
) -> dict[str, Any]:
    workdir_path = Path(workdir).resolve()
    if not evidence_file:
        if summary_file:
            raise ValueError("Base CCG routing evidence file is required when routing summary evidence is provided.")
        if required:
            raise ValueError("Base CCG routing evidence file is required before GPT Pro bridge session creation.")
        return empty_routing_evidence(required)

    evidence_path = Path(evidence_file).expanduser()
    if not evidence_path.is_absolute():
        evidence_path = workdir_path / evidence_path
    evidence_path = evidence_path.resolve()
    if not evidence_path.exists():
        raise ValueError(f"Base CCG routing evidence file not found: {evidence_path}")

    evidence_raw = evidence_path.read_text(encoding="utf-8")
    if not evidence_raw.strip():
        raise ValueError(f"Base CCG routing evidence file is empty: {evidence_path}")

    summary_path: Path | None = None
    summary_text = ""
    if summary_file:
        summary_path = Path(summary_file).expanduser()
        if not summary_path.is_absolute():
            summary_path = workdir_path / summary_path
        summary_path = summary_path.resolve()
        if not summary_path.exists():
            raise ValueError(f"Base CCG routing summary file not found: {summary_path}")
        summary_text = summary_path.read_text(encoding="utf-8").strip()
        if not summary_text:
            raise ValueError(f"Base CCG routing summary file is empty: {summary_path}")
    else:
        summary_text = summarize_routing_evidence(evidence_raw)

    evidence_bytes = evidence_path.read_bytes()
    claude_status = extract_claude_evidence_status(evidence_raw)
    return {
        "required": bool(required),
        "available": True,
        "evidence_file": str(evidence_path),
        "evidence_sha256": hashlib.sha256(evidence_bytes).hexdigest(),
        "evidence_chars": len(evidence_raw),
        "summary_file": str(summary_path) if summary_path else "",
        "summary": summary_text,
        "summary_chars": len(summary_text),
        "claudeEvidenceStatus": claude_status,
    }


def compose_routing_evidence(routing_evidence: dict[str, Any]) -> str:
    if not routing_evidence.get("available"):
        return ""
    return "\n".join(
        [
            "## Base CCG Routing Evidence",
            "",
            f"Routing evidence file: {routing_evidence.get('evidence_file') or ''}",
            f"Routing evidence SHA-256: {routing_evidence.get('evidence_sha256') or ''}",
            f"Routing evidence characters: {routing_evidence.get('evidence_chars') or 0}",
            f"Claude evidence status: {routing_evidence.get('claudeEvidenceStatus') or 'not provided'}",
            "",
            "Routing evidence summary:",
            str(routing_evidence.get("summary") or ""),
        ]
    )


def compose_project_context(project_context: dict[str, Any]) -> str:
    repo_url = str(project_context.get("repository_url") or "not provided")
    branch = str(project_context.get("branch") or "unknown")
    commit = str(project_context.get("commit") or "unknown")
    status_summary = str(project_context.get("status_summary") or "unknown")
    return "\n".join(
        [
            "## Project Access Context",
            "",
            f"Project name: {project_context.get('project_name') or 'unknown'}",
            f"Repository URL: {repo_url}",
            f"Current branch: {branch}",
            f"Current commit: {commit}",
            f"Local git status: {status_summary}",
            "",
            "Repository URL is optional context, not the source of truth.",
            (
                "If you can use ChatGPT GitHub connector, Deep Research, or browsing, you may inspect "
                "the repository URL for extra context and cite exact file paths or commits you used."
            ),
            (
                "If you cannot access the repository URL, do not guess. Rely on the pasted CCG input, "
                "Gemini evidence when provided, and any included diffs or file excerpts."
            ),
            (
                "The repository URL may not include uncommitted local changes; pasted context has "
                "priority for current work."
            ),
        ]
    )


def compose_prompt(
    mode: str,
    raw_prompt: str,
    round_number: int,
    followup_reason: str | None,
    gemini_gate: dict[str, Any],
    routing_evidence: dict[str, Any],
    external_intelligence: dict[str, Any] | None,
    project_context: dict[str, Any],
) -> str:
    sections = [read_template("base")]
    if round_number > 1:
        sections.append(read_template("followup"))
        if followup_reason:
            sections.append(f"## Follow-up Reason\n\n{followup_reason.strip()}")
    sections.append(read_template(mode))
    sections.append(compose_project_context(project_context))
    routing_section = compose_routing_evidence(routing_evidence)
    if routing_section:
        sections.append(routing_section)
    gemini_section = compose_gemini_evidence(gemini_gate)
    if gemini_section:
        sections.append(gemini_section)
    intelligence_section = compose_external_intelligence(external_intelligence)
    if intelligence_section:
        sections.append(intelligence_section)
    sections.append("## CCG Input\n\n" + raw_prompt.strip())
    return "\n\n".join(section for section in sections if section).strip() + "\n"


def read_prompt(prompt: str, prompt_file: str) -> str:
    parts: list[str] = []
    if prompt_file:
        parts.append(Path(prompt_file).read_text(encoding="utf-8"))
    if prompt:
        parts.append(prompt)
    combined = "\n\n".join(part.strip() for part in parts if part.strip())
    if not combined:
        raise ValueError("A prompt or --prompt-file is required for the GPT Pro bridge.")
    return combined


def read_gemini_gate(
    workdir: str | Path,
    response_file: str,
    summary: str = "",
    summary_file: str = "",
) -> dict[str, Any]:
    return read_gemini_evidence(
        workdir,
        response_file,
        summary,
        summary_file,
        policy="required",
        role="gate",
    )


def read_gemini_evidence(
    workdir: str | Path,
    response_file: str,
    summary: str = "",
    summary_file: str = "",
    *,
    policy: str = "required",
    role: str = "gate",
) -> dict[str, Any]:
    policy = normalize_gemini_policy(policy)
    role = normalize_gemini_evidence_role(role)
    if not response_file:
        if summary or summary_file:
            raise ValueError("Gemini response file is required when Gemini summary evidence is provided.")
        if policy != "required":
            return empty_gemini_evidence(policy, role)
        raise ValueError("CCG_GEMINI_RESPONSE_FILE is required before GPT Pro bridge session creation.")

    workdir_path = Path(workdir).resolve()
    gemini_path = Path(response_file).expanduser()
    if not gemini_path.is_absolute():
        gemini_path = workdir_path / gemini_path
    gemini_path = gemini_path.resolve()
    if not gemini_path.exists():
        raise ValueError(f"Gemini response file not found: {gemini_path}")

    gemini_raw = gemini_path.read_text(encoding="utf-8")
    if not gemini_raw.strip():
        raise ValueError(f"Gemini response file is empty: {gemini_path}")

    summary_parts: list[str] = []
    if summary_file:
        summary_path = Path(summary_file).expanduser()
        if not summary_path.is_absolute():
            summary_path = workdir_path / summary_path
        summary_parts.append(summary_path.read_text(encoding="utf-8"))
    if summary:
        summary_parts.append(summary)
    summary_text = "\n\n".join(part.strip() for part in summary_parts if part.strip()).strip()
    if not summary_text:
        raise ValueError("A concise Gemini findings summary is required before GPT Pro bridge session creation.")

    gemini_bytes = gemini_path.read_bytes()
    return {
        "required": policy == "required",
        "policy": policy,
        "role": role,
        "available": True,
        "response_file": str(gemini_path),
        "response_non_empty": True,
        "response_chars": len(gemini_raw),
        "response_sha256": hashlib.sha256(gemini_bytes).hexdigest(),
        "summary": summary_text,
    }


def ensure_unique_session_dir(output_root: Path, mode: str, slug: str) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = output_root / f"{stamp}-{mode}-{slug}"
    candidate = base
    counter = 2
    while True:
        try:
            candidate.mkdir()
            return candidate
        except FileExistsError:
            candidate = output_root / f"{base.name}-{counter}"
            counter += 1


class BridgeSession:
    def __init__(
        self,
        mode: str,
        workdir: Path,
        session_dir: Path,
        round_name: str,
        prompt_file: Path,
        response_file: Path,
        status_file: Path,
    ) -> None:
        self.mode = mode
        self.workdir = workdir
        self.session_dir = session_dir
        self.round_name = round_name
        self.prompt_file = prompt_file
        self.response_file = response_file
        self.status_file = status_file
        self.lock_file = session_dir / ".gptpro-session.lock"

    def status(self) -> dict[str, Any]:
        return json.loads(self.status_file.read_text(encoding="utf-8"))

    def write_status(self, status: dict[str, Any]) -> None:
        with locked_file(self.lock_file):
            status["updated_at"] = utc_now()
            write_json_atomic(self.status_file, status)

    def state(self) -> dict[str, Any]:
        status = self.status()
        return {
            "provider": PROVIDER,
            "mode": self.mode,
            "session_dir": str(self.session_dir),
            "round": status.get("current_round", 1),
            "round_name": self.round_name,
            "prompt_file": str(self.prompt_file),
            "response_file": str(self.response_file),
            "status_file": str(self.status_file),
            "prompt": self.prompt_file.read_text(encoding="utf-8"),
            "response_saved": bool(status["rounds"][self.round_name]["response_saved"]),
            "manual_questions_expected": MANUAL_QUESTIONS_EXPECTED,
            "web_automation": True,
            "dom_extraction": True,
            "manual_copy_required": False,
            "sidebar_transport_required": True,
        }


def create_session(
    *,
    mode: str,
    workdir: str | Path,
    prompt: str,
    slug: str | None,
    output_root: str | Path,
    task_dir: str | Path | None = None,
    task_id: str = "",
    evidence_file: str | Path | None = None,
    source_command: str = "",
    round_number: int,
    followup_session: str | Path | None,
    followup_reason: str | None,
    gemini_gate: dict[str, Any] | None = None,
    gemini_evidence: dict[str, Any] | None = None,
    gemini_policy: str = "",
    gemini_evidence_role: str = "",
    routing_evidence: dict[str, Any] | None = None,
    require_routing_evidence: bool = False,
    require_claude_evidence: bool = False,
    external_intelligence: dict[str, Any] | None = None,
    require_external_intelligence: bool = False,
    project_context: dict[str, Any] | None = None,
    codex_thread_id: str = "",
    _followup_lock_held: bool = False,
) -> BridgeSession:
    if round_number < 1:
        raise ValueError("Round must be a positive integer.")
    if round_number > 1 and not followup_session:
        raise ValueError("Rounds after round 1 require --followup-session.")
    codex_thread_id = codex_thread_id.strip().lower()
    if codex_thread_id and CODEX_THREAD_ID_PATTERN.fullmatch(codex_thread_id) is None:
        raise ValueError("--codex-thread-id must be one exact UUID.")
    if followup_session and not _followup_lock_held:
        canonical_session_dir = resolve_existing_session_dir(followup_session)
        with locked_file(canonical_session_dir / ".gptpro-session.lock"):
            return create_session(
                mode=mode,
                workdir=workdir,
                prompt=prompt,
                slug=slug,
                output_root=output_root,
                task_dir=task_dir,
                task_id=task_id,
                evidence_file=evidence_file,
                source_command=source_command,
                round_number=round_number,
                followup_session=canonical_session_dir,
                followup_reason=followup_reason,
                gemini_gate=gemini_gate,
                gemini_evidence=gemini_evidence,
                gemini_policy=gemini_policy,
                gemini_evidence_role=gemini_evidence_role,
                routing_evidence=routing_evidence,
                require_routing_evidence=require_routing_evidence,
                require_claude_evidence=require_claude_evidence,
                external_intelligence=external_intelligence,
                require_external_intelligence=require_external_intelligence,
                project_context=project_context,
                codex_thread_id=codex_thread_id,
                _followup_lock_held=True,
            )

    workdir_path = Path(workdir).resolve()
    task_dir_path = Path(task_dir).resolve() if task_dir else None
    evidence_file_path = Path(evidence_file).resolve() if evidence_file else None
    policy = normalize_gemini_policy(gemini_policy or default_gemini_policy(mode))
    role = normalize_gemini_evidence_role(gemini_evidence_role or default_gemini_evidence_role(mode))
    validate_mode_gemini_policy(mode, policy, role)
    output_root_path = resolve_output_root(workdir_path, Path(output_root)).resolve()
    output_root_path.mkdir(parents=True, exist_ok=True)
    if gemini_evidence is None and gemini_gate is not None:
        gemini_evidence = gemini_gate

    if followup_session:
        session = load_session(followup_session)
        session_dir = session.session_dir
        status_file = session.status_file
        status = session.status()
        recorded_task_dir, recorded_evidence_file = resolve_session_status_binding(
            session_dir, session.workdir, status
        )
        if mode != session.mode:
            raise ValueError("Follow-up mode does not match the recorded session binding.")
        if workdir_path != session.workdir:
            raise ValueError("Follow-up workdir does not match the recorded session binding.")
        if task_dir_path != recorded_task_dir:
            raise ValueError("Follow-up task directory does not match the recorded session binding.")
        if evidence_file_path != recorded_evidence_file:
            raise ValueError("Follow-up evidence file does not match the recorded session binding.")
        caller_task_id = task_id or (task_dir_path.name if task_dir_path else "")
        if caller_task_id != str(status.get("task_id") or ""):
            raise ValueError("Follow-up task ID does not match the recorded session binding.")
        next_round = int(status.get("current_round") or 1) + 1
        if round_number not in (1, next_round):
            raise ValueError(f"The next follow-up round for this session is {next_round}.")
        round_number = next_round
        inherited_thread_id = str(status.get("codex_thread_id") or "").lower()
        if codex_thread_id and inherited_thread_id and codex_thread_id != inherited_thread_id:
            raise ValueError("Follow-up session belongs to another Codex task.")
        codex_thread_id = codex_thread_id or inherited_thread_id
        slug_value = str(status.get("slug") or slugify(session_dir.name))
        created_at = str(status.get("created_at") or utc_now())
        if gemini_evidence is None:
            inherited_evidence = status.get("gemini_evidence") or status.get("gemini_gate")
            if not inherited_evidence:
                if policy == "required":
                    raise ValueError("Gemini Gate Before GPT Pro is required for follow-up sessions.")
                inherited_evidence = empty_gemini_evidence(policy, role)
            gemini_evidence = dict(inherited_evidence)
            gemini_evidence["inherited_from_round"] = 1
        if routing_evidence is None:
            inherited_routing_evidence = status.get("routing_evidence")
            if inherited_routing_evidence:
                routing_evidence = dict(inherited_routing_evidence)
                routing_evidence["inherited_from_round"] = 1
        if external_intelligence is None and status.get("external_intelligence"):
            external_intelligence = dict(status["external_intelligence"])
            external_intelligence["inherited_from_round"] = 1
    else:
        slug_value = slugify(slug or prompt[:60])
        session_dir = None
        status_file = None
        status = {}
        created_at = utc_now()

    if gemini_evidence is None:
        if policy != "required":
            gemini_evidence = empty_gemini_evidence(policy, role)
        else:
            raise ValueError("CCG_GEMINI_RESPONSE_FILE is required before GPT Pro bridge session creation.")
    gemini_evidence = normalize_gemini_evidence(gemini_evidence, policy, role)
    if policy == "required" and not gemini_evidence.get("available"):
        raise ValueError("CCG_GEMINI_RESPONSE_FILE is required before GPT Pro bridge session creation.")
    if role == "gate" and gemini_evidence.get("available"):
        if task_dir_path is None:
            raise ValueError("Canonical Gemini gate validation requires an active supported task directory.")
        response_value = str(gemini_evidence.get("response_file") or "")
        if not response_value:
            raise ValueError("Canonical Gemini gate validation requires a Gemini response file.")
        response_path = Path(response_value).expanduser()
        if not response_path.is_absolute():
            response_path = workdir_path / response_path
        validate_required_gemini_gate(
            task_dir=task_dir_path,
            evidence_file=evidence_file_path,
            response_file=response_path,
        )
    if project_context is None:
        project_context = detect_project_context(workdir_path)
    routing_evidence = normalize_routing_evidence(routing_evidence, require_routing_evidence)
    if require_routing_evidence and not routing_evidence.get("available"):
        raise ValueError("Base CCG routing evidence is required before GPT Pro bridge session creation.")
    if require_claude_evidence:
        if not routing_evidence.get("available"):
            raise ValueError(
                "Base CCG routing evidence is required when Claude evidence is required before GPT Pro bridge "
                "session creation."
            )
        validate_required_claude_evidence(routing_evidence)
    if require_external_intelligence and not external_intelligence:
        raise ValueError("Required Grok external intelligence must validate before GPT Pro bridge session creation.")

    prompt_gate = dict(gemini_evidence)
    prompt_gate["response_file"] = display_gate_response_file(prompt_gate, workdir_path)
    prompt_routing_evidence = dict(routing_evidence)
    for key in ("evidence_file", "summary_file"):
        prompt_routing_evidence[key] = display_file_value(str(prompt_routing_evidence.get(key) or ""), workdir_path)
    composed_prompt = compose_prompt(
        mode,
        prompt,
        round_number,
        followup_reason,
        prompt_gate,
        prompt_routing_evidence,
        external_intelligence,
        project_context,
    )
    if not composed_prompt.strip() or len(composed_prompt) > MAX_COMPOSED_PROMPT_CHARS:
        raise ValueError(f"Final GPT Pro composed prompt must contain between 1 and {MAX_COMPOSED_PROMPT_CHARS} characters.")
    if session_dir is None:
        session_dir = ensure_unique_session_dir(output_root_path, mode, slug_value).resolve()
        status_file = session_dir / "status.json"

    round_name = f"round-{round_number}"
    round_dir = session_dir / round_name
    round_dir.mkdir(parents=True, exist_ok=True)
    prompt_file = round_dir / "prompt.md"
    response_file = round_dir / "response.md"
    prompt_file.write_text(composed_prompt, encoding="utf-8")
    if not response_file.exists():
        response_file.write_text("", encoding="utf-8")

    rounds = dict(status.get("rounds") or {})
    rounds[round_name] = {
        "prompt_file": display_path(prompt_file, workdir_path),
        "response_file": display_path(response_file, workdir_path),
        "response_saved": False,
    }

    new_status = {
        "schema_version": 1,
        "provider": PROVIDER,
        "mode": mode,
        "slug": slug_value,
        "created_at": created_at,
        "updated_at": utc_now(),
        "session_dir": display_path(session_dir, workdir_path),
        "current_round": round_number,
        "manual_questions_expected": MANUAL_QUESTIONS_EXPECTED,
        "followup_allowed": True,
        "followup_reason": followup_reason,
        "rounds": rounds,
        "workdir": str(workdir_path),
        "manual_copy_required": False,
        "sidebar_transport_required": True,
        "browser_transport_required": ACTIVE_BROWSER_TRANSPORT,
        "preview_token": str(status.get("preview_token") or secrets.token_urlsafe(32)),
        "web_automation": True,
        "dom_extraction": True,
        "cookie_storage": False,
        "auto_submit": True,
        "auto_output_read": True,
        "prompt_copied": bool(status.get("prompt_copied", False)),
        "project_context": project_context,
        "task_id": task_id or (task_dir_path.name if task_dir_path else ""),
        "codex_thread_id": codex_thread_id,
        "task_dir": display_path(task_dir_path, workdir_path) if task_dir_path else "",
        "evidence_file": display_path(evidence_file_path, workdir_path) if evidence_file_path else "",
        "source_command": source_command,
        "gemini_evidence": {
            **gemini_evidence,
            "response_file": display_gate_response_file(gemini_evidence, workdir_path),
        },
        "routing_evidence": {
            **routing_evidence,
            "evidence_file": display_file_value(str(routing_evidence.get("evidence_file") or ""), workdir_path),
            "summary_file": display_file_value(str(routing_evidence.get("summary_file") or ""), workdir_path),
        },
        "external_intelligence": external_intelligence or {},
    }
    if gemini_evidence.get("role") == "gate" and gemini_evidence.get("available"):
        new_status["gemini_gate"] = {
            **gemini_evidence,
            "response_file": display_gate_response_file(gemini_evidence, workdir_path),
        }
    write_json_atomic(status_file, new_status)
    return BridgeSession(mode, workdir_path, session_dir, round_name, prompt_file, response_file, status_file)


def read_batch_request(
    path_value: str | Path,
    *,
    expected_mode: str,
    expected_codex_thread_id: str,
) -> dict[str, Any]:
    try:
        path = Path(path_value).expanduser().resolve(strict=True)
    except OSError as error:
        raise ValueError("--create-batch-manifest must reference an existing JSON file.") from error
    if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
        raise ValueError("GPT Pro batch request must be a JSON file no larger than 2 MiB.")
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("GPT Pro batch request is invalid JSON.") from error
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise ValueError("GPT Pro batch request schemaVersion must be 1.")
    request_mode = str(payload.get("mode") or expected_mode)
    if request_mode != expected_mode:
        raise ValueError("GPT Pro batch request mode does not match --mode.")
    thread_id = str(payload.get("codexThreadId") or expected_codex_thread_id).strip().lower()
    expected_thread = expected_codex_thread_id.strip().lower()
    if CODEX_THREAD_ID_PATTERN.fullmatch(thread_id) is None:
        raise ValueError("GPT Pro batch request requires one exact Codex thread UUID.")
    if expected_thread and expected_thread != thread_id:
        raise ValueError("GPT Pro batch request belongs to another Codex task.")
    max_concurrency = payload.get("maxConcurrency", 3)
    timeout_seconds = payload.get("timeoutSeconds", 7200)
    if not isinstance(max_concurrency, int) or isinstance(max_concurrency, bool) or not 1 <= max_concurrency <= 3:
        raise ValueError("GPT Pro batch maxConcurrency must be between 1 and 3.")
    if not isinstance(timeout_seconds, int) or isinstance(timeout_seconds, bool) or not 30 <= timeout_seconds <= MAX_BATCH_TIMEOUT_SECONDS:
        raise ValueError(f"GPT Pro batch timeoutSeconds must be between 30 and {MAX_BATCH_TIMEOUT_SECONDS}.")
    raw_rounds = payload.get("rounds")
    if not isinstance(raw_rounds, list) or not 1 <= len(raw_rounds) <= 32:
        raise ValueError("GPT Pro batch rounds must contain between 1 and 32 items.")

    seen_rounds: set[str] = set()
    seen_keys: set[str] = set()
    seen_targets: set[tuple[str, str, str, str]] = set()
    rounds: list[dict[str, Any]] = []
    for raw_round in raw_rounds:
        if not isinstance(raw_round, dict):
            raise ValueError("Every GPT Pro batch round must be an object.")
        round_id = str(raw_round.get("roundId") or "")
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", round_id) is None or round_id in seen_rounds:
            raise ValueError("GPT Pro batch roundId values must be unique bounded identifiers.")
        seen_rounds.add(round_id)
        prompt = raw_round.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_COMPOSED_PROMPT_CHARS:
            raise ValueError(f"Every GPT Pro batch round requires a non-empty prompt no larger than {MAX_COMPOSED_PROMPT_CHARS} characters.")
        idempotency_key = raw_round.get("idempotencyKey")
        if (
            not isinstance(idempotency_key, str)
            or IDEMPOTENCY_KEY_PATTERN.fullmatch(idempotency_key) is None
            or idempotency_key in seen_keys
        ):
            raise ValueError("GPT Pro batch idempotency keys must be unique and match ^[A-Za-z0-9._:-]{1,128}$.")
        seen_keys.add(idempotency_key)
        target = raw_round.get("targetBinding")
        normalized_target: dict[str, str] | None = None
        if target is not None:
            if not isinstance(target, dict):
                raise ValueError("GPT Pro batch targetBinding must be an object.")
            normalized_target = {}
            for field in ("browserId", "profileId", "tabId", "sessionKey"):
                value = target.get(field)
                if (
                    not isinstance(value, str)
                    or not value.strip()
                    or len(value) > 512
                    or CONTROL_CHAR_PATTERN.search(value)
                ):
                    raise ValueError(f"GPT Pro batch targetBinding has an invalid {field}.")
                normalized_target[field] = value
            target_key = tuple(normalized_target[field] for field in ("browserId", "profileId", "tabId", "sessionKey"))
            if target_key in seen_targets:
                raise ValueError("GPT Pro batch targetBinding values must be unique.")
            seen_targets.add(target_key)
        if len(raw_rounds) > 1 and normalized_target is None:
            raise ValueError("Multi-round GPT Pro batches require one complete targetBinding per round.")
        fresh_conversation = raw_round.get("freshConversation", False)
        if not isinstance(fresh_conversation, bool):
            raise ValueError("GPT Pro batch freshConversation must be boolean.")
        rounds.append(
            {
                "round_id": round_id,
                "prompt": prompt,
                "idempotency_key": idempotency_key,
                "target_binding": normalized_target,
                "fresh_conversation": fresh_conversation,
            }
        )
    return {
        "path": path,
        "mode": request_mode,
        "codex_thread_id": thread_id,
        "max_concurrency": max_concurrency,
        "timeout_seconds": timeout_seconds,
        "slug": slugify(str(payload.get("slug") or path.stem)),
        "rounds": rounds,
    }


def create_batch_sessions(
    *,
    request: dict[str, Any],
    workdir: Path,
    output_root: Path,
    task_dir: Path | None,
    task_id: str,
    evidence_file: Path | None,
    source_command: str,
    gemini_evidence: dict[str, Any] | None,
    gemini_policy: str,
    gemini_evidence_role: str,
    routing_evidence: dict[str, Any] | None,
    require_routing_evidence: bool,
    require_claude_evidence: bool,
    external_intelligence: dict[str, Any] | None,
    require_external_intelligence: bool,
    project_context: dict[str, Any],
) -> dict[str, Any]:
    output_root.mkdir(parents=True, exist_ok=True)
    batch_dir = ensure_unique_session_dir(output_root, "batch", str(request["slug"])).resolve()
    batch_id = secrets.token_hex(16)
    watcher_rounds: list[dict[str, Any]] = []
    created_rounds: list[tuple[BridgeSession, dict[str, Any], Path]] = []
    items: list[dict[str, Any]] = []
    for batch_round in request["rounds"]:
        session = create_session(
            mode=str(request["mode"]),
            workdir=workdir,
            prompt=str(batch_round["prompt"]),
            slug=f"{request['slug']}-{batch_round['round_id']}",
            output_root=batch_dir,
            task_dir=task_dir,
            task_id=task_id,
            evidence_file=evidence_file,
            source_command=source_command,
            round_number=1,
            followup_session=None,
            followup_reason=None,
            gemini_evidence=gemini_evidence,
            gemini_policy=gemini_policy,
            gemini_evidence_role=gemini_evidence_role,
            routing_evidence=routing_evidence,
            require_routing_evidence=require_routing_evidence,
            require_claude_evidence=require_claude_evidence,
            external_intelligence=external_intelligence,
            require_external_intelligence=require_external_intelligence,
            project_context=project_context,
            codex_thread_id=str(request["codex_thread_id"]),
        )
        sidebar_dir = session.prompt_file.parent / "sidebar"
        sidebar_dir.mkdir()
        watcher_round = {
            "roundId": batch_round["round_id"],
            "promptPath": str(session.prompt_file),
            "evidenceDirectory": str(sidebar_dir),
            "idempotencyKey": batch_round["idempotency_key"],
            "freshConversation": batch_round["fresh_conversation"],
        }
        if batch_round["target_binding"] is not None:
            watcher_round["targetBinding"] = batch_round["target_binding"]
        watcher_rounds.append(watcher_round)
        created_rounds.append((session, batch_round, sidebar_dir))
    watcher_manifest_path = batch_dir / "batch-manifest.json"
    watcher_result_path = batch_dir / "batch-result.json"
    batch_file = batch_dir / "ccg-batch.json"
    write_json_atomic(
        watcher_manifest_path,
        {
            "schemaVersion": 1,
            "codexThreadId": request["codex_thread_id"],
            "maxConcurrency": request["max_concurrency"],
            "timeoutSeconds": request["timeout_seconds"],
            "rounds": watcher_rounds,
        },
    )
    watcher_manifest_sha256 = sha256_path(watcher_manifest_path)
    for session, batch_round, sidebar_dir in created_rounds:
        batch_binding = {
            "schemaVersion": 1,
            "batchId": batch_id,
            "roundId": batch_round["round_id"],
            "watcherManifestSha256": watcher_manifest_sha256,
            "idempotencyKeySha256": hashlib.sha256(batch_round["idempotency_key"].encode("utf-8")).hexdigest(),
            "promptSha256": sha256_sidebar_prompt_path(session.prompt_file),
            "targetBinding": batch_round["target_binding"],
            "freshConversation": batch_round["fresh_conversation"],
        }
        status = session.status()
        status["batch"] = batch_binding
        session.write_status(status)
        items.append(
            {
                "roundId": batch_round["round_id"],
                "sessionDir": str(session.session_dir),
                "statusFile": str(session.status_file),
                "promptPath": str(session.prompt_file),
                "responsePath": str(session.response_file),
                "evidenceDirectory": str(sidebar_dir),
                "idempotencyKeySha256": batch_binding["idempotencyKeySha256"],
                "batchBinding": batch_binding,
            }
        )
    batch = {
        "schemaVersion": 1,
        "batchId": batch_id,
        "mode": request["mode"],
        "codexThreadId": request["codex_thread_id"],
        "createdAtUtc": utc_now(),
        "batchDirectory": str(batch_dir),
        "watcherManifestFile": str(watcher_manifest_path),
        "watcherManifestSha256": watcher_manifest_sha256,
        "watcherResultFile": str(watcher_result_path),
        "importResultFile": str(batch_dir / "ccg-batch-import.json"),
        "items": items,
    }
    write_json_atomic(batch_file, batch)
    batch["batchFile"] = str(batch_file)
    return batch


def resolve_batch_file(path_value: str | Path) -> Path:
    candidate = Path(path_value).expanduser().resolve()
    if candidate.is_dir():
        candidate = candidate / "ccg-batch.json"
    if candidate.name != "ccg-batch.json" or not candidate.is_file():
        raise ValueError("--import-batch-result must reference one ccg-batch.json file or its directory.")
    return candidate


def import_batch_result(path_value: str | Path, expected_codex_thread_id: str) -> dict[str, Any]:
    expected_thread = expected_codex_thread_id.strip().lower()
    if CODEX_THREAD_ID_PATTERN.fullmatch(expected_thread) is None:
        raise ValueError("--expected-codex-thread-id is required for batch result import.")
    batch_file = resolve_batch_file(path_value)
    batch_root = batch_file.parent.resolve()
    batch = read_sidebar_json(batch_file, "batch mapping")
    if batch.get("schemaVersion") != 1 or str(batch.get("codexThreadId") or "").lower() != expected_thread:
        raise ValueError("GPT Pro batch mapping belongs to another Codex task or schema.")
    watcher_manifest_path = Path(str(batch.get("watcherManifestFile") or "")).resolve()
    watcher_result_path = Path(str(batch.get("watcherResultFile") or "")).resolve()
    if watcher_manifest_path != batch_root / "batch-manifest.json" or watcher_result_path != batch_root / "batch-result.json":
        raise ValueError("GPT Pro batch mapping references unexpected watcher files.")
    watcher_manifest_sha256 = sha256_path(watcher_manifest_path)
    if batch.get("watcherManifestSha256") != watcher_manifest_sha256:
        raise ValueError("GPT Pro batch watcher manifest hash does not match its durable mapping.")
    watcher_manifest = read_sidebar_json(watcher_manifest_path, "batch watcher manifest")
    watcher_result = read_sidebar_json(watcher_result_path, "batch watcher result")
    if (
        watcher_manifest.get("schemaVersion") != 1
        or watcher_result.get("schemaVersion") != 1
        or str(watcher_manifest.get("codexThreadId") or "").lower() != expected_thread
        or str(watcher_result.get("codexThreadId") or "").lower() != expected_thread
        or watcher_result.get("status") != "terminal"
    ):
        raise ValueError("GPT Pro batch watcher identity or terminal state is invalid.")
    mapping_items = batch.get("items")
    manifest_items = watcher_manifest.get("rounds")
    result_items = watcher_result.get("items")
    if not all(isinstance(value, list) for value in (mapping_items, manifest_items, result_items)):
        raise ValueError("GPT Pro batch item collections are invalid.")
    mapping_by_round = {str(item.get("roundId") or ""): item for item in mapping_items if isinstance(item, dict)}
    manifest_by_round = {str(item.get("roundId") or ""): item for item in manifest_items if isinstance(item, dict)}
    result_by_round = {str(item.get("roundId") or ""): item for item in result_items if isinstance(item, dict)}
    expected_rounds = set(mapping_by_round)
    if (
        not expected_rounds
        or len(mapping_by_round) != len(mapping_items)
        or len(manifest_by_round) != len(manifest_items)
        or len(result_by_round) != len(result_items)
        or set(manifest_by_round) != expected_rounds
        or set(result_by_round) != expected_rounds
    ):
        raise ValueError("GPT Pro batch round identities are missing, duplicated, or mismatched.")

    batch_id = str(batch.get("batchId") or "")
    validated_items: list[tuple[BridgeSession, Path, dict[str, Any], bool]] = []
    for round_id in sorted(expected_rounds):
        mapping = mapping_by_round[round_id]
        watcher_round = manifest_by_round[round_id]
        result = result_by_round[round_id]
        session_dir = Path(str(mapping.get("sessionDir") or "")).resolve()
        if session_dir.parent != batch_root:
            raise ValueError("GPT Pro batch session escaped its batch directory.")
        session = load_session(session_dir)
        manifest_key = watcher_round.get("idempotencyKey")
        manifest_target = watcher_round.get("targetBinding")
        fresh_conversation = watcher_round.get("freshConversation")
        if not isinstance(manifest_key, str) or IDEMPOTENCY_KEY_PATTERN.fullmatch(manifest_key) is None:
            raise ValueError("GPT Pro batch manifest idempotency key is invalid.")
        if not isinstance(fresh_conversation, bool):
            raise ValueError("GPT Pro batch manifest freshConversation is invalid.")
        normalized_target: dict[str, str] | None = None
        if manifest_target is not None:
            if not isinstance(manifest_target, dict):
                raise ValueError("GPT Pro batch manifest target binding is invalid.")
            normalized_target = {}
            for field in ("browserId", "profileId", "tabId", "sessionKey"):
                value = manifest_target.get(field)
                if not isinstance(value, str) or not value.strip() or len(value) > 512 or any(char in value for char in "\r\n"):
                    raise ValueError("GPT Pro batch manifest target binding is invalid.")
                normalized_target[field] = value
        if (
            Path(str(mapping.get("statusFile") or "")).resolve() != session.status_file
            or Path(str(mapping.get("promptPath") or "")).resolve() != session.prompt_file
            or Path(str(mapping.get("responsePath") or "")).resolve() != session.response_file
            or Path(str(watcher_round.get("promptPath") or "")).resolve() != session.prompt_file
        ):
            raise ValueError("GPT Pro batch session artifact binding mismatch.")
        expected_binding = {
            "schemaVersion": 1,
            "batchId": batch_id,
            "roundId": round_id,
            "watcherManifestSha256": watcher_manifest_sha256,
            "idempotencyKeySha256": hashlib.sha256(manifest_key.encode("utf-8")).hexdigest(),
            "promptSha256": sha256_sidebar_prompt_path(session.prompt_file),
            "targetBinding": normalized_target,
            "freshConversation": fresh_conversation,
        }
        if (
            mapping.get("batchBinding") != expected_binding
            or session.status().get("batch") != expected_binding
            or mapping.get("idempotencyKeySha256") != expected_binding["idempotencyKeySha256"]
        ):
            raise ValueError("GPT Pro batch intent binding does not match manifest, mapping, and session status.")
        evidence_dir = Path(str(mapping.get("evidenceDirectory") or "")).resolve()
        expected_evidence_dir = (session.prompt_file.parent / "sidebar").resolve()
        if (
            evidence_dir != expected_evidence_dir
            or Path(str(watcher_round.get("evidenceDirectory") or "")).resolve() != evidence_dir
            or Path(str(result.get("evidenceDirectory") or "")).resolve() != evidence_dir
        ):
            raise ValueError("GPT Pro batch evidence directory binding mismatch.")
        terminal_status = str(result.get("terminalStatus") or "")
        status = str(result.get("status") or "")
        item_summary: dict[str, Any] = {
            "roundId": round_id,
            "sessionDir": str(session_dir),
            "evidenceDirectory": str(evidence_dir),
            "terminalStatus": terminal_status,
            "status": status,
            "imported": False,
        }
        if terminal_status == "completed" and status == "completed":
            state = read_sidebar_json(evidence_dir / "state.json", "batch state")
            event = read_sidebar_json(evidence_dir / "watch-event.json", "batch watch event")
            exact_fields = {
                "promptSha256": state.get("promptSha256"),
                "responseSha256": state.get("responseSha256"),
                "evidenceSha256": state.get("evidenceSha256"),
                "conversationUrl": state.get("conversationUrlBound"),
                "watcherId": event.get("watcherId"),
            }
            if any(not value or result.get(key) != value for key, value in exact_fields.items()):
                raise ValueError("GPT Pro batch result hashes, URL, or watcher binding mismatch.")
            if (
                state.get("promptSha256") != expected_binding["promptSha256"]
                or state.get("idempotencyKeySha256") != expected_binding["idempotencyKeySha256"]
            ):
                raise ValueError("GPT Pro batch adapter state does not match the original prompt or idempotency key.")
            result_target = result.get("targetBinding") or {}
            state_target = state.get("targetBinding") or {}
            if any(result_target.get(key) != state_target.get(key) for key in ("browserId", "profileId", "tabId", "sessionKey")):
                raise ValueError("GPT Pro batch result target binding mismatch.")
            if normalized_target is not None and not fresh_conversation and any(
                state_target.get(key) != normalized_target[key] for key in ("browserId", "profileId", "tabId", "sessionKey")
            ):
                raise ValueError("GPT Pro batch adapter target does not match the original target binding.")
            if result.get("submissionAcknowledged") is not True:
                raise ValueError("GPT Pro completed batch result lacks submission acknowledgement.")
        validated_items.append((session, evidence_dir, item_summary, terminal_status == "completed" and status == "completed"))

    imported_items: list[dict[str, Any]] = []
    for session, evidence_dir, item_summary, should_import in validated_items:
        if should_import:
            imported = import_sidebar_evidence(session, evidence_dir, expected_thread)
            item_summary.update(
                {
                    "imported": True,
                    "conversationUrl": imported["conversationUrl"],
                    "watcherId": imported["watcherId"],
                    "sidebarEvidenceSha256": imported["sidebarEvidenceSha256"],
                }
            )
        imported_items.append(item_summary)
    summary = {
        "schemaVersion": 1,
        "batchId": batch.get("batchId"),
        "codexThreadId": expected_thread,
        "importedAtUtc": utc_now(),
        "allImported": all(item["imported"] for item in imported_items),
        "items": imported_items,
    }
    import_path = batch_root / "ccg-batch-import.json"
    write_json_atomic(import_path, summary)
    summary["importResultFile"] = str(import_path)
    return summary


def load_session(session_value: str | Path) -> BridgeSession:
    session_dir = resolve_existing_session_dir(session_value)
    status_file = session_dir / "status.json"
    status = json.loads(status_file.read_text(encoding="utf-8"))
    round_name = f"round-{status.get('current_round', 1)}"
    workdir = resolve_workdir(str(status.get("workdir") or session_dir))
    resolve_session_status_binding(session_dir, workdir, status)
    return BridgeSession(
        str(status.get("mode", "plan")),
        workdir,
        session_dir,
        round_name,
        session_dir / round_name / "prompt.md",
        session_dir / round_name / "response.md",
        status_file,
    )


def resolve_existing_session_dir(session_value: str | Path) -> Path:
    try:
        session_dir = Path(str(session_value)).expanduser().resolve(strict=True)
    except OSError as error:
        raise ValueError(f"Session directory not found: {session_value}") from error
    if not session_dir.is_dir():
        raise ValueError(f"Session path must be a directory: {session_dir}")
    status_file = session_dir / "status.json"
    if not status_file.is_file():
        raise ValueError(f"Session status file not found: {status_file}")
    status = json.loads(status_file.read_text(encoding="utf-8"))
    if not isinstance(status, dict):
        raise ValueError("Session status must be a JSON object.")
    if status.get("provider") not in LEGACY_PROVIDERS:
        raise ValueError("Session is not a supported GPT Pro bridge session.")
    return session_dir


def resolve_status_path(workdir: Path, value: str) -> Path | None:
    if not value:
        return None
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        candidate = workdir / candidate
    return candidate.resolve()


def resolve_session_status_binding(
    session_dir: Path,
    workdir: Path,
    status: dict[str, Any],
) -> tuple[Path | None, Path | None]:
    try:
        session_dir.resolve().relative_to(workdir.resolve())
    except ValueError:
        raise ValueError("GPT Pro bridge session must stay inside its recorded workdir.") from None
    recorded_session_dir = resolve_status_path(workdir, str(status.get("session_dir") or ""))
    if recorded_session_dir is not None and recorded_session_dir != session_dir.resolve():
        raise ValueError("GPT Pro bridge session directory does not match its recorded binding.")

    task_value = str(status.get("task_dir") or "")
    evidence_value = str(status.get("evidence_file") or "")
    if not task_value:
        if evidence_value:
            raise ValueError("Canonical evidence file requires a recorded task directory.")
        return None, None
    task_dir = resolve_task_dir(workdir, task_value, str(status.get("task_id") or ""))
    evidence_file = resolve_status_path(workdir, evidence_value)
    if evidence_file is not None:
        ensure_within_dir(evidence_file, task_dir, "Canonical evidence file")
    return task_dir, evidence_file


def relative_artifact_path(path_value: Path, base_dir: Path) -> str:
    try:
        return path_value.resolve().relative_to(base_dir.resolve()).as_posix()
    except ValueError:
        return str(path_value.resolve())


def read_sidebar_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"ChatGPT Pro sidebar {label} is missing or invalid: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"ChatGPT Pro sidebar {label} must be a JSON object: {path}")
    return value


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sha256_sidebar_prompt_path(path: Path) -> str:
    try:
        prompt_text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("The current bridge prompt must be UTF-8.") from error
    normalized = prompt_text.replace("\r\n", "\n").replace("\r", "\n").rstrip("\r\n")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def sidebar_artifact_path(root: Path, value: Any, expected_name: str) -> Path:
    if value != expected_name:
        raise ValueError(f"ChatGPT Pro sidebar evidence must reference {expected_name}.")
    candidate = (root / expected_name).resolve()
    if candidate.parent != root or not candidate.is_file():
        raise ValueError(f"ChatGPT Pro sidebar evidence file is missing: {candidate}")
    return candidate


def write_sidebar_import_ack(
    evidence_dir: Path,
    *,
    codex_thread_id: str,
    watcher_id: str,
    response_sha256: str,
    evidence_sha256: str,
    conversation_url: str,
) -> Path:
    ack_path = evidence_dir / "watch-continuation-ack.json"
    stable_fields = {
        "schemaVersion": 1,
        "transport": "ccg-gptpro-bridge",
        "acknowledged": True,
        "acknowledgementType": "ccg-imported",
        "codexThreadId": codex_thread_id,
        "watcherId": watcher_id,
        "responseSha256": response_sha256,
        "sidebarEvidenceSha256": evidence_sha256,
        "conversationUrl": conversation_url,
    }
    existing = read_sidebar_json(ack_path, "continuation acknowledgement") if ack_path.exists() else None
    if existing is not None:
        if any(existing.get(key) != value for key, value in stable_fields.items()):
            raise ValueError("ChatGPT Pro sidebar continuation acknowledgement conflicts with this import.")
        return ack_path
    acknowledgement = {**stable_fields, "acknowledgedAtUtc": utc_now()}
    temporary = ack_path.with_name(f"{ack_path.name}.{os.getpid()}.tmp")
    try:
        temporary.write_text(
            json.dumps(acknowledgement, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, ack_path)
    finally:
        temporary.unlink(missing_ok=True)
    return ack_path


def validate_agent_browser_target_binding(
    value: Any,
    *,
    label: str,
    conversation_url: str,
) -> dict[str, str]:
    if not isinstance(value, dict):
        raise ValueError(f"ChatGPT Pro browser {label} is missing.")
    normalized: dict[str, str] = {}
    for key in ("browserId", "profileId", "tabId", "sessionKey"):
        item = value.get(key)
        if not isinstance(item, str) or not item.strip() or len(item) > 512 or any(char in item for char in "\r\n"):
            raise ValueError(f"ChatGPT Pro browser {label} has an invalid {key}.")
        normalized[key] = item
    profile_label = value.get("profileLabel") or ""
    if not isinstance(profile_label, str) or len(profile_label) > 512 or any(char in profile_label for char in "\r\n"):
        raise ValueError(f"ChatGPT Pro browser {label} has an invalid profileLabel.")
    normalized["profileLabel"] = profile_label
    if value.get("origin") != "https://chatgpt.com" or value.get("url") != conversation_url:
        raise ValueError(f"ChatGPT Pro browser {label} does not match the exact conversation URL.")
    normalized["origin"] = "https://chatgpt.com"
    normalized["url"] = conversation_url
    return normalized


def import_sidebar_evidence(
    session: BridgeSession,
    evidence_directory: str | Path,
    expected_codex_thread_id: str,
) -> dict[str, Any]:
    expected_codex_thread_id = expected_codex_thread_id.strip().lower()
    if CODEX_THREAD_ID_PATTERN.fullmatch(expected_codex_thread_id) is None:
        raise ValueError("--expected-codex-thread-id is required for sidebar evidence import.")
    try:
        evidence_dir = Path(evidence_directory).expanduser().resolve(strict=True)
    except OSError as error:
        raise ValueError("ChatGPT Pro sidebar evidence directory is missing.") from error
    if not evidence_dir.is_dir():
        raise ValueError("ChatGPT Pro sidebar evidence path must be a directory.")
    round_dir = session.prompt_file.parent.resolve()
    if evidence_dir.parent != round_dir or evidence_dir.name != "sidebar":
        raise ValueError(
            "ChatGPT Pro sidebar evidence must be the current bridge round's direct sidebar directory."
        )

    state_path = evidence_dir / "state.json"
    evidence_path = evidence_dir / "evidence.json"
    event_path = evidence_dir / "watch-event.json"
    state = read_sidebar_json(state_path, "state")
    sidebar_evidence = read_sidebar_json(evidence_path, "manifest")
    event = read_sidebar_json(event_path, "watch event")

    for label, value in (
        ("state tool", state.get("tool")),
        ("manifest tool", sidebar_evidence.get("tool")),
    ):
        if value != "chatgpt-pro-sidebar":
            raise ValueError(f"Invalid ChatGPT Pro sidebar {label}.")
    state_transport = state.get("transport")
    manifest_transport = sidebar_evidence.get("transport")
    if state_transport != manifest_transport or state_transport not in {
        ACTIVE_BROWSER_TRANSPORT,
        HISTORICAL_BROWSER_TRANSPORT,
    }:
        raise ValueError("Invalid or mismatched ChatGPT Pro browser transport.")
    session_status = session.status()
    session_thread_id = str(session_status.get("codex_thread_id") or "").lower()
    if session_thread_id and session_thread_id != expected_codex_thread_id:
        raise ValueError("ChatGPT Pro bridge session belongs to another Codex task.")
    required_transport = session_status.get("browser_transport_required")
    if required_transport is not None and required_transport != ACTIVE_BROWSER_TRANSPORT:
        raise ValueError("Invalid required ChatGPT Pro browser transport in session status.")
    if required_transport and state_transport != required_transport:
        raise ValueError("ChatGPT Pro browser transport does not match this session.")
    if required_transport is None and state_transport != HISTORICAL_BROWSER_TRANSPORT:
        raise ValueError("Legacy GPT Pro sessions only accept completed historical windows-uia evidence.")
    if state.get("live") is not True or sidebar_evidence.get("live") is not True:
        raise ValueError("ChatGPT Pro sidebar import requires live evidence.")
    if state.get("phase") != "completed" or event.get("status") != "completed":
        raise ValueError("ChatGPT Pro sidebar watcher has not completed successfully.")
    for label, payload in (("state", state), ("watch event", event)):
        if "terminalOutcome" in payload and payload.get("terminalOutcome") != "completed":
            raise ValueError(f"ChatGPT Pro sidebar {label} terminalOutcome must be completed.")
    if event.get("requiresCodexReview") is not True:
        raise ValueError("ChatGPT Pro sidebar watch event must require Codex review.")
    if (
        state.get("automaticResendAllowed") is not False
        or event.get("automaticResendAllowed") is not False
        or (sidebar_evidence.get("submission") or {}).get("automaticResendAllowed") is not False
    ):
        raise ValueError("ChatGPT Pro sidebar evidence must prohibit automatic resend.")
    authority = sidebar_evidence.get("authority") or {}
    if (
        authority.get("externalOutputIsUntrusted") is not True
        or authority.get("codexIsSoleWorkspaceWriter") is not True
    ):
        raise ValueError("ChatGPT Pro sidebar authority boundary is missing.")

    event_thread_id = str(event.get("codexThreadId") or "").lower()
    if event_thread_id != expected_codex_thread_id:
        raise ValueError("ChatGPT Pro sidebar evidence belongs to another Codex task.")
    event_directory = Path(str(event.get("evidenceDirectory") or "")).expanduser().resolve()
    if event_directory != evidence_dir:
        raise ValueError("ChatGPT Pro sidebar watch event evidence directory does not match.")

    prompt_entry = sidebar_evidence.get("prompt") or {}
    response_entry = sidebar_evidence.get("response") or {}
    conversation_entry = sidebar_evidence.get("conversation") or {}
    submission_entry = sidebar_evidence.get("submission") or {}
    prompt_path = sidebar_artifact_path(evidence_dir, state.get("promptFile"), "prompt.md")
    sidebar_artifact_path(evidence_dir, prompt_entry.get("file"), "prompt.md")
    response_path = sidebar_artifact_path(evidence_dir, state.get("responseFile"), "response.md")
    sidebar_artifact_path(evidence_dir, response_entry.get("file"), "response.md")
    url_path = sidebar_artifact_path(evidence_dir, state.get("urlFile"), "url.txt")
    sidebar_artifact_path(evidence_dir, conversation_entry.get("file"), "url.txt")
    sidebar_artifact_path(evidence_dir, state.get("evidenceFile"), "evidence.json")

    prompt_sha256 = sha256_path(prompt_path)
    response_sha256 = sha256_path(response_path)
    url_sha256 = sha256_path(url_path)
    evidence_sha256 = sha256_path(evidence_path)
    if (
        prompt_sha256 != state.get("promptSha256")
        or prompt_sha256 != prompt_entry.get("sha256")
        or prompt_sha256 != sha256_sidebar_prompt_path(session.prompt_file)
    ):
        raise ValueError("ChatGPT Pro sidebar prompt hash does not bind the current bridge round.")
    if response_sha256 != state.get("responseSha256") or response_sha256 != response_entry.get("sha256"):
        raise ValueError("ChatGPT Pro sidebar response hash mismatch.")
    if url_sha256 != state.get("urlSha256") or url_sha256 != conversation_entry.get("sha256"):
        raise ValueError("ChatGPT Pro sidebar conversation URL hash mismatch.")
    if evidence_sha256 != state.get("evidenceSha256"):
        raise ValueError("ChatGPT Pro sidebar manifest hash mismatch.")

    response_bytes = response_path.read_bytes()
    if not response_bytes or len(response_bytes) > MAX_RESPONSE_BYTES:
        raise ValueError("ChatGPT Pro sidebar response is empty or exceeds the bridge limit.")
    try:
        response_text = response_bytes.decode("utf-8")
    except UnicodeDecodeError as error:
        raise ValueError("ChatGPT Pro sidebar response must be UTF-8.") from error
    if not response_text.strip():
        raise ValueError("ChatGPT Pro sidebar response cannot be empty.")

    conversation_url = url_path.read_text(encoding="utf-8").strip()
    if not is_chatgpt_conversation_url(conversation_url):
        raise ValueError("ChatGPT Pro sidebar evidence lacks one exact conversation URL.")
    if (
        conversation_entry.get("url") != conversation_url
        or conversation_entry.get("boundAtSend") != conversation_url
        or conversation_entry.get("exact") is not True
        or conversation_entry.get("matchedBoundUrl") is not True
        or state.get("conversationUrl") != conversation_url
        or state.get("conversationUrlBound") != conversation_url
        or event.get("conversationUrl") != conversation_url
    ):
        raise ValueError("ChatGPT Pro sidebar conversation binding mismatch.")
    if state_transport == ACTIVE_BROWSER_TRANSPORT:
        if event.get("transport") != ACTIVE_BROWSER_TRANSPORT:
            raise ValueError("ChatGPT Pro browser watch event transport mismatch.")
        bindings = (
            validate_agent_browser_target_binding(
                state.get("targetBinding"), label="state target binding", conversation_url=conversation_url
            ),
            validate_agent_browser_target_binding(
                (sidebar_evidence.get("extractor") or {}).get("targetBinding"),
                label="manifest target binding",
                conversation_url=conversation_url,
            ),
            validate_agent_browser_target_binding(
                event.get("targetBinding"), label="watch target binding", conversation_url=conversation_url
            ),
        )
        if bindings[0] != bindings[1] or bindings[0] != bindings[2]:
            raise ValueError("ChatGPT Pro browser target bindings do not match.")
    acknowledged = submission_entry.get("acknowledged") is True
    observational_recovery = submission_entry.get("observationalRecovery") is True
    if not acknowledged and not observational_recovery:
        raise ValueError("ChatGPT Pro sidebar submission was neither acknowledged nor recovered observationally.")
    watcher_id = str(event.get("watcherId") or "").lower()
    if not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", watcher_id):
        raise ValueError("ChatGPT Pro sidebar watch event lacks one exact watcher ID.")

    transport_metadata = {
        "transport": "chatgpt-pro-sidebar",
        "browserTransport": state_transport,
        "sidebarEvidenceDirectory": display_path(evidence_dir, session.workdir),
        "sidebarEvidenceFile": display_path(evidence_path, session.workdir),
        "sidebarEvidenceSha256": evidence_sha256,
        "sidebarWatchEventFile": display_path(event_path, session.workdir),
        "sidebarWatchEventSha256": sha256_path(event_path),
        "conversationUrl": conversation_url,
        "codexThreadId": event_thread_id,
        "watcherId": watcher_id,
        "submissionAcknowledged": acknowledged,
        "observationalRecovery": observational_recovery,
        "automaticResendAllowed": False,
        "externalOutputIsUntrusted": True,
        "codexIsSoleWorkspaceWriter": True,
    }
    _persist_response(session, response_text, transport_metadata=transport_metadata)
    acknowledgement_path = write_sidebar_import_ack(
        evidence_dir,
        codex_thread_id=event_thread_id,
        watcher_id=watcher_id,
        response_sha256=response_sha256,
        evidence_sha256=evidence_sha256,
        conversation_url=conversation_url,
    )
    transport_metadata["continuationAcknowledgementFile"] = display_path(
        acknowledgement_path,
        session.workdir,
    )
    return transport_metadata


def append_gptpro_evidence(
    session: BridgeSession,
    status: dict[str, Any],
    response_text: str,
    transport_metadata: dict[str, Any] | None = None,
) -> None:
    task_dir, evidence_file = resolve_session_status_binding(session.session_dir, session.workdir, status)
    if evidence_file is None or task_dir is None:
        return
    response_bytes = response_text.encode("utf-8")
    session_id = session.session_dir.name
    task_id = str(status.get("task_id") or task_dir.name)
    codex_thread_id = str((transport_metadata or {}).get("codexThreadId") or status.get("codex_thread_id") or "").lower()
    item_id = f"gptpro-{status.get('mode', session.mode)}-{session_id}-{session.round_name}"
    item = {
        "id": item_id,
        "provider": "gptpro",
        "role": "execution-companion" if session.mode == "exc" else session.mode,
        "policy": "automated-sidebar" if transport_metadata else "legacy-manual-preview",
        "available": True,
        "artifactFile": relative_artifact_path(session.response_file, task_dir),
        "artifactSha256": hashlib.sha256(response_bytes).hexdigest(),
        "artifactChars": len(response_text),
        "artifactBytes": len(response_bytes),
        "summary": (
            f"ChatGPT Pro sidebar {session.mode} response imported for {session.round_name}."
            if transport_metadata
            else f"Legacy manual GPT Pro {session.mode} response saved for {session.round_name}."
        ),
        "sessionId": session_id,
        "taskId": task_id,
        "codexThreadId": codex_thread_id,
        "round": int(status.get("current_round", 1)),
        "createdAt": utc_now(),
    }
    if session.mode == "exc":
        item.update(
            {
                "displayRole": "execution-route-review",
                "semanticRole": "route-review",
                "implementationOwner": False,
                "summary": (
                    f"ChatGPT Pro sidebar execution route review response imported for {session.round_name}."
                    if transport_metadata
                    else f"Legacy manual GPT Pro execution route review response saved for {session.round_name}."
                ),
            }
        )
    if transport_metadata:
        item.update(
            {
                "transport": transport_metadata["transport"],
                "browserTransport": transport_metadata["browserTransport"],
                "conversationUrl": transport_metadata["conversationUrl"],
                "codexThreadId": codex_thread_id,
                "submissionAcknowledged": transport_metadata["submissionAcknowledged"],
                "observationalRecovery": transport_metadata["observationalRecovery"],
                "automaticResendAllowed": False,
                "externalOutputIsUntrusted": True,
                "codexIsSoleWorkspaceWriter": True,
                "sidebarEvidenceFile": relative_artifact_path(
                    resolve_status_path(
                        session.workdir,
                        str(transport_metadata["sidebarEvidenceFile"]),
                    )
                    or session.status_file,
                    task_dir,
                ),
                "sidebarEvidenceSha256": transport_metadata["sidebarEvidenceSha256"],
            }
        )
    dedupe_key = (item["provider"], item["taskId"], item["codexThreadId"], item["sessionId"], item["round"])
    with locked_file(evidence_file.with_name(f".{evidence_file.name}.lock")):
        try:
            evidence = json.loads(evidence_file.read_text(encoding="utf-8"))
        except FileNotFoundError:
            evidence = {"schemaVersion": 1, "items": []}
        except json.JSONDecodeError as error:
            raise ValueError(f"Canonical evidence file is malformed: {evidence_file}") from error
        items = list(evidence.get("items") or [])
        items = [
            existing
            for existing in items
            if (
                existing.get("provider"),
                existing.get("taskId", task_id),
                str(existing.get("codexThreadId") or "").lower(),
                existing.get("sessionId"),
                existing.get("round"),
            ) != dedupe_key
        ]
        items.append(item)
        items.sort(key=lambda entry: (
            str(entry.get("provider", "")), str(entry.get("role", "")), str(entry.get("id", "")),
        ))
        write_json_atomic(evidence_file, {"schemaVersion": 1, "items": items})


def _persist_response(
    session: BridgeSession,
    response_text: str,
    *,
    transport_metadata: dict[str, Any] | None = None,
) -> None:
    if not response_text.strip():
        raise ValueError("GPT Pro response cannot be empty.")
    response_bytes = response_text.encode("utf-8")
    if len(response_bytes) > MAX_RESPONSE_BYTES:
        raise ValueError("GPT Pro response exceeds the bridge limit.")
    with locked_file(session.lock_file):
        status = session.status()
        required_transport = status.get("browser_transport_required")
        if required_transport is not None:
            if required_transport != ACTIVE_BROWSER_TRANSPORT:
                raise ValueError("GPT Pro session has an invalid required browser transport.")
            if (
                not isinstance(transport_metadata, dict)
                or transport_metadata.get("transport") != PROVIDER
                or transport_metadata.get("browserTransport") != required_transport
            ):
                raise ValueError("V2 GPT Pro responses require a completed sidebar import with verified transport metadata.")
        existing_bytes = session.response_file.read_bytes() if session.response_file.exists() else b""
        if existing_bytes and existing_bytes != response_bytes:
            raise ValueError("GPT Pro response is already saved with different content.")
        if not existing_bytes:
            write_bytes_atomic(session.response_file, response_bytes)
        round_status = status["rounds"][session.round_name]
        round_status["response_saved"] = True
        round_status["response_chars"] = len(response_text)
        round_status["response_bytes"] = len(response_bytes)
        round_status["response_sha256"] = hashlib.sha256(response_bytes).hexdigest()
        if transport_metadata:
            round_status["transport"] = transport_metadata["transport"]
            round_status["sidebar_evidence"] = transport_metadata
            status["manual_copy_required"] = False
            status["sidebar_transport_required"] = True
            status["sidebar_response_imported"] = True
        append_gptpro_evidence(session, status, response_text, transport_metadata)
        status["updated_at"] = utc_now()
        write_json_atomic(session.status_file, status)


def save_response(
    session: BridgeSession,
    response_text: str,
    *,
    transport_metadata: dict[str, Any] | None = None,
) -> None:
    if transport_metadata is not None:
        raise ValueError("Transport metadata is accepted only from a completed sidebar evidence import.")
    _persist_response(session, response_text)


def mark_copied(session: BridgeSession) -> None:
    status = session.status()
    status["prompt_copied"] = True
    session.write_status(status)


def render_page(session: BridgeSession) -> bytes:
    state = session.state()
    prompt = html.escape(str(state["prompt"]))
    response_saved = "yes" if state["response_saved"] else "no"
    preview_token = json.dumps(ensure_preview_token(session))
    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CCG GPT Pro Manual Bridge</title>
  <style>
    body {{
      font-family: system-ui, -apple-system, Segoe UI, sans-serif;
      margin: 0;
      background: #f6f7f9;
      color: #17202a;
    }}
    main {{ max-width: 1100px; margin: 0 auto; padding: 24px; display: grid; gap: 18px; }}
    section {{ background: #fff; border: 1px solid #d7dde5; border-radius: 8px; padding: 18px; }}
    pre {{
      white-space: pre-wrap;
      word-break: break-word;
      background: #101828;
      color: #f9fafb;
      padding: 14px;
      border-radius: 6px;
      max-height: 45vh;
      overflow: auto;
    }}
    textarea {{
      width: 100%;
      min-height: 220px;
      font: 14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      box-sizing: border-box;
    }}
    button, a.button {{
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-right: 8px;
      padding: 8px 12px;
      border: 1px solid #9aa6b2;
      border-radius: 6px;
      background: #fff;
      color: #17202a;
      text-decoration: none;
      cursor: pointer;
    }}
    button.primary {{ background: #0f766e; border-color: #0f766e; color: white; }}
    dl {{ display: grid; grid-template-columns: max-content 1fr; gap: 8px 14px; }}
    dt {{ font-weight: 700; }}
  </style>
</head>
<body>
<main>
  <section>
    <h1>CCG GPT Pro Manual Bridge</h1>
    <p>
      Manual copy is required. No ChatGPT web automation, no DOM extraction,
      no automatic prompt submission, and no automatic output reading.
    </p>
    <button id="copyPrompt" class="primary">Copy Prompt</button>
    <a class="button" href="https://chatgpt.com/" target="_blank" rel="noreferrer">Open ChatGPT</a>
  </section>
  <section>
    <h2>Prompt</h2>
    <pre id="prompt">{prompt}</pre>
  </section>
  <section>
    <h2>Manual Instructions</h2>
    <ol>
      <li>Open ChatGPT Pro.</li>
      <li>Paste the prompt manually.</li>
      <li>Send it manually.</li>
      <li>Copy the ChatGPT output manually.</li>
      <li>Paste it below and save the response.</li>
    </ol>
  </section>
  <section>
    <h2>Response</h2>
    <textarea id="response" placeholder="Paste the manual ChatGPT Pro output here"></textarea>
    <p>
      <button id="saveResponse" class="primary">Save Response</button>
      <span id="saveStatus">response_saved: {response_saved}</span>
    </p>
  </section>
  <section>
    <h2>Status</h2>
    <dl>
      <dt>Session</dt><dd>{html.escape(str(state["session_dir"]))}</dd>
      <dt>Round</dt><dd>{state["round"]}</dd>
      <dt>Prompt file</dt><dd>{html.escape(str(state["prompt_file"]))}</dd>
      <dt>Response file</dt><dd>{html.escape(str(state["response_file"]))}</dd>
      <dt>Manual questions</dt><dd>{MANUAL_QUESTIONS_EXPECTED} expected per independent task; sequential follow-ups allowed</dd>
    </dl>
  </section>
</main>
<script>
const previewToken = {preview_token};
const promptText = document.getElementById('prompt').innerText;
document.getElementById('copyPrompt').addEventListener('click', async () => {{
  await navigator.clipboard.writeText(promptText);
  await fetch('/mark-copied', {{
    method: 'POST',
    headers: {{ 'X-CCG-GPTPRO-Token': previewToken }}
  }});
}});
document.getElementById('saveResponse').addEventListener('click', async () => {{
  const response = document.getElementById('response').value;
  const result = await fetch('/save-response', {{
    method: 'POST',
    headers: {{
      'Content-Type': 'application/json',
      'X-CCG-GPTPRO-Token': previewToken
    }},
    body: JSON.stringify({{ response }})
  }});
  document.getElementById('saveStatus').innerText = result.ok ? 'response_saved: yes' : 'save failed';
}});
</script>
</body>
</html>
"""
    return page.encode("utf-8")


def start_server(session: BridgeSession, open_browser: bool = False, port: int = 0) -> tuple[ThreadingHTTPServer, str]:
    preview_token = ensure_preview_token(session)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def validate_write_request(self) -> bool:
            if not preview_host_allowed(self.headers.get("Host", "")):
                self.send_json({"ok": False, "error": "Invalid host"}, status=403)
                return False
            if not preview_origin_allowed(self.headers.get("Origin")):
                self.send_json({"ok": False, "error": "Invalid origin"}, status=403)
                return False
            if self.headers.get("X-CCG-GPTPRO-Token") != preview_token:
                self.send_json({"ok": False, "error": "Invalid token"}, status=403)
                return False
            return True

        def do_GET(self) -> None:
            if self.path in ("/", "/index.html"):
                body = render_page(session)
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            if self.path == "/state":
                self.send_json(session.state())
                return
            self.send_error(404)

        def do_POST(self) -> None:
            if self.path == "/mark-copied":
                if not self.validate_write_request():
                    return
                mark_copied(session)
                self.send_json({"ok": True})
                return
            if self.path == "/save-response":
                if not self.validate_write_request():
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                except ValueError:
                    self.send_json({"ok": False, "error": "Invalid Content-Length"}, status=400)
                    return
                if length < 0:
                    self.send_json({"ok": False, "error": "Invalid Content-Length"}, status=400)
                    return
                if length > MAX_RESPONSE_BYTES:
                    self.send_json({"ok": False, "error": "Response too large"}, status=413)
                    return
                body = self.rfile.read(length).decode("utf-8") if length else "{}"
                try:
                    payload = json.loads(body)
                except json.JSONDecodeError:
                    self.send_json({"ok": False, "error": "Invalid JSON"}, status=400)
                    return
                try:
                    save_response(session, str(payload.get("response", "")))
                except ValueError as error:
                    self.send_json({"ok": False, "error": str(error)}, status=400)
                    return
                self.send_json({"ok": True, "response_file": str(session.response_file)})
                return
            self.send_error(404)

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    host, port = server.server_address
    url = f"http://{host}:{port}/"
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    if open_browser:
        webbrowser.open(url)
    return server, url


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Create or import a ChatGPT Pro sidebar bridge session")
    parser.add_argument("--mode", choices=["plan", "review", "exc"])
    parser.add_argument("--workdir", default=".")
    parser.add_argument("--prompt", default="")
    parser.add_argument("--prompt-file", default="")
    parser.add_argument("--slug", default="")
    parser.add_argument("--output-root", default="")
    parser.add_argument("--task-dir", default="")
    parser.add_argument("--task-id", default="")
    parser.add_argument("--evidence-file", default="")
    parser.add_argument("--source-command", default="")
    parser.add_argument("--round", type=int, default=1)
    parser.add_argument("--followup-session", default="")
    parser.add_argument("--followup-reason", default="")
    parser.add_argument("--open-preview", action="store_true")
    parser.add_argument("--open-chatgpt", action="store_true")
    parser.add_argument("--mark-copy-requested", action="store_true")
    parser.add_argument("--detach-preview", action="store_true")
    parser.add_argument("--print-prompt", action="store_true")
    parser.add_argument("--gemini-response-file", default="")
    parser.add_argument("--gemini-summary", default="")
    parser.add_argument("--gemini-summary-file", default="")
    parser.add_argument("--gemini-policy", choices=GEMINI_POLICIES, default="")
    parser.add_argument("--gemini-evidence-role", choices=GEMINI_EVIDENCE_ROLES, default="")
    parser.add_argument("--routing-evidence-file", default="")
    parser.add_argument("--routing-summary-file", default="")
    parser.add_argument("--require-routing-evidence", action="store_true")
    parser.add_argument("--require-claude-evidence", action="store_true")
    parser.add_argument("--require-external-intelligence", action="store_true")
    parser.add_argument("--expected-intelligence-mode", choices=["discover", "contract", "incident", "landscape"], default="")
    parser.add_argument("--expected-intelligence-depth", choices=["normal", "deep"], default="")
    parser.add_argument("--repo-url", default="")
    parser.add_argument("--wait-response", action="store_true")
    parser.add_argument("--hold-seconds", type=int, default=0)
    parser.add_argument("--serve-session", help=argparse.SUPPRESS)
    parser.add_argument("--import-session", default="")
    parser.add_argument("--import-sidebar-evidence", default="")
    parser.add_argument("--create-batch-manifest", default="")
    parser.add_argument("--import-batch-result", default="")
    parser.add_argument("--expected-codex-thread-id", default="")
    parser.add_argument("--codex-thread-id", default="")
    parser.add_argument("--preview-port", type=int, default=0, help=argparse.SUPPRESS)
    parser.add_argument("--serve-timeout-seconds", type=int, default=14400, help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def print_outputs(session: BridgeSession, preview_url: str) -> None:
    status = session.status()
    print(f"CCG_GPTPRO_PROVIDER={PROVIDER}", flush=True)
    print(f"CCG_GPTPRO_MODE={session.mode}", flush=True)
    print(f"CCG_GPTPRO_SESSION_DIR={session.session_dir}", flush=True)
    print(f"CCG_GPTPRO_ROUND={status['current_round']}", flush=True)
    print(f"CCG_GPTPRO_PROMPT_FILE={session.prompt_file}", flush=True)
    print(f"CCG_GPTPRO_RESPONSE_FILE={session.response_file}", flush=True)
    print(f"CCG_GPTPRO_STATUS_FILE={session.status_file}", flush=True)
    print(f"CCG_GPTPRO_PREVIEW_URL={preview_url}", flush=True)
    if status.get("preview_pid"):
        print(f"CCG_GPTPRO_PREVIEW_PID={status['preview_pid']}", flush=True)
    if status.get("preview_log"):
        print(f"CCG_GPTPRO_PREVIEW_LOG={status['preview_log']}", flush=True)
    print("CCG_GPTPRO_MANUAL_BRIDGE=0", flush=True)
    print("CCG_GPTPRO_SIDEBAR_TRANSPORT=1", flush=True)
    print("CCG_GPTPRO_WEB_AUTOMATION=0", flush=True)
    print("CCG_GPTPRO_DOM_EXTRACTION=0", flush=True)
    print(f"CCG_GPTPRO_MANUAL_QUESTIONS_EXPECTED={MANUAL_QUESTIONS_EXPECTED}", flush=True)


def print_prompt(session: BridgeSession) -> None:
    print("CCG_GPTPRO_PROMPT_BEGIN", flush=True)
    print(session.prompt_file.read_text(encoding="utf-8"), flush=True)
    print("CCG_GPTPRO_PROMPT_END", flush=True)


def start_detached_preview(
    session: BridgeSession,
    *,
    open_browser: bool,
    preview_port: int,
    timeout_seconds: int,
) -> str:
    port = preview_port or free_port()
    url = f"http://127.0.0.1:{port}/"
    log_path = session.session_dir / "preview-server.log"
    command = [
        sys.executable,
        str(Path(__file__).resolve()),
        "--serve-session",
        str(session.session_dir),
        "--preview-port",
        str(port),
        "--serve-timeout-seconds",
        str(timeout_seconds),
    ]
    if open_browser:
        command.append("--open-preview")

    with log_path.open("ab") as log_file:
        process_options: dict[str, Any] = {
            "cwd": str(session.workdir),
            "stdin": subprocess.DEVNULL,
            "stdout": log_file,
            "stderr": subprocess.STDOUT,
        }
        if sys.platform == "win32":
            process_options["creationflags"] = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(
                subprocess, "CREATE_NEW_PROCESS_GROUP", 0
            )
        else:
            process_options["start_new_session"] = True
        process_factory = getattr(subprocess, "Popen")
        process = process_factory(command, **process_options)

    ready = wait_for_port(port)
    status = session.status()
    status["preview_url"] = url
    status["preview_pid"] = process.pid
    status["preview_log"] = str(log_path)
    status["preview_ready"] = ready
    session.write_status(status)
    return url


def serve_existing_session(args: argparse.Namespace) -> int:
    session_value = str(args.serve_session)
    session = load_session(resolve_existing_session_dir(session_value))
    server, url = start_server(session, open_browser=args.open_preview, port=args.preview_port)
    print(f"CCG_GPTPRO_PREVIEW_URL={url}", flush=True)
    deadline = time.time() + args.serve_timeout_seconds if args.serve_timeout_seconds > 0 else None
    try:
        while not session.state()["response_saved"]:
            if deadline and time.time() >= deadline:
                break
            time.sleep(1)
    except KeyboardInterrupt:
        return 130
    finally:
        server.shutdown()
        server.server_close()
    return 0


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.serve_session:
        return serve_existing_session(args)
    if args.import_sidebar_evidence:
        if not args.import_session:
            print("--import-session is required with --import-sidebar-evidence", file=sys.stderr)
            return 2
        try:
            session = load_session(args.import_session)
            imported = import_sidebar_evidence(
                session,
                args.import_sidebar_evidence,
                args.expected_codex_thread_id,
            )
        except Exception as error:
            print(str(error), file=sys.stderr)
            return 2
        print_outputs(session, "")
        print("CCG_GPTPRO_SIDEBAR_IMPORTED=1", flush=True)
        print(f"CCG_GPTPRO_CONVERSATION_URL={imported['conversationUrl']}", flush=True)
        print(
            f"CCG_GPTPRO_SIDEBAR_EVIDENCE_SHA256={imported['sidebarEvidenceSha256']}",
            flush=True,
        )
        return 0
    if args.import_batch_result:
        if args.import_session or args.import_sidebar_evidence or args.create_batch_manifest:
            print("--import-batch-result cannot be combined with other import or batch creation options", file=sys.stderr)
            return 2
        try:
            imported_batch = import_batch_result(args.import_batch_result, args.expected_codex_thread_id)
        except Exception as error:
            print(str(error), file=sys.stderr)
            return 2
        print("CCG_GPTPRO_BATCH_IMPORTED=1", flush=True)
        print(f"CCG_GPTPRO_BATCH_ALL_IMPORTED={int(imported_batch['allImported'])}", flush=True)
        print(f"CCG_GPTPRO_BATCH_IMPORT_FILE={imported_batch['importResultFile']}", flush=True)
        return 0
    if args.import_session:
        print("--import-sidebar-evidence is required with --import-session", file=sys.stderr)
        return 2
    if not args.mode:
        print("--mode is required unless --serve-session is used", file=sys.stderr)
        return 2
    if args.round < 1:
        print("Round must be a positive integer.", file=sys.stderr)
        return 2
    if args.round > 1 and not args.followup_session:
        print("Rounds after round 1 require --followup-session.", file=sys.stderr)
        return 2
    try:
        raw_prompt = "" if args.create_batch_manifest else read_prompt(args.prompt, args.prompt_file)
        workdir_path = resolve_workdir(args.workdir)
        task_dir = resolve_task_dir(workdir_path, args.task_dir, args.task_id)
        evidence_file = default_evidence_file(task_dir, args.evidence_file)
        output_root = default_output_root(workdir_path, task_dir, args.output_root)
        gemini_policy = args.gemini_policy or (
            "optional"
            if args.routing_evidence_file
            else default_gemini_policy(args.mode)
        )
        gemini_evidence_role = args.gemini_evidence_role or default_gemini_evidence_role(args.mode)
        gemini_policy = normalize_gemini_policy(gemini_policy)
        gemini_evidence_role = normalize_gemini_evidence_role(gemini_evidence_role)
        validate_mode_gemini_policy(args.mode, gemini_policy, gemini_evidence_role)
        gemini_evidence = None
        has_gemini_args = bool(args.gemini_response_file or args.gemini_summary or args.gemini_summary_file)
        if has_gemini_args or not args.followup_session:
            gemini_evidence = read_gemini_evidence(
                args.workdir,
                args.gemini_response_file,
                args.gemini_summary,
                args.gemini_summary_file,
                policy=gemini_policy,
                role=gemini_evidence_role,
            )
        routing_evidence = None
        has_routing_args = bool(args.routing_evidence_file or args.routing_summary_file)
        if has_routing_args or not args.followup_session:
            routing_evidence = read_routing_evidence(
                args.workdir,
                args.routing_evidence_file,
                args.routing_summary_file,
                required=args.require_routing_evidence,
            )
        external_intelligence = None
        if args.require_external_intelligence:
            if task_dir is None:
                raise ValueError("Required Grok external intelligence needs an active supported task directory.")
            if not args.expected_intelligence_mode or not args.expected_intelligence_depth:
                raise ValueError("Required Grok external intelligence needs explicit expected mode and depth.")
            external_intelligence = validate_required_external_intelligence(
                task_dir=task_dir,
                evidence_file=evidence_file,
                expected_action="verify" if args.mode == "review" else "intel",
                expected_mode=args.expected_intelligence_mode,
                expected_depth=args.expected_intelligence_depth,
            )
        project_context = detect_project_context(args.workdir, args.repo_url)
        if args.create_batch_manifest:
            request = read_batch_request(
                args.create_batch_manifest,
                expected_mode=args.mode,
                expected_codex_thread_id=args.codex_thread_id,
            )
            batch = create_batch_sessions(
                request=request,
                workdir=workdir_path,
                output_root=output_root,
                task_dir=task_dir,
                task_id=args.task_id,
                evidence_file=evidence_file,
                source_command=args.source_command,
                gemini_evidence=gemini_evidence,
                gemini_policy=gemini_policy,
                gemini_evidence_role=gemini_evidence_role,
                routing_evidence=routing_evidence,
                require_routing_evidence=args.require_routing_evidence,
                require_claude_evidence=args.require_claude_evidence,
                external_intelligence=external_intelligence,
                require_external_intelligence=args.require_external_intelligence,
                project_context=project_context,
            )
            print(f"CCG_GPTPRO_BATCH_DIR={batch['batchDirectory']}", flush=True)
            print(f"CCG_GPTPRO_BATCH_FILE={batch['batchFile']}", flush=True)
            print(f"CCG_GPTPRO_BATCH_MANIFEST={batch['watcherManifestFile']}", flush=True)
            print(f"CCG_GPTPRO_BATCH_RESULT={batch['watcherResultFile']}", flush=True)
            print(f"CCG_GPTPRO_BATCH_ROUNDS={len(batch['items'])}", flush=True)
            return 0
        session = create_session(
            mode=args.mode,
            workdir=workdir_path,
            prompt=raw_prompt,
            slug=args.slug,
            output_root=output_root,
            task_dir=task_dir,
            task_id=args.task_id,
            evidence_file=evidence_file,
            source_command=args.source_command,
            round_number=args.round,
            followup_session=args.followup_session or None,
            followup_reason=args.followup_reason or None,
            gemini_evidence=gemini_evidence,
            gemini_policy=gemini_policy,
            gemini_evidence_role=gemini_evidence_role,
            routing_evidence=routing_evidence,
            require_routing_evidence=args.require_routing_evidence,
            require_claude_evidence=args.require_claude_evidence,
            external_intelligence=external_intelligence,
            require_external_intelligence=args.require_external_intelligence,
            project_context=project_context,
            codex_thread_id=args.codex_thread_id,
        )
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 2

    server: ThreadingHTTPServer | None = None
    preview_url = ""
    try:
        if args.detach_preview:
            preview_url = start_detached_preview(
                session,
                open_browser=args.open_preview,
                preview_port=args.preview_port,
                timeout_seconds=args.serve_timeout_seconds,
            )
        elif args.open_preview or args.wait_response or args.hold_seconds > 0:
            server, preview_url = start_server(session, open_browser=args.open_preview, port=args.preview_port)
        if args.open_chatgpt:
            webbrowser.open("https://chatgpt.com/")
        if args.mark_copy_requested:
            status = session.status()
            status["prompt_copy_requested"] = True
            session.write_status(status)
        print_outputs(session, preview_url)
        if args.print_prompt:
            print_prompt(session)

        deadline = time.time() + args.hold_seconds if args.hold_seconds > 0 else None
        while args.wait_response and not session.state()["response_saved"]:
            if deadline and time.time() >= deadline:
                break
            time.sleep(1)
        if not args.wait_response and deadline:
            while time.time() < deadline:
                time.sleep(0.2)
    except KeyboardInterrupt:
        return 130
    finally:
        if server:
            server.shutdown()
            server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
