export const CARTOON_PYTEST = [
  'adapter: pytest',
  'summary{total,passed,failed,skipped,duration_s}: 13,10,2,1,3.21',
  'failures[2]{id,loc,msg}:',
  '  tests/test_a.py::test_x,tests/test_a.py:12,"assert 1 == 2"',
  '  tests/test_b.py::test_y,tests/test_b.py:40,boom',
].join('\n')

export const XCODEBUILD_RAW = [
  "Test Case '-[CubbyTests.ScanTests testBarcode]' started.",
  '/Users/x/Cubby/CubbyTests/ScanTests.swift:42: error: -[CubbyTests.ScanTests testBarcode] : XCTAssertEqual failed',
  "Test Case '-[CubbyTests.ScanTests testBarcode]' failed (0.012 seconds).",
  'Executed 3 tests, with 1 failure (0 unexpected) in 0.030 (0.031) seconds',
  'Executed 415 tests, with 2 tests skipped and 3 failures (0 unexpected) in 71.900 (72.100) seconds',
  '** TEST FAILED **',
].join('\n')

export const SWIFT_TESTING_RAW = [
  '✘ Test parsesDate() failed after 0.002 seconds with 1 issue.',
  '✔ Test parsesAmount() passed after 0.001 seconds.',
  '✘ Test run with 12 tests failed after 0.5 seconds with 1 issue.',
].join('\n')

export const PYTEST_RAW = [
  'FAILED tests/test_a.py::test_x - assert 1 == 2',
  '========= 1 failed, 10 passed, 2 skipped in 3.50s =========',
].join('\n')

// Real `pytest -q` output (tail), captured from .scratch/session-mods-probe/pyfail: no `=` banner in -q mode.
export const PYTEST_REAL = [
  '=========================== short test summary info ============================',
  'FAILED .scratch/session-mods-probe/pyfail/test_probe.py::test_fails[0] - Asse...',
  'FAILED .scratch/session-mods-probe/pyfail/test_probe.py::test_fails[1] - Asse...',
  'FAILED .scratch/session-mods-probe/pyfail/test_probe.py::test_fails[2] - Asse...',
  '3 failed, 40 passed, 1 skipped in 0.02s',
].join('\n')

export const JEST_RAW = 'Tests:       1 failed, 2 skipped, 10 passed, 13 total\nTime:        2.1 s'
export const VITEST_RAW = ' Test Files  1 failed (3)\n      Tests  1 failed | 9 passed (10)\n   Duration  1.20s'
export const BUN_RAW = '(fail) math > adds [0.12ms]\n\n 9 pass\n 1 fail\n 2 skip\nRan 12 tests across 3 files. [45.00ms]'
export const LS_OUTPUT = 'README.md\nplugins\ntests'

// Real `swift test` output (SwiftPM, one XCTest case failing with 3 assertions + swift-testing, one failing); paths shortened.
export const SWIFT_TEST_REAL = `Test Suite 'All tests' started at 2026-10-10 01:41:03.445.
Test Suite 'LibPackageTests.xctest' started at 2026-10-10 01:41:03.447.
Test Suite 'XT' started at 2026-10-10 01:41:03.447.
Test Case '-[LibTests.XT testFail]' started.
/Users/x/pkg/Tests/LibTests/T.swift:6: error: -[LibTests.XT testFail] : XCTAssertEqual failed: ("1") is not equal to ("2")
/Users/x/pkg/Tests/LibTests/T.swift:6: error: -[LibTests.XT testFail] : XCTAssertEqual failed: ("1") is not equal to ("3")
/Users/x/pkg/Tests/LibTests/T.swift:6: error: -[LibTests.XT testFail] : XCTAssertEqual failed: ("1") is not equal to ("4")
Test Case '-[LibTests.XT testFail]' failed (0.098 seconds).
Test Case '-[LibTests.XT testPass]' started.
Test Case '-[LibTests.XT testPass]' passed (0.000 seconds).
Test Suite 'XT' failed at 2026-10-10 01:41:03.546.
	 Executed 2 tests, with 3 failures (0 unexpected) in 0.099 (0.099) seconds
Test Suite 'LibPackageTests.xctest' failed at 2026-10-10 01:41:03.546.
	 Executed 2 tests, with 3 failures (0 unexpected) in 0.099 (0.099) seconds
Test Suite 'All tests' failed at 2026-10-10 01:41:03.546.
	 Executed 2 tests, with 3 failures (0 unexpected) in 0.099 (0.101) seconds
◇ Test run started.
↳ Testing Library Version: 1902
↳ Target Platform: arm64e-apple-macos14.0
◇ Suite S started.
◇ Test bad() started.
◇ Test okA() started.
◇ Test okB() started.
✔ Test okA() passed after 0.001 seconds.
✔ Test okB() passed after 0.001 seconds.
✘ Test bad() recorded an issue at T.swift:11:22: Expectation failed: (one() → 1) == 2
✘ Test bad() failed after 0.001 seconds with 1 issue.
✘ Suite S failed after 0.001 seconds with 1 issue.
✘ Test run with 3 tests in 1 suite failed after 0.001 seconds with 1 issue.`

export const XCODEBUILD_MANY_ASSERTS = [
  "Test Case '-[A.B testOne]' failed (0.1 seconds).",
  'Executed 1 test, with 3 failures (0 unexpected) in 0.100 (0.101) seconds',
].join('\n')
export const XCODEBUILD_NO_IDS = 'Executed 2 tests, with 5 failures (0 unexpected) in 0.1 (0.1) seconds'
export const SWIFT_TESTING_SUITES = '✔ Test run with 12 tests in 3 suites passed after 0.5 seconds.'
export const SWIFT_WITH_EMPTY_XCTEST = [
  'Executed 0 tests, with 0 failures (0 unexpected) in 0.000 (0.001) seconds',
  '✘ Test parsesDate() failed after 0.002 seconds with 1 issue.',
  '✘ Test run with 12 tests failed after 0.5 seconds with 1 issue.',
].join('\n')
export const JEST_ALL_FAIL = 'Tests:       2 failed, 2 total'
export const JEST_TODO = 'Tests:       1 failed, 1 skipped, 1 todo, 3 passed, 6 total'
export const VITEST_ALL_FAIL = ' Test Files  1 failed (1)\n      Tests  2 failed (2)'
export const VITEST_ORDER = '      Tests  1 failed | 2 passed | 1 skipped (4)'
