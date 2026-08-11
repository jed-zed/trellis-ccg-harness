#!/usr/bin/env python3
"""Run Claude or Antigravity review inside a disposable file snapshot."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PureWindowsPath
from types import SimpleNamespace

from invoke_gemini_preview import (
    SNAPSHOT_EXCLUDE_SUMMARY,
    copy_snapshot_file,
    copy_snapshot_tree,
    is_snapshot_link,
)

MAX_REVIEW_FILES = 2000
MAX_REVIEW_FILE_BYTES = 2 * 1024 * 1024
MAX_REVIEW_TOTAL_BYTES = 64 * 1024 * 1024


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a provider review in a disposable snapshot")
    parser.add_argument("--backend", required=True, choices=("claude", "antigravity"))
    parser.add_argument("--workdir", required=True)
    parser.add_argument("--target", action="append", required=True)
    return parser.parse_args(argv)


def resolve_workdir(value: str) -> Path:
    if not value.strip():
        raise ValueError("review workdir is required")
    workdir = Path(value).resolve(strict=True)
    if not workdir.is_dir():
        raise ValueError(f"review workdir is not a directory: {workdir}")
    return workdir


def normalize_targets(workdir: Path, raw_targets: list[str]) -> list[str]:
    if len(raw_targets) > MAX_REVIEW_FILES:
        raise ValueError(f"review target count exceeds {MAX_REVIEW_FILES}")
    root = workdir.resolve(strict=True)
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in raw_targets:
        portable = PureWindowsPath(raw)
        candidate = Path(*portable.parts)
        if (
            not raw.strip()
            or portable.anchor
            or ".." in portable.parts
            or "\n" in raw
            or "\r" in raw
        ):
            raise ValueError(f"review target must be a workspace-relative file: {raw!r}")
        current = root
        for part in candidate.parts:
            current /= part
            if is_snapshot_link(current):
                raise ValueError(f"review target contains a link or reparse point: {raw!r}")
        resolved = (root / candidate).resolve(strict=True)
        try:
            relative = resolved.relative_to(root).as_posix()
        except ValueError as error:
            raise ValueError(f"review target escapes workdir: {raw!r}") from error
        key = relative.casefold() if sys.platform == "win32" else relative
        if key in seen:
            raise ValueError(f"duplicate review target: {raw!r}")
        if not resolved.is_file():
            raise ValueError(f"review target must be a regular file: {raw!r}")
        seen.add(key)
        normalized.append(relative)
    return normalized


def build_snapshot(workdir: Path, targets: list[str], temp_root: Path) -> tuple[Path, dict[str, object]]:
    snapshot = temp_root / (workdir.name or "workspace")
    include_file = temp_root / "review-targets.txt"
    include_file.write_text("\n".join(targets) + "\n", encoding="utf-8")
    stats = copy_snapshot_tree(
        workdir,
        snapshot,
        SimpleNamespace(
            files_from=str(include_file),
            respect_gitignore=False,
            max_snapshot_bytes=MAX_REVIEW_TOTAL_BYTES,
            max_snapshot_files=MAX_REVIEW_FILES,
            max_snapshot_file_bytes=MAX_REVIEW_FILE_BYTES,
        ),
    )
    missing = [target for target in targets if not (snapshot / Path(target)).is_file()]
    if missing:
        raise ValueError(f"review target was excluded from the safe snapshot: {missing[0]!r}")
    return snapshot, stats


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    prompt = sys.stdin.read()
    if not prompt.strip():
        raise ValueError("review prompt is required on stdin")
    workdir = resolve_workdir(args.workdir)
    targets = normalize_targets(workdir, args.target)
    ccg = shutil.which("ccg")
    if not ccg:
        raise RuntimeError("ccg CLI not found in PATH")

    with tempfile.TemporaryDirectory(prefix="ccg-provider-review-") as temp:
        snapshot, stats = build_snapshot(workdir, targets, Path(temp))
        command = [ccg, "wrapper", "--backend", args.backend, "--progress"]
        if args.backend == "antigravity":
            command.extend(("--antigravity-review", "--skip-permissions"))
        command.extend(["-", str(snapshot)])
        print(f"CCG_REVIEW_SNAPSHOT_FILES={stats['files']}", file=sys.stderr, flush=True)
        print(f"CCG_REVIEW_SNAPSHOT_BYTES={stats['bytes']}", file=sys.stderr, flush=True)
        print(f"CCG_REVIEW_SNAPSHOT_EXCLUDES={SNAPSHOT_EXCLUDE_SUMMARY}", file=sys.stderr, flush=True)
        result = subprocess.run(command, cwd=snapshot, input=prompt, text=True, check=False)
        return int(result.returncode)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, RuntimeError, ValueError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
