#!/usr/bin/env python3
"""
Unit tests for the percentile interpolation helper used in the season simulator.
These tests ensure we retain fractional win intervals instead of snapping to
whole numbers when summarising Monte Carlo outcomes.
"""

import json
import os
import sys

import numpy as np
import pandas as pd
import pytest

# Add parent directory so we can import season_simulator module
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(CURRENT_DIR, '..'))

import season_simulator as season_simulator_module  # noqa: E402
from season_simulator import (  # noqa: E402
    SeasonSimulator,
    build_current_round_snapshot_metadata,
    build_post_season_snapshot_metadata,
    build_round_snapshot_metadata,
    interpolate_percentile,
    is_finals_round,
    prune_stale_current_snapshots,
    resolve_finals_round_key,
)


def test_interpolation_returns_fractional_bounds_for_discrete_data():
    """10th/90th percentiles should interpolate between integer win totals."""
    wins = np.array([10] * 600 + [11] * 200 + [12] * 200)

    lower = interpolate_percentile(wins, 10)
    upper = interpolate_percentile(wins, 90)

    assert 10 <= lower < 11
    assert 11 <= upper < 12
    assert lower < upper


def test_interpolation_handles_empty_distribution():
    result = interpolate_percentile([], 50)

    assert np.isnan(result)


def test_interpolation_handles_single_value_distribution():
    """If every simulation yields the same total, the percentile should match it."""
    wins = np.array([14] * 1000)

    assert interpolate_percentile(wins, 10) == 14
    assert interpolate_percentile(wins, 90) == 14


def test_strip_current_snapshot_suffix_only_removes_current_suffix():
    assert season_simulator_module.strip_current_snapshot_suffix('round-4-current') == 'round-4'
    assert season_simulator_module.strip_current_snapshot_suffix('season-complete') == 'season-complete'


def test_round_snapshot_metadata_for_numeric_round():
    """Numeric rounds should map to stable keys and labels."""
    metadata = build_round_snapshot_metadata('12')

    assert metadata['round_key'] == 'round-12'
    assert metadata['round_tab_label'] == 'R12'
    assert metadata['round_label'] == 'Before Round 12'
    assert metadata['round_order'] == 12


def test_round_snapshot_metadata_for_opening_round():
    """Opening round should be represented as OR for tab display."""
    metadata = build_round_snapshot_metadata('OR')

    assert metadata['round_key'] == 'round-or'
    assert metadata['round_tab_label'] == 'OR'
    assert metadata['round_label'] == 'Before Opening Round'
    assert metadata['round_order'] == 0


def test_round_snapshot_metadata_for_finals_round():
    """Finals rounds should use compact tab labels and finals ordering."""
    metadata = build_round_snapshot_metadata('Preliminary Final')

    assert metadata['round_key'] == 'finals-preliminary_final'
    assert metadata['round_tab_label'] == 'PF'
    assert metadata['round_label'] == 'Before Preliminary Final'
    assert metadata['round_order'] == 204


def test_round_snapshot_metadata_for_wildcard_round():
    """Wildcard finals should have dedicated finals metadata."""
    metadata = build_round_snapshot_metadata('Wildcard Finals')

    assert metadata['round_key'] == 'finals-wildcard_round'
    assert metadata['round_tab_label'] == 'WC'
    assert metadata['round_label'] == 'Before Wildcard Finals'
    assert metadata['round_order'] == 200


def test_resolve_finals_round_key_supports_abbreviations():
    """Finals round parser should support short forms used by some feeds."""
    assert resolve_finals_round_key('Wildcard Finals') == 'wildcard_round'
    assert resolve_finals_round_key('Wildcard Round') == 'wildcard_round'
    assert resolve_finals_round_key('WC') == 'wildcard_round'
    assert resolve_finals_round_key('QF') == 'qualifying_final'
    assert resolve_finals_round_key('SF') == 'semi_final'
    assert is_finals_round('Grand Final')
    assert not is_finals_round('22')


def test_post_season_snapshot_metadata():
    """Completed season snapshots should use dedicated post-season metadata."""
    metadata = build_post_season_snapshot_metadata()

    assert metadata['round_key'] == 'season-complete'
    assert metadata['round_tab_label'] == 'Post'
    assert metadata['round_label'] == 'Season Complete'
    assert metadata['round_order'] == 10000


def test_current_round_snapshot_metadata_for_opening_round():
    """In-progress Opening Round snapshots should use a dedicated current key."""
    metadata = build_current_round_snapshot_metadata('OR')

    assert metadata['round_key'] == 'round-or-current'
    assert metadata['round_tab_label'] == 'Current'
    assert metadata['round_label'] == 'Current Opening Round'
    assert metadata['round_order'] == 0.5


def test_current_round_snapshot_metadata_for_numeric_round():
    """In-progress regular rounds should use a current suffix and label."""
    metadata = build_current_round_snapshot_metadata('2')

    assert metadata['round_key'] == 'round-2-current'
    assert metadata['round_tab_label'] == 'Current'
    assert metadata['round_label'] == 'Current Round 2'
    assert metadata['round_order'] == 2.5


def test_prune_stale_current_snapshots_when_active_round_not_current():
    """Completed rounds should drop stale current snapshots."""
    snapshots = [
        {'round_key': 'round-or', 'round_order': 0},
        {'round_key': 'round-or-current', 'round_order': 0.5},
        {'round_key': 'round-1', 'round_order': 1}
    ]

    pruned = prune_stale_current_snapshots(snapshots, 'round-1')

    assert [snapshot['round_key'] for snapshot in pruned] == ['round-or', 'round-1']


def test_prune_stale_current_snapshots_keeps_only_active_current_snapshot():
    """Only the active current snapshot should remain when one is in progress."""
    snapshots = [
        {'round_key': 'round-or', 'round_order': 0},
        {'round_key': 'round-or-current', 'round_order': 0.5},
        {'round_key': 'round-1', 'round_order': 1},
        {'round_key': 'round-1-current', 'round_order': 1.5}
    ]

    pruned = prune_stale_current_snapshots(snapshots, 'round-1-current')

    assert [snapshot['round_key'] for snapshot in pruned] == ['round-or', 'round-1', 'round-1-current']


def test_determine_snapshot_metadata_uses_current_key_for_partial_opening_round():
    """Partial Opening Round should switch current context to OR-current."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_matches = pd.DataFrame({
        'round_number': ['OR'],
        'match_date': pd.to_datetime(['2026-03-05'])
    })
    simulator.upcoming_matches = pd.DataFrame({
        'round_number': ['OR', '1'],
        'match_date': pd.to_datetime(['2026-03-06', '2026-03-12'])
    })

    metadata = simulator.determine_snapshot_round_metadata()

    assert metadata['round_key'] == 'round-or-current'
    assert metadata['round_tab_label'] == 'Current'
    assert metadata['round_label'] == 'Current Opening Round'


def test_determine_snapshot_metadata_uses_current_key_for_partial_regular_round():
    """Partial regular rounds should emit a dedicated current snapshot key."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_matches = pd.DataFrame({
        'round_number': ['1', '2'],
        'match_date': pd.to_datetime(['2026-03-13', '2026-03-20'])
    })
    simulator.upcoming_matches = pd.DataFrame({
        'round_number': ['2', '3'],
        'match_date': pd.to_datetime(['2026-03-21', '2026-03-28'])
    })

    metadata = simulator.determine_snapshot_round_metadata()

    assert metadata['round_key'] == 'round-2-current'
    assert metadata['round_tab_label'] == 'Current'
    assert metadata['round_label'] == 'Current Round 2'


def test_determine_snapshot_metadata_keeps_before_round_when_round_not_started():
    """If no match in next round is complete, keep before-round context."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_matches = pd.DataFrame({
        'round_number': ['OR'],
        'match_date': pd.to_datetime(['2026-03-08'])
    })
    simulator.upcoming_matches = pd.DataFrame({
        'round_number': ['1', '2'],
        'match_date': pd.to_datetime(['2026-03-12', '2026-03-19'])
    })

    metadata = simulator.determine_snapshot_round_metadata()

    assert metadata['round_key'] == 'round-1'
    assert metadata['round_tab_label'] == 'R1'
    assert metadata['round_label'] == 'Before Round 1'


def test_determine_snapshot_metadata_returns_post_when_season_complete():
    """No upcoming matches with completed results should map to post-season."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_matches = pd.DataFrame({
        'round_number': ['Grand Final'],
        'match_date': pd.to_datetime(['2026-09-26'])
    })
    simulator.upcoming_matches = pd.DataFrame(columns=['round_number', 'match_date'])

    metadata = simulator.determine_snapshot_round_metadata()

    assert metadata['round_key'] == 'season-complete'
    assert metadata['round_tab_label'] == 'Post'


def test_backfill_contexts_stop_at_current_round():
    """Backfill should include snapshots only up to the current round context."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.all_matches = pd.DataFrame({
        'round_number': ['OR', '1', '1', '2', '3'],
        'match_date': pd.to_datetime([
            '2025-03-07',
            '2025-03-14',
            '2025-03-15',
            '2025-03-21',
            '2025-03-28'
        ])
    })
    simulator.snapshot_round_metadata = {'round_key': 'round-2'}

    contexts = simulator.build_backfill_round_contexts()

    assert [context['round_key'] for context in contexts] == ['round-or', 'round-1', 'round-2']


def test_backfill_contexts_stop_at_base_round_for_current_snapshot_key():
    """Current-snapshot keys should cap backfill at the matching base round."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.all_matches = pd.DataFrame({
        'round_number': ['OR', '1', '1', '2', '3'],
        'match_date': pd.to_datetime([
            '2025-03-07',
            '2025-03-14',
            '2025-03-15',
            '2025-03-21',
            '2025-03-28'
        ])
    })
    simulator.snapshot_round_metadata = {'round_key': 'round-2-current'}

    contexts = simulator.build_backfill_round_contexts()

    assert [context['round_key'] for context in contexts] == ['round-or', 'round-1', 'round-2']


def test_backfill_contexts_include_post_season_marker_when_complete():
    """Completed seasons should append a post-season snapshot marker."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.all_matches = pd.DataFrame({
        'round_number': ['OR', '1', '2'],
        'match_date': pd.to_datetime([
            '2025-03-07',
            '2025-03-14',
            '2025-03-21'
        ])
    })
    simulator.snapshot_round_metadata = {'round_key': 'season-complete'}

    contexts = simulator.build_backfill_round_contexts()

    assert [context['round_key'] for context in contexts] == ['round-or', 'round-1', 'round-2', 'season-complete']


def test_prepare_start_of_year_ratings_applies_carryover_from_previous_year():
    """Ratings should regress to mean from prior-year snapshot when available."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.year = 2025
    simulator.base_rating = 1500

    model_data = {
        'team_ratings': {'A': 1520, 'B': 1480},
        'yearly_ratings': {'2024': {'A': 1600, 'B': 1400}}
    }

    ratings, _ = simulator.prepare_start_of_year_ratings(model_data, 0.5, 'win')

    assert ratings['A'] == 1550
    assert ratings['B'] == 1450


def test_split_matches_and_current_standings_ignore_finals_results():
    """
    Current standings should be based on completed regular-season matches only.
    """
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_matches = pd.DataFrame({
        'home_team': ['A', 'A', 'B'],
        'away_team': ['B', 'C', 'C'],
        'hscore': [80, 70, 85],
        'ascore': [60, 90, 80],
        'round_number': ['1', 'Qualifying Final', '2']
    })

    regular, finals = simulator.split_regular_and_finals_matches(simulator.completed_matches)
    simulator.completed_regular_matches = regular

    assert len(regular) == 2
    assert len(finals) == 1

    simulator.calculate_current_standings()

    # Team A won one regular-season game and should not be penalized by finals loss.
    assert simulator.current_records['A']['wins'] == 1
    assert simulator.current_records['A']['losses'] == 0


def test_predict_match_probability_applies_home_advantage_and_base_rating_fallback():
    """Win probability should use home advantage and default missing-team ratings."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.base_rating = 1500
    simulator.home_advantage = 40

    probability = simulator.predict_match_probability(
        'Team A',
        'Team B',
        {'Team A': 1520}
    )

    expected = 1.0 / (1.0 + 10 ** (-(1520 + 40 - 1500) / 400))
    assert probability == pytest.approx(expected)


@pytest.mark.parametrize(
    ('random_value', 'expected_result'),
    [
        (0.004, 'draw'),
        (0.30, 'home'),
        (0.90, 'away'),
    ]
)
def test_simulate_match_handles_draw_home_and_away_paths(monkeypatch, random_value, expected_result):
    """Single-match simulation should cover draw, home, and away thresholds."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.base_rating = 1500
    simulator.home_advantage = 0

    monkeypatch.setattr(season_simulator_module.np.random, 'random', lambda: random_value)

    result = simulator.simulate_match(
        'Team A',
        'Team B',
        {'Team A': 1500, 'Team B': 1500}
    )

    assert result == expected_result


def test_update_ratings_from_completed_matches_updates_margin_only_ratings():
    """Margin-only mode should update simulation ratings from margin error."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.combined_mode = False
    simulator.base_rating = 1500
    simulator.home_advantage = 50
    simulator.margin_scale = 0.1
    simulator.scaling_factor = 10
    simulator.margin_k_factor = 20
    simulator.max_margin = 100
    simulator.initial_ratings = {'Team A': 1500, 'Team B': 1500}
    simulator.completed_matches = pd.DataFrame({
        'home_team': ['Team A'],
        'away_team': ['Team B'],
        'hscore': [80],
        'ascore': [70],
        'match_date': pd.to_datetime(['2026-03-15'])
    })

    simulator.update_ratings_from_completed_matches()

    assert simulator.initial_ratings['Team A'] == pytest.approx(1510.0)
    assert simulator.initial_ratings['Team B'] == pytest.approx(1490.0)


def test_update_ratings_from_completed_matches_updates_combined_win_and_margin_ratings():
    """Combined mode should update win ratings and separate margin ratings."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.combined_mode = True
    simulator.base_rating = 1500
    simulator.home_advantage = 50
    simulator.margin_scale = 0.1
    simulator.scaling_factor = 10
    simulator.max_margin = 50
    simulator.margin_factor = 0.1
    simulator.win_k_factor = 20
    simulator.margin_k_factor = 20
    simulator.initial_ratings = {'Team A': 1500, 'Team B': 1500}
    simulator.margin_ratings = {'Team A': 1500, 'Team B': 1500}
    simulator.completed_matches = pd.DataFrame({
        'home_team': ['Team A'],
        'away_team': ['Team B'],
        'hscore': [100],
        'ascore': [0],
        'match_date': pd.to_datetime(['2026-03-15'])
    })

    simulator.update_ratings_from_completed_matches()

    win_prob = 1.0 / (1.0 + 10 ** (-50 / 400))
    expected_win_change = 20 * (1.0 - win_prob)
    expected_margin_change = -20 * ((50 * 0.1) - 100) / 10

    assert simulator.initial_ratings['Team A'] == pytest.approx(1500 + expected_win_change)
    assert simulator.initial_ratings['Team B'] == pytest.approx(1500 - expected_win_change)
    assert simulator.margin_ratings['Team A'] == pytest.approx(1500 + expected_margin_change)
    assert simulator.margin_ratings['Team B'] == pytest.approx(1500 - expected_margin_change)


def test_forced_finals_results_keep_eliminated_teams_out_of_sf_plus():
    """Completed EF results should force losers to have 0 chance of SF+."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.base_rating = 1500

    top8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
    ratings = {team: 1500 for team in top8}
    forced = {
        ('elimination_final', frozenset(('E', 'H'))): 'E',
        ('elimination_final', frozenset(('F', 'G'))): 'F'
    }

    finals_results = simulator.simulate_finals_series(top8, ratings, forced_results=forced)

    assert finals_results['H']['sf_plus'] is False
    assert finals_results['G']['sf_plus'] is False


def test_wildcard_format_uses_top10_path_from_2026():
    """2026+ simulations should use wildcard games before elimination finals."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.base_rating = 1500
    simulator.year = 2026

    top10 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
    ratings = {team: 1500 for team in top10}
    forced = {
        ('wildcard_round', frozenset(('G', 'J'))): 'G',
        ('wildcard_round', frozenset(('H', 'I'))): 'H',
        ('qualifying_final', frozenset(('A', 'D'))): 'A',
        ('qualifying_final', frozenset(('B', 'C'))): 'B',
        ('elimination_final', frozenset(('E', 'H'))): 'E',
        ('elimination_final', frozenset(('F', 'G'))): 'F',
        ('semi_final', frozenset(('D', 'E'))): 'D',
        ('semi_final', frozenset(('C', 'F'))): 'C',
        ('preliminary_final', frozenset(('A', 'D'))): 'A',
        ('preliminary_final', frozenset(('B', 'C'))): 'B',
        ('grand_final', frozenset(('A', 'B'))): 'A'
    }

    finals_results = simulator.simulate_finals_series(top10, ratings, forced_results=forced)

    assert finals_results['J']['wildcard'] is True
    assert finals_results['I']['wildcard'] is True
    assert finals_results['J']['finals_week2'] is False
    assert finals_results['I']['finals_week2'] is False
    assert finals_results['H']['finals_week2'] is True
    assert finals_results['G']['finals_week2'] is True
    assert finals_results['J']['sf_plus'] is False
    assert finals_results['I']['sf_plus'] is False
    assert finals_results['E']['sf_plus'] is True
    assert finals_results['F']['sf_plus'] is True
    assert finals_results['A']['premiership'] is True


def test_get_final_ladder_uses_percentage_for_tiebreaks():
    """Ladder tiebreak should rank equal-point teams by percentage."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    records = {
        'A': {
            'wins': 12,
            'losses': 8,
            'draws': 0,
            'points_for': 1800,
            'points_against': 1700
        },
        'B': {
            'wins': 12,
            'losses': 8,
            'draws': 0,
            'points_for': 1900,
            'points_against': 1600
        }
    }

    ladder = simulator.get_final_ladder(records)

    assert ladder[0]['team'] == 'B'
    assert ladder[1]['team'] == 'A'


def test_completed_finals_constraints_lock_elimination_losers():
    """EF losers should be hard-locked out of SF+ and beyond."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_finals_matches = pd.DataFrame({
        'round_number': ['Elimination Final'],
        'home_team': ['Team A'],
        'away_team': ['Team B'],
        'hscore': [90],
        'ascore': [70]
    })

    constraints = simulator.build_completed_finals_constraints()
    tracker = {
        'Team A': {'sf_plus': False, 'prelim': False, 'grand_final': False, 'premiership': False},
        'Team B': {'sf_plus': True, 'prelim': True, 'grand_final': True, 'premiership': True}
    }

    updated = simulator.apply_completed_finals_constraints(tracker, constraints)

    assert updated['Team A']['sf_plus'] is True
    assert updated['Team B']['sf_plus'] is False
    assert updated['Team B']['prelim'] is False
    assert updated['Team B']['grand_final'] is False
    assert updated['Team B']['premiership'] is False


def test_completed_finals_constraints_lock_qf_winners_to_prelim():
    """QF winners should always be marked as prelim participants."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.completed_finals_matches = pd.DataFrame({
        'round_number': ['Qualifying Final'],
        'home_team': ['Team C'],
        'away_team': ['Team D'],
        'hscore': [80],
        'ascore': [60]
    })

    constraints = simulator.build_completed_finals_constraints()
    tracker = {
        'Team C': {'sf_plus': False, 'prelim': False, 'grand_final': False, 'premiership': False},
        'Team D': {'sf_plus': False, 'prelim': True, 'grand_final': False, 'premiership': False}
    }

    updated = simulator.apply_completed_finals_constraints(tracker, constraints)

    assert updated['Team C']['prelim'] is True
    assert updated['Team C']['sf_plus'] is True


def test_resolve_premiership_from_confirmed_grand_finalists():
    """When two finalists are locked and GF not complete, one premier must be set."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.base_rating = 1500

    tracker = {
        'Team A': {'sf_plus': True, 'prelim': True, 'grand_final': True, 'premiership': False},
        'Team B': {'sf_plus': True, 'prelim': True, 'grand_final': True, 'premiership': False},
        'Team C': {'sf_plus': True, 'prelim': True, 'grand_final': False, 'premiership': False}
    }
    constraints = {
        'Team A': {'require': {'grand_final'}, 'forbid': set()},
        'Team B': {'require': {'grand_final'}, 'forbid': set()},
        'Team C': {'require': {'prelim'}, 'forbid': {'grand_final'}}
    }

    updated = simulator.resolve_premiership_from_confirmed_grand_finalists(
        tracker,
        constraints,
        forced_results={},
        ratings={'Team A': 1600, 'Team B': 1400, 'Team C': 1500}
    )

    winners = [team for team, result in updated.items() if result['premiership']]
    assert len(winners) == 1
    assert winners[0] in {'Team A', 'Team B'}


def test_remaining_match_counts_include_wildcard_era_finals_slots():
    """2026+ remaining count should include regular + remaining finals slots."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.year = 2026
    simulator.upcoming_regular_matches = pd.DataFrame({'match_id': range(207)})
    simulator.completed_finals_matches = pd.DataFrame({
        'round_number': ['Wildcard Finals', 'Wildcard Finals']
    })

    counts = simulator.get_remaining_match_counts()

    assert counts['remaining_regular_matches'] == 207
    assert counts['remaining_finals_matches'] == 9
    assert counts['remaining_matches'] == 216


def test_remaining_match_counts_pre_2026_use_top8_finals_total():
    """Pre-2026 seasons should use 9 finals matches for summary totals."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.year = 2025
    simulator.upcoming_regular_matches = pd.DataFrame({'match_id': range(0)})
    simulator.completed_finals_matches = pd.DataFrame({
        'round_number': [
            'Qualifying Final',
            'Qualifying Final',
            'Elimination Final',
            'Elimination Final'
        ]
    })

    counts = simulator.get_remaining_match_counts()

    assert counts['remaining_regular_matches'] == 0
    assert counts['remaining_finals_matches'] == 5
    assert counts['remaining_matches'] == 5


def test_load_existing_round_snapshots_filters_invalid_entries_and_infers_round_order(tmp_path):
    """Snapshot loading should discard malformed rows and infer missing order metadata."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.year = 2026

    output_path = tmp_path / 'season_simulation_2026.json'
    output_path.write_text(json.dumps({
        'year': 2026,
        'round_snapshots': [
            {
                'round_key': 'round-1',
                'round_number': '1',
                'round_tab_label': 'R1',
                'round_label': 'Before Round 1',
                'results': [{'team': 'A'}]
            },
            {
                'round_key': 'season-complete',
                'round_order': 10000,
                'round_label': 'Season Complete',
                'results': [{'team': 'B'}]
            },
            {
                'round_key': 'round-bad-results',
                'results': 'invalid'
            },
            'not-a-dict'
        ]
    }), encoding='utf-8')

    snapshots = simulator.load_existing_round_snapshots(str(output_path))

    assert [snapshot['round_key'] for snapshot in snapshots] == ['round-1', 'season-complete']
    assert snapshots[0]['round_order'] == 1
    assert snapshots[1]['round_order'] == 10000


def test_save_results_merges_snapshots_prunes_stale_current_and_writes_json(tmp_path, monkeypatch):
    """Saving results should merge by round key and keep only the active current snapshot."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.year = 2026
    simulator.num_simulations = 50000
    simulator.model_mode = 'margin'
    simulator.win_model_path = None
    simulator.margin_model_path = 'data/models/margin/model.json'
    simulator.from_scratch = False
    simulator.snapshot_round_metadata = {
        'round_key': 'round-2-current',
        'round_label': 'Current Round 2',
        'round_tab_label': 'Current',
        'round_order': 2.5,
        'round_number': '2'
    }
    simulator.completed_matches = pd.DataFrame({'match_id': [1, 2]})
    simulator.get_remaining_match_counts = lambda: {
        'remaining_regular_matches': 4,
        'remaining_finals_matches': 9,
        'remaining_matches': 13
    }
    simulator.load_existing_round_snapshots = lambda output_path: [
        {
            'round_key': 'round-1',
            'round_label': 'Before Round 1',
            'round_tab_label': 'R1',
            'round_order': 1,
            'round_number': '1',
            'results': [{'team': 'A'}]
        },
        {
            'round_key': 'round-1-current',
            'round_label': 'Current Round 1',
            'round_tab_label': 'Current',
            'round_order': 1.5,
            'round_number': '1',
            'results': [{'team': 'A'}]
        }
    ]

    class FixedDateTime:
        @classmethod
        def now(cls):
            return cls()

        def isoformat(self):
            return '2026-04-04T12:00:00'

    monkeypatch.setattr(season_simulator_module, 'datetime', FixedDateTime)

    output_path = tmp_path / 'nested' / 'season_simulation_2026.json'
    results = [{'team': 'Sydney', 'premiership_probability': 0.2}]

    simulator.save_results(results, str(output_path))

    saved = json.loads(output_path.read_text(encoding='utf-8'))

    assert saved['year'] == 2026
    assert saved['current_round_key'] == 'round-2-current'
    assert saved['last_updated'] == '2026-04-04T12:00:00'
    assert saved['remaining_matches'] == 13
    assert [snapshot['round_key'] for snapshot in saved['round_snapshots']] == ['round-1', 'round-2-current']
    assert saved['round_snapshots'][1]['results'] == results


def test_run_backfill_round_snapshots_resets_existing_file_and_saves_each_context(tmp_path):
    """Backfill mode should delete the old file and save once per context."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    contexts = [
        {'round_metadata': {'round_label': 'Before Opening Round'}},
        {'round_metadata': {'round_label': 'Before Round 1'}},
    ]
    applied = []
    saved_results = []
    run_counter = {'count': 0}

    simulator.build_backfill_round_contexts = lambda: contexts
    simulator.apply_backfill_context = lambda context: applied.append(context['round_metadata']['round_label'])

    def fake_run_simulations():
        run_counter['count'] += 1
        return [{'team': f'Team {run_counter["count"]}'}]

    simulator.run_simulations = fake_run_simulations
    simulator.save_results = lambda results, output_path: saved_results.append((results, output_path))

    output_path = tmp_path / 'season_simulation_2026.json'
    output_path.write_text('old-data', encoding='utf-8')

    latest_results = simulator.run_backfill_round_snapshots(str(output_path))

    assert applied == ['Before Opening Round', 'Before Round 1']
    assert saved_results == [
        ([{'team': 'Team 1'}], str(output_path)),
        ([{'team': 'Team 2'}], str(output_path)),
    ]
    assert latest_results == [{'team': 'Team 2'}]
    assert not output_path.exists()


def test_run_backfill_round_snapshots_rejects_empty_contexts():
    """Backfill mode should fail fast when there is nothing to rebuild."""
    simulator = SeasonSimulator.__new__(SeasonSimulator)
    simulator.build_backfill_round_contexts = lambda: []

    with pytest.raises(ValueError, match='No round contexts available for backfill'):
        simulator.run_backfill_round_snapshots('unused.json')


def test_main_uses_default_output_path_for_standard_run(monkeypatch):
    """CLI main should use the standard default output path and save one run."""
    captured = {}

    class FakeSimulator:
        def __init__(self, model_path, db_path, year, num_simulations, from_scratch, win_model_path):
            captured['init'] = {
                'model_path': model_path,
                'db_path': db_path,
                'year': year,
                'num_simulations': num_simulations,
                'from_scratch': from_scratch,
                'win_model_path': win_model_path
            }

        def run_simulations(self):
            captured['ran'] = True
            return [{
                'team': 'Sydney',
                'projected_wins': 14.5,
                'finals_probability': 0.8,
                'top4_probability': 0.5,
                'premiership_probability': 0.2
            }]

        def save_results(self, results, output_path):
            captured['save'] = {
                'results': results,
                'output_path': output_path
            }

    monkeypatch.setattr(season_simulator_module, 'SeasonSimulator', FakeSimulator)
    monkeypatch.setattr(
        sys,
        'argv',
        ['season_simulator.py', '--year', '2026', '--model-path', 'margin-model.json']
    )

    season_simulator_module.main()

    assert captured['init'] == {
        'model_path': 'margin-model.json',
        'db_path': '../data/database/afl_predictions.db',
        'year': 2026,
        'num_simulations': 50000,
        'from_scratch': False,
        'win_model_path': None
    }
    assert captured['save']['output_path'] == '../data/simulations/season_simulation_2026.json'
    assert captured['save']['results'][0]['team'] == 'Sydney'


def test_main_uses_from_scratch_suffix_and_preserves_win_model_arg(monkeypatch):
    """CLI should choose the from-scratch suffix on the normal save path."""
    captured = {}

    class FakeSimulator:
        def __init__(self, model_path, db_path, year, num_simulations, from_scratch, win_model_path):
            captured['init'] = {
                'model_path': model_path,
                'db_path': db_path,
                'year': year,
                'num_simulations': num_simulations,
                'from_scratch': from_scratch,
                'win_model_path': win_model_path
            }

        def run_simulations(self):
            return [{
                'team': 'Carlton',
                'projected_wins': 13.0,
                'finals_probability': 0.7,
                'top4_probability': 0.3,
                'premiership_probability': 0.1
            }]

        def save_results(self, results, output_path):
            captured['save_output'] = output_path

    monkeypatch.setattr(season_simulator_module, 'SeasonSimulator', FakeSimulator)
    monkeypatch.setattr(
        sys,
        'argv',
        [
            'season_simulator.py',
            '--year', '2027',
            '--model-path', 'margin-model.json',
            '--win-model', 'win-model.json',
            '--from-scratch'
        ]
    )

    season_simulator_module.main()

    assert captured['init']['from_scratch'] is True
    assert captured['init']['win_model_path'] == 'win-model.json'
    assert captured['save_output'] == '../data/simulations/season_simulation_2027_from_scratch.json'


def test_main_rejects_incompatible_from_scratch_and_backfill_flags(monkeypatch):
    """CLI should reject mutually exclusive snapshot modes."""
    monkeypatch.setattr(
        sys,
        'argv',
        [
            'season_simulator.py',
            '--year', '2026',
            '--model-path', 'margin-model.json',
            '--from-scratch',
            '--backfill-round-snapshots'
        ]
    )

    with pytest.raises(ValueError, match='cannot be combined'):
        season_simulator_module.main()


def test_season_simulator_rejects_margin_model_as_win_model(tmp_path, afl_model_payloads):
    """Combined mode should reject a margin artifact passed as the win model."""
    wrong_win_model_path = tmp_path / 'wrong-win-model.json'
    margin_model_path = tmp_path / 'margin-model.json'
    wrong_win_model_path.write_text(json.dumps(afl_model_payloads['margin_model']), encoding='utf-8')
    margin_model_path.write_text(json.dumps(afl_model_payloads['margin_model']), encoding='utf-8')

    with pytest.raises(ValueError, match='Expected win ELO model'):
        SeasonSimulator(
            str(margin_model_path),
            db_path='unused.db',
            year=2026,
            num_simulations=100,
            win_model_path=str(wrong_win_model_path),
        )


def test_season_simulator_rejects_non_margin_model_in_margin_only_mode(tmp_path, afl_model_payloads):
    """Margin-only mode should reject non-margin artifacts before loading matches."""
    win_model_path = tmp_path / 'win-model.json'
    win_model_path.write_text(json.dumps(afl_model_payloads['win_model']), encoding='utf-8')

    with pytest.raises(ValueError, match='requires a margin ELO model'):
        SeasonSimulator(
            str(win_model_path),
            db_path='unused.db',
            year=2026,
            num_simulations=100,
        )
