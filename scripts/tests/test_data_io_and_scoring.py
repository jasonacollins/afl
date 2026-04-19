import os
import sqlite3
import sys
import tempfile
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core import data_io, scoring  # noqa: E402


def test_fetch_afl_data_filters_completed_matches_by_year(afl_test_db_path):
    df = data_io.fetch_afl_data(str(afl_test_db_path), start_year=2025, end_year=2025)

    assert sorted(df['year'].unique().tolist()) == [2025]
    assert len(df) == 5
    assert set(df['home_team']) <= {'Richmond', 'Adelaide', 'West Coast', 'Brisbane Lions', 'Carlton'}


def test_fetch_matches_for_prediction_returns_future_rows_sorted(afl_test_db_path):
    df = data_io.fetch_matches_for_prediction(str(afl_test_db_path), start_year=2026)

    assert len(df) == 10
    assert str(df['match_date'].dtype).startswith('datetime64')
    assert df.iloc[0]['match_id'] == 11
    assert df.iloc[-1]['match_id'] == 20
    assert df[df['complete'] == 0]['match_id'].tolist() == [16, 17, 18, 19, 20]


def test_connect_sqlite_applies_busy_timeout_and_wal_pragmas(tmp_path):
    db_path = tmp_path / 'afl_predictions.db'

    conn = data_io.connect_sqlite(str(db_path))
    try:
        busy_timeout = conn.execute('PRAGMA busy_timeout').fetchone()[0]
        journal_mode = conn.execute('PRAGMA journal_mode').fetchone()[0]
        synchronous = conn.execute('PRAGMA synchronous').fetchone()[0]
    finally:
        conn.close()

    assert busy_timeout == data_io.SQLITE_BUSY_TIMEOUT_MS
    assert journal_mode.lower() == 'wal'
    assert synchronous == 1  # NORMAL


def test_fetch_afl_data_closes_connection_when_query_fails(monkeypatch):
    class FakeConnection:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    fake_conn = FakeConnection()

    monkeypatch.setattr(data_io, 'connect_sqlite', lambda _db_path: fake_conn)
    monkeypatch.setattr(data_io.pd, 'read_sql_query', lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('query failed')))

    with pytest.raises(RuntimeError, match='query failed'):
        data_io.fetch_afl_data('ignored.db', start_year=2025, end_year=2025)

    assert fake_conn.closed is True


def test_fetch_matches_for_prediction_coerces_invalid_dates_sorts_and_closes_connection(monkeypatch):
    class FakeConnection:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    fake_conn = FakeConnection()

    monkeypatch.setattr(data_io, 'connect_sqlite', lambda _db_path: fake_conn)
    monkeypatch.setattr(
        data_io.pd,
        'read_sql_query',
        lambda *_args, **_kwargs: pd.DataFrame([
            {'match_id': 20, 'year': 2026, 'match_date': '2099-05-01T00:00:00Z'},
            {'match_id': 10, 'year': 2026, 'match_date': 'not-a-date'},
            {'match_id': 11, 'year': 2027, 'match_date': '2099-01-01T00:00:00Z'},
        ]),
    )

    matches = data_io.fetch_matches_for_prediction('ignored.db', start_year=2026)

    assert fake_conn.closed is True
    assert str(matches['match_date'].dtype).startswith('datetime64')
    assert matches['match_id'].tolist() == [20, 10, 11]
    assert pd.isna(matches.iloc[1]['match_date'])


def test_get_team_states_map_normalizes_states_and_filters_blank_rows(monkeypatch):
    class FakeConnection:
        def close(self):
            return None

    monkeypatch.setattr(data_io, 'connect_sqlite', lambda _db_path: FakeConnection())
    monkeypatch.setattr(
        data_io.pd,
        'read_sql_query',
        lambda *_args, **_kwargs: pd.DataFrame([
            {'name': ' Cats ', 'state': ' vic '},
            {'name': 'Swans', 'state': 'NSW'},
            {'name': '   ', 'state': 'QLD'},
            {'name': 'Dockers', 'state': '  '},
        ]),
    )

    assert data_io.get_team_states_map('ignored.db') == {
        'Cats': 'VIC',
        'Swans': 'NSW'
    }


def test_get_all_teams_closes_connection_when_query_fails(monkeypatch):
    class FakeConnection:
        def __init__(self):
            self.closed = False

        def close(self):
            self.closed = True

    fake_conn = FakeConnection()

    monkeypatch.setattr(data_io, 'connect_sqlite', lambda _db_path: fake_conn)
    monkeypatch.setattr(data_io.pd, 'read_sql_query', lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError('team query failed')))

    with pytest.raises(RuntimeError, match='team query failed'):
        data_io.get_all_teams('ignored.db')

    assert fake_conn.closed is True


def test_model_and_parameter_helpers_round_trip_files(tmp_path, capsys):
    model_path = tmp_path / 'models' / 'test-model.json'
    params_path = tmp_path / 'params' / 'nested.json'

    payload = {'model_type': 'win_elo', 'parameters': {'k_factor': 24}}
    data_io.save_model(payload, str(model_path))

    assert data_io.load_model(str(model_path)) == payload
    assert 'Model saved to:' in capsys.readouterr().out

    params_path.parent.mkdir(parents=True, exist_ok=True)
    params_path.write_text('{"parameters": {"home_advantage": 30}}', encoding='utf-8')
    assert data_io.load_parameters(str(params_path)) == {'home_advantage': 30}


def test_load_model_wraps_file_errors_in_value_error(tmp_path):
    broken_path = tmp_path / 'broken.json'
    broken_path.write_text('{not valid json', encoding='utf-8')

    with pytest.raises(ValueError, match='Failed to load model'):
        data_io.load_model(str(broken_path))


def test_load_parameters_wraps_file_errors_in_value_error(tmp_path):
    missing_path = tmp_path / 'missing.json'

    with pytest.raises(ValueError, match='Failed to load parameters'):
        data_io.load_parameters(str(missing_path))


def test_save_optimization_results_serializes_numpy_scalars_and_cv_results(tmp_path, capsys):
    output_path = tmp_path / 'optimisation' / 'results.json'

    data_io.save_optimization_results({
        'best_score': np.float64(0.123),
        'search_iterations': np.int64(4),
        'all_results': [
            {
                'params': {'k_factor': 24},
                'log_loss': np.float64(0.222),
                'cv_scores': [np.float64(0.2), np.float64(0.24)]
            },
            {
                'params': {'k_factor': 30},
                'score': np.float64(0.333),
                'cv_scores': []
            }
        ]
    }, str(output_path))

    raw_output = output_path.read_text(encoding='utf-8')
    saved = data_io.json.loads(raw_output)

    assert '"best_score": 0.123' in raw_output
    assert '"search_iterations": 4' in raw_output
    assert '"log_loss": 0.333' in raw_output
    assert 'Optimization results saved to:' in capsys.readouterr().out
    assert saved['search_iterations'] == 4
    assert saved['all_results'][1]['log_loss'] == pytest.approx(0.333)


def test_create_summary_file_writes_model_parameters_and_sorted_ratings(tmp_path, capsys):
    output_path = tmp_path / 'summaries' / 'training.txt'
    model = SimpleNamespace(
        k_factor=24,
        home_advantage=30,
        season_carryover=0.7,
        margin_factor=0.05,
        margin_scale=0.12,
        get_current_ratings=lambda: {'Swans': 1512.4, 'Cats': 1498.2}
    )

    data_io.create_summary_file(
        model,
        {
            'total_matches': 198,
            'accuracy': 0.61,
            'brier_score': 0.1823,
            'margin_mae': 24.4
        },
        str(output_path),
        {
            'db_path': 'data/database/afl_predictions.db',
            'start_year': 1990,
            'end_year': 2025
        }
    )

    summary_text = output_path.read_text(encoding='utf-8')

    assert 'AFL ELO Model Training Summary' in summary_text
    assert 'Training Period: 1990-2025' in summary_text
    assert 'Margin MAE: 24.4 points' in summary_text
    assert 'K-Factor: 24' in summary_text
    assert 'Swans: 1512' in summary_text
    assert 'Cats: 1498' in summary_text
    assert 'Training summary saved to:' in capsys.readouterr().out


def test_atomic_write_text_removes_temp_file_when_replace_fails(tmp_path, monkeypatch):
    target_path = tmp_path / 'artifacts' / 'output.json'
    real_mkstemp = tempfile.mkstemp
    created_temp_path = {}

    def capturing_mkstemp(*args, **kwargs):
        fd, temp_path = real_mkstemp(*args, **kwargs)
        created_temp_path['path'] = temp_path
        return fd, temp_path

    def failing_replace(_src, _dst):
        raise OSError('replace failed')

    monkeypatch.setattr(data_io.tempfile, 'mkstemp', capturing_mkstemp)
    monkeypatch.setattr(data_io.os, 'replace', failing_replace)

    with pytest.raises(OSError, match='replace failed'):
        data_io.atomic_write_text(str(target_path), '{"ok": true}')

    assert 'path' in created_temp_path
    assert not os.path.exists(created_temp_path['path'])
    assert not target_path.exists()


def test_save_predictions_helpers_write_files_and_filter_database_writes(afl_test_db_path, tmp_path, capsys):
    csv_path = tmp_path / 'predictions' / 'round.csv'
    predictions = [
        {
            'match_id': 16,
            'match_date': '2099-08-01T19:20:00+00:00',
            'home_win_probability': 0.62,
            'predicted_margin': 11.4
        },
        {
            'match_id': 11,
            'match_date': '2000-03-12T19:20:00+00:00',
            'home_win_probability': 0.55,
            'predicted_margin': 4.0
        },
        {
            'match_id': 12,
            'match_date': '2099-03-13T13:45:00+00:00',
            'home_win_probability': 0.48,
            'predicted_margin': -2.0,
            'actual_result': 'away_win'
        }
    ]

    data_io.save_predictions_to_csv(predictions, str(csv_path))
    csv_contents = csv_path.read_text(encoding='utf-8')
    assert 'match_id' in csv_contents
    assert '16' in csv_contents

    data_io.save_predictions_to_database(predictions, str(afl_test_db_path), predictor_id=77)

    conn = sqlite3.connect(afl_test_db_path)
    try:
        rows = conn.execute(
            """
            SELECT match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
            FROM predictions
            WHERE predictor_id = ?
            ORDER BY match_id
            """,
            (77,),
        ).fetchall()
    finally:
        conn.close()

    assert rows == [(16, 77, 62, 11.4, 'home')]
    output = capsys.readouterr().out
    assert 'Skipped 2 completed/started matches' in output
    assert 'Successfully saved 1 predictions to database' in output


def test_prediction_test_fixture_enforces_unique_match_predictor_pairs(afl_test_db_path):
    conn = sqlite3.connect(afl_test_db_path)
    try:
        conn.execute(
            """
            INSERT INTO predictions (
                match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (16, 77, 55, 4.0, 'home'),
        )

        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                """
                INSERT INTO predictions (
                    match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (16, 77, 62, 11.4, 'home'),
            )
    finally:
        conn.close()


def test_save_predictions_to_database_override_mode_keeps_started_and_completed_matches(afl_test_db_path):
    predictions = [
        {
            'match_id': 11,
            'match_date': '2000-03-12T19:20:00+00:00',
            'home_win_probability': 0.55,
            'predicted_margin': 4.0
        },
        {
            'match_id': 12,
            'match_date': '2099-03-13T13:45:00+00:00',
            'home_win_probability': 0.48,
            'predicted_margin': -2.0,
            'actual_result': 'away_win'
        }
    ]

    data_io.save_predictions_to_database(
        predictions,
        str(afl_test_db_path),
        predictor_id=78,
        override_completed=True,
    )

    conn = sqlite3.connect(afl_test_db_path)
    try:
        rows = conn.execute(
            """
            SELECT match_id, home_win_probability, tipped_team
            FROM predictions
            WHERE predictor_id = ?
            ORDER BY match_id
            """,
            (78,),
        ).fetchall()
    finally:
        conn.close()

    assert rows == [
        (11, 55, 'home'),
        (12, 48, 'away')
    ]


def test_save_predictions_to_database_verbose_mode_warns_for_unparseable_and_missing_dates(
    afl_test_db_path,
    capsys,
):
    predictions = [
        {
            'match_id': 16,
            'match_date': 'not-a-date',
            'home_win_probability': 0.62,
            'predicted_margin': 11.4
        },
        {
            'match_id': 17,
            'home_win_probability': 0.45,
            'predicted_margin': -3.2
        }
    ]

    data_io.save_predictions_to_database(
        predictions,
        str(afl_test_db_path),
        predictor_id=79,
        verbose=True,
    )

    conn = sqlite3.connect(afl_test_db_path)
    try:
        rows = conn.execute(
            """
            SELECT match_id, home_win_probability, tipped_team
            FROM predictions
            WHERE predictor_id = ?
            ORDER BY match_id
            """,
            (79,),
        ).fetchall()
    finally:
        conn.close()

    assert rows == [
        (16, 62, 'home'),
        (17, 45, 'away')
    ]
    output = capsys.readouterr().out
    assert "Warning: Could not parse match date 'not-a-date'" in output
    assert 'Warning: No match date for match 17' in output


def test_save_predictions_to_database_collapses_duplicate_matches_in_same_batch(
    afl_test_db_path,
    capsys,
):
    duplicate_predictions = [
        {
            'match_id': 16,
            'match_date': '2099-08-01T19:20:00+00:00',
            'home_win_probability': 0.62,
            'predicted_margin': 11.4
        },
        {
            'match_id': 16,
            'match_date': '2099-08-01T19:20:00+00:00',
            'home_win_probability': 0.58,
            'predicted_margin': 7.5
        }
    ]

    data_io.save_predictions_to_database(
        duplicate_predictions,
        str(afl_test_db_path),
        predictor_id=80,
    )

    conn = sqlite3.connect(afl_test_db_path)
    try:
        rows = conn.execute(
            """
            SELECT match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
            FROM predictions
            WHERE predictor_id = ?
            """,
            (80,),
        ).fetchall()
    finally:
        conn.close()

    assert rows == [(16, 80, 58, 7.5, 'home')]
    output = capsys.readouterr().out
    assert 'Collapsed 1 duplicate future prediction match before saving' in output
    assert 'Successfully saved 1 predictions to database' in output


def test_save_predictions_to_database_updates_existing_prediction_rows(afl_test_db_path):
    initial_predictions = [
        {
            'match_id': 16,
            'match_date': '2099-08-01T19:20:00+00:00',
            'home_win_probability': 0.62,
            'predicted_margin': 11.4
        }
    ]
    updated_predictions = [
        {
            'match_id': 16,
            'match_date': '2099-08-01T19:20:00+00:00',
            'home_win_probability': 0.54,
            'predicted_margin': 3.5
        }
    ]

    data_io.save_predictions_to_database(
        initial_predictions,
        str(afl_test_db_path),
        predictor_id=81,
    )
    data_io.save_predictions_to_database(
        updated_predictions,
        str(afl_test_db_path),
        predictor_id=81,
    )

    conn = sqlite3.connect(afl_test_db_path)
    try:
        rows = conn.execute(
            """
            SELECT match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
            FROM predictions
            WHERE predictor_id = ?
            """,
            (81,),
        ).fetchall()
    finally:
        conn.close()

    assert rows == [(16, 81, 54, 3.5, 'home')]


def test_scoring_helpers_support_percentages_draws_and_per_game_results():
    assert scoring.calculate_bits_score(75, 1.0) == pytest.approx(1 + scoring.math.log2(0.75))
    assert scoring.calculate_bits_score(25, 0.0) == pytest.approx(1 + scoring.math.log2(0.75))
    assert scoring.calculate_brier_score(0.8, 1.0) == pytest.approx(0.04)
    assert scoring.calculate_accuracy(52, 0.5) is True
    assert scoring.calculate_accuracy(70, 0.5) is False
    assert scoring.calculate_tip_points(50, 90, 80, 'home') == 1
    assert scoring.calculate_tip_points(50, 80, 90, 'away') == 1
    assert scoring.calculate_tip_points(50, 85, 85, 'home') == 0
    assert scoring.calculate_tip_points(0.65, 100, 80, 'home') == 1
    assert scoring.calculate_tip_points(35, 80, 100, 'home') == 1

    evaluation = scoring.evaluate_predictions(
        [
            {'home_win_probability': 70, 'actual_result': 'home_win'},
            {'home_win_probability': 35, 'actual_result': 'away_win'},
            {'home_win_probability': 50, 'actual_result': 'draw'},
            {'home_win_probability': 60, 'actual_result': 'invalid'}
        ],
        per_game=True,
    )

    assert evaluation['total_predictions'] == 3
    assert len(evaluation['bits_scores']) == 3
    assert evaluation['accuracies'] == [1.0, 1.0, 1.0]


def test_scoring_helpers_support_numeric_outcomes_thresholds_and_missing_prediction_keys():
    assert scoring.calculate_accuracy(70, 1.0) is True
    assert scoring.calculate_accuracy(30, 1.0) is False
    assert scoring.calculate_accuracy(0.4, 0.0) is True
    assert scoring.calculate_tip_points(0.5, 70, 60, 'home') == 1

    evaluation = scoring.evaluate_predictions([
        {'home_win_probability': 0.7, 'actual_result': 1.0},
        {'home_win_probability': 0.4, 'actual_result': 0.0},
        {'home_win_probability': 0.5, 'actual_result': 0.5},
        {'actual_result': 1.0},
        {'home_win_probability': 0.6},
    ])

    assert evaluation['total_predictions'] == 3
    assert evaluation['correct_predictions'] == 3
    assert evaluation['accuracy'] == pytest.approx(1.0)
    assert evaluation['bits_score_total'] > 0
    assert evaluation['brier_score_total'] >= 0


def test_scoring_summary_formats_aggregated_results_and_empty_cases():
    empty = scoring.evaluate_predictions([])
    assert empty == {
        'total_predictions': 0,
        'bits_score_total': 0.0,
        'bits_score_per_game': 0.0,
        'brier_score_total': 0.0,
        'brier_score_per_game': 0.0,
        'accuracy': 0.0,
        'correct_predictions': 0
    }
    assert scoring.format_scoring_summary(empty) == 'No predictions to evaluate'

    summary = scoring.format_scoring_summary({
        'total_predictions': 2,
        'accuracy': 1.0,
        'correct_predictions': 2,
        'brier_score_per_game': 0.125,
        'bits_score_per_game': 0.75,
        'bits_score_total': 1.5
    })

    assert 'Prediction Performance on 2 matches' in summary
    assert 'Accuracy: 1.0000 (2/2)' in summary
    assert 'BITS Score: 1.50 total' in summary
