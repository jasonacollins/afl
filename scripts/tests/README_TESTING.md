# Python Test Notes

This directory contains the pytest suite for the AFL Python model and automation scripts.

## Run The Gated Suite

Use the same entrypoint as `npm test`:

```bash
python3 scripts/tests/run_pytest_with_coverage.py
```

That script runs `pytest` against `scripts/tests` and enforces per-file coverage thresholds for the covered modules.

## Run Pytest Directly

For faster local iteration:

```bash
python3 -m pytest scripts/tests -q
```

You can also run an individual file:

```bash
python3 -m pytest scripts/tests/test_optimise_helpers.py -q
```

## Coverage Expectations

- `run_pytest_with_coverage.py` is the authoritative coverage gate.
- Line thresholds are defined in `FILE_LINE_COVERAGE_THRESHOLDS`.
- Selected branch-heavy files also have branch thresholds in `FILE_BRANCH_COVERAGE_THRESHOLDS`.
- `coverage.py` is required by default because branch gates are enabled.
- Set `AFL_ALLOW_TRACE_COVERAGE=1` only when you intentionally want the weaker trace-based fallback.

## Scope

The suite covers:

- `scripts/core/*`
- ELO training, optimisation, prediction, and history generation scripts
- `scripts/season_simulator.py`
- CLI smoke paths for the main Python entrypoints

When you add new behavior to covered scripts, add or extend tests here and update the thresholds intentionally if coverage expectations change.
