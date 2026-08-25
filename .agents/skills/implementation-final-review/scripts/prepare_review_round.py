#!/usr/bin/env python3
"""Generate deterministic evidence for one implementation final-review round."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import stat
import subprocess
from pathlib import Path

from review_state import (
    StrictJsonError,
    _directory_identity,
    _git,
    _git_pathspecs,
    _is_within,
    _load_pathspec_file_snapshot,
    _open_artifact_directory,
    _parse_component_file_snapshots,
    _publish_artifacts,
    _require_artifact_publication_support,
    _repository_root,
    _repository_content_paths,
    _repository_worktree_paths,
    _review_state_revalidation_command,
    _resolve_artifact_path,
    _resolved_git_directory,
    _same_path,
    _stable_diff_args,
    _stable_status_args,
    _strict_json_loads,
    _shell_command,
    _untracked_paths,
    review_state,
)

_FINGERPRINT_LENGTH = 64
_REVIEWER_INSTRUCTIONS_HEADING = "## Reviewer instructions\n"
_DEFAULT_REVIEWER_BRIEF = (
    Path(__file__).resolve().parent.parent / "references" / "reviewer-brief.md"
)
_OUTPUT_ARTIFACT_NAMES = (
    "review-state.json",
    "task.diff",
    "task-context.diff",
    "task-untracked.json",
    "review-packet.md",
)


def _json_artifact_bytes(value: object) -> bytes:
    return (
        json.dumps(value, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    ).encode("ascii")


def _markdown_artifact_bytes(value: str) -> bytes:
    return value.encode("utf-8", errors="backslashreplace")


def _read_required_text(path: Path, label: str) -> tuple[str, bytes]:
    try:
        data = path.read_bytes()
        value = data.decode("utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError(f"Cannot read {label} {path}: {error}") from error
    if not value.strip():
        raise ValueError(f"{label.capitalize()} must not be empty: {path}")
    return value.rstrip() + "\n", data


def _load_prior_clean_components(
    path: Path | None, current_components: set[str]
) -> tuple[dict[str, str], bytes | None]:
    if path is None:
        return {}, None
    try:
        data = path.read_bytes()
        payload = _strict_json_loads(data.decode("utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError, StrictJsonError) as error:
        raise ValueError(f"Cannot read prior clean state {path}: {error}") from error
    if not isinstance(payload, dict) or set(payload) != {"clean_components"}:
        raise ValueError(
            "Prior clean state must contain exactly one clean_components object."
        )
    clean_components = payload["clean_components"]
    if not isinstance(clean_components, dict):
        raise ValueError("Prior clean state clean_components must be an object.")
    unknown = sorted(set(clean_components) - current_components)
    if unknown:
        raise ValueError(f"Prior clean state contains unknown components: {unknown}")
    validated: dict[str, str] = {}
    for name, fingerprint in clean_components.items():
        if not isinstance(fingerprint, str) or len(fingerprint) != _FINGERPRINT_LENGTH:
            raise ValueError(
                f"Prior clean component {name} must have a 64-character fingerprint."
            )
        try:
            int(fingerprint, 16)
        except ValueError as error:
            raise ValueError(
                f"Prior clean component {name} must have a hexadecimal fingerprint."
            ) from error
        validated[name] = fingerprint
    return validated, data


def _load_reviewer_contract(path: Path) -> tuple[str, bytes]:
    brief, data = _read_required_text(path, "reviewer brief")
    _, separator, contract = brief.partition(_REVIEWER_INSTRUCTIONS_HEADING)
    if not separator or not contract.strip():
        raise ValueError(
            "Reviewer brief must contain a nonempty Reviewer instructions section."
        )
    return _REVIEWER_INSTRUCTIONS_HEADING + contract, data


def _component_candidates(
    state: dict[str, object], prior_clean: dict[str, str]
) -> tuple[list[str], list[str]]:
    components = state["components"]
    assert isinstance(components, dict)
    reusable: list[str] = []
    invalidated: list[str] = []
    for name, prior_fingerprint in sorted(prior_clean.items()):
        component = components[name]
        assert isinstance(component, dict)
        if component["content_fingerprint"] == prior_fingerprint:
            reusable.append(name)
        else:
            invalidated.append(name)
    return reusable, invalidated


def _validate_output_artifacts(
    *,
    repo: Path,
    output_dir: Path,
    git_directories: set[Path],
    review_inputs: tuple[Path, ...],
    repository_content: tuple[Path, ...],
) -> dict[str, Path]:
    artifacts = _validate_output_location(
        repo=repo,
        output_dir=output_dir,
        git_directories=git_directories,
    )
    if any(
        _same_path(artifact, repository_path)
        for artifact in artifacts.values()
        for repository_path in repository_content
    ):
        raise ValueError("Review output artifacts must not alias repository content.")

    artifact_paths = list(artifacts.values())
    for index, artifact in enumerate(artifact_paths):
        if any(_same_path(artifact, other) for other in artifact_paths[index + 1 :]):
            raise ValueError("Review output artifact paths must be distinct.")
        if any(_same_path(artifact, review_input) for review_input in review_inputs):
            raise ValueError("Review output artifacts must not replace a review input.")
    return artifacts


def _validate_output_location(
    *,
    repo: Path,
    output_dir: Path,
    git_directories: set[Path],
) -> dict[str, Path]:
    artifacts = {name: output_dir / name for name in _OUTPUT_ARTIFACT_NAMES}
    resolved_artifacts = {
        name: _resolve_artifact_path(path) for name, path in artifacts.items()
    }
    if any(
        _is_within(output_dir, directory)
        or any(
            _is_within(resolved_path, directory)
            for resolved_path in resolved_artifacts.values()
        )
        for directory in git_directories
    ):
        raise ValueError("Review output artifacts must not be inside .git.")
    if any(
        _is_within(output_dir, worktree)
        or any(
            _is_within(resolved_path, worktree)
            for resolved_path in resolved_artifacts.values()
        )
        for worktree in _repository_worktree_paths(repo)
    ):
        raise ValueError(
            "Review output artifacts must be outside the repository and all linked "
            "worktrees."
        )
    return artifacts


def _untracked_content(
    repo: Path, pathspecs: tuple[str, ...]
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = []
    for raw_path in _untracked_paths(repo, pathspecs):
        relative_path = os.fsdecode(raw_path)
        path = repo / relative_path
        if path.is_symlink():
            content.append(
                {
                    "path": relative_path,
                    "kind": "symlink",
                    "target": os.readlink(path),
                }
            )
            continue
        data = path.read_bytes()
        try:
            text_content = data.decode("utf-8")
        except UnicodeDecodeError:
            content.append(
                {
                    "path": relative_path,
                    "kind": "file",
                    "executable": bool(path.stat().st_mode & stat.S_IXUSR),
                    "encoding": "base64",
                    "content": base64.b64encode(data).decode("ascii"),
                }
            )
        else:
            content.append(
                {
                    "path": relative_path,
                    "kind": "file",
                    "executable": bool(path.stat().st_mode & stat.S_IXUSR),
                    "encoding": "utf-8",
                    "content": text_content,
                }
            )
    return content


def prepare_review_round(
    *,
    repo: Path,
    base: str,
    pathspec_file: Path,
    component_pathspec_files: list[str],
    base_packet: Path,
    round_delta: Path,
    output_dir: Path,
    prior_clean_state: Path | None = None,
    reviewer_brief: Path = _DEFAULT_REVIEWER_BRIEF,
) -> dict[str, object]:
    repo = _repository_root(repo)
    output_dir = Path(os.path.abspath(os.fspath(output_dir.expanduser())))
    _require_artifact_publication_support(require_directory_listing=True)
    with _open_artifact_directory(
        output_dir,
        require_empty=True,
    ) as (output_directory_descriptor, output_directory_identity):
        return _prepare_review_round(
            repo=repo,
            base=base,
            pathspec_file=pathspec_file,
            component_pathspec_files=component_pathspec_files,
            base_packet=base_packet,
            round_delta=round_delta,
            output_dir=output_dir,
            output_directory_descriptor=output_directory_descriptor,
            output_directory_identity=output_directory_identity,
            prior_clean_state=prior_clean_state,
            reviewer_brief=reviewer_brief,
        )


def _prepare_review_round(
    *,
    repo: Path,
    base: str,
    pathspec_file: Path,
    component_pathspec_files: list[str],
    base_packet: Path,
    round_delta: Path,
    output_dir: Path,
    output_directory_descriptor: int,
    output_directory_identity: tuple[int, int],
    prior_clean_state: Path | None,
    reviewer_brief: Path,
) -> dict[str, object]:
    git_directories = {
        _resolved_git_directory(repo, "--git-dir"),
        _resolved_git_directory(repo, "--git-common-dir"),
    }
    _validate_output_location(
        repo=repo,
        output_dir=output_dir,
        git_directories=git_directories,
    )
    repository_content = _repository_content_paths(repo)
    artifacts = _validate_output_artifacts(
        repo=repo,
        output_dir=output_dir,
        git_directories=git_directories,
        review_inputs=(),
        repository_content=repository_content,
    )

    pathspecs, task_manifest_data = _load_pathspec_file_snapshot(pathspec_file)
    if not pathspecs:
        raise ValueError("The task pathspec file must contain at least one pathspec.")
    components, component_manifest_snapshots = _parse_component_file_snapshots(
        component_pathspec_files
    )
    if not components:
        raise ValueError("At least one semantic component manifest is required.")
    manifest_snapshots = (
        (pathspec_file, task_manifest_data),
        *component_manifest_snapshots,
    )
    component_manifest_paths = tuple(path for path, _ in component_manifest_snapshots)
    review_inputs = (
        pathspec_file,
        *component_manifest_paths,
        base_packet,
        round_delta,
        reviewer_brief,
        *((prior_clean_state,) if prior_clean_state is not None else ()),
    )
    artifacts = _validate_output_artifacts(
        repo=repo,
        output_dir=output_dir,
        git_directories=git_directories,
        review_inputs=review_inputs,
        repository_content=repository_content,
    )
    stable_packet, base_packet_data = _read_required_text(base_packet, "base packet")
    current_delta, round_delta_data = _read_required_text(round_delta, "round delta")
    reviewer_contract, reviewer_brief_data = _load_reviewer_contract(reviewer_brief)
    prior_clean, prior_clean_data = _load_prior_clean_components(
        prior_clean_state, set(components)
    )
    input_snapshots = (
        *manifest_snapshots,
        (base_packet, base_packet_data),
        (round_delta, round_delta_data),
        (reviewer_brief, reviewer_brief_data),
        *(
            ((prior_clean_state, prior_clean_data),)
            if prior_clean_state is not None and prior_clean_data is not None
            else ()
        ),
    )
    state = review_state(
        repo,
        base,
        pathspecs,
        components,
        review_input_snapshots=input_snapshots,
    )
    reusable, invalidated = _component_candidates(state, prior_clean)

    resolved_base = str(state["base"])
    git_pathspecs = _git_pathspecs(repo, pathspecs)
    tracked_diff = _git(
        repo,
        "diff",
        *_stable_diff_args(),
        "--binary",
        "--full-index",
        resolved_base,
        "--",
        *git_pathspecs,
    )
    context_diff = _git(
        repo,
        "diff",
        *_stable_diff_args(unified=80),
        "--full-index",
        resolved_base,
        "--",
        *git_pathspecs,
    )
    raw_status_bytes = _git(
        repo,
        "status",
        *_stable_status_args(),
        "--",
        *git_pathspecs,
    )
    if hashlib.sha256(tracked_diff).hexdigest() != state["tracked_diff_sha256"]:
        raise ValueError(
            "Tracked diff changed while preparing the review bundle; retry from a stable "
            "repository state."
        )
    if hashlib.sha256(raw_status_bytes).hexdigest() != state["status_sha256"]:
        raise ValueError(
            "Task status changed while preparing the review bundle; retry from a stable "
            "repository state."
        )
    raw_status = raw_status_bytes.decode(errors="replace")

    state_path = artifacts["review-state.json"]
    diff_path = artifacts["task.diff"]
    context_path = artifacts["task-context.diff"]
    untracked_path = artifacts["task-untracked.json"]
    packet_path = artifacts["review-packet.md"]

    component_manifest_files = {
        value.partition("=")[0]: Path(value.partition("=")[2])
        for value in component_pathspec_files
    }
    revalidation = _review_state_revalidation_command(
        repo=repo,
        base=resolved_base,
        pathspec_file=pathspec_file,
        component_pathspec_files=component_manifest_files,
    )

    enriched_state = {
        **state,
        "prior_clean_candidates": reusable,
        "invalidated_prior_clean_components": invalidated,
    }
    untracked_content = _untracked_content(repo, pathspecs)

    workspace = state["workspace"]
    assert isinstance(workspace, list)
    changed_paths = (
        "\n".join(
            f"- `{entry['path']}` ({entry['kind']}, `{entry.get('sha256', 'n/a')}`)"
            for entry in workspace
            if isinstance(entry, dict)
        )
        or "- none"
    )
    candidate_text = ", ".join(f"`{name}`" for name in reusable) or "none"
    invalidated_text = ", ".join(f"`{name}`" for name in invalidated) or "none"
    status_block = raw_status.rstrip() or "(clean)"
    packet = f"""# Independent Reviewer Packet

This packet contains stable task evidence plus only the current round delta. Historical round transcripts and superseded verification results are intentionally excluded.

## Stable Base Evidence

{stable_packet}
## Current Round Delta

{current_delta}
## Machine-Generated State

- Resolved base: `{resolved_base}`
- HEAD: `{state["head"]}`
- Combined content fingerprint: `{state["content_fingerprint"]}`
- Repository fingerprint: `{state["repository_fingerprint"]}`
- Exact fingerprint revalidation command: `{revalidation}`
- Full tracked diff: `{diff_path}`
- Wide-context tracked diff: `{context_path}`
- Complete task-owned untracked content: `{untracked_path}`
- State JSON: `{state_path}`
- Byte-identical prior-clean candidates: {candidate_text}
- Invalidated prior-clean components: {invalidated_text}

Prior-clean candidates are not automatically reusable clean credit. The reviewer and coordinator must still prove that the current delta does not change their required behavior, assertions, or boundary with changed components.

### Raw Task Status

```text
{status_block}
```

### Task Content Inventory

{changed_paths}

## Reviewer Contract

{reviewer_contract}
"""
    revalidated_context_diff = _git(
        repo,
        "diff",
        *_stable_diff_args(unified=80),
        "--full-index",
        resolved_base,
        "--",
        *git_pathspecs,
    )
    if revalidated_context_diff != context_diff:
        raise ValueError(
            "Wide-context diff changed while preparing the review bundle; retry from a stable "
            "repository state."
        )
    if _untracked_content(repo, pathspecs) != untracked_content:
        raise ValueError(
            "Untracked content changed while preparing the review bundle; retry from a stable "
            "repository state."
        )
    final_state = review_state(
        repo,
        resolved_base,
        pathspecs,
        components,
        review_input_snapshots=input_snapshots,
    )
    if (
        final_state["content_fingerprint"] != state["content_fingerprint"]
        or final_state["repository_fingerprint"] != state["repository_fingerprint"]
    ):
        raise ValueError(
            "Task content changed while preparing the review bundle; retry from a stable "
            "repository state."
        )
    final_repository_content = (
        *repository_content,
        *(
            repo / str(entry["path"])
            for entry in final_state["unfiltered"]["workspace"]
            if isinstance(entry, dict)
        ),
    )
    _validate_output_artifacts(
        repo=repo,
        output_dir=output_dir,
        git_directories=git_directories,
        review_inputs=review_inputs,
        repository_content=final_repository_content,
    )
    if _directory_identity(output_dir) != output_directory_identity:
        raise ValueError(f"Output directory changed during validation: {output_dir}.")

    def validate_publication() -> None:
        publication_state = review_state(
            repo,
            resolved_base,
            pathspecs,
            components,
            review_input_snapshots=input_snapshots,
        )
        if (
            publication_state["repository_fingerprint"]
            != state["repository_fingerprint"]
        ):
            raise ValueError(
                "Task content changed while preparing the review bundle; retry from a "
                "stable repository state."
            )

    _publish_artifacts(
        (
            (
                state_path,
                _json_artifact_bytes(enriched_state),
            ),
            (diff_path, tracked_diff),
            (context_path, context_diff),
            (
                untracked_path,
                _json_artifact_bytes(untracked_content),
            ),
            (packet_path, _markdown_artifact_bytes(packet)),
        ),
        expected_parent_identity=output_directory_identity,
        validate=validate_publication,
        directory_descriptor=output_directory_descriptor,
        require_exact_entries=True,
    )
    return enriched_state


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path.cwd(),
        help="Repository worktree root; the default current directory must be the root.",
    )
    parser.add_argument("--base", required=True)
    parser.add_argument("--pathspec-file", required=True, type=Path)
    parser.add_argument(
        "--component-pathspec-file", action="append", required=True, default=[]
    )
    parser.add_argument("--base-packet", required=True, type=Path)
    parser.add_argument("--round-delta", required=True, type=Path)
    parser.add_argument("--prior-clean-state", type=Path)
    parser.add_argument("--reviewer-brief", type=Path, default=_DEFAULT_REVIEWER_BRIEF)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    try:
        prepare_review_round(
            repo=args.repo,
            base=args.base,
            pathspec_file=args.pathspec_file,
            component_pathspec_files=args.component_pathspec_file,
            base_packet=args.base_packet,
            round_delta=args.round_delta,
            prior_clean_state=args.prior_clean_state,
            reviewer_brief=args.reviewer_brief,
            output_dir=args.output_dir,
        )
    except ValueError as error:
        parser.error(str(error))
    except subprocess.CalledProcessError as error:
        parser.error(f"Git command failed with exit status {error.returncode}.")
    except (OSError, UnicodeError) as error:
        parser.error(f"Cannot prepare review round: {error}")


if __name__ == "__main__":
    main()
