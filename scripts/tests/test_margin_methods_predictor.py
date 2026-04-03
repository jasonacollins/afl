import json
import os
import sys
import tempfile
from types import SimpleNamespace

import pandas as pd
import pytest

SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.elo_core import AFLEloModel
import elo_margin_methods_predict as margin_methods_module
from elo_margin_methods_predict import (
    AFLOptimalMarginPredictor,
    filter_future_predictions,
    normalize_margin_methods_artifact,
    run_predictions,
)


def build_win_model_data():
    params = {
        'base_rating': 1500,
        'k_factor': 30,
        'home_advantage': 30,
        'default_home_advantage': 30,
        'interstate_home_advantage': 90,
        'margin_factor': 0.2,
        'season_carryover': 0.6,
        'max_margin': 80,
        'beta': 0.05,
        'team_states': {
            'Sydney': 'NSW',
            'Carlton': 'VIC'
        }
    }
    return {
        'model_type': 'win_elo',
        'parameters': params,
        'team_ratings': {
            'Sydney': 1540.0,
            'Carlton': 1500.0
        }
    }


def build_margin_artifact(parameter_signature=None):
    return {
        'artifact_version': 2,
        'artifact_type': 'win_margin_methods',
        'best_method': 'simple',
        'best_params': {'scale_factor': 0.125},
        'all_methods': {
            'simple': {'score': 31.0, 'params': {'scale_factor': 0.125}},
            'linear': {'score': 31.2, 'params': {'slope': 0.125, 'intercept': 0.0}},
            'diminishing_returns': {'score': 32.0, 'params': {'beta': 0.02}}
        },
        'required_win_model': {
            'model_type': 'win_elo',
            'train_end_year': 2025,
            'parameter_signature': parameter_signature or build_win_model_data()['parameters']
        }
    }


def build_legacy_margin_artifact(parameter_signature=None):
    return {
        'best_method': 'simple',
        'best_params': {'scale_factor': 0.125},
        'all_methods': {
            'simple': {'score': 31.0, 'params': {'scale_factor': 0.125}},
            'linear': {'score': 31.2, 'params': {'slope': 0.125, 'intercept': 0.0}},
            'diminishing_returns': {'score': 32.0, 'params': {'beta': 0.02}}
        },
        'elo_params_used': parameter_signature or build_win_model_data()['parameters']
    }


def write_json(path, payload):
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(payload, handle)


def test_win_probability_and_contextual_home_advantage_parity():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, 'afl_elo_win_trained_to_2025.json')
        artifact_path = os.path.join(temp_dir, 'optimal_margin_methods_trained_to_2025.json')

        model_data = build_win_model_data()
        write_json(model_path, model_data)
        write_json(artifact_path, build_margin_artifact(parameter_signature=model_data['parameters']))

        predictor = AFLOptimalMarginPredictor(model_path, artifact_path)

        match = {
            'match_id': 1,
            'round_number': '1',
            'match_date': pd.Timestamp('2026-03-01T06:00:00Z'),
            'venue': 'SCG',
            'year': 2026,
            'home_team': 'Sydney',
            'away_team': 'Carlton',
            'venue_state': 'NSW',
            'home_team_state': 'NSW',
            'away_team_state': 'VIC'
        }

        prediction = predictor.predict_match(match)

        reference_model = AFLEloModel(**model_data['parameters'])
        reference_model.team_ratings = model_data['team_ratings'].copy()
        expected_prob = reference_model.calculate_win_probability(
            'Sydney',
            'Carlton',
            venue_state='NSW',
            home_team_state='NSW',
            away_team_state='VIC'
        )

        assert abs(prediction['home_win_probability'] - expected_prob) < 1e-10

        expected_diff = (
            model_data['team_ratings']['Sydney']
            + model_data['parameters']['interstate_home_advantage']
            - model_data['team_ratings']['Carlton']
        )
        assert abs(prediction['predicted_margin_simple'] - (expected_diff * 0.125)) < 1e-10


def test_draw_rating_update_uses_win_model_logic():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, 'afl_elo_win_trained_to_2025.json')
        artifact_path = os.path.join(temp_dir, 'optimal_margin_methods_trained_to_2025.json')

        model_data = build_win_model_data()
        write_json(model_path, model_data)
        write_json(artifact_path, build_margin_artifact(parameter_signature=model_data['parameters']))

        predictor = AFLOptimalMarginPredictor(model_path, artifact_path)

        result = predictor.update_ratings_for_completed_match({
            'match_id': 2,
            'round_number': '2',
            'match_date': pd.Timestamp('2026-03-08T06:00:00Z'),
            'venue': 'SCG',
            'year': 2026,
            'home_team': 'Sydney',
            'away_team': 'Carlton',
            'hscore': 80,
            'ascore': 80,
            'venue_state': 'NSW',
            'home_team_state': 'NSW',
            'away_team_state': 'VIC'
        })

        assert result['actual_result'] == 'draw'


def test_compatibility_guard_rejects_mismatch_without_override():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, 'afl_elo_win_trained_to_2025.json')
        artifact_path = os.path.join(temp_dir, 'optimal_margin_methods_trained_to_2025.json')

        model_data = build_win_model_data()
        write_json(model_path, model_data)

        signature = dict(model_data['parameters'])
        signature['k_factor'] = 99
        write_json(artifact_path, build_margin_artifact(parameter_signature=signature))

        with pytest.raises(ValueError, match='Win model parameter mismatch'):
            AFLOptimalMarginPredictor(model_path, artifact_path)


def test_allow_model_mismatch_bypasses_guard():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, 'afl_elo_win_trained_to_2025.json')
        artifact_path = os.path.join(temp_dir, 'optimal_margin_methods_trained_to_2025.json')

        model_data = build_win_model_data()
        write_json(model_path, model_data)

        signature = dict(model_data['parameters'])
        signature['k_factor'] = 99
        write_json(artifact_path, build_margin_artifact(parameter_signature=signature))

        predictor = AFLOptimalMarginPredictor(
            model_path,
            artifact_path,
            allow_model_mismatch=True
        )

        assert predictor.selected_method == 'simple'


def test_legacy_artifact_uses_elo_params_used_for_compatibility():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, 'afl_elo_win_trained_to_2025.json')
        artifact_path = os.path.join(temp_dir, 'optimal_margin_methods.json')

        model_data = build_win_model_data()
        write_json(model_path, model_data)
        write_json(artifact_path, build_legacy_margin_artifact(parameter_signature=model_data['parameters']))

        predictor = AFLOptimalMarginPredictor(model_path, artifact_path)

        assert predictor.selected_method == 'simple'


def test_artifact_without_compatibility_metadata_is_rejected():
    with tempfile.TemporaryDirectory() as temp_dir:
        model_path = os.path.join(temp_dir, 'afl_elo_win_trained_to_2025.json')
        artifact_path = os.path.join(temp_dir, 'broken_margin_methods.json')

        model_data = build_win_model_data()
        write_json(model_path, model_data)
        write_json(artifact_path, {
            'best_method': 'simple',
            'all_methods': {
                'simple': {'score': 31.0, 'params': {'scale_factor': 0.125}}
            }
        })

        with pytest.raises(ValueError, match='missing required_win_model compatibility metadata'):
            AFLOptimalMarginPredictor(model_path, artifact_path)


def test_filter_future_predictions_keeps_unparseable_and_future_games_only():
    predictions = [
        {'match_id': 1, 'match_date': '2099-03-01T06:00:00Z'},
        {'match_id': 2, 'match_date': '2099-03-01T06:00:00+00:00'},
        {'match_id': 3, 'match_date': '2099-03-01 06:00:00'},
        {'match_id': 4, 'match_date': '2099-03-01'},
        {'match_id': 5, 'match_date': '2000-03-01T06:00:00Z'},
        {'match_id': 6, 'match_date': '2099-03-01T06:00:00Z', 'actual_result': 'home_win'},
        {'match_id': 7},
        {'match_id': 8, 'match_date': 'not-a-date'},
    ]

    filtered = filter_future_predictions(predictions, verbose=False)

    assert [prediction['match_id'] for prediction in filtered] == [1, 2, 3, 4, 7, 8]


def test_normalize_margin_methods_artifact_uses_legacy_scores_and_signature_fallback():
    normalized = normalize_margin_methods_artifact({
        'all_methods': {
            'simple': {'scale_factor': 0.125, 'score': 31.0},
            'linear': {'params': {'slope': 0.25, 'intercept': 1.5}, 'score': 29.5},
        },
        'elo_params_used': {'k_factor': 30, 'beta': 0.05},
        'train_window': {'end_year': 2024},
    })

    assert normalized['best_method'] == 'linear'
    assert normalized['best_params'] == {'slope': 0.25, 'intercept': 1.5}
    assert normalized['all_methods']['simple']['params'] == {'scale_factor': 0.125}
    assert normalized['required_win_model'] == {
        'model_type': 'win_elo',
        'train_end_year': 2024,
        'parameter_signature': {'k_factor': 30, 'beta': 0.05}
    }


def test_run_predictions_filters_future_rows_and_formats_database_payload(monkeypatch, tmp_path):
    matches_df = pd.DataFrame([
        {
            'match_id': 1,
            'round_number': '1',
            'match_date': pd.Timestamp('2026-03-01T06:00:00Z'),
            'venue': 'SCG',
            'year': 2026,
            'home_team': 'Sydney',
            'away_team': 'Carlton',
            'hscore': 80,
            'ascore': 70,
        },
        {
            'match_id': 2,
            'round_number': '2',
            'match_date': pd.Timestamp('2099-03-08T06:00:00Z'),
            'venue': 'MCG',
            'year': 2026,
            'home_team': 'Carlton',
            'away_team': 'Sydney',
            'hscore': None,
            'ascore': None,
        },
        {
            'match_id': 3,
            'round_number': '1',
            'match_date': pd.Timestamp('2099-04-01T06:00:00Z'),
            'venue': 'Adelaide Oval',
            'year': 2027,
            'home_team': 'Adelaide',
            'away_team': 'Sydney',
            'hscore': None,
            'ascore': None,
        },
    ])

    captured = {
        'csv_predictions': None,
        'csv_path': None,
        'db_predictions': None,
        'db_args': None,
        'carryover_years': [],
        'constructor_args': None,
        'evaluated_predictions': None,
    }

    class FakePredictor:
        def __init__(self, elo_model, margin_methods, method_override=None, allow_model_mismatch=False):
            captured['constructor_args'] = {
                'elo_model': elo_model,
                'margin_methods': margin_methods,
                'method_override': method_override,
                'allow_model_mismatch': allow_model_mismatch,
            }
            self.selected_method = 'linear'
            self.predictions = []
            self.margin_artifact = {
                'all_methods': {
                    'linear': {'params': {'slope': 0.25}},
                    'simple': {'params': {'scale_factor': 0.125}},
                }
            }
            self.win_model = SimpleNamespace(
                apply_season_carryover=lambda year: captured['carryover_years'].append(year)
            )

        def predict_match(self, match):
            return {
                'match_id': match['match_id'],
                'round_number': match['round_number'],
                'match_date': match['match_date'].isoformat(),
                'venue': match['venue'],
                'year': match['year'],
                'home_team': match['home_team'],
                'away_team': match['away_team'],
                'home_win_probability': 0.62,
                'away_win_probability': 0.38,
                'predicted_margin': 12.5,
                'predicted_margin_linear': 12.5,
                'predicted_margin_simple': 9.0,
                'predicted_winner': match['home_team'],
                'confidence': 0.62,
                'margin_method_selected': 'linear',
            }

        def update_ratings_for_completed_match(self, match):
            return {'match_id': match['match_id'], 'actual_result': 'home_win'}

    monkeypatch.setattr(margin_methods_module, 'AFLOptimalMarginPredictor', FakePredictor)
    monkeypatch.setattr(margin_methods_module, 'fetch_matches_for_prediction', lambda db_path, start_year: matches_df)
    monkeypatch.setattr(
        margin_methods_module,
        'save_predictions_to_csv',
        lambda predictions, filename: captured.update(csv_predictions=predictions, csv_path=filename),
    )
    monkeypatch.setattr(
        margin_methods_module,
        'save_predictions_to_database',
        lambda predictions, db_path, predictor_id, override_completed=False: captured.update(
            db_predictions=predictions,
            db_args={
                'db_path': db_path,
                'predictor_id': predictor_id,
                'override_completed': override_completed,
            }
        ),
    )
    monkeypatch.setattr(
        margin_methods_module,
        'evaluate_predictions',
        lambda predictions: captured.update(evaluated_predictions=predictions) or {'games': len(predictions)},
    )
    monkeypatch.setattr(margin_methods_module, 'format_scoring_summary', lambda results: f"summary:{results['games']}")

    run_predictions(
        start_year=2026,
        elo_model='data/models/win/model.json',
        margin_methods='data/models/win/optimal_margin_methods.json',
        output_dir=str(tmp_path),
        db_path='data/database/test.db',
        save_to_db=True,
        predictor_id=7,
        future_only=True,
        override_completed=True,
        method_override='linear',
        allow_model_mismatch=False,
    )

    assert captured['constructor_args'] == {
        'elo_model': 'data/models/win/model.json',
        'margin_methods': 'data/models/win/optimal_margin_methods.json',
        'method_override': 'linear',
        'allow_model_mismatch': False,
    }
    assert captured['carryover_years'] == [2027]
    assert [prediction['match_id'] for prediction in captured['evaluated_predictions']] == [1]
    assert [prediction['match_id'] for prediction in captured['csv_predictions']] == [2, 3]
    assert captured['csv_path'] == os.path.join(str(tmp_path), 'win_margin_methods_predictions_2026_2027.csv')
    assert captured['db_args'] == {
        'db_path': 'data/database/test.db',
        'predictor_id': 7,
        'override_completed': True,
    }
    assert captured['db_predictions'] == [
        {
            'match_id': 2,
            'home_team': 'Carlton',
            'away_team': 'Sydney',
            'match_date': '2099-03-08T06:00:00+00:00',
            'home_win_probability': 0.62,
            'predicted_margin': 12.5,
            'predicted_winner': 'Carlton',
            'confidence': 0.62,
            'actual_result': None,
        },
        {
            'match_id': 3,
            'home_team': 'Adelaide',
            'away_team': 'Sydney',
            'match_date': '2099-04-01T06:00:00+00:00',
            'home_win_probability': 0.62,
            'predicted_margin': 12.5,
            'predicted_winner': 'Adelaide',
            'confidence': 0.62,
            'actual_result': None,
        },
    ]
