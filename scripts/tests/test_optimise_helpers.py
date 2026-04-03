import os
import sys

import pandas as pd
import pytest


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core import optimise  # noqa: E402


def build_matches_df():
    return pd.DataFrame([
        {
            'match_id': 1,
            'year': 2024,
            'round_number': '1',
            'match_date': pd.Timestamp('2024-03-15'),
            'home_team': 'Richmond',
            'away_team': 'Carlton',
            'hscore': 100,
            'ascore': 90,
            'venue': 'MCG',
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'VIC',
        },
        {
            'match_id': 2,
            'year': 2025,
            'round_number': '1',
            'match_date': pd.Timestamp('2025-03-15'),
            'home_team': 'Adelaide',
            'away_team': 'West Coast',
            'hscore': 85,
            'ascore': 80,
            'venue': 'Adelaide Oval',
            'venue_state': 'SA',
            'home_team_state': 'SA',
            'away_team_state': 'WA',
        },
    ])


def test_unpack_standard_params_supports_legacy_and_beta_layouts():
    assert optimise._unpack_standard_params([25, 30, 0.4, 0.6, 90]) == (25, 30, 30, 0.4, 0.6, 90)
    assert optimise._unpack_standard_params([25, 20, 60, 0.4, 0.6, 90]) == (25, 20, 60, 0.4, 0.6, 90)
    assert optimise._unpack_standard_params([25, 20, 60, 0.4, 0.6, 90, 0.05]) == (25, 20, 60, 0.4, 0.6, 90)

    with pytest.raises(ValueError, match='Standard ELO params must have length 5, 6 or 7'):
        optimise._unpack_standard_params([25, 30, 0.4, 0.6])


def test_unpack_margin_params_supports_legacy_and_split_layouts():
    assert optimise._unpack_margin_params([20, 35, 0.6, 0.12, 45, 100]) == (20, 35, 35, 0.6, 0.12, 45, 100)
    assert optimise._unpack_margin_params([20, 25, 55, 0.6, 0.12, 45, 100]) == (20, 25, 55, 0.6, 0.12, 45, 100)

    with pytest.raises(ValueError, match='Margin ELO params must have length 6 or 7'):
        optimise._unpack_margin_params([20, 35, 0.6, 0.12, 45])


def test_margin_prediction_helpers_return_expected_values():
    assert optimise.predict_margin_simple(80, 0.125) == 10.0
    assert optimise.predict_margin_diminishing_returns(0.6, 0.02) == pytest.approx(5.0)
    assert optimise.predict_margin_linear(40, 0.1, -2.0) == 2.0


def test_evaluate_model_walkforward_rejects_unstable_margin_parameters():
    score = optimise.evaluate_model_walkforward(
        [60, 25, 55, 0.6, 0.02, 20, 100],
        build_matches_df(),
        model_type='margin',
    )

    assert score == 1e10


def test_evaluate_model_walkforward_rejects_unknown_model_type():
    with pytest.raises(ValueError, match='Unknown model_type'):
        optimise.evaluate_model_walkforward([25, 30, 0.4, 0.6, 90], build_matches_df(), model_type='mystery')


def test_parameter_tuning_grid_search_unified_builds_margin_combinations_and_picks_best(monkeypatch):
    scores = []

    def fake_evaluate(param_list, data, model_type='standard', verbose=False):
        scores.append((tuple(param_list), model_type, len(data)))
        return float(param_list[0])

    monkeypatch.setattr(optimise, 'evaluate_model_walkforward', fake_evaluate)

    param_grid = {
        'base_rating': [1500],
        'k_factor': [10, 20],
        'default_home_advantage': [20],
        'interstate_home_advantage': [15, 30],
        'season_carryover': [0.6],
        'max_margin': [80],
        'margin_scale': [0.12],
        'scaling_factor': [45],
    }

    result = optimise.parameter_tuning_grid_search_unified(
        build_matches_df(),
        param_grid,
        model_type='margin',
    )

    assert len(result['all_results']) == 2
    assert result['best_score'] == 10.0
    assert result['best_params']['k_factor'] == 10
    assert all(model_type == 'margin' for _, model_type, _ in scores)
    assert all(len_data == 2 for _, _, len_data in scores)


def test_parameter_tuning_grid_search_unified_honors_max_combinations(monkeypatch):
    monkeypatch.setattr(optimise, 'evaluate_model_walkforward', lambda *args, **kwargs: 0.25)

    param_grid = {
        'base_rating': [1500],
        'k_factor': [20, 25, 30],
        'default_home_advantage': [20],
        'interstate_home_advantage': [40],
        'margin_factor': [0.2],
        'season_carryover': [0.6],
        'max_margin': [80],
    }

    result = optimise.parameter_tuning_grid_search_unified(
        build_matches_df(),
        param_grid,
        model_type='standard',
        max_combinations=1,
    )

    assert len(result['all_results']) == 1
    assert result['best_score'] == 0.25
