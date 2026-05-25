# Common bats helpers. Each test file `load helpers` to get them.

# Prepend the mocks dir to PATH so calls to `claude`, `npx`, `gh`, `curl` hit our stubs.
export PATH="${BATS_TEST_DIRNAME}/mocks:${PATH}"

# Recorded-call log: mocks append their argv here so tests can inspect it.
export MOCK_CALL_LOG="${BATS_TMPDIR}/mock-calls.log"
: > "${MOCK_CALL_LOG}"
