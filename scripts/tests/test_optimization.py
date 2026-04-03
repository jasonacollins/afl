#!/usr/bin/env python3
"""
Pytest validation for the current AFL ELO optimization helpers.
"""

import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import elo_win_optimize  # noqa: E402
from core.elo_core import AFLEloModel  # noqa: E402
from core import optimise  # noqa: E402
from core.optimise import evaluate_parameters_walkforward, get_elo_parameter_space  # noqa: E402
ELO_SPACE = get_elo_parameter_space().dimensions


@pytest.fixture
def sample_matches_data(afl_team_states):
    rows = []
    fixtures = [
        (2022, '2022-03-15', 'Richmond', 'Carlton', 100, 90, 'VIC'),
        (2022, '2022-03-22', 'Adelaide', 'West Coast', 95, 83, 'SA'),
        (2022, '2022-03-29', 'Carlton', 'Adelaide', 88, 84, 'VIC'),
        (2022, '2022-04-05', 'West Coast', 'Richmond', 74, 96, 'WA'),
        (2023, '2023-03-14', 'Richmond', 'Adelaide', 92, 86, 'VIC'),
        (2023, '2023-03-21', 'Carlton', 'West Coast', 97, 75, 'VIC'),
        (2023, '2023-03-28', 'Adelaide', 'Richmond', 89, 91, 'SA'),
        (2023, '2023-04-04', 'West Coast', 'Carlton', 71, 94, 'WA'),
        (2024, '2024-03-13', 'Richmond', 'West Coast', 98, 72, 'VIC'),
        (2024, '2024-03-20', 'Carlton', 'Adelaide', 84, 87, 'VIC'),
        (2024, '2024-03-27', 'Adelaide', 'Carlton', 90, 88, 'SA'),
        (2024, '2024-04-03', 'West Coast', 'Richmond', 76, 93, 'WA'),
    ]

    for index, (year, match_date, home_team, away_team, hscore, ascore, venue_state) in enumerate(fixtures, start=1):
        rows.append({
            'match_id': index,
            'year': year,
            'round_number': str((index % 4) + 1),
            'match_date': pd.Timestamp(match_date),
            'home_team': home_team,
            'away_team': away_team,
            'hscore': hscore,
            'ascore': ascore,
            'venue': 'Test Venue',
            'venue_state': venue_state,
            'home_team_state': afl_team_states[home_team],
            'away_team_state': afl_team_states[away_team],
        })

    return pd.DataFrame(rows)


class TestAFLEloModel:
    def test_model_initialization(self, afl_team_states):
        model = AFLEloModel(
            k_factor=25,
            default_home_advantage=20,
            interstate_home_advantage=60,
            margin_factor=0.4,
            season_carryover=0.7,
            max_margin=100,
            beta=0.05,
            team_states=afl_team_states,
        )

        assert model.k_factor == 25
        assert model.default_home_advantage == 20
        assert model.interstate_home_advantage == 60
        assert model.team_states['Richmond'] == 'VIC'

    def test_dual_home_advantage_application(self, afl_team_states):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=afl_team_states)
        model.initialize_ratings(['Richmond', 'Carlton', 'Adelaide'])

        same_state_prob = model.calculate_win_probability('Richmond', 'Carlton', venue_state='VIC')
        interstate_prob = model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC')

        assert abs(same_state_prob - (1 / (1 + 10 ** (-20 / 400)))) < 1e-10
        assert abs(interstate_prob - (1 / (1 + 10 ** (-60 / 400)))) < 1e-10
        assert interstate_prob > same_state_prob

    def test_team_state_mapping_coverage(self, afl_team_states):
        expected_teams = [
            'Adelaide',
            'Brisbane Lions',
            'Carlton',
            'Collingwood',
            'Fremantle',
            'Geelong',
            'Port Adelaide',
            'Richmond',
            'Sydney',
            'West Coast',
        ]

        for team in expected_teams:
            assert team in afl_team_states
            assert afl_team_states[team] in ['VIC', 'SA', 'WA', 'QLD', 'NSW']


class TestOptimizationParameterSpace:
    def test_parameter_space_structure(self):
        assert [dimension.name for dimension in ELO_SPACE] == [
            'k_factor',
            'default_home_advantage',
            'interstate_home_advantage',
            'margin_factor',
            'season_carryover',
            'max_margin',
            'beta',
        ]

    def test_parameter_ranges_are_sensible(self):
        param_dict = {dimension.name: dimension for dimension in ELO_SPACE}

        assert param_dict['k_factor'].low == 10
        assert param_dict['k_factor'].high == 50
        assert param_dict['default_home_advantage'].low == 0
        assert param_dict['default_home_advantage'].high == 80
        assert param_dict['interstate_home_advantage'].low == 20
        assert param_dict['interstate_home_advantage'].high == 120
        assert param_dict['interstate_home_advantage'].low > param_dict['default_home_advantage'].low
        assert param_dict['season_carryover'].low >= 0.3
        assert param_dict['season_carryover'].high <= 0.95


class TestObjectiveFunction:
    def test_objective_function_is_deterministic(self, sample_matches_data):
        params = [25, 15, 45, 0.4, 0.7, 100, 0.05]
        scores = [
            evaluate_parameters_walkforward(params, sample_matches_data, verbose=False)
            for _ in range(3)
        ]

        assert len(set(scores)) == 1
        assert all(np.isfinite(score) for score in scores)

    def test_boundary_parameter_values_produce_finite_scores(self, sample_matches_data):
        min_params = [10, 0, 20, 0.1, 0.3, 60, 0.02]
        max_params = [50, 80, 120, 0.7, 0.95, 180, 0.08]

        min_score = evaluate_parameters_walkforward(min_params, sample_matches_data, verbose=False)
        max_score = evaluate_parameters_walkforward(max_params, sample_matches_data, verbose=False)

        assert np.isfinite(min_score)
        assert np.isfinite(max_score)
        assert 0 <= min_score <= 1
        assert 0 <= max_score <= 1

    def test_insufficient_data_returns_infinity(self):
        single_season_data = pd.DataFrame([{
            'match_id': 1,
            'year': 2024,
            'round_number': '1',
            'match_date': pd.Timestamp('2024-03-15'),
            'home_team': 'Richmond',
            'away_team': 'Carlton',
            'hscore': 100,
            'ascore': 90,
            'venue': 'Test Venue',
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'VIC',
        }])

        score = evaluate_parameters_walkforward([25, 15, 45, 0.4, 0.7, 100, 0.05], single_season_data, verbose=False)

        assert score == np.inf


class TestOptimizationIntegration:
    def test_parameter_extraction_and_serialization(self, afl_team_states):
        best_params = {
            'k_factor': 25,
            'default_home_advantage': 15,
            'interstate_home_advantage': 45,
            'margin_factor': 0.4,
            'season_carryover': 0.7,
            'max_margin': 100,
            'beta': 0.05,
            'base_rating': 1500,
            'team_states': afl_team_states,
        }

        payload = {
            'parameters': best_params,
            'log_loss': 0.2234,
            'n_iterations': 3,
            'optimization_method': 'bayesian',
        }

        reloaded = json.loads(json.dumps(payload))

        assert reloaded['parameters']['k_factor'] == 25
        assert reloaded['parameters']['default_home_advantage'] == 15
        assert reloaded['parameters']['interstate_home_advantage'] == 45
        assert reloaded['optimization_method'] == 'bayesian'

    def test_optimize_elo_grid_search_adds_detailed_metrics_with_split_home_advantage(self, sample_matches_data, monkeypatch):
        captured = {}

        monkeypatch.setattr(
            elo_win_optimize,
            'fetch_afl_data',
            lambda db_path, start_year, end_year: sample_matches_data,
        )
        monkeypatch.setattr(
            elo_win_optimize,
            'parameter_tuning_grid_search',
            lambda matches_df, param_grid, max_combinations: {
                'best_params': {
                    'k_factor': 25,
                    'default_home_advantage': 15,
                    'interstate_home_advantage': 45,
                    'margin_factor': 0.4,
                    'season_carryover': 0.7,
                    'max_margin': 100,
                },
                'best_score': 0.2234,
                'all_results': [{'params': {'k_factor': 25}, 'brier_score': 0.2234}],
            },
        )

        def fake_evaluate(params, matches_df, verbose=False, return_detailed=False):
            captured['params'] = params
            captured['verbose'] = verbose
            captured['return_detailed'] = return_detailed
            assert matches_df.equals(sample_matches_data)
            return {
                'brier_score': 0.2234,
                'log_loss': 0.481,
                'bits_score_per_game': 0.118,
                'bits_score_total': 1.42,
                'accuracy': 0.75,
                'total_predictions': 12,
            }

        monkeypatch.setattr(elo_win_optimize, 'evaluate_parameters_walkforward', fake_evaluate)

        best_params, tuning_results = elo_win_optimize.optimize_elo_grid_search(
            'data/database/afl_predictions.db',
            start_year=2022,
            end_year=2024,
            max_combinations=3,
        )

        assert best_params['interstate_home_advantage'] == 45
        assert captured == {
            'params': [25, 15, 45, 0.4, 0.7, 100],
            'verbose': False,
            'return_detailed': True,
        }
        assert tuning_results['detailed_evaluation']['accuracy'] == 0.75

    def test_optimize_elo_grid_search_supports_legacy_single_home_advantage_key(self, sample_matches_data, monkeypatch):
        called = {}

        monkeypatch.setattr(
            elo_win_optimize,
            'fetch_afl_data',
            lambda db_path, start_year, end_year: sample_matches_data,
        )
        monkeypatch.setattr(
            elo_win_optimize,
            'parameter_tuning_grid_search',
            lambda matches_df, param_grid, max_combinations: {
                'best_params': {
                    'k_factor': 30,
                    'home_advantage': 35,
                    'margin_factor': 0.3,
                    'season_carryover': 0.6,
                    'max_margin': 80,
                },
                'best_score': 0.25,
                'all_results': [],
            },
        )
        monkeypatch.setattr(
            elo_win_optimize,
            'evaluate_parameters_walkforward',
            lambda params, matches_df, verbose=False, return_detailed=False: (
                called.update(params=params) or {
                    'brier_score': 0.25,
                    'log_loss': 0.5,
                    'bits_score_per_game': 0.1,
                    'bits_score_total': 1.0,
                    'accuracy': 0.5,
                    'total_predictions': 4,
                }
            ),
        )

        elo_win_optimize.optimize_elo_grid_search('db.sqlite')

        assert called['params'] == [30, 35, 35, 0.3, 0.6, 80]

    def test_check_parameter_sampling_uses_small_grid_search_run(self, sample_matches_data, monkeypatch):
        calls = {}

        monkeypatch.setattr(
            elo_win_optimize,
            'fetch_afl_data',
            lambda db_path, start_year, end_year: sample_matches_data,
        )

        def fake_grid_search(matches_df, param_grid, cv=5, max_combinations=None):
            calls['len'] = len(matches_df)
            calls['cv'] = cv
            calls['max_combinations'] = max_combinations
            calls['grid_keys'] = tuple(param_grid.keys())
            return {
                'all_results': [
                    {
                        'params': {
                            'k_factor': 45,
                            'home_advantage': 50,
                            'margin_factor': 0.5,
                            'season_carryover': 0.6,
                            'max_margin': 80,
                        },
                        'brier_score': 0.22,
                    }
                ]
            }

        monkeypatch.setattr(optimise, 'parameter_tuning_grid_search', fake_grid_search)

        result = elo_win_optimize.check_parameter_sampling()

        assert calls == {
            'len': len(sample_matches_data),
            'cv': 2,
            'max_combinations': 10,
            'grid_keys': tuple(elo_win_optimize.elo_param_grid.keys()),
        }
        assert result['all_results'][0]['params']['k_factor'] == 45

    def test_test_known_good_params_evaluates_both_parameter_sets(self, sample_matches_data, monkeypatch):
        observed_params = []

        monkeypatch.setattr(
            elo_win_optimize,
            'fetch_afl_data',
            lambda db_path, start_year, end_year: sample_matches_data,
        )

        def fake_evaluate(params, matches_df, verbose=False):
            observed_params.append(tuple(params))
            return 0.22 if params[0] == 47.0 else 0.224

        monkeypatch.setattr(optimise, 'evaluate_parameters_walkforward', fake_evaluate)

        optimal_score, simple_score = elo_win_optimize.test_known_good_params()

        assert optimal_score == 0.22
        assert simple_score == 0.224
        assert observed_params == [
            (47.0, 52.0, 70.0, 0.47, 0.61, 71.0),
            (45.0, 50.0, 70.0, 0.5, 0.6, 80.0),
        ]

    def test_main_writes_detailed_output_for_standard_optimization(self, monkeypatch, tmp_path):
        captured = {}
        output_path = tmp_path / 'optimal_elo.json'

        monkeypatch.setattr(
            sys,
            'argv',
            [
                'elo_win_optimize.py',
                '--db-path', 'db.sqlite',
                '--start-year', '2024',
                '--end-year', '2025',
                '--n-calls', '3',
                '--output-path', str(output_path),
            ],
        )
        monkeypatch.setattr(
            elo_win_optimize,
            'optimize_elo_grid_search',
            lambda db_path, start_year, end_year, max_combinations: (
                {
                    'k_factor': 25,
                    'default_home_advantage': 15,
                    'interstate_home_advantage': 45,
                },
                {
                    'best_score': 0.2234,
                    'all_results': [{'params': {'k_factor': 25}, 'brier_score': 0.2234}],
                    'detailed_evaluation': {
                        'brier_score': 0.2234,
                        'log_loss': 0.481,
                        'bits_score_per_game': 0.118,
                        'bits_score_total': 1.42,
                        'accuracy': 0.75,
                        'total_predictions': 12,
                    },
                },
            ),
        )
        monkeypatch.setattr(
            elo_win_optimize,
            'save_optimization_results',
            lambda payload, path: captured.update(payload=payload, path=path),
        )

        elo_win_optimize.main()

        assert captured['path'] == str(output_path)
        assert captured['payload'] == {
            'parameters': {
                'k_factor': 25,
                'default_home_advantage': 15,
                'interstate_home_advantage': 45,
            },
            'best_score': 0.2234,
            'best_log_loss': 0.2234,
            'optimization_method': 'grid_search',
            'all_results': [{'params': {'k_factor': 25}, 'brier_score': 0.2234}],
            'detailed_evaluation': {
                'brier_score': 0.2234,
                'log_loss': 0.481,
                'bits_score_per_game': 0.118,
                'bits_score_total': 1.42,
                'accuracy': 0.75,
                'total_predictions': 12,
            },
        }

    def test_main_dispatches_to_sampling_mode_without_saving(self, monkeypatch):
        calls = {'sampling': 0, 'save': 0}

        monkeypatch.setattr(sys, 'argv', ['elo_win_optimize.py', '--check-sampling'])
        monkeypatch.setattr(
            elo_win_optimize,
            'check_parameter_sampling',
            lambda: calls.__setitem__('sampling', calls['sampling'] + 1),
        )
        monkeypatch.setattr(
            elo_win_optimize,
            'save_optimization_results',
            lambda payload, path: calls.__setitem__('save', calls['save'] + 1),
        )

        elo_win_optimize.main()

        assert calls == {'sampling': 1, 'save': 0}
