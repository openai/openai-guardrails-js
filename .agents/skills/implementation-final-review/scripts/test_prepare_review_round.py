#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import prepare_review_round as prepare_review_round_module
import review_state as review_state_module
from prepare_review_round import (
    _json_artifact_bytes,
    _markdown_artifact_bytes,
    _shell_command,
    _validate_output_artifacts,
    prepare_review_round,
)
from review_state import review_state


class PrepareReviewRoundTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.review_directory = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary_directory.name)
        self.review_root = Path(self.review_directory.name)
        self._git("init", "-q")
        self._git("config", "user.email", "review-round@example.test")
        self._git("config", "user.name", "Review Round Test")
        (self.repo / "src").mkdir()
        (self.repo / "providers").mkdir()
        (self.repo / "src" / "core.ts").write_text("export const core = 1;\n")
        (self.repo / "providers" / "adapter.ts").write_text(
            "export const adapter = 1;\n"
        )
        self._git("add", ".")
        self._git("commit", "-qm", "initial")
        self.base = self._git("rev-parse", "HEAD").strip()

        (self.repo / "src" / "core.ts").write_text("export const core = 2;\n")
        (self.repo / "providers" / "adapter.ts").write_text(
            "export const adapter = 2;\n"
        )
        (self.repo / "src" / "new.ts").write_text("export const newValue = 1;\n")
        self.task_paths = self.repo / "task.paths"
        self.core_paths = self.repo / "core.paths"
        self.provider_paths = self.repo / "providers.paths"
        self.task_paths.write_bytes(b"src\0providers\0")
        self.core_paths.write_bytes(b"src\0")
        self.provider_paths.write_bytes(b"providers\0")
        self.base_packet = self.repo / "base.md"
        self.round_delta = self.repo / "delta.md"
        self.base_packet.write_text("Required behavior: preserve review assurance.\n")
        self.round_delta.write_text("Round 2 changes only provider wiring.\n")

    def tearDown(self) -> None:
        self.review_directory.cleanup()
        self.temporary_directory.cleanup()

    def _git(self, *args: str) -> str:
        return subprocess.check_output(("git", "-C", str(self.repo), *args), text=True)

    def _relocate_git_directory(self, name: str) -> Path:
        git_directory = self.review_root / name
        (self.repo / ".git").rename(git_directory)
        (self.repo / ".git").write_text(f"gitdir: {git_directory}\n")
        return git_directory

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

    def _prepare(
        self,
        output_dir: Path,
        prior_clean_state: Path | None = None,
        *,
        create_output_dir: bool = True,
    ) -> dict[str, object]:
        if create_output_dir and not os.path.lexists(output_dir):
            output_dir.mkdir()
        return prepare_review_round(
            repo=self.repo,
            base=self.base,
            pathspec_file=self.task_paths,
            component_pathspec_files=[
                f"core={self.core_paths}",
                f"provider-adapters={self.provider_paths}",
            ],
            base_packet=self.base_packet,
            round_delta=self.round_delta,
            prior_clean_state=prior_clean_state,
            output_dir=output_dir,
        )

    def test_generates_deterministic_current_round_bundle(self) -> None:
        output_dir = self.review_root / "review-output"

        first = self._prepare(output_dir)
        first_packet = (output_dir / "review-packet.md").read_text()
        first_state = (output_dir / "review-state.json").read_text()
        second_output_dir = self.review_root / "review-output-second"
        second = self._prepare(second_output_dir)
        second_packet = (second_output_dir / "review-packet.md").read_text()

        self.assertEqual(first, second)
        self.assertEqual(
            first_packet.replace(str(output_dir), "<output>"),
            second_packet.replace(str(second_output_dir), "<output>"),
        )
        self.assertEqual(
            first_state,
            (second_output_dir / "review-state.json").read_text(),
        )
        self.assertIn("## Stable Base Evidence", first_packet)
        self.assertIn("## Current Round Delta", first_packet)
        self.assertIn("Historical round transcripts", first_packet)
        self.assertIn("## Reviewer Contract", first_packet)
        self.assertIn(
            "Exact fingerprint revalidation command: `PYTHONDONTWRITEBYTECODE=1 python3 ",
            first_packet,
        )
        self.assertIn("Return exactly one JSON object", first_packet)
        self.assertIn('"reviewed_fingerprints"', first_packet)
        self.assertTrue((output_dir / "task.diff").read_text())
        self.assertTrue((output_dir / "task-context.diff").read_text())
        untracked = json.loads((output_dir / "task-untracked.json").read_text())
        self.assertEqual(untracked[0]["path"], "src/new.ts")
        self.assertEqual(untracked[0]["encoding"], "utf-8")
        self.assertIn("newValue", untracked[0]["content"])

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_shell_command_preserves_non_utf8_filesystem_bytes(self) -> None:
        raw_path = b"/tmp/repo-with-non-utf8-\xff"
        filesystem_path = os.fsdecode(raw_path)
        check = (
            "import os,sys; "
            "assert os.environ['REVIEW_COMMAND_TEST'] == '1'; "
            f"assert os.fsencode(sys.argv[1]).hex() == '{raw_path.hex()}'"
        )

        command = _shell_command(
            [
                "REVIEW_COMMAND_TEST=1",
                sys.executable,
                "-c",
                check,
                filesystem_path,
            ]
        )

        self.assertEqual(command.encode("utf-8").decode("utf-8"), command)
        subprocess.run(command, shell=True, check=True)

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_bundle_supports_non_utf8_worktree_root(self) -> None:
        raw_repo = os.fsencode(self.review_root) + b"/repo-with-non-utf8-\xff"
        try:
            os.mkdir(raw_repo)
        except OSError as error:
            self.skipTest(f"filesystem name is unavailable: {error}")
        repo = Path(os.fsdecode(raw_repo))
        subprocess.check_call(("git", "-C", str(repo), "init", "-q"))
        subprocess.check_call(
            ("git", "-C", str(repo), "config", "user.email", "bundle@example.test")
        )
        subprocess.check_call(
            ("git", "-C", str(repo), "config", "user.name", "Bundle Test")
        )
        tracked = repo / "tracked.txt"
        tracked.write_text("base\n")
        subprocess.check_call(("git", "-C", str(repo), "add", "tracked.txt"))
        subprocess.check_call(("git", "-C", str(repo), "commit", "-qm", "initial"))
        base = subprocess.check_output(
            ("git", "-C", str(repo), "rev-parse", "HEAD"), text=True
        ).strip()
        tracked.write_text("changed\n")
        task_paths = repo / "task.paths"
        task_paths.write_bytes(b"tracked.txt\0")
        base_packet = repo / "base.md"
        base_packet.write_text("Required behavior: preserve review assurance.\n")
        round_delta = repo / "delta.md"
        round_delta.write_text("Review exact filesystem paths.\n")
        output_dir = self.review_root / "non-utf8-review-output"
        output_dir.mkdir()

        prepare_review_round(
            repo=repo,
            base=base,
            pathspec_file=task_paths,
            component_pathspec_files=[f"workflow-tooling={task_paths}"],
            base_packet=base_packet,
            round_delta=round_delta,
            output_dir=output_dir,
        )

        packet = (output_dir / "review-packet.md").read_bytes()
        packet.decode("utf-8")
        self.assertIn(b"Exact fingerprint revalidation command", packet)

    @unittest.skipUnless(os.name == "posix", "requires POSIX filesystem bytes")
    def test_bundle_serializers_escape_non_utf8_paths_losslessly(self) -> None:
        raw_path = b"src/non-utf8-\xff.ts"
        path = os.fsdecode(raw_path)

        json_artifact = _json_artifact_bytes({"path": path})
        markdown_artifact = _markdown_artifact_bytes(f"- `{path}`\n")

        self.assertEqual(
            os.fsencode(json.loads(json_artifact)["path"]),
            raw_path,
        )
        self.assertIn(b"\\udcff", json_artifact)
        self.assertIn(b"\\udcff", markdown_artifact)
        markdown_artifact.decode("utf-8")

    def test_exact_manifest_includes_ignored_untracked_content(self) -> None:
        ignored = self.repo / "ignored.txt"
        ignored.write_text("explicit ignored deliverable\n")
        (self.repo / ".git" / "info" / "exclude").write_text("ignored.txt\n")
        task_manifest = self.repo / "ignored.paths"
        task_manifest.write_bytes(b"ignored.txt\0")
        output_dir = self.review_root / "ignored-review-output"
        output_dir.mkdir()

        prepare_review_round(
            repo=self.repo,
            base=self.base,
            pathspec_file=task_manifest,
            component_pathspec_files=[f"docs-release={task_manifest}"],
            base_packet=self.base_packet,
            round_delta=self.round_delta,
            output_dir=output_dir,
        )

        untracked = json.loads((output_dir / "task-untracked.json").read_text())
        self.assertEqual([entry["path"] for entry in untracked], ["ignored.txt"])
        self.assertEqual(untracked[0]["content"], "explicit ignored deliverable\n")

    @unittest.skipUnless(os.name == "posix", "requires POSIX file modes")
    def test_untracked_bundle_uses_owner_executable_bit(self) -> None:
        untracked_file = self.repo / "mode.txt"
        untracked_file.write_text("untracked\n")
        untracked_file.chmod(0o645)
        task_manifest = self.repo / "mode.paths"
        task_manifest.write_bytes(b"mode.txt\0")
        output_dir = self.review_root / "mode-review-output"
        output_dir.mkdir()

        prepare_review_round(
            repo=self.repo,
            base=self.base,
            pathspec_file=task_manifest,
            component_pathspec_files=[f"workflow-tooling={task_manifest}"],
            base_packet=self.base_packet,
            round_delta=self.round_delta,
            output_dir=output_dir,
        )

        untracked = json.loads((output_dir / "task-untracked.json").read_text())
        self.assertFalse(untracked[0]["executable"])

    def test_exact_manifest_does_not_expand_tracked_metacharacters(self) -> None:
        literal = self.repo / "literal*.txt"
        sibling = self.repo / "literal-other.txt"
        literal.write_text("literal base\n")
        sibling.write_text("sibling base\n")
        self._git("add", ":(literal)literal*.txt", "literal-other.txt")
        self._git("commit", "-qm", "add literal fixtures")
        self.base = self._git("rev-parse", "HEAD").strip()
        literal.write_text("literal changed\n")
        sibling.write_text("sibling changed\n")
        task_manifest = self.repo / "literal.paths"
        task_manifest.write_bytes(b"literal*.txt\0")
        output_dir = self.review_root / "literal-review-output"
        output_dir.mkdir()

        prepare_review_round(
            repo=self.repo,
            base=self.base,
            pathspec_file=task_manifest,
            component_pathspec_files=[f"docs-release={task_manifest}"],
            base_packet=self.base_packet,
            round_delta=self.round_delta,
            output_dir=output_dir,
        )

        tracked_diff = (output_dir / "task.diff").read_text()
        self.assertIn("a/literal*.txt", tracked_diff)
        self.assertNotIn("literal-other.txt", tracked_diff)

    def test_marks_only_byte_identical_prior_clean_components_as_candidates(
        self,
    ) -> None:
        components = {
            "core": ("src",),
            "provider-adapters": ("providers",),
        }
        before = review_state(self.repo, self.base, ("src", "providers"), components)
        prior = self.repo / "prior.json"
        prior.write_text(
            json.dumps(
                {
                    "clean_components": {
                        name: component["content_fingerprint"]
                        for name, component in before["components"].items()
                    }
                }
            )
        )
        (self.repo / "providers" / "adapter.ts").write_text(
            "export const adapter = 3;\n"
        )

        output_dir = self.review_root / "review-output"
        state = self._prepare(output_dir, prior)

        self.assertEqual(state["prior_clean_candidates"], ["core"])
        self.assertEqual(
            state["invalidated_prior_clean_components"], ["provider-adapters"]
        )
        packet = (output_dir / "review-packet.md").read_text()
        self.assertIn("not automatically reusable clean credit", packet)

    def test_malformed_prior_clean_state_fails_closed(self) -> None:
        prior = self.repo / "prior.json"
        prior.write_text(json.dumps({"clean_components": {"unknown": "0" * 64}}))

        with self.assertRaisesRegex(ValueError, "unknown components"):
            self._prepare(self.review_root / "review-output", prior)

    def test_prior_clean_state_rejects_ambiguous_json(self) -> None:
        prior = self.repo / "prior.json"
        prior.write_text(
            '{"clean_components": {}, "clean_components": {"core": "' + "0" * 64 + '"}}'
        )
        with self.assertRaisesRegex(ValueError, "Duplicate JSON object key"):
            self._prepare(self.review_root / "duplicate-output", prior)

        prior.write_text('{"clean_components": {"core": NaN}}')
        with self.assertRaisesRegex(ValueError, "Non-finite JSON number"):
            self._prepare(self.review_root / "non-finite-output", prior)

    def test_component_partition_errors_remain_fail_closed(self) -> None:
        self.provider_paths.write_bytes(b"src\0providers\0")

        with self.assertRaisesRegex(ValueError, "overlapping"):
            self._prepare(self.review_root / "review-output")

    def test_precreated_output_directory_inside_repository_is_rejected(self) -> None:
        output_dir = self.repo / "src" / "review-output"

        with self.assertRaisesRegex(ValueError, "must be outside the repository"):
            self._prepare(output_dir)

        self.assertEqual(list(output_dir.iterdir()), [])

    def test_output_directory_inside_sibling_linked_worktree_is_rejected(self) -> None:
        sibling = self.review_root / "sibling-worktree"
        self._git("worktree", "add", "-q", "--detach", str(sibling), "HEAD")
        output_dir = sibling / "review-output"
        output_dir.mkdir()

        with self.assertRaisesRegex(ValueError, "linked worktrees"):
            self._prepare(output_dir, create_output_dir=False)

        self.assertEqual(list(output_dir.iterdir()), [])

    def test_capability_failure_precedes_repository_validation(
        self,
    ) -> None:
        output_dir = self.review_root / "review-output"
        output_dir.mkdir()

        with (
            patch.object(
                prepare_review_round_module,
                "_require_artifact_publication_support",
                side_effect=ValueError("unsupported publication"),
            ),
            patch.object(
                prepare_review_round_module,
                "_repository_content_paths",
            ) as repository_content,
        ):
            with self.assertRaisesRegex(ValueError, "unsupported publication"):
                self._prepare(output_dir, create_output_dir=False)

        repository_content.assert_not_called()
        self.assertEqual(list(output_dir.iterdir()), [])

    def test_repository_subdirectory_fails_before_opening_output_directory(
        self,
    ) -> None:
        output_dir = self.review_root / "review-output"
        output_dir.mkdir()

        with patch.object(
            prepare_review_round_module,
            "_open_artifact_directory",
        ) as open_artifact_directory:
            with self.assertRaisesRegex(ValueError, "repository worktree root"):
                prepare_review_round(
                    repo=self.repo / "src",
                    base=self.base,
                    pathspec_file=self.task_paths,
                    component_pathspec_files=[
                        f"core={self.core_paths}",
                        f"provider-adapters={self.provider_paths}",
                    ],
                    base_packet=self.base_packet,
                    round_delta=self.round_delta,
                    output_dir=output_dir,
                )

        open_artifact_directory.assert_not_called()
        self.assertEqual(list(output_dir.iterdir()), [])

    def test_output_directory_inside_git_directory_fails_closed(self) -> None:
        output_dir = self.repo / ".git" / "review-output"

        with patch.object(
            prepare_review_round_module,
            "_repository_content_paths",
        ) as repository_content:
            with self.assertRaisesRegex(ValueError, "must not be inside .git"):
                self._prepare(output_dir)

        repository_content.assert_not_called()
        self.assertEqual(list(output_dir.iterdir()), [])

    def test_git_directory_ending_in_space_fails_closed(self) -> None:
        git_directory = self._relocate_git_directory("metadata ")
        output_dir = git_directory / "review-output"

        with self.assertRaisesRegex(ValueError, "must not be inside .git"):
            self._prepare(output_dir)

        self.assertEqual(list(output_dir.iterdir()), [])

    def test_case_alias_git_output_fails_before_repository_validation(self) -> None:
        git_directory_alias = self._case_variant_alias(self.repo / ".git")
        if git_directory_alias is None:
            self.skipTest("filesystem has no usable case alias")
        output_dir = git_directory_alias / "case-alias-review-output"

        with patch.object(
            prepare_review_round_module,
            "_repository_content_paths",
        ) as repository_content:
            with self.assertRaisesRegex(ValueError, "must not be inside .git"):
                self._prepare(output_dir)

        repository_content.assert_not_called()
        self.assertEqual(list(output_dir.iterdir()), [])

    def test_nonempty_output_directory_fails_before_reading_inputs(self) -> None:
        output_dir = self.review_root / "review-output"
        output_dir.mkdir()
        sentinel = output_dir / "sentinel.txt"
        sentinel.write_text("preserve me\n")

        with self.assertRaisesRegex(ValueError, "must be empty"):
            self._prepare(output_dir)

        self.assertEqual(sentinel.read_text(), "preserve me\n")

    def test_symlink_output_directory_is_not_treated_as_fresh(self) -> None:
        real_output = self.review_root / "real-output"
        real_output.mkdir()
        output_dir = self.review_root / "review-output"
        output_dir.symlink_to(real_output, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, "cannot be opened safely"):
            self._prepare(output_dir)

        self.assertEqual(list(real_output.iterdir()), [])

    def test_broken_symlink_output_directory_is_not_treated_as_fresh(self) -> None:
        output_dir = self.review_root / "review-output"
        missing_target = self.review_root / "missing-output"
        output_dir.symlink_to(missing_target, target_is_directory=True)

        with self.assertRaisesRegex(ValueError, "cannot be opened safely"):
            self._prepare(output_dir)

        self.assertFalse(missing_target.exists())

    def test_trusted_intermediate_directory_symlink_is_supported(self) -> None:
        real_root = self.review_root / "real-root"
        output_dir = real_root / "review-output"
        output_dir.mkdir(parents=True)
        alias = self.review_root / "trusted-alias"
        alias.symlink_to(real_root, target_is_directory=True)
        aliased_output_dir = alias / "review-output"

        self._prepare(aliased_output_dir, create_output_dir=False)

        self.assertEqual(
            sorted(path.name for path in output_dir.iterdir()),
            sorted(prepare_review_round_module._OUTPUT_ARTIFACT_NAMES),
        )

    def test_repository_drift_fails_before_writing_artifacts(self) -> None:
        output_dir = self.review_root / "review-output"
        calls = 0

        def changing_review_state(*args: object, **kwargs: object) -> dict[str, object]:
            nonlocal calls
            calls += 1
            if calls == 2:
                (self.repo / "providers" / "adapter.ts").write_text(
                    "export const adapter = 3;\n"
                )
            return review_state(*args, **kwargs)

        with patch(
            "prepare_review_round.review_state", side_effect=changing_review_state
        ):
            with self.assertRaisesRegex(ValueError, "Task content changed"):
                self._prepare(output_dir)

        self.assertFalse((output_dir / "review-state.json").exists())

    def test_repository_drift_during_output_validation_fails_before_writing(
        self,
    ) -> None:
        output_dir = self.review_root / "review-output"
        calls = 0

        def validate_then_change_repository(
            *args: object, **kwargs: object
        ) -> dict[str, Path]:
            nonlocal calls
            artifacts = _validate_output_artifacts(*args, **kwargs)
            calls += 1
            if calls == 3:
                (self.repo / "providers" / "adapter.ts").write_text(
                    "export const adapter = 3;\n"
                )
            return artifacts

        with patch.object(
            prepare_review_round_module,
            "_validate_output_artifacts",
            side_effect=validate_then_change_repository,
        ):
            with self.assertRaisesRegex(ValueError, "Task content changed"):
                self._prepare(output_dir)

        self.assertEqual(calls, 3)
        self.assertFalse((output_dir / "review-state.json").exists())

    def test_artifact_collision_never_overwrites_foreign_content(self) -> None:
        output_dir = self.review_root / "review-output"
        real_publish = review_state_module._publish_artifacts
        foreign = b"foreign artifact\n"

        def publish_after_collision(
            artifacts: tuple[tuple[Path, bytes], ...],
            *,
            expected_parent_identity: tuple[int, int],
            validate: object,
            directory_descriptor: int,
            require_exact_entries: bool,
        ) -> None:
            artifacts[0][0].write_bytes(foreign)
            real_publish(
                artifacts,
                expected_parent_identity=expected_parent_identity,
                validate=validate,
                directory_descriptor=directory_descriptor,
                require_exact_entries=require_exact_entries,
            )

        with patch.object(
            prepare_review_round_module,
            "_publish_artifacts",
            side_effect=publish_after_collision,
        ):
            with self.assertRaisesRegex(ValueError, "must be empty"):
                self._prepare(output_dir)

        self.assertEqual((output_dir / "review-state.json").read_bytes(), foreign)
        self.assertEqual(
            [path.name for path in output_dir.iterdir()],
            ["review-state.json"],
        )

    def test_output_directory_replacement_after_anchor_is_rejected(self) -> None:
        output_dir = self.review_root / "review-output"
        output_dir.mkdir()
        moved_output_dir = self.review_root / "moved-review-output"
        real_validate = prepare_review_round_module._validate_output_artifacts
        validation_calls = 0

        def replace_after_final_path_validation(
            *args: object, **kwargs: object
        ) -> dict[str, Path]:
            nonlocal validation_calls
            artifacts = real_validate(*args, **kwargs)
            validation_calls += 1
            if validation_calls == 3:
                output_dir.rename(moved_output_dir)
                output_dir.mkdir()
            return artifacts

        with patch.object(
            prepare_review_round_module,
            "_validate_output_artifacts",
            side_effect=replace_after_final_path_validation,
        ):
            with self.assertRaisesRegex(ValueError, "Output directory changed"):
                self._prepare(output_dir, create_output_dir=False)

        self.assertEqual(validation_calls, 3)
        self.assertEqual(list(moved_output_dir.iterdir()), [])
        self.assertEqual(list(output_dir.iterdir()), [])

    def test_unexpected_entry_after_artifact_creation_invalidates_bundle(
        self,
    ) -> None:
        output_dir = self.review_root / "review-output"
        output_dir.mkdir()
        intruder = output_dir / "intruder.txt"
        real_review_state = review_state
        state_calls = 0

        def add_intruder_during_final_validation(
            *args: object, **kwargs: object
        ) -> dict[str, object]:
            nonlocal state_calls
            state = real_review_state(*args, **kwargs)
            state_calls += 1
            if state_calls == 4:
                intruder.write_text("foreign artifact\n")
            return state

        with patch.object(
            prepare_review_round_module,
            "review_state",
            side_effect=add_intruder_during_final_validation,
        ):
            with self.assertRaisesRegex(ValueError, "unexpected entries"):
                self._prepare(output_dir, create_output_dir=False)

        self.assertEqual(intruder.read_text(), "foreign artifact\n")
        self.assertTrue((output_dir / "review-state.json").exists())

    def test_tracked_diff_must_match_the_authoritative_state(self) -> None:
        output_dir = self.review_root / "review-output"
        real_git = prepare_review_round_module._git
        corrupted = False

        def corrupt_tracked_diff(*args: object, **kwargs: object) -> bytes:
            nonlocal corrupted
            result = real_git(*args, **kwargs)
            if (
                not corrupted
                and len(args) > 1
                and args[1] == "diff"
                and "--binary" in args
            ):
                corrupted = True
                return result + b"transient corruption\n"
            return result

        with patch.object(
            prepare_review_round_module,
            "_git",
            side_effect=corrupt_tracked_diff,
        ):
            with self.assertRaisesRegex(ValueError, "Tracked diff changed"):
                self._prepare(output_dir)

        self.assertEqual(list(output_dir.iterdir()), [])

    def test_untracked_content_must_be_repeatable_before_publication(self) -> None:
        output_dir = self.review_root / "review-output"
        real_untracked_content = prepare_review_round_module._untracked_content
        calls = 0

        def corrupt_first_capture(
            *args: object, **kwargs: object
        ) -> list[dict[str, object]]:
            nonlocal calls
            content = real_untracked_content(*args, **kwargs)
            calls += 1
            if calls == 1:
                content[0]["content"] = "transient corruption\n"
            return content

        with patch.object(
            prepare_review_round_module,
            "_untracked_content",
            side_effect=corrupt_first_capture,
        ):
            with self.assertRaisesRegex(ValueError, "Untracked content changed"):
                self._prepare(output_dir)

        self.assertEqual(list(output_dir.iterdir()), [])

    def test_wide_context_diff_must_be_repeatable_before_publication(self) -> None:
        output_dir = self.review_root / "review-output"
        real_git = prepare_review_round_module._git
        corrupted = False

        def corrupt_first_context_diff(*args: object, **kwargs: object) -> bytes:
            nonlocal corrupted
            result = real_git(*args, **kwargs)
            if (
                not corrupted
                and len(args) > 1
                and args[1] == "diff"
                and "--unified=80" in args
            ):
                corrupted = True
                return result + b"transient corruption\n"
            return result

        with patch.object(
            prepare_review_round_module,
            "_git",
            side_effect=corrupt_first_context_diff,
        ):
            with self.assertRaisesRegex(ValueError, "Wide-context diff changed"):
                self._prepare(output_dir)

        self.assertEqual(list(output_dir.iterdir()), [])

    def test_manifest_must_match_the_scope_used_for_the_bundle(self) -> None:
        output_dir = self.review_root / "review-output"
        real_review_state = review_state
        calls = 0

        def change_manifest_after_state(
            *args: object, **kwargs: object
        ) -> dict[str, object]:
            nonlocal calls
            state = real_review_state(*args, **kwargs)
            calls += 1
            if calls == 2:
                self.task_paths.write_bytes(b"src\0")
            return state

        with patch.object(
            prepare_review_round_module,
            "review_state",
            side_effect=change_manifest_after_state,
        ):
            with self.assertRaisesRegex(ValueError, "Review input changed"):
                self._prepare(output_dir)

        self.assertFalse((output_dir / "review-state.json").exists())

    def test_base_packet_must_remain_stable_until_publication(self) -> None:
        output_dir = self.review_root / "review-output"
        external_base_packet = self.review_root / "base.md"
        external_base_packet.write_text(self.base_packet.read_text())
        output_dir.mkdir()
        real_review_state = review_state
        calls = 0

        def change_base_packet_after_state(
            *args: object, **kwargs: object
        ) -> dict[str, object]:
            nonlocal calls
            state = real_review_state(*args, **kwargs)
            calls += 1
            if calls == 2:
                external_base_packet.write_text("Replacement packet content.\n")
            return state

        with patch.object(
            prepare_review_round_module,
            "review_state",
            side_effect=change_base_packet_after_state,
        ):
            with self.assertRaisesRegex(ValueError, "Review input changed"):
                prepare_review_round(
                    repo=self.repo,
                    base=self.base,
                    pathspec_file=self.task_paths,
                    component_pathspec_files=[
                        f"core={self.core_paths}",
                        f"provider-adapters={self.provider_paths}",
                    ],
                    base_packet=external_base_packet,
                    round_delta=self.round_delta,
                    output_dir=output_dir,
                )

        self.assertFalse((output_dir / "review-state.json").exists())

    def test_reviewer_brief_without_instructions_fails_closed(self) -> None:
        malformed_brief = self.repo / "malformed-reviewer-brief.md"
        malformed_brief.write_text("# Missing required section\n")
        output_dir = self.review_root / "review-output"
        output_dir.mkdir()

        with self.assertRaisesRegex(ValueError, "Reviewer instructions"):
            prepare_review_round(
                repo=self.repo,
                base=self.base,
                pathspec_file=self.task_paths,
                component_pathspec_files=[
                    f"core={self.core_paths}",
                    f"provider-adapters={self.provider_paths}",
                ],
                base_packet=self.base_packet,
                round_delta=self.round_delta,
                reviewer_brief=malformed_brief,
                output_dir=output_dir,
            )


if __name__ == "__main__":
    unittest.main()
