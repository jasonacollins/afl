import json
import os
import sys
import tempfile

import pandas as pd
import pytest

SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.elo_core import AFLEloModel
from elo_margin_methods_predict import AFLOptimalMarginPredictor


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
