#!/usr/bin/env python3

import json
import sys
import trace
import tempfile
import importlib
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
DEFAULT_FILE_LINE_COVERAGE_THRESHOLD = 60.0
FILE_LINE_COVERAGE_THRESHOLDS = {
    Path('scripts/core/data_io.py'): 70.0,
    Path('scripts/core/elo_core.py'): 74.0,
    Path('scripts/core/optimise.py'): 75.0,
    Path('scripts/core/scoring.py'): 85.0,
    Path('scripts/elo_history_generator.py'): 72.0,
    Path('scripts/elo_margin_methods_optimize.py'): 85.0,
    Path('scripts/elo_margin_methods_predict.py'): 75.0,
    Path('scripts/elo_margin_optimize.py'): 85.0,
    Path('scripts/elo_margin_predict.py'): 85.0,
    Path('scripts/elo_margin_train.py'): 85.0,
    Path('scripts/elo_predict_combined.py'): 85.0,
    Path('scripts/elo_win_optimize.py'): 85.0,
    Path('scripts/elo_win_predict.py'): 85.0,
    Path('scripts/elo_win_train.py'): 76.0,
    Path('scripts/season_simulator.py'): 77.0,
}
FILE_BRANCH_COVERAGE_THRESHOLDS = {
    Path('scripts/core/elo_core.py'): 45.0,
    Path('scripts/core/optimise.py'): 45.0,
    Path('scripts/elo_history_generator.py'): 40.0,
    Path('scripts/elo_predict_combined.py'): 45.0,
    Path('scripts/season_simulator.py'): 45.0,
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


def import_optional_coverage():
    original_sys_path = sys.path[:]
    try:
        filtered_sys_path = []
        repo_root_str = str(REPO_ROOT)
        for entry in sys.path:
            if entry in ('', repo_root_str):
                continue
            try:
                if Path(entry).resolve() == REPO_ROOT:
                    continue
            except OSError:
                pass
            filtered_sys_path.append(entry)

        sys.path = filtered_sys_path
        return importlib.import_module('coverage')
    except ModuleNotFoundError:
        return None
    finally:
        sys.path = original_sys_path


def run_with_trace(pytest_args):
    tracer = trace.Trace(count=True, trace=False, ignoredirs=[sys.prefix, sys.exec_prefix])
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
        threshold = FILE_LINE_COVERAGE_THRESHOLDS.get(rel_path, DEFAULT_FILE_LINE_COVERAGE_THRESHOLD)
        summary_rows.append((rel_path, coverage_pct, covered_count, executable_count, threshold))
        if coverage_pct < threshold:
            failures.append((rel_path, coverage_pct, threshold))

    print('\nPython coverage summary (line coverage via trace)')
    for rel_path, coverage_pct, covered_count, executable_count, threshold in summary_rows:
        print(
            f'  {rel_path}: {coverage_pct:5.1f}% ({covered_count}/{executable_count}) '
            f'[min {threshold:.1f}%]'
        )
    if FILE_BRANCH_COVERAGE_THRESHOLDS:
        print('  Branch coverage checks skipped: install the real coverage.py package to enable them.')

    return exit_code, failures


def run_with_coverage_module(pytest_args, coverage_module):
    source_paths = [str(source) for source in TARGET_SOURCES]
    cov = coverage_module.Coverage(branch=True, source=source_paths)
    cov.start()
    try:
        exit_code = pytest.main(pytest_args)
    finally:
        cov.stop()
        cov.save()

    with tempfile.NamedTemporaryFile(prefix='afl-py-coverage-', suffix='.json', delete=False) as handle:
        report_path = Path(handle.name)
    try:
        cov.json_report(outfile=str(report_path), pretty_print=False)
        report = json.loads(report_path.read_text(encoding='utf-8'))
    finally:
        report_path.unlink(missing_ok=True)

    summary_rows = []
    failures = []

    for path in iter_target_files():
        rel_path = path.relative_to(REPO_ROOT)
        file_report = report.get('files', {}).get(str(rel_path))
        if file_report is None:
            file_report = report.get('files', {}).get(str(path))
        if file_report is None:
            file_report = {'summary': {}}

        summary = file_report.get('summary', {})
        line_pct = summary.get('percent_covered', 0.0)
        line_total = summary.get('num_statements', 0)
        line_covered = summary.get('covered_lines', 0)
        branch_total = summary.get('num_branches', 0)
        branch_covered = summary.get('covered_branches', 0)
        branch_pct = 100.0 if branch_total == 0 else (branch_covered / branch_total) * 100.0
        line_threshold = FILE_LINE_COVERAGE_THRESHOLDS.get(rel_path, DEFAULT_FILE_LINE_COVERAGE_THRESHOLD)
        branch_threshold = FILE_BRANCH_COVERAGE_THRESHOLDS.get(rel_path)
        summary_rows.append((
            rel_path,
            line_pct,
            line_covered,
            line_total,
            line_threshold,
            branch_pct,
            branch_covered,
            branch_total,
            branch_threshold,
        ))
        if line_pct < line_threshold:
            failures.append((rel_path, 'line', line_pct, line_threshold))
        if branch_threshold is not None and branch_pct < branch_threshold:
            failures.append((rel_path, 'branch', branch_pct, branch_threshold))

    print('\nPython coverage summary (coverage.py line + branch coverage)')
    for (
        rel_path,
        line_pct,
        line_covered,
        line_total,
        line_threshold,
        branch_pct,
        branch_covered,
        branch_total,
        branch_threshold,
    ) in summary_rows:
        line_fragment = (
            f'line {line_pct:5.1f}% ({line_covered}/{line_total}) [min {line_threshold:.1f}%]'
        )
        if branch_threshold is None:
            branch_fragment = 'branch n/a'
        else:
            branch_fragment = (
                f'branch {branch_pct:5.1f}% ({branch_covered}/{branch_total}) [min {branch_threshold:.1f}%]'
            )
        print(f'  {rel_path}: {line_fragment}; {branch_fragment}')

    return exit_code, failures


def main():
    pytest_args = ['-q', 'scripts/tests', '-c', str(REPO_ROOT / 'pytest.ini')]
    coverage_module = import_optional_coverage()
    if coverage_module and hasattr(coverage_module, 'Coverage'):
        exit_code, failures = run_with_coverage_module(pytest_args, coverage_module)
    else:
        exit_code, failures = run_with_trace(pytest_args)

    if exit_code != 0:
        return exit_code

    if failures:
        print('Coverage check failed:', file=sys.stderr)
        for failure in failures:
            if len(failure) == 3:
                rel_path, coverage_pct, threshold = failure
                print(
                    f'  {rel_path}: {coverage_pct:.1f}% is below required {threshold:.1f}%',
                    file=sys.stderr,
                )
                continue

            rel_path, coverage_type, coverage_pct, threshold = failure
            print(
                f'  {rel_path}: {coverage_type} coverage {coverage_pct:.1f}% is below required {threshold:.1f}%',
                file=sys.stderr,
            )
        return 1

    return 0


if __name__ == '__main__':
    raise SystemExit(main())
