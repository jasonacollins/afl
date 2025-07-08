"""
AFL Margin-Only ELO Training Script

This script trains a margin-only ELO model specifically optimized for margin prediction accuracy.
The model uses a simplified approach focusing purely on margin prediction rather than win probability.
"""

import json
import sqlite3
import pandas as pd
import numpy as np
import argparse
import os
from datetime import datetime


class AFLMarginOnlyElo:
    """
    Margin-only ELO implementation focused purely on margin prediction
    """
    def __init__(self, base_rating=1500, k_factor=32, home_advantage=35, 
                 season_carryover=0.85, max_margin=150, margin_scale=0.04, scaling_factor=50):
        """
        Initialize the margin-only ELO system
        
        Parameters:
        -----------
        base_rating: float
            Starting rating for new teams
        k_factor: float  
            Learning rate for rating updates
        home_advantage: float
            Rating boost for home teams
        season_carryover: float
            Fraction of rating carried over between seasons (0.85 = 85%)
        max_margin: int
            Maximum margin for capping blowouts
        margin_scale: float
            Scale factor to convert rating difference to margin
        scaling_factor: float
            Scale factor to convert margin error to rating change
        """
        self.base_rating = base_rating
        self.k_factor = k_factor
        self.home_advantage = home_advantage
        self.season_carryover = season_carryover
        self.max_margin = max_margin
        self.margin_scale = margin_scale
        self.scaling_factor = scaling_factor
        
        self.team_ratings = {}
        self.rating_history = []
        self.yearly_ratings = {}
        
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def predict_margin(self, home_team, away_team):
        """
        Predict match margin based on rating difference
        
        Returns:
        --------
        float: Predicted margin (positive = home team favored)
        """
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage and calculate margin
        rating_diff = (home_rating + self.home_advantage) - away_rating
        predicted_margin = rating_diff * self.margin_scale
        
        return predicted_margin
    
    def update_ratings(self, home_team, away_team, actual_margin):
        """
        Update ratings based on actual margin
        
        Parameters:
        -----------
        home_team: str
            Home team name
        away_team: str  
            Away team name
        actual_margin: float
            Actual margin (home_score - away_score)
        """
        # Ensure teams exist
        if home_team not in self.team_ratings:
            self.team_ratings[home_team] = self.base_rating
        if away_team not in self.team_ratings:
            self.team_ratings[away_team] = self.base_rating
            
        # Get predicted margin
        predicted_margin = self.predict_margin(home_team, away_team)
        
        # Cap the actual margin
        capped_margin = self._cap_margin(actual_margin)
        
        # Calculate prediction error
        margin_error = predicted_margin - capped_margin
        
        # Update ratings using k_factor scaling for meaningful rating changes
        rating_change = -self.k_factor * margin_error / self.scaling_factor
        
        self.team_ratings[home_team] += rating_change
        self.team_ratings[away_team] -= rating_change
    
    def apply_season_carryover(self, new_year):
        """Apply rating regression between seasons"""
        print(f"Applying season carryover for {new_year}")
        
        # Store end-of-season ratings
        if new_year > 1990:  # Don't store for the first year
            prev_year = new_year - 1
            self.yearly_ratings[prev_year] = self.team_ratings.copy()
        
        # Apply carryover
        for team in self.team_ratings:
            old_rating = self.team_ratings[team]
            new_rating = self.base_rating + self.season_carryover * (old_rating - self.base_rating)
            self.team_ratings[team] = new_rating
            
            self.rating_history.append({
                'year': new_year,
                'team': team,
                'event': 'season_carryover',
                'rating_before': old_rating,
                'rating_after': new_rating,
                'rating_change': new_rating - old_rating
            })


def load_data(db_path, start_year=1990, end_year=2024):
    """Load match data from database"""
    conn = sqlite3.connect(db_path)
    
    query = """
    SELECT 
        m.match_id, m.match_date, m.year, m.round_number,
        m.hscore, m.ascore,
        ht.name as home_team, at.name as away_team
    FROM matches m
    JOIN teams ht ON m.home_team_id = ht.team_id  
    JOIN teams at ON m.away_team_id = at.team_id
    WHERE m.year >= ? AND m.year <= ?
    AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
    ORDER BY m.year, m.match_date
    """
    
    matches = pd.read_sql_query(query, conn, params=(start_year, end_year))
    conn.close()
    
    # Calculate margins
    matches['margin'] = matches['hscore'] - matches['ascore']
    
    print(f"Loaded {len(matches)} matches from {start_year} to {end_year}")
    
    return matches


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
    # Initialize model
    model = AFLMarginOnlyElo(
        base_rating=params['base_rating'],
        k_factor=params['k_factor'], 
        home_advantage=params['home_advantage'],
        season_carryover=params['season_carryover'],
        max_margin=params['max_margin'],
        margin_scale=params['margin_scale'],
        scaling_factor=params['scaling_factor']
    )
    
    predictions = []
    current_year = None
    
    print("Training margin-only ELO model...")
    
    for idx, match in data.iterrows():
        match_year = match['year']
        
        # Apply season carryover when year changes
        if current_year is not None and match_year != current_year:
            model.apply_season_carryover(match_year)
        current_year = match_year
        
        # Get prediction before update
        predicted_margin = model.predict_margin(match['home_team'], match['away_team'])
        
        # Store prediction for evaluation
        predictions.append({
            'match_id': match['match_id'],
            'year': match['year'],
            'home_team': match['home_team'],
            'away_team': match['away_team'],
            'actual_margin': match['margin'],
            'predicted_margin': predicted_margin,
            'abs_error': abs(predicted_margin - match['margin'])
        })
        
        # Update ratings based on actual result
        model.update_ratings(match['home_team'], match['away_team'], match['margin'])
    
    # Store final year ratings
    if current_year:
        model.yearly_ratings[current_year] = model.team_ratings.copy()
    
    print("Training completed")
    
    return model, predictions


def evaluate_model(predictions):
    """Evaluate model performance"""
    predictions_df = pd.DataFrame(predictions)
    
    # Calculate metrics
    mae = predictions_df['abs_error'].mean()
    rmse = np.sqrt(predictions_df['abs_error'].pow(2).mean())
    
    # Year-by-year performance
    yearly_mae = predictions_df.groupby('year')['abs_error'].mean()
    
    print(f"\nModel Performance:")
    print(f"Overall MAE: {mae:.2f}")
    print(f"Overall RMSE: {rmse:.2f}")
    print(f"\nYear-by-year MAE:")
    for year, year_mae in yearly_mae.items():
        print(f"  {year}: {year_mae:.2f}")
    
    return {
        'mae': mae,
        'rmse': rmse,
        'yearly_mae': yearly_mae.to_dict(),
        'total_matches': len(predictions)
    }


def save_model(model, performance, output_path):
    """Save trained model to JSON file"""
    
    model_data = {
        'model_type': 'margin_only_elo',
        'created_date': datetime.now().isoformat(),
        'parameters': {
            'base_rating': model.base_rating,
            'k_factor': model.k_factor,
            'home_advantage': model.home_advantage,
            'season_carryover': model.season_carryover,
            'max_margin': model.max_margin,
            'margin_scale': model.margin_scale,
            'scaling_factor': model.scaling_factor
        },
        'team_ratings': model.team_ratings,
        'yearly_ratings': model.yearly_ratings,
        'performance': performance
    }
    
    # Add MAE to top level for easy access
    model_data['mae'] = performance['mae']
    
    # Ensure directory exists
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    
    with open(output_path, 'w') as f:
        json.dump(model_data, f, indent=2)
    
    print(f"Model saved to {output_path}")


def main():
    """Main training function"""
    parser = argparse.ArgumentParser(description='Train AFL Margin-Only ELO Model')
    parser.add_argument('--params-file', type=str, required=True,
                        help='Path to optimal parameters JSON file')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for training (default: 1990)')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for training (default: 2024)')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to database (default: data/afl_predictions.db)')
    parser.add_argument('--output-dir', type=str, default='data',
                        help='Output directory (default: data)')
    
    args = parser.parse_args()
    
    # Load optimal parameters
    with open(args.params_file, 'r') as f:
        params = json.load(f)
    
    print("Loaded parameters:")
    for param, value in params.items():
        print(f"  {param}: {value}")
    
    # Load training data
    data = load_data(args.db_path, args.start_year, args.end_year)
    
    # Train model
    model, predictions = train_margin_model(data, params['parameters'])
    
    # Evaluate performance
    performance = evaluate_model(predictions)
    
    # Save model
    output_filename = f"afl_elo_margin_only_trained_to_{args.end_year}.json"
    output_path = os.path.join(args.output_dir, output_filename)
    save_model(model, performance, output_path)
    
    print(f"\nTraining completed successfully!")
    print(f"Final MAE: {performance['mae']:.2f}")


if __name__ == '__main__':
    main()