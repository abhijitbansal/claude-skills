"""The `node` job in test.yml runs plugins/portable-artifacts/bin/test, whose tests import code from a skill folder
(`../../skills/<skill>/...`). Those imports resolve that skill's own node_modules (make-motion's spec.mjs imports ajv),
so the job must `npm ci` every skill the tests import; a runner that has not installed it fails with
ERR_MODULE_NOT_FOUND (PR #58: intake.test.mjs and make-motion-docs.test.mjs, 'Cannot find package ajv'). Stdlib only.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BIN_TESTS = ROOT / "plugins/portable-artifacts/bin/test"
WORKFLOW = ROOT / ".github/workflows/test.yml"
SKILL_IMPORT = re.compile(r"""from\s+['"]\.\./\.\./skills/([\w-]+)/""")
IMPORT_ONLY = re.compile(r"""^\s*import\s+['"]\.\./\.\./skills/([\w-]+)/""", re.M)


def _job_text(name: str) -> str:
    text = WORKFLOW.read_text()
    match = re.search(rf"^  {re.escape(name)}:\n(.*?)(?=^  \S[^\n]*:\n|\Z)", text, re.M | re.S)
    assert match, f"job {name} not found in test.yml"
    return match.group(1)


def _skills_imported_by_bin_tests() -> set[str]:
    found: set[str] = set()
    for path in BIN_TESTS.glob("*.test.mjs"):
        source = path.read_text()
        found |= set(SKILL_IMPORT.findall(source)) | set(IMPORT_ONLY.findall(source))
    return found


def test_the_bin_tests_import_at_least_one_skill() -> None:
    # The premise: an empty set would make the check below pass for any workflow.
    assert "make-motion" in _skills_imported_by_bin_tests()


def test_node_job_installs_every_skill_the_bin_tests_import() -> None:
    job = _job_text("node")
    missing = []
    for skill in sorted(_skills_imported_by_bin_tests()):
        installs = re.search(rf"working-directory:\s*plugins/portable-artifacts/skills/{re.escape(skill)}\n\s+run:\s*npm ci\b", job)
        if not installs:
            missing.append(skill)
    assert not missing, f"the node job runs bin tests that import {missing} but never runs npm ci in those skill folders"
