#!/usr/bin/env python3

import os
import sys

import pandas as pd
import pytest


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.elo_core import AFLEloModel, SimpleELO, create_simple_elo_model, train_elo_model  # noqa: E402


def build_training_data(afl_team_states):
    fixtures = [
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
            'home_team_state': afl_team_states['Richmond'],
            'away_team_state': afl_team_states['Carlton'],
        },
        {
            'match_id': 2,
            'year': 2025,
            'round_number': '1',
            'match_date': pd.Timestamp('2025-03-20'),
            'home_team': 'Richmond',
            'away_team': 'Sydney',
            'hscore': 88,
            'ascore': 84,
            'venue': 'MCG',
            'venue_state': 'VIC',
            'home_team_state': afl_team_states['Richmond'],
            'away_team_state': afl_team_states['Sydney'],
        },
    ]
    return pd.DataFrame(fixtures)


def test_afl_elo_update_ratings_initializes_teams_and_handles_draw_without_margin_weight(afl_team_states):
    model = AFLEloModel(
        base_rating=1500,
        k_factor=20,
        default_home_advantage=0,
        interstate_home_advantage=0,
        margin_factor=0,
        beta=0.05,
        team_states=afl_team_states,
    )

    prediction = model.update_ratings(
        home_team='Richmond',
        away_team='Sydney',
        hscore=80,
        ascore=80,
        year=2026,
        match_id=12,
        round_number='2',
        match_date='2026-04-01T09:30:00Z',
        venue='MCG',
        venue_state='VIC',
        home_team_state=afl_team_states['Richmond'],
        away_team_state=afl_team_states['Sydney'],
    )

    assert model.team_ratings['Richmond'] == pytest.approx(1500)
    assert model.team_ratings['Sydney'] == pytest.approx(1500)
    assert prediction['actual_result'] == 'draw'
    assert prediction['correct'] is True
    assert prediction['rating_change'] == pytest.approx(0.0)
    assert prediction['applied_home_advantage'] == 0
    assert len(model.rating_history) == 1


def test_afl_elo_evaluate_model_covers_empty_and_all_outcome_types():
    model = AFLEloModel()

    assert model.evaluate_model() == {
        'accuracy': 0,
        'brier_score': 1.0,
        'log_loss': float('inf'),
    }

    model.predictions = [
        {'actual_result': 'home_win', 'home_win_probability': 0.9},
        {'actual_result': 'away_win', 'home_win_probability': 0.1},
        {'actual_result': 'draw', 'home_win_probability': 0.5},
    ]

    metrics = model.evaluate_model()

    assert metrics['accuracy'] == pytest.approx(1.0)
    assert metrics['brier_score'] == pytest.approx((0.01 + 0.01 + 0.0) / 3)
    assert metrics['log_loss'] >= 0


def test_train_elo_model_uses_default_factory_and_persists_year_boundaries(afl_team_states):
    data = build_training_data(afl_team_states)

    model = train_elo_model(data, params=None)

    assert isinstance(model, AFLEloModel)
    assert set(model.team_ratings) == {'Richmond', 'Carlton', 'Sydney'}
    assert len(model.predictions) == 2
    assert '2024' in model.yearly_ratings
    assert '2025_start' in model.yearly_ratings
    assert '2025' in model.yearly_ratings
    assert model.yearly_ratings['2025_start'] != model.yearly_ratings['2024']


def test_simple_elo_covers_factories_results_carryover_training_and_serialization():
    default_model = create_simple_elo_model()
    custom_model = create_simple_elo_model({
        'k_factor': 30,
        'home_advantage': 40,
        'season_carryover': 0.7,
        'margin_scale': 0.25,
    })

    assert isinstance(default_model, SimpleELO)
    assert default_model.k_factor == 47
    assert custom_model.k_factor == 30
    assert custom_model.home_advantage == 40
    assert custom_model.season_carryover == pytest.approx(0.7)
    assert custom_model.margin_scale == pytest.approx(0.25)

    assert default_model.evaluate_performance() == {
        'accuracy': 0.0,
        'brier_score': 1.0,
        'margin_mae': 0.0,
    }

    default_model.update_ratings('Richmond', 'Carlton', 90, 80)
    default_model.update_ratings('Richmond', 'Carlton', 70, 88)
    default_model.update_ratings('Richmond', 'Carlton', 85, 85)
    performance = default_model.evaluate_performance()

    assert performance['total_matches'] == 3
    assert 0.0 <= performance['accuracy'] <= 1.0
    assert performance['brier_score'] >= 0.0
    assert performance['margin_mae'] >= 0.0

    pre_carryover = dict(default_model.ratings)
    default_model.apply_season_carryover()
    assert default_model.ratings['Richmond'] != pre_carryover['Richmond']
    assert default_model.ratings['Carlton'] != pre_carryover['Carlton']

    training_df = pd.DataFrame([
        {
            'year': 2024,
            'match_date': pd.Timestamp('2024-03-15'),
            'home_team': 'Richmond',
            'away_team': 'Carlton',
            'hscore': 100,
            'ascore': 90,
        },
        {
            'year': 2025,
            'match_date': pd.Timestamp('2025-03-20'),
            'home_team': 'Richmond',
            'away_team': 'West Coast',
            'hscore': 84,
            'ascore': 81,
        },
    ])

    custom_model.ratings['Richmond'] = 1600
    custom_model.train_on_data(training_df)

    assert 'West Coast' in custom_model.ratings
    assert len(custom_model.match_results) == 2
    assert list(custom_model.get_current_ratings().values()) == sorted(
        custom_model.get_current_ratings().values(),
        reverse=True,
    )
    assert custom_model.get_model_data()['model_type'] == 'SimpleELO'
