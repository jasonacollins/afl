import pandas as pd
import numpy as np
import sqlite3
from sklearn.model_selection import TimeSeriesSplit
import matplotlib.pyplot as plt
import json
import os
import argparse
from datetime import datetime

# Import core modules
from data_io import (
    fetch_afl_data,
    save_model,
    save_predictions_to_csv,
    save_optimization_results,
    load_parameters,
    create_summary_file
)
from elo_core import AFLEloModel, train_elo_model
from optimise import parameter_tuning_grid_search

class AFLEloModel:
    def __init__(self, base_rating=1500, k_factor=20, home_advantage=50, 
            margin_factor=0.3, season_carryover=0.6, max_margin=120, beta=0.05):
        """
        Initialize the AFL ELO model with configurable parameters
        
        Parameters:
        -----------
        base_rating: int
            Starting ELO rating for all teams
        k_factor: float
            Determines how quickly ratings change
        home_advantage: float
            Points added to home team's rating when calculating win probability
        margin_factor: float
            How much the margin of victory affects rating changes
        season_carryover: float
            Percentage of rating retained between seasons (0.75 = 75%)
        max_margin: int
            Maximum margin to consider (to limit effect of blowouts)
        beta: float
            Scaling factor for converting win probability to predicted margin
        """
        self.base_rating = base_rating
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.margin_factor = margin_factor
        self.season_carryover = season_carryover
        self.max_margin = max_margin
        self.beta = beta
        self.team_ratings = {}
        self.yearly_ratings = {}
        self.rating_history = []
        self.predictions = []
    
    def initialize_ratings(self, teams):
        """Initialize all team ratings to the base rating"""
        self.team_ratings = {team: self.base_rating for team in teams}
    
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def calculate_win_probability(self, home_team, away_team):
        """Calculate probability of home team winning based on ELO difference"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability

    def update_ratings(self, home_team, away_team, hscore, ascore, year, match_id=None, round_number=None, match_date=None, venue=None):
        """
        Update team ratings based on match result
        
        Parameters:
        -----------
        home_team: str
            Name of home team
        away_team: str
            Name of away team
        hscore: int
            Score of home team
        ascore: int
            Score of away team
        year: int
            Season year (used for tracking)
        match_id: int
            Optional match ID for tracking
        round_number: str
            Optional round number for tracking
        match_date: str
            Optional match date for tracking
        venue: str
            Optional venue for tracking
        
        Returns:
        --------
        dict with updated ratings and prediction information
        """
        # Ensure teams exist in ratings
        if home_team not in self.team_ratings:
            self.team_ratings[home_team] = self.base_rating
        if away_team not in self.team_ratings:
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
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
        
        # Store the prediction and outcome
        prediction_info = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'hscore': hscore,
            'ascore': ascore,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'rating_difference': home_rating - away_rating,
            'adjusted_rating_difference': (home_rating + self.home_advantage) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'actual_result': 'home_win' if hscore > ascore else ('away_win' if hscore < ascore else 'draw'),
            'correct': (home_win_prob > 0.5 and hscore > ascore) or (home_win_prob < 0.5 and hscore < ascore) or (home_win_prob == 0.5 and hscore == ascore),
            'margin': margin,
            'rating_change': rating_change
        }
        
        self.predictions.append(prediction_info)
        
        # Store rating history
        self.rating_history.append({
            'year': year,
            'match_id': match_id,
            'match_date': match_date,
            'home_team': home_team,
            'away_team': away_team,
            'home_rating': self.team_ratings[home_team],
            'away_rating': self.team_ratings[away_team]
        })
        
        return prediction_info
    
    def apply_season_carryover(self, new_year):
        """Apply regression to mean between seasons"""
        for team in self.team_ratings:
            # Regress ratings toward base rating
            self.team_ratings[team] = self.base_rating + self.season_carryover * (self.team_ratings[team] - self.base_rating)
        
        # Store ratings before the season starts
        self.yearly_ratings[f"{new_year}_start"] = self.team_ratings.copy()
    
    def save_yearly_ratings(self, year):
        """Save the current ratings as end-of-year ratings"""
        self.yearly_ratings[str(year)] = self.team_ratings.copy()
    
    def evaluate_model(self):
        """Calculate accuracy and other metrics for model evaluation"""
        if not self.predictions:
            return {
                'accuracy': 0,
                'brier_score': 1.0,  # Worst possible Brier score
                'log_loss': float('inf')
            }
        
        y_true = [1 if p['actual_result'] == 'home_win' else (0.5 if p['actual_result'] == 'draw' else 0) for p in self.predictions]
        y_pred = [p['home_win_probability'] for p in self.predictions]
        
        # Calculate binary prediction accuracy (did we predict the winner correctly?)
        binary_predictions = [1 if prob >= 0.5 else 0 for prob in y_pred]
        accuracy = sum(1 for true, pred in zip(y_true, binary_predictions) if 
                      (true == 1 and pred == 1) or (true == 0 and pred == 0) or (true == 0.5)) / len(y_true)
        
        # Calculate Brier score (lower is better)
        brier = sum((pred - true)**2 for true, pred in zip(y_true, y_pred)) / len(y_true)

        # Calculate log loss (lower is better)
        logloss = 0
        for true, pred in zip(y_true, y_pred):
            # Clip probability to avoid log(0) issues
            p = max(min(pred, 0.999), 0.001)
            
            # Calculate loss based on actual outcome
            if true == 1.0:
                loss = -np.log(p)
            elif true == 0.0:
                loss = -np.log(1 - p)
            else:  # Draw (0.5)
                # For a draw, use proximity to 0.5 for the loss calculation
                loss = -np.log(1 - abs(0.5 - p))
            
            logloss += loss
        logloss /= len(y_true)
        
        return {
            'accuracy': accuracy,
            'brier_score': brier,
            'log_loss': logloss
        }
    
    def save_model(self, filename):
        """Save the model parameters and team ratings"""
        model_data = {
            'parameters': {
                'base_rating': self.base_rating,
                'k_factor': self.k_factor,
                'home_advantage': self.home_advantage,
                'margin_factor': self.margin_factor,
                'season_carryover': self.season_carryover,
                'max_margin': self.max_margin,
                'beta': self.beta
            },
            'team_ratings': self.team_ratings,
            'yearly_ratings': self.yearly_ratings
        }
        
        with open(filename, 'w') as f:
            json.dump(model_data, f, indent=4)
    
    def save_predictions_to_csv(self, filename):
        """Save all predictions to a CSV file"""
        if not self.predictions:
            print("No predictions to save")
            return
        
        df = pd.DataFrame(self.predictions)
        df.to_csv(filename, index=False)
        print(f"Saved {len(df)} predictions to {filename}")


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
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
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
            'max_margin': [60, 80, 100, 120, 140, 160],  # Maximum margin to consider
            'beta': [0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08]  # Margin prediction scaling factor
        }
        
        # Report the total number of combinations
        total_combos = (len(param_grid['k_factor']) * 
                        len(param_grid['home_advantage']) * 
                        len(param_grid['margin_factor']) * 
                        len(param_grid['season_carryover']) * 
                        len(param_grid['max_margin']) *
                        len(param_grid.get('beta', [0.05])))
        
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
            'max_margin': 120,
            'beta': 0.05
        }
        print("\nSkipping parameter tuning and using default parameters...")
        print("Use --tune-parameters flag to find optimal parameters")
        for key, value in params.items():
            print(f"  {key}: {value}")
        
        # Train model with default parameters
        model = train_elo_model(data, params)
    
    # Evaluate model
    metrics = model.evaluate_model()
    print("\nModel Evaluation:")
    print(f"  Accuracy: {metrics['accuracy']:.4f}")
    print(f"  Brier Score: {metrics['brier_score']:.4f}")
    print(f"  Log Loss: {metrics['log_loss']:.4f}")
    
    # Save model and predictions
    output_prefix = f"afl_elo_trained_to_{args.end_year}"
    model_file = os.path.join(args.output_dir, f"{output_prefix}.json")
    predictions_file = os.path.join(args.output_dir, f"{output_prefix}_predictions.csv")
    
    save_model(model.get_model_data(), model_file)

    # Train margin model if margin parameters provided
    margin_model = None
    if args.margin_params:
        print(f"\nLoading margin parameters from {args.margin_params}...")
        with open(args.margin_params, 'r') as f:
            margin_data = json.load(f)
        
        print("Margin optimization results:")
        print(f"  Best method: {margin_data['best_method'].upper().replace('_', ' ')}")
        print(f"  Best MAE: {margin_data['margin_mae']:.2f}")
        
        # Train margin model
        margin_model = train_margin_model(data, model, margin_data)
        
        # Save margin model
        margin_model_file = os.path.join(args.output_dir, f"afl_elo_margin_model_{args.end_year}.json")
        with open(margin_model_file, 'w') as f:
            json.dump(margin_model, f, indent=4)
        
        print(f"Margin model saved to {margin_model_file}")

    print(f"\nModel saved to {model_file}")
    
    save_predictions_to_csv(model.predictions, predictions_file)
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(model.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


if __name__ == "__main__":
    main()