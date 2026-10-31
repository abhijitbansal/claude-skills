"""Read-only source snapshots, tested against disposable synthetic repositories."""

import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "plugins/test-board/scripts/source_snapshot.py"
ENV = {"PATH": os.defpath, "LC_ALL": "C", "GIT_CONFIG_NOSYSTEM": "1",
       "GIT_CONFIG_GLOBAL": os.devnull}


@unittest.skipUnless(os.name == "posix", "collector supports POSIX hosts")
class SourceSnapshotTests(unittest.TestCase):
    def setUp(self):
        scratch = ROOT / ".scratch"
        scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="source-test-", dir=scratch)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        self.git("init", "-q")
        (self.root / "app.txt").write_text("alpha\n")
        (self.root / ".gitignore").write_text("ignored/\n")
        self.git("add", ".")
        self.git("commit", "-qm", "synthetic fixture")

    def git(self, *args, cwd=None):
        return subprocess.run(
            ["git", "--no-optional-locks", "-c", "core.hooksPath=/dev/null",
             "-c", "commit.gpgsign=false", "-c", "user.name=Synthetic",
             "-c", "user.email=synthetic@example.invalid", *args],
            cwd=cwd or self.root, env=ENV, capture_output=True, check=True,
            timeout=3,
        ).stdout

    def collect(self, env=None):
        result = subprocess.run([sys.executable, "-I", str(SCRIPT), str(self.root)],
                                env=env or ENV, capture_output=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, b"")
        return json.loads(result.stdout)

    def module(self):
        self.assertTrue(SCRIPT.is_file(), "snapshot collector is not implemented")
        spec = importlib.util.spec_from_file_location("source_snapshot", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_unchanged_source_has_stable_content_identity_and_no_payload(self):
        first = self.collect()
        self.assertEqual(first["status"], "available")
        second = self.collect()
        self.assertEqual(first["digest"], second["digest"])
        self.assertEqual(first["head"], self.git("rev-parse", "HEAD").decode().strip())
        self.assertNotIn("alpha", json.dumps(first))
        self.assertNotIn("app.txt", json.dumps(first))
        self.assertEqual(first["files"], 2)

    def test_same_size_and_restored_mtime_edit_changes_digest(self):
        first = self.collect()
        path = self.root / "app.txt"
        old = path.stat()
        path.write_text("bravo\n")
        os.utime(path, ns=(old.st_atime_ns, old.st_mtime_ns))
        self.assertNotEqual(first["digest"], self.collect()["digest"])

    def test_staging_changes_identity_even_if_worktree_content_is_unchanged(self):
        (self.root / "app.txt").write_text("bravo\n")
        first = self.collect()
        self.git("add", "app.txt")
        self.assertNotEqual(first["digest"], self.collect()["digest"])

    def test_add_delete_rename_and_executable_bit_change_identity(self):
        previous = self.collect()["digest"]
        path = self.root / "extra.txt"
        path.write_text("synthetic\n")
        current = self.collect()["digest"]
        self.assertNotEqual(previous, current)
        path.rename(self.root / "renamed.txt")
        renamed = self.collect()["digest"]
        self.assertNotEqual(current, renamed)
        (self.root / "renamed.txt").chmod(0o755)
        executable = self.collect()["digest"]
        self.assertNotEqual(renamed, executable)
        (self.root / "app.txt").unlink()
        deleted = self.collect()
        self.assertEqual(deleted["status"], "available")
        self.assertNotEqual(executable, deleted["digest"])

    def test_ignored_files_are_outside_the_declared_scope(self):
        first = self.collect()
        (self.root / "ignored").mkdir()
        (self.root / "ignored/secret.txt").write_text("synthetic excluded input")
        self.assertEqual(first["digest"], self.collect()["digest"])

    def test_branch_and_commit_are_separate_from_content_identity(self):
        first = self.collect()
        self.git("checkout", "-qb", "synthetic-other")
        branch = self.collect()
        self.assertNotEqual(first["branch"], branch["branch"])
        self.assertEqual(first["digest"], branch["digest"])
        self.git("commit", "--allow-empty", "-qm", "empty fixture")
        self.assertNotEqual(branch["head"], self.collect()["head"])
        self.git("checkout", "--detach", "-q")
        self.assertIsNone(self.collect()["branch"])

    def test_worktrees_keep_separate_roots(self):
        other = Path(self.temp.name) / "other"
        self.git("worktree", "add", "--detach", "-q", str(other))
        first = self.collect()
        self.root = other
        second = self.collect()
        self.assertNotEqual(first["root"], second["root"])
        self.assertEqual(first["head"], second["head"])

    def test_symlink_file_and_parent_are_unsupported(self):
        target = Path(self.temp.name) / "outside"
        target.mkdir()
        (target / "value").write_text("synthetic outside input")
        (self.root / "link").symlink_to(target / "value")
        self.assertEqual(self.collect()["status"], "unknown")
        (self.root / "link").unlink()
        (self.root / "dir").mkdir()
        (self.root / "dir/value").write_text("tracked fixture")
        self.git("add", "dir/value")
        (self.root / "dir/value").unlink()
        (self.root / "dir").rmdir()
        (self.root / "dir").symlink_to(target, target_is_directory=True)
        self.assertEqual(self.collect()["status"], "unknown")

    def test_special_file_cannot_block_or_count_as_source(self):
        os.mkfifo(self.root / "pipe")
        # Git alone is insufficient: it omits this nonignored special node.
        self.assertNotIn(b"pipe", self.git("ls-files", "--others", "--exclude-standard", "-z"))
        self.assertEqual(self.collect()["status"], "unknown")

    def test_nested_special_nodes_are_unknown_but_ignored_ones_are_excluded(self):
        (self.root / "nested").mkdir()
        os.mkfifo(self.root / "nested/pipe")
        self.assertEqual(self.collect()["status"], "unknown")
        (self.root / "nested/pipe").unlink()
        (self.root / "ignored").mkdir()
        os.mkfifo(self.root / "ignored/pipe")
        self.assertEqual(self.collect()["status"], "available")

    def test_submodules_and_hidden_index_entries_are_unknown(self):
        head = self.git("rev-parse", "HEAD").decode().strip()
        self.git("update-index", "--add", "--cacheinfo", f"160000,{head},sub")
        self.assertEqual(self.collect()["status"], "unknown")
        self.git("update-index", "--force-remove", "sub")
        for flag in ("assume-unchanged", "skip-worktree"):
            self.git("update-index", f"--{flag}", "app.txt")
            self.assertEqual(self.collect()["status"], "unknown")
            self.git("update-index", f"--no-{flag}", "app.txt")

    def test_filename_delimiters_do_not_collide(self):
        (self.root / "space tab\tline\n.txt").write_bytes(b"\x00\xffsynthetic")
        first = self.collect()
        self.assertEqual(first["status"], "available")
        (self.root / "space tab\tline\n.txt").rename(self.root / "other.txt")
        self.assertNotEqual(first["digest"], self.collect()["digest"])

    def test_limits_return_unknown_not_a_partial_digest(self):
        module = self.module()
        for limits in ({"max_files": 1}, {"max_bytes": 1}, {"max_file_bytes": 1},
                       {"max_git_bytes": 8}, {"timeout_s": 0}):
            with self.subTest(limits=limits):
                result = module.capture(str(self.root), **limits)
                self.assertEqual(result["status"], "unknown")
                self.assertNotIn("digest", result)

    def test_missing_git_and_unreadable_files_are_unknown(self):
        module = self.module()
        with patch.object(module, "git_bytes", side_effect=FileNotFoundError):
            self.assertEqual(module.capture(str(self.root))["status"], "unknown")
        with patch.object(module, "read_file", side_effect=PermissionError):
            self.assertEqual(module.capture(str(self.root))["status"], "unknown")

    def test_change_during_capture_is_unknown(self):
        module = self.module()
        original = module.read_file
        changed = False

        def mutate(*args, **kwargs):
            nonlocal changed
            result = original(*args, **kwargs)
            if not changed and args[1] == b"app.txt":
                changed = True
                (self.root / "app.txt").write_text("bravo\n")
            return result

        with patch.object(module, "read_file", side_effect=mutate):
            self.assertEqual(module.capture(str(self.root))["status"], "unknown")

    def test_unknown_errors_do_not_expose_exception_payloads(self):
        module = self.module()
        with patch.object(module, "read_file", side_effect=OSError("synthetic private payload")):
            result = module.capture(str(self.root))
            self.assertEqual(result["status"], "unknown")
            self.assertNotIn("payload", json.dumps(result))

    def test_deep_directories_return_unknown_instead_of_recursing_unboundedly(self):
        nested = self.root
        for _ in range(66):
            nested = nested / "d"
            nested.mkdir()
        (nested / "input.txt").write_text("synthetic")
        result = self.module().capture(str(self.root), timeout_s=5)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(result["reason"], "unsupported_path")

    def test_deadline_and_output_limits_kill_and_reap_the_child(self):
        module = self.module()
        real_popen = subprocess.Popen
        for code, reason in [("import time; time.sleep(10)", "deadline"),
                             ("import os; os.write(1, b'x' * 65536)", "git_output_limit")]:
            children = []

            def child(_argv, **kwargs):
                proc = real_popen([sys.executable, "-I", "-c", code], **kwargs)
                children.append(proc)
                return proc

            with self.subTest(reason=reason), patch.object(module.subprocess, "Popen", side_effect=child):
                started = time.monotonic()
                result = module.capture(str(self.root), timeout_s=0.5, max_git_bytes=32)
                self.assertEqual(result, {"version": 1, "scope": module.SCOPE,
                                          "status": "unknown", "reason": reason})
                self.assertLess(time.monotonic() - started, 3)
                self.assertEqual(len(children), 1)
                self.assertIsNotNone(children[0].returncode)

    def test_alarm_landing_during_the_post_kill_wait_still_reaps_the_child(self):
        module = self.module()
        real_popen = subprocess.Popen
        children = []

        class LateAlarm(real_popen):
            """The one-shot deadline alarm lands while the killed child is being waited on."""
            fired = False

            def wait(self, timeout=None):
                if not LateAlarm.fired:
                    LateAlarm.fired = True
                    os.kill(os.getpid(), signal.SIGALRM)
                return super().wait(timeout)

        def child(_argv, **kwargs):
            proc = LateAlarm([sys.executable, "-I", "-c", "import time; time.sleep(10)"], **kwargs)
            children.append(proc)
            return proc

        with patch.object(module.subprocess, "Popen", side_effect=child):
            started = time.monotonic()
            result = module.capture(str(self.root), timeout_s=0.5)
        self.assertEqual(result["reason"], "deadline")
        self.assertLess(time.monotonic() - started, 3)
        self.assertIsNotNone(children[0].returncode)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0.0, 0.0))

    def test_a_killed_child_does_not_leave_the_deadline_alarm_armed_for_later_work(self):
        module = self.module()
        armed = []
        real_popen = subprocess.Popen
        real_kill = real_popen.kill

        def spy(proc):
            armed.append(signal.getitimer(signal.ITIMER_REAL)[0])
            return real_kill(proc)

        def child(_argv, **kwargs):
            code = "import os, time; os.write(1, b'x' * 65536); time.sleep(10)"
            return real_popen([sys.executable, "-I", "-c", code], **kwargs)

        with patch.object(module.subprocess, "Popen", side_effect=child), \
                patch.object(real_popen, "kill", spy):
            result = module.capture(str(self.root), timeout_s=0.5, max_git_bytes=32)
        self.assertEqual(result["reason"], "git_output_limit")
        self.assertEqual(armed, [0.0])

    def test_capture_leaves_index_and_source_unchanged(self):
        paths = [self.root / "app.txt", self.root / ".gitignore", self.root / ".git/index"]
        before = [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths]
        self.assertEqual(self.collect()["status"], "available")
        self.assertEqual(before, [(path.read_bytes(), path.stat().st_mtime_ns) for path in paths])

    def popen_spy(self, module):
        """Record every git spawn while still running it."""
        real_popen = subprocess.Popen
        spawns = []

        def spy(argv, **kwargs):
            spawns.append((argv, kwargs.get("env")))
            return real_popen(argv, **kwargs)

        return spawns, patch.object(module.subprocess, "Popen", side_effect=spy)

    def test_git_spawns_do_not_scale_with_directory_count(self):
        for index in range(40):
            directory = self.root / f"pkg{index}" / "inner"
            directory.mkdir(parents=True)
            (directory / "mod.py").write_text("synthetic\n")
            (self.root / f"pkg{index}" / "__pycache__").mkdir()
        module = self.module()
        spawns, spy = self.popen_spy(module)
        with spy:
            result = module.capture(str(self.root), timeout_s=5)
        self.assertEqual(result["status"], "available", result)
        # A fixed handful of listings and one ignore query per tree level, never one per directory.
        self.assertLessEqual(len(spawns), 16, [a[0][-3:] for a, _ in spawns])

    def test_file_contents_are_hashed_once_per_capture(self):
        module = self.module()
        original = module.read_file
        seen = []

        def spy(*args, **kwargs):
            seen.append(args[1])
            return original(*args, **kwargs)

        with patch.object(module, "read_file", side_effect=spy):
            self.assertEqual(module.capture(str(self.root))["status"], "available")
        self.assertEqual(sorted(seen), [b".gitignore", b"app.txt"])

    def test_late_untracked_file_or_special_node_is_unknown(self):
        module = self.module()
        original = module.read_file
        for name, make in [("late.txt", lambda path: path.write_text("synthetic\n")),
                           ("late-pipe", os.mkfifo)]:
            (self.root / name).unlink(missing_ok=True)
            fired = False

            def late(*args, **kwargs):
                nonlocal fired
                result = original(*args, **kwargs)
                if not fired and args[1] == b"app.txt":
                    fired = True
                    make(self.root / name)
                return result

            with self.subTest(name=name), patch.object(module, "read_file", side_effect=late):
                self.assertEqual(module.capture(str(self.root))["status"], "unknown")
            (self.root / name).unlink(missing_ok=True)

    def test_git_is_found_on_the_inherited_path_and_run_by_absolute_path(self):
        real_git = shutil.which("git")
        tools = Path(self.temp.name) / "tools"
        tools.mkdir()
        wrapper = tools / "git"
        wrapper.write_text(f'#!/bin/sh\nexec "{real_git}" "$@"\n')
        wrapper.chmod(0o755)
        module = self.module()
        spawns, spy = self.popen_spy(module)
        with spy, patch.dict(os.environ, {"PATH": str(tools)}):
            self.assertEqual(module.capture(str(self.root))["status"], "available")
        self.assertTrue(spawns)
        self.assertEqual({argv[0] for argv, _ in spawns}, {str(wrapper)})
        # Only the executable is resolved from the caller's PATH; children keep the minimal one.
        self.assertTrue(all(env["PATH"] == os.defpath for _, env in spawns))
        env = {**ENV, "PATH": str(tools)}
        self.assertEqual(self.collect(env)["status"], "available")
        with patch.dict(os.environ, {"PATH": str(Path(self.temp.name) / "empty")}):
            self.assertEqual(module.capture(str(self.root)),
                             {"version": 1, "scope": module.SCOPE, "status": "unknown", "reason": "git_unavailable"})

    def test_git_is_found_on_the_default_path_when_path_is_unset_or_empty(self):
        module = self.module()
        expected = shutil.which("git", path=os.defpath)
        if expected is None:
            self.skipTest("no git on the default path")
        for label, environ in [("unset", {}), ("empty", {"PATH": ""})]:
            with self.subTest(path=label), patch.dict(os.environ, environ):
                if label == "unset":
                    os.environ.pop("PATH", None)
                self.assertEqual(module.resolve_git(), expected)

    def test_a_relative_path_entry_never_supplies_git(self):
        planted = Path(self.temp.name) / "planted"
        planted.mkdir()
        marker = planted / "ran"
        (planted / "git").write_text(f'#!/bin/sh\ntouch "{marker}"\n')
        (planted / "git").chmod(0o755)
        module = self.module()
        cwd = os.getcwd()
        try:
            os.chdir(planted)
            with patch.dict(os.environ, {"PATH": "."}):
                result = module.capture(str(self.root))
        finally:
            os.chdir(cwd)
        self.assertEqual(result["reason"], "git_unavailable")
        self.assertFalse(marker.exists())

    def home_with(self, **files):
        home = Path(self.temp.name) / "home"
        for relative, text in files.items():
            path = home / relative.replace("__", "/")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
        return {**ENV, "HOME": str(home)}

    def test_global_core_excludes_file_keeps_editor_litter_out_of_scope(self):
        ignore = Path(self.temp.name) / "home" / "global-ignore"
        env = self.home_with(**{"global-ignore": ".DS_Store\n*.swp\n", ".gitconfig": f"[core]\n\texcludesFile = {ignore}\n"})
        first = self.collect(env)
        (self.root / ".DS_Store").write_text("synthetic")
        (self.root / "app.txt.swp").write_text("synthetic")
        second = self.collect(env)
        self.assertEqual(second["status"], "available")
        self.assertEqual((first["digest"], first["files"]), (second["digest"], second["files"]))
        # Without that file, the litter is source.
        (Path(self.temp.name) / "home" / ".gitconfig").unlink()
        self.assertNotEqual(first["digest"], self.collect(env)["digest"])

    def test_default_xdg_ignore_file_is_honoured_without_core_excludes_file(self):
        env = self.home_with(**{".config__git__ignore": ".DS_Store\n"})
        first = self.collect(env)
        (self.root / ".DS_Store").write_text("synthetic")
        self.assertEqual(first["digest"], self.collect(env)["digest"])
        xdg = Path(self.temp.name) / "xdg"
        (xdg / "git").mkdir(parents=True)
        (xdg / "git/ignore").write_text("*.swp\n")
        (self.root / "x.swp").write_text("synthetic")
        (self.root / ".DS_Store").unlink()
        # XDG_CONFIG_HOME replaces ~/.config, so only *.swp is ignored now.
        self.assertEqual(first["digest"], self.collect({**env, "XDG_CONFIG_HOME": str(xdg)})["digest"])

    def test_only_excludes_are_read_from_global_config(self):
        env = self.home_with(**{".gitconfig": "[core]\n\thooksPath = /nonexistent\n\tfsmonitor = true\n"
                                              "[alias]\n\tls-files = !echo hijacked\n"})
        module = self.module()
        spawns, spy = self.popen_spy(module)
        with spy, patch.dict(os.environ, {"HOME": env["HOME"]}):
            self.assertEqual(module.capture(str(self.root))["status"], "available")
        queries = [argv for argv, _ in spawns if "--global" in argv]
        self.assertEqual(len(queries), 1)
        for argv, spawn_env in spawns:
            if argv not in queries:
                self.assertEqual(spawn_env["GIT_CONFIG_GLOBAL"], os.devnull)
                self.assertEqual(spawn_env["GIT_CONFIG_NOSYSTEM"], "1")
                self.assertIn("core.hooksPath=/dev/null", argv)
                self.assertIn("core.fsmonitor=false", argv)

    def test_byte_cap_matches_the_hook_validator(self):
        import inspect
        default = inspect.signature(self.module().capture).parameters["max_bytes"].default
        hook = (ROOT / "plugins/test-board/hooks/source-freshness.ts").read_text()
        cap = re.search(r"MAX_SOURCE_BYTES = (\d+) \* 1024 \* 1024", hook)
        self.assertIsNotNone(cap)
        self.assertEqual(default, int(cap.group(1)) * 1024 * 1024)

    def test_repo_local_core_excludes_file_wins_over_the_global_one(self):
        local = self.root / ".git/local-ignore"
        local.write_text("*.local-litter\n")
        self.git("config", "core.excludesFile", str(local))
        env = self.home_with(**{"global-ignore": ".DS_Store\n",
                                ".gitconfig": f"[core]\n\texcludesFile = {Path(self.temp.name) / 'home' / 'global-ignore'}\n"})
        first = self.collect(env)
        (self.root / "notes.local-litter").write_text("synthetic")
        self.assertEqual(first["digest"], self.collect(env)["digest"])
        # The global file no longer applies, exactly as in git itself.
        (self.root / ".DS_Store").write_text("synthetic")
        self.assertNotEqual(first["digest"], self.collect(env)["digest"])

    def test_an_excludes_path_that_is_not_a_regular_file_cannot_stall_capture(self):
        fifo = Path(self.temp.name) / "home" / "ignore-fifo"
        link = Path(self.temp.name) / "home" / "ignore-link"
        for name, target in [("fifo", fifo), ("device", Path("/dev/zero")), ("link to fifo", link)]:
            with self.subTest(target=name):
                env = self.home_with(**{".gitconfig": f"[core]\n\texcludesFile = {target}\n"})
                if name != "device" and not fifo.exists():
                    os.mkfifo(fifo)
                if name == "link to fifo" and not link.is_symlink():
                    link.symlink_to(fifo)
                # A stall would end at the deadline as unknown, so available is the proof.
                result = self.collect(env)
                self.assertEqual(result["status"], "available", result)

    def test_a_symlinked_regular_excludes_file_is_still_honoured(self):
        real = Path(self.temp.name) / "dotfiles" / "ignore"
        real.parent.mkdir()
        real.write_text(".DS_Store\n")
        env = self.home_with(**{".gitconfig": ""})
        link = Path(self.temp.name) / "home" / "ignore-link"
        link.symlink_to(real)
        (Path(self.temp.name) / "home" / ".gitconfig").write_text(f"[core]\n\texcludesFile = {link}\n")
        first = self.collect(env)
        (self.root / ".DS_Store").write_text("synthetic")
        self.assertEqual(first["digest"], self.collect(env)["digest"])

    def test_tracked_content_inside_ignored_directory_is_still_hashed(self):
        (self.root / "ignored").mkdir()
        path = self.root / "ignored/tracked.txt"
        path.write_text("before")
        self.git("add", "-f", "ignored/tracked.txt")
        first = self.collect()
        path.write_text("after!")
        second = self.collect()
        self.assertEqual(second["status"], "available")
        self.assertNotEqual(first["digest"], second["digest"])


if __name__ == "__main__":
    unittest.main()
