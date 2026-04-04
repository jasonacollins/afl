#!/usr/bin/env python3

import json
import sys
import trace
import tempfile
import importlib
import os
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
    original_module = sys.modules.pop('coverage', None)
    try:
        filtered_sys_path = []
        for entry in sys.path:
            if entry == '':
                continue

            if not entry:
                continue
            try:
                resolved_entry = Path(entry).resolve()
                if resolved_entry == REPO_ROOT:
                    continue
                if REPO_ROOT in resolved_entry.parents:
                    continue
            except OSError:
                pass
            filtered_sys_path.append(entry)

        sys.path = filtered_sys_path
        coverage_module = importlib.import_module('coverage')
        if not hasattr(coverage_module, 'Coverage'):
            return None
        return coverage_module
    except ModuleNotFoundError:
        return None
    finally:
        if original_module is not None:
            sys.modules['coverage'] = original_module
        else:
            sys.modules.pop('coverage', None)
        sys.path = original_sys_path


def run_with_trace(pytest_args, print_branch_note=True):
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
    if print_branch_note and FILE_BRANCH_COVERAGE_THRESHOLDS:
        print('  Branch coverage checks skipped: install the real coverage.py package to enable them.')

    return exit_code, failures, summary_rows


def run_with_coverage(pytest_args, coverage_module):
    cov = coverage_module.Coverage(branch=True, source=[str(REPO_ROOT / 'scripts')])
    cov.start()
    try:
        exit_code = pytest.main(pytest_args)
    finally:
        cov.stop()
        cov.save()

    coverage_data = cov.get_data()

    with tempfile.NamedTemporaryFile(prefix='afl-py-coverage-', suffix='.json', delete=False) as handle:
        report_path = Path(handle.name)
    try:
        cov.json_report(outfile=str(report_path), pretty_print=False)
        report = json.loads(report_path.read_text(encoding='utf-8'))
    finally:
        report_path.unlink(missing_ok=True)

    line_summary = {}
    branch_summary = {}
    failures = []

    for path in iter_target_files():
        rel_path = path.relative_to(REPO_ROOT)
        file_report = report.get('files', {}).get(str(rel_path))
        if file_report is None:
            file_report = report.get('files', {}).get(str(path))
        if file_report is None:
            file_report = {'summary': {}}

        summary = file_report.get('summary', {})
        executable_lines = set(trace._find_executable_linenos(str(path)).keys())
        covered_lines = set()
        for candidate in (str(path), str(path.resolve())):
            measured_lines = coverage_data.lines(candidate)
            if measured_lines:
                covered_lines = set(measured_lines) & executable_lines
                break

        executable_count = len(executable_lines)
        covered_count = len(covered_lines)
        line_pct = 100.0 if executable_count == 0 else (covered_count / executable_count) * 100.0
        line_threshold = FILE_LINE_COVERAGE_THRESHOLDS.get(rel_path, DEFAULT_FILE_LINE_COVERAGE_THRESHOLD)
        line_summary[rel_path] = {
            'line_pct': line_pct,
            'covered_count': covered_count,
            'executable_count': executable_count,
            'line_threshold': line_threshold,
        }
        if line_pct < line_threshold:
            failures.append((rel_path, line_pct, line_threshold))

        branch_total = summary.get('num_branches', 0)
        branch_covered = summary.get('covered_branches', 0)
        branch_pct = 100.0 if branch_total == 0 else (branch_covered / branch_total) * 100.0
        branch_threshold = FILE_BRANCH_COVERAGE_THRESHOLDS.get(rel_path)
        branch_summary[rel_path] = {
            'branch_pct': branch_pct,
            'branch_covered': branch_covered,
            'branch_total': branch_total,
            'branch_threshold': branch_threshold,
        }
        if branch_threshold is not None and branch_pct < branch_threshold:
            failures.append((rel_path, 'branch', branch_pct, branch_threshold))

    return exit_code, failures, line_summary, branch_summary


def main():
    pytest_args = ['-q', '-p', 'no:cov', 'scripts/tests', '-c', str(REPO_ROOT / 'pytest.ini')]
    coverage_module = import_optional_coverage()
    require_branch_coverage = os.environ.get('AFL_ALLOW_TRACE_COVERAGE', '').strip().lower() not in (
        '1',
        'true',
        'yes'
    )

    if coverage_module and hasattr(coverage_module, 'Coverage'):
        exit_code, failures, line_summary, branch_summary = run_with_coverage(pytest_args, coverage_module)
        if exit_code != 0:
            return exit_code

        print('\nPython coverage summary (coverage.py line + branch coverage)')
        for path in iter_target_files():
            rel_path = path.relative_to(REPO_ROOT)
            line_info = line_summary[rel_path]
            branch_info = branch_summary.get(rel_path, {})
            branch_threshold = branch_info.get('branch_threshold')
            branch_pct = branch_info.get('branch_pct', 0.0)
            branch_covered = branch_info.get('branch_covered', 0)
            branch_total = branch_info.get('branch_total', 0)
            line_fragment = (
                f"line {line_info['line_pct']:5.1f}% "
                f"({line_info['covered_count']}/{line_info['executable_count']}) "
                f"[min {line_info['line_threshold']:.1f}%]"
            )
            if branch_threshold is None:
                branch_fragment = 'branch n/a'
            else:
                branch_fragment = (
                    f'branch {branch_pct:5.1f}% ({branch_covered}/{branch_total}) [min {branch_threshold:.1f}%]'
                )
            print(f'  {rel_path}: {line_fragment}; {branch_fragment}')
    elif require_branch_coverage:
        print(
            (
                'coverage.py is required for the Python test suite because branch coverage gates are enabled. '
                'Install the test dependencies from scripts/tests/requirements-test.txt or set '
                'AFL_ALLOW_TRACE_COVERAGE=1 to use the weaker trace fallback intentionally.'
            ),
            file=sys.stderr,
        )
        return 1
    else:
        exit_code, failures, _summary_rows = run_with_trace(pytest_args)

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
