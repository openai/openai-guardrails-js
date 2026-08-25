#!/usr/bin/env python3

from __future__ import annotations

import hashlib
import io
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import review_state as review_state_module
from review_state import _component, _load_pathspec_file, review_state


class ReviewStateTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self._git("init", "-q")
        self._git("config", "user.email", "review-state@example.test")
        self._git("config", "user.name", "Review State Test")
        (self.repo / ".gitignore").write_text("plans/private.md\n")
        (self.repo / "src").mkdir()
        (self.repo / "tests").mkdir()
        (self.repo / "plans").mkdir()
        (self.repo / "src" / "runtime.py").write_text("VALUE = 1\n")
        (self.repo / "tests" / "test_runtime.py").write_text("assert True\n")
        self._git("add", ".")
        self._git("commit", "-qm", "initial")
        self.base = self._git("rev-parse", "HEAD").strip()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _git(self, *args: str) -> str:
        return subprocess.check_output(("git", "-C", str(self.repo), *args), text=True)

    def _relocate_git_directory(self, name: str) -> Path:
        git_directory = self.root / name
        (self.repo / ".git").rename(git_directory)
        (self.repo / ".git").write_text(f"gitdir: {git_directory}\n")
        return git_directory

    def _run_cli(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            (
                sys.executable,
                str(Path(__file__).with_name("review_state.py")),
                "--repo",
                str(self.repo),
                "--base",
                self.base,
                *args,
            ),
            capture_output=True,
            text=True,
        )

    def _case_variant_alias(self, path: Path) -> Path | None:
        resolved = path.resolve()
        parts = list(resolved.parts)
        for index, part in enumerate(parts):
            for character_index, character in enumerate(part):
                if not character.isalpha():
                    continue
                variant = (
                    part[:character_index]
                    + character.swapcase()
                    + part[character_index + 1 :]
                )
                candidate = Path(*parts[:index], variant, *parts[index + 1 :])
                try:
                    if candidate != resolved and os.path.samefile(candidate, resolved):
                        return candidate
                except OSError:
                    pass
                break
        return None

    def test_git_environment_filters_repository_overrides_case_insensitively(
        self,
    ) -> None:
        with patch.dict(
            os.environ,
            {"GIT_INDEX_FILE": "upper", "git_work_tree": "mixed"},
            clear=True,
        ):
            environment = review_state_module._git_environment()

        self.assertNotIn("GIT_INDEX_FILE", environment)
        self.assertNotIn("git_work_tree", environment)

    def test_git_path_preserves_non_utf8_filesystem_bytes(self) -> None:
        raw_path = b"/tmp/repository-\xff"
        with patch.object(
            review_state_module,
            "_git",
            return_value=raw_path + b"\n",
        ):
            path = review_state_module._git_path(self.repo, "--show-toplevel")

        self.assertEqual(os.fsencode(path), raw_path)

    def test_git_path_rejects_empty_or_unterminated_output(self) -> None:
        for output in (b"\n", b"/tmp/repository"):
            with self.subTest(output=output):
                with patch.object(review_state_module, "_git", return_value=output):
                    with self.assertRaisesRegex(ValueError, "Git path output|invalid"):
                        review_state_module._git_path(self.repo, "--git-dir")

    def test_repository_subdirectory_is_rejected_before_state_computation(
        self,
    ) -> None:
        with patch.object(review_state_module, "_assert_certifiable_index") as certify:
            with self.assertRaisesRegex(ValueError, "repository worktree root"):
                review_state(self.repo / "src", self.base, ("runtime.py",))

        certify.assert_not_called()

    def test_cli_default_repo_rejects_nested_current_directory(self) -> None:
        completed = subprocess.run(
            (
                sys.executable,
                str(Path(__file__).with_name("review_state.py")),
                "--base",
                self.base,
                "--pathspec",
                "runtime.py",
            ),
            cwd=self.repo / "src",
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("repository worktree root", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_repository_symlink_to_worktree_root_is_accepted(self) -> None:
        repo_alias = self.root / "repo-alias"
        try:
            repo_alias.symlink_to(self.repo, target_is_directory=True)
        except OSError as error:
            self.skipTest(f"symlinks are unavailable: {error}")
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")

        state = review_state(repo_alias, self.base, ("src/runtime.py",))

        self.assertEqual(
            [entry["path"] for entry in state["workspace"]],
            ["src/runtime.py"],
        )

    def test_repository_root_preserves_unusual_filesystem_names(self) -> None:
        names = [b"repo-with-newline\n"]
        if os.name == "posix":
            names.append(b"repo-with-non-utf8-\xff")

        for name in names:
            with self.subTest(name=name):
                raw_repo = os.fsencode(self.root) + b"/" + name
                try:
                    os.mkdir(raw_repo)
                except OSError as error:
                    self.skipTest(f"filesystem name is unavailable: {error}")
                repo = Path(os.fsdecode(raw_repo))
                subprocess.check_call(("git", "-C", str(repo), "init", "-q"))
                subprocess.check_call(
                    (
                        "git",
                        "-C",
                        str(repo),
                        "config",
                        "user.email",
                        "root@example.test",
                    )
                )
                subprocess.check_call(
                    ("git", "-C", str(repo), "config", "user.name", "Root Test")
                )
                (repo / "tracked.txt").write_text("tracked\n")
                subprocess.check_call(("git", "-C", str(repo), "add", "."))
                subprocess.check_call(
                    ("git", "-C", str(repo), "commit", "-qm", "initial")
                )
                base = subprocess.check_output(
                    ("git", "-C", str(repo), "rev-parse", "HEAD"),
                    text=True,
                ).strip()

                state = review_state(repo, base)

                self.assertEqual(state["workspace"], [])

    def test_inherited_git_pathspec_mode_cannot_change_review_scope(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")

        with patch.dict(os.environ, {"GIT_LITERAL_PATHSPECS": "1"}):
            state = review_state(self.repo, self.base, ("src/*.py",))

        self.assertEqual(
            [entry["path"] for entry in state["workspace"]],
            ["src/runtime.py"],
        )

    def test_inherited_git_trace_cannot_write_during_review(self) -> None:
        trace = self.root / "git.trace"

        with patch.dict(os.environ, {"GIT_TRACE": str(trace)}):
            review_state(self.repo, self.base, ("src",))

        self.assertFalse(trace.exists())

    def test_cli_does_not_publish_a_diff_if_its_manifest_changes(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        manifest = self.root / "task.paths"
        manifest.write_bytes(b"src\0")
        complete_diff = self.root / "complete.diff"
        real_complete_diff = review_state_module._complete_diff

        def complete_diff_then_change_manifest(*args: object) -> bytes:
            result = real_complete_diff(*args)
            manifest.write_bytes(b"tests\0")
            return result

        with (
            patch.object(
                review_state_module,
                "_complete_diff",
                side_effect=complete_diff_then_change_manifest,
            ),
            patch.object(
                sys,
                "argv",
                [
                    "review_state.py",
                    "--repo",
                    str(self.repo),
                    "--base",
                    self.base,
                    "--pathspec-file",
                    str(manifest),
                    "--complete-diff-output",
                    str(complete_diff),
                ],
            ),
            patch("builtins.print"),
            patch("sys.stderr", new_callable=io.StringIO),
        ):
            with self.assertRaises(SystemExit):
                review_state_module.main()

        self.assertFalse(complete_diff.exists())

    def test_cli_rechecks_its_manifest_immediately_before_publication(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        manifest = self.root / "task.paths"
        manifest.write_bytes(b"src\0")
        complete_diff = self.root / "complete.diff"
        real_validate = review_state_module._validate_complete_diff_output
        calls = 0

        def validate_then_change_manifest(*args: object, **kwargs: object) -> Path:
            nonlocal calls
            output = real_validate(*args, **kwargs)
            calls += 1
            if calls == 2:
                manifest.write_bytes(b"tests\0")
            return output

        with (
            patch.object(
                review_state_module,
                "_validate_complete_diff_output",
                side_effect=validate_then_change_manifest,
            ),
            patch.object(
                sys,
                "argv",
                [
                    "review_state.py",
                    "--repo",
                    str(self.repo),
                    "--base",
                    self.base,
                    "--pathspec-file",
                    str(manifest),
                    "--complete-diff-output",
                    str(complete_diff),
                ],
            ),
            patch("builtins.print"),
            patch("sys.stderr", new_callable=io.StringIO),
        ):
            with self.assertRaises(SystemExit):
                review_state_module.main()

        self.assertEqual(calls, 2)
        self.assertFalse(complete_diff.exists())

    def test_complete_diff_output_rechecks_repository_before_publication(self) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        complete_diff = self.root / "complete.diff"
        real_review_state = review_state_module.review_state
        nested_calls = 0

        def change_repository_before_nested_check(*args: object, **kwargs: object):
            nonlocal nested_calls
            if kwargs.get("_verify_repository") is False:
                nested_calls += 1
                if nested_calls == 1:
                    runtime.write_text("VALUE = 3\n")
            return real_review_state(*args, **kwargs)

        with patch.object(
            review_state_module,
            "review_state",
            side_effect=change_repository_before_nested_check,
        ):
            with self.assertRaisesRegex(ValueError, "Repository changed"):
                real_review_state(
                    self.repo,
                    self.base,
                    ("src/runtime.py",),
                    complete_diff_output=complete_diff,
                )

        self.assertFalse(complete_diff.exists())

    def test_publication_rejects_existing_output_before_validation(self) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        artifact.write_bytes(b"existing artifact\n")
        validation_calls = 0

        def validate() -> None:
            nonlocal validation_calls
            validation_calls += 1

        with self.assertRaisesRegex(ValueError, "fresh output path"):
            review_state_module._publish_artifacts(
                ((artifact, b"replacement artifact\n"),),
                expected_parent_identity=output_identity,
                validate=validate,
            )

        self.assertEqual(validation_calls, 0)
        self.assertEqual(artifact.read_bytes(), b"existing artifact\n")

    def test_publication_requires_directory_relative_creation(self) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        supported_dir_fd = set(review_state_module.os.supports_dir_fd)
        supported_dir_fd.discard(review_state_module.os.open)

        with patch.object(
            review_state_module.os,
            "supports_dir_fd",
            supported_dir_fd,
        ):
            with self.assertRaisesRegex(ValueError, "directory-relative"):
                review_state_module._publish_artifacts(
                    ((artifact, b"new diff\n"),),
                    expected_parent_identity=output_identity,
                    validate=lambda: None,
                )

        self.assertFalse(artifact.exists())

    def test_complete_diff_capability_fails_before_repository_validation(
        self,
    ) -> None:
        complete_diff = self.root / "complete.diff"

        with (
            patch.object(
                review_state_module,
                "_require_artifact_publication_support",
                side_effect=ValueError("unsupported publication"),
            ),
            patch.object(
                review_state_module,
                "_assert_certifiable_index",
            ) as assert_index,
        ):
            with self.assertRaisesRegex(ValueError, "unsupported publication"):
                review_state(
                    self.repo,
                    self.base,
                    ("src/runtime.py",),
                    complete_diff_output=complete_diff,
                )

        assert_index.assert_not_called()
        self.assertFalse(complete_diff.exists())

    def test_complete_diff_parent_is_anchored_before_repository_validation(
        self,
    ) -> None:
        complete_diff = self.root / "complete.diff"
        real_open_directory = review_state_module._open_artifact_directory
        real_assert_index = review_state_module._assert_certifiable_index
        parent_is_anchored = False

        @contextmanager
        def record_open_directory(*args: object, **kwargs: object):
            nonlocal parent_is_anchored
            with real_open_directory(*args, **kwargs) as opened:
                parent_is_anchored = True
                yield opened
                parent_is_anchored = False

        def assert_index_after_anchor(repo: Path) -> None:
            self.assertTrue(parent_is_anchored)
            real_assert_index(repo)

        with (
            patch.object(
                review_state_module,
                "_open_artifact_directory",
                side_effect=record_open_directory,
            ),
            patch.object(
                review_state_module,
                "_assert_certifiable_index",
                side_effect=assert_index_after_anchor,
            ),
        ):
            review_state(
                self.repo,
                self.base,
                ("src/runtime.py",),
                complete_diff_output=complete_diff,
            )

        self.assertFalse(parent_is_anchored)
        self.assertTrue(complete_diff.exists())

    def test_complete_diff_allows_trusted_intermediate_directory_symlink(
        self,
    ) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        real_root = self.root / "real-root"
        real_parent = real_root / "output"
        real_parent.mkdir(parents=True)
        alias = self.root / "trusted-alias"
        alias.symlink_to(real_root, target_is_directory=True)
        complete_diff = alias / "output" / "complete.diff"

        review_state(
            self.repo,
            self.base,
            ("src/runtime.py",),
            complete_diff_output=complete_diff,
        )

        self.assertEqual(
            complete_diff.read_bytes(), (real_parent / "complete.diff").read_bytes()
        )

    def test_publication_creates_and_revalidates_fresh_artifacts(self) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        first = output_dir / "complete.diff"
        second = output_dir / "review-state.json"
        validation_calls = 0

        def validate() -> None:
            nonlocal validation_calls
            validation_calls += 1

        review_state_module._publish_artifacts(
            ((first, b"new diff\n"), (second, b"{}\n")),
            expected_parent_identity=output_identity,
            validate=validate,
        )

        self.assertEqual(validation_calls, 2)
        self.assertEqual(first.read_bytes(), b"new diff\n")
        self.assertEqual(second.read_bytes(), b"{}\n")
        self.assertEqual(
            sorted(path.name for path in output_dir.iterdir()),
            ["complete.diff", "review-state.json"],
        )

    def test_publication_enforces_owner_permissions_under_restrictive_umask(
        self,
    ) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        previous_umask = os.umask(0o777)
        try:
            review_state_module._publish_artifacts(
                ((artifact, b"new diff\n"),),
                expected_parent_identity=output_identity,
                validate=lambda: None,
            )
        finally:
            os.umask(previous_umask)

        self.assertEqual(stat.S_IMODE(artifact.stat().st_mode), 0o600)
        self.assertEqual(artifact.read_bytes(), b"new diff\n")

    def test_publication_never_overwrites_entry_created_during_validation(
        self,
    ) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"

        def create_foreign_artifact() -> None:
            artifact.write_bytes(b"foreign artifact\n")

        with self.assertRaisesRegex(ValueError, "fresh output path"):
            review_state_module._publish_artifacts(
                ((artifact, b"new diff\n"),),
                expected_parent_identity=output_identity,
                validate=create_foreign_artifact,
            )

        self.assertEqual(artifact.read_bytes(), b"foreign artifact\n")

    def test_publication_error_leaves_fresh_output_for_disposal(self) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        validation_calls = 0

        def fail_after_publication() -> None:
            nonlocal validation_calls
            validation_calls += 1
            if validation_calls == 2:
                raise ValueError("repository drift")

        with self.assertRaisesRegex(ValueError, "repository drift"):
            review_state_module._publish_artifacts(
                ((artifact, b"new diff\n"),),
                expected_parent_identity=output_identity,
                validate=fail_after_publication,
            )

        self.assertEqual(artifact.read_bytes(), b"new diff\n")

    def test_publication_rejects_parent_replacement_before_creation(self) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        moved_output_dir = self.root / "moved-review-output"

        def replace_parent() -> None:
            output_dir.rename(moved_output_dir)
            output_dir.mkdir()

        with self.assertRaisesRegex(ValueError, "Output directory changed"):
            review_state_module._publish_artifacts(
                ((artifact, b"new diff\n"),),
                expected_parent_identity=output_identity,
                validate=replace_parent,
            )

        self.assertFalse((output_dir / artifact.name).exists())
        self.assertFalse((moved_output_dir / artifact.name).exists())

    def test_publication_rejects_parent_replacement_after_final_read(self) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        moved_output_dir = self.root / "moved-review-output"
        real_directory_identity = review_state_module._directory_identity
        parent_checks = 0

        def replace_parent_on_final_check(path: Path) -> tuple[int, int]:
            nonlocal parent_checks
            if path == output_dir:
                parent_checks += 1
                if parent_checks == 3:
                    output_dir.rename(moved_output_dir)
                    output_dir.mkdir()
            return real_directory_identity(path)

        with patch.object(
            review_state_module,
            "_directory_identity",
            side_effect=replace_parent_on_final_check,
        ):
            with self.assertRaisesRegex(ValueError, "Output directory changed"):
                review_state_module._publish_artifacts(
                    ((artifact, b"new diff\n"),),
                    expected_parent_identity=output_identity,
                    validate=lambda: None,
                )

        self.assertFalse((output_dir / artifact.name).exists())
        self.assertEqual(
            (moved_output_dir / artifact.name).read_bytes(),
            b"new diff\n",
        )

    def test_directory_close_failure_after_commit_does_not_report_failure(
        self,
    ) -> None:
        output_dir = self.root / "review-output"
        output_dir.mkdir()
        output_identity = review_state_module._directory_identity(output_dir)
        artifact = output_dir / "complete.diff"
        real_close = review_state_module.os.close
        rejected = False

        def fail_committed_directory_close(descriptor: int) -> None:
            nonlocal rejected
            is_directory = stat.S_ISDIR(os.fstat(descriptor).st_mode)
            real_close(descriptor)
            if is_directory and artifact.exists():
                rejected = True
                raise OSError("directory close failed after commit")

        with patch.object(
            review_state_module.os,
            "close",
            side_effect=fail_committed_directory_close,
        ):
            review_state_module._publish_artifacts(
                ((artifact, b"new diff\n"),),
                expected_parent_identity=output_identity,
                validate=lambda: None,
            )

        self.assertTrue(rejected)
        self.assertEqual(artifact.read_bytes(), b"new diff\n")

    def test_state_rechecks_repository_before_returning(self) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        real_validate = review_state_module._validate_input_snapshots
        calls = 0

        def validate_then_change_repository(*args: object, **kwargs: object) -> None:
            nonlocal calls
            real_validate(*args, **kwargs)
            calls += 1
            if calls == 1:
                runtime.write_text("VALUE = 3\n")

        with patch.object(
            review_state_module,
            "_validate_input_snapshots",
            side_effect=validate_then_change_repository,
        ):
            with self.assertRaisesRegex(ValueError, "Repository changed"):
                review_state(self.repo, self.base, ("src/runtime.py",))

    def test_equivalent_pathspecs_have_the_same_content_fingerprint(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        explicit = review_state(self.repo, self.base, ("src/runtime.py",))
        directory = review_state(self.repo, self.base, ("src",))
        with_ignored_artifact = review_state(
            self.repo, self.base, ("src/runtime.py", "plans/private.md")
        )

        self.assertEqual(
            explicit["content_fingerprint"], directory["content_fingerprint"]
        )
        self.assertEqual(
            explicit["content_fingerprint"],
            with_ignored_artifact["content_fingerprint"],
        )

    def test_component_fingerprints_invalidate_only_changed_content(self) -> None:
        runtime = self.repo / "src" / "runtime.py"
        tests = self.repo / "tests" / "test_runtime.py"
        runtime.write_text("VALUE = 2\n")
        tests.write_text("assert 2 == 2\n")
        components = {"runtime": ("src",), "tests-examples": ("tests",)}
        before = review_state(self.repo, self.base, ("src", "tests"), components)

        tests.write_text("assert 2 != 1\n")
        after = review_state(self.repo, self.base, ("src", "tests"), components)

        self.assertEqual(
            before["components"]["runtime"]["content_fingerprint"],
            after["components"]["runtime"]["content_fingerprint"],
        )
        self.assertNotEqual(
            before["components"]["tests-examples"]["content_fingerprint"],
            after["components"]["tests-examples"]["content_fingerprint"],
        )
        self.assertNotEqual(before["content_fingerprint"], after["content_fingerprint"])

    def test_status_rename_configuration_does_not_change_fingerprints(self) -> None:
        (self.repo / "src" / "runtime.py").rename(self.repo / "src" / "renamed.py")
        self._git("add", "-A")

        renames_enabled = review_state(self.repo, self.base, ("src",))
        self._git("config", "status.renames", "false")
        renames_disabled = review_state(self.repo, self.base, ("src",))

        self.assertEqual(
            renames_enabled["status_sha256"], renames_disabled["status_sha256"]
        )
        self.assertEqual(
            renames_enabled["unfiltered"]["status_sha256"],
            renames_disabled["unfiltered"]["status_sha256"],
        )
        self.assertEqual(
            renames_enabled["repository_fingerprint"],
            renames_disabled["repository_fingerprint"],
        )

    def test_submodule_diff_configuration_does_not_change_fingerprints(self) -> None:
        source = self.root / "submodule-source"
        source.mkdir()
        subprocess.check_call(("git", "-C", str(source), "init", "-q"))
        subprocess.check_call(
            ("git", "-C", str(source), "config", "user.email", "sub@example.test")
        )
        subprocess.check_call(
            ("git", "-C", str(source), "config", "user.name", "Submodule Test")
        )
        (source / "value.txt").write_text("one\n")
        subprocess.check_call(("git", "-C", str(source), "add", "value.txt"))
        subprocess.check_call(("git", "-C", str(source), "commit", "-qm", "one"))

        self._git(
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(source),
            "vendor/dependency",
        )
        self._git("commit", "-qam", "add submodule")
        self.base = self._git("rev-parse", "HEAD").strip()

        checkout = self.repo / "vendor" / "dependency"
        subprocess.check_call(
            ("git", "-C", str(checkout), "config", "user.email", "sub@example.test")
        )
        subprocess.check_call(
            ("git", "-C", str(checkout), "config", "user.name", "Submodule Test")
        )
        (checkout / "value.txt").write_text("two\n")
        subprocess.check_call(("git", "-C", str(checkout), "commit", "-qam", "two"))

        short_format = review_state(self.repo, self.base, ("vendor/dependency",))
        self._git("config", "diff.submodule", "log")
        log_format = review_state(self.repo, self.base, ("vendor/dependency",))

        self.assertEqual(
            short_format["tracked_diff_sha256"], log_format["tracked_diff_sha256"]
        )
        self.assertEqual(
            short_format["repository_fingerprint"], log_format["repository_fingerprint"]
        )

        self._git("config", "diff.ignoreSubmodules", "all")
        ignored_format = review_state(self.repo, self.base, ("vendor/dependency",))
        self.assertEqual(
            short_format["content_fingerprint"], ignored_format["content_fingerprint"]
        )
        self.assertEqual(
            short_format["repository_fingerprint"],
            ignored_format["repository_fingerprint"],
        )

    def test_dirty_submodule_is_rejected_before_fingerprinting(self) -> None:
        source = self.root / "dirty-submodule-source"
        source.mkdir()
        subprocess.check_call(("git", "-C", str(source), "init", "-q"))
        subprocess.check_call(
            ("git", "-C", str(source), "config", "user.email", "sub@example.test")
        )
        subprocess.check_call(
            ("git", "-C", str(source), "config", "user.name", "Submodule Test")
        )
        (source / "value.txt").write_text("one\n")
        subprocess.check_call(("git", "-C", str(source), "add", "value.txt"))
        subprocess.check_call(("git", "-C", str(source), "commit", "-qm", "one"))
        self._git(
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(source),
            "vendor/dirty-dependency",
        )
        self._git("commit", "-qam", "add dirty submodule")
        self.base = self._git("rev-parse", "HEAD").strip()
        checkout = self.repo / "vendor" / "dirty-dependency"
        nested_file = checkout / "value.txt"

        for content in ("two\n", "three\n"):
            nested_file.write_text(content)
            with self.assertRaisesRegex(ValueError, "Dirty submodules"):
                review_state(self.repo, self.base, ("vendor/dirty-dependency",))

    @unittest.skipUnless(os.name == "posix", "requires POSIX file modes")
    def test_file_fingerprint_uses_owner_executable_bit(self) -> None:
        path = self.repo / "src" / "runtime.py"
        path.write_text("VALUE = 2\n")
        path.chmod(0o744)
        owner_executable = review_state(self.repo, self.base, ("src/runtime.py",))
        path.chmod(0o645)
        group_or_other_executable = review_state(
            self.repo, self.base, ("src/runtime.py",)
        )

        self.assertTrue(owner_executable["workspace"][0]["executable"])
        self.assertFalse(group_or_other_executable["workspace"][0]["executable"])
        self.assertNotEqual(
            owner_executable["content_fingerprint"],
            group_or_other_executable["content_fingerprint"],
        )

    @unittest.skipUnless(os.name == "posix", "requires POSIX file modes")
    def test_core_file_mode_cannot_change_mode_fingerprints(self) -> None:
        path = self.repo / "src" / "runtime.py"
        path.chmod(0o744)
        self._git("config", "core.fileMode", "false")
        disabled = review_state(self.repo, self.base, ("src/runtime.py",))
        self._git("config", "core.fileMode", "true")
        enabled = review_state(self.repo, self.base, ("src/runtime.py",))

        self.assertEqual(disabled["status_sha256"], enabled["status_sha256"])
        self.assertEqual(
            disabled["tracked_diff_sha256"], enabled["tracked_diff_sha256"]
        )
        self.assertEqual(
            disabled["complete_diff_sha256"], enabled["complete_diff_sha256"]
        )
        self.assertEqual(
            disabled["repository_fingerprint"], enabled["repository_fingerprint"]
        )

    def test_global_excludes_do_not_hide_task_untracked_files(self) -> None:
        generated = self.repo / "src" / "generated.py"
        generated.write_text("GENERATED = True\n")

        without_global_excludes = review_state(self.repo, self.base, ("src",))
        excludes = self.root / "global-excludes"
        excludes.write_text("src/generated.py\n")
        self._git("config", "core.excludesFile", str(excludes))
        with_global_excludes = review_state(self.repo, self.base, ("src",))

        self.assertEqual(
            without_global_excludes["content_fingerprint"],
            with_global_excludes["content_fingerprint"],
        )
        self.assertEqual(
            without_global_excludes["complete_diff_sha256"],
            with_global_excludes["complete_diff_sha256"],
        )

    def test_core_quote_path_cannot_change_diff_fingerprints(self) -> None:
        path = self.repo / "src" / "café.py"
        path.write_text("VALUE = 1\n")
        self._git("add", "src/café.py")
        self._git("commit", "-qm", "add non-ASCII path")
        self.base = self._git("rev-parse", "HEAD").strip()
        path.write_text("VALUE = 2\n")

        self._git("config", "core.quotePath", "false")
        unquoted = review_state(self.repo, self.base, ("src",))
        self._git("config", "core.quotePath", "true")
        quoted = review_state(self.repo, self.base, ("src",))

        self.assertEqual(
            unquoted["tracked_diff_sha256"], quoted["tracked_diff_sha256"]
        )
        self.assertEqual(
            unquoted["complete_diff_sha256"], quoted["complete_diff_sha256"]
        )
        self.assertEqual(
            unquoted["repository_fingerprint"], quoted["repository_fingerprint"]
        )

    def test_global_attributes_do_not_change_diff_fingerprints(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")

        without_global_attributes = review_state(self.repo, self.base, ("src",))
        attributes = self.root / "global-attributes"
        attributes.write_text("*.py binary\n")
        self._git("config", "core.attributesFile", str(attributes))
        with_global_attributes = review_state(self.repo, self.base, ("src",))

        self.assertEqual(
            without_global_attributes["tracked_diff_sha256"],
            with_global_attributes["tracked_diff_sha256"],
        )
        self.assertEqual(
            without_global_attributes["repository_fingerprint"],
            with_global_attributes["repository_fingerprint"],
        )

    def test_replace_ref_cannot_make_a_non_ancestor_base_valid(self) -> None:
        original_branch = self._git("branch", "--show-current").strip()
        self._git("checkout", "-qb", "sibling")
        (self.repo / "src" / "sibling.py").write_text("SIBLING = True\n")
        self._git("add", "src/sibling.py")
        self._git("commit", "-qm", "sibling commit")
        sibling = self._git("rev-parse", "HEAD").strip()
        self._git("checkout", "-q", original_branch)
        (self.repo / "src" / "head.py").write_text("HEAD = True\n")
        self._git("add", "src/head.py")
        self._git("commit", "-qm", "head commit")
        self._git("replace", "--graft", "HEAD", sibling)

        with self.assertRaisesRegex(ValueError, "Base must be an ancestor of HEAD"):
            review_state(self.repo, sibling, ("src",))

    def test_inherited_alternate_index_cannot_replace_repository_state(self) -> None:
        clean = review_state(self.repo, self.base, ("src",))
        alternate_index = self.root / "alternate.index"
        subprocess.run(
            ("git", "read-tree", "HEAD"),
            cwd=self.repo,
            check=True,
            capture_output=True,
            env={**os.environ, "GIT_INDEX_FILE": str(alternate_index)},
        )
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        self._git("add", "src/runtime.py")
        runtime.write_text("VALUE = 1\n")
        self.assertTrue(self._git("status", "--porcelain=v1"))

        with patch.dict(os.environ, {"GIT_INDEX_FILE": str(alternate_index)}):
            actual = review_state(self.repo, self.base, ("src",))

        self.assertNotEqual(
            clean["repository_fingerprint"], actual["repository_fingerprint"]
        )

    def test_configured_fsmonitor_cannot_hide_changed_content(self) -> None:
        clean = review_state(self.repo, self.base, ("src",))
        fsmonitor = self.root / "fsmonitor.sh"
        fsmonitor.write_text("#!/bin/sh\nprintf 'token\\0'\n")
        fsmonitor.chmod(0o755)
        self._git("config", "core.fsmonitor", str(fsmonitor))
        self._git("config", "core.fsmonitorHookVersion", "2")
        self.assertEqual(self._git("status", "--porcelain=v1"), "")
        (self.repo / "src" / "runtime.py").write_text("VALUE = 200\n")
        self.assertEqual(self._git("status", "--porcelain=v1"), "")

        actual = review_state(self.repo, self.base, ("src",))

        self.assertNotEqual(
            clean["repository_fingerprint"], actual["repository_fingerprint"]
        )
        self.assertEqual(
            [entry["path"] for entry in actual["workspace"]], ["src/runtime.py"]
        )

    def test_assume_unchanged_paths_are_not_certifiable(self) -> None:
        self._git("update-index", "--assume-unchanged", "src/runtime.py")
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        self.assertEqual(self._git("status", "--porcelain=v1"), "")

        with self.assertRaisesRegex(ValueError, "assume-unchanged"):
            review_state(self.repo, self.base, ("src",))

    def test_only_materialized_skip_worktree_paths_are_not_certifiable(self) -> None:
        runtime = self.repo / "src" / "runtime.py"
        self._git("update-index", "--skip-worktree", "src/runtime.py")
        runtime.unlink()

        sparse_state = review_state(self.repo, self.base, ("src",))

        self.assertEqual(sparse_state["workspace"], [])
        runtime.write_text("VALUE = 2\n")
        with self.assertRaisesRegex(ValueError, "skip-worktree"):
            review_state(self.repo, self.base, ("src",))

    def test_changed_nonmaterialized_skip_worktree_paths_are_not_certifiable(
        self,
    ) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        self._git("add", "src/runtime.py")
        self._git("commit", "-qm", "change sparse runtime")
        self._git("update-index", "--skip-worktree", "src/runtime.py")
        runtime.unlink()

        with self.assertRaisesRegex(ValueError, "skip-worktree"):
            review_state(
                self.repo,
                self.base,
                ("src",),
                {"runtime": ("src",)},
            )

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_non_utf8_paths_have_lossless_fingerprints(self) -> None:
        raw_relative_path = b"src/non-utf8-\xff.py"
        relative_path = os.fsdecode(raw_relative_path)
        workspace = [{"path": relative_path, "kind": "missing"}]
        other_workspace = [
            {"path": os.fsdecode(b"src/non-utf8-\xfe.py"), "kind": "missing"}
        ]

        fingerprint = review_state_module._content_fingerprint(self.base, workspace)
        other_fingerprint = review_state_module._content_fingerprint(
            self.base, other_workspace
        )
        serialized = json.dumps(workspace, ensure_ascii=True, sort_keys=True)

        self.assertRegex(fingerprint, r"^[0-9a-f]{64}$")
        self.assertNotEqual(fingerprint, other_fingerprint)
        self.assertIn("\\udcff", serialized)
        self.assertEqual(
            os.fsencode(json.loads(serialized)[0]["path"]), raw_relative_path
        )

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_non_utf8_task_paths_are_emitted_as_valid_json(self) -> None:
        raw_relative_path = b"src/non-utf8-\xff.py"
        relative_path = os.fsdecode(raw_relative_path)
        path = self.repo / relative_path
        try:
            path.write_bytes(b"VALUE = 1\n")
        except OSError as error:
            self.skipTest(f"non-UTF-8 filesystem name is unavailable: {error}")
        self._git("add", relative_path)
        self._git("commit", "-qm", "add non-UTF-8 path")
        self.base = self._git("rev-parse", "HEAD").strip()
        path.write_bytes(b"VALUE = 2\n")

        state = review_state(self.repo, self.base)

        self.assertEqual(
            os.fsencode(state["workspace"][0]["path"]), raw_relative_path
        )
        self.assertRegex(state["content_fingerprint"], r"^[0-9a-f]{64}$")

        completed = self._run_cli()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        cli_state = json.loads(completed.stdout)
        self.assertEqual(
            os.fsencode(cli_state["workspace"][0]["path"]), raw_relative_path
        )

    def test_unfiltered_workspace_accounts_for_changes_outside_manifest(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        (self.repo / "tests" / "test_runtime.py").write_text("assert 2 == 2\n")

        state = review_state(self.repo, self.base, ("src",))

        self.assertEqual(
            [entry["path"] for entry in state["workspace"]], ["src/runtime.py"]
        )
        self.assertEqual(
            [entry["path"] for entry in state["unfiltered"]["workspace"]],
            ["src/runtime.py", "tests/test_runtime.py"],
        )
        self.assertRegex(state["unfiltered"]["status_sha256"], r"^[0-9a-f]{64}$")

    def test_complete_diff_includes_task_owned_untracked_files(self) -> None:
        new_test = self.repo / "tests" / "test_new.py"
        new_test.write_text("assert 2 == 2\n")
        complete_diff = self.root / "complete.diff"

        state = review_state(
            self.repo,
            self.base,
            ("tests",),
            complete_diff_output=complete_diff,
        )

        diff = complete_diff.read_bytes()
        self.assertIn(b"diff --git a/tests/test_new.py b/tests/test_new.py", diff)
        self.assertIn(b"+assert 2 == 2", diff)
        self.assertEqual(
            state["complete_diff_sha256"], hashlib.sha256(diff).hexdigest()
        )
        self.assertEqual(
            state["complete_diff_paths"],
            ["tests/test_new.py"],
        )
        self.assertNotEqual(state["complete_diff_sha256"], state["tracked_diff_sha256"])

    def test_exact_manifest_path_includes_ignored_untracked_file(self) -> None:
        ignored = self.repo / "plans" / "private.md"
        ignored.write_text("shipped fixture\n")
        complete_diff = self.root / "complete.diff"

        state = review_state(
            self.repo,
            self.base,
            ("plans/private.md",),
            {"release-metadata": ("plans/private.md",)},
            complete_diff_output=complete_diff,
        )

        self.assertEqual(state["complete_diff_paths"], ["plans/private.md"])
        self.assertEqual(state["unfiltered"]["workspace"], state["workspace"])
        self.assertEqual(
            state["components"]["release-metadata"]["workspace"],
            state["workspace"],
        )
        self.assertIn(b"+shipped fixture", complete_diff.read_bytes())

    def test_directory_pathspec_does_not_promote_ignored_operational_files(
        self,
    ) -> None:
        (self.repo / "plans" / "private.md").write_text("operational plan\n")

        state = review_state(self.repo, self.base, ("plans",))

        self.assertEqual(state["workspace"], [])
        self.assertEqual(state["complete_diff_paths"], [])

    def test_complete_diff_output_rejects_tracked_repository_file_before_mutation(
        self,
    ) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        original = runtime.read_bytes()

        with self.assertRaisesRegex(ValueError, "outside the repository"):
            review_state(
                self.repo,
                self.base,
                ("src/runtime.py",),
                complete_diff_output=runtime,
            )

        self.assertEqual(runtime.read_bytes(), original)

    def test_complete_diff_output_rejects_a_sibling_linked_worktree(self) -> None:
        sibling = self.root / "sibling-worktree"
        self._git("worktree", "add", "-q", "--detach", str(sibling), "HEAD")
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        complete_diff = sibling / "complete.diff"

        with self.assertRaisesRegex(ValueError, "linked worktrees"):
            review_state(
                self.repo,
                self.base,
                ("src/runtime.py",),
                complete_diff_output=complete_diff,
            )

        self.assertFalse(complete_diff.exists())

    def test_complete_diff_output_rejects_hardlinked_repository_file(self) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        original = runtime.read_bytes()
        complete_diff = self.root / "complete.diff"
        complete_diff.hardlink_to(runtime)

        with self.assertRaisesRegex(ValueError, "alias repository content"):
            review_state(
                self.repo,
                self.base,
                ("src/runtime.py",),
                complete_diff_output=complete_diff,
            )

        self.assertEqual(runtime.read_bytes(), original)

    def test_complete_diff_output_handles_repository_symlink_loop(self) -> None:
        loop = self.repo / "loop"
        try:
            loop.symlink_to(loop.name)
        except OSError as error:
            self.skipTest(f"symlinks are unavailable: {error}")
        complete_diff = self.root / "complete.diff"

        state = review_state(
            self.repo,
            self.base,
            ("loop",),
            complete_diff_output=complete_diff,
        )

        self.assertEqual(state["complete_diff_paths"], ["loop"])
        self.assertTrue(complete_diff.is_file())

    def test_complete_diff_output_does_not_follow_a_post_validation_hardlink(
        self,
    ) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        original = runtime.read_bytes()
        complete_diff = self.root / "complete.diff"
        calls = 0
        real_validate = review_state_module._validate_complete_diff_output

        def validate_then_swap(*args: object, **kwargs: object) -> Path:
            nonlocal calls
            output = real_validate(*args, **kwargs)
            calls += 1
            if calls == 2:
                complete_diff.hardlink_to(runtime)
            return output

        with patch.object(
            review_state_module,
            "_validate_complete_diff_output",
            side_effect=validate_then_swap,
        ):
            with self.assertRaisesRegex(ValueError, "fresh output path"):
                review_state(
                    self.repo,
                    self.base,
                    ("src/runtime.py",),
                    complete_diff_output=complete_diff,
                )

        self.assertEqual(runtime.read_bytes(), original)
        self.assertEqual(complete_diff.read_bytes(), original)

    def test_complete_diff_output_rejects_a_replaced_parent_directory(self) -> None:
        runtime = self.repo / "src" / "runtime.py"
        runtime.write_text("VALUE = 2\n")
        original = runtime.read_bytes()
        output_directory = self.root / "review-output"
        output_directory.mkdir()
        complete_diff = output_directory / "runtime.py"
        calls = 0
        real_validate = review_state_module._validate_complete_diff_output

        def validate_then_swap(*args: object, **kwargs: object) -> Path:
            nonlocal calls
            output = real_validate(*args, **kwargs)
            calls += 1
            if calls == 2:
                output_directory.rename(self.root / "original-review-output")
                output_directory.symlink_to(self.repo / "src", target_is_directory=True)
            return output

        with patch.object(
            review_state_module,
            "_validate_complete_diff_output",
            side_effect=validate_then_swap,
        ):
            with self.assertRaisesRegex(ValueError, "Output directory changed"):
                review_state(
                    self.repo,
                    self.base,
                    ("src/runtime.py",),
                    complete_diff_output=complete_diff,
                )

        self.assertEqual(runtime.read_bytes(), original)

    def test_literal_filename_with_pathspec_metacharacters_is_exact(self) -> None:
        (self.repo / "plans" / "[a].md").write_text("literal\n")
        (self.repo / "plans" / "a.md").write_text("glob match\n")

        state = review_state(self.repo, self.base, ("plans/[a].md",))

        self.assertEqual(state["complete_diff_paths"], ["plans/[a].md"])

    def test_existing_magic_looking_filename_takes_literal_precedence(self) -> None:
        literal = self.repo / ":(glob)foo"
        glob_match = self.repo / "foo"
        literal.write_text("literal magic-looking path\n")
        glob_match.write_text("glob match\n")

        state = review_state(self.repo, self.base, (":(glob)foo",))

        self.assertEqual(state["complete_diff_paths"], [":(glob)foo"])
        self.assertEqual(
            [entry["path"] for entry in state["workspace"]],
            [":(glob)foo"],
        )
        self.assertEqual(state["workspace"][0]["kind"], "file")

    def test_explicit_glob_magic_preserves_pattern_semantics(self) -> None:
        (self.repo / "plans" / "[a].md").write_text("literal\n")
        (self.repo / "plans" / "a.md").write_text("glob match\n")

        state = review_state(self.repo, self.base, (":(glob)plans/[a].md",))

        self.assertEqual(state["complete_diff_paths"], ["plans/[a].md", "plans/a.md"])

    def test_cli_writes_complete_diff_output(self) -> None:
        (self.repo / "tests" / "test_new.py").write_text("assert True\n")
        complete_diff = self.root / "complete.diff"

        completed = self._run_cli(
            "--pathspec",
            "tests",
            "--complete-diff-output",
            str(complete_diff),
        )

        self.assertEqual(completed.returncode, 0, completed.stderr)
        state = json.loads(completed.stdout)
        self.assertEqual(
            state["complete_diff_sha256"],
            hashlib.sha256(complete_diff.read_bytes()).hexdigest(),
        )

    def test_cli_rejects_task_owned_output_before_mutation(self) -> None:
        task_file = self.repo / "tests" / "test_new.py"
        task_file.write_text("assert True\n")
        original = task_file.read_bytes()

        completed = self._run_cli(
            "--pathspec",
            "tests/test_new.py",
            "--complete-diff-output",
            str(task_file),
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("outside the repository", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertEqual(task_file.read_bytes(), original)

    def test_cli_rejects_case_alias_inside_worktree(self) -> None:
        case_alias = self._case_variant_alias(self.repo)
        if case_alias is None:
            self.skipTest("filesystem has no usable case alias")
        complete_diff = case_alias / "case-alias.diff"

        completed = self._run_cli(
            "--complete-diff-output",
            str(complete_diff),
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("outside the repository", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertFalse(complete_diff.exists())

    def test_cli_rejects_symlink_loop_output_without_traceback(self) -> None:
        complete_diff = self.root / "complete.diff"
        try:
            complete_diff.symlink_to(complete_diff.name)
        except OSError as error:
            self.skipTest(f"symlinks are unavailable: {error}")

        completed = self._run_cli(
            "--complete-diff-output",
            str(complete_diff),
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("Cannot verify artifact location identity", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertTrue(complete_diff.is_symlink())

    def test_cli_rejects_review_input_output_before_mutation(self) -> None:
        manifest = self.root / "task.paths"
        manifest.write_bytes(b"tests\0")
        original = manifest.read_bytes()

        completed = self._run_cli(
            "--pathspec-file",
            str(manifest),
            "--complete-diff-output",
            str(manifest),
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("must not replace a review input file", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)
        self.assertEqual(manifest.read_bytes(), original)

    def test_cli_rejects_linked_worktree_git_directory_outputs(self) -> None:
        linked_repo = self.root / "linked-repo"
        self._git("worktree", "add", "-q", str(linked_repo))
        linked_base = subprocess.check_output(
            ("git", "-C", str(linked_repo), "rev-parse", "HEAD"),
            text=True,
        ).strip()

        def resolved_git_directory(argument: str) -> Path:
            value = Path(
                subprocess.check_output(
                    ("git", "-C", str(linked_repo), "rev-parse", argument),
                    text=True,
                ).strip()
            )
            return (
                value.resolve()
                if value.is_absolute()
                else (linked_repo / value).resolve()
            )

        git_directory = resolved_git_directory("--git-dir")
        common_git_directory = resolved_git_directory("--git-common-dir")
        common_git_alias = self.root / "common-git-alias"
        common_git_alias.symlink_to(common_git_directory, target_is_directory=True)
        outputs = [
            git_directory / "review-probe.diff",
            common_git_directory / "refs" / "heads" / "review-probe",
            common_git_alias / "refs" / "heads" / "review-alias",
        ]
        case_git_directory = self._case_variant_alias(git_directory)
        if case_git_directory is not None:
            outputs.append(case_git_directory / "review-case-alias.diff")
        case_common_directory = self._case_variant_alias(common_git_directory)
        if case_common_directory is not None:
            outputs.append(
                case_common_directory / "refs" / "heads" / "review-case-alias"
            )

        for output in outputs:
            with self.subTest(output=output):
                completed = subprocess.run(
                    (
                        sys.executable,
                        str(Path(__file__).with_name("review_state.py")),
                        "--repo",
                        str(linked_repo),
                        "--base",
                        linked_base,
                        "--complete-diff-output",
                        str(output),
                    ),
                    capture_output=True,
                    text=True,
                )

                self.assertEqual(completed.returncode, 2)
                self.assertIn("must not be inside .git", completed.stderr)
                self.assertNotIn("Traceback", completed.stderr)
                self.assertFalse(output.exists())

    def test_complete_diff_output_rejects_git_directory_ending_in_space(
        self,
    ) -> None:
        git_directory = self._relocate_git_directory("metadata ")
        complete_diff = git_directory / "complete.diff"

        with self.assertRaisesRegex(ValueError, "must not be inside .git"):
            review_state(
                self.repo,
                self.base,
                complete_diff_output=complete_diff,
            )

        self.assertFalse(complete_diff.exists())

    def test_repository_fingerprint_includes_outside_manifest_state_and_content(
        self,
    ) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        before = review_state(self.repo, self.base, ("src",))

        outside = self.repo / "outside.txt"
        outside.write_text("first\n")
        after_add = review_state(self.repo, self.base, ("src",))
        outside.write_text("second\n")
        after_content = review_state(self.repo, self.base, ("src",))

        self.assertEqual(
            before["content_fingerprint"], after_add["content_fingerprint"]
        )
        self.assertEqual(
            after_add["content_fingerprint"], after_content["content_fingerprint"]
        )
        self.assertNotEqual(
            before["repository_fingerprint"], after_add["repository_fingerprint"]
        )
        self.assertNotEqual(
            after_add["repository_fingerprint"], after_content["repository_fingerprint"]
        )

    def test_diff_fingerprints_ignore_presentation_only_git_config(self) -> None:
        helper = self.repo / "src" / "helper.py"
        helper.write_text("HELPER = 1\n")
        self._git("add", "src/helper.py")
        self._git("commit", "-qm", "add helper")
        self.base = self._git("rev-parse", "HEAD").strip()
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        helper.write_text("HELPER = 2\n")
        before = review_state(self.repo, self.base, ("src",))

        self._git("config", "diff.noprefix", "true")
        self._git("config", "diff.algorithm", "patience")
        order_file = self.repo / ".git" / "info" / "diff-order"
        order_file.write_text("src/runtime.py\nsrc/helper.py\n")
        self._git("config", "diff.orderFile", str(order_file))
        after = review_state(self.repo, self.base, ("src",))

        self.assertEqual(before["tracked_diff_sha256"], after["tracked_diff_sha256"])
        self.assertEqual(before["complete_diff_sha256"], after["complete_diff_sha256"])
        self.assertEqual(
            before["repository_fingerprint"], after["repository_fingerprint"]
        )

    def test_diff_fingerprints_pin_inter_hunk_context(self) -> None:
        distant = self.repo / "src" / "distant.py"
        distant.write_text("".join(f"LINE_{index} = 1\n" for index in range(100)))
        self._git("add", "src/distant.py")
        self._git("commit", "-qm", "add distant lines")
        self.base = self._git("rev-parse", "HEAD").strip()
        lines = distant.read_text().splitlines(keepends=True)
        lines[1] = "LINE_1 = 2\n"
        lines[98] = "LINE_98 = 2\n"
        distant.write_text("".join(lines))

        self._git("config", "diff.interHunkContext", "0")
        before = review_state(self.repo, self.base, ("src/distant.py",))
        self._git("config", "diff.interHunkContext", "100")
        after = review_state(self.repo, self.base, ("src/distant.py",))

        self.assertEqual(before["tracked_diff_sha256"], after["tracked_diff_sha256"])
        self.assertEqual(before["complete_diff_sha256"], after["complete_diff_sha256"])
        self.assertEqual(
            before["repository_fingerprint"], after["repository_fingerprint"]
        )

    def test_pathspec_file_preserves_literal_values_and_deduplicates(self) -> None:
        manifest = self.repo / "paths.txt"
        manifest.write_bytes(b"src\0#literal\0 lead.py\0src\0")

        self.assertEqual(_load_pathspec_file(manifest), ("src", "#literal", " lead.py"))

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_pathspec_file_preserves_newline_and_non_utf8_paths(self) -> None:
        raw_paths = (b"newline\npath.py",)
        path = self.repo / os.fsdecode(raw_paths[0])
        path.write_text("VALUE = 2\n")
        manifest = self.repo / "paths.bin"
        manifest.write_bytes(b"\0".join(raw_paths) + b"\0")

        loaded = _load_pathspec_file(manifest)
        state = review_state(self.repo, self.base, loaded)

        self.assertEqual(tuple(os.fsencode(path) for path in loaded), raw_paths)
        self.assertEqual(
            {os.fsencode(entry["path"]) for entry in state["workspace"]},
            set(raw_paths),
        )

        non_utf8 = b"non-utf8-\xff.py"
        manifest.write_bytes(non_utf8 + b"\0")
        self.assertEqual(os.fsencode(_load_pathspec_file(manifest)[0]), non_utf8)

    def test_pathspec_file_rejects_ambiguous_newline_framing(self) -> None:
        manifest = self.repo / "paths.txt"
        manifest.write_bytes(b"newline\npath.py\n")

        with self.assertRaisesRegex(ValueError, "NUL-terminated"):
            _load_pathspec_file(manifest)

    def test_direct_pathspec_preserves_leading_space(self) -> None:
        (self.repo / " lead.py").write_text("VALUE = 2\n")

        completed = self._run_cli("--pathspec", " lead.py")

        self.assertEqual(completed.returncode, 0, completed.stderr)
        state = json.loads(completed.stdout)
        self.assertEqual([entry["path"] for entry in state["workspace"]], [" lead.py"])

    def test_empty_direct_pathspec_fails_closed(self) -> None:
        completed = self._run_cli("--pathspec", "")

        self.assertEqual(completed.returncode, 2)
        self.assertIn("Pathspecs must not be empty", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_invalid_manifest_files_are_parser_errors(self) -> None:
        cases = (
            ("--pathspec-file", str(self.repo / "missing.paths")),
            ("--pathspec-file", str(self.repo)),
            ("--component-pathspec-file", "runtime="),
            ("--component-pathspec-file", f"runtime={self.repo / 'missing.paths'}"),
        )
        for arguments in cases:
            with self.subTest(arguments=arguments):
                completed = self._run_cli(*arguments)
                self.assertEqual(completed.returncode, 2)
                self.assertIn("error:", completed.stderr)
                self.assertNotIn("Traceback", completed.stderr)

    def test_invalid_repository_is_a_parser_error(self) -> None:
        missing_repo = self.repo / "missing-repo"
        completed = subprocess.run(
            (
                sys.executable,
                str(Path(__file__).with_name("review_state.py")),
                "--repo",
                str(missing_repo),
                "--base",
                self.base,
            ),
            capture_output=True,
            text=True,
        )

        self.assertEqual(completed.returncode, 2)
        self.assertIn("Git command failed", completed.stderr)
        self.assertNotIn("fatal:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_invalid_base_is_a_parser_error(self) -> None:
        completed = self._run_cli("--base", "missing-revision")

        self.assertEqual(completed.returncode, 2)
        self.assertIn("Git command failed", completed.stderr)
        self.assertNotIn("fatal:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_non_ancestor_base_is_a_parser_error(self) -> None:
        self._git("checkout", "-qb", "sibling")
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        self._git("commit", "-qam", "sibling change")
        sibling = self._git("rev-parse", "HEAD").strip()
        self._git("checkout", "-qb", "current", self.base)
        (self.repo / "tests" / "test_runtime.py").write_text("assert 2 == 2\n")
        self._git("commit", "-qam", "head change")

        completed = self._run_cli("--base", sibling)

        self.assertEqual(completed.returncode, 2)
        self.assertIn("Base must be an ancestor of HEAD", completed.stderr)
        self.assertNotIn("fatal:", completed.stderr)
        self.assertNotIn("Traceback", completed.stderr)

    def test_component_manifests_must_cover_combined_content(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        (self.repo / "tests" / "test_runtime.py").write_text("assert 2 == 2\n")

        with self.assertRaisesRegex(ValueError, "missing=.*test_runtime.py"):
            review_state(self.repo, self.base, ("src", "tests"), {"runtime": ("src",)})

    def test_component_manifests_must_not_overlap(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")

        with self.assertRaisesRegex(ValueError, "overlapping=.*runtime.py"):
            review_state(
                self.repo,
                self.base,
                ("src",),
                {"runtime": ("src",), "tests-examples": ("src/runtime.py",)},
            )

    def test_components_define_combined_scope_when_pathspecs_are_omitted(self) -> None:
        (self.repo / "src" / "runtime.py").write_text("VALUE = 2\n")
        state = review_state(self.repo, self.base, components={"runtime": ("src",)})

        self.assertEqual(state["pathspecs"], ["src"])
        self.assertEqual(
            [entry["path"] for entry in state["workspace"]], ["src/runtime.py"]
        )

    def test_component_cli_value(self) -> None:
        self.assertEqual(_component("runtime=src"), ("runtime", "src"))


if __name__ == "__main__":
    unittest.main()
