import json
import os
import sys
from types import SimpleNamespace

import pandas as pd
import pytest


CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
SCRIPTS_DIR = os.path.join(CURRENT_DIR, '..')
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

from elo_history_generator import (  # noqa: E402
    MODEL_TYPE_MARGIN,
    MODEL_TYPE_WIN,
    atomic_write_csv,
    build_generator_from_config,
    build_team_ratings_from_history,
    get_checkpoint_from_history,
    get_history_integrity_issues,
    get_output_csv_path,
    load_existing_history,
    load_model_config,
    parse_history_dates,
    resolve_year_bounds,
    filter_history_output,
)


def test_load_model_config_infers_margin_model_and_builds_generator(tmp_path):
    model_path = tmp_path / 'margin-model.json'
    model_path.write_text(json.dumps({
        'parameters': {
            'base_rating': 1510,
            'home_advantage': 28,
            'k_factor': 24,
            'margin_scale': 0.12,
            'scaling_factor': 40,
            'season_carryover': 0.65,
            'max_margin': 90,
            'team_states': {'Sydney': 'NSW'},
        }
    }), encoding='utf-8')

    model_config = load_model_config(model_path)

    assert model_config['model_type'] == MODEL_TYPE_MARGIN

    generator = build_generator_from_config(model_config)
    assert generator.model_type == MODEL_TYPE_MARGIN
    assert generator.base_rating == 1510.0
    assert generator.default_home_advantage == 28.0
    assert generator.interstate_home_advantage == 28.0
    assert generator.team_states == {'Sydney': 'NSW'}


def test_load_model_config_rejects_missing_parameters(tmp_path):
    model_path = tmp_path / 'broken-model.json'
    model_path.write_text(json.dumps({'model_type': MODEL_TYPE_WIN}), encoding='utf-8')

    assert load_model_config(model_path) is None


def test_resolve_year_bounds_uses_defaults_and_validates_ranges():
    bounds = resolve_year_bounds(SimpleNamespace(
        seed_start_year=None,
        seed_end_year=None,
        output_start_year=None,
        output_end_year=None,
        start_year=None,
        end_year=None,
    ))

    assert bounds == {
        'seed_start_year': 1990,
        'seed_end_year': None,
        'output_start_year': 2000,
        'output_end_year': None,
    }

    with pytest.raises(ValueError, match='seed-start-year cannot be greater than seed-end-year'):
        resolve_year_bounds(SimpleNamespace(
            seed_start_year=2026,
            seed_end_year=2025,
            output_start_year=None,
            output_end_year=None,
            start_year=None,
            end_year=None,
        ))


def test_history_integrity_checkpoint_and_latest_ratings_helpers():
    df = pd.DataFrame([
        {'date': '2025-03-10T00:00:00Z', 'match_id': 1, 'year': 2025, 'team': 'Cats', 'rating_after': 1512},
        {'date': '2025-03-10T00:00:00Z', 'match_id': 1, 'year': 2025, 'team': 'Cats', 'rating_after': 1515},
        {'date': 'bad-date', 'match_id': 2, 'year': 2025, 'team': 'Swans', 'rating_after': 1488},
        {'date': '2025-03-20T00:00:00Z', 'match_id': 3, 'year': 2025, 'team': 'Swans', 'rating_after': 1499},
    ])
    df['_parsed_date'] = parse_history_dates(df['date'])

    issues = get_history_integrity_issues(df)
    checkpoint = get_checkpoint_from_history(df)
    ratings = build_team_ratings_from_history(df)

    assert any('invalid or missing dates' in issue for issue in issues)
    assert any('duplicate year/match/team history rows' in issue for issue in issues)
    assert checkpoint == {'date': '2025-03-20T00:00:00Z', 'match_id': 3, 'year': 2025}
    assert ratings == {'Cats': 1515.0, 'Swans': 1499.0}


def test_filter_history_output_and_output_path_sort_and_bound_results():
    df = pd.DataFrame([
        {'date': '2026-04-01T00:00:00Z', 'match_id': 2, 'team': 'Swans', 'year': 2026},
        {'date': '2025-03-01T00:00:00Z', 'match_id': 1, 'team': 'Cats', 'year': 2025},
        {'date': '2027-05-01T00:00:00Z', 'match_id': 3, 'team': 'Lions', 'year': 2027},
    ])

    filtered = filter_history_output(df, output_start_year=2025, output_end_year=2026)

    assert filtered['match_id'].tolist() == [1, 2]
    assert get_output_csv_path('data/historical', 'afl_elo_complete_history', 1990, 2025) == (
        'data/historical/afl_elo_complete_history_1990_to_2025.csv'
    )


def test_atomic_write_csv_and_load_existing_history_round_trip(tmp_path):
    output_path = tmp_path / 'history.csv'
    source_df = pd.DataFrame([
        {'date': '2025-03-01T00:00:00Z', 'match_id': 1, 'team': 'Cats', 'year': 2025, 'rating_after': 1512.5},
        {'date': '2025-03-02T00:00:00Z', 'match_id': 2, 'team': 'Swans', 'year': 2025, 'rating_after': 1498.0},
    ])

    atomic_write_csv(source_df, output_path)
    loaded = load_existing_history(output_path)

    assert output_path.exists()
    assert loaded['match_id'].tolist() == [1, 2]
    assert loaded['_parsed_date'].notna().all()
    assert loaded['rating_after'].tolist() == [1512.5, 1498.0]
