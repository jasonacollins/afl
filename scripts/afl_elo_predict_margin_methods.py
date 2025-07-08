import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import os
import argparse
from afl_elo_margin_methods import ELOMarginMethods


class AFLOptimalMarginPredictor:
    """
    ELO predictor using optimized margin methods - CSV output only
    """
    def __init__(self, elo_model_path, margin_methods_path):
        """
        Initialize the optimal margin predictor
        
        Parameters:
        -----------
        elo_model_path: str
            Path to the saved ELO model JSON file
        margin_methods_path: str
            Path to the optimal margin methods JSON file
        """
        # Initialize empty attributes
        self.team_ratings = {}
        self.elo_params = {}
        self.margin_params = {}
        self.margin_methods = None
        
        if not self.load_models(elo_model_path, margin_methods_path):
            raise ValueError(f"Failed to load models from {elo_model_path} and {margin_methods_path}")
        
        self.predictions = []
        self.rating_history = []
    
    def load_models(self, elo_model_path, margin_methods_path):
        """Load the trained ELO model and optimal margin methods"""
        try:
            # Load ELO model
            with open(elo_model_path, 'r') as f:
                elo_data = json.load(f)
            
            # Set ELO parameters
            self.elo_params = elo_data['parameters']
            self.base_rating = self.elo_params['base_rating']
            self.k_factor = self.elo_params['k_factor']
            self.home_advantage = self.elo_params['home_advantage']
            self.season_carryover = self.elo_params['season_carryover']
            self.max_margin = self.elo_params['max_margin']
            
            # Load team ratings
            self.team_ratings = elo_data['team_ratings']
            
            # Load optimal margin methods
            with open(margin_methods_path, 'r') as f:
                margin_data = json.load(f)
            
            self.margin_params = margin_data
            self.best_method = margin_data['best_method']
            self.best_params = margin_data['best_params']
            
            # Initialize margin methods
            self.margin_methods = ELOMarginMethods(home_advantage=self.home_advantage)
            
            print(f"Loaded ELO model with {len(self.team_ratings)} teams")
            print(f"Using optimal margin method: {self.best_method}")
            print(f"Method parameters: {self.best_params}")
            
            return True
            
        except Exception as e:
            print(f"Error loading models: {str(e)}")
            return False
    
    def predict_win_probability(self, home_rating, away_rating):
        """Calculate win probability using standard ELO formula"""
        rating_diff = (home_rating + self.home_advantage) - away_rating
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        return win_probability
    
    def predict_all_margins(self, home_rating, away_rating):
        """Calculate margins using all three optimized methods"""
        win_prob = self.predict_win_probability(home_rating, away_rating)
        
        margins = {}
        
        # Get parameters for each method
        for method_name, method_data in self.margin_params['all_methods'].items():
            params = method_data['params']
            
            if method_name == 'linear':
                margins[f'predicted_margin_{method_name}'] = self.margin_methods.linear_regression_margin(
                    home_rating, away_rating,
                    slope=params['slope'],
                    intercept=params['intercept']
                )
            elif method_name == 'simple':
                margins[f'predicted_margin_{method_name}'] = self.margin_methods.simple_scaling_margin(
                    home_rating, away_rating,
                    scale_factor=params['scale_factor']
                )
            elif method_name == 'diminishing_returns':
                margins[f'predicted_margin_{method_name}'] = self.margin_methods.diminishing_returns_margin(
                    home_rating, away_rating, beta=params['beta']
                )
        
        # Add the best method indicator
        margins['best_method'] = self.best_method
        margins['predicted_margin_best'] = margins[f'predicted_margin_{self.best_method}']
        
        return margins
    
    def update_ratings(self, home_team, away_team, home_score, away_score):
        """Update team ratings after a match"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Calculate expected and actual results
        expected_home = self.predict_win_probability(home_rating, away_rating)
        actual_home = 1 if home_score > away_score else 0
        
        # Update ratings
        rating_change = self.k_factor * (actual_home - expected_home)
        self.team_ratings[home_team] = home_rating + rating_change
        self.team_ratings[away_team] = away_rating - rating_change
        
        # Record rating history
        self.rating_history.append({
            'date': datetime.now().isoformat(),
            'home_team': home_team,
            'away_team': away_team,
            'home_rating_before': home_rating,
            'away_rating_before': away_rating,
            'home_rating_after': self.team_ratings[home_team],
            'away_rating_after': self.team_ratings[away_team],
            'rating_change': rating_change
        })
    
    def predict_match(self, home_team, away_team, match_date=None):
        """Predict the outcome of a match"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Calculate predictions
        win_probability = self.predict_win_probability(home_rating, away_rating)
        all_margins = self.predict_all_margins(home_rating, away_rating)
        
        prediction = {
            'home_team': home_team,
            'away_team': away_team,
            'match_date': match_date,
            'home_rating': home_rating,
            'away_rating': away_rating,
            'win_probability': win_probability,
        }
        
        # Add all margin predictions
        prediction.update(all_margins)
        
        self.predictions.append(prediction)
        return prediction
    
    def apply_season_carryover(self, current_season, new_season):
        """Apply season carryover to all team ratings"""
        for team in self.team_ratings:
            current_rating = self.team_ratings[team]
            new_rating = self.base_rating + (current_rating - self.base_rating) * self.season_carryover
            self.team_ratings[team] = new_rating
        
        print(f"Applied season carryover ({self.season_carryover:.3f}) from {current_season} to {new_season}")


def fetch_afl_data(db_path, start_year, end_year=None):
    """Fetch AFL match data from database"""
    conn = sqlite3.connect(db_path)
    
    if end_year:
        query = """
        SELECT m.*, 
               h.name as home_team, 
               a.name as away_team,
               m.hscore as home_score,
               m.ascore as away_score,
               m.match_date as date
        FROM matches m
        JOIN teams h ON m.home_team_id = h.team_id
        JOIN teams a ON m.away_team_id = a.team_id
        WHERE m.year >= ? AND m.year <= ?
        ORDER BY m.match_date
        """
        df = pd.read_sql_query(query, conn, params=(start_year, end_year))
    else:
        query = """
        SELECT m.*, 
               h.name as home_team, 
               a.name as away_team,
               m.hscore as home_score,
               m.ascore as away_score,
               m.match_date as date
        FROM matches m
        JOIN teams h ON m.home_team_id = h.team_id
        JOIN teams a ON m.away_team_id = a.team_id
        WHERE m.year >= ?
        ORDER BY m.match_date
        """
        df = pd.read_sql_query(query, conn, params=(start_year,))
    
    conn.close()
    return df


def main():
    parser = argparse.ArgumentParser(description='Generate AFL predictions using optimal margin methods (CSV output only)')
    parser.add_argument('--start-year', type=int, default=2025, help='Start year for predictions')
    parser.add_argument('--elo-model', required=True, help='Path to trained ELO model JSON file')
    parser.add_argument('--margin-methods', required=True, help='Path to optimal margin methods JSON file')
    parser.add_argument('--output-dir', default='data', help='Output directory for files')
    parser.add_argument('--db-path', default='data/afl_predictions.db', help='Database path')
    
    args = parser.parse_args()
    
    # Validate paths
    if not os.path.exists(args.elo_model):
        print(f"Error: ELO model file not found: {args.elo_model}")
        return
    
    if not os.path.exists(args.margin_methods):
        print(f"Error: Margin methods file not found: {args.margin_methods}")
        return
    
    # Initialize predictor
    predictor = AFLOptimalMarginPredictor(args.elo_model, args.margin_methods)
    
    # Fetch upcoming matches
    matches_df = fetch_afl_data(args.db_path, args.start_year)
    
    if matches_df.empty:
        print(f"No matches found for {args.start_year}")
        return
    
    print(f"Processing {len(matches_df)} matches for {args.start_year}")
    
    # Generate predictions
    current_season = None
    for _, match in matches_df.iterrows():
        # Handle season carryover
        if current_season is not None and match['year'] != current_season:
            predictor.apply_season_carryover(current_season, match['year'])
        current_season = match['year']
        
        # Make prediction
        prediction = predictor.predict_match(
            match['home_team'], 
            match['away_team'],
            match['date']
        )
        
        # Update ratings if match has been played
        if pd.notna(match['home_score']) and pd.notna(match['away_score']):
            # Add actual results to prediction for evaluation
            actual_margin = match['home_score'] - match['away_score']
            actual_result = 'home_win' if actual_margin > 0 else 'away_win' if actual_margin < 0 else 'draw'
            
            # Update the prediction with actual results
            prediction['actual_margin'] = actual_margin
            prediction['actual_result'] = actual_result
            prediction['correct'] = (prediction['win_probability'] > 0.5 and actual_result == 'home_win') or \
                                   (prediction['win_probability'] <= 0.5 and actual_result == 'away_win')
            
            predictor.update_ratings(
                match['home_team'], 
                match['away_team'],
                match['home_score'], 
                match['away_score']
            )
    
    # Evaluate performance on completed matches
    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    
    if completed_predictions:
        correct_count = sum(1 for p in completed_predictions if p.get('correct', False))
        accuracy = correct_count / len(completed_predictions)
        
        # Calculate Brier score
        brier_scores = []
        mae_scores = {'linear': [], 'simple': [], 'diminishing_returns': [], 'best': []}
        
        for p in completed_predictions:
            # Convert actual result to probability (1.0 for home win, 0.0 for away win, 0.5 for draw)
            if p['actual_result'] == 'home_win':
                actual_prob = 1.0
            elif p['actual_result'] == 'away_win':
                actual_prob = 0.0
            else:  # draw
                actual_prob = 0.5
            
            # Brier score: (predicted_prob - actual_prob)^2
            predicted_prob = p['win_probability']
            brier_score = (predicted_prob - actual_prob) ** 2
            brier_scores.append(brier_score)
            
            # MAE for each margin prediction method
            actual_margin = p['actual_margin']
            for method in ['linear', 'simple', 'diminishing_returns']:
                if f'predicted_margin_{method}' in p:
                    mae = abs(p[f'predicted_margin_{method}'] - actual_margin)
                    mae_scores[method].append(mae)
            
            # MAE for best method
            if 'predicted_margin_best' in p:
                mae = abs(p['predicted_margin_best'] - actual_margin)
                mae_scores['best'].append(mae)
        
        avg_brier = np.mean(brier_scores)
        
        print(f"\nPrediction Performance on {len(completed_predictions)} completed matches:")
        print(f"  Accuracy: {accuracy:.4f}")
        print(f"  Brier Score: {avg_brier:.4f}")
        print(f"\nMargin Prediction MAE by Method:")
        for method, scores in mae_scores.items():
            if scores:
                avg_mae = np.mean(scores)
                print(f"  {method.replace('_', ' ').title()}: {avg_mae:.2f}")
        
        print(f"\nBest method used: {predictor.best_method}")
    
    # Save predictions to CSV only
    if predictor.predictions:
        predictions_df = pd.DataFrame(predictor.predictions)
        output_file = os.path.join(args.output_dir, f'margin_methods_predictions_{args.start_year}_{args.start_year}.csv')
        predictions_df.to_csv(output_file, index=False)
        print(f"\nSaved {len(predictor.predictions)} predictions to {output_file}")
    
    print(f"\nPrediction generation complete using all three margin methods")
    print("CSV includes all margin methods for comparison")


if __name__ == '__main__':
    main()