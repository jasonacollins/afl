#!/usr/bin/env python3
"""
Simple ELO Model Prediction Script

Generates predictions for all 2025 AFL matches and evaluates accuracy against completed games.
"""

import argparse
import os
import pandas as pd
import numpy as np
import sqlite3
from datetime import datetime
from simple_elo import SimpleELO, get_all_matches_for_year


def save_predictions_to_db(predictions_df: pd.DataFrame, db_path: str, 
                          predictor_id: int = 8) -> None:
    """
    Save predictions to the database.
    
    Parameters:
    -----------
    predictions_df : pd.DataFrame
        DataFrame containing predictions
    db_path : str
        Path to SQLite database
    predictor_id : int
        Predictor ID for the database (default: 8 for Simple ELO)
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Clear existing predictions for this predictor
    cursor.execute("DELETE FROM predictions WHERE predictor_id = ?", (predictor_id,))
    
    # Insert new predictions
    for _, pred in predictions_df.iterrows():
        cursor.execute("""
        INSERT INTO predictions (
            match_id, predictor_id, home_team_win_probability, 
            predicted_margin, prediction_date
        ) VALUES (?, ?, ?, ?, ?)
        """, (
            pred['match_id'],
            predictor_id,
            pred['home_win_prob'],
            pred['predicted_margin'],
            datetime.now().isoformat()
        ))
    
    conn.commit()
    conn.close()


def evaluate_predictions(predictions_df: pd.DataFrame) -> dict:
    """
    Evaluate accuracy of predictions against completed matches.
    
    Parameters:
    -----------
    predictions_df : pd.DataFrame
        DataFrame with predictions and actual results
    
    Returns:
    --------
    dict
        Evaluation metrics
    """
    # Filter to completed matches only
    completed = predictions_df[predictions_df['match_completed'] == True].copy()
    
    if len(completed) == 0:
        return {
            'total_matches': 0,
            'completed_matches': 0,
            'accuracy': 0.0,
            'brier_score': 0.0,
            'margin_mae': 0.0
        }
    
    # Calculate accuracy (correct tips)
    correct_tips = 0
    margin_errors = []
    brier_scores = []
    
    for _, match in completed.iterrows():
        # Determine actual winner
        if match['home_score'] > match['away_score']:
            actual_result = 1.0  # Home win
        elif match['home_score'] < match['away_score']:
            actual_result = 0.0  # Away win
        else:
            actual_result = 0.5  # Draw
        
        # Check if tip was correct
        predicted_winner = 'home' if match['home_win_prob'] > 0.5 else 'away'
        actual_winner = 'home' if actual_result == 1.0 else 'away'
        
        if predicted_winner == actual_winner:
            correct_tips += 1
        
        # Calculate margin error
        actual_margin = match['home_score'] - match['away_score']
        margin_error = abs(match['predicted_margin'] - actual_margin)
        margin_errors.append(margin_error)
        
        # Calculate Brier score component
        brier_score = (match['home_win_prob'] - actual_result) ** 2
        brier_scores.append(brier_score)
    
    return {
        'total_matches': len(predictions_df),
        'completed_matches': len(completed),
        'accuracy': correct_tips / len(completed),
        'brier_score': np.mean(brier_scores),
        'margin_mae': np.mean(margin_errors)
    }


def main():
    parser = argparse.ArgumentParser(description='Generate AFL ELO Predictions for 2025')
    parser.add_argument('--model-path', required=True,
                       help='Path to trained ELO model JSON file')
    parser.add_argument('--db-path', default='../../data/afl_predictions.db',
                       help='Path to SQLite database')
    parser.add_argument('--year', type=int, default=2025,
                       help='Year to generate predictions for')
    parser.add_argument('--output-dir', default='data',
                       help='Directory to save prediction files')
    parser.add_argument('--save-to-db', action='store_true',
                       help='Save predictions to database')
    parser.add_argument('--predictor-id', type=int, default=8,
                       help='Predictor ID for database storage')
    
    args = parser.parse_args()
    
    print(f"Simple AFL ELO Predictions - {args.year}")
    print("=" * 40)
    print(f"Model: {args.model_path}")
    print(f"Database: {args.db_path}")
    print(f"Year: {args.year}")
    print(f"Output directory: {args.output_dir}")
    print()
    
    # Load trained model
    print("Loading trained model...")
    try:
        elo = SimpleELO()
        elo.load_model(args.model_path)
        print(f"Model loaded successfully")
        print(f"  Teams in model: {len(elo.ratings)}")
        print(f"  K-Factor: {elo.k_factor}")
        print(f"  Home Advantage: {elo.home_advantage}")
        print(f"  Season Carryover: {elo.season_carryover}")
        print(f"  Margin Scale: {elo.margin_scale}")
        
    except Exception as e:
        print(f"Error loading model: {e}")
        return 1
    
    # Get all matches for the year
    print(f"Loading all {args.year} matches...")
    try:
        all_matches = get_all_matches_for_year(args.db_path, args.year)
        print(f"Found {len(all_matches)} matches for {args.year}")
        
        if len(all_matches) == 0:
            print(f"No matches found for {args.year}")
            return 0
        
        completed_matches = all_matches[
            (all_matches['hscore'].notna()) & (all_matches['ascore'].notna())
        ]
        upcoming_matches = all_matches[
            (all_matches['hscore'].isna()) | (all_matches['ascore'].isna())
        ]
        
        print(f"  Completed matches: {len(completed_matches)}")
        print(f"  Upcoming matches: {len(upcoming_matches)}")
        
    except Exception as e:
        print(f"Error loading matches: {e}")
        return 1
    
    # Apply season carryover for the new year
    print("Applying season carryover...")
    elo.apply_season_carryover()
    
    # Generate predictions for all matches
    print("Generating predictions...")
    predictions = []
    
    for _, match in all_matches.iterrows():
        home_team = match['home_team']
        away_team = match['away_team']
        
        # Calculate predictions
        home_win_prob = elo.calculate_win_probability(home_team, away_team)
        predicted_margin = elo.predict_margin(home_team, away_team)
        
        # Get current ratings
        home_rating = elo.get_rating(home_team)
        away_rating = elo.get_rating(away_team)
        
        # Determine if match is completed
        match_completed = pd.notna(match['hscore']) and pd.notna(match['ascore'])
        
        predictions.append({
            'match_id': match['match_id'],
            'year': match['year'],
            'round': match['round_number'],
            'match_date': match['match_date'],
            'venue': match['venue'],
            'home_team': home_team,
            'away_team': away_team,
            'home_rating': home_rating,
            'away_rating': away_rating,
            'home_win_prob': home_win_prob,
            'away_win_prob': 1 - home_win_prob,
            'predicted_margin': predicted_margin,
            'predicted_winner': home_team if predicted_margin > 0 else away_team,
            'confidence': abs(home_win_prob - 0.5) * 2,  # Convert to 0-1 confidence
            'match_completed': match_completed,
            'home_score': match['hscore'] if match_completed else None,
            'away_score': match['ascore'] if match_completed else None
        })
    
    predictions_df = pd.DataFrame(predictions)
    
    # Evaluate accuracy against completed matches
    print("\nEvaluating accuracy against completed matches...")
    evaluation = evaluate_predictions(predictions_df)
    
    print(f"Evaluation Results:")
    print(f"  Total matches: {evaluation['total_matches']}")
    print(f"  Completed matches: {evaluation['completed_matches']}")
    
    if evaluation['completed_matches'] > 0:
        print(f"  Accuracy: {evaluation['accuracy']:.3f} ({evaluation['accuracy']*100:.1f}%)")
        print(f"  Brier Score: {evaluation['brier_score']:.4f}")
        print(f"  Margin MAE: {evaluation['margin_mae']:.1f} points")
    else:
        print("  No completed matches to evaluate")
    
    
    # Save predictions to CSV
    os.makedirs(args.output_dir, exist_ok=True)
    csv_path = os.path.join(args.output_dir, f'simple_elo_predictions_{args.year}.csv')
    
    predictions_df.to_csv(csv_path, index=False)
    print(f"Predictions saved to: {csv_path}")
    
    # Save to database if requested
    if args.save_to_db:
        print(f"Saving predictions to database (predictor_id: {args.predictor_id})...")
        try:
            save_predictions_to_db(predictions_df, args.db_path, args.predictor_id)
            print("Predictions saved to database successfully")
        except Exception as e:
            print(f"Error saving to database: {e}")
            return 1
    
    print(f"\nPredictions for {args.year} completed successfully!")
    return 0


if __name__ == "__main__":
    exit(main())