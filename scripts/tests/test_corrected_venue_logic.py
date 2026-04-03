#!/usr/bin/env python3
"""
Tests for the current venue-state-based interstate advantage logic.
"""

import os
import sqlite3
import sys
import tempfile

import pytest

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from core.data_io import get_team_states_map  # noqa: E402
from core.elo_core import AFLEloModel  # noqa: E402


class TestCorrectedVenueBasedInterstateLogic:
    @pytest.fixture
    def test_db_path(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            db_path = os.path.join(temp_dir, 'teams.db')
            conn = sqlite3.connect(db_path)
            conn.execute("""
                CREATE TABLE teams (
                    team_id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL,
                    state TEXT
                )
            """)
            conn.executemany(
                "INSERT INTO teams (team_id, name, state) VALUES (?, ?, ?)",
                [
                    (1, 'Richmond', 'VIC'),
                    (2, 'Adelaide', 'SA'),
                    (3, 'West Coast', 'WA'),
                    (4, 'Carlton', 'VIC'),
                ]
            )
            conn.commit()
            conn.close()
            yield db_path

    @pytest.fixture
    def team_states(self, test_db_path):
        return get_team_states_map(test_db_path)

    def test_team_state_mapping_is_loaded_from_database(self, team_states):
        assert team_states == {
            'Richmond': 'VIC',
            'Adelaide': 'SA',
            'West Coast': 'WA',
            'Carlton': 'VIC',
        }

    def test_interstate_advantage_applies_when_home_team_is_in_venue_state(self, team_states):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=team_states)
        model.initialize_ratings(['Richmond', 'Adelaide'])

        advantage = model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state='VIC')

        assert advantage == 60

    def test_default_advantage_applies_when_away_team_shares_the_venue_state(self, team_states):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=team_states)
        model.initialize_ratings(['Richmond', 'Adelaide'])

        advantage = model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state='SA')

        assert advantage == 20

    def test_sold_home_games_do_not_get_interstate_bonus(self, team_states):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=team_states)
        model.initialize_ratings(['Richmond', 'West Coast'])

        advantage = model.get_contextual_home_advantage('Richmond', 'West Coast', venue_state='WA')

        assert advantage == 20

    def test_unknown_venue_state_falls_back_to_default_advantage(self, team_states):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=team_states)
        model.initialize_ratings(['Richmond', 'Adelaide'])

        assert model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state=None) == 20
        assert model.get_contextual_home_advantage('Richmond', 'Adelaide', venue_state='INTL') == 20

    def test_win_probabilities_change_when_venue_state_changes(self, team_states):
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60, team_states=team_states)
        model.initialize_ratings(['Richmond', 'Adelaide'])

        prob_at_mcg = model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC')
        prob_in_adelaide = model.calculate_win_probability('Richmond', 'Adelaide', venue_state='SA')

        assert prob_at_mcg > prob_in_adelaide
        assert abs(prob_at_mcg - (1 / (1 + 10 ** (-60 / 400)))) < 1e-10
        assert abs(prob_in_adelaide - (1 / (1 + 10 ** (-20 / 400)))) < 1e-10
