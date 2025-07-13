"""
AFL Margin-Only ELO Training Script

This script trains a margin-only ELO model specifically optimized for margin prediction accuracy.
The model uses a simplified approach focusing purely on margin prediction rather than win probability.
"""

import json
import pandas as pd
import numpy as np
import argparse
import os
from datetime import datetime

# Import core modules
from core.data_io import fetch_afl_data, save_model, load_parameters
from core.elo_core import MarginEloModel
from core.scoring import evaluate_predictions, format_scoring_summary


# AFLMarginOnlyElo class replaced by core MarginEloModel


# load_data function replaced by data_io.fetch_afl_data


def train_margin_model(data, params):
    """
    Train the margin-only ELO model
    
    Parameters:
    -----------
    data: DataFrame
        Match data with columns: home_team, away_team, margin, year
    params: dict
        Model parameters
        
    Returns:
    --------
    AFLMarginOnlyElo: Trained model
    list: Prediction results for evaluation
    """
    # Initialize model using core MarginEloModel
    model = MarginEloModel(
        base_rating=params['base_rating'],
        k_factor=params['k_factor'], 
        home_advantage=params['home_advantage'],
        season_carryover=params['season_carryover'],
        max_margin=params['max_margin'],
        margin_scale=params['margin_scale'],
        scaling_factor=params['scaling_factor']
    )
    
    # Get all teams and initialize ratings
    all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
    model.initialize_ratings(all_teams)
    
    predictions = []
    current_year = None
    
    print("Training margin-only ELO model...")
    
    for idx, match in data.iterrows():
        match_year = match['year']
        
        # Apply season carryover when year changes
        if current_year is not None and match_year != current_year:
            model.apply_season_carryover()
        current_year = match_year
        
        # Get prediction before update
        predicted_margin = model.predict_margin(match['home_team'], match['away_team'])
        
        # Calculate win probability from margin prediction (using logistic function)
        # This matches the approach used in the prediction script
        home_win_prob = 1 / (1 + np.exp(-predicted_margin / 13.0))  # 13.0 is common scaling factor
        
        # Determine actual result
        actual_margin = match['hscore'] - match['ascore']
        if actual_margin > 0:
            actual_result = 'home_win'
        elif actual_margin < 0:
            actual_result = 'away_win'
        else:
            actual_result = 'draw'
        
        # Store prediction for evaluation
        predictions.append({
            'match_id': match.get('match_id'),
            'year': match['year'],
            'home_team': match['home_team'],
            'away_team': match['away_team'],
            'actual_margin': actual_margin,
            'predicted_margin': predicted_margin,
            'abs_error': abs(predicted_margin - actual_margin),
            'home_win_probability': home_win_prob * 100,  # Convert to percentage for scoring
            'actual_result': actual_result
        })
        
        # Update ratings based on actual result
        actual_margin = match['hscore'] - match['ascore']
        model.update_ratings(match['home_team'], match['away_team'], actual_margin)
    
    # Final ratings are already stored in the model
    
    print("Training completed")
    
    return model, predictions


def evaluate_model(predictions):
    """Evaluate model performance including both margin and win accuracy"""
    predictions_df = pd.DataFrame(predictions)
    
    # Calculate margin metrics
    mae = predictions_df['abs_error'].mean()
    rmse = np.sqrt(predictions_df['abs_error'].pow(2).mean())
    
    # Year-by-year performance
    yearly_mae = predictions_df.groupby('year')['abs_error'].mean()
    
    print(f"\nMargin Prediction Performance:")
    print(f"Overall MAE: {mae:.2f}")
    print(f"Overall RMSE: {rmse:.2f}")
    print(f"\nYear-by-year MAE:")
    for year, year_mae in yearly_mae.items():
        print(f"  {year}: {year_mae:.2f}")
    
    # Evaluate win prediction accuracy using core scoring functions
    print(f"\nWin Prediction Performance (derived from margin predictions):")
    win_evaluation = evaluate_predictions(
        predictions, 
        probability_key='home_win_probability',
        actual_result_key='actual_result'
    )
    print(format_scoring_summary(win_evaluation))
    
    return {
        'mae': mae,
        'rmse': rmse,
        'yearly_mae': yearly_mae.to_dict(),
        'total_matches': len(predictions),
        'win_accuracy': win_evaluation['accuracy'],
        'brier_score': win_evaluation['brier_score_per_game'],
        'bits_score': win_evaluation['bits_score_per_game']
    }


# save_model function replaced by data_io.save_model


def main():
    """Main training function"""
    parser = argparse.ArgumentParser(description='Train AFL Margin-Only ELO Model')
    parser.add_argument('--params-file', type=str, required=True,
                        help='Path to optimal parameters JSON file')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for training (default: 1990)')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for training (default: 2024)')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to database (default: data/database/afl_predictions.db)')
    parser.add_argument('--output-dir', type=str, default='data/models/margin',
                        help='Output directory (default: data/models/margin)')
    
    args = parser.parse_args()
    
    # Load optimal parameters using core function
    params = load_parameters(args.params_file)
    
    print("Loaded parameters:")
    # Handle both parameter formats (with or without 'parameters' wrapper)
    if 'parameters' in params:
        param_dict = params['parameters']
    else:
        param_dict = params
    
    for param, value in param_dict.items():
        print(f"  {param}: {value}")
    
    # Load training data using core function
    data = fetch_afl_data(args.db_path, args.start_year, args.end_year)
    
    # Train model  
    model, predictions = train_margin_model(data, param_dict)
    
    # Evaluate performance
    performance = evaluate_model(predictions)
    
    # Save model using core function
    output_filename = f"afl_elo_margin_only_trained_to_{args.end_year}.json"
    output_path = os.path.join(args.output_dir, output_filename)
    
    # Get model data and add performance metrics
    model_data = model.get_model_data()
    model_data['performance'] = performance
    model_data['mae'] = performance['mae']
    model_data['created_date'] = datetime.now().isoformat()
    
    save_model(model_data, output_path)
    
    print(f"\nTraining completed successfully!")
    print(f"Final MAE: {performance['mae']:.2f}")


if __name__ == '__main__':
    main()