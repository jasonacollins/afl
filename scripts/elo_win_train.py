import pandas as pd
import numpy as np
import os
import json
import argparse
from datetime import datetime

# Import core modules
from core.data_io import (
    fetch_afl_data,
    save_model,
    save_predictions_to_csv,
    save_optimization_results,
    load_parameters,
    create_summary_file
)
from core.elo_core import AFLEloModel, train_elo_model
from core.optimise import parameter_tuning_grid_search
from core.scoring import evaluate_predictions, format_scoring_summary

# AFLEloModel class removed - using core AFLEloModel from elo_core.py instead


# fetch_afl_data function replaced by data_io.fetch_afl_data


# train_elo_model function replaced by elo_core.train_elo_model


# parameter_tuning function replaced by optimise.parameter_tuning_grid_search

def train_margin_model(data, elo_model, margin_params):
    """
    Train margin prediction model using ELO model and margin parameters
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    elo_model: AFLEloModel
        Trained ELO model for getting rating differences and probabilities
    margin_params: dict
        Margin prediction parameters from optimization
        
    Returns:
    --------
    dict: Trained margin model configuration
    """
    method = margin_params['best_method']
    params = margin_params['parameters']
    
    print(f"\nTraining margin model using {method.upper().replace('_', ' ')} method...")
    print("Margin parameters:")
    for key, value in params.items():
        print(f"  {key}: {value:.4f}")
    
    # Create margin model configuration
    margin_model = {
        'method': method,
        'parameters': params,
        'optimization_results': margin_params,
        'elo_model_reference': True  # Indicates this margin model requires ELO model
    }
    
    return margin_model

def main():
    """Main function to train the ELO model"""
    parser = argparse.ArgumentParser(description='Train AFL ELO model')
    parser.add_argument('--start-year', type=int, help='Start year for training data (inclusive)', 
                    default=1990)
    parser.add_argument('--end-year', type=int, help='End year for training data (inclusive)', 
                        default=datetime.now().year)
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='data/models/win',
                        help='Directory to save model files (default: data/models/win)')
    parser.add_argument('--no-tune-parameters', action='store_true',
                        help='Skip parameter tuning (faster but may give worse results)')
    parser.add_argument('--cv-folds', type=int, default=3,
                        help='Number of cross-validation folds for parameter tuning')
    parser.add_argument('--max-combinations', type=int, default=500,
                        help='Maximum number of parameter combinations to test (None for all)')
    parser.add_argument('--params-file', type=str, default=None,
                        help='Load parameters from JSON file (from optimization)')
    parser.add_argument('--margin-params', type=str, default=None,
                        help='Load margin parameters from JSON file (from margin optimization)')

    args = parser.parse_args()
    
    print("AFL ELO Model Training")
    print("=====================")
    print(f"Training with data from year {args.start_year} up to and including year {args.end_year}")
    
    # Check if database exists
    if not os.path.exists(args.db_path):
        print(f"Error: Database not found at {args.db_path}")
        print("Please update the db_path argument")
        return
    
    # Make sure output directory exists
    os.makedirs(args.output_dir, exist_ok=True)
    
    # Fetch data from database
    print("Fetching AFL match data from database...")
    data = fetch_afl_data(args.db_path, start_year=args.start_year, end_year=args.end_year)
    print(f"Fetched {len(data)} matches from {data['year'].min()} to {data['year'].max()}")
    
    if args.params_file:
        print(f"\nLoading parameters from {args.params_file}...")
        best_params = load_parameters(args.params_file)
        
        print("Loaded parameters:")
        for key, value in best_params.items():
            print(f"  {key}: {value}")
        
        # Train model with loaded parameters
        model = train_elo_model(data, best_params)

    elif not args.no_tune_parameters:
        print("\nPerforming parameter tuning...")
        
        # Define parameter grid - extensive version
        param_grid = {
            'base_rating': [1500],  # Usually kept fixed
            'k_factor': [10, 15, 20, 25, 30, 40],  # How quickly ratings change
            'home_advantage': [20, 30, 40, 50, 60, 70],  # Home ground advantage in rating points
            'margin_factor': [0.1, 0.2, 0.3, 0.4, 0.5, 0.7],  # How much margin affects rating changes
            'season_carryover': [0.5, 0.6, 0.7, 0.75, 0.8, 0.9],  # How much rating carries over between seasons
            'max_margin': [60, 80, 100, 120, 140, 160]  # Maximum margin to consider
        }
        
        # Report the total number of combinations
        total_combos = (len(param_grid['k_factor']) * 
                        len(param_grid['home_advantage']) * 
                        len(param_grid['margin_factor']) * 
                        len(param_grid['season_carryover']) * 
                        len(param_grid['max_margin']))
        
        print(f"Parameter grid has {total_combos} possible combinations")
        
        # Perform parameter tuning
        tuning_results = parameter_tuning_grid_search(data, param_grid, cv=args.cv_folds, max_combinations=args.max_combinations)
        
        # Display best parameters
        best_params = tuning_results['best_params']
        print(f"\nBest parameters found:")
        for key, value in best_params.items():
            print(f"  {key}: {value}")
        print(f"Best log loss: {tuning_results['best_score']:.4f}")
        
        # Save tuning results
        tuning_file = os.path.join(args.output_dir, f"afl_elo_tuning_results_{args.end_year}.json")
        save_optimization_results(tuning_results, tuning_file)
        
        # Train model with best parameters
        print("\nTraining model with best parameters...")
        model = train_elo_model(data, best_params)
    else:
        # Use default parameters
        params = {
            'base_rating': 1500,
            'k_factor': 20,
            'home_advantage': 50,
            'margin_factor': 0.3,
            'season_carryover': 0.6,
            'max_margin': 120
        }
        print("\nSkipping parameter tuning and using default parameters...")
        print("Use --tune-parameters flag to find optimal parameters")
        for key, value in params.items():
            print(f"  {key}: {value}")
        
        # Train model with default parameters
        model = train_elo_model(data, params)
    
    # Evaluate model with comprehensive scoring including BITS
    metrics = model.evaluate_model()
    
    # Enhanced evaluation with BITS scoring
    if hasattr(model, 'predictions') and model.predictions:
        detailed_evaluation = evaluate_predictions(model.predictions)
        
        # Combine all metrics for single print
        print("\nModel Evaluation:")
        print(f"  Accuracy: {metrics['accuracy']:.4f}")
        print(f"  Brier Score: {metrics['brier_score']:.4f}")
        print(f"  Log Loss: {metrics['log_loss']:.4f}")
        print(f"  BITS Score: {detailed_evaluation['bits_score_per_game']:.4f} per game")
        print(f"  BITS Score: {detailed_evaluation['bits_score_total']:.2f} total")
        
        # Add detailed metrics to model data for saving
        metrics.update({
            'bits_score_per_game': detailed_evaluation['bits_score_per_game'],
            'bits_score_total': detailed_evaluation['bits_score_total'],
            'detailed_evaluation': detailed_evaluation
        })
    else:
        print("\nModel Evaluation:")
        print(f"  Accuracy: {metrics['accuracy']:.4f}")
        print(f"  Brier Score: {metrics['brier_score']:.4f}")
        print(f"  Log Loss: {metrics['log_loss']:.4f}")
    
    # Save model and predictions
    output_prefix = f"afl_elo_win_trained_to_{args.end_year}"
    model_file = os.path.join(args.output_dir, f"{output_prefix}.json")
    predictions_file = os.path.join("data/predictions/win", f"{output_prefix}_predictions.csv")
    
    # Ensure predictions directory exists
    os.makedirs("data/predictions/win", exist_ok=True)
    
    # Get model data and add enhanced metrics
    model_data = model.get_model_data()
    if 'detailed_evaluation' in metrics:
        model_data['performance_metrics'] = {
            'accuracy': metrics['accuracy'],
            'brier_score': metrics['brier_score'],
            'log_loss': metrics['log_loss'],
            'bits_score_per_game': metrics['bits_score_per_game'],
            'bits_score_total': metrics['bits_score_total']
        }
    
    save_model(model_data, model_file)

    # Train margin model if margin parameters provided
    margin_model = None
    if args.margin_params:
        print(f"\nLoading margin parameters from {args.margin_params}...")
        margin_data = load_parameters(args.margin_params)
        
        print("Margin optimization results:")
        print(f"  Best method: {margin_data['best_method'].upper().replace('_', ' ')}")
        print(f"  Best MAE: {margin_data['margin_mae']:.2f}")
        
        # Train margin model
        margin_model = train_margin_model(data, model, margin_data)
        
        # Save margin model
        margin_model_file = os.path.join(args.output_dir, f"afl_elo_win_margin_model_{args.end_year}.json")
        with open(margin_model_file, 'w') as f:
            json.dump(margin_model, f, indent=4)
        
        print(f"Margin model saved to {margin_model_file}")
    
    save_predictions_to_csv(model.predictions, predictions_file)
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(model.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


if __name__ == "__main__":
    main()