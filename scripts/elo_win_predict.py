import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import os
import argparse

# Import core modules
from core.data_io import (
    fetch_matches_for_prediction,
    save_predictions_to_csv,
    save_predictions_to_database,
    load_model
)
from core.elo_core import AFLEloModel
from core.scoring import evaluate_predictions, format_scoring_summary


# AFLStandardEloPredictor class removed - using core AFLEloModel instead

# fetch_matches function replaced by data_io.fetch_matches_for_prediction


def predict_matches(model_path, db_path='data/database/afl_predictions.db', start_year=2025, 
                   output_dir='.', save_to_db=True, predictor_id=6, override_completed=False):
    """
    Make standard ELO predictions for matches starting from specified year
    """
    # Load the model data
    model_data = load_model(model_path)
    
    # Create AFLEloModel with loaded parameters
    predictor = AFLEloModel(**model_data['parameters'])
    predictor.team_ratings = model_data['team_ratings'].copy()
    
    # Initialize prediction tracking lists
    predictor.predictions = []
    predictor.rating_history = []
    
    # Get matches from database
    matches = fetch_matches_for_prediction(db_path, start_year)
    
    if len(matches) == 0:
        print(f"No matches found from year {start_year} onwards")
        return
    
    # Get the years in the dataset
    years = matches['year'].unique()
    years.sort()
    
    print(f"Found {len(matches)} matches from {years.min()} to {years.max()}")
    
    # Track the current year to detect year changes
    current_year = None
    
    # Process matches in chronological order
    for i, match in matches.iterrows():
        match_year = match['year']
        
        # Apply season carryover at the start of a new season
        if current_year is not None and match_year != current_year:
            predictor.apply_season_carryover(match_year)
        
        current_year = match_year
        
        # Determine if match has scores (completed)
        has_scores = not pd.isna(match['hscore']) and not pd.isna(match['ascore'])
        
        if has_scores:
            # For completed matches, first calculate prediction then update ratings
            home_win_prob = predictor.calculate_win_probability(
                match['home_team'],
                match['away_team'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
            )
            predicted_margin = predictor.predict_margin(
                match['home_team'],
                match['away_team'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
            )
            
            # Update ratings (this will add prediction to predictor.predictions)
            prediction_info = predictor.update_ratings(
                home_team=match['home_team'],
                away_team=match['away_team'],
                hscore=match['hscore'],
                ascore=match['ascore'],
                year=match['year'],
                match_id=match['match_id'],
                round_number=match['round_number'],
                match_date=match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                venue=match['venue'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
            )
            
            # Add predicted margin to the last prediction (the one we just created)
            if predictor.predictions:
                predictor.predictions[-1]['predicted_margin'] = predicted_margin
        else:
            # For future matches, just predict without updating
            # Calculate prediction manually since AFLEloModel doesn't have predict_match method
            home_win_prob = predictor.calculate_win_probability(
                match['home_team'],
                match['away_team'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
            )
            predicted_margin = predictor.predict_margin(
                match['home_team'],
                match['away_team'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
            )
            
            # Create prediction record
            prediction = {
                'match_id': match['match_id'],
                'round_number': match['round_number'],
                'match_date': match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                'venue': match['venue'],
                'year': match['year'],
                'home_team': match['home_team'],
                'away_team': match['away_team'],
                'home_win_probability': home_win_prob,
                'away_win_probability': 1 - home_win_prob,
                'predicted_margin': predicted_margin,
                'predicted_winner': match['home_team'] if home_win_prob > 0.5 else match['away_team'],
                'confidence': max(home_win_prob, 1 - home_win_prob),
            }
            predictor.predictions.append(prediction)
    
    # Save predictions
    os.makedirs(output_dir, exist_ok=True)

    # Save predictions to CSV in organized structure
    predictions_dir = os.path.join("data/predictions/win")
    os.makedirs(predictions_dir, exist_ok=True)
    csv_filename = os.path.join(predictions_dir, f'win_elo_predictions_{years.min()}_{years.max()}.csv')
    save_predictions_to_csv(predictor.predictions, csv_filename)

    print(f"\nSaved standard ELO predictions to: {csv_filename}")
    print("  - Win probabilities: Standard ELO model")
    print("  - Margins: Built-in ELO calculation")

    # Save to database if requested
    if save_to_db:
        save_predictions_to_database(predictor.predictions, db_path, predictor_id, 
                                    override_completed=override_completed)
    
    # Always save rating history for charts (skip for now since AFLEloModel doesn't have this method)
    # history_file = os.path.join(output_dir, f"win_elo_rating_history_from_{start_year}.csv")
    # predictor.save_rating_history_to_csv(history_file)
    
    # Evaluate the model on completed matches with comprehensive scoring
    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    
    if completed_predictions:
        # Use comprehensive evaluation including BITS scoring
        print("\nDetailed Prediction Performance:")
        evaluation_results = evaluate_predictions(completed_predictions)
        print(format_scoring_summary(evaluation_results))
        
        # Additional margin evaluation if available
        mae_scores = []
        for p in completed_predictions:
            if 'predicted_margin' in p:
                # For completed matches, calculate actual margin from the prediction record
                if 'hscore' in p and 'ascore' in p:
                    actual_margin = p['hscore'] - p['ascore']
                    mae = abs(p['predicted_margin'] - actual_margin)
                    mae_scores.append(mae)
                elif 'margin' in p:
                    # Fallback to existing margin field if available
                    mae = abs(p['predicted_margin'] - p['margin'])
                    mae_scores.append(mae)
        
        if mae_scores:
            avg_mae = np.mean(mae_scores)
            print(f"  Margin MAE: {avg_mae:.2f}")
        else:
            print("  Margin MAE: No margin data available")
    else:
        print("\nNo completed matches found to evaluate prediction accuracy")
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(predictor.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


def main():
    """Main function to make standard ELO predictions"""
    parser = argparse.ArgumentParser(description='Make AFL Standard ELO predictions')
    parser.add_argument('--start-year', type=int, required=True,
                        help='Start year for predictions (inclusive)')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to the trained standard ELO model JSON file')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
    parser.add_argument('--save-to-db', action='store_true', default=True,
                        help='Save predictions directly to database (default: True)')
    parser.add_argument('--no-save-to-db', dest='save_to_db', action='store_false',
                        help='Disable database saving, use CSV output instead')
    parser.add_argument('--predictor-id', type=int, default=6,
                        help='Predictor ID for database storage (default: 6 for ELO)')
    parser.add_argument('--override-completed', action='store_true',
                        help='Override predictions for completed/started matches in database')

    args = parser.parse_args()
    
    predict_matches(
        model_path=args.model_path,
        db_path=args.db_path,
        start_year=args.start_year,
        output_dir=args.output_dir,
        save_to_db=args.save_to_db,
        predictor_id=args.predictor_id,
        override_completed=args.override_completed
    )


if __name__ == '__main__':
    main()
