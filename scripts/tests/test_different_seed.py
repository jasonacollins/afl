#!/usr/bin/env python3
"""
Regression tests for the Bayesian optimizer seed handling.

These tests intentionally use a small synthetic data set so the Python suite
stays fast enough to run as part of the default project test command.
"""

import os
import sys

import numpy as np
import pandas as pd
import pytest
from skopt import gp_minimize

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.optimise import evaluate_parameters_walkforward, get_elo_parameter_space  # noqa: E402


def build_sample_matches():
    rows = [
        (2023, '2023-03-15', 'Richmond', 'Carlton', 92, 80),
        (2023, '2023-03-22', 'Adelaide', 'West Coast', 101, 74),
        (2023, '2023-04-01', 'Carlton', 'Adelaide', 88, 83),
        (2023, '2023-04-08', 'West Coast', 'Richmond', 70, 97),
        (2024, '2024-03-16', 'Richmond', 'Adelaide', 84, 89),
        (2024, '2024-03-23', 'Carlton', 'West Coast', 95, 76),
        (2024, '2024-04-02', 'Adelaide', 'Carlton', 93, 91),
        (2024, '2024-04-09', 'West Coast', 'Richmond', 78, 86),
        (2025, '2025-03-14', 'Richmond', 'West Coast', 99, 71),
        (2025, '2025-03-21', 'Carlton', 'Adelaide', 81, 87),
        (2025, '2025-03-29', 'Adelaide', 'Richmond', 90, 85),
        (2025, '2025-04-05', 'West Coast', 'Carlton', 73, 94),
    ]

    data = []
    for index, (year, match_date, home_team, away_team, hscore, ascore) in enumerate(rows, start=1):
        data.append({
            'match_id': index,
            'year': year,
            'round_number': str((index % 4) + 1),
            'match_date': pd.Timestamp(match_date),
            'home_team': home_team,
            'away_team': away_team,
            'hscore': hscore,
            'ascore': ascore,
            'venue': 'Test Venue',
            'venue_state': 'VIC',
            'home_team_state': 'VIC' if home_team in {'Richmond', 'Carlton'} else 'SA' if home_team == 'Adelaide' else 'WA',
            'away_team_state': 'VIC' if away_team in {'Richmond', 'Carlton'} else 'SA' if away_team == 'Adelaide' else 'WA',
        })

    return pd.DataFrame(data)


def run_seed(seed, matches_df):
    elo_space = get_elo_parameter_space().dimensions

    def objective(params):
        return evaluate_parameters_walkforward(params, matches_df, verbose=False)

    result = gp_minimize(
        func=objective,
        dimensions=elo_space,
        n_calls=6,
        n_initial_points=3,
        random_state=seed
    )

    return result.fun, result.x


def test_seeded_optimization_returns_finite_scores():
    matches_df = build_sample_matches()

    score, best_params = run_seed(42, matches_df)

    assert np.isfinite(score)
    assert 0 <= score <= 1
    assert len(best_params) == len(get_elo_parameter_space().dimensions)


def test_same_seed_is_repeatable():
    matches_df = build_sample_matches()

    first_score, first_params = run_seed(123, matches_df)
    second_score, second_params = run_seed(123, matches_df)

    assert first_score == pytest.approx(second_score)
    assert first_params == pytest.approx(second_params)
