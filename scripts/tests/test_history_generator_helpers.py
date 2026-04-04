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

import elo_history_generator as history_generator_module  # noqa: E402
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
    run_incremental_update,
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


def test_run_incremental_update_bootstraps_full_rebuild_when_history_is_missing(tmp_path, monkeypatch):
    output_path = tmp_path / 'missing-history.csv'
    calls = {}

    monkeypatch.setattr(
        history_generator_module,
        'run_full_rebuild',
        lambda model_config, db_path, output_csv_path, year_bounds: (
            calls.update(
                model_config=model_config,
                db_path=db_path,
                output_csv_path=output_csv_path,
                year_bounds=year_bounds,
            ) or 14
        ),
    )

    result = run_incremental_update(
        {'model_type': MODEL_TYPE_WIN, 'params': {}},
        'data/database/afl_predictions.db',
        str(output_path),
        {'seed_start_year': 2020, 'seed_end_year': 2025, 'output_start_year': 2024, 'output_end_year': 2025},
    )

    assert result == 14
    assert calls == {
        'model_config': {'model_type': MODEL_TYPE_WIN, 'params': {}},
        'db_path': 'data/database/afl_predictions.db',
        'output_csv_path': str(output_path),
        'year_bounds': {
            'seed_start_year': 2020,
            'seed_end_year': 2025,
            'output_start_year': 2024,
            'output_end_year': 2025,
        },
    }


def test_run_incremental_update_falls_back_to_full_rebuild_when_history_fails_integrity_checks(
    tmp_path,
    monkeypatch,
):
    output_path = tmp_path / 'history.csv'
    output_path.write_text('placeholder', encoding='utf-8')
    existing_df = pd.DataFrame([
        {'date': '2025-03-01T00:00:00Z', 'match_id': 1, 'team': 'Cats', 'year': 2025, 'rating_after': 1512.5}
    ])

    monkeypatch.setattr(history_generator_module, 'load_existing_history', lambda csv_path: existing_df)
    monkeypatch.setattr(history_generator_module, 'get_history_integrity_issues', lambda df: ['duplicate rows'])

    calls = {}
    monkeypatch.setattr(
        history_generator_module,
        'run_full_rebuild',
        lambda model_config, db_path, output_csv_path, year_bounds: (
            calls.update(output_csv_path=output_csv_path) or 8
        ),
    )

    result = run_incremental_update(
        {'model_type': MODEL_TYPE_MARGIN, 'params': {}},
        'db.sqlite',
        str(output_path),
        {'seed_start_year': 2020, 'seed_end_year': None, 'output_start_year': 2024, 'output_end_year': None},
    )

    assert result == 8
    assert calls['output_csv_path'] == str(output_path)


def test_run_incremental_update_returns_zero_when_no_new_completed_matches_exist(tmp_path, monkeypatch):
    output_path = tmp_path / 'history.csv'
    output_path.write_text('placeholder', encoding='utf-8')
    existing_df = pd.DataFrame([
        {
            'date': '2025-03-01T00:00:00Z',
            'match_id': 1,
            'team': 'Cats',
            'year': 2025,
            'rating_after': 1512.5,
            '_parsed_date': pd.Timestamp('2025-03-01T00:00:00Z'),
        }
    ])

    monkeypatch.setattr(history_generator_module, 'load_existing_history', lambda csv_path: existing_df)
    monkeypatch.setattr(history_generator_module, 'get_history_integrity_issues', lambda df: [])
    monkeypatch.setattr(
        history_generator_module,
        'get_checkpoint_from_history',
        lambda df: {'date': '2025-03-01T00:00:00Z', 'match_id': 1, 'year': 2025},
    )
    monkeypatch.setattr(history_generator_module, 'fetch_afl_data', lambda **kwargs: pd.DataFrame())

    result = run_incremental_update(
        {'model_type': MODEL_TYPE_MARGIN, 'params': {}},
        'db.sqlite',
        str(output_path),
        {'seed_start_year': 2020, 'seed_end_year': 2025, 'output_start_year': 2024, 'output_end_year': 2025},
    )

    assert result == 0


def test_run_incremental_update_appends_filtered_rows_and_reuses_checkpoint_year(tmp_path, monkeypatch):
    output_path = tmp_path / 'history.csv'
    output_path.write_text('placeholder', encoding='utf-8')
    existing_df = pd.DataFrame([
        {
            'date': '2025-03-01T00:00:00Z',
            'match_id': 1,
            'team': 'Cats',
            'year': 2025,
            'rating_after': 1512.5,
            '_parsed_date': pd.Timestamp('2025-03-01T00:00:00Z'),
        }
    ])
    new_match_data = pd.DataFrame([
        {
            'match_id': 2,
            'year': 2026,
            'round_number': '1',
            'match_date': pd.Timestamp('2026-03-10T00:00:00Z'),
            'home_team': 'Cats',
            'away_team': 'Swans',
            'hscore': 90,
            'ascore': 80,
            'venue': 'MCG',
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'NSW',
        }
    ])
    generated_history = pd.DataFrame([
        {
            'date': '2026-03-10T00:00:00Z',
            'match_id': 2,
            'team': 'Cats',
            'year': 2026,
            'rating_after': 1520.0,
        },
        {
            'date': '2026-03-10T00:00:00Z',
            'match_id': 2,
            'team': 'Swans',
            'year': 2026,
            'rating_after': 1480.0,
        },
    ])

    monkeypatch.setattr(history_generator_module, 'load_existing_history', lambda csv_path: existing_df.copy())
    monkeypatch.setattr(history_generator_module, 'get_history_integrity_issues', lambda df: [])
    monkeypatch.setattr(
        history_generator_module,
        'get_checkpoint_from_history',
        lambda df: {'date': '2025-03-01T00:00:00Z', 'match_id': 1, 'year': 2025},
    )
    monkeypatch.setattr(history_generator_module, 'fetch_afl_data', lambda **kwargs: new_match_data)

    class FakeGenerator:
        def __init__(self):
            self.base_rating = 1500.0
            self.team_ratings = None

        def set_team_ratings(self, team_ratings):
            self.team_ratings = dict(team_ratings)

        def get_history_dataframe(self):
            return generated_history.copy()

    fake_generator = FakeGenerator()
    monkeypatch.setattr(history_generator_module, 'build_generator_from_config', lambda model_config: fake_generator)

    applied = {}
    monkeypatch.setattr(
        history_generator_module,
        'apply_matches_to_generator',
        lambda generator, data, previous_year=None: applied.update(
            previous_year=previous_year,
            match_ids=data['match_id'].tolist(),
        ),
    )

    writes = {}
    monkeypatch.setattr(
        history_generator_module,
        'atomic_write_csv',
        lambda dataframe, output_csv_path: writes.update(
            rows=dataframe.to_dict(orient='records'),
            output_csv_path=output_csv_path,
        ),
    )

    result = run_incremental_update(
        {'model_type': MODEL_TYPE_MARGIN, 'params': {}},
        'db.sqlite',
        str(output_path),
        {'seed_start_year': 2020, 'seed_end_year': 2026, 'output_start_year': 2025, 'output_end_year': 2026},
    )

    assert result == 2
    assert fake_generator.team_ratings == {'Cats': 1512.5, 'Swans': 1500.0}
    assert applied == {'previous_year': 2025, 'match_ids': [2]}
    assert writes['output_csv_path'] == str(output_path)
    assert [row['match_id'] for row in writes['rows']] == [1, 2, 2]
    assert all('_parsed_date' not in row for row in writes['rows'])


def test_main_uses_incremental_alias_and_non_legacy_output_path(monkeypatch, tmp_path):
    output_dir = tmp_path / 'history'
    calls = {}

    monkeypatch.setattr(
        sys,
        'argv',
        [
            'elo_history_generator.py',
            '--incremental',
            '--model-path', 'model.json',
            '--db-path', 'db.sqlite',
            '--output-dir', str(output_dir),
            '--start-year', '2024',
            '--end-year', '2025',
        ],
    )
    monkeypatch.setattr(
        history_generator_module.os.path,
        'exists',
        lambda path: path in {'model.json', 'db.sqlite'},
    )
    monkeypatch.setattr(
        history_generator_module,
        'resolve_year_bounds',
        lambda args: {
            'seed_start_year': 2024,
            'seed_end_year': 2025,
            'output_start_year': 2024,
            'output_end_year': 2025,
        },
    )
    monkeypatch.setattr(
        history_generator_module,
        'load_model_config',
        lambda model_path: {'model_type': MODEL_TYPE_MARGIN, 'params': {}},
    )
    monkeypatch.setattr(
        history_generator_module,
        'run_incremental_update',
        lambda model_config, db_path, output_csv_path, year_bounds: (
            calls.update(
                model_config=model_config,
                db_path=db_path,
                output_csv_path=output_csv_path,
                year_bounds=year_bounds,
            ) or 4
        ),
    )
    monkeypatch.setattr(
        history_generator_module,
        'run_full_rebuild',
        lambda *args, **kwargs: pytest.fail('full rebuild should not be selected when --incremental is provided'),
    )

    history_generator_module.main()

    assert calls == {
        'model_config': {'model_type': MODEL_TYPE_MARGIN, 'params': {}},
        'db_path': 'db.sqlite',
        'output_csv_path': str(output_dir / 'afl_elo_complete_history.csv'),
        'year_bounds': {
            'seed_start_year': 2024,
            'seed_end_year': 2025,
            'output_start_year': 2024,
            'output_end_year': 2025,
        },
    }
