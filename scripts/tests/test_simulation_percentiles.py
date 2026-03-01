#!/usr/bin/env python3
"""
Unit tests for the percentile interpolation helper used in the season simulator.
These tests ensure we retain fractional win intervals instead of snapping to
whole numbers when summarising Monte Carlo outcomes.
"""

import os
import sys

import numpy as np
import pandas as pd

# Add parent directory so we can import season_simulator module
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(CURRENT_DIR, '..'))

from season_simulator import (  # noqa: E402
    SeasonSimulator,
    build_post_season_snapshot_metadata,
    build_round_snapshot_metadata,
    interpolate_percentile,
    is_finals_round,
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


def test_interpolation_handles_single_value_distribution():
    """If every simulation yields the same total, the percentile should match it."""
    wins = np.array([14] * 1000)

    assert interpolate_percentile(wins, 10) == 14
    assert interpolate_percentile(wins, 90) == 14


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
