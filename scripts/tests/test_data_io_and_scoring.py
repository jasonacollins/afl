import os
import sqlite3
import sys
import tempfile

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


def test_save_predictions_to_database_rolls_back_when_insert_fails(afl_test_db_path, capsys):
    conn = sqlite3.connect(afl_test_db_path)
    try:
        conn.execute(
            """
            CREATE UNIQUE INDEX idx_predictions_match_predictor
            ON predictions (match_id, predictor_id)
            """
        )
        conn.execute(
            """
            INSERT INTO predictions (
                match_id, predictor_id, home_win_probability, predicted_margin, tipped_team
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (16, 80, 55, 4.0, 'home'),
        )
        conn.commit()
    finally:
        conn.close()

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

    with pytest.raises(sqlite3.IntegrityError):
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

    assert rows == [(16, 80, 55, 4.0, 'home')]
    assert 'Error saving predictions to database:' in capsys.readouterr().out


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
