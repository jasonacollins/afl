#!/usr/bin/env python3
"""
Comprehensive tests for current venue-state interstate logic.
"""

import os
import sys

import numpy as np
import pandas as pd

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.data_io import get_team_states_map  # noqa: E402
from core.elo_core import AFLEloModel  # noqa: E402
from core.home_advantage import select_contextual_home_advantage  # noqa: E402
from core.optimise import evaluate_parameters_walkforward  # noqa: E402

DB_PATH = os.path.join(os.path.dirname(__file__), '../../data/database/afl_predictions.db')
TEAM_STATES = get_team_states_map(DB_PATH)


class TestVenueBasedInterstateLogic:
    def test_strict_rule_applies_interstate_bonus_only_when_home_team_is_local(self):
        assert select_contextual_home_advantage(
            default_home_advantage=20,
            interstate_home_advantage=60,
            venue_state='VIC',
            home_team_state='VIC',
            away_team_state='SA',
        ) == 60

        assert select_contextual_home_advantage(
            default_home_advantage=20,
            interstate_home_advantage=60,
            venue_state='SA',
            home_team_state='VIC',
            away_team_state='WA',
        ) == 20

    def test_model_uses_venue_state_for_contextual_home_advantage(self):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=TEAM_STATES)
        model.initialize_ratings(['Richmond', 'Adelaide', 'West Coast'])

        mcg_advantage = model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state='VIC')
        adelaide_oval_advantage = model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state='SA')
        sold_game_advantage = model.get_contextual_home_advantage('Richmond', 'West Coast', venue_state='WA')

        assert mcg_advantage == 60
        assert adelaide_oval_advantage == 20
        assert sold_game_advantage == 20

    def test_probability_changes_with_venue_state(self):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=TEAM_STATES)
        model.initialize_ratings(['Richmond', 'Adelaide'])

        prob_no_venue = model.calculate_win_probability('Richmond', 'Adelaide', venue_state=None)
        prob_mcg = model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC')
        prob_adelaide_oval = model.calculate_win_probability('Richmond', 'Adelaide', venue_state='SA')

        assert abs(prob_no_venue - prob_adelaide_oval) < 1e-10
        assert prob_mcg > prob_adelaide_oval

    def test_walkforward_evaluation_accepts_venue_state_columns(self):
        data = pd.DataFrame([
            {
                'match_id': 1,
                'year': 2023,
                'round_number': '1',
                'match_date': pd.Timestamp('2023-03-15'),
                'home_team': 'Richmond',
                'away_team': 'Adelaide',
                'hscore': 100,
                'ascore': 90,
                'venue': 'MCG',
                'venue_state': 'VIC',
                'home_team_state': 'VIC',
                'away_team_state': 'SA',
            },
            {
                'match_id': 2,
                'year': 2024,
                'round_number': '1',
                'match_date': pd.Timestamp('2024-03-15'),
                'home_team': 'Richmond',
                'away_team': 'Adelaide',
                'hscore': 82,
                'ascore': 88,
                'venue': 'Adelaide Oval',
                'venue_state': 'SA',
                'home_team_state': 'VIC',
                'away_team_state': 'SA',
            },
        ])

        score = evaluate_parameters_walkforward([25, 20, 60, 0.4, 0.7, 100, 0.05], data, verbose=False)

        assert np.isfinite(score)
