#!/usr/bin/env python3
"""
AFL ELO History Generator

Generates chart history from completed matches without modifying the database.

Modes:
  - full: rebuild complete history from a seed window, then publish an output window
  - incremental: append only newly completed matches to an existing CSV

Usage:
    # Full rebuild seeded from 1990, chart output from 2000
    python3 scripts/elo_history_generator.py \
      --model-path data/models/margin/afl_elo_margin_only_trained_to_2025.json \
      --mode full \
      --seed-start-year 1990 \
      --output-start-year 2000 \
      --output-dir data/historical \
      --output-prefix afl_elo_complete_history

    # Daily incremental append
    python3 scripts/elo_history_generator.py \
      --model-path data/models/margin/afl_elo_margin_only_trained_to_2025.json \
      --mode incremental \
      --seed-start-year 1990 \
      --output-start-year 2000 \
      --output-dir data/historical \
      --output-prefix afl_elo_complete_history
"""

import argparse
import json
import os
import sqlite3

import numpy as np
import pandas as pd

from core.home_advantage import resolve_contextual_home_advantage


MODEL_TYPE_WIN = 'win_elo'
MODEL_TYPE_MARGIN = 'margin_elo'
DEFAULT_SEED_START_YEAR = 1990
DEFAULT_OUTPUT_START_YEAR = 2000


class AFLEloHistoryGenerator:
    """Rating engine for both win and margin model history replay."""

    def __init__(
        self,
        model_type=MODEL_TYPE_WIN,
        base_rating=1500,
        k_factor=20,
        home_advantage=30,
        default_home_advantage=None,
        interstate_home_advantage=None,
        margin_factor=0.3,
        season_carryover=0.6,
        max_margin=120,
        margin_scale=0.15,
        scaling_factor=80,
        team_states=None
    ):
        self.model_type = model_type
        self.base_rating = float(base_rating)
        self.k_factor = float(k_factor)
        self.home_advantage = float(home_advantage)
        self.default_home_advantage = float(
            default_home_advantage if default_home_advantage is not None else home_advantage
        )
        self.interstate_home_advantage = float(
            interstate_home_advantage if interstate_home_advantage is not None else home_advantage
        )
        self.margin_factor = float(margin_factor)
        self.season_carryover = float(season_carryover)
        self.max_margin = float(max_margin)
        self.margin_scale = float(margin_scale)
        self.scaling_factor = float(scaling_factor)
        self.team_states = dict(team_states or {})
        self.team_ratings = {}
        self.rating_history = []

    def initialize_ratings(self, teams):
        self.team_ratings = {team: self.base_rating for team in teams}

    def set_team_ratings(self, team_ratings):
        self.team_ratings = dict(team_ratings)

    def _cap_margin(self, margin):
        return min(abs(margin), self.max_margin) * np.sign(margin)

    def predict_margin(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        home_advantage = self.get_contextual_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        rating_diff = (home_rating + home_advantage) - away_rating
        return rating_diff * self.margin_scale

    def calculate_win_probability(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        home_advantage = self.get_contextual_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )

        if self.model_type == MODEL_TYPE_MARGIN:
            predicted_margin = self.predict_margin(
                home_team,
                away_team,
                venue_state=venue_state,
                home_team_state=home_team_state,
                away_team_state=away_team_state
            )
            rating_diff = (
                (self.team_ratings.get(home_team, self.base_rating) + home_advantage)
                - self.team_ratings.get(away_team, self.base_rating)
                if self.margin_scale == 0
                else predicted_margin / self.margin_scale
            )
            return 1.0 / (1.0 + 10 ** (-rating_diff / 400))

        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        rating_diff = (home_rating + home_advantage) - away_rating
        return 1.0 / (1.0 + 10 ** (-rating_diff / 400))

    def get_contextual_home_advantage(
        self,
        home_team,
        away_team,
        venue_state,
        home_team_state=None,
        away_team_state=None
    ):
        return resolve_contextual_home_advantage(
            default_home_advantage=self.default_home_advantage,
            interstate_home_advantage=self.interstate_home_advantage,
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state,
            team_states=self.team_states
        )

    def _calculate_win_rating_change(
        self,
        home_team,
        away_team,
        hscore,
        ascore,
        venue_state,
        home_team_state=None,
        away_team_state=None
    ):
        home_win_prob = self.calculate_win_probability(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )

        actual_result = 1.0 if hscore > ascore else 0.0
        if hscore == ascore:
            actual_result = 0.5

        margin = hscore - ascore
        capped_margin = self._cap_margin(margin)

        margin_multiplier = 1.0
        if self.margin_factor > 0:
            margin_multiplier = (
                np.log1p(abs(capped_margin) * self.margin_factor)
                / np.log1p(self.max_margin * self.margin_factor)
            )

        return self.k_factor * margin_multiplier * (actual_result - home_win_prob)

    def _calculate_margin_rating_change(
        self,
        home_team,
        away_team,
        hscore,
        ascore,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        if self.scaling_factor == 0:
            raise ValueError('scaling_factor cannot be zero for margin model history generation')

        predicted_margin = self.predict_margin(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        actual_margin = hscore - ascore
        margin_error = predicted_margin - actual_margin

        # Keep aligned with scripts/elo_margin_predict.py
        return -self.k_factor * margin_error / self.scaling_factor

    def update_ratings(
        self,
        home_team,
        away_team,
        hscore,
        ascore,
        year,
        match_id=None,
        round_number=None,
        match_date=None,
        venue=None,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        if home_team not in self.team_ratings:
            self.team_ratings[home_team] = self.base_rating
        if away_team not in self.team_ratings:
            self.team_ratings[away_team] = self.base_rating

        home_rating_before = self.team_ratings[home_team]
        away_rating_before = self.team_ratings[away_team]

        if self.model_type == MODEL_TYPE_MARGIN:
            rating_change = self._calculate_margin_rating_change(
                home_team,
                away_team,
                hscore,
                ascore,
                venue_state=venue_state,
                home_team_state=home_team_state,
                away_team_state=away_team_state
            )
        else:
            rating_change = self._calculate_win_rating_change(
                home_team,
                away_team,
                hscore,
                ascore,
                venue_state,
                home_team_state=home_team_state,
                away_team_state=away_team_state
            )

        self.team_ratings[home_team] += rating_change
        self.team_ratings[away_team] -= rating_change

        self.rating_history.append({
            'match_id': match_id,
            'date': match_date,
            'year': year,
            'round': round_number,
            'team': home_team,
            'opponent': away_team,
            'score': hscore,
            'opponent_score': ascore,
            'result': 'win' if hscore > ascore else ('loss' if hscore < ascore else 'draw'),
            'rating_before': home_rating_before,
            'rating_after': self.team_ratings[home_team],
            'rating_change': rating_change,
            'venue': venue
        })

        self.rating_history.append({
            'match_id': match_id,
            'date': match_date,
            'year': year,
            'round': round_number,
            'team': away_team,
            'opponent': home_team,
            'score': ascore,
            'opponent_score': hscore,
            'result': 'win' if ascore > hscore else ('loss' if ascore < hscore else 'draw'),
            'rating_before': away_rating_before,
            'rating_after': self.team_ratings[away_team],
            'rating_change': -rating_change,
            'venue': venue
        })

    def apply_season_carryover(self, new_year):
        print(f'Applying season carryover for {new_year}...')
        for team in self.team_ratings:
            old_rating = self.team_ratings[team]
            self.team_ratings[team] = self.base_rating + self.season_carryover * (old_rating - self.base_rating)

    def get_history_dataframe(self):
        if not self.rating_history:
            return pd.DataFrame()

        df = pd.DataFrame(self.rating_history)
        df['date'] = pd.to_datetime(df['date'], errors='coerce', utc=True)
        df['match_id'] = pd.to_numeric(df['match_id'], errors='coerce')
        df['year'] = pd.to_numeric(df['year'], errors='coerce')
        return df.sort_values(['date', 'match_id', 'team'])


def infer_model_type(model_data, params):
    explicit_type = model_data.get('model_type')
    if explicit_type in (MODEL_TYPE_WIN, MODEL_TYPE_MARGIN, 'margin_only_elo'):
        if explicit_type in (MODEL_TYPE_MARGIN, 'margin_only_elo'):
            return MODEL_TYPE_MARGIN
        return MODEL_TYPE_WIN

    if 'margin_factor' in params:
        return MODEL_TYPE_WIN

    if 'margin_scale' in params and 'scaling_factor' in params:
        return MODEL_TYPE_MARGIN

    return MODEL_TYPE_WIN


def load_model_config(model_path):
    try:
        with open(model_path, 'r', encoding='utf-8') as handle:
            model_data = json.load(handle)
    except Exception as error:
        print(f'Error loading model file: {error}')
        return None

    params = model_data.get('parameters')
    if not isinstance(params, dict):
        print('Error loading model parameters: model file missing "parameters" object')
        return None

    model_type = infer_model_type(model_data, params)

    print(f'Loaded model parameters from {model_path}:')
    print(f'  model_type: {model_type}')
    for key, value in params.items():
        print(f'  {key}: {value}')

    return {
        'model_type': model_type,
        'params': params
    }


def build_generator_from_config(model_config):
    params = model_config['params']
    return AFLEloHistoryGenerator(
        model_type=model_config['model_type'],
        base_rating=params.get('base_rating', 1500),
        k_factor=params.get('k_factor', 20),
        home_advantage=params.get('home_advantage', 30),
        default_home_advantage=params.get('default_home_advantage', params.get('home_advantage', 30)),
        interstate_home_advantage=params.get('interstate_home_advantage', params.get('home_advantage', 60)),
        margin_factor=params.get('margin_factor', 0.0),
        season_carryover=params.get('season_carryover', 0.6),
        max_margin=params.get('max_margin', 120),
        margin_scale=params.get('margin_scale', 0.15),
        scaling_factor=params.get('scaling_factor', 80),
        team_states=params.get('team_states')
    )


def fetch_afl_data(db_path, start_year=None, end_year=None, after_date=None, after_match_id=None):
    conn = sqlite3.connect(db_path)
    conditions = ['m.hscore IS NOT NULL', 'm.ascore IS NOT NULL']
    params = []

    if start_year is not None:
        conditions.append('m.year >= ?')
        params.append(int(start_year))
    if end_year is not None:
        conditions.append('m.year <= ?')
        params.append(int(end_year))
    if after_date is not None and after_match_id is not None:
        conditions.append(
            '(julianday(m.match_date) > julianday(?) OR (julianday(m.match_date) = julianday(?) AND m.match_id > ?))'
        )
        params.extend([after_date, after_date, int(after_match_id)])

    query = f"""
    SELECT
        m.match_id, m.match_number, m.round_number, m.match_date,
        m.venue, m.year, m.hscore, m.ascore,
        ht.name AS home_team, at.name AS away_team,
        ht.state AS home_team_state, at.state AS away_team_state,
        v.state AS venue_state
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id
    JOIN teams at ON m.away_team_id = at.team_id
    LEFT JOIN venues v ON m.venue_id = v.venue_id
    WHERE {' AND '.join(conditions)}
    ORDER BY m.year, m.match_date, m.match_id
    """

    df = pd.read_sql_query(query, conn, params=params)
    conn.close()
    return df


def apply_matches_to_generator(generator, data, previous_year=None):
    matches_processed = 0
    prev_year = previous_year

    print(f'Processing {len(data)} matches chronologically...')
    for _, match in data.iterrows():
        match_year = int(match['year'])

        if prev_year is not None and match_year != prev_year:
            for transition_year in range(prev_year + 1, match_year + 1):
                generator.apply_season_carryover(transition_year)

        venue_state = match.get('venue_state') if pd.notna(match.get('venue_state')) else None
        home_team_state = match.get('home_team_state') if pd.notna(match.get('home_team_state')) else None
        away_team_state = match.get('away_team_state') if pd.notna(match.get('away_team_state')) else None
        generator.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            hscore=match['hscore'],
            ascore=match['ascore'],
            year=match_year,
            match_id=match['match_id'],
            round_number=match['round_number'],
            match_date=match['match_date'],
            venue=match['venue'],
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )

        matches_processed += 1
        if matches_processed % 1000 == 0:
            print(f'  Processed {matches_processed:,} matches...')

        prev_year = match_year

    print(f'Completed processing {matches_processed:,} matches')
    return prev_year


def filter_history_output(df, output_start_year=None, output_end_year=None):
    if df.empty:
        return df

    filtered = df.copy()
    if output_start_year is not None:
        filtered = filtered[filtered['year'] >= int(output_start_year)]
    if output_end_year is not None:
        filtered = filtered[filtered['year'] <= int(output_end_year)]

    return filtered.sort_values(['date', 'match_id', 'team'])


def load_existing_history(csv_path):
    if not os.path.exists(csv_path):
        return pd.DataFrame()

    try:
        df = pd.read_csv(csv_path)
    except Exception as error:
        print(f'Error loading existing history file: {error}')
        return pd.DataFrame()

    if df.empty:
        return df

    df['_parsed_date'] = pd.to_datetime(df['date'], errors='coerce', utc=True)
    df['match_id'] = pd.to_numeric(df['match_id'], errors='coerce')
    df['year'] = pd.to_numeric(df['year'], errors='coerce')
    df['rating_after'] = pd.to_numeric(df['rating_after'], errors='coerce')
    return df.sort_values(['_parsed_date', 'match_id', 'team'])


def get_checkpoint_from_history(existing_df):
    if existing_df.empty:
        return None

    valid_rows = existing_df[
        existing_df['_parsed_date'].notna()
        & existing_df['match_id'].notna()
        & existing_df['year'].notna()
    ]
    if valid_rows.empty:
        return None

    last_row = valid_rows.iloc[-1]
    return {
        'date': last_row['date'],
        'match_id': int(last_row['match_id']),
        'year': int(last_row['year'])
    }


def build_team_ratings_from_history(existing_df):
    if existing_df.empty:
        return {}

    valid_rows = existing_df[
        existing_df['_parsed_date'].notna()
        & existing_df['match_id'].notna()
        & existing_df['rating_after'].notna()
    ]
    if valid_rows.empty:
        return {}

    latest_per_team = valid_rows.drop_duplicates(subset=['team'], keep='last')
    ratings = {}
    for _, row in latest_per_team.iterrows():
        team = row.get('team')
        if not team:
            continue
        ratings[team] = float(row['rating_after'])

    return ratings if ratings else {}


def get_output_csv_path(output_dir, output_prefix, legacy_start_year=None, legacy_end_year=None):
    year_suffix = ''
    if legacy_start_year is not None or legacy_end_year is not None:
        start = legacy_start_year if legacy_start_year is not None else 'min'
        end = legacy_end_year if legacy_end_year is not None else 'max'
        year_suffix = f'_{start}_to_{end}'
    return os.path.join(output_dir, f'{output_prefix}{year_suffix}.csv')


def resolve_year_bounds(args):
    seed_start_year = args.seed_start_year if args.seed_start_year is not None else args.start_year
    seed_end_year = args.seed_end_year if args.seed_end_year is not None else args.end_year
    output_start_year = args.output_start_year if args.output_start_year is not None else args.start_year
    output_end_year = args.output_end_year if args.output_end_year is not None else args.end_year

    if seed_start_year is None:
        seed_start_year = DEFAULT_SEED_START_YEAR
    if output_start_year is None:
        output_start_year = DEFAULT_OUTPUT_START_YEAR

    if seed_end_year is not None and seed_start_year > seed_end_year:
        raise ValueError('seed-start-year cannot be greater than seed-end-year')
    if output_end_year is not None and output_start_year > output_end_year:
        raise ValueError('output-start-year cannot be greater than output-end-year')

    return {
        'seed_start_year': int(seed_start_year),
        'seed_end_year': int(seed_end_year) if seed_end_year is not None else None,
        'output_start_year': int(output_start_year),
        'output_end_year': int(output_end_year) if output_end_year is not None else None
    }


def run_full_rebuild(model_config, db_path, output_csv_path, year_bounds):
    print('\nFetching AFL match data from database for full rebuild...')
    data = fetch_afl_data(
        db_path=db_path,
        start_year=year_bounds['seed_start_year'],
        end_year=year_bounds['seed_end_year']
    )
    if data.empty:
        print('No match data found for the specified seed criteria')
        return 0

    print(f"Fetched {len(data):,} matches from {data['year'].min()} to {data['year'].max()}")
    generator = build_generator_from_config(model_config)

    all_teams = pd.concat([data['home_team'], data['away_team']]).dropna().unique()
    print(f'Found {len(all_teams)} unique teams')
    generator.initialize_ratings(all_teams)

    apply_matches_to_generator(generator, data)

    history_df = generator.get_history_dataframe()
    output_df = filter_history_output(
        history_df,
        output_start_year=year_bounds['output_start_year'],
        output_end_year=year_bounds['output_end_year']
    )

    os.makedirs(os.path.dirname(os.path.abspath(output_csv_path)), exist_ok=True)
    output_df.to_csv(output_csv_path, index=False)
    print(f'Saved complete ELO rating history with {len(output_df)} records to {output_csv_path}')
    return len(output_df)


def run_incremental_update(model_config, db_path, output_csv_path, year_bounds):
    if not os.path.exists(output_csv_path):
        print('No existing history CSV found; performing full rebuild bootstrap instead.')
        return run_full_rebuild(model_config, db_path, output_csv_path, year_bounds)

    existing_df = load_existing_history(output_csv_path)
    if existing_df.empty:
        print('Existing history CSV is empty; performing full rebuild bootstrap instead.')
        return run_full_rebuild(model_config, db_path, output_csv_path, year_bounds)

    checkpoint = get_checkpoint_from_history(existing_df)
    if checkpoint is None:
        print('Could not determine checkpoint from existing history; performing full rebuild bootstrap instead.')
        return run_full_rebuild(model_config, db_path, output_csv_path, year_bounds)

    print(
        f"Incremental checkpoint: match_id={checkpoint['match_id']}, "
        f"date={checkpoint['date']}, year={checkpoint['year']}"
    )

    new_data = fetch_afl_data(
        db_path=db_path,
        start_year=year_bounds['seed_start_year'],
        end_year=year_bounds['seed_end_year'],
        after_date=checkpoint['date'],
        after_match_id=checkpoint['match_id']
    )

    if new_data.empty:
        print('No new completed matches found after checkpoint. Nothing to append.')
        return 0

    print(f'Found {len(new_data)} newly completed matches to append')
    generator = build_generator_from_config(model_config)

    current_ratings = build_team_ratings_from_history(existing_df)
    all_teams = pd.concat([new_data['home_team'], new_data['away_team']]).dropna().unique()
    merged_ratings = {team: generator.base_rating for team in all_teams}
    merged_ratings.update(current_ratings)
    generator.set_team_ratings(merged_ratings)

    apply_matches_to_generator(generator, new_data, previous_year=checkpoint['year'])

    new_history_df = generator.get_history_dataframe()
    append_df = filter_history_output(
        new_history_df,
        output_start_year=year_bounds['output_start_year'],
        output_end_year=year_bounds['output_end_year']
    )

    if append_df.empty:
        print('No new rows remain after output-year filtering. Nothing appended.')
        return 0

    append_df.drop(columns=['_parsed_date'], errors='ignore', inplace=True)
    append_df.to_csv(output_csv_path, mode='a', header=False, index=False)
    print(f'Appended {len(append_df)} records to {output_csv_path}')
    return len(append_df)


def main():
    parser = argparse.ArgumentParser(description='Generate AFL ELO rating history for charting.')
    parser.add_argument('--model-path', type=str, required=True, help='Path to trained model JSON')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db', help='Path to SQLite DB')
    parser.add_argument('--output-dir', type=str, default='.', help='Output directory')
    parser.add_argument('--output-prefix', type=str, default='afl_elo_complete_history', help='Output CSV prefix')

    parser.add_argument('--mode', choices=['full', 'incremental'], default='full', help='History generation mode')
    parser.add_argument('--incremental', action='store_true', help='Alias for --mode incremental')

    # Legacy year args (backwards compatible)
    parser.add_argument('--start-year', type=int, help='Legacy: defaults seed/output start')
    parser.add_argument('--end-year', type=int, help='Legacy: defaults seed/output end')

    # Explicit seeding/output ranges
    parser.add_argument('--seed-start-year', type=int, help='Year to start replaying matches for rating seeding')
    parser.add_argument('--seed-end-year', type=int, help='Year to end replaying matches for rating seeding')
    parser.add_argument('--output-start-year', type=int, help='First season included in output CSV')
    parser.add_argument('--output-end-year', type=int, help='Last season included in output CSV')

    args = parser.parse_args()

    mode = 'incremental' if args.incremental else args.mode
    print('AFL ELO History Generator')
    print('=========================')
    print(f'Mode: {mode}')

    if not os.path.exists(args.db_path):
        print(f'Error: Database not found at {args.db_path}')
        return
    if not os.path.exists(args.model_path):
        print(f'Error: Model file not found at {args.model_path}')
        return

    try:
        year_bounds = resolve_year_bounds(args)
    except ValueError as error:
        print(f'Error: {error}')
        return

    print(
        f"Seed years: {year_bounds['seed_start_year']} to "
        f"{year_bounds['seed_end_year'] if year_bounds['seed_end_year'] is not None else 'latest'}"
    )
    print(
        f"Output years: {year_bounds['output_start_year']} to "
        f"{year_bounds['output_end_year'] if year_bounds['output_end_year'] is not None else 'latest'}"
    )

    print(f'Loading model configuration from {args.model_path}...')
    model_config = load_model_config(args.model_path)
    if model_config is None:
        return

    os.makedirs(args.output_dir, exist_ok=True)
    use_legacy_suffix = (
        (args.start_year is not None or args.end_year is not None)
        and args.seed_start_year is None
        and args.seed_end_year is None
        and args.output_start_year is None
        and args.output_end_year is None
        and mode == 'full'
    )
    output_csv_path = get_output_csv_path(
        args.output_dir,
        args.output_prefix,
        legacy_start_year=args.start_year if use_legacy_suffix else None,
        legacy_end_year=args.end_year if use_legacy_suffix else None
    )

    try:
        if mode == 'incremental':
            written_rows = run_incremental_update(model_config, args.db_path, output_csv_path, year_bounds)
        else:
            written_rows = run_full_rebuild(model_config, args.db_path, output_csv_path, year_bounds)
    except Exception as error:
        print(f'History generation failed: {error}')
        raise

    print('\nHistory generation complete!')
    print(f'CSV output: {output_csv_path}')
    print(f'Rows written in this run: {written_rows}')


if __name__ == '__main__':
    main()
