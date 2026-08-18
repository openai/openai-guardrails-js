#!/usr/bin/env python3
"""Print deterministic content and repository fingerprints for a review state."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import stat
import subprocess
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path, PurePosixPath

_STABLE_GIT_CONFIG = (
    "-c",
    f"core.attributesFile={os.devnull}",
    "-c",
    f"core.excludesFile={os.devnull}",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "-c",
    "core.fileMode=true",
    "-c",
    "core.quotePath=true",
)

_ArtifactIdentity = tuple[int, int, int]
_PublishedArtifact = tuple[Path, _ArtifactIdentity, bytes]


class StrictJsonError(ValueError):
    """Raised when JSON uses ambiguous or non-standard value syntax."""


def _strict_json_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    value: dict[str, object] = {}
    for key, item in pairs:
        if key in value:
            raise StrictJsonError(f"Duplicate JSON object key: {key!r}.")
        value[key] = item
    return value


def _reject_non_finite_json_number(value: str) -> None:
    raise StrictJsonError(f"Non-finite JSON number is not allowed: {value}.")


def _strict_json_loads(data: str | bytes) -> object:
    return json.loads(
        data,
        object_pairs_hook=_strict_json_object,
        parse_constant=_reject_non_finite_json_number,
    )


def _git_environment() -> dict[str, str]:
    environment = {
        name: value
        for name, value in os.environ.items()
        if not name.upper().startswith("GIT_")
    }
    environment["GIT_ATTR_NOSYSTEM"] = "1"
    return environment


def _git(repo: Path, *args: str) -> bytes:
    return subprocess.check_output(
        (
            "git",
            "--no-replace-objects",
            *_STABLE_GIT_CONFIG,
            "-C",
            os.fspath(repo),
            *args,
        ),
        stderr=subprocess.PIPE,
        env=_git_environment(),
    )


def _git_diff(repo: Path, *args: str) -> bytes:
    completed = subprocess.run(
        (
            "git",
            "--no-replace-objects",
            *_STABLE_GIT_CONFIG,
            "-C",
            os.fspath(repo),
            *args,
        ),
        capture_output=True,
        env=_git_environment(),
    )
    if completed.returncode not in {0, 1}:
        raise subprocess.CalledProcessError(
            completed.returncode,
            completed.args,
            output=completed.stdout,
            stderr=completed.stderr,
        )
    return completed.stdout


def _shell_command(arguments: list[str]) -> str:
    command = shlex.join(arguments)
    try:
        command.encode("utf-8")
    except UnicodeEncodeError:
        if len(arguments) < 2 or "=" not in arguments[0]:
            raise ValueError(
                "Cannot render a non-UTF-8 command without an environment prefix."
            )
        launcher = (
            "import os,sys; "
            "argv=[os.fsdecode(bytes.fromhex(value)) for value in sys.argv[1:]]; "
            "os.execvp(argv[0], argv)"
        )
        encoded_arguments = [os.fsencode(value).hex() for value in arguments[1:]]
        return shlex.join(
            [arguments[0], "python3", "-c", launcher, *encoded_arguments]
        )
    return command


def _review_state_revalidation_command(
    *,
    repo: Path,
    base: str,
    pathspec_file: Path,
    component_pathspec_files: dict[str, Path],
) -> str:
    component_args = [
        argument
        for name, path in sorted(component_pathspec_files.items())
        for argument in ("--component-pathspec-file", f"{name}={os.fspath(path)}")
    ]
    return _shell_command(
        [
            "PYTHONDONTWRITEBYTECODE=1",
            "python3",
            os.fspath(Path(__file__).resolve()),
            "--repo",
            os.fspath(repo),
            "--base",
            base,
            "--pathspec-file",
            os.fspath(pathspec_file),
            *component_args,
            "--pretty",
        ]
    )


def _tagged_index_entries(repo: Path) -> tuple[bytes, ...]:
    return tuple(
        entry
        for entry in _git(repo, "ls-files", "-v", "-z").split(b"\0")
        if len(entry) >= 2 and entry[1:2] == b" "
    )


def _assert_certifiable_index(repo: Path) -> None:
    tagged_entries = _tagged_index_entries(repo)
    assume_unchanged_paths = tuple(
        os.fsdecode(entry[2:]) for entry in tagged_entries if b"a" <= entry[0:1] <= b"z"
    )
    if assume_unchanged_paths:
        raise ValueError(
            "Tracked paths use assume-unchanged and cannot be certified: "
            f"{list(assume_unchanged_paths)}."
        )
    materialized_skip_worktree_paths = tuple(
        os.fsdecode(entry[2:])
        for entry in tagged_entries
        if entry[0:1] == b"S"
        and os.path.lexists(repo / os.fsdecode(entry[2:]))
    )
    if materialized_skip_worktree_paths:
        raise ValueError(
            "Materialized tracked paths use skip-worktree and cannot be certified: "
            f"{list(materialized_skip_worktree_paths)}."
        )


def _assert_changed_paths_are_not_sparse(
    repo: Path, changed_paths: tuple[bytes, ...]
) -> None:
    changed_path_set = set(changed_paths)
    sparse_changed_paths = tuple(
        os.fsdecode(entry[2:])
        for entry in _tagged_index_entries(repo)
        if entry[0:1] == b"S" and entry[2:] in changed_path_set
    )
    if sparse_changed_paths:
        raise ValueError(
            "Changed tracked paths use skip-worktree and cannot be certified: "
            f"{list(sparse_changed_paths)}."
        )


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _nonblocking_opener(path: str, flags: int) -> int:
    return os.open(path, flags | getattr(os, "O_NONBLOCK", 0))


def _read_regular_file(path: Path, context: str) -> bytes:
    try:
        with open(path, "rb", opener=_nonblocking_opener) as file:
            if not stat.S_ISREG(os.fstat(file.fileno()).st_mode):
                raise ValueError(f"{context} must be a finite regular file: {path}")
            return file.read()
    except OSError as error:
        raise ValueError(f"Cannot read {context} {path}: {error}") from error


def _directory_identity(path: Path) -> tuple[int, int]:
    try:
        directory_stat = path.stat(follow_symlinks=False)
    except OSError as error:
        raise ValueError(
            f"Output directory changed or is unavailable: {path}."
        ) from error
    if not stat.S_ISDIR(directory_stat.st_mode):
        raise ValueError(
            f"Output directory changed or is not a real directory: {path}."
        )
    return directory_stat.st_dev, directory_stat.st_ino


def _require_artifact_publication_support(
    *, require_directory_listing: bool = False
) -> None:
    anchored_creation = (
        os.name == "posix"
        and hasattr(os, "O_DIRECTORY")
        and hasattr(os, "O_NOFOLLOW")
        and hasattr(os, "fchmod")
        and os.open in os.supports_dir_fd
        and os.stat in os.supports_dir_fd
        and os.stat in os.supports_follow_symlinks
        and (not require_directory_listing or os.listdir in os.supports_fd)
    )
    if not anchored_creation:
        raise ValueError(
            "Artifact publication requires directory-relative filesystem "
            "operations on this platform."
        )


@contextmanager
def _open_artifact_directory(
    path: Path,
    *,
    require_empty: bool,
) -> Iterator[tuple[int, tuple[int, int]]]:
    """Open a real final directory component in a caller-trusted resolved path."""
    _require_artifact_publication_support(require_directory_listing=require_empty)
    try:
        descriptor = os.open(
            path,
            os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
        )
    except OSError as error:
        raise ValueError(
            f"Output directory changed or cannot be opened safely: {path}."
        ) from error

    primary_error: BaseException | None = None
    completed = False
    try:
        directory_stat = os.fstat(descriptor)
        identity = directory_stat.st_dev, directory_stat.st_ino
        if _directory_identity(path) != identity:
            raise ValueError(f"Output directory changed before validation: {path}.")
        if require_empty and os.listdir(descriptor):
            raise ValueError(f"Review output directory must be empty: {path}.")
        yield descriptor, identity
        completed = True
    except BaseException as error:
        primary_error = error
        raise
    finally:
        try:
            os.close(descriptor)
        except OSError as close_error:
            if primary_error is not None:
                primary_error.add_note(
                    f"Artifact directory cleanup failed: {close_error!r}."
                )
            elif not completed:
                raise


def _artifact_identity(entry: os.stat_result) -> _ArtifactIdentity:
    return entry.st_dev, entry.st_ino, stat.S_IFMT(entry.st_mode)


def _artifact_entry_stat(
    directory_descriptor: int,
    path: Path,
) -> os.stat_result | None:
    try:
        return os.stat(
            path.name,
            dir_fd=directory_descriptor,
            follow_symlinks=False,
        )
    except FileNotFoundError:
        return None


def _close_artifact_descriptor(
    descriptor: int,
    *,
    error: BaseException | None = None,
) -> None:
    try:
        os.close(descriptor)
    except OSError as close_error:
        if error is not None:
            error.add_note(f"Artifact descriptor cleanup failed: {close_error!r}.")
        else:
            raise


def _verify_published_artifacts(
    directory_descriptor: int,
    published: tuple[_PublishedArtifact, ...],
) -> None:
    for path, expected_identity, expected_data in published:
        current = _artifact_entry_stat(directory_descriptor, path)
        if current is None or _artifact_identity(current) != expected_identity:
            raise ValueError(f"Published artifact changed during publication: {path}.")
        if not stat.S_ISREG(current.st_mode):
            raise ValueError(f"Published artifact is not a regular file: {path}.")
        descriptor = os.open(
            path.name,
            os.O_RDONLY | os.O_NOFOLLOW,
            dir_fd=directory_descriptor,
        )
        read_error: BaseException | None = None
        try:
            opened_stat = os.fstat(descriptor)
            chunks: list[bytes] = []
            while chunk := os.read(descriptor, 65536):
                chunks.append(chunk)
        except BaseException as error:
            read_error = error
            raise
        finally:
            _close_artifact_descriptor(descriptor, error=read_error)
        current_after_read = _artifact_entry_stat(directory_descriptor, path)
        if (
            _artifact_identity(opened_stat) != expected_identity
            or current_after_read is None
            or _artifact_identity(current_after_read) != expected_identity
        ):
            raise ValueError(f"Published artifact changed during publication: {path}.")
        if b"".join(chunks) != expected_data:
            raise ValueError(f"Published artifact content changed: {path}.")


def _publish_artifacts(
    artifacts: tuple[tuple[Path, bytes], ...],
    *,
    expected_parent_identity: tuple[int, int],
    validate: Callable[[], None],
    directory_descriptor: int | None = None,
    require_exact_entries: bool = False,
) -> None:
    """Publish new artifacts without replacing any existing directory entry."""
    if not artifacts:
        return
    parent = artifacts[0][0].parent
    if any(path.parent != parent for path, _ in artifacts):
        raise ValueError("Published artifacts must share one output directory.")
    names = [path.name for path, _ in artifacts]
    if len(names) != len(set(names)):
        raise ValueError("Published artifact paths must be distinct.")

    _require_artifact_publication_support(
        require_directory_listing=require_exact_entries
    )

    owns_directory_descriptor = directory_descriptor is None
    primary_error: BaseException | None = None
    committed = False

    def entry_stat(path: Path) -> os.stat_result | None:
        assert directory_descriptor is not None
        return _artifact_entry_stat(directory_descriptor, path)

    def ensure_parent(label: str) -> None:
        assert directory_descriptor is not None
        descriptor_stat = os.fstat(directory_descriptor)
        descriptor_identity = descriptor_stat.st_dev, descriptor_stat.st_ino
        if descriptor_identity != expected_parent_identity:
            raise ValueError(f"Output directory changed {label}: {parent}.")
        if _directory_identity(parent) != expected_parent_identity:
            raise ValueError(f"Output directory changed {label}: {parent}.")

    def create_artifact(path: Path, data: bytes) -> _ArtifactIdentity:
        assert directory_descriptor is not None
        try:
            descriptor = os.open(
                path.name,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=directory_descriptor,
            )
        except FileExistsError as error:
            raise ValueError(
                f"Output artifact already exists: {path}. Use a fresh output path."
            ) from error

        write_error: BaseException | None = None
        try:
            os.fchmod(descriptor, 0o600)
            opened_stat = os.fstat(descriptor)
            if (
                not stat.S_ISREG(opened_stat.st_mode)
                or stat.S_IMODE(opened_stat.st_mode) != 0o600
            ):
                raise ValueError(f"Output artifact is not a regular file: {path}.")
            remaining = memoryview(data)
            while remaining:
                written = os.write(descriptor, remaining)
                if written <= 0:
                    raise OSError(f"Artifact write made no progress: {path}.")
                remaining = remaining[written:]
            return _artifact_identity(opened_stat)
        except BaseException as error:
            write_error = error
            raise
        finally:
            _close_artifact_descriptor(descriptor, error=write_error)

    try:
        if directory_descriptor is None:
            directory_descriptor = os.open(
                parent,
                os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
            )
        ensure_parent("before publication")

        if require_exact_entries and os.listdir(directory_descriptor):
            raise ValueError(f"Review output directory must be empty: {parent}.")

        for path, _ in artifacts:
            if entry_stat(path) is not None:
                raise ValueError(
                    f"Output artifact already exists: {path}. Use a fresh output path."
                )

        validate()
        ensure_parent("before publication")

        published: list[_PublishedArtifact] = []
        for path, data in artifacts:
            published_identity = create_artifact(path, data)
            published.append((path, published_identity, data))
            _verify_published_artifacts(
                directory_descriptor,
                ((path, published_identity, data),),
            )

        validate()
        _verify_published_artifacts(directory_descriptor, tuple(published))
        ensure_parent("during publication")
        if require_exact_entries and set(os.listdir(directory_descriptor)) != set(
            names
        ):
            raise ValueError(
                f"Review output directory contains unexpected entries: {parent}."
            )
        ensure_parent("after directory entry validation")
        committed = True
    except BaseException as error:
        primary_error = error
        raise
    finally:
        if owns_directory_descriptor and directory_descriptor is not None:
            try:
                os.close(directory_descriptor)
            except OSError as close_error:
                if primary_error is not None:
                    primary_error.add_note(
                        f"Artifact directory cleanup failed: {close_error!r}."
                    )
                elif not committed:
                    raise


def _stable_diff_args(*, unified: int = 3) -> tuple[str, ...]:
    return (
        "--no-ext-diff",
        "--no-textconv",
        "--no-renames",
        "--no-color",
        "--src-prefix=a/",
        "--dst-prefix=b/",
        f"--unified={unified}",
        "--inter-hunk-context=0",
        "--diff-algorithm=myers",
        "--indent-heuristic",
        "--ignore-submodules=none",
        "--submodule=short",
        f"-O{os.devnull}",
    )


def _stable_status_args() -> tuple[str, ...]:
    return (
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--no-renames",
        "--ignore-submodules=none",
    )


def _absolute_path(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path.expanduser())))


def _same_path(left: Path, right: Path) -> bool:
    left_absolute = _absolute_path(left)
    right_absolute = _absolute_path(right)
    if left_absolute == right_absolute:
        return True
    try:
        if left_absolute.resolve() == right_absolute.resolve():
            return True
    except (OSError, RuntimeError):
        pass
    try:
        return os.path.samefile(left_absolute, right_absolute)
    except OSError:
        return False


def _git_path(repo: Path, argument: str) -> Path:
    output = _git(repo, "rev-parse", argument)
    if not output.endswith(b"\n"):
        raise ValueError(f"Git path output for {argument} is not LF-terminated.")
    value = output[:-1]
    if not value or b"\0" in value:
        raise ValueError(f"Git returned an invalid path for {argument}.")
    return Path(os.fsdecode(value))


def _repository_root(repo: Path) -> Path:
    try:
        requested_repo = _absolute_path(repo).resolve()
    except (OSError, RuntimeError) as error:
        raise ValueError(f"Cannot resolve repository path: {repo}.") from error

    try:
        top_level = _git_path(requested_repo, "--show-toplevel").resolve()
    except (OSError, RuntimeError) as error:
        raise ValueError("Cannot resolve the repository worktree root.") from error
    if not _same_path(requested_repo, top_level):
        raise ValueError(f"--repo must be the repository worktree root: {top_level}.")
    return top_level


def _resolved_git_directory(repo: Path, argument: str) -> Path:
    value = _git_path(repo, argument)
    return value.resolve() if value.is_absolute() else (repo / value).resolve()


def _resolve_artifact_path(path: Path) -> Path:
    try:
        return path.resolve()
    except (OSError, RuntimeError) as error:
        raise ValueError(
            f"Cannot verify artifact location identity: {path}."
        ) from error


def _is_within(path: Path, directory: Path) -> bool:
    candidate = _absolute_path(path)
    protected_directory = _absolute_path(directory)
    while True:
        try:
            if os.path.samefile(candidate, protected_directory):
                return True
        except FileNotFoundError:
            pass
        except OSError as error:
            raise ValueError(
                f"Cannot verify artifact location identity: {path}."
            ) from error
        parent = candidate.parent
        if parent == candidate:
            return False
        candidate = parent


def _repository_content_paths(repo: Path) -> tuple[Path, ...]:
    raw_paths = _git(
        repo,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
    )
    return tuple(
        repo / os.fsdecode(raw_path) for raw_path in raw_paths.split(b"\0") if raw_path
    )


def _repository_worktree_paths(repo: Path) -> tuple[Path, ...]:
    prefix = b"worktree "
    raw_paths = tuple(
        field[len(prefix) :]
        for field in _git(repo, "worktree", "list", "--porcelain", "-z").split(
            b"\0"
        )
        if field.startswith(prefix)
    )
    if not raw_paths or any(not raw_path for raw_path in raw_paths):
        raise ValueError("Git returned an invalid worktree inventory.")
    paths = tuple(Path(os.fsdecode(raw_path)) for raw_path in raw_paths)
    if any(not path.is_absolute() for path in paths):
        raise ValueError("Git returned a non-absolute worktree path.")
    return paths


def _validate_complete_diff_output(
    repo: Path,
    output: Path,
    review_inputs: tuple[Path, ...] = (),
    repository_content: tuple[Path, ...] = (),
) -> Path:
    output_absolute = _absolute_path(output)
    output_resolved = _resolve_artifact_path(output_absolute)
    git_directories = {
        _resolved_git_directory(repo, "--git-dir"),
        _resolved_git_directory(repo, "--git-common-dir"),
    }
    if any(
        _is_within(output_absolute, directory) or _is_within(output_resolved, directory)
        for directory in git_directories
    ):
        raise ValueError("--complete-diff-output must not be inside .git.")
    if any(
        _is_within(output_absolute, worktree)
        or _is_within(output_resolved, worktree)
        for worktree in _repository_worktree_paths(repo)
    ):
        raise ValueError(
            "--complete-diff-output must be outside the repository and all linked "
            "worktrees."
        )
    if any(_same_path(output_absolute, review_input) for review_input in review_inputs):
        raise ValueError("--complete-diff-output must not replace a review input file.")
    if any(
        _same_path(output_absolute, repository_path)
        for repository_path in (*_repository_content_paths(repo), *repository_content)
    ):
        raise ValueError("--complete-diff-output must not alias repository content.")
    if os.path.lexists(output_absolute):
        raise ValueError(
            "--complete-diff-output must be a fresh path that does not already exist."
        )
    return output_absolute


def _canonical_pathspecs(pathspecs: tuple[str, ...]) -> tuple[str, ...]:
    canonical: list[str] = []
    seen: set[str] = set()
    for pathspec in pathspecs:
        if not pathspec:
            raise ValueError("Pathspecs must not be empty.")
        if "\0" in pathspec:
            raise ValueError("Pathspecs must not contain NUL bytes.")
        if pathspec not in seen:
            canonical.append(pathspec)
            seen.add(pathspec)
    return tuple(canonical)


def _parse_pathspec_manifest(data: bytes, context: str) -> tuple[str, ...]:
    if not data:
        raise ValueError(f"{context} is empty.")
    if not data.endswith(b"\0"):
        raise ValueError(
            f"{context} must use NUL-terminated filesystem-byte entries."
        )
    raw_values = data[:-1].split(b"\0")
    if any(not value for value in raw_values):
        raise ValueError(f"{context} must not contain empty entries.")
    return _canonical_pathspecs(tuple(os.fsdecode(value) for value in raw_values))


def _load_pathspec_file_snapshot(path: Path) -> tuple[tuple[str, ...], bytes]:
    data = _read_regular_file(path, "pathspec file")
    return _parse_pathspec_manifest(data, f"Pathspec file {path}"), data


def _load_pathspec_file(path: Path) -> tuple[str, ...]:
    return _load_pathspec_file_snapshot(path)[0]


def _validate_input_snapshots(snapshots: tuple[tuple[Path, bytes], ...]) -> None:
    for path, expected_data in snapshots:
        current_data = _read_regular_file(path, "review input")
        if current_data != expected_data:
            raise ValueError(f"Review input changed while computing state: {path}.")


def _workspace_entry(repo: Path, relative_path: str) -> dict[str, object]:
    path = repo / relative_path
    if path.is_symlink():
        content = b"symlink\0" + os.fsencode(os.readlink(path))
        return {
            "path": relative_path,
            "kind": "symlink",
            "sha256": _digest(content),
        }
    if path.is_file():
        content = b"file\0" + path.read_bytes()
        return {
            "path": relative_path,
            "kind": "file",
            "executable": bool(path.stat().st_mode & stat.S_IXUSR),
            "sha256": _digest(content),
        }
    if path.is_dir():
        try:
            _assert_certifiable_index(path)
            submodule_head = _git(path, "rev-parse", "HEAD^{commit}").decode().strip()
            submodule_status = _git(path, "status", *_stable_status_args())
        except (subprocess.CalledProcessError, FileNotFoundError):
            return {"path": relative_path, "kind": "directory"}
        if submodule_status:
            raise ValueError(f"Dirty submodules cannot be certified: {relative_path}.")
        return {
            "path": relative_path,
            "kind": "gitlink",
            "head": submodule_head,
            "status_sha256": _digest(submodule_status),
        }
    return {"path": relative_path, "kind": "missing"}


def _workspace_entries(
    repo: Path, base: str, pathspecs: tuple[str, ...]
) -> list[dict[str, object]]:
    git_pathspecs = _git_pathspecs(repo, pathspecs)
    tracked_paths = _git(
        repo,
        "diff",
        *_stable_diff_args(),
        "--name-only",
        "-z",
        base,
        "--",
        *git_pathspecs,
    )
    raw_tracked_paths = tuple(
        raw_path for raw_path in tracked_paths.split(b"\0") if raw_path
    )
    _assert_changed_paths_are_not_sparse(repo, raw_tracked_paths)
    untracked_paths = _untracked_paths(repo, pathspecs)
    paths = {
        os.fsdecode(raw_path)
        for raw_path in (*raw_tracked_paths, *untracked_paths)
    }
    return [_workspace_entry(repo, relative_path) for relative_path in sorted(paths)]


def _untracked_paths(repo: Path, pathspecs: tuple[str, ...]) -> tuple[bytes, ...]:
    literal_pathspecs = _literal_pathspecs(repo, pathspecs)
    raw_paths = _git(
        repo,
        "ls-files",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        *_git_pathspecs(repo, pathspecs, literal_pathspecs),
    )
    paths = {raw_path for raw_path in raw_paths.split(b"\0") if raw_path}
    for pathspec in literal_pathspecs:
        raw_path = os.fsencode(pathspec)
        tracked_paths = _git(repo, "ls-files", "-z", "--", f":(literal){pathspec}")
        if raw_path not in tracked_paths.split(b"\0"):
            paths.add(raw_path)
    return tuple(sorted(paths))


def _literal_pathspecs(repo: Path, pathspecs: tuple[str, ...]) -> frozenset[str]:
    literal_pathspecs: set[str] = set()
    for pathspec in pathspecs:
        relative_path = PurePosixPath(pathspec)
        if (
            relative_path.is_absolute()
            or pathspec != relative_path.as_posix()
            or any(part in {".", ".."} for part in relative_path.parts)
        ):
            continue
        candidate = repo.joinpath(*relative_path.parts)
        raw_path = os.fsencode(pathspec)
        tracked_paths = _git(repo, "ls-files", "-z", "--", f":(literal){pathspec}")
        if (
            candidate.is_file()
            or candidate.is_symlink()
            or raw_path in tracked_paths.split(b"\0")
        ):
            literal_pathspecs.add(pathspec)
    return frozenset(literal_pathspecs)


def _git_pathspecs(
    repo: Path,
    pathspecs: tuple[str, ...],
    literal_pathspecs: frozenset[str] | None = None,
) -> tuple[str, ...]:
    literal_pathspecs = literal_pathspecs or _literal_pathspecs(repo, pathspecs)
    return tuple(
        f":(literal){pathspec}" if pathspec in literal_pathspecs else pathspec
        for pathspec in pathspecs
    )


def _complete_diff(repo: Path, base: str, pathspecs: tuple[str, ...]) -> bytes:
    chunks = [
        _git(
            repo,
            "diff",
            *_stable_diff_args(),
            "--binary",
            "--full-index",
            base,
            "--",
            *_git_pathspecs(repo, pathspecs),
        )
    ]
    for raw_path in _untracked_paths(repo, pathspecs):
        chunks.append(
            _git_diff(
                repo,
                "diff",
                *_stable_diff_args(),
                "--no-index",
                "--binary",
                "--full-index",
                "--",
                "/dev/null",
                os.fsdecode(raw_path),
            )
        )
    return b"".join(chunks)


def _content_fingerprint(base: str, workspace: list[dict[str, object]]) -> str:
    canonical = json.dumps(
        {"base": base, "workspace": workspace},
        ensure_ascii=True,
        sort_keys=True,
        separators=(",", ":"),
    )
    return _digest(canonical.encode())


def _repository_fingerprint(
    *,
    content_fingerprint: str,
    head: str,
    status_sha256: str,
    tracked_diff_sha256: str,
    complete_diff_sha256: str,
    unfiltered_status_sha256: str,
    unfiltered_content_fingerprint: str,
) -> str:
    canonical = json.dumps(
        {
            "content_fingerprint": content_fingerprint,
            "head": head,
            "status_sha256": status_sha256,
            "tracked_diff_sha256": tracked_diff_sha256,
            "complete_diff_sha256": complete_diff_sha256,
            "unfiltered_status_sha256": unfiltered_status_sha256,
            "unfiltered_content_fingerprint": unfiltered_content_fingerprint,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return _digest(canonical.encode())


def review_state(
    repo: Path,
    base: str,
    pathspecs: tuple[str, ...] = (),
    components: dict[str, tuple[str, ...]] | None = None,
    complete_diff_output: Path | None = None,
    review_input_snapshots: tuple[tuple[Path, bytes], ...] = (),
    *,
    _verify_repository: bool = True,
) -> dict[str, object]:
    repo = _repository_root(repo)
    review_inputs = tuple(path for path, _ in review_input_snapshots)
    if complete_diff_output is None:
        return _review_state(
            repo,
            base,
            pathspecs,
            components,
            complete_diff_output=None,
            review_input_snapshots=review_input_snapshots,
            output_directory_descriptor=None,
            output_directory_identity=None,
            _verify_repository=_verify_repository,
        )

    _require_artifact_publication_support()
    complete_diff_output = _absolute_path(complete_diff_output)
    with _open_artifact_directory(
        complete_diff_output.parent,
        require_empty=False,
    ) as (output_directory_descriptor, output_directory_identity):
        complete_diff_output = _validate_complete_diff_output(
            repo,
            complete_diff_output,
            review_inputs=review_inputs,
        )
        return _review_state(
            repo,
            base,
            pathspecs,
            components,
            complete_diff_output=complete_diff_output,
            review_input_snapshots=review_input_snapshots,
            output_directory_descriptor=output_directory_descriptor,
            output_directory_identity=output_directory_identity,
            _verify_repository=_verify_repository,
        )


def _review_state(
    repo: Path,
    base: str,
    pathspecs: tuple[str, ...],
    components: dict[str, tuple[str, ...]] | None,
    *,
    complete_diff_output: Path | None,
    review_input_snapshots: tuple[tuple[Path, bytes], ...],
    output_directory_descriptor: int | None,
    output_directory_identity: tuple[int, int] | None,
    _verify_repository: bool,
) -> dict[str, object]:
    review_inputs = tuple(path for path, _ in review_input_snapshots)
    _assert_certifiable_index(repo)
    pathspecs = _canonical_pathspecs(pathspecs)
    if components and not pathspecs:
        pathspecs = _canonical_pathspecs(
            tuple(
                pathspec
                for component_pathspecs in components.values()
                for pathspec in component_pathspecs
            )
        )
    resolved_base = _git(repo, "rev-parse", f"{base}^{{commit}}").decode().strip()
    head = _git(repo, "rev-parse", "HEAD^{commit}").decode().strip()
    try:
        _git(repo, "merge-base", "--is-ancestor", resolved_base, head)
    except subprocess.CalledProcessError as error:
        raise ValueError("Base must be an ancestor of HEAD.") from error
    tracked_diff = _git(
        repo,
        "diff",
        *_stable_diff_args(),
        "--binary",
        "--full-index",
        resolved_base,
        "--",
        *_git_pathspecs(repo, pathspecs),
    )
    complete_diff = _complete_diff(repo, resolved_base, pathspecs)
    status = _git(
        repo,
        "status",
        *_stable_status_args(),
        "--",
        *_git_pathspecs(repo, pathspecs),
    )
    workspace = _workspace_entries(repo, resolved_base, pathspecs)
    unfiltered_status = _git(
        repo,
        "status",
        *_stable_status_args(),
    )
    unfiltered_workspace = _workspace_entries(repo, resolved_base, ())
    unfiltered_by_path = {str(entry["path"]): entry for entry in unfiltered_workspace}
    for entry in workspace:
        unfiltered_by_path.setdefault(str(entry["path"]), entry)
    unfiltered_workspace = [
        unfiltered_by_path[path] for path in sorted(unfiltered_by_path)
    ]

    content_fingerprint = _content_fingerprint(resolved_base, workspace)
    component_states: dict[str, dict[str, object]] = {}
    component_owners: dict[str, list[str]] = {}
    for name, component_pathspecs in sorted((components or {}).items()):
        canonical_component_pathspecs = _canonical_pathspecs(component_pathspecs)
        if not canonical_component_pathspecs:
            raise ValueError(f"Component manifest is empty: {name}")
        component_workspace = _workspace_entries(
            repo, resolved_base, canonical_component_pathspecs
        )
        for entry in component_workspace:
            component_owners.setdefault(str(entry["path"]), []).append(name)
        component_states[name] = {
            "content_fingerprint": _content_fingerprint(
                resolved_base, component_workspace
            ),
            "pathspecs": list(canonical_component_pathspecs),
            "workspace": component_workspace,
        }
    if component_states:
        combined_paths = {str(entry["path"]) for entry in workspace}
        component_paths = set(component_owners)
        missing_paths = sorted(combined_paths - component_paths)
        extra_paths = sorted(component_paths - combined_paths)
        overlapping_paths = {
            path: owners for path, owners in component_owners.items() if len(owners) > 1
        }
        if missing_paths or extra_paths or overlapping_paths:
            raise ValueError(
                "Component manifests must partition the combined review content exactly: "
                f"missing={missing_paths}, extra={extra_paths}, "
                f"overlapping={overlapping_paths}"
            )

    repository_state = {
        "content_fingerprint": content_fingerprint,
        "head": head,
        "status_sha256": _digest(status),
        "tracked_diff_sha256": _digest(tracked_diff),
        "complete_diff_sha256": _digest(complete_diff),
    }
    repository_fingerprint = _repository_fingerprint(
        **repository_state,
        unfiltered_status_sha256=_digest(unfiltered_status),
        unfiltered_content_fingerprint=_content_fingerprint(
            resolved_base, unfiltered_workspace
        ),
    )
    if complete_diff_output is not None:
        assert output_directory_descriptor is not None
        assert output_directory_identity is not None
        complete_diff_output = _validate_complete_diff_output(
            repo,
            complete_diff_output,
            review_inputs=review_inputs,
            repository_content=tuple(
                repo / str(entry["path"])
                for entry in workspace
                if isinstance(entry, dict)
            ),
        )
        if (
            _directory_identity(complete_diff_output.parent)
            != output_directory_identity
        ):
            raise ValueError(
                f"Output directory changed during validation: {complete_diff_output.parent}."
            )

        def validate_publication() -> None:
            revalidated_state = review_state(
                repo,
                resolved_base,
                pathspecs,
                components,
                review_input_snapshots=review_input_snapshots,
                _verify_repository=False,
            )
            if revalidated_state["repository_fingerprint"] != repository_fingerprint:
                raise ValueError(
                    "Repository changed while computing state; retry before publishing "
                    "the diff."
                )

        _publish_artifacts(
            ((complete_diff_output, complete_diff),),
            expected_parent_identity=output_directory_identity,
            validate=validate_publication,
            directory_descriptor=output_directory_descriptor,
        )
    else:
        _validate_input_snapshots(review_input_snapshots)
        if _verify_repository:
            revalidated_state = review_state(
                repo,
                resolved_base,
                pathspecs,
                components,
                review_input_snapshots=review_input_snapshots,
                _verify_repository=False,
            )
            if revalidated_state["repository_fingerprint"] != repository_fingerprint:
                raise ValueError(
                    "Repository changed while computing state; retry before using it."
                )
    return {
        "fingerprint": content_fingerprint,
        "content_fingerprint": content_fingerprint,
        "repository_fingerprint": repository_fingerprint,
        "base": resolved_base,
        "pathspecs": list(pathspecs),
        "workspace": workspace,
        "complete_diff_paths": [str(entry["path"]) for entry in workspace],
        "components": component_states,
        "unfiltered": {
            "status_sha256": _digest(unfiltered_status),
            "workspace": unfiltered_workspace,
        },
        **repository_state,
    }


def _parse_component_file_snapshots(
    values: list[str],
) -> tuple[dict[str, tuple[str, ...]], tuple[tuple[Path, bytes], ...]]:
    components: dict[str, tuple[str, ...]] = {}
    snapshots: list[tuple[Path, bytes]] = []
    for value in values:
        name, separator, raw_path = value.partition("=")
        if (
            not separator
            or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name)
            or not raw_path
        ):
            raise ValueError(
                "Component pathspec files must use lowercase NAME=FILE with a nonempty file."
            )
        if name in components:
            raise ValueError(f"Duplicate component name: {name}")
        path = Path(raw_path)
        components[name], data = _load_pathspec_file_snapshot(path)
        snapshots.append((path, data))
    return components, tuple(snapshots)


def _parse_component_files(values: list[str]) -> dict[str, tuple[str, ...]]:
    return _parse_component_file_snapshots(values)[0]


def _component(value: str) -> tuple[str, str]:
    name, separator, pathspec = value.partition("=")
    if not separator or not re.fullmatch(r"[a-z0-9][a-z0-9-]*", name) or not pathspec:
        raise argparse.ArgumentTypeError("component must use lowercase NAME=PATHSPEC")
    if "\0" in pathspec:
        raise argparse.ArgumentTypeError(
            "component pathspec must not contain NUL bytes"
        )
    return name, pathspec


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base", required=True, help="Resolved merge-base commit or revision."
    )
    parser.add_argument(
        "--pathspec",
        action="append",
        default=[],
        help="Task-owned Git pathspec. Repeat to scope the review; omit to include all changes.",
    )
    parser.add_argument(
        "--pathspec-file",
        action="append",
        default=[],
        type=Path,
        help=(
            "File containing canonical task-owned pathspecs as NUL-terminated "
            "filesystem-byte entries."
        ),
    )
    parser.add_argument(
        "--component-pathspec-file",
        action="append",
        default=[],
        metavar="NAME=FILE",
        help="Named component manifest. Repeat for runtime, tests-examples, or metadata.",
    )
    parser.add_argument(
        "--component",
        action="append",
        default=[],
        type=_component,
        metavar="NAME=PATHSPEC",
        help="Named component pathspec. Repeat a name to group paths into one fingerprint.",
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path.cwd(),
        help="Repository worktree root; the default current directory must be the root.",
    )
    parser.add_argument(
        "--complete-diff-output",
        type=Path,
        help="Write the complete binary diff, including task-owned untracked files, to this path.",
    )
    parser.add_argument(
        "--pretty", action="store_true", help="Pretty-print the JSON output."
    )
    args = parser.parse_args()
    try:
        loaded_pathspec_files = [
            (path, *_load_pathspec_file_snapshot(path)) for path in args.pathspec_file
        ]
        if any(not pathspecs for _, pathspecs, _ in loaded_pathspec_files):
            raise ValueError(
                "A supplied pathspec file must contain at least one pathspec."
            )
        file_pathspecs = tuple(
            pathspec
            for _, pathspecs, _ in loaded_pathspec_files
            for pathspec in pathspecs
        )
        pathspecs = _canonical_pathspecs((*args.pathspec, *file_pathspecs))
        component_files, component_snapshots = _parse_component_file_snapshots(
            args.component_pathspec_file
        )
        component_values: dict[str, list[str]] = {
            name: list(component_pathspecs)
            for name, component_pathspecs in component_files.items()
        }
        for name, pathspec in args.component:
            component_values.setdefault(name, []).append(pathspec)
        components = {
            name: _canonical_pathspecs(tuple(component_pathspecs))
            for name, component_pathspecs in component_values.items()
        }
        state = review_state(
            args.repo,
            args.base,
            pathspecs,
            components,
            complete_diff_output=args.complete_diff_output,
            review_input_snapshots=(
                *((path, data) for path, _, data in loaded_pathspec_files),
                *component_snapshots,
            ),
        )
    except ValueError as error:
        parser.error(str(error))
    except subprocess.CalledProcessError as error:
        parser.error(f"Git command failed with exit status {error.returncode}.")
    except (OSError, UnicodeError) as error:
        parser.error(f"Cannot inspect repository state: {error}")
    print(
        json.dumps(
            state,
            ensure_ascii=True,
            indent=2 if args.pretty else None,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
