#!/usr/bin/env python3
"""
AFL ELO History Generator

Generates complete ELO rating history using optimal parameters from a trained model.
This script creates comprehensive rating history in CSV and JSON formats for charting
and analysis purposes.

Usage:
    python3 scripts/elo_history_generator.py --model-path data/models/win/afl_elo_win_trained_to_2024.json
    python3 scripts/elo_history_generator.py --model-path data/models/win/afl_elo_win_trained_to_2024.json --start-year 2000 --end-year 2024
"""

import pandas as pd
import numpy as np
import sqlite3
import json
import os
import argparse
from datetime import datetime

# Team state mapping for interstate home advantage calculation
TEAM_STATES = {
    'Adelaide': 'SA',
    'Brisbane Lions': 'QLD',
    'Carlton': 'VIC',
    'Collingwood': 'VIC',
    'Essendon': 'VIC',
    'Fremantle': 'WA',
    'Geelong': 'VIC',
    'Gold Coast': 'QLD',
    'Greater Western Sydney': 'NSW',
    'Hawthorn': 'VIC',
    'Melbourne': 'VIC',
    'North Melbourne': 'VIC',
    'Port Adelaide': 'SA',
    'Richmond': 'VIC',
    'St Kilda': 'VIC',
    'Sydney': 'NSW',
    'West Coast': 'WA',
    'Western Bulldogs': 'VIC'
}


class AFLEloHistoryGenerator:
    def __init__(self, base_rating=1500, k_factor=20, default_home_advantage=30, interstate_home_advantage=60, 
                 margin_factor=0.3, season_carryover=0.6, max_margin=120):
        """
        Initialize the AFL ELO history generator with model parameters
        """
        self.base_rating = base_rating
        self.k_factor = k_factor
        self.default_home_advantage = default_home_advantage
        self.interstate_home_advantage = interstate_home_advantage
        self.margin_factor = margin_factor
        self.season_carryover = season_carryover
        self.max_margin = max_margin
        self.team_ratings = {}
        self.rating_history = []  # Complete history for CSV/JSON export
        
    def initialize_ratings(self, teams):
        """Initialize all team ratings to the base rating"""
        self.team_ratings = {team: self.base_rating for team in teams}
    
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def calculate_win_probability(self, home_team, away_team, venue_state=None):
        """Calculate probability of home team winning based on ELO difference"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply contextual home ground advantage
        home_advantage = self.get_contextual_home_advantage(home_team, away_team, venue_state)
        rating_diff = (home_rating + home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def get_contextual_home_advantage(self, home_team, away_team, venue_state):
        """Calculate home advantage based on whether away team is traveling interstate"""
        away_team_state = TEAM_STATES.get(away_team)
        
        # Use venue state if available, otherwise fall back to home team state
        if venue_state is None:
            venue_state = TEAM_STATES.get(home_team)
        
        # If away team is from a different state than the venue, use interstate advantage
        if away_team_state and venue_state and away_team_state != venue_state:
            return self.interstate_home_advantage
        else:
            return self.default_home_advantage
    
    def update_ratings(self, home_team, away_team, hscore, ascore, year, 
                      match_id=None, round_number=None, match_date=None, venue=None, venue_state=None):
        """
        Update team ratings based on match result and record complete history
        """
        # Ensure teams exist in ratings
        if home_team not in self.team_ratings:
            self.team_ratings[home_team] = self.base_rating
        if away_team not in self.team_ratings:
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings before the match
        home_rating_before = self.team_ratings[home_team]
        away_rating_before = self.team_ratings[away_team]
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team, venue_state=venue_state)
        
        # Determine actual result (1 for home win, 0 for away win)
        actual_result = 1.0 if hscore > ascore else 0.0
        
        # Handle draws (0.5 points each)
        if hscore == ascore:
            actual_result = 0.5
        
        # Calculate rating change based on result
        margin = hscore - ascore
        capped_margin = self._cap_margin(margin)
        
        # Adjust K-factor by margin
        margin_multiplier = 1.0
        if self.margin_factor > 0:
            margin_multiplier = np.log1p(abs(capped_margin) * self.margin_factor) / np.log1p(self.max_margin * self.margin_factor)
        
        # Calculate ELO update
        rating_change = self.k_factor * margin_multiplier * (actual_result - home_win_prob)
        
        # Update ratings
        self.team_ratings[home_team] += rating_change
        self.team_ratings[away_team] -= rating_change
        
        # Record complete rating history for both teams
        # Home team record
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
        
        # Away team record
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
        """Apply regression to mean between seasons (no longer recorded in history)"""
        print(f"Applying season carryover for {new_year}...")
        
        # Apply carryover to each team (without recording in history)
        for team in self.team_ratings:
            old_rating = self.team_ratings[team]
            new_rating = self.base_rating + self.season_carryover * (old_rating - self.base_rating)
            self.team_ratings[team] = new_rating
    
    def save_history_to_csv(self, filename):
        """Save complete rating history to CSV file"""
        if not self.rating_history:
            print("No rating history to save")
            return
        
        # Convert to DataFrame and sort by date
        df = pd.DataFrame(self.rating_history)
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
        df = df.sort_values(['date', 'match_id'])
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        
        # Save to CSV
        df.to_csv(filename, index=False)
        print(f"Saved complete ELO rating history with {len(df)} records to {filename}")
    
    
    def get_team_history_summary(self):
        """Get a summary of each team's rating journey"""
        if not self.rating_history:
            return {}
        
        summary = {}
        
        for record in self.rating_history:
                
            team = record['team']
            if team not in summary:
                summary[team] = {
                    'matches_played': 0,
                    'wins': 0,
                    'losses': 0,
                    'draws': 0,
                    'first_rating': record['rating_before'],
                    'final_rating': record['rating_after'],
                    'highest_rating': record['rating_after'],
                    'lowest_rating': record['rating_after'],
                    'first_match_date': record['date'],
                    'last_match_date': record['date']
                }
            
            summary[team]['matches_played'] += 1
            summary[team]['final_rating'] = record['rating_after']
            summary[team]['highest_rating'] = max(summary[team]['highest_rating'], record['rating_after'])
            summary[team]['lowest_rating'] = min(summary[team]['lowest_rating'], record['rating_after'])
            summary[team]['last_match_date'] = record['date']
            
            if record['result'] == 'win':
                summary[team]['wins'] += 1
            elif record['result'] == 'loss':
                summary[team]['losses'] += 1
            elif record['result'] == 'draw':
                summary[team]['draws'] += 1
        
        # Calculate win percentages
        for team_data in summary.values():
            total_games = team_data['matches_played']
            if total_games > 0:
                team_data['win_percentage'] = team_data['wins'] / total_games
                team_data['rating_change'] = team_data['final_rating'] - team_data['first_rating']
        
        return summary


def fetch_afl_data(db_path, start_year=None, end_year=None):
    """
    Fetch historical AFL match data from SQLite database
    """
    conn = sqlite3.connect(db_path)
    
    year_clause = ""
    if start_year:
        year_clause += f"AND m.year >= {start_year} "
    if end_year:
        year_clause += f"AND m.year <= {end_year}"
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year, m.hscore, m.ascore, 
        ht.name as home_team, at.name as away_team,
        v.state as venue_state
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    LEFT JOIN 
        venues v ON m.venue_id = v.venue_id
    WHERE 
        m.hscore IS NOT NULL AND m.ascore IS NOT NULL
        {year_clause}
    ORDER BY 
        m.year, m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


def load_model_parameters(model_path):
    """Load parameters from a trained model JSON file"""
    try:
        with open(model_path, 'r') as f:
            model_data = json.load(f)
        
        params = model_data['parameters']
        print(f"Loaded model parameters from {model_path}:")
        for key, value in params.items():
            print(f"  {key}: {value}")
        
        return params
    except Exception as e:
        print(f"Error loading model parameters: {e}")
        return None


def generate_elo_history(data, params):
    """
    Generate complete ELO history using the provided parameters
    """
    # Initialize generator with parameters
    generator = AFLEloHistoryGenerator(
        base_rating=params['base_rating'],
        k_factor=params['k_factor'],
        default_home_advantage=params.get('default_home_advantage', params.get('home_advantage', 30)),
        interstate_home_advantage=params.get('interstate_home_advantage', params.get('home_advantage', 60)),
        margin_factor=params['margin_factor'],
        season_carryover=params['season_carryover'],
        max_margin=params['max_margin']
    )
    
    # Get unique teams
    all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
    print(f"Found {len(all_teams)} unique teams")
    
    # Initialize ratings
    generator.initialize_ratings(all_teams)
    
    # Process matches chronologically
    prev_year = None
    matches_processed = 0
    
    print(f"Processing {len(data)} matches chronologically...")
    
    for _, match in data.iterrows():
        # Apply season carryover at the start of a new season
        if prev_year is not None and match['year'] != prev_year:
            generator.apply_season_carryover(match['year'])
        
        # Update ratings based on match result
        venue_state = match.get('venue_state') if pd.notna(match.get('venue_state')) else None
        generator.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            hscore=match['hscore'],
            ascore=match['ascore'],
            year=match['year'],
            match_id=match['match_id'],
            round_number=match['round_number'],
            match_date=match['match_date'],
            venue=match['venue'],
            venue_state=venue_state
        )
        
        matches_processed += 1
        if matches_processed % 1000 == 0:
            print(f"  Processed {matches_processed:,} matches...")
        
        prev_year = match['year']
    
    print(f"Completed processing {matches_processed:,} matches")
    return generator


def main():
    """Main function to generate ELO history"""
    parser = argparse.ArgumentParser(description='Generate AFL ELO rating history using optimal parameters')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to the trained ELO model JSON file containing optimal parameters')
    parser.add_argument('--start-year', type=int,
                        help='Start year for history generation (default: all available data)')
    parser.add_argument('--end-year', type=int,
                        help='End year for history generation (default: all available data)')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
    parser.add_argument('--output-prefix', type=str, default='afl_elo_complete_history',
                        help='Prefix for output files')
    
    args = parser.parse_args()
    
    print("AFL ELO Complete History Generator")
    print("=================================")
    
    # Check if files exist
    if not os.path.exists(args.db_path):
        print(f"Error: Database not found at {args.db_path}")
        return
    
    if not os.path.exists(args.model_path):
        print(f"Error: Model file not found at {args.model_path}")
        return
    
    # Load model parameters
    print(f"Loading optimal parameters from {args.model_path}...")
    params = load_model_parameters(args.model_path)
    if params is None:
        return
    
    # Make sure output directory exists
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Fetch data from database
    print("\\nFetching AFL match data from database...")
    data = fetch_afl_data(args.db_path, start_year=args.start_year, end_year=args.end_year)
    
    if len(data) == 0:
        print("No match data found for the specified criteria")
        return
    
    print(f"Fetched {len(data):,} matches from {data['year'].min()} to {data['year'].max()}")
    
    # Generate complete ELO history
    print("\\nGenerating complete ELO history with optimal parameters...")
    generator = generate_elo_history(data, params)
    
    # Save history as CSV
    year_suffix = ""
    if args.start_year or args.end_year:
        start = args.start_year or data['year'].min()
        end = args.end_year or data['year'].max()
        year_suffix = f"_{start}_to_{end}"
    
    csv_filename = os.path.join(args.output_dir, f"{args.output_prefix}{year_suffix}.csv")
    
    print("\\nSaving complete history...")
    generator.save_history_to_csv(csv_filename)
    
    # Generate and display team summary
    print("\\nGenerating team summary...")
    summary = generator.get_team_history_summary()
    
    print("\\nFinal Team Ratings (sorted by rating):")
    sorted_teams = sorted(summary.items(), key=lambda x: x[1]['final_rating'], reverse=True)
    for team, stats in sorted_teams:
        print(f"  {team:20s}: {stats['final_rating']:7.1f} "
              f"(+{stats['rating_change']:+6.1f}) "
              f"W-L-D: {stats['wins']}-{stats['losses']}-{stats['draws']} "
              f"({stats['win_percentage']:.1%})")
    
    print("\\nTop Rating Gainers:")
    top_gainers = sorted(summary.items(), key=lambda x: x[1]['rating_change'], reverse=True)[:5]
    for team, stats in top_gainers:
        print(f"  {team:20s}: +{stats['rating_change']:6.1f} points "
              f"({stats['first_rating']:.1f} → {stats['final_rating']:.1f})")
    
    print("\\nHistory generation complete!")
    print(f"CSV output: {csv_filename}")


if __name__ == "__main__":
    main()