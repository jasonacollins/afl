#!/usr/bin/env python3
"""
Focused pytest tests for current home-advantage application rules.
"""

import os
import sys

import pytest

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.home_advantage import (  # noqa: E402
    normalize_state,
    resolve_contextual_home_advantage,
    resolve_team_state,
    select_contextual_home_advantage,
)
from core.elo_core import AFLEloModel  # noqa: E402
from core.optimise import get_elo_parameter_space  # noqa: E402


class TestHomeAdvantageHelpers:
    def test_normalize_state_handles_none_blank_and_casing(self):
        assert normalize_state(None) is None
        assert normalize_state('') is None
        assert normalize_state('  vic ') == 'VIC'

    def test_resolve_team_state_prefers_explicit_value_then_mapping(self):
        team_states = {'Richmond': 'vic', 'Sydney': 'nsw'}

        assert resolve_team_state('Richmond', explicit_team_state='sa', team_states=team_states) == 'SA'
        assert resolve_team_state('Richmond', team_states=team_states) == 'VIC'
        assert resolve_team_state('Unknown', team_states=team_states) is None
        assert resolve_team_state(None, team_states=team_states) is None

    def test_select_contextual_home_advantage_falls_back_for_unknown_or_international_context(self):
        assert select_contextual_home_advantage(
            20,
            60,
            venue_state='INTL',
            home_team_state='VIC',
            away_team_state='WA',
        ) == 20.0
        assert select_contextual_home_advantage(
            20,
            60,
            venue_state='VIC',
            home_team_state=None,
            away_team_state='WA',
        ) == 20.0
        assert select_contextual_home_advantage(
            20,
            60,
            venue_state='WA',
            home_team_state='WA',
            away_team_state='VIC',
        ) == 60.0
        assert select_contextual_home_advantage(
            20,
            60,
            venue_state='SA',
            home_team_state='WA',
            away_team_state='VIC',
        ) == 20.0

    def test_resolve_contextual_home_advantage_uses_mapping_when_explicit_states_missing(self):
        team_states = {'Richmond': 'VIC', 'West Coast': 'WA'}

        assert resolve_contextual_home_advantage(
            25,
            55,
            home_team='Richmond',
            away_team='West Coast',
            venue_state='VIC',
            team_states=team_states,
        ) == 55.0
        assert resolve_contextual_home_advantage(
            25,
            55,
            home_team='Richmond',
            away_team='West Coast',
            venue_state='WA',
            home_team_state='WA',
            away_team_state='WA',
            team_states=team_states,
        ) == 25.0


class TestHomeAdvantageApplication:
    @pytest.fixture
    def test_model(self, afl_team_states):
        return AFLEloModel(
            base_rating=1500,
            k_factor=25,
            default_home_advantage=20,
            interstate_home_advantage=60,
            margin_factor=0.4,
            season_carryover=0.7,
            max_margin=100,
            beta=0.05,
            team_states=afl_team_states,
        )

    def test_same_state_matches_use_default_advantage(self, test_model):
        test_model.initialize_ratings(['Richmond', 'Carlton', 'Collingwood', 'Melbourne'])
        expected_prob = 1 / (1 + 10 ** (-20 / 400))

        for home_team, away_team in [('Richmond', 'Carlton'), ('Collingwood', 'Melbourne')]:
            probability = test_model.calculate_win_probability(home_team, away_team, venue_state='VIC')
            assert abs(probability - expected_prob) < 1e-10

    def test_interstate_matches_use_interstate_advantage_when_home_team_is_local(self, test_model):
        test_model.initialize_ratings(['Richmond', 'Adelaide', 'West Coast', 'Sydney'])
        expected_prob = 1 / (1 + 10 ** (-60 / 400))

        scenarios = [
            ('Richmond', 'Adelaide', 'VIC'),
            ('West Coast', 'Richmond', 'WA'),
            ('Sydney', 'West Coast', 'NSW'),
        ]

        for home_team, away_team, venue_state in scenarios:
            probability = test_model.calculate_win_probability(home_team, away_team, venue_state=venue_state)
            assert abs(probability - expected_prob) < 1e-10

    def test_interstate_bonus_does_not_apply_when_home_team_is_not_local(self, test_model):
        test_model.initialize_ratings(['Richmond', 'Adelaide', 'West Coast'])

        sold_game_advantage = test_model.get_contextual_home_advantage('Richmond', 'West Coast', venue_state='WA')
        neutral_style_advantage = test_model.get_contextual_home_advantage('West Coast', 'Richmond', venue_state='SA')

        assert sold_game_advantage == 20
        assert neutral_style_advantage == 20

    def test_missing_venue_state_falls_back_to_default_advantage(self, test_model):
        test_model.initialize_ratings(['Richmond', 'Adelaide'])

        assert test_model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state=None) == 20

    @pytest.mark.parametrize("home_team,away_team,expected_interstate", [
        ('Richmond', 'Carlton', False),
        ('Adelaide', 'Port Adelaide', False),
        ('West Coast', 'Fremantle', False),
        ('Richmond', 'Adelaide', True),
        ('West Coast', 'Carlton', True),
        ('Brisbane Lions', 'Sydney', True),
    ])
    def test_team_state_mapping_supports_interstate_detection(
        self,
        afl_team_states,
        home_team,
        away_team,
        expected_interstate
    ):
        assert (afl_team_states[home_team] != afl_team_states[away_team]) == expected_interstate

    def test_probability_calculations_match_elo_formula(self, test_model):
        test_model.initialize_ratings(['Richmond', 'Carlton', 'Adelaide'])

        same_state_prob = test_model.calculate_win_probability('Richmond', 'Carlton', venue_state='VIC')
        interstate_prob = test_model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC')

        assert abs(same_state_prob - (1 / (1 + 10 ** (-20 / 400)))) < 1e-10
        assert abs(interstate_prob - (1 / (1 + 10 ** (-60 / 400)))) < 1e-10
        assert interstate_prob > same_state_prob


class TestHomeAdvantageParameterValidation:
    def test_interstate_advantage_should_be_higher_than_default(self):
        elo_space = get_elo_parameter_space().dimensions
        param_dict = {dimension.name: dimension for dimension in elo_space}

        assert param_dict['interstate_home_advantage'].low > param_dict['default_home_advantage'].low
        assert param_dict['interstate_home_advantage'].high > param_dict['default_home_advantage'].high

    def test_extreme_parameter_combinations_work(self, afl_team_states):
        minimum_model = AFLEloModel(default_home_advantage=0, interstate_home_advantage=20, team_states=afl_team_states)
        maximum_model = AFLEloModel(default_home_advantage=80, interstate_home_advantage=120, team_states=afl_team_states)

        minimum_model.initialize_ratings(['Richmond', 'Adelaide'])
        maximum_model.initialize_ratings(['Richmond', 'Carlton', 'Adelaide'])

        assert 0.5 < minimum_model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC') < 1.0

        same_state_prob = maximum_model.calculate_win_probability('Richmond', 'Carlton', venue_state='VIC')
        interstate_prob = maximum_model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC')

        assert interstate_prob > same_state_prob

    def test_parameter_consistency_across_calculations(self, afl_team_states):
        model = AFLEloModel(default_home_advantage=15, interstate_home_advantage=45, team_states=afl_team_states)
        model.initialize_ratings(['Richmond', 'Carlton', 'Adelaide', 'West Coast'])

        richmond_home_prob = model.calculate_win_probability('Richmond', 'Carlton', venue_state='VIC')
        carlton_home_prob = model.calculate_win_probability('Carlton', 'Richmond', venue_state='VIC')
        interstate_probs = [
            model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC'),
            model.calculate_win_probability('Richmond', 'West Coast', venue_state='VIC'),
        ]

        assert richmond_home_prob > 0.5
        assert carlton_home_prob > 0.5
        assert abs(richmond_home_prob - carlton_home_prob) < 1e-10
        assert abs(interstate_probs[0] - interstate_probs[1]) < 1e-10
