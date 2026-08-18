#!/usr/bin/env python3
"""Validate the Git invariants of an implementation-kickoff handoff."""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath


class GitCommandError(RuntimeError):
    """Report a failed Git inspection command."""


@dataclass(frozen=True)
class _WorktreeState:
    porcelain: str
    assume_unchanged_paths: tuple[str, ...]
    materialized_skip_worktree_paths: tuple[str, ...]

    @property
    def clean(self) -> bool:
        return not (
            self.porcelain
            or self.assume_unchanged_paths
            or self.materialized_skip_worktree_paths
        )


def _git_environment() -> dict[str, str]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.upper().startswith("GIT_")
    }
    environment["GIT_ATTR_NOSYSTEM"] = "1"
    environment["GIT_OPTIONAL_LOCKS"] = "0"
    return environment


def run_git(
    repo: Path,
    *args: str,
    check: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        ["git", "--no-replace-objects", *args],
        cwd=repo,
        check=False,
        capture_output=True,
        text=True,
        input=input_text,
        env=_git_environment(),
    )
    if check and result.returncode != 0:
        command = "git " + " ".join(args)
        detail = result.stderr.strip() or result.stdout.strip() or "unknown Git error"
        raise GitCommandError(f"{command} failed: {detail}")
    return result


def run_git_bytes(repo: Path, *args: str) -> bytes:
    result = subprocess.run(
        ["git", "--no-replace-objects", *args],
        cwd=repo,
        check=False,
        capture_output=True,
        env=_git_environment(),
    )
    if result.returncode != 0:
        command = "git " + " ".join(args)
        detail = (
            os.fsdecode(result.stderr or result.stdout).strip() or "unknown Git error"
        )
        raise GitCommandError(f"{command} failed: {detail}")
    return result.stdout


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a clean, single-commit implementation-kickoff handoff."
    )
    parser.add_argument(
        "--repo", type=Path, required=True, help="Path to the task worktree."
    )
    parser.add_argument(
        "--base",
        required=True,
        help="Expected parent commit or ref for the single handoff commit.",
    )
    parser.add_argument(
        "--expected-branch",
        required=True,
        help="Exact local branch name expected at HEAD.",
    )
    parser.add_argument(
        "--required-trailer-email",
        action="append",
        default=[],
        help="Email that must appear in a Co-authored-by trailer. Repeat as needed.",
    )
    parser.add_argument(
        "--shipped-path-manifest",
        type=Path,
        required=True,
        help=(
            "File containing the exact repository-relative paths expected in the handoff commit, "
            "as NUL-terminated filesystem-byte entries."
        ),
    )
    parser.add_argument("--json", action="store_true", help="Emit the result as JSON.")
    return parser.parse_args()


def _nonblocking_opener(path: str, flags: int) -> int:
    return os.open(path, flags | getattr(os, "O_NONBLOCK", 0))


def _read_manifest(path: Path) -> bytes:
    try:
        with open(path, "rb", opener=_nonblocking_opener) as file:
            if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
                raise ValueError(
                    f"Shipped-path manifest must be a finite regular file: {path}"
                )
            return file.read()
    except IsADirectoryError as error:
        raise ValueError(
            f"Shipped-path manifest must be a finite regular file: {path}"
        ) from error


def load_shipped_paths_snapshot(path: Path) -> tuple[set[str], bytes]:
    data = _read_manifest(path)
    if not data:
        raise ValueError(f"Shipped-path manifest is empty: {path}")
    if not data.endswith(b"\0"):
        raise ValueError(
            "Shipped-path manifest must use NUL-terminated filesystem-byte entries."
        )
    raw_paths = data[:-1].split(b"\0")
    if any(not raw_path for raw_path in raw_paths):
        raise ValueError("Shipped-path manifest contains an empty entry.")

    shipped_paths: set[str] = set()
    for raw_path_bytes in raw_paths:
        raw_path = os.fsdecode(raw_path_bytes)
        path_value = PurePosixPath(raw_path)
        if (
            path_value.is_absolute()
            or ".." in path_value.parts
            or str(path_value) != raw_path
        ):
            raise ValueError(
                "Shipped-path manifest entries must be normalized repository-relative paths: "
                f"{raw_path!r}."
            )
        if raw_path in shipped_paths:
            raise ValueError(f"Duplicate shipped-path manifest entry: {raw_path}")
        shipped_paths.add(raw_path)
    return shipped_paths, data


def load_shipped_paths(path: Path) -> set[str]:
    return load_shipped_paths_snapshot(path)[0]


def _worktree_state(repo: Path) -> _WorktreeState:
    porcelain = run_git(
        repo,
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.untrackedCache=false",
        "-c",
        "core.fileMode=true",
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "--ignore-submodules=none",
    ).stdout
    tagged_entries = tuple(
        entry
        for entry in run_git(repo, "ls-files", "-v", "-z").stdout.split("\0")
        if len(entry) >= 2 and entry[1] == " "
    )
    assume_unchanged_paths = tuple(
        entry[2:] for entry in tagged_entries if "a" <= entry[0] <= "z"
    )
    materialized_skip_worktree_paths = tuple(
        entry[2:]
        for entry in tagged_entries
        if entry[0] == "S" and os.path.lexists(repo / entry[2:])
    )
    return _WorktreeState(
        porcelain=porcelain,
        assume_unchanged_paths=assume_unchanged_paths,
        materialized_skip_worktree_paths=materialized_skip_worktree_paths,
    )


def _current_branch(repo: Path) -> str | None:
    result = run_git(repo, "symbolic-ref", "--quiet", "--short", "HEAD", check=False)
    return result.stdout.strip() if result.returncode == 0 else None


def validate(args: argparse.Namespace) -> tuple[dict[str, object], list[str]]:
    repo = args.repo.expanduser().resolve()
    failures: list[str] = []

    if not repo.is_dir():
        return {"repo": str(repo)}, [f"Repository path does not exist: {repo}"]

    top_level = Path(
        run_git(repo, "rev-parse", "--show-toplevel").stdout.strip()
    ).resolve()
    if top_level != repo:
        failures.append(
            f"--repo must be the worktree root: expected {top_level}, got {repo}"
        )

    worktree_state = _worktree_state(repo)
    if worktree_state.porcelain:
        failures.append("Worktree is not clean.")
    if worktree_state.assume_unchanged_paths:
        failures.append(
            "Tracked paths use assume-unchanged and cannot be certified: "
            f"{list(worktree_state.assume_unchanged_paths)}."
        )
    if worktree_state.materialized_skip_worktree_paths:
        failures.append(
            "Materialized tracked paths use skip-worktree and cannot be certified: "
            f"{list(worktree_state.materialized_skip_worktree_paths)}."
        )

    branch = _current_branch(repo)
    if branch is None:
        failures.append("HEAD is detached.")
    elif branch != args.expected_branch:
        failures.append(
            f"Current branch is {branch!r}, expected {args.expected_branch!r}."
        )

    base = run_git(repo, "rev-parse", f"{args.base}^{{commit}}").stdout.strip()
    head = run_git(repo, "rev-parse", "HEAD").stdout.strip()
    parent_line = run_git(repo, "show", "-s", "--format=%P", head).stdout.strip()
    parents = parent_line.split() if parent_line else []
    if len(parents) != 1:
        failures.append(f"HEAD must have exactly one parent, found {len(parents)}.")
    elif parents[0] != base:
        failures.append(f"HEAD parent is {parents[0]}, expected base {base}.")

    ahead_text = run_git(repo, "rev-list", "--count", f"{base}..{head}").stdout.strip()
    ahead = int(ahead_text)
    if ahead != 1:
        failures.append(
            f"HEAD must be exactly one commit ahead of base, found {ahead} commits."
        )

    if args.shipped_path_manifest is None:
        raise ValueError("--shipped-path-manifest is required.")
    manifest_path = args.shipped_path_manifest.expanduser().resolve()
    expected_paths, shipped_manifest_data = load_shipped_paths_snapshot(manifest_path)
    actual_paths = {
        os.fsdecode(path)
        for path in run_git_bytes(
            repo,
            "diff",
            "--name-only",
            "--no-renames",
            "--ignore-submodules=none",
            "-z",
            f"{base}..{head}",
        ).split(b"\0")
        if path
    }
    missing_paths = sorted(expected_paths - actual_paths)
    unexpected_paths = sorted(actual_paths - expected_paths)
    if missing_paths or unexpected_paths:
        failures.append(
            "Committed paths do not match the shipped-path manifest: "
            f"missing={missing_paths}, unexpected={unexpected_paths}."
        )
    shipped_manifest = str(manifest_path)
    shipped_paths = sorted(expected_paths)

    subject = run_git(repo, "show", "-s", "--format=%s", head).stdout.strip()
    if not subject:
        failures.append("HEAD commit subject is empty.")

    body = run_git(repo, "show", "-s", "--format=%B", head).stdout
    trailer_block = run_git(
        repo,
        "-c",
        "trailer.separators=:",
        "-c",
        "trailer.co-authored-by.key=Co-authored-by:",
        "interpret-trailers",
        "--parse",
        input_text=body,
    ).stdout
    trailer_pattern = re.compile(
        r"^Co-authored-by:\s*.+\s+<([^>]+)>\s*$", re.IGNORECASE
    )
    trailer_emails = {
        match.group(1).strip().casefold()
        for line in trailer_block.splitlines()
        if (match := trailer_pattern.match(line)) is not None
    }
    for email in args.required_trailer_email:
        if email.strip().casefold() not in trailer_emails:
            failures.append(f"Missing required Co-authored-by trailer for {email}.")

    final_branch = _current_branch(repo)
    if final_branch != branch:
        failures.append("Branch changed during validation.")

    final_head = run_git(repo, "rev-parse", "HEAD").stdout.strip()
    if final_head != head:
        failures.append("HEAD changed during validation.")

    try:
        final_manifest_data = _read_manifest(manifest_path)
    except (OSError, ValueError) as error:
        failures.append(f"Shipped-path manifest changed during validation: {error}")
    else:
        if final_manifest_data != shipped_manifest_data:
            failures.append("Shipped-path manifest changed during validation.")

    final_worktree_state = _worktree_state(repo)
    if final_worktree_state != worktree_state:
        failures.append("Worktree status changed during validation.")

    report: dict[str, object] = {
        "repo": str(repo),
        "base": base,
        "head": head,
        "branch": branch,
        "subject": subject,
        "ahead": ahead,
        "clean": final_worktree_state.clean and final_worktree_state == worktree_state,
        "coauthor_trailer_emails": sorted(trailer_emails),
        "shipped_path_manifest": shipped_manifest,
        "shipped_paths": shipped_paths,
        "valid": not failures,
    }
    return report, failures


def main() -> int:
    args = parse_args()
    try:
        report, failures = validate(args)
    except (GitCommandError, OSError, UnicodeError, ValueError) as exc:
        report = {"repo": str(args.repo.expanduser().resolve()), "valid": False}
        failures = [str(exc)]

    if args.json:
        print(json.dumps({**report, "failures": failures}, indent=2, sort_keys=True))
    else:
        status = "valid" if not failures else "invalid"
        print(f"Implementation handoff: {status}")
        for key in (
            "repo",
            "base",
            "head",
            "branch",
            "subject",
            "ahead",
            "clean",
            "shipped_path_manifest",
            "shipped_paths",
        ):
            if key in report:
                print(f"{key}: {report[key]}")
        for failure in failures:
            print(f"error: {failure}", file=sys.stderr)

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
