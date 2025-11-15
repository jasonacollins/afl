#!/usr/bin/env python3
"""
AFL Season Simulator

Monte Carlo simulation of AFL seasons using ELO margin model predictions.
Simulates remaining fixtures and tracks finals outcomes including:
- Finals qualification (Top 8)
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
from datetime import datetime
from collections import defaultdict

# Import core modules
from core.data_io import load_model, fetch_matches_for_prediction
from core.elo_core import MarginEloModel


class SeasonSimulator:
    """
    Simulates AFL season outcomes using Monte Carlo methods
    """

    def __init__(self, model_path, db_path, year, num_simulations=50000, from_scratch=False):
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
        """
        self.year = year
        self.num_simulations = num_simulations
        self.db_path = db_path
        self.from_scratch = from_scratch

        # Load the margin ELO model
        print(f"Loading margin ELO model from {model_path}...")
        model_data = load_model(model_path)

        if model_data.get('model_type') not in ['margin_only_elo', 'margin_elo']:
            raise ValueError("This simulator requires a margin ELO model")

        # Extract parameters
        params = model_data['parameters']
        self.base_rating = params['base_rating']
        self.k_factor = params['k_factor']
        self.home_advantage = params['home_advantage']
        self.season_carryover = params['season_carryover']
        self.max_margin = params['max_margin']
        self.margin_scale = params['margin_scale']
        self.scaling_factor = params['scaling_factor']

        # Store yearly ratings if available
        self.yearly_ratings = model_data.get('yearly_ratings', {})

        # Current team ratings
        self.initial_ratings = model_data['team_ratings'].copy()

        # If simulating from scratch, apply season carryover to get start-of-year ratings
        if from_scratch:
            print(f"\nFrom-scratch mode: Simulating entire {year} season from beginning")

            # Try to get end-of-previous-year ratings
            prev_year_key = str(year - 1)

            # First check yearly_ratings
            if prev_year_key in self.yearly_ratings:
                print(f"Using end-of-{year-1} ratings from yearly_ratings")
                self.initial_ratings = self.yearly_ratings[prev_year_key].copy()
            # If not found, check if team_ratings are from the previous year
            # (model trained through year-1 would have team_ratings at end of year-1)
            elif 'last_updated' in model_data or 'trained_through_year' in model_data:
                # Assume team_ratings are end-of-training ratings
                # If model is "trained_to_2024", team_ratings are end-of-2024 ratings
                print(f"Using model's current team_ratings as end-of-{year-1} ratings")
                print(f"(Model appears to be trained through {year-1})")
                self.initial_ratings = model_data['team_ratings'].copy()
            else:
                print(f"WARNING: No {year-1} ratings found in model")
                print(f"Using current team_ratings as fallback")
                self.initial_ratings = model_data['team_ratings'].copy()

            # Apply season carryover
            print(f"Applying season carryover ({self.season_carryover})")
            for team in self.initial_ratings:
                old_rating = self.initial_ratings[team]
                self.initial_ratings[team] = (
                    self.base_rating +
                    self.season_carryover * (old_rating - self.base_rating)
                )

        print(f"Model loaded successfully with {len(self.initial_ratings)} teams")

        # Load matches
        self.load_matches()

    def load_matches(self):
        """Load matches for the specified year"""
        print(f"Loading matches for {self.year}...")

        # Fetch all matches for the year
        all_matches = fetch_matches_for_prediction(self.db_path, self.year)
        all_matches = all_matches[all_matches['year'] == self.year].copy()

        if self.from_scratch:
            # Treat all matches as upcoming, ignore actual results
            print("From-scratch mode: Ignoring all actual match results")
            self.completed_matches = all_matches.iloc[0:0].copy()  # Empty dataframe with same structure
            self.upcoming_matches = all_matches.copy()

            print(f"Total matches to simulate: {len(self.upcoming_matches)}")
        else:
            # Separate completed and upcoming matches
            self.completed_matches = all_matches[
                (~all_matches['hscore'].isna()) & (~all_matches['ascore'].isna())
            ].copy()

            self.upcoming_matches = all_matches[
                (all_matches['hscore'].isna()) | (all_matches['ascore'].isna())
            ].copy()

            print(f"Found {len(self.completed_matches)} completed matches")
            print(f"Found {len(self.upcoming_matches)} upcoming matches to simulate")

            # Check if there are any matches to simulate
            if len(self.upcoming_matches) == 0:
                print("\n" + "="*80)
                print("WARNING: No upcoming matches found for this year!")
                print("="*80)
                print("This means all matches for the season are already complete.")
                print("The simulation will only model finals outcomes based on")
                print("the current final ladder positions (no variation).")
                print("\nTIP: Use --from-scratch flag to simulate the completed season")
                print("     as if it hasn't been played yet.")
                print("="*80 + "\n")

        # Get current standings from completed matches
        self.calculate_current_standings()

        # Update ratings based on completed matches (only if not from-scratch)
        if not self.from_scratch and len(self.completed_matches) > 0:
            self.update_ratings_from_completed_matches()

    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts (from margin model)"""
        return min(abs(margin), self.max_margin) * np.sign(margin)

    def update_ratings_from_completed_matches(self):
        """
        Update ELO ratings based on completed matches in the current season.
        Uses the margin model's rating update formula.
        """
        print(f"\nUpdating ratings from {len(self.completed_matches)} completed matches...")

        # Sort matches by date to update in chronological order
        sorted_matches = self.completed_matches.sort_values('match_date')

        rating_changes = []

        for _, match in sorted_matches.iterrows():
            home_team = match['home_team']
            away_team = match['away_team']
            hscore = match['hscore']
            ascore = match['ascore']

            # Get current ratings
            home_rating = self.initial_ratings.get(home_team, self.base_rating)
            away_rating = self.initial_ratings.get(away_team, self.base_rating)

            # Predict margin using current ratings
            rating_diff = (home_rating + self.home_advantage) - away_rating
            predicted_margin = rating_diff * self.margin_scale

            # Calculate actual margin
            actual_margin = hscore - ascore
            capped_margin = self._cap_margin(actual_margin)

            # Calculate margin prediction error
            margin_error = predicted_margin - actual_margin

            # Update ratings based on margin error
            # Negative error means we under-predicted home team, so increase their rating
            rating_change = -self.k_factor * margin_error / self.scaling_factor

            # Apply the rating change
            self.initial_ratings[home_team] = home_rating + rating_change
            self.initial_ratings[away_team] = away_rating - rating_change

            rating_changes.append(abs(rating_change))

        avg_change = np.mean(rating_changes) if rating_changes else 0
        max_change = np.max(rating_changes) if rating_changes else 0

        print(f"Ratings updated through completed matches")
        print(f"  Average rating change: {avg_change:.1f} points")
        print(f"  Maximum rating change: {max_change:.1f} points")

    def calculate_current_standings(self):
        """Calculate current win-loss records from completed matches"""
        self.current_records = defaultdict(lambda: {'wins': 0, 'losses': 0, 'draws': 0})

        for _, match in self.completed_matches.iterrows():
            home_team = match['home_team']
            away_team = match['away_team']
            hscore = match['hscore']
            ascore = match['ascore']

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
        Calculate win probability based on margin model

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

        # Convert rating difference to margin
        predicted_margin = rating_diff * self.margin_scale

        # Convert margin to win probability using logistic function
        rating_diff_equivalent = predicted_margin / self.margin_scale
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff_equivalent / 400))

        return win_probability

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
        records = defaultdict(lambda: {'wins': 0, 'losses': 0, 'draws': 0})
        for team, record in self.current_records.items():
            records[team] = record.copy()

        # Use initial ratings for simulation
        ratings = self.initial_ratings.copy()

        # Simulate each upcoming match
        for _, match in self.upcoming_matches.iterrows():
            home_team = match['home_team']
            away_team = match['away_team']

            # Ensure teams exist in records
            if home_team not in records:
                records[home_team] = {'wins': 0, 'losses': 0, 'draws': 0}
            if away_team not in records:
                records[away_team] = {'wins': 0, 'losses': 0, 'draws': 0}

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

            # Calculate points (4 pts for win, 2 for draw)
            points = wins * 4 + draws * 2

            # Calculate percentage (simplified - we don't have scores)
            # Use wins as a tiebreaker
            ladder.append({
                'team': team,
                'wins': wins,
                'losses': losses,
                'draws': draws,
                'points': points
            })

        # Sort by points (descending), then by wins (descending)
        ladder.sort(key=lambda x: (x['points'], x['wins']), reverse=True)

        return ladder

    def simulate_finals_series(self, top8_teams, ratings):
        """
        Simulate AFL finals series

        AFL Finals structure:
        - Week 1 (Qualifying & Elimination Finals):
          * QF1: 1st vs 4th -> Winner to Prelim, Loser to Semi
          * QF2: 2nd vs 3rd -> Winner to Prelim, Loser to Semi
          * EF1: 5th vs 8th -> Winner to Semi, Loser eliminated
          * EF2: 6th vs 7th -> Winner to Semi, Loser eliminated
        - Week 2 (Semi Finals):
          * SF1: QF1 loser vs higher-ranked EF winner
          * SF2: QF2 loser vs lower-ranked EF winner
        - Week 3 (Preliminary Finals):
          * PF1: QF1 winner vs SF winner
          * PF2: QF2 winner vs SF winner
        - Week 4 (Grand Final):
          * GF: PF winners

        Returns:
        --------
        dict : Finals outcomes for each team
        """
        # Initialize finals tracker
        finals_tracker = {team: {
            'made_finals': True,
            'top4': False,
            'prelim': False,
            'grand_final': False,
            'premiership': False
        } for team in top8_teams}

        # Top 4 get double chances
        top4 = top8_teams[:4]
        for team in top4:
            finals_tracker[team]['top4'] = True

        # Week 1 - Qualifying Finals
        qf1_winner = self.simulate_finals_match(top8_teams[0], top8_teams[3], ratings)
        qf1_loser = top8_teams[3] if qf1_winner == top8_teams[0] else top8_teams[0]

        qf2_winner = self.simulate_finals_match(top8_teams[1], top8_teams[2], ratings)
        qf2_loser = top8_teams[2] if qf2_winner == top8_teams[1] else top8_teams[1]

        # Week 1 - Elimination Finals
        ef1_winner = self.simulate_finals_match(top8_teams[4], top8_teams[7], ratings)
        ef2_winner = self.simulate_finals_match(top8_teams[5], top8_teams[6], ratings)

        # Week 2 - Semi Finals
        # Match QF losers with EF winners
        sf1_winner = self.simulate_finals_match(qf1_loser, ef1_winner, ratings)
        sf2_winner = self.simulate_finals_match(qf2_loser, ef2_winner, ratings)

        # Week 3 - Preliminary Finals
        pf1_winner = self.simulate_finals_match(qf1_winner, sf1_winner, ratings)
        pf2_winner = self.simulate_finals_match(qf2_winner, sf2_winner, ratings)

        # Mark teams that made prelims
        for team in [qf1_winner, qf2_winner, sf1_winner, sf2_winner]:
            finals_tracker[team]['prelim'] = True

        # Week 4 - Grand Final
        premier = self.simulate_finals_match(pf1_winner, pf2_winner, ratings)

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
        predicted_margin = rating_diff * self.margin_scale
        rating_diff_equivalent = predicted_margin / self.margin_scale
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff_equivalent / 400))

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
            'top4_count': 0,
            'prelim_count': 0,
            'grand_final_count': 0,
            'premiership_count': 0
        })

        # Run simulations
        for sim in range(self.num_simulations):
            if (sim + 1) % 5000 == 0:
                print(f"  Completed {sim + 1}/{self.num_simulations} simulations...")

            # Simulate regular season
            records = self.simulate_regular_season()

            # Get final ladder
            ladder = self.get_final_ladder(records)

            # Get top 8 for finals
            top8_teams = [team['team'] for team in ladder[:8]]

            # Track regular season wins
            for team_data in ladder:
                team = team_data['team']
                team_outcomes[team]['wins'].append(team_data['wins'])

            # Track finals appearances
            for team in top8_teams:
                team_outcomes[team]['finals_count'] += 1

            # Simulate finals
            finals_results = self.simulate_finals_series(top8_teams, self.initial_ratings)

            # Aggregate finals results
            for team, results in finals_results.items():
                if results['top4']:
                    team_outcomes[team]['top4_count'] += 1
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

            result = {
                'team': team,
                'current_elo': self.initial_ratings.get(team, self.base_rating),
                'current_wins': self.current_records.get(team, {}).get('wins', 0),
                'current_losses': self.current_records.get(team, {}).get('losses', 0),
                'current_draws': self.current_records.get(team, {}).get('draws', 0),
                'projected_wins': float(np.mean(wins_array)),
                'wins_10th_percentile': float(np.percentile(wins_array, 10)),
                'wins_90th_percentile': float(np.percentile(wins_array, 90)),
                'finals_probability': outcomes['finals_count'] / self.num_simulations,
                'top4_probability': outcomes['top4_count'] / self.num_simulations,
                'prelim_probability': outcomes['prelim_count'] / self.num_simulations,
                'grand_final_probability': outcomes['grand_final_count'] / self.num_simulations,
                'premiership_probability': outcomes['premiership_count'] / self.num_simulations
            }
            results.append(result)

        # Sort by premiership probability (descending)
        results.sort(key=lambda x: x['premiership_probability'], reverse=True)

        return results

    def save_results(self, results, output_path):
        """Save simulation results to JSON file"""
        output_data = {
            'year': self.year,
            'num_simulations': self.num_simulations,
            'completed_matches': len(self.completed_matches),
            'remaining_matches': len(self.upcoming_matches),
            'last_updated': datetime.now().isoformat(),
            'results': results
        }

        # Get absolute path for clarity
        abs_output_path = os.path.abspath(output_path)

        # Ensure directory exists
        output_dir = os.path.dirname(abs_output_path)
        if not os.path.exists(output_dir):
            print(f"Creating output directory: {output_dir}")
            os.makedirs(output_dir, exist_ok=True)

        # Save the file
        print(f"Saving results to: {abs_output_path}")
        with open(abs_output_path, 'w') as f:
            json.dump(output_data, f, indent=2)

        print(f"Results saved successfully!")
        print(f"File size: {os.path.getsize(abs_output_path):,} bytes")


def main():
    """Main function to run season simulation"""
    parser = argparse.ArgumentParser(description='Simulate AFL season outcomes')
    parser.add_argument('--year', type=int, required=True,
                        help='Year to simulate')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to trained margin ELO model')
    parser.add_argument('--db-path', type=str, default='../data/database/afl_predictions.db',
                        help='Path to database (default: ../data/database/afl_predictions.db)')
    parser.add_argument('--num-simulations', type=int, default=50000,
                        help='Number of simulations to run (default: 50000)')
    parser.add_argument('--output', type=str, default=None,
                        help='Output path for results JSON file')
    parser.add_argument('--from-scratch', action='store_true',
                        help='Simulate entire season from beginning, ignoring actual results')

    args = parser.parse_args()

    # Set default output path if not specified
    if args.output is None:
        suffix = '_from_scratch' if args.from_scratch else ''
        args.output = f'../data/simulations/season_simulation_{args.year}{suffix}.json'

    # Create simulator
    simulator = SeasonSimulator(
        model_path=args.model_path,
        db_path=args.db_path,
        year=args.year,
        num_simulations=args.num_simulations,
        from_scratch=args.from_scratch
    )

    # Run simulations
    results = simulator.run_simulations()

    # Save results
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
