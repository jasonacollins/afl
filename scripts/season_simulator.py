#!/usr/bin/env python3
"""
AFL Season Simulator

Monte Carlo simulation of AFL seasons using ELO margin model predictions.
Simulates remaining fixtures and tracks finals outcomes including:
- Finals qualification (Top 8 or Top 10, season-dependent)
- Top 4 finish
- Preliminary finals appearance
- Grand Final appearance
- Premiership wins
"""

import pandas as pd
import numpy as np
import argparse
import json
import os
import re
import tempfile
from datetime import datetime
from collections import defaultdict

# Import core modules
from core.data_io import load_model, fetch_matches_for_prediction
from core.elo_core import MarginEloModel


def interpolate_percentile(values, percentile):
    """
    Estimate a percentile for discrete win totals by linearly interpolating
    between neighbouring win counts. This avoids snapping all percentile
    estimates to whole numbers while keeping the result within the attainable
    win range.
    """
    array = np.asarray(values, dtype=float)
    if array.size == 0:
        return float('nan')
    if array.size == 1:
        return float(array[0])

    unique_values, counts = np.unique(array, return_counts=True)
    probabilities = counts / counts.sum()
    cumulative = np.cumsum(probabilities)
    cumulative_prev = np.concatenate(([0.0], cumulative[:-1]))

    q = percentile / 100.0
    idx = np.searchsorted(cumulative, q, side='left')
    if idx >= len(unique_values):
        idx = len(unique_values) - 1

    prob = probabilities[idx]
    current_value = unique_values[idx]
    if prob == 0:
        return float(current_value)

    fraction = (q - cumulative_prev[idx]) / prob
    fraction = max(0.0, min(1.0, fraction))

    # Interpolate towards the next value when available; otherwise move back
    # towards the previous value (upper tail).
    if idx < len(unique_values) - 1:
        next_value = unique_values[idx + 1]
        interpolated = current_value + fraction * (next_value - current_value)
    elif idx > 0:
        prev_value = unique_values[idx - 1]
        interpolated = prev_value + fraction * (current_value - prev_value)
    else:
        interpolated = current_value

    return float(interpolated)


FINALS_ROUND_METADATA = {
    'wildcard_round': {
        'label': 'Wildcard Finals',
        'tab_label': 'WC',
        'order': 200
    },
    'qualifying_final': {
        'label': 'Qualifying Final',
        'tab_label': 'QF',
        'order': 201
    },
    'elimination_final': {
        'label': 'Elimination Final',
        'tab_label': 'EF',
        'order': 202
    },
    'semi_final': {
        'label': 'Semi Final',
        'tab_label': 'SF',
        'order': 203
    },
    'preliminary_final': {
        'label': 'Preliminary Final',
        'tab_label': 'PF',
        'order': 204
    },
    'grand_final': {
        'label': 'Grand Final',
        'tab_label': 'GF',
        'order': 205
    }
}

FINALS_ROUND_ALIASES = {
    'wildcard round': 'wildcard_round',
    'wild card round': 'wildcard_round',
    'wildcard finals': 'wildcard_round',
    'wild card finals': 'wildcard_round',
    'wildcard': 'wildcard_round',
    'wc': 'wildcard_round',
    'wr': 'wildcard_round',
    'qualifying final': 'qualifying_final',
    'qualifying finals': 'qualifying_final',
    'qf': 'qualifying_final',
    'elimination final': 'elimination_final',
    'elimination finals': 'elimination_final',
    'ef': 'elimination_final',
    'semi final': 'semi_final',
    'semi finals': 'semi_final',
    'sf': 'semi_final',
    'preliminary final': 'preliminary_final',
    'preliminary finals': 'preliminary_final',
    'pf': 'preliminary_final',
    'grand final': 'grand_final',
    'grand finals': 'grand_final',
    'gf': 'grand_final'
}


def _slugify_text(value):
    """Generate a stable slug used for snapshot keys."""
    cleaned = re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
    return cleaned or 'unknown'


def normalize_round_text(round_number):
    """Normalize round labels for stable finals/regular season parsing."""
    if round_number is None or pd.isna(round_number):
        return ''

    normalized = str(round_number).strip().lower()
    normalized = normalized.replace('.', ' ')
    normalized = normalized.replace('-', ' ')
    normalized = re.sub(r'\s+', ' ', normalized)
    return normalized


def resolve_finals_round_key(round_number):
    """Map round labels to canonical finals keys, or None for regular rounds."""
    normalized = normalize_round_text(round_number)
    if not normalized:
        return None

    return FINALS_ROUND_ALIASES.get(normalized)


def is_finals_round(round_number):
    """Return True when a round label maps to a finals round."""
    return resolve_finals_round_key(round_number) is not None


def build_round_snapshot_metadata(round_number):
    """
    Convert raw round values into stable snapshot metadata for storage/UI tabs.
    """
    if round_number is None or pd.isna(round_number):
        return {
            'round_key': 'round-unknown',
            'round_label': 'Current Snapshot',
            'round_tab_label': 'Current',
            'round_order': 9000,
            'round_number': None
        }

    raw = str(round_number).strip()
    if not raw:
        return {
            'round_key': 'round-unknown',
            'round_label': 'Current Snapshot',
            'round_tab_label': 'Current',
            'round_order': 9000,
            'round_number': None
        }

    if raw.upper() == 'OR':
        return {
            'round_key': 'round-or',
            'round_label': 'Before Opening Round',
            'round_tab_label': 'OR',
            'round_order': 0,
            'round_number': 'OR'
        }

    numeric_match = re.match(r'^(?:R(?:OUND)?)?\s*(\d+)$', raw, flags=re.IGNORECASE)
    if numeric_match:
        round_value = int(numeric_match.group(1))
        return {
            'round_key': f'round-{round_value}',
            'round_label': f'Before Round {round_value}',
            'round_tab_label': f'R{round_value}',
            'round_order': round_value,
            'round_number': str(round_value)
        }

    normalized_name = normalize_round_text(raw)
    finals_key = resolve_finals_round_key(normalized_name)
    if finals_key:
        finals_meta = FINALS_ROUND_METADATA[finals_key]
        return {
            'round_key': f'finals-{finals_key}',
            'round_label': f"Before {finals_meta['label']}",
            'round_tab_label': finals_meta['tab_label'],
            'round_order': finals_meta['order'],
            'round_number': finals_meta['label']
        }

    title = ' '.join(token.capitalize() for token in normalized_name.split())
    return {
        'round_key': f'round-{_slugify_text(normalized_name)}',
        'round_label': f'Before {title}',
        'round_tab_label': title,
        'round_order': 3000,
        'round_number': title
    }


def build_post_season_snapshot_metadata():
    """Snapshot metadata used when there are no remaining fixtures."""
    return {
        'round_key': 'season-complete',
        'round_label': 'Season Complete',
        'round_tab_label': 'Post',
        'round_order': 10000,
        'round_number': 'Season Complete'
    }


def strip_current_snapshot_suffix(round_key):
    """Normalize a snapshot key back to its base round key."""
    key = str(round_key or '')
    return key[:-8] if key.endswith('-current') else key


def build_current_round_snapshot_metadata(round_number):
    """
    Build metadata for an in-progress round "current" snapshot.
    Keeps the base round key stable for historical before-round tabs.
    """
    base_metadata = build_round_snapshot_metadata(round_number)
    base_round_key = strip_current_snapshot_suffix(base_metadata['round_key'])
    round_number_value = base_metadata.get('round_number')

    if round_number_value == 'OR':
        current_label = 'Current Opening Round'
    elif base_round_key.startswith('finals-'):
        current_label = base_metadata['round_label'].replace('Before ', 'Current ')
    elif round_number_value is not None:
        current_label = f"Current Round {round_number_value}"
    else:
        current_label = 'Current Snapshot'

    return {
        **base_metadata,
        'round_key': f'{base_round_key}-current',
        'round_label': current_label,
        'round_tab_label': 'Current',
        # Keep current snapshots after their before-round counterpart.
        'round_order': float(base_metadata.get('round_order', 9000)) + 0.5
    }


def prune_stale_current_snapshots(snapshots, active_round_key):
    """
    Remove outdated "-current" snapshots once a round has completed.
    Keep only the active current snapshot when the active key is current.
    """
    active_key = str(active_round_key or '')
    keep_current_key = active_key if active_key.endswith('-current') else None

    pruned = []
    for snapshot in snapshots:
        round_key = str(snapshot.get('round_key') or '')
        if round_key.endswith('-current') and round_key != keep_current_key:
            continue
        pruned.append(snapshot)

    return pruned


class SeasonSimulator:
    """
    Simulates AFL season outcomes using Monte Carlo methods
    """

    def __init__(
        self,
        model_path,
        db_path,
        year,
        num_simulations=50000,
        from_scratch=False,
        win_model_path=None,
        margin_model_path=None
    ):
        """
        Initialize the season simulator

        Parameters:
        -----------
        model_path : str
            Path to the trained margin ELO model
        db_path : str
            Path to the database
        year : int
            Year to simulate
        num_simulations : int
            Number of Monte Carlo simulations to run
        from_scratch : bool
            If True, simulate entire season ignoring actual results
        win_model_path : str, optional
            Path to trained win ELO model. When provided, simulator runs in
            combined mode (win probabilities from win model, margin rating
            updates from margin model) to mirror Dad's AI.
        margin_model_path : str, optional
            Explicit margin model path. Falls back to model_path.
        """
        self.year = year
        self.num_simulations = num_simulations
        self.db_path = db_path
        self.from_scratch = from_scratch
        self.win_model_path = win_model_path
        self.margin_model_path = margin_model_path or model_path
        self.combined_mode = bool(win_model_path)

        if self.combined_mode:
            print(f"Loading win ELO model from {self.win_model_path}...")
            win_model_data = load_model(self.win_model_path)
            if win_model_data.get('model_type') == 'margin_only_elo':
                raise ValueError("Expected win ELO model for --win-model")

            print(f"Loading margin ELO model from {self.margin_model_path}...")
            margin_model_data = load_model(self.margin_model_path)
            if margin_model_data.get('model_type') not in ['margin_only_elo', 'margin_elo']:
                raise ValueError("Combined mode requires a margin ELO model")

            self.win_params = win_model_data['parameters']
            self.margin_params = margin_model_data['parameters']

            self.base_rating = self.win_params['base_rating']
            self.home_advantage = self.win_params['home_advantage']
            self.max_margin = self.win_params['max_margin']
            self.season_carryover = self.win_params['season_carryover']
            self.margin_season_carryover = self.margin_params['season_carryover']
            self.win_k_factor = self.win_params['k_factor']
            self.margin_k_factor = self.margin_params['k_factor']
            self.margin_factor = self.win_params.get('margin_factor', 0)
            self.margin_scale = self.margin_params['margin_scale']
            self.scaling_factor = self.margin_params['scaling_factor']
            self.k_factor = self.win_k_factor

            self.initial_ratings, self.yearly_ratings = self.prepare_start_of_year_ratings(
                win_model_data,
                self.season_carryover,
                'win'
            )
            self.margin_ratings, self.margin_yearly_ratings = self.prepare_start_of_year_ratings(
                margin_model_data,
                self.margin_season_carryover,
                'margin'
            )
            self.model_mode = 'combined'
            self.elo_source_label = 'win_elo'
        else:
            # Backward-compatible path: margin-only simulation model
            print(f"Loading margin ELO model from {self.margin_model_path}...")
            model_data = load_model(self.margin_model_path)

            if model_data.get('model_type') not in ['margin_only_elo', 'margin_elo']:
                raise ValueError("This simulator requires a margin ELO model")

            self.margin_params = model_data['parameters']
            self.win_params = None

            self.base_rating = self.margin_params['base_rating']
            self.home_advantage = self.margin_params['home_advantage']
            self.max_margin = self.margin_params['max_margin']
            self.season_carryover = self.margin_params['season_carryover']
            self.margin_season_carryover = self.margin_params['season_carryover']
            self.win_k_factor = self.margin_params['k_factor']
            self.margin_k_factor = self.margin_params['k_factor']
            self.k_factor = self.margin_params['k_factor']
            self.margin_factor = 0
            self.margin_scale = self.margin_params['margin_scale']
            self.scaling_factor = self.margin_params['scaling_factor']

            self.initial_ratings, self.yearly_ratings = self.prepare_start_of_year_ratings(
                model_data,
                self.season_carryover,
                'margin'
            )
            self.margin_yearly_ratings = self.yearly_ratings
            self.margin_ratings = None
            self.model_mode = 'margin_only'
            self.elo_source_label = 'margin_elo'

        # Base ratings before applying any in-season completed results
        self.base_initial_ratings = self.initial_ratings.copy()
        self.base_margin_ratings = self.margin_ratings.copy() if self.margin_ratings is not None else None

        if from_scratch:
            print(f"\nFrom-scratch mode: Simulating entire {year} season from beginning")

        if self.combined_mode:
            print(
                "Combined simulation mode enabled "
                "(win probabilities from win model, margin updates from margin model)"
            )

        print(f"Model loaded successfully with {len(self.initial_ratings)} teams")

        # Load matches
        self.load_matches()

    def prepare_start_of_year_ratings(self, model_data, season_carryover, model_label):
        """
        Prepare start-of-season ratings from model metadata and carryover settings.
        """
        yearly_ratings = model_data.get('yearly_ratings', {})
        ratings = model_data['team_ratings'].copy()

        prev_year_key = str(self.year - 1)
        needs_carryover = False

        if prev_year_key in yearly_ratings:
            print(f"Using end-of-{self.year - 1} {model_label} ratings from yearly_ratings")
            ratings = yearly_ratings[prev_year_key].copy()
            needs_carryover = True
        elif self.year > 2020:
            print(f"Using {model_label} model team_ratings as end-of-{self.year - 1} ratings")
            print(f"({model_label.capitalize()} model trained through {self.year - 1})")
            needs_carryover = True

        if needs_carryover:
            print(
                f"Applying {model_label} season carryover ({season_carryover}) "
                f"to get start-of-{self.year} ratings"
            )
            for team in ratings:
                old_rating = ratings[team]
                ratings[team] = (
                    self.base_rating +
                    season_carryover * (old_rating - self.base_rating)
                )

        return ratings, yearly_ratings

    def load_matches(self):
        """Load matches for the specified year"""
        print(f"Loading matches for {self.year}...")

        # Fetch all matches for the year
        all_matches = fetch_matches_for_prediction(self.db_path, self.year)
        all_matches = all_matches[all_matches['year'] == self.year].copy()
        all_matches = self.sort_matches_for_progression(all_matches)
        self.all_matches = all_matches.reset_index(drop=True)

        if self.from_scratch:
            # Treat all matches as upcoming, ignore actual results
            print("From-scratch mode: Ignoring all actual match results")
            self.completed_mask = pd.Series(False, index=self.all_matches.index, dtype=bool)
            self.apply_snapshot_state(
                self.all_matches.iloc[0:0].copy(),
                self.all_matches.copy()
            )

            print(f"Total matches to simulate: {len(self.upcoming_matches)}")
            return

        self.completed_mask = self.build_completed_mask(self.all_matches)
        current_completed = self.all_matches[self.completed_mask].copy()
        current_upcoming = self.all_matches[~self.completed_mask].copy()

        print(f"Found {len(current_completed)} completed matches")
        print(f"Found {len(current_upcoming)} upcoming matches to simulate")

        # Check if there are any matches to simulate
        if len(current_upcoming) == 0:
            print("\n" + "="*80)
            print("WARNING: No upcoming matches found for this year!")
            print("="*80)
            print("This means all matches for the season are already complete.")
            print("The simulation will only model finals outcomes based on")
            print("the current final ladder positions (no variation).")
            print("\nTIP: Use --from-scratch flag to simulate the completed season")
            print("     as if it hasn't been played yet.")
            print("="*80 + "\n")

        self.apply_snapshot_state(current_completed, current_upcoming)

    def sort_matches_for_progression(self, matches):
        """Sort matches in deterministic chronological order for replay/backfill."""
        sorted_matches = matches.copy()

        sort_columns = ['match_date']
        if 'match_number' in sorted_matches.columns:
            sorted_matches['_sort_match_number'] = pd.to_numeric(
                sorted_matches['match_number'],
                errors='coerce'
            ).fillna(999999)
            sort_columns.append('_sort_match_number')
        if 'match_id' in sorted_matches.columns:
            sort_columns.append('match_id')

        sorted_matches = sorted_matches.sort_values(sort_columns, na_position='last')

        if '_sort_match_number' in sorted_matches.columns:
            sorted_matches = sorted_matches.drop(columns=['_sort_match_number'])

        return sorted_matches

    def build_completed_mask(self, matches):
        """Build completed mask using completion flag + score safeguards."""
        if 'complete' in matches.columns:
            completion = pd.to_numeric(matches['complete'], errors='coerce')
        else:
            completion = pd.Series(np.nan, index=matches.index, dtype=float)

        matches['complete'] = completion

        # Scores are considered reliable only when both teams have recorded non-null values
        scores_recorded = (~matches['hscore'].isna()) & (~matches['ascore'].isna())
        # Treat 0-0 scores as placeholders for unplayed matches unless the game is explicitly complete
        zero_score_placeholder = (
            (matches['hscore'] == 0) &
            (matches['ascore'] == 0) &
            ((completion < 100) | (completion.isna()))
        )
        scores_recorded = scores_recorded & (~zero_score_placeholder)

        completed_mask = (
            (completion >= 100) |
            (completion.isna() & scores_recorded)
        )

        return completed_mask.fillna(False)

    def apply_snapshot_state(self, completed_matches, upcoming_matches, snapshot_metadata=None):
        """
        Apply completed/upcoming split, then rebuild records and ratings for simulation.
        """
        self.completed_matches = completed_matches.copy()
        self.upcoming_matches = upcoming_matches.copy()
        (
            self.completed_regular_matches,
            self.completed_finals_matches
        ) = self.split_regular_and_finals_matches(self.completed_matches)
        (
            self.upcoming_regular_matches,
            self.upcoming_finals_matches
        ) = self.split_regular_and_finals_matches(self.upcoming_matches)
        self.initial_ratings = self.base_initial_ratings.copy()
        if self.combined_mode and self.base_margin_ratings is not None:
            self.margin_ratings = self.base_margin_ratings.copy()

        self.calculate_current_standings()

        # Update ratings based on completed matches (only if not from-scratch)
        if not self.from_scratch and len(self.completed_matches) > 0:
            self.update_ratings_from_completed_matches()

        # Snapshot metadata drives round tabs in the simulation UI
        self.snapshot_round_metadata = snapshot_metadata or self.determine_snapshot_round_metadata()
        print(
            "Snapshot round context: "
            f"{self.snapshot_round_metadata['round_label']} "
            f"({self.snapshot_round_metadata['round_key']})"
        )

    def determine_snapshot_round_metadata(self):
        """Determine snapshot context, including dedicated in-progress current tabs."""
        if len(self.upcoming_matches) > 0:
            sorted_upcoming = self.upcoming_matches.sort_values('match_date')
            next_round = sorted_upcoming.iloc[0].get('round_number')
            next_round_metadata = build_round_snapshot_metadata(next_round)
            next_round_key = strip_current_snapshot_suffix(next_round_metadata['round_key'])

            if len(self.completed_matches) > 0 and 'round_number' in self.completed_matches.columns:
                completed_round_keys = self.completed_matches['round_number'].apply(
                    lambda value: strip_current_snapshot_suffix(
                        build_round_snapshot_metadata(value)['round_key']
                    )
                )
                if (completed_round_keys == next_round_key).any():
                    return build_current_round_snapshot_metadata(next_round)

            return next_round_metadata

        if len(self.completed_matches) > 0:
            return build_post_season_snapshot_metadata()

        return build_round_snapshot_metadata('OR')

    def build_backfill_round_contexts(self):
        """
        Build chronological snapshot contexts up to the current round state.
        """
        contexts = []
        seen_round_keys = set()

        for _, match in self.all_matches.iterrows():
            metadata = build_round_snapshot_metadata(match.get('round_number'))
            round_key = metadata['round_key']

            if round_key in seen_round_keys:
                continue

            seen_round_keys.add(round_key)
            contexts.append({
                'round_key': round_key,
                'round_metadata': metadata,
                'cutoff_match_date': match.get('match_date')
            })

        current_round_key = self.snapshot_round_metadata['round_key']
        target_round_key = strip_current_snapshot_suffix(current_round_key)
        if current_round_key == 'season-complete':
            contexts.append({
                'round_key': 'season-complete',
                'round_metadata': build_post_season_snapshot_metadata(),
                'cutoff_match_date': None
            })
            return contexts

        capped_contexts = []
        for context in contexts:
            capped_contexts.append(context)
            if context['round_key'] == target_round_key:
                break

        return capped_contexts

    def apply_backfill_context(self, context):
        """
        Rewind completed/upcoming split to the start of a round for backfill.
        """
        cutoff_match_date = context.get('cutoff_match_date')

        if cutoff_match_date is None:
            historical_completed_mask = self.completed_mask.copy()
        else:
            historical_completed_mask = (
                self.completed_mask &
                self.all_matches['match_date'].notna() &
                (self.all_matches['match_date'] < cutoff_match_date)
            )

        completed_matches = self.all_matches[historical_completed_mask].copy()
        upcoming_matches = self.all_matches[~historical_completed_mask].copy()

        self.apply_snapshot_state(
            completed_matches,
            upcoming_matches,
            snapshot_metadata=context['round_metadata']
        )

    def split_regular_and_finals_matches(self, matches):
        """
        Split a match set into regular-season and finals fixtures.
        """
        if not isinstance(matches, pd.DataFrame):
            empty = pd.DataFrame()
            return empty, empty

        if len(matches) == 0:
            empty = matches.iloc[0:0].copy()
            return empty, empty

        if 'round_number' not in matches.columns:
            return matches.copy(), matches.iloc[0:0].copy()

        finals_mask = matches['round_number'].apply(is_finals_round)
        regular_matches = matches[~finals_mask].copy()
        finals_matches = matches[finals_mask].copy()
        return regular_matches, finals_matches

    def build_completed_finals_lookup(self):
        """
        Build lookup of completed finals outcomes keyed by round + team pairing.
        """
        lookup = {}
        if len(self.completed_finals_matches) == 0:
            return lookup

        for _, match in self.completed_finals_matches.iterrows():
            finals_key = resolve_finals_round_key(match.get('round_number'))
            if not finals_key:
                continue

            home_team = match.get('home_team')
            away_team = match.get('away_team')
            hscore = match.get('hscore')
            ascore = match.get('ascore')

            if not home_team or not away_team:
                continue
            if pd.isna(hscore) or pd.isna(ascore) or hscore == ascore:
                continue

            winner = home_team if hscore > ascore else away_team
            lookup[(finals_key, frozenset((home_team, away_team)))] = winner

        return lookup

    def build_completed_finals_constraints(self):
        """
        Build progression constraints from already completed finals results.
        These constraints are applied to every simulation so earlier finals
        winners/losers are respected in later-round probabilities.
        """
        constraints = {}

        if len(self.completed_finals_matches) == 0:
            return constraints

        def ensure_team(team):
            if team not in constraints:
                constraints[team] = {
                    'require': set(),
                    'forbid': set()
                }
            return constraints[team]

        for _, match in self.completed_finals_matches.iterrows():
            finals_key = resolve_finals_round_key(match.get('round_number'))
            if not finals_key:
                continue

            home_team = match.get('home_team')
            away_team = match.get('away_team')
            hscore = match.get('hscore')
            ascore = match.get('ascore')

            if not home_team or not away_team:
                continue
            if pd.isna(hscore) or pd.isna(ascore) or hscore == ascore:
                continue

            winner = home_team if hscore > ascore else away_team
            loser = away_team if winner == home_team else home_team

            winner_rules = ensure_team(winner)
            loser_rules = ensure_team(loser)

            if finals_key == 'wildcard_round':
                winner_rules['require'].add('wildcard')
                winner_rules['require'].add('finals_week2')
                loser_rules['require'].add('wildcard')
                loser_rules['forbid'].add('finals_week2')
                loser_rules['forbid'].add('sf_plus')
            elif finals_key == 'qualifying_final':
                winner_rules['require'].add('finals_week2')
                loser_rules['require'].add('finals_week2')
                winner_rules['require'].add('prelim')
                loser_rules['require'].add('sf_plus')
            elif finals_key == 'elimination_final':
                winner_rules['require'].add('finals_week2')
                loser_rules['require'].add('finals_week2')
                winner_rules['require'].add('sf_plus')
                loser_rules['forbid'].add('sf_plus')
            elif finals_key == 'semi_final':
                winner_rules['require'].add('finals_week2')
                loser_rules['require'].add('finals_week2')
                winner_rules['require'].add('prelim')
                loser_rules['require'].add('sf_plus')
                loser_rules['forbid'].add('prelim')
            elif finals_key == 'preliminary_final':
                winner_rules['require'].add('finals_week2')
                loser_rules['require'].add('finals_week2')
                winner_rules['require'].add('grand_final')
                loser_rules['require'].add('prelim')
                loser_rules['forbid'].add('grand_final')
            elif finals_key == 'grand_final':
                winner_rules['require'].add('finals_week2')
                loser_rules['require'].add('finals_week2')
                winner_rules['require'].add('premiership')
                loser_rules['require'].add('grand_final')
                loser_rules['forbid'].add('premiership')

        return constraints

    def apply_completed_finals_constraints(self, finals_tracker, constraints):
        """Apply completed-finals constraints to simulated finals outcomes."""
        if not constraints:
            return finals_tracker

        for team, rule_set in constraints.items():
            if team not in finals_tracker:
                continue

            team_tracker = finals_tracker[team]
            required = rule_set.get('require', set())
            forbidden = rule_set.get('forbid', set())

            if 'wildcard' in required:
                team_tracker['wildcard'] = True
            if 'finals_week2' in required:
                team_tracker['finals_week2'] = True

            if 'premiership' in required:
                team_tracker['premiership'] = True
                team_tracker['grand_final'] = True
                team_tracker['prelim'] = True
                team_tracker['sf_plus'] = True
                team_tracker['finals_week2'] = True
            elif 'grand_final' in required:
                team_tracker['grand_final'] = True
                team_tracker['prelim'] = True
                team_tracker['sf_plus'] = True
                team_tracker['finals_week2'] = True
            elif 'prelim' in required:
                team_tracker['prelim'] = True
                team_tracker['sf_plus'] = True
                team_tracker['finals_week2'] = True
            elif 'sf_plus' in required:
                team_tracker['sf_plus'] = True
                team_tracker['finals_week2'] = True

            if 'wildcard' in forbidden:
                team_tracker['wildcard'] = False
            if 'finals_week2' in forbidden:
                team_tracker['finals_week2'] = False
                team_tracker['sf_plus'] = False
                team_tracker['prelim'] = False
                team_tracker['grand_final'] = False
                team_tracker['premiership'] = False
            if 'sf_plus' in forbidden:
                team_tracker['sf_plus'] = False
                team_tracker['prelim'] = False
                team_tracker['grand_final'] = False
                team_tracker['premiership'] = False
            if 'prelim' in forbidden:
                team_tracker['prelim'] = False
                team_tracker['grand_final'] = False
                team_tracker['premiership'] = False
            if 'grand_final' in forbidden:
                team_tracker['grand_final'] = False
                team_tracker['premiership'] = False
            if 'premiership' in forbidden:
                team_tracker['premiership'] = False

        return finals_tracker

    def resolve_premiership_from_confirmed_grand_finalists(
        self,
        finals_tracker,
        constraints,
        forced_results,
        ratings
    ):
        """
        Ensure exactly one premiership winner when grand finalists are known
        but the grand final result itself is not yet completed.
        """
        if not constraints:
            return finals_tracker

        # If the Grand Final is already completed, constraints already lock winner.
        grand_final_completed = any(
            'premiership' in rule_set.get('require', set())
            for rule_set in constraints.values()
        )
        if grand_final_completed:
            return finals_tracker

        finalists = [
            team for team, outcome in finals_tracker.items()
            if outcome.get('grand_final')
        ]
        if len(finalists) != 2:
            return finals_tracker

        team1, team2 = finalists
        forced_winner = forced_results.get(('grand_final', frozenset((team1, team2))))
        if forced_winner not in (team1, team2):
            forced_winner = self.simulate_finals_match(team1, team2, ratings)

        for outcome in finals_tracker.values():
            outcome['premiership'] = False
        finals_tracker[forced_winner]['premiership'] = True

        return finals_tracker

    def run_backfill_round_snapshots(self, output_path):
        """
        Generate snapshot history for each round up to the current round state.
        """
        contexts = self.build_backfill_round_contexts()

        if not contexts:
            raise ValueError('No round contexts available for backfill')

        abs_output_path = os.path.abspath(output_path)
        if os.path.exists(abs_output_path):
            print(f"Resetting existing simulation file before backfill: {abs_output_path}")
            os.remove(abs_output_path)

        print(f"\nBackfilling {len(contexts)} round snapshots...")
        latest_results = None

        for index, context in enumerate(contexts, start=1):
            round_label = context['round_metadata']['round_label']
            print(f"\n[{index}/{len(contexts)}] {round_label}")

            self.apply_backfill_context(context)
            latest_results = self.run_simulations()
            self.save_results(latest_results, output_path)

        print("\nBackfill complete!")
        return latest_results

    def load_existing_round_snapshots(self, output_path):
        """Load previously saved round snapshots for this season, if any."""
        if not os.path.exists(output_path):
            return []

        try:
            with open(output_path, 'r') as file_handle:
                existing_data = json.load(file_handle)
        except (OSError, json.JSONDecodeError) as error:
            print(f"WARNING: Failed to read existing simulation file: {error}")
            return []

        if not isinstance(existing_data, dict):
            return []

        existing_year = existing_data.get('year')
        if existing_year is not None:
            try:
                if int(existing_year) != int(self.year):
                    return []
            except (TypeError, ValueError):
                return []

        snapshots = existing_data.get('round_snapshots')
        if not isinstance(snapshots, list):
            return []

        valid_snapshots = []
        for snapshot in snapshots:
            if not isinstance(snapshot, dict):
                continue

            round_key = snapshot.get('round_key')
            if not round_key:
                continue

            if not isinstance(snapshot.get('results'), list):
                continue

            if snapshot.get('round_order') is None:
                inferred_meta = build_round_snapshot_metadata(
                    snapshot.get('round_number') or
                    snapshot.get('round_tab_label') or
                    snapshot.get('round_label')
                )
                snapshot['round_order'] = inferred_meta['round_order']

            valid_snapshots.append(snapshot)

        return valid_snapshots

    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts (from margin model)"""
        return min(abs(margin), self.max_margin) * np.sign(margin)

    def update_ratings_from_completed_matches(self):
        """
        Update ELO ratings based on completed matches in the current season.
        In combined mode this mirrors Dad's AI:
        - Win model drives probabilities and win-rating updates
        - Margin model updates from margin error
        """
        print(f"\nUpdating ratings from {len(self.completed_matches)} completed matches...")

        # Sort matches by date to update in chronological order
        sorted_matches = self.completed_matches.sort_values('match_date')

        win_rating_changes = []
        margin_rating_changes = []

        for _, match in sorted_matches.iterrows():
            home_team = match['home_team']
            away_team = match['away_team']
            hscore = match['hscore']
            ascore = match['ascore']

            # Calculate actual margin
            actual_margin = hscore - ascore
            capped_margin = self._cap_margin(actual_margin)

            # Win ratings (simulation ratings) are always in initial_ratings
            win_home_rating = self.initial_ratings.get(home_team, self.base_rating)
            win_away_rating = self.initial_ratings.get(away_team, self.base_rating)

            if self.combined_mode:
                margin_home_rating = self.margin_ratings.get(home_team, self.base_rating)
                margin_away_rating = self.margin_ratings.get(away_team, self.base_rating)

                # Combined model win probability from win ELO ratings
                win_rating_diff = (win_home_rating + self.home_advantage) - win_away_rating
                home_win_prob = 1.0 / (1.0 + 10 ** (-win_rating_diff / 400))

                actual_result = 1.0 if hscore > ascore else 0.0
                if hscore == ascore:
                    actual_result = 0.5

                margin_multiplier = 1.0
                if self.margin_factor > 0:
                    denominator = np.log1p(self.max_margin * self.margin_factor)
                    if denominator > 0:
                        margin_multiplier = (
                            np.log1p(abs(capped_margin) * self.margin_factor) / denominator
                        )

                win_rating_change = (
                    self.win_k_factor * margin_multiplier * (actual_result - home_win_prob)
                )
                self.initial_ratings[home_team] = win_home_rating + win_rating_change
                self.initial_ratings[away_team] = win_away_rating - win_rating_change
                win_rating_changes.append(abs(win_rating_change))

                margin_rating_diff = (margin_home_rating + self.home_advantage) - margin_away_rating
                predicted_margin = margin_rating_diff * self.margin_scale
                margin_error = predicted_margin - actual_margin
                margin_rating_change = (
                    -self.margin_k_factor * margin_error / self.scaling_factor
                )
                self.margin_ratings[home_team] = margin_home_rating + margin_rating_change
                self.margin_ratings[away_team] = margin_away_rating - margin_rating_change
                margin_rating_changes.append(abs(margin_rating_change))
                continue

            # Margin-only mode: ratings update from margin error
            win_rating_diff = (win_home_rating + self.home_advantage) - win_away_rating
            predicted_margin = win_rating_diff * self.margin_scale
            margin_error = predicted_margin - actual_margin
            rating_change = -self.margin_k_factor * margin_error / self.scaling_factor

            self.initial_ratings[home_team] = win_home_rating + rating_change
            self.initial_ratings[away_team] = win_away_rating - rating_change
            margin_rating_changes.append(abs(rating_change))

        print(f"Ratings updated through completed matches")
        if self.combined_mode:
            avg_win_change = np.mean(win_rating_changes) if win_rating_changes else 0
            max_win_change = np.max(win_rating_changes) if win_rating_changes else 0
            avg_margin_change = np.mean(margin_rating_changes) if margin_rating_changes else 0
            max_margin_change = np.max(margin_rating_changes) if margin_rating_changes else 0
            print(f"  Win rating avg/max change: {avg_win_change:.1f}/{max_win_change:.1f}")
            print(f"  Margin rating avg/max change: {avg_margin_change:.1f}/{max_margin_change:.1f}")
            return

        avg_change = np.mean(margin_rating_changes) if margin_rating_changes else 0
        max_change = np.max(margin_rating_changes) if margin_rating_changes else 0
        print(f"  Average rating change: {avg_change:.1f} points")
        print(f"  Maximum rating change: {max_change:.1f} points")

    def calculate_current_standings(self):
        """Calculate current win-loss records from completed regular-season matches."""
        self.current_records = defaultdict(
            lambda: {
                'wins': 0,
                'losses': 0,
                'draws': 0,
                'points_for': 0,
                'points_against': 0
            }
        )

        for _, match in self.completed_regular_matches.iterrows():
            home_team = match['home_team']
            away_team = match['away_team']
            hscore = match['hscore']
            ascore = match['ascore']

            self.current_records[home_team]['points_for'] += hscore
            self.current_records[home_team]['points_against'] += ascore
            self.current_records[away_team]['points_for'] += ascore
            self.current_records[away_team]['points_against'] += hscore

            if hscore > ascore:
                self.current_records[home_team]['wins'] += 1
                self.current_records[away_team]['losses'] += 1
            elif ascore > hscore:
                self.current_records[away_team]['wins'] += 1
                self.current_records[home_team]['losses'] += 1
            else:
                self.current_records[home_team]['draws'] += 1
                self.current_records[away_team]['draws'] += 1

    def predict_match_probability(self, home_team, away_team, ratings):
        """
        Calculate home win probability from simulation ratings.

        Parameters:
        -----------
        home_team : str
            Home team name
        away_team : str
            Away team name
        ratings : dict
            Current team ratings

        Returns:
        --------
        float : Probability of home team winning
        """
        home_rating = ratings.get(home_team, self.base_rating)
        away_rating = ratings.get(away_team, self.base_rating)

        # Apply home advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating

        return 1.0 / (1.0 + 10 ** (-rating_diff / 400))

    def simulate_match(self, home_team, away_team, ratings):
        """
        Simulate a single match outcome

        Returns:
        --------
        str : Winner ('home', 'away', or 'draw')
        """
        win_prob = self.predict_match_probability(home_team, away_team, ratings)

        # Simulate match outcome
        rand = np.random.random()

        # Small probability of draws (about 1%)
        draw_probability = 0.01

        if rand < draw_probability / 2:
            return 'draw'
        elif rand < win_prob + draw_probability / 2:
            return 'home'
        else:
            return 'away'

    def simulate_regular_season(self):
        """
        Simulate remaining regular season matches

        Returns:
        --------
        dict : Final win-loss records for all teams
        """
        # Start with current records
        records = defaultdict(
            lambda: {
                'wins': 0,
                'losses': 0,
                'draws': 0,
                'points_for': 0,
                'points_against': 0
            }
        )
        for team, record in self.current_records.items():
            records[team] = record.copy()

        # Use initial ratings for simulation
        ratings = self.initial_ratings.copy()

        # Simulate each remaining regular-season match only.
        for _, match in self.upcoming_regular_matches.iterrows():
            home_team = match['home_team']
            away_team = match['away_team']

            # Ensure teams exist in records
            if home_team not in records:
                records[home_team] = {
                    'wins': 0,
                    'losses': 0,
                    'draws': 0,
                    'points_for': 0,
                    'points_against': 0
                }
            if away_team not in records:
                records[away_team] = {
                    'wins': 0,
                    'losses': 0,
                    'draws': 0,
                    'points_for': 0,
                    'points_against': 0
                }

            # Simulate the match
            result = self.simulate_match(home_team, away_team, ratings)

            if result == 'home':
                records[home_team]['wins'] += 1
                records[away_team]['losses'] += 1
            elif result == 'away':
                records[away_team]['wins'] += 1
                records[home_team]['losses'] += 1
            else:  # draw
                records[home_team]['draws'] += 1
                records[away_team]['draws'] += 1

        return records

    def get_final_ladder(self, records):
        """
        Calculate final ladder positions based on win-loss records

        Returns:
        --------
        list : Teams ordered by ladder position
        """
        ladder = []
        for team, record in records.items():
            wins = record['wins']
            losses = record['losses']
            draws = record['draws']
            points_for = record.get('points_for', 0)
            points_against = record.get('points_against', 0)

            # Calculate points (4 pts for win, 2 for draw)
            points = wins * 4 + draws * 2
            percentage = (
                (points_for / points_against) * 100
                if points_against > 0
                else 0
            )
            ladder.append({
                'team': team,
                'wins': wins,
                'losses': losses,
                'draws': draws,
                'points': points,
                'percentage': percentage
            })

        # Sort by points, then percentage, then wins.
        ladder.sort(
            key=lambda x: (x['points'], x['percentage'], x['wins']),
            reverse=True
        )

        return ladder

    def simulate_finals_series(self, qualified_teams, ratings, forced_results=None):
        """
        Simulate AFL finals series

        Finals format by season:
        - Pre-2026: top-8 finals
        - 2026 onward: top-10 finals with wildcard round

        Returns:
        --------
        dict : Finals outcomes for each team
        """
        forced_results = forced_results or {}
        wildcard_format = getattr(self, 'year', 0) >= 2026 and len(qualified_teams) >= 10
        finals_cutoff = 10 if wildcard_format else 8
        finals_teams = qualified_teams[:finals_cutoff]

        def resolve_winner(finals_round_key, team1, team2):
            forced_winner = forced_results.get((finals_round_key, frozenset((team1, team2))))
            if forced_winner in (team1, team2):
                return forced_winner
            return self.simulate_finals_match(team1, team2, ratings)

        # Initialize finals tracker
        finals_tracker = {team: {
            'made_finals': True,
            'wildcard': False,
            'finals_week2': False,
            'top4': False,
            'sf_plus': False,
            'prelim': False,
            'grand_final': False,
            'premiership': False
        } for team in finals_teams}

        # Top 4 get double chances
        top4 = finals_teams[:4]
        for team in top4:
            finals_tracker[team]['top4'] = True
            finals_tracker[team]['sf_plus'] = True

        # Week 1 - Qualifying Finals
        qf1_winner = resolve_winner('qualifying_final', finals_teams[0], finals_teams[3])
        qf1_loser = finals_teams[3] if qf1_winner == finals_teams[0] else finals_teams[0]

        qf2_winner = resolve_winner('qualifying_final', finals_teams[1], finals_teams[2])
        qf2_loser = finals_teams[2] if qf2_winner == finals_teams[1] else finals_teams[1]

        if wildcard_format:
            for team in finals_teams[:6]:
                finals_tracker[team]['finals_week2'] = True

            # Wildcard Finals (7v10, 8v9) feed Elimination Finals.
            for team in finals_teams[6:10]:
                finals_tracker[team]['wildcard'] = True

            wc1_winner = resolve_winner('wildcard_round', finals_teams[6], finals_teams[9])
            wc2_winner = resolve_winner('wildcard_round', finals_teams[7], finals_teams[8])
            finals_tracker[wc1_winner]['finals_week2'] = True
            finals_tracker[wc2_winner]['finals_week2'] = True

            # Elimination Finals (winners advance to Semi Finals).
            ef1_winner = resolve_winner('elimination_final', finals_teams[4], wc2_winner)
            ef2_winner = resolve_winner('elimination_final', finals_teams[5], wc1_winner)
        else:
            for team in finals_teams:
                finals_tracker[team]['finals_week2'] = True

            # Week 1 - Elimination Finals (legacy top-8 format)
            ef1_winner = resolve_winner('elimination_final', finals_teams[4], finals_teams[7])
            ef2_winner = resolve_winner('elimination_final', finals_teams[5], finals_teams[6])

        # Elimination Final winners reach Semi Finals
        finals_tracker[ef1_winner]['sf_plus'] = True
        finals_tracker[ef2_winner]['sf_plus'] = True

        # Semi Finals
        sf1_winner = resolve_winner('semi_final', qf1_loser, ef1_winner)
        sf2_winner = resolve_winner('semi_final', qf2_loser, ef2_winner)

        # Preliminary Finals
        pf1_winner = resolve_winner('preliminary_final', qf1_winner, sf1_winner)
        pf2_winner = resolve_winner('preliminary_final', qf2_winner, sf2_winner)

        # Mark teams that made prelims
        for team in [qf1_winner, qf2_winner, sf1_winner, sf2_winner]:
            finals_tracker[team]['prelim'] = True

        # Grand Final
        premier = resolve_winner('grand_final', pf1_winner, pf2_winner)

        # Mark grand finalists
        finals_tracker[pf1_winner]['grand_final'] = True
        finals_tracker[pf2_winner]['grand_final'] = True

        # Mark premier
        finals_tracker[premier]['premiership'] = True

        return finals_tracker

    def simulate_finals_match(self, team1, team2, ratings):
        """Simulate a finals match between two teams"""
        # Home ground advantage not applied in finals (neutral venue approximation)
        rating1 = ratings.get(team1, self.base_rating)
        rating2 = ratings.get(team2, self.base_rating)

        rating_diff = rating1 - rating2
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))

        # Simulate (no draws in finals - use extra time)
        if np.random.random() < win_probability:
            return team1
        else:
            return team2

    def run_simulations(self):
        """
        Run Monte Carlo simulations of the season

        Returns:
        --------
        dict : Aggregated simulation results
        """
        print(f"\nRunning {self.num_simulations} season simulations...")

        # Track outcomes for each team
        team_outcomes = defaultdict(lambda: {
            'wins': [],
            'finals_count': 0,
            'wildcard_count': 0,
            'finals_week2_count': 0,
            'top4_count': 0,
            'sf_plus_count': 0,
            'prelim_count': 0,
            'grand_final_count': 0,
            'premiership_count': 0,
            'ladder_positions': defaultdict(int)  # Track count of each ladder position
        })

        regular_season_complete = len(self.upcoming_regular_matches) == 0
        forced_finals_results = (
            self.build_completed_finals_lookup()
            if regular_season_complete and len(self.completed_finals_matches) > 0
            else {}
        )
        completed_finals_constraints = (
            self.build_completed_finals_constraints()
            if regular_season_complete and len(self.completed_finals_matches) > 0
            else {}
        )

        # Run simulations
        for sim in range(self.num_simulations):
            if (sim + 1) % 5000 == 0:
                print(f"  Completed {sim + 1}/{self.num_simulations} simulations...")

            # Simulate regular season
            records = self.simulate_regular_season()

            # Get final ladder
            ladder = self.get_final_ladder(records)

            finals_cutoff = 10 if self.year >= 2026 else 8
            finals_teams = [team['team'] for team in ladder[:finals_cutoff]]

            # Track regular season wins and ladder positions
            for position, team_data in enumerate(ladder, start=1):
                team = team_data['team']
                team_outcomes[team]['wins'].append(team_data['wins'])
                team_outcomes[team]['ladder_positions'][position] += 1

            # Track finals appearances
            for team in finals_teams:
                team_outcomes[team]['finals_count'] += 1

            # Simulate finals
            finals_results = self.simulate_finals_series(
                finals_teams,
                self.initial_ratings,
                forced_results=forced_finals_results
            )
            finals_results = self.apply_completed_finals_constraints(
                finals_results,
                completed_finals_constraints
            )
            finals_results = self.resolve_premiership_from_confirmed_grand_finalists(
                finals_results,
                completed_finals_constraints,
                forced_finals_results,
                self.initial_ratings
            )

            # Aggregate finals results
            for team, results in finals_results.items():
                if results.get('wildcard'):
                    team_outcomes[team]['wildcard_count'] += 1
                if results.get('finals_week2'):
                    team_outcomes[team]['finals_week2_count'] += 1
                if results['top4']:
                    team_outcomes[team]['top4_count'] += 1
                if results['sf_plus']:
                    team_outcomes[team]['sf_plus_count'] += 1
                if results['prelim']:
                    team_outcomes[team]['prelim_count'] += 1
                if results['grand_final']:
                    team_outcomes[team]['grand_final_count'] += 1
                if results['premiership']:
                    team_outcomes[team]['premiership_count'] += 1

        print(f"Simulations complete!")

        # Calculate probabilities and statistics
        results = []
        for team, outcomes in team_outcomes.items():
            wins_array = np.array(outcomes['wins'])

            # Calculate ladder position probabilities
            ladder_position_probs = {}
            for position, count in outcomes['ladder_positions'].items():
                ladder_position_probs[position] = count / self.num_simulations

            result = {
                'team': team,
                'current_elo': self.initial_ratings.get(team, self.base_rating),
                'elo_source': self.elo_source_label,
                'current_wins': self.current_records.get(team, {}).get('wins', 0),
                'current_losses': self.current_records.get(team, {}).get('losses', 0),
                'current_draws': self.current_records.get(team, {}).get('draws', 0),
                'projected_wins': float(np.mean(wins_array)),
                'wins_10th_percentile': interpolate_percentile(wins_array, 10),
                'wins_90th_percentile': interpolate_percentile(wins_array, 90),
                'finals_probability': outcomes['finals_count'] / self.num_simulations,
                'wildcard_probability': outcomes['wildcard_count'] / self.num_simulations,
                'finals_week2_probability': (
                    outcomes['finals_week2_count'] / self.num_simulations
                    if self.year >= 2026
                    else outcomes['finals_count'] / self.num_simulations
                ),
                'top4_probability': outcomes['top4_count'] / self.num_simulations,
                'sf_plus_probability': outcomes['sf_plus_count'] / self.num_simulations,
                'prelim_probability': outcomes['prelim_count'] / self.num_simulations,
                'grand_final_probability': outcomes['grand_final_count'] / self.num_simulations,
                'premiership_probability': outcomes['premiership_count'] / self.num_simulations,
                'ladder_position_probabilities': ladder_position_probs
            }
            if self.combined_mode and self.margin_ratings is not None:
                result['current_margin_elo'] = self.margin_ratings.get(team, self.base_rating)
            results.append(result)

        # Sort by premiership probability (descending)
        results.sort(key=lambda x: x['premiership_probability'], reverse=True)

        return results

    def get_total_finals_match_count(self):
        """Return the fixed finals match count for the selected season format."""
        return 11 if self.year >= 2026 else 9

    def get_remaining_finals_match_count(self):
        """
        Remaining finals matches for display purposes.
        Uses completed finals count so the summary decreases as finals progress.
        """
        total_finals_matches = self.get_total_finals_match_count()
        completed_finals_matches = len(getattr(self, 'completed_finals_matches', []))
        return max(0, total_finals_matches - completed_finals_matches)

    def get_remaining_match_counts(self):
        """
        Build the simulation summary match counts shown in the UI.
        remaining_matches includes regular season + finals.
        """
        remaining_regular_matches = len(getattr(self, 'upcoming_regular_matches', []))
        remaining_finals_matches = self.get_remaining_finals_match_count()

        return {
            'remaining_regular_matches': remaining_regular_matches,
            'remaining_finals_matches': remaining_finals_matches,
            'remaining_matches': remaining_regular_matches + remaining_finals_matches
        }

    def save_results(self, results, output_path):
        """Save simulation results to JSON file"""
        # Get absolute path for clarity
        abs_output_path = os.path.abspath(output_path)

        # Ensure directory exists
        output_dir = os.path.dirname(abs_output_path)
        if not os.path.exists(output_dir):
            print(f"Creating output directory: {output_dir}")
            os.makedirs(output_dir, exist_ok=True)

        snapshot_timestamp = datetime.now().isoformat()
        remaining_counts = self.get_remaining_match_counts()
        snapshot_data = {
            'round_key': self.snapshot_round_metadata['round_key'],
            'round_label': self.snapshot_round_metadata['round_label'],
            'round_tab_label': self.snapshot_round_metadata['round_tab_label'],
            'round_order': self.snapshot_round_metadata['round_order'],
            'round_number': self.snapshot_round_metadata['round_number'],
            'model_mode': self.model_mode,
            'win_model_path': self.win_model_path,
            'margin_model_path': self.margin_model_path,
            'num_simulations': self.num_simulations,
            'completed_matches': len(self.completed_matches),
            'remaining_regular_matches': remaining_counts['remaining_regular_matches'],
            'remaining_finals_matches': remaining_counts['remaining_finals_matches'],
            'remaining_matches': remaining_counts['remaining_matches'],
            'last_updated': snapshot_timestamp,
            'from_scratch': self.from_scratch,
            'results': results
        }

        snapshots_by_key = {}
        existing_snapshots = self.load_existing_round_snapshots(abs_output_path)
        for existing_snapshot in existing_snapshots:
            snapshots_by_key[existing_snapshot['round_key']] = existing_snapshot
        snapshots_by_key[snapshot_data['round_key']] = snapshot_data

        pruned_snapshots = prune_stale_current_snapshots(
            list(snapshots_by_key.values()),
            snapshot_data['round_key']
        )
        round_snapshots = sorted(
            pruned_snapshots,
            key=lambda snapshot: (
                snapshot.get('round_order', 9999),
                snapshot.get('round_label', '')
            )
        )

        output_data = {
            'year': self.year,
            'num_simulations': self.num_simulations,
            'completed_matches': snapshot_data['completed_matches'],
            'remaining_regular_matches': snapshot_data['remaining_regular_matches'],
            'remaining_finals_matches': snapshot_data['remaining_finals_matches'],
            'remaining_matches': snapshot_data['remaining_matches'],
            'last_updated': snapshot_timestamp,
            'model_mode': self.model_mode,
            'win_model_path': self.win_model_path,
            'margin_model_path': self.margin_model_path,
            'current_round_key': snapshot_data['round_key'],
            'current_round_label': snapshot_data['round_label'],
            'current_round_tab_label': snapshot_data['round_tab_label'],
            'current_round_number': snapshot_data['round_number'],
            'from_scratch': self.from_scratch,
            'round_snapshots': round_snapshots,
            'results': results
        }

        # Save the file
        print(f"Saving results to: {abs_output_path}")
        fd, temp_path = tempfile.mkstemp(prefix='.tmp-', suffix='.json', dir=output_dir)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as f:
                json.dump(output_data, f, indent=2)
            os.replace(temp_path, abs_output_path)
        except Exception:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise

        print(f"Results saved successfully!")
        print(f"File size: {os.path.getsize(abs_output_path):,} bytes")


def main():
    """Main function to run season simulation"""
    parser = argparse.ArgumentParser(description='Simulate AFL season outcomes')
    parser.add_argument('--year', type=int, required=True,
                        help='Year to simulate')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to trained margin ELO model (legacy + default mode)')
    parser.add_argument('--win-model', type=str, default=None,
                        help='Optional win ELO model path for combined simulation mode')
    parser.add_argument('--db-path', type=str, default='../data/database/afl_predictions.db',
                        help='Path to database (default: ../data/database/afl_predictions.db)')
    parser.add_argument('--num-simulations', type=int, default=50000,
                        help='Number of simulations to run (default: 50000)')
    parser.add_argument('--output', type=str, default=None,
                        help='Output path for results JSON file')
    parser.add_argument('--from-scratch', action='store_true',
                        help='Simulate entire season from beginning, ignoring actual results')
    parser.add_argument('--backfill-round-snapshots', action='store_true',
                        help='Generate snapshots for each round up to the current round state')

    args = parser.parse_args()

    # Set default output path if not specified
    if args.output is None:
        suffix = '_from_scratch' if args.from_scratch else ''
        args.output = f'../data/simulations/season_simulation_{args.year}{suffix}.json'

    if args.from_scratch and args.backfill_round_snapshots:
        raise ValueError('--backfill-round-snapshots cannot be combined with --from-scratch')

    # Create simulator
    simulator = SeasonSimulator(
        model_path=args.model_path,
        db_path=args.db_path,
        year=args.year,
        num_simulations=args.num_simulations,
        from_scratch=args.from_scratch,
        win_model_path=args.win_model
    )

    # Run simulations
    if args.backfill_round_snapshots:
        results = simulator.run_backfill_round_snapshots(args.output)
    else:
        results = simulator.run_simulations()
        simulator.save_results(results, args.output)

    # Print summary
    print("\n" + "="*80)
    print(f"Season Simulation Summary for {args.year}")
    print("="*80)
    print(f"{'Team':<25} {'Proj W':<8} {'Finals':<8} {'Top 4':<8} {'Prem':<8}")
    print("-"*80)

    for r in results[:10]:  # Show top 10
        print(f"{r['team']:<25} "
              f"{r['projected_wins']:>6.1f}  "
              f"{r['finals_probability']*100:>6.1f}%  "
              f"{r['top4_probability']*100:>6.1f}%  "
              f"{r['premiership_probability']*100:>6.1f}%")

    print("="*80)


if __name__ == '__main__':
    main()
