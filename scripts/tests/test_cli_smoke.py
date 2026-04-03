import json
import runpy
import sqlite3
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]


def run_script_cli(script_relative_path, args, monkeypatch, workspace):
    script_path = REPO_ROOT / script_relative_path
    original_argv = sys.argv[:]
    original_path = sys.path[:]

    monkeypatch.chdir(workspace)
    sys.argv = [str(script_path), *[str(arg) for arg in args]]
    sys.path.insert(0, str(script_path.parent))

    try:
        runpy.run_path(str(script_path), run_name='__main__')
        return 0
    except SystemExit as exc:
        if isinstance(exc.code, int):
            return exc.code
        return 1
    finally:
        sys.argv = original_argv
        sys.path[:] = original_path


def fetch_prediction_count(db_path, predictor_id):
    conn = sqlite3.connect(db_path)
    try:
        row = conn.execute(
            'SELECT COUNT(*) FROM predictions WHERE predictor_id = ?',
            (predictor_id,),
        ).fetchone()
        return row[0]
    finally:
        conn.close()


def test_win_train_cli_writes_model_and_predictions(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_dir = workspace / 'artifacts' / 'win'

    exit_code = run_script_cli(
        'scripts/elo_win_train.py',
        [
            '--start-year', '2024',
            '--end-year', '2025',
            '--db-path', afl_cli_workspace['db_path'],
            '--output-dir', output_dir,
            '--no-tune-parameters',
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert (output_dir / 'afl_elo_win_trained_to_2025.json').exists()
    assert (workspace / 'data' / 'predictions' / 'win' / 'afl_elo_win_trained_to_2025_predictions.csv').exists()


def test_win_train_cli_supports_explicit_params_and_margin_model(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_dir = workspace / 'artifacts' / 'win-loaded'

    exit_code = run_script_cli(
        'scripts/elo_win_train.py',
        [
            '--start-year', '2024',
            '--end-year', '2025',
            '--db-path', afl_cli_workspace['db_path'],
            '--output-dir', output_dir,
            '--params-file', afl_cli_workspace['win_params_path'],
            '--margin-params', afl_cli_workspace['margin_optimization_path'],
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert (output_dir / 'afl_elo_win_trained_to_2025.json').exists()
    assert (output_dir / 'afl_elo_win_margin_model_trained_to_2025.json').exists()


def test_margin_train_cli_writes_model_artifact(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_dir = workspace / 'artifacts' / 'margin'

    exit_code = run_script_cli(
        'scripts/elo_margin_train.py',
        [
            '--params-file', afl_cli_workspace['margin_params_path'],
            '--start-year', '2024',
            '--end-year', '2025',
            '--db-path', afl_cli_workspace['db_path'],
            '--output-dir', output_dir,
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    model_path = output_dir / 'afl_elo_margin_only_trained_to_2025.json'
    assert model_path.exists()

    model_data = json.loads(model_path.read_text(encoding='utf-8'))
    assert model_data['performance']['total_matches'] > 0


def test_win_optimize_cli_writes_results_json(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_path = workspace / 'artifacts' / 'win-optimize.json'

    exit_code = run_script_cli(
        'scripts/elo_win_optimize.py',
        [
            '--db-path', afl_cli_workspace['db_path'],
            '--start-year', '2024',
            '--end-year', '2025',
            '--n-calls', '2',
            '--output-path', output_path,
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert output_path.exists()

    output_data = json.loads(output_path.read_text(encoding='utf-8'))
    assert output_data['optimization_method'] == 'grid_search'
    assert output_data['best_score'] >= 0


def test_margin_optimize_cli_writes_results_json(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_path = workspace / 'artifacts' / 'margin-optimize.json'

    exit_code = run_script_cli(
        'scripts/elo_margin_optimize.py',
        [
            '--db-path', afl_cli_workspace['db_path'],
            '--start-year', '2024',
            '--end-year', '2025',
            '--max-combinations', '2',
            '--output-path', output_path,
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert output_path.exists()

    output_data = json.loads(output_path.read_text(encoding='utf-8'))
    assert output_data['model_type'] == 'margin_only_elo'
    assert output_data['mae'] >= 0


def test_win_predict_cli_saves_future_predictions_to_database(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    predictor_id = 61

    exit_code = run_script_cli(
        'scripts/elo_win_predict.py',
        [
            '--start-year', '2026',
            '--model-path', afl_cli_workspace['win_model_path'],
            '--db-path', afl_cli_workspace['db_path'],
            '--predictor-id', str(predictor_id),
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert fetch_prediction_count(afl_cli_workspace['db_path'], predictor_id) == 5
    assert (workspace / 'data' / 'predictions' / 'win' / 'win_elo_predictions_2026_2026.csv').exists()


def test_margin_predict_cli_saves_predictions_and_rating_history(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_dir = workspace / 'artifacts' / 'margin-predict'
    predictor_id = 71

    exit_code = run_script_cli(
        'scripts/elo_margin_predict.py',
        [
            '--start-year', '2026',
            '--model-path', afl_cli_workspace['margin_model_path'],
            '--db-path', afl_cli_workspace['db_path'],
            '--output-dir', output_dir,
            '--predictor-id', str(predictor_id),
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert fetch_prediction_count(afl_cli_workspace['db_path'], predictor_id) == 5
    assert (workspace / 'data' / 'predictions' / 'margin' / 'margin_elo_predictions_2026_2026.csv').exists()
    assert (output_dir / 'margin_elo_rating_history_from_2026.csv').exists()


def test_history_generator_cli_writes_csv_output(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_dir = workspace / 'history'

    exit_code = run_script_cli(
        'scripts/elo_history_generator.py',
        [
            '--model-path', afl_cli_workspace['margin_model_path'],
            '--db-path', afl_cli_workspace['db_path'],
            '--output-dir', output_dir,
            '--output-prefix', 'smoke_history',
            '--mode', 'full',
            '--seed-start-year', '2024',
            '--output-start-year', '2025',
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    output_path = output_dir / 'smoke_history.csv'
    assert output_path.exists()
    assert 'team' in output_path.read_text(encoding='utf-8')


def test_season_simulator_cli_writes_results_json(afl_cli_workspace, monkeypatch):
    workspace = afl_cli_workspace['workspace']
    output_path = workspace / 'simulations' / 'season_2026.json'

    exit_code = run_script_cli(
        'scripts/season_simulator.py',
        [
            '--year', '2026',
            '--model-path', afl_cli_workspace['margin_model_path'],
            '--db-path', afl_cli_workspace['db_path'],
            '--num-simulations', '20',
            '--output', output_path,
        ],
        monkeypatch,
        workspace,
    )

    assert exit_code == 0
    assert output_path.exists()

    output_data = json.loads(output_path.read_text(encoding='utf-8'))
    assert output_data['year'] == 2026
    assert output_data['model_mode'] == 'margin_only'
    assert output_data['current_round_key'] == 'round-2'
    assert len(output_data['results']) == 10
