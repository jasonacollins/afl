#!/usr/bin/env python3

import sys
import trace
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
TARGET_SOURCES = [
    REPO_ROOT / 'scripts' / 'core',
    REPO_ROOT / 'scripts' / 'elo_history_generator.py',
    REPO_ROOT / 'scripts' / 'elo_margin_methods_optimize.py',
    REPO_ROOT / 'scripts' / 'elo_margin_methods_predict.py',
    REPO_ROOT / 'scripts' / 'elo_margin_optimize.py',
    REPO_ROOT / 'scripts' / 'elo_margin_predict.py',
    REPO_ROOT / 'scripts' / 'elo_margin_train.py',
    REPO_ROOT / 'scripts' / 'elo_predict_combined.py',
    REPO_ROOT / 'scripts' / 'elo_win_optimize.py',
    REPO_ROOT / 'scripts' / 'elo_win_predict.py',
    REPO_ROOT / 'scripts' / 'elo_win_train.py',
    REPO_ROOT / 'scripts' / 'season_simulator.py',
]
DEFAULT_FILE_COVERAGE_THRESHOLD = 40.0
FILE_COVERAGE_THRESHOLDS = {
    Path('scripts/core/data_io.py'): 70.0,
    Path('scripts/core/elo_core.py'): 70.0,
    Path('scripts/core/optimise.py'): 58.0,
    Path('scripts/core/scoring.py'): 85.0,
    Path('scripts/elo_history_generator.py'): 64.0,
    Path('scripts/season_simulator.py'): 73.0,
}


def iter_target_files():
    for source in TARGET_SOURCES:
        if source.is_dir():
            yield from sorted(
                path for path in source.rglob('*.py')
                if '__pycache__' not in path.parts and path.name != '__init__.py'
            )
        else:
            yield source


def collect_counts(results):
    normalized = {}
    for (filename, lineno), count in results.counts.items():
        try:
            path = Path(filename).resolve()
        except OSError:
            continue
        normalized.setdefault(path, set()).add(lineno)
    return normalized


def main():
    tracer = trace.Trace(
        count=True,
        trace=False,
        ignoredirs=[sys.prefix, sys.exec_prefix],
    )
    pytest_args = ['-q', 'scripts/tests', '-c', str(REPO_ROOT / 'pytest.ini')]
    exit_code = tracer.runfunc(pytest.main, pytest_args)
    results = tracer.results()
    executed_lines = collect_counts(results)

    summary_rows = []
    failures = []

    for path in iter_target_files():
        executable_lines = set(trace._find_executable_linenos(str(path)).keys())
        covered_lines = executed_lines.get(path.resolve(), set()) & executable_lines
        executable_count = len(executable_lines)
        covered_count = len(covered_lines)
        coverage_pct = 100.0 if executable_count == 0 else (covered_count / executable_count) * 100.0
        rel_path = path.relative_to(REPO_ROOT)
        threshold = FILE_COVERAGE_THRESHOLDS.get(rel_path, DEFAULT_FILE_COVERAGE_THRESHOLD)
        summary_rows.append((coverage_pct, covered_count, executable_count, rel_path, threshold))
        if coverage_pct < threshold:
            failures.append((rel_path, coverage_pct, threshold))

    print('\nPython coverage summary')
    for coverage_pct, covered_count, executable_count, rel_path, threshold in summary_rows:
        print(
            f'  {rel_path}: {coverage_pct:5.1f}% ({covered_count}/{executable_count}) '
            f'[min {threshold:.1f}%]'
        )

    if exit_code != 0:
        return exit_code

    if failures:
        print('Coverage check failed:', file=sys.stderr)
        for rel_path, coverage_pct, threshold in failures:
            print(
                f'  {rel_path}: {coverage_pct:.1f}% is below required {threshold:.1f}%',
                file=sys.stderr,
            )
        return 1

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
