import os
import sys
from types import SimpleNamespace

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


def build_margin_method_matches_df():
    return pd.DataFrame([
        {
            'match_id': 1,
            'year': 2024,
            'round_number': '1',
            'match_date': pd.Timestamp('2024-03-15'),
            'home_team': 'Richmond',
            'away_team': 'Carlton',
            'hscore': 90,
            'ascore': 80,
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
            'hscore': 84,
            'ascore': 80,
            'venue': 'Adelaide Oval',
            'venue_state': 'SA',
            'home_team_state': 'SA',
            'away_team_state': 'WA',
        },
        {
            'match_id': 3,
            'year': 2026,
            'round_number': '1',
            'match_date': pd.Timestamp('2026-03-15'),
            'home_team': 'Geelong',
            'away_team': 'Sydney',
            'hscore': 81,
            'ascore': 80,
            'venue': 'GMHBA Stadium',
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'NSW',
        },
        {
            'match_id': 4,
            'year': 2026,
            'round_number': '2',
            'match_date': pd.Timestamp('2026-03-22'),
            'home_team': 'Fremantle',
            'away_team': 'Brisbane Lions',
            'hscore': 77,
            'ascore': 78,
            'venue': 'Optus Stadium',
            'venue_state': 'WA',
            'home_team_state': 'WA',
            'away_team_state': 'QLD',
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


def test_get_elo_parameter_space_requires_scikit_optimize(monkeypatch):
    monkeypatch.setattr(optimise, 'SKOPT_AVAILABLE', False)

    with pytest.raises(ImportError, match='scikit-optimize is required'):
        optimise.get_elo_parameter_space()


def test_evaluate_parameters_walkforward_returns_detailed_metrics_for_draw_results():
    matches_df = pd.DataFrame([
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
            'home_team': 'Richmond',
            'away_team': 'Carlton',
            'hscore': 80,
            'ascore': 80,
            'venue': 'MCG',
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'VIC',
        },
    ])

    detailed = optimise.evaluate_parameters_walkforward(
        [25, 20, 60, 0.4, 0.6, 90],
        matches_df,
        return_detailed=True,
    )

    assert detailed['total_predictions'] == 1
    assert detailed['predictions'][0]['actual_result'] == 'draw'
    assert detailed['brier_score'] >= 0
    assert detailed['log_loss'] >= 0
    assert len(detailed['split_brier_scores']) == 1
    assert len(detailed['split_bits_scores']) == 1


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


def test_evaluate_margin_method_walkforward_returns_detailed_metrics(monkeypatch, capsys):
    class FakeAFLEloModel:
        def __init__(self, **kwargs):
            self.base_rating = kwargs.get('base_rating', 1500)
            self.team_ratings = {}

        def initialize_ratings(self, teams):
            self.team_ratings = {team: self.base_rating for team in teams}

        def update_ratings(self, *args, **kwargs):
            return None

        def apply_season_carryover(self, *args, **kwargs):
            return None

        def calculate_win_probability(self, *args, **kwargs):
            return 0.6

        def get_contextual_home_advantage(self, *args, **kwargs):
            return 10.0

    monkeypatch.setattr(optimise, 'AFLEloModel', FakeAFLEloModel)

    detailed = optimise.evaluate_margin_method_walkforward(
        [0.1],
        'simple',
        {'k_factor': 20, 'default_home_advantage': 20},
        build_margin_method_matches_df(),
        verbose=True,
        return_detailed=True,
    )

    assert detailed['unweighted_split_mae'] == pytest.approx(2.0)
    assert detailed['global_match_weighted_mae'] == pytest.approx(5 / 3)
    assert detailed['total_matches'] == 3
    assert detailed['split_results'] == [
        {'test_season': 2025, 'match_count': 1, 'mae': 3.0, 'abs_error_sum': 3.0},
        {'test_season': 2026, 'match_count': 2, 'mae': 1.0, 'abs_error_sum': 2.0},
    ]
    assert 'Train ≤ 2024, test 2025: MAE 3.00' in capsys.readouterr().out


def test_evaluate_margin_method_walkforward_supports_linear_and_diminishing_methods(monkeypatch):
    class FakeAFLEloModel:
        def __init__(self, **kwargs):
            self.base_rating = kwargs.get('base_rating', 1500)
            self.team_ratings = {}

        def initialize_ratings(self, teams):
            self.team_ratings = {team: self.base_rating for team in teams}

        def update_ratings(self, *args, **kwargs):
            return None

        def apply_season_carryover(self, *args, **kwargs):
            return None

        def calculate_win_probability(self, *args, **kwargs):
            return 0.6

        def get_contextual_home_advantage(self, *args, **kwargs):
            return 10.0

    monkeypatch.setattr(optimise, 'AFLEloModel', FakeAFLEloModel)
    matches_df = build_matches_df()

    linear_score = optimise.evaluate_margin_method_walkforward(
        [0.2, 1.0],
        'linear',
        {'k_factor': 20},
        matches_df,
    )
    diminishing_score = optimise.evaluate_margin_method_walkforward(
        [0.05],
        'diminishing_returns',
        {'k_factor': 20},
        matches_df,
    )

    assert linear_score == pytest.approx(2.0)
    assert diminishing_score == pytest.approx(3.0)


def test_evaluate_margin_method_walkforward_rejects_unknown_method(monkeypatch):
    class FakeAFLEloModel:
        def __init__(self, **kwargs):
            self.base_rating = kwargs.get('base_rating', 1500)
            self.team_ratings = {}

        def initialize_ratings(self, teams):
            self.team_ratings = {team: self.base_rating for team in teams}

        def update_ratings(self, *args, **kwargs):
            return None

        def apply_season_carryover(self, *args, **kwargs):
            return None

        def calculate_win_probability(self, *args, **kwargs):
            return 0.6

        def get_contextual_home_advantage(self, *args, **kwargs):
            return 10.0

    monkeypatch.setattr(optimise, 'AFLEloModel', FakeAFLEloModel)

    with pytest.raises(ValueError, match='Unknown method: mystery'):
        optimise.evaluate_margin_method_walkforward(
            [0.1],
            'mystery',
            {'k_factor': 20},
            build_matches_df(),
        )


def test_optimize_elo_bayesian_requires_scikit_optimize(monkeypatch):
    monkeypatch.setattr(optimise, 'SKOPT_AVAILABLE', False)

    with pytest.raises(ImportError, match='scikit-optimize is required'):
        optimise.optimize_elo_bayesian(build_matches_df())


def test_optimize_elo_bayesian_runs_multi_start_and_returns_best_result(monkeypatch):
    observed_calls = []
    random_states = []

    def fake_evaluate(params, matches_df, verbose=False):
        observed_calls.append((tuple(params), len(matches_df), verbose))
        return params[0] / 100

    def fake_gp_minimize(func, dimensions, n_calls, n_initial_points, acq_func, xi, noise, random_state):
        random_states.append(random_state)
        candidate_a = [24, 35, 0.35, 0.6, 90, 0.04]
        candidate_b = [20, 30, 0.25, 0.7, 80, 0.05]
        score_a = func(candidate_a)
        score_b = func(candidate_b)
        best_x, best_score = (candidate_b, score_b) if score_b < score_a else (candidate_a, score_a)
        return SimpleNamespace(fun=best_score, x=best_x)

    monkeypatch.setattr(optimise, 'evaluate_parameters_walkforward', fake_evaluate)
    monkeypatch.setattr(optimise, 'gp_minimize', fake_gp_minimize)

    best_params, result = optimise.optimize_elo_bayesian(
        build_matches_df(),
        n_calls=4,
        n_starts=2,
        random_state=7,
    )

    assert random_states == [7, 8]
    assert observed_calls == [
        ((24, 35, 0.35, 0.6, 90), 2, False),
        ((20, 30, 0.25, 0.7, 80), 2, False),
        ((24, 35, 0.35, 0.6, 90), 2, False),
        ((20, 30, 0.25, 0.7, 80), 2, False),
    ]
    assert best_params == {
        'k_factor': 20,
        'home_advantage': 30,
        'margin_factor': 0.25,
        'season_carryover': 0.7,
        'max_margin': 80,
        'beta': 0.05,
        'base_rating': 1500,
    }
    assert result.fun == pytest.approx(0.2)
    assert result.x == [20, 30, 0.25, 0.7, 80, 0.05]


def test_parameter_tuning_grid_search_delegates_to_unified(monkeypatch):
    captured = {}

    def fake_unified(data, param_grid, model_type, max_combinations):
        captured['args'] = (data, param_grid, model_type, max_combinations)
        return {'best_score': 0.12}

    matches_df = build_matches_df()
    param_grid = {'k_factor': [20]}

    monkeypatch.setattr(optimise, 'parameter_tuning_grid_search_unified', fake_unified)

    result = optimise.parameter_tuning_grid_search(matches_df, param_grid, cv=99, max_combinations=3)

    assert result == {'best_score': 0.12}
    assert captured['args'] == (matches_df, param_grid, 'standard', 3)


def test_evaluate_margin_elo_walkforward_delegates_to_unified(monkeypatch):
    captured = {}

    def fake_evaluate(params, matches_df, model_type, verbose):
        captured['args'] = (params, matches_df, model_type, verbose)
        return 4.2

    matches_df = build_matches_df()
    params = [20, 25, 55, 0.6, 0.12, 45, 100]

    monkeypatch.setattr(optimise, 'evaluate_model_walkforward', fake_evaluate)

    score = optimise.evaluate_margin_elo_walkforward(params, matches_df, verbose=True)

    assert score == 4.2
    assert captured['args'] == (params, matches_df, 'margin', True)
