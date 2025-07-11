#!/usr/bin/env python3
"""
Simple ELO Model History Generator

Generates historical ELO rating data for charting and analysis.
"""

import argparse
import os
import pandas as pd
from datetime import datetime
from simple_elo import SimpleELO, load_afl_data


def generate_rating_history(elo_model: SimpleELO, matches_df: pd.DataFrame) -> pd.DataFrame:
    """
    Generate complete rating history by replaying all matches.
    
    Parameters:
    -----------
    elo_model : SimpleELO
        ELO model with parameters (will be reset)
    matches_df : pd.DataFrame
        Historical match data
    
    Returns:
    --------
    pd.DataFrame
        Complete rating history with match-by-match changes
    """
    # Reset the model to start fresh
    elo_model.ratings = {}
    elo_model.match_results = []
    
    # Initialize all teams
    all_teams = pd.concat([
        matches_df['home_team'], 
        matches_df['away_team']
    ]).unique()
    
    for team in all_teams:
        elo_model.ratings[team] = elo_model.base_rating
    
    # Track rating history
    rating_history = []
    
    # Add initial ratings
    for team in all_teams:
        rating_history.append({
            'match_id': 0,
            'year': matches_df['year'].min(),
            'round': 0,
            'match_date': f"{matches_df['year'].min()}-01-01",
            'team': team,
            'rating': elo_model.base_rating,
            'event': 'initial'
        })
    
    # Process matches chronologically
    current_year = None
    for _, match in matches_df.iterrows():
        # Apply season carryover at start of new season
        if current_year is not None and match['year'] != current_year:
            # Record carryover event
            for team in all_teams:
                old_rating = elo_model.ratings[team]
                rating_history.append({
                    'match_id': match['match_id'],
                    'year': match['year'],
                    'round': 0,
                    'match_date': f"{match['year']}-01-01",
                    'team': team,
                    'rating': old_rating,
                    'event': 'pre_carryover'
                })
            
            # Apply carryover
            elo_model.apply_season_carryover()
            
            # Record post-carryover ratings
            for team in all_teams:
                new_rating = elo_model.ratings[team]
                rating_history.append({
                    'match_id': match['match_id'],
                    'year': match['year'],
                    'round': 0,
                    'match_date': f"{match['year']}-01-01",
                    'team': team,
                    'rating': new_rating,
                    'event': 'post_carryover'
                })
        
        # Store pre-match ratings
        home_rating_before = elo_model.get_rating(match['home_team'])
        away_rating_before = elo_model.get_rating(match['away_team'])
        
        # Update ratings
        elo_model.update_ratings(
            match['home_team'],
            match['away_team'],
            match['hscore'],
            match['ascore']
        )
        
        # Store post-match ratings
        home_rating_after = elo_model.ratings[match['home_team']]
        away_rating_after = elo_model.ratings[match['away_team']]
        
        # Record rating changes
        rating_history.append({
            'match_id': match['match_id'],
            'year': match['year'],
            'round': match['round_number'],
            'match_date': match['match_date'],
            'team': match['home_team'],
            'rating': home_rating_after,
            'event': 'match',
            'opponent': match['away_team'],
            'score_for': match['hscore'],
            'score_against': match['ascore'],
            'venue': match['venue'],
            'rating_change': home_rating_after - home_rating_before
        })
        
        rating_history.append({
            'match_id': match['match_id'],
            'year': match['year'],
            'round': match['round_number'],
            'match_date': match['match_date'],
            'team': match['away_team'],
            'rating': away_rating_after,
            'event': 'match',
            'opponent': match['home_team'],
            'score_for': match['ascore'],
            'score_against': match['hscore'],
            'venue': match['venue'],
            'rating_change': away_rating_after - away_rating_before
        })
        
        current_year = match['year']
    
    return pd.DataFrame(rating_history)


def main():
    parser = argparse.ArgumentParser(description='Generate AFL ELO Rating History')
    parser.add_argument('--model-path', required=True,
                       help='Path to trained ELO model JSON file')
    parser.add_argument('--db-path', default='../data/afl_predictions.db',
                       help='Path to SQLite database')
    parser.add_argument('--start-year', type=int, default=1990,
                       help='Start year for history generation')
    parser.add_argument('--end-year', type=int, default=2024,
                       help='End year for history generation')
    parser.add_argument('--output-dir', default='../data',
                       help='Directory to save history files')
    parser.add_argument('--output-prefix', default='simple_elo_history',
                       help='Prefix for output files')
    
    args = parser.parse_args()
    
    print("Simple AFL ELO History Generator")
    print("===============================")
    print(f"Model: {args.model_path}")
    print(f"Database: {args.db_path}")
    print(f"History period: {args.start_year}-{args.end_year}")
    print(f"Output directory: {args.output_dir}")
    print()
    
    # Load model parameters
    print("Loading model parameters...")
    try:
        elo = SimpleELO()
        elo.load_model(args.model_path)
        print(f"Model parameters loaded successfully")
        print(f"  K-Factor: {elo.k_factor}")
        print(f"  Home Advantage: {elo.home_advantage}")
        print(f"  Season Carryover: {elo.season_carryover}")
        print(f"  Margin Scale: {elo.margin_scale}")
        
    except Exception as e:
        print(f"Error loading model: {e}")
        return 1
    
    # Load historical data
    print("Loading historical data...")
    try:
        historical_data = load_afl_data(args.db_path, args.start_year, args.end_year)
        print(f"Loaded {len(historical_data)} matches from {args.start_year}-{args.end_year}")
        
        if len(historical_data) == 0:
            print("No historical data found")
            return 0
            
    except Exception as e:
        print(f"Error loading historical data: {e}")
        return 1
    
    # Generate rating history
    print("Generating rating history...")
    rating_history = generate_rating_history(elo, historical_data)
    
    print(f"Generated {len(rating_history)} rating records")
    
    # Save complete history
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Save detailed history
    detailed_path = os.path.join(args.output_dir, 
                                f'{args.output_prefix}_detailed.csv')
    rating_history.to_csv(detailed_path, index=False)
    print(f"Detailed history saved to: {detailed_path}")
    
    # Create summary by team and year
    print("Creating summary statistics...")
    
    # Get final ratings for each team per year
    summary_data = []
    for year in range(args.start_year, args.end_year + 1):
        year_data = rating_history[rating_history['year'] == year]
        if len(year_data) == 0:
            continue
            
        # Get the last rating for each team in this year
        for team in year_data['team'].unique():
            team_year_data = year_data[year_data['team'] == team]
            if len(team_year_data) > 0:
                last_record = team_year_data.iloc[-1]
                summary_data.append({
                    'year': year,
                    'team': team,
                    'final_rating': last_record['rating'],
                    'matches_played': len(team_year_data[team_year_data['event'] == 'match']),
                    'avg_rating': team_year_data[team_year_data['event'] == 'match']['rating'].mean()
                })
    
    summary_df = pd.DataFrame(summary_data)
    
    # Save summary
    summary_path = os.path.join(args.output_dir, 
                               f'{args.output_prefix}_summary.csv')
    summary_df.to_csv(summary_path, index=False)
    print(f"Summary statistics saved to: {summary_path}")
    
    # Create year-end ratings file (for easier charting)
    year_end_data = []
    for year in range(args.start_year, args.end_year + 1):
        year_summary = summary_df[summary_df['year'] == year]
        if len(year_summary) > 0:
            for _, team_data in year_summary.iterrows():
                year_end_data.append({
                    'year': year,
                    'team': team_data['team'],
                    'rating': team_data['final_rating']
                })
    
    year_end_df = pd.DataFrame(year_end_data)
    year_end_path = os.path.join(args.output_dir, 
                                f'{args.output_prefix}_year_end.csv')
    year_end_df.to_csv(year_end_path, index=False)
    print(f"Year-end ratings saved to: {year_end_path}")
    
    # Show some statistics
    print("\nHistory Generation Summary:")
    print("-" * 40)
    print(f"Total records: {len(rating_history)}")
    print(f"Years covered: {args.start_year}-{args.end_year}")
    print(f"Teams tracked: {len(rating_history['team'].unique())}")
    print(f"Match records: {len(rating_history[rating_history['event'] == 'match'])}")
    print(f"Carryover events: {len(rating_history[rating_history['event'] == 'post_carryover'])}")
    
    # Show final ratings
    if len(summary_df) > 0:
        final_year_data = summary_df[summary_df['year'] == args.end_year]
        if len(final_year_data) > 0:
            print(f"\nFinal ratings for {args.end_year}:")
            print("-" * 30)
            final_ratings = final_year_data.sort_values('final_rating', ascending=False)
            for i, (_, team_data) in enumerate(final_ratings.head(10).iterrows(), 1):
                print(f"{i:2d}. {team_data['team']:<20} {team_data['final_rating']:.0f}")
    
    print("\nHistory generation completed successfully!")
    return 0


if __name__ == "__main__":
    exit(main())