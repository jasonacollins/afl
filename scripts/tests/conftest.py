import json
import sqlite3
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / 'scripts'

TEST_TEAMS = [
    (1, 'Richmond', 'VIC'),
    (2, 'Carlton', 'VIC'),
    (3, 'Adelaide', 'SA'),
    (4, 'West Coast', 'WA'),
    (5, 'Sydney', 'NSW'),
    (6, 'Brisbane Lions', 'QLD'),
    (7, 'Geelong', 'VIC'),
    (8, 'Fremantle', 'WA'),
    (9, 'Port Adelaide', 'SA'),
    (10, 'Collingwood', 'VIC'),
]

TEST_VENUES = [
    (1, 'MCG', 'VIC'),
    (2, 'Adelaide Oval', 'SA'),
    (3, 'Optus Stadium', 'WA'),
    (4, 'SCG', 'NSW'),
    (5, 'Gabba', 'QLD'),
    (6, 'GMHBA Stadium', 'VIC'),
]

TEST_MATCHES = [
    (1, 1, '1', '2024-03-15T19:20:00', 'MCG', 1, 2024, 92, 81, 100, 1, 2),
    (2, 2, '1', '2024-03-16T13:45:00', 'Adelaide Oval', 2, 2024, 88, 77, 100, 3, 4),
    (3, 3, '1', '2024-03-16T16:35:00', 'SCG', 4, 2024, 84, 79, 100, 5, 6),
    (4, 4, '1', '2024-03-17T15:20:00', 'GMHBA Stadium', 6, 2024, 95, 83, 100, 7, 8),
    (5, 5, '1', '2024-03-17T18:10:00', 'Adelaide Oval', 2, 2024, 90, 87, 100, 9, 10),
    (6, 1, '1', '2025-03-14T19:20:00', 'MCG', 1, 2025, 86, 93, 100, 1, 5),
    (7, 2, '1', '2025-03-15T13:45:00', 'Adelaide Oval', 2, 2025, 91, 85, 100, 3, 10),
    (8, 3, '1', '2025-03-15T16:35:00', 'Optus Stadium', 3, 2025, 82, 89, 100, 4, 8),
    (9, 4, '1', '2025-03-16T15:20:00', 'Gabba', 5, 2025, 97, 88, 100, 6, 7),
    (10, 5, '1', '2025-03-16T18:10:00', 'MCG', 1, 2025, 94, 90, 100, 2, 9),
    (11, 1, '1', '2026-03-12T19:20:00', 'MCG', 1, 2026, 99, 80, 100, 1, 4),
    (12, 2, '1', '2026-03-13T13:45:00', 'SCG', 4, 2026, 87, 92, 100, 5, 10),
    (13, 3, '1', '2026-03-13T16:35:00', 'Adelaide Oval', 2, 2026, 101, 75, 100, 3, 8),
    (14, 4, '1', '2026-03-14T15:20:00', 'Gabba', 5, 2026, 85, 79, 100, 6, 2),
    (15, 5, '1', '2026-03-14T18:10:00', 'GMHBA Stadium', 6, 2026, 88, 83, 100, 7, 9),
    (16, 6, '2', '2026-08-01T19:20:00', 'MCG', 1, 2026, None, None, 0, 10, 1),
    (17, 7, '2', '2026-08-02T13:45:00', 'Optus Stadium', 3, 2026, None, None, 0, 8, 4),
    (18, 8, '2', '2026-08-02T16:35:00', 'Adelaide Oval', 2, 2026, None, None, 0, 9, 3),
    (19, 9, '2', '2026-08-03T15:20:00', 'Gabba', 5, 2026, None, None, 0, 6, 5),
    (20, 10, '2', '2026-08-03T18:10:00', 'GMHBA Stadium', 6, 2026, None, None, 0, 7, 2),
]


def create_test_database(db_path):
    conn = sqlite3.connect(db_path)
    conn.executescript(
        """
        CREATE TABLE teams (
            team_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            state TEXT
        );

        CREATE TABLE venues (
            venue_id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            state TEXT
        );

        CREATE TABLE matches (
            match_id INTEGER PRIMARY KEY,
            match_number INTEGER,
            round_number TEXT,
            match_date TEXT,
            venue TEXT,
            venue_id INTEGER,
            year INTEGER NOT NULL,
            hscore INTEGER,
            ascore INTEGER,
            complete INTEGER NOT NULL DEFAULT 0,
            home_team_id INTEGER NOT NULL,
            away_team_id INTEGER NOT NULL
        );

        CREATE TABLE predictions (
            prediction_id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL,
            predictor_id INTEGER NOT NULL,
            home_win_probability INTEGER NOT NULL,
            predicted_margin REAL,
            prediction_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            tipped_team TEXT NOT NULL,
            UNIQUE(match_id, predictor_id)
        );
        """
    )
    conn.executemany(
        "INSERT INTO teams (team_id, name, state) VALUES (?, ?, ?)",
        TEST_TEAMS,
    )
    conn.executemany(
        "INSERT INTO venues (venue_id, name, state) VALUES (?, ?, ?)",
        TEST_VENUES,
    )
    conn.executemany(
        """
        INSERT INTO matches (
            match_id, match_number, round_number, match_date, venue, venue_id,
            year, hscore, ascore, complete, home_team_id, away_team_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        TEST_MATCHES,
    )
    conn.commit()
    conn.close()


def write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding='utf-8')
    return path


@pytest.fixture
def afl_test_db_path(tmp_path):
    db_path = tmp_path / 'afl_predictions.db'
    create_test_database(db_path)
    return db_path


@pytest.fixture
def afl_team_states(afl_test_db_path):
    from core.data_io import get_team_states_map

    return get_team_states_map(str(afl_test_db_path))


@pytest.fixture
def afl_model_payloads(afl_team_states):
    win_parameters = {
        'base_rating': 1500,
        'k_factor': 24,
        'home_advantage': 30,
        'default_home_advantage': 30,
        'interstate_home_advantage': 60,
        'margin_factor': 0.35,
        'season_carryover': 0.6,
        'max_margin': 100,
        'beta': 0.05,
        'team_states': afl_team_states,
    }
    margin_parameters = {
        'base_rating': 1500,
        'k_factor': 20,
        'home_advantage': 25,
        'default_home_advantage': 25,
        'interstate_home_advantage': 55,
        'season_carryover': 0.65,
        'max_margin': 100,
        'margin_scale': 0.12,
        'scaling_factor': 45,
        'team_states': afl_team_states,
    }
    base_ratings = {
        team_name: 1500 + (index * 8)
        for index, (_, team_name, _) in enumerate(TEST_TEAMS)
    }

    return {
        'win_params': win_parameters,
        'margin_params': margin_parameters,
        'margin_optimization': {
            'best_method': 'simple',
            'parameters': {'scale_factor': 0.12},
            'margin_mae': 24.5,
        },
        'win_model': {
            'model_type': 'win_elo',
            'parameters': win_parameters,
            'team_ratings': base_ratings,
            'yearly_ratings': {'2025': base_ratings},
        },
        'margin_model': {
            'model_type': 'margin_only_elo',
            'parameters': margin_parameters,
            'team_ratings': base_ratings,
            'yearly_ratings': {'2025': base_ratings},
            'mae': 24.5,
        },
    }


@pytest.fixture
def afl_cli_workspace(tmp_path, afl_test_db_path, afl_model_payloads):
    workspace = tmp_path / 'workspace'
    workspace.mkdir()

    models_dir = workspace / 'models'
    params_dir = workspace / 'params'
    models_dir.mkdir()
    params_dir.mkdir()

    win_model_path = write_json(models_dir / 'afl_elo_win_trained_to_2025.json', afl_model_payloads['win_model'])
    margin_model_path = write_json(
        models_dir / 'afl_elo_margin_only_trained_to_2025.json',
        afl_model_payloads['margin_model'],
    )
    win_params_path = write_json(params_dir / 'win_params.json', afl_model_payloads['win_params'])
    margin_params_path = write_json(params_dir / 'margin_params.json', afl_model_payloads['margin_params'])
    margin_optimization_path = write_json(
        params_dir / 'margin_optimization.json',
        afl_model_payloads['margin_optimization'],
    )

    return {
        'workspace': workspace,
        'db_path': afl_test_db_path,
        'win_model_path': win_model_path,
        'margin_model_path': margin_model_path,
        'win_params_path': win_params_path,
        'margin_params_path': margin_params_path,
        'margin_optimization_path': margin_optimization_path,
    }
