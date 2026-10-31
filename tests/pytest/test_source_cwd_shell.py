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

    def run_in_base(self, script):
        # `pwd -P` stands in for the test command: it reports the directory the command starts in.
        result = subprocess.run(
            ["/bin/bash", "--noprofile", "--norc", "-c", script],
            cwd=self.base, env={"PATH": "/usr/bin:/bin", "CDPATH": str(self.other)},
            capture_output=True, text=True, timeout=2, check=True,
        )
        return pathlib.Path(result.stdout.strip()) if result.stdout.strip() else None

    def test_output_plumbing_and_quoted_arguments_leave_the_starting_directory_alone(self):
        for script in ['pwd -P 2>&1', 'pwd -P 2>&1 | tail -n 50', 'pwd -P | tee log', 'pwd -P "-L" 2>&1',
                       "pwd -P 'x y' 2>&1", 'pwd -P | grep -E "tests|local" | head -20']:
            with self.subTest(script=script):
                self.assertEqual(self.run_in_base(script), self.base)
        for script in ['pwd -P > out.log', 'pwd -P >> out.log', 'pwd -P 2> err.log > out.log']:
            with self.subTest(script=script):
                self.run_in_base(script)
                self.assertEqual(pathlib.Path((self.base / "out.log").read_text().splitlines()[-1]), self.base)

    def test_posix_single_quote_escape_decodes_to_a_literal_quote(self):
        # cartoon's rewrite of `pytest -k 'a and b'`: the inner text is what the wrapped shell runs.
        wrapped = "printf %s 'pytest -k '\\''a and b'\\'''"
        double = "printf %s 'pytest -k \"it'\\''s\" -q'"
        for script, expected in [(wrapped, "pytest -k 'a and b'"), (double, "pytest -k \"it's\" -q")]:
            with self.subTest(script=script):
                result = subprocess.run(["/bin/bash", "--noprofile", "--norc", "-c", script],
                                        capture_output=True, text=True, timeout=2, check=True)
                self.assertEqual(result.stdout, expected)

    def test_quote_characters_inside_an_unquoted_cd_operand_change_the_directory(self):
        (self.base / "xy").mkdir()
        self.assertEqual(self.run_in_base("cd ./x'y' && pwd -P"), self.base / "xy")
        self.assertEqual(self.run_in_base('cd ./x"y" && pwd -P'), self.base / "xy")

    def test_non_ascii_space_does_not_separate_words(self):
        # NBSP is part of a word in bash, so this is one command name, not `cd ./tests`.
        result = subprocess.run(["/bin/bash", "--noprofile", "--norc", "-c", "cd\u00a0./tests && pwd -P"],
                                cwd=self.base, capture_output=True, text=True, timeout=2)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
