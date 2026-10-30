"""Real-shell controls for the directory operands sourceCwd accepts or rejects.

The plugin test sandbox cannot spawn processes. Its TypeScript regressions
exercise sourceCwd and the displayed result; these verify the shell premise.
"""

import pathlib
import subprocess
import tempfile
import unittest


class SourceCwdShellTests(unittest.TestCase):
    def setUp(self):
        scratch = pathlib.Path(__file__).resolve().parents[2] / ".scratch"
        scratch.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="source-cwd-", dir=scratch)
        self.addCleanup(self.temp.cleanup)
        root = pathlib.Path(self.temp.name).resolve()
        self.base = root / "local"
        self.other = root / "other"
        (self.base / "tests").mkdir(parents=True)
        (self.other / "tests").mkdir(parents=True)

    def shell_cwd(self, directory):
        # Fixed script and synthetic paths; no startup files or inherited secrets.
        result = subprocess.run(
            ["/bin/bash", "--noprofile", "--norc", "-c",
             'cd -- "$2" && cd -- "$3" && cd -- "$1" >/dev/null && pwd -P',
             "source-cwd-test", str(directory), str(self.other), str(self.base)],
            cwd=self.base,
            env={"PATH": "/usr/bin:/bin", "CDPATH": str(self.other)},
            capture_output=True, text=True, timeout=2, check=True,
        )
        self.assertEqual(result.stderr, "")
        return pathlib.Path(result.stdout.strip())

    def test_cdpath_can_override_an_existing_local_directory(self):
        self.assertEqual(self.shell_cwd("tests"), self.other / "tests")

    def test_minus_follows_oldpwd_even_if_a_literal_minus_directory_exists(self):
        (self.base / "-").mkdir()
        self.assertEqual(self.shell_cwd("-"), self.other)

    def test_explicit_dot_relative_and_absolute_directories_bypass_cdpath(self):
        for directory in ["./tests", self.base / "tests"]:
            with self.subTest(directory=directory):
                self.assertEqual(self.shell_cwd(directory), self.base / "tests")

    def test_dot_and_parent_directories_bypass_cdpath(self):
        for directory, expected in [(".", self.base), ("..", self.base.parent),
                                    ("../other/tests", self.other / "tests")]:
            with self.subTest(directory=directory):
                self.assertEqual(self.shell_cwd(directory), expected)


if __name__ == "__main__":
    unittest.main()
