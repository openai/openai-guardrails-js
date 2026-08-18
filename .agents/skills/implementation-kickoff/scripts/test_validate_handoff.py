from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import validate_handoff as validate_handoff_module
from validate_handoff import load_shipped_paths, validate


class ValidateHandoffTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary_directory.cleanup)
        self.root = Path(self.temporary_directory.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self._git("init", "-q", "-b", "main")
        self._git("config", "user.name", "Test User")
        self._git("config", "user.email", "test@example.com")
        (self.repo / "README.md").write_text("base\n")
        self._git("add", "README.md")
        self._git("commit", "-qm", "base")
        self.base = self._git("rev-parse", "HEAD").stdout.strip()
        self._git("checkout", "-qb", "feat/review-workflow")

    def _git(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ("git", *args),
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
        )

    def _commit(self, paths: dict[str, str], message: str = "change workflow") -> None:
        for relative_path, content in paths.items():
            path = self.repo / relative_path
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self._git("add", *paths)
        self._git("commit", "-qm", message)

    def _args(
        self, manifest: Path, required_trailer_emails: tuple[str, ...] = ()
    ) -> Namespace:
        return Namespace(
            repo=self.repo,
            base=self.base,
            expected_branch="feat/review-workflow",
            required_trailer_email=list(required_trailer_emails),
            shipped_path_manifest=manifest,
        )

    def test_git_environment_filters_repository_overrides_case_insensitively(
        self,
    ) -> None:
        with patch.dict(
            os.environ,
            {"GIT_DIR": "upper", "git_index_file": "mixed"},
            clear=True,
        ):
            environment = validate_handoff_module._git_environment()

        self.assertNotIn("GIT_DIR", environment)
        self.assertNotIn("git_index_file", environment)
        self.assertEqual(environment["GIT_OPTIONAL_LOCKS"], "0")

    def test_inherited_git_trace_cannot_write_during_validation(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        trace = self.root / "git.trace"

        with patch.dict(os.environ, {"GIT_TRACE": str(trace)}):
            report, failures = validate(self._args(manifest))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertFalse(trace.exists())

    def test_exact_shipped_manifest_is_valid(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")

        report, failures = validate(self._args(manifest))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(report["shipped_paths"], ["src/change.py"])

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_manifest_preserves_newline_and_non_utf8_paths(self) -> None:
        raw_paths = (b"src/newline\npath.py",)
        paths = tuple(os.fsdecode(path) for path in raw_paths)
        self._commit({path: "value = 1\n" for path in paths})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"\0".join(raw_paths) + b"\0")

        report, failures = validate(self._args(manifest))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(
            {os.fsencode(path) for path in report["shipped_paths"]}, set(raw_paths)
        )

        non_utf8 = b"src/non-utf8-\xff.py"
        manifest.write_bytes(non_utf8 + b"\0")
        self.assertEqual(
            {os.fsencode(path) for path in load_shipped_paths(manifest)},
            {non_utf8},
        )

    def test_manifest_rejects_ambiguous_newline_framing(self) -> None:
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/newline\npath.py\n")

        with self.assertRaisesRegex(ValueError, "NUL-terminated"):
            load_shipped_paths(manifest)

    def test_manifest_must_be_a_finite_regular_file(self) -> None:
        with self.assertRaisesRegex(ValueError, "finite regular file"):
            load_shipped_paths(self.repo)

    def test_cli_requires_shipped_path_manifest(self) -> None:
        result = subprocess.run(
            (
                sys.executable,
                str(Path(__file__).with_name("validate_handoff.py")),
                "--repo",
                str(self.repo),
                "--base",
                self.base,
                "--expected-branch",
                "feat/review-workflow",
            ),
            check=False,
            capture_output=True,
            text=True,
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("--shipped-path-manifest", result.stderr)

        args = self._args(self.root / "unused.paths")
        args.shipped_path_manifest = None
        with self.assertRaisesRegex(ValueError, "--shipped-path-manifest is required"):
            validate(args)

    @unittest.skipUnless(os.name == "posix", "requires POSIX file modes")
    def test_core_file_mode_false_cannot_hide_mode_mismatch(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        self._git("config", "core.fileMode", "false")
        (self.repo / "src" / "change.py").chmod(0o744)

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["clean"])
        self.assertIn("Worktree is not clean.", failures)

    def test_validation_does_not_refresh_the_repository_index(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        index = self.repo / ".git" / "index"
        index_mtime = index.stat().st_mtime_ns
        changed_path = self.repo / "src" / "change.py"
        changed_path_stat = changed_path.stat()
        os.utime(
            changed_path,
            ns=(
                changed_path_stat.st_atime_ns,
                changed_path_stat.st_mtime_ns + 2_000_000_000,
            ),
        )

        report, failures = validate(self._args(manifest))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(index.stat().st_mtime_ns, index_mtime)

    def test_operational_file_not_in_manifest_fails(self) -> None:
        self._commit(
            {
                "src/change.py": "value = 1\n",
                "plans/task.md": "operational plan\n",
            }
        )
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertIn("unexpected=['plans/task.md']", failures[0])

    def test_explicit_ignored_deliverable_is_valid_after_force_staging(self) -> None:
        (self.repo / ".git" / "info" / "exclude").write_text("fixture.generated\n")
        fixture = self.repo / "fixture.generated"
        fixture.write_text("shipped fixture\n")
        self._git("add", "-f", "fixture.generated")
        self._git("commit", "-qm", "add ignored fixture")
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"fixture.generated\0")

        report, failures = validate(self._args(manifest))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(report["shipped_paths"], ["fixture.generated"])

    def test_manifest_paths_must_be_normalized_and_unique(self) -> None:
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0src/change.py\0")
        with self.assertRaisesRegex(
            ValueError, "Duplicate shipped-path manifest entry"
        ):
            load_shipped_paths(manifest)

        manifest.write_bytes(b"../outside.txt\0")
        with self.assertRaisesRegex(ValueError, "normalized repository-relative paths"):
            load_shipped_paths(manifest)

    def test_required_coauthor_must_be_in_the_actual_trailer_block(self) -> None:
        email = "misplaced@example.com"
        self._commit(
            {"src/change.py": "value = 1\n"},
            (
                "change workflow\n\n"
                f"Co-authored-by: Misplaced Author <{email}>\n\n"
                "This attribution-like line is part of the message body."
            ),
        )
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")

        report, failures = validate(self._args(manifest, (email,)))

        self.assertFalse(report["valid"])
        self.assertEqual(report["coauthor_trailer_emails"], [])
        self.assertIn(f"Missing required Co-authored-by trailer for {email}.", failures)

    def test_required_coauthor_in_the_trailer_block_is_valid(self) -> None:
        email = "coauthor@example.com"
        self._commit(
            {"src/change.py": "value = 1\n"},
            (
                "change workflow\n\n"
                "Explain the implementation.\n\n"
                f"Co-authored-by: Actual Coauthor <{email}>"
            ),
        )
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")

        report, failures = validate(self._args(manifest, (email,)))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(report["coauthor_trailer_emails"], [email])

    def test_required_coauthor_ignores_configured_trailer_separators(self) -> None:
        email = "coauthor@example.com"
        self._commit(
            {"src/change.py": "value = 1\n"},
            (
                "change workflow\n\n"
                "Explain the implementation.\n\n"
                f"Co-authored-by: Actual Coauthor <{email}>"
            ),
        )
        self._git("config", "trailer.separators", "=")
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")

        report, failures = validate(self._args(manifest, (email,)))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(report["coauthor_trailer_emails"], [email])

    def test_required_coauthor_ignores_configured_trailer_key(self) -> None:
        email = "coauthor@example.com"
        self._commit(
            {"src/change.py": "value = 1\n"},
            (
                "change workflow\n\n"
                "Explain the implementation.\n\n"
                f"Co-authored-by: Actual Coauthor <{email}>"
            ),
        )
        self._git("config", "trailer.co-authored-by.key", "Pair:")
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")

        report, failures = validate(self._args(manifest, (email,)))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(report["coauthor_trailer_emails"], [email])

    def test_dirty_submodule_is_not_hidden_by_git_configuration(self) -> None:
        source = self.root / "submodule-source"
        source.mkdir()
        subprocess.run(("git", "init", "-q"), cwd=source, check=True)
        subprocess.run(
            ("git", "config", "user.name", "Submodule Test"), cwd=source, check=True
        )
        subprocess.run(
            ("git", "config", "user.email", "sub@example.test"),
            cwd=source,
            check=True,
        )
        (source / "value.txt").write_text("clean\n")
        subprocess.run(("git", "add", "value.txt"), cwd=source, check=True)
        subprocess.run(("git", "commit", "-qm", "initial"), cwd=source, check=True)

        self._git(
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            str(source),
            "vendor/dependency",
        )
        self._git("commit", "-qam", "add dependency")
        (self.repo / "vendor" / "dependency" / "value.txt").write_text("dirty\n")
        self._git("config", "diff.ignoreSubmodules", "all")
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b".gitmodules\0vendor/dependency\0")

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertIn("Worktree is not clean.", failures)

    def test_worktree_change_during_validation_fails_closed(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        real_run_git = validate_handoff_module.run_git
        changed = False

        def change_worktree_after_body(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            nonlocal changed
            result = real_run_git(repo, *args, **kwargs)
            if not changed and args[:3] == ("show", "-s", "--format=%B"):
                (self.repo / "late.txt").write_text("late change\n")
                changed = True
            return result

        with patch.object(
            validate_handoff_module, "run_git", side_effect=change_worktree_after_body
        ):
            report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertFalse(report["clean"])
        self.assertIn("Worktree status changed during validation.", failures)

    def test_branch_change_during_validation_fails_closed(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        real_run_git = validate_handoff_module.run_git
        changed = False

        def change_branch_after_trailers(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            nonlocal changed
            result = real_run_git(repo, *args, **kwargs)
            if not changed and "interpret-trailers" in args:
                self._git("checkout", "-qb", "feat/late-branch")
                changed = True
            return result

        with patch.object(
            validate_handoff_module, "run_git", side_effect=change_branch_after_trailers
        ):
            report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertIn("Branch changed during validation.", failures)

    def test_head_change_during_validation_fails_closed(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        real_run_git = validate_handoff_module.run_git
        changed = False

        def change_head_after_trailers(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            nonlocal changed
            result = real_run_git(repo, *args, **kwargs)
            if not changed and "interpret-trailers" in args:
                (self.repo / "late.py").write_text("late = True\n")
                self._git("add", "late.py")
                self._git("commit", "-qm", "late commit")
                changed = True
            return result

        with patch.object(
            validate_handoff_module, "run_git", side_effect=change_head_after_trailers
        ):
            report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertIn("HEAD changed during validation.", failures)

    def test_commit_reads_are_bound_to_the_initial_head(self) -> None:
        email = "coauthor@example.com"
        self._commit(
            {"src/change.py": "value = 1\n"},
            (
                "change workflow\n\n"
                "Explain the implementation.\n\n"
                f"Co-authored-by: Actual Coauthor <{email}>"
            ),
        )
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        self._git("checkout", "-qb", "feat/transient-head", self.base)
        self._commit({"other.py": "other = True\n"}, "alternate commit")
        self._git("checkout", "-q", "feat/review-workflow")
        real_run_git = validate_handoff_module.run_git
        switched = False
        restored = False

        def switch_head_while_reading_commit(
            repo: Path, *args: str, **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            nonlocal restored, switched
            result = real_run_git(repo, *args, **kwargs)
            if not switched and args == ("rev-parse", "HEAD"):
                self._git("checkout", "-q", "feat/transient-head")
                switched = True
            elif (
                switched and not restored and args[:3] == ("show", "-s", "--format=%B")
            ):
                self._git("checkout", "-q", "feat/review-workflow")
                restored = True
            return result

        with patch.object(
            validate_handoff_module,
            "run_git",
            side_effect=switch_head_while_reading_commit,
        ):
            report, failures = validate(self._args(manifest, (email,)))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertEqual(report["coauthor_trailer_emails"], [email])

    def test_local_replace_ref_cannot_rewrite_the_handoff_history(self) -> None:
        self._commit({"src/first.py": "first = True\n"}, "first commit")
        self._commit({"src/second.py": "second = True\n"}, "second commit")
        self._git("replace", "--graft", "HEAD", self.base)
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/first.py\0src/second.py\0")

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertEqual(report["ahead"], 2)
        self.assertTrue(
            any("HEAD parent is" in failure for failure in failures), failures
        )
        self.assertIn(
            "HEAD must be exactly one commit ahead of base, found 2 commits.",
            failures,
        )

    def test_inherited_alternate_index_cannot_hide_a_dirty_worktree(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        alternate_index = self.root / "alternate.index"
        subprocess.run(
            ("git", "read-tree", "HEAD"),
            cwd=self.repo,
            check=True,
            capture_output=True,
            text=True,
            env={**os.environ, "GIT_INDEX_FILE": str(alternate_index)},
        )
        changed_path = self.repo / "src" / "change.py"
        changed_path.write_text("value = 2\n")
        self._git("add", "src/change.py")
        changed_path.write_text("value = 1\n")
        self.assertTrue(self._git("status", "--porcelain=v1").stdout)

        with patch.dict(os.environ, {"GIT_INDEX_FILE": str(alternate_index)}):
            report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertFalse(report["clean"])
        self.assertIn("Worktree is not clean.", failures)

    def test_configured_fsmonitor_cannot_hide_a_dirty_worktree(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        fsmonitor = self.root / "fsmonitor.sh"
        fsmonitor.write_text("#!/bin/sh\nprintf 'token\\0'\n")
        fsmonitor.chmod(0o755)
        self._git("config", "core.fsmonitor", str(fsmonitor))
        self._git("config", "core.fsmonitorHookVersion", "2")
        self.assertEqual(self._git("status", "--porcelain=v1").stdout, "")
        (self.repo / "src" / "change.py").write_text("value = 2\n")
        self.assertEqual(self._git("status", "--porcelain=v1").stdout, "")

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertFalse(report["clean"])
        self.assertIn("Worktree is not clean.", failures)

    def test_assume_unchanged_cannot_hide_a_dirty_worktree(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        self._git("update-index", "--assume-unchanged", "src/change.py")
        (self.repo / "src" / "change.py").write_text("value = 2\n")
        self.assertEqual(self._git("status", "--porcelain=v1").stdout, "")

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertFalse(report["clean"])
        self.assertIn(
            "Tracked paths use assume-unchanged and cannot be certified: "
            "['src/change.py'].",
            failures,
        )

    def test_materialized_skip_worktree_cannot_hide_a_dirty_file(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        self._git("update-index", "--skip-worktree", "src/change.py")
        (self.repo / "src" / "change.py").write_text("value = 2\n")
        self.assertEqual(self._git("status", "--porcelain=v1").stdout, "")

        report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertFalse(report["clean"])
        self.assertIn(
            "Materialized tracked paths use skip-worktree and cannot be certified: "
            "['src/change.py'].",
            failures,
        )

    def test_missing_skip_worktree_path_remains_valid_for_sparse_checkout(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        self._git("update-index", "--skip-worktree", "src/change.py")
        (self.repo / "src" / "change.py").unlink()

        report, failures = validate(self._args(manifest))

        self.assertEqual(failures, [])
        self.assertTrue(report["valid"])
        self.assertTrue(report["clean"])

    def test_manifest_change_during_validation_fails_closed(self) -> None:
        self._commit({"src/change.py": "value = 1\n"})
        manifest = self.root / "shipped.paths"
        manifest.write_bytes(b"src/change.py\0")
        real_run_git_bytes = validate_handoff_module.run_git_bytes
        changed = False

        def change_manifest_after_diff(repo: Path, *args: str) -> bytes:
            nonlocal changed
            result = real_run_git_bytes(repo, *args)
            if not changed and args[:2] == ("diff", "--name-only"):
                manifest.write_bytes(b"different.py\0")
                changed = True
            return result

        with patch.object(
            validate_handoff_module,
            "run_git_bytes",
            side_effect=change_manifest_after_diff,
        ):
            report, failures = validate(self._args(manifest))

        self.assertFalse(report["valid"])
        self.assertIn("Shipped-path manifest changed during validation.", failures)


if __name__ == "__main__":
    unittest.main()
