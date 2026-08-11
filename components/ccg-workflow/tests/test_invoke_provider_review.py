from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = (
    Path(__file__).parents[1]
    / "plugins/ccg/skills/ccg-executor/scripts/invoke_provider_review.py"
)
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("invoke_provider_review", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
SNAPSHOT_MODULE = sys.modules[MODULE.copy_snapshot_tree.__module__]


class ProviderReviewSnapshotTest(unittest.TestCase):
    def test_runs_each_provider_in_exact_file_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            workdir = Path(temp) / "repo"
            workdir.mkdir()
            (workdir / "review.py").write_text("print('review')\n", encoding="utf-8")
            (workdir / "secret.txt").write_text("not disclosed\n", encoding="utf-8")

            for backend in ("claude", "antigravity"):
                with self.subTest(backend=backend):
                    observed: dict[str, object] = {}

                    def fake_run(command, **kwargs):
                        snapshot = Path(kwargs["cwd"])
                        observed.update(command=command, cwd=snapshot, prompt=kwargs["input"])
                        self.assertNotEqual(snapshot, workdir)
                        self.assertTrue((snapshot / "review.py").is_file())
                        self.assertFalse((snapshot / "secret.txt").exists())
                        return SimpleNamespace(returncode=0)

                    with (
                        patch.object(MODULE.shutil, "which", return_value="ccg"),
                        patch.object(MODULE.subprocess, "run", side_effect=fake_run),
                        patch.object(MODULE.sys, "stdin", io.StringIO("review the bound file")),
                    ):
                        code = MODULE.main([
                            "--backend", backend,
                            "--workdir", str(workdir),
                            "--target", "review.py",
                        ])

                    self.assertEqual(code, 0)
                    self.assertEqual(
                        "--antigravity-review" in observed["command"],
                        backend == "antigravity",
                    )
                    self.assertEqual(
                        "--skip-permissions" in observed["command"],
                        backend == "antigravity",
                    )
                    self.assertEqual(observed["prompt"], "review the bound file")
                    self.assertFalse(Path(observed["cwd"]).exists())

    def test_rejects_escape_and_duplicates(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            workdir = Path(temp) / "repo"
            workdir.mkdir()
            (workdir / "a.py").write_text("pass\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "workspace-relative"):
                MODULE.normalize_targets(workdir, ["../outside.py"])
            with self.assertRaisesRegex(ValueError, "workspace-relative"):
                MODULE.normalize_targets(workdir, [r"C:\outside.py"])
            with self.assertRaisesRegex(ValueError, "duplicate review target"):
                MODULE.normalize_targets(workdir, ["a.py", "a.py"])

    def test_rejects_empty_workdir(self) -> None:
        with self.assertRaisesRegex(ValueError, "workdir is required"):
            MODULE.resolve_workdir(" ")

    def test_snapshot_copy_rejects_opened_file_identity_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / "source.py"
            replacement = root / "outside.txt"
            target = root / "snapshot.py"
            source.write_text("safe\n", encoding="utf-8")
            replacement.write_text("outside\n", encoding="utf-8")
            replacement_fd = os.open(replacement, os.O_RDONLY | getattr(os, "O_BINARY", 0))

            try:
                with patch.object(MODULE.os, "open", return_value=replacement_fd):
                    with self.assertRaisesRegex(OSError, "identity changed"):
                        MODULE.copy_snapshot_file(source, target, source.lstat())
            finally:
                with contextlib.suppress(OSError):
                    os.close(replacement_fd)

            self.assertFalse(target.exists())

    def test_snapshot_rejects_file_over_existing_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workdir = root / "repo"
            workdir.mkdir()
            (workdir / "large.py").write_bytes(b"12345")
            temp_root = root / "tmp"
            temp_root.mkdir()

            with patch.object(MODULE, "MAX_REVIEW_FILE_BYTES", 4):
                with self.assertRaisesRegex(ValueError, "safe snapshot"):
                    MODULE.build_snapshot(workdir, ["large.py"], temp_root)

    def test_snapshot_rejects_parent_directory_swap(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workdir = root / "repo"
            approved = workdir / "approved"
            approved.mkdir(parents=True)
            (approved / "review.py").write_text("safe\n", encoding="utf-8")
            outside = root / "outside"
            outside.mkdir()
            (outside / "review.py").write_text("outside\n", encoding="utf-8")
            targets = MODULE.normalize_targets(workdir, ["approved/review.py"])
            temp_root = root / "tmp"
            temp_root.mkdir()
            original = workdir / "approved-original"
            original_link_check = SNAPSHOT_MODULE.is_snapshot_link
            checks = 0

            def swap_after_directory_checks(path: Path) -> bool:
                nonlocal checks
                result = original_link_check(path)
                if path == approved:
                    checks += 1
                    if checks == 2:
                        approved.rename(original)
                        if os.name == "nt":
                            subprocess.run(
                                ["cmd.exe", "/d", "/c", "mklink", "/J", str(approved), str(outside)],
                                check=True,
                                capture_output=True,
                            )
                        else:
                            approved.symlink_to(outside, target_is_directory=True)
                return result

            try:
                with patch.object(
                    SNAPSHOT_MODULE,
                    "is_snapshot_link",
                    side_effect=swap_after_directory_checks,
                ):
                    with self.assertRaisesRegex(ValueError, "safe snapshot"):
                        MODULE.build_snapshot(workdir, targets, temp_root)
            finally:
                if approved.is_symlink() or getattr(approved, "is_junction", lambda: False)():
                    if os.name == "nt":
                        os.rmdir(approved)
                    else:
                        approved.unlink()
                if original.exists():
                    original.rename(approved)

            self.assertFalse((temp_root / workdir.name / "approved" / "review.py").exists())

    def test_snapshot_rejects_growth_between_lstat_and_open(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workdir = root / "repo"
            workdir.mkdir()
            source = workdir / "review.py"
            source.write_bytes(b"123")
            temp_root = root / "tmp"
            temp_root.mkdir()
            real_open = os.open
            grown = False

            def grow_then_open(path, flags, *args, **kwargs):
                nonlocal grown
                if Path(path) == source and not grown:
                    source.write_bytes(b"12345")
                    grown = True
                return real_open(path, flags, *args, **kwargs)

            with (
                patch.object(MODULE, "MAX_REVIEW_FILE_BYTES", 4),
                patch.object(SNAPSHOT_MODULE.os, "open", side_effect=grow_then_open),
            ):
                with self.assertRaisesRegex(ValueError, "safe snapshot"):
                    MODULE.build_snapshot(workdir, ["review.py"], temp_root)

            self.assertFalse((temp_root / workdir.name / "review.py").exists())

    def test_snapshot_rejects_target_count_and_total_size_over_bounds(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            workdir = root / "repo"
            workdir.mkdir()
            for name in ("a.py", "b.py"):
                (workdir / name).write_bytes(b"123")

            with patch.object(MODULE, "MAX_REVIEW_FILES", 1):
                with self.assertRaisesRegex(ValueError, "target count"):
                    MODULE.normalize_targets(workdir, ["a.py", "b.py"])

            temp_root = root / "tmp"
            temp_root.mkdir()
            with patch.object(MODULE, "MAX_REVIEW_TOTAL_BYTES", 5):
                with self.assertRaisesRegex(ValueError, "safe snapshot"):
                    MODULE.build_snapshot(workdir, ["a.py", "b.py"], temp_root)


if __name__ == "__main__":
    unittest.main()
