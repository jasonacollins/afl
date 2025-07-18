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
from core.elo_core import MarginEloModel
from core.scoring import evaluate_predictions, format_scoring_summary


class AFLMarginEloPredictor:
    """
    Margin-only ELO predictor focused on margin predictions
    """
    def __init__(self, model_path):
        """
        Initialize the margin-only ELO predictor
        
        Parameters:
        -----------
        model_path: str
            Path to the saved margin-only ELO model JSON file
        """
        # Initialize empty attributes
        self.team_ratings = {}
        self.params = {}
        
        if not self.load_model(model_path):
            raise ValueError(f"Failed to load margin-only ELO model from {model_path}")
        
        self.predictions = []
        self.rating_history = []
    
    def load_model(self, model_path):
        """Load the trained margin-only ELO model using core function"""
        try:
            model_data = load_model(model_path)
            
            # Verify this is a margin-only model
            if model_data.get('model_type') not in ['margin_only_elo', 'margin_elo']:
                raise ValueError("This is not a margin-only ELO model. Use afl_elo_predict_standard.py instead.")
            
            # Set parameters
            self.params = model_data['parameters']
            self.base_rating = self.params['base_rating']
            self.k_factor = self.params['k_factor']
            self.home_advantage = self.params['home_advantage']
            self.season_carryover = self.params['season_carryover']
            self.max_margin = self.params['max_margin']
            self.margin_scale = self.params['margin_scale']
            self.scaling_factor = self.params['scaling_factor']
            
            # Set team ratings
            if 'team_ratings' not in model_data:
                raise ValueError("Model file missing required 'team_ratings' data")
            self.team_ratings = model_data['team_ratings']
            
            # Store yearly ratings if available
            self.yearly_ratings = model_data.get('yearly_ratings', {})
            
            print(f"Loaded margin-only ELO model with {len(self.team_ratings)} team ratings")
            print(f"Model MAE: {model_data.get('mae', 'unknown')}")
            print("Model parameters:")
            for param, value in self.params.items():
                print(f"  {param}: {value}")
                
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            self.team_ratings = {}
            self.params = {}
            return False
    
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def calculate_win_probability(self, home_team, away_team):
        """
        Calculate probability of home team winning based on predicted margin
        For margin-only models, we derive win probability from margin prediction
        """
        predicted_margin = self.predict_margin(home_team, away_team)
        
        # Convert margin to win probability using logistic function
        # Positive margin = home team favored
        # Use a scaling factor to convert margin to rating-like difference
        rating_diff_equivalent = predicted_margin / self.margin_scale
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff_equivalent / 400))
        
        return win_probability
    
    def predict_margin(self, home_team, away_team):
        """
        Predict match margin using margin-only ELO model
        """
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Use margin_scale to convert rating difference to margin
        predicted_margin = rating_diff * self.margin_scale
        
        return predicted_margin
    
    def apply_season_carryover(self, new_year):
        """Apply regression to mean between seasons"""
        print(f"Applying season carryover for {new_year}...")
        
        # Store current ratings before carryover
        ratings_before = self.team_ratings.copy()
        
        for team in self.team_ratings:
            # Regress ratings toward base rating
            self.team_ratings[team] = self.base_rating + self.season_carryover * (self.team_ratings[team] - self.base_rating)
        
        # Store the ratings transition in history
        self.rating_history.append({
            'event': 'season_carryover',
            'year': new_year,
            'ratings_before': ratings_before,
            'ratings_after': self.team_ratings.copy()
        })
    
    def update_ratings(self, home_team, away_team, hscore, ascore, match_id=None, year=None, round_number=None, match_date=None, venue=None):
        """
        Update team ratings based on match result using margin-only approach
        """
        # Ensure teams exist in ratings
        if home_team not in self.team_ratings:
            print(f"Warning: {home_team} not found in ratings, using base rating")
            self.team_ratings[home_team] = self.base_rating
            
        if away_team not in self.team_ratings:
            print(f"Warning: {away_team} not found in ratings, using base rating")
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Predict margin and derive win probability
        predicted_margin = self.predict_margin(home_team, away_team)
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Store the pre-update prediction info
        prediction_info = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'rating_difference': home_rating - away_rating,
            'adjusted_rating_difference': (home_rating + self.home_advantage) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'predicted_margin': predicted_margin,
        }
        
        # If scores are provided, update ratings and add result info
        if hscore is not None and ascore is not None:
            # Calculate actual margin
            actual_margin = hscore - ascore
            capped_margin = self._cap_margin(actual_margin)
            
            # Calculate prediction error
            margin_error = predicted_margin - actual_margin
            
            # Update ratings based on margin error
            # Positive error means we over-predicted home team margin
            # So we should decrease home rating and increase away team rating
            rating_change = -self.k_factor * margin_error / self.scaling_factor
            
            # Update ratings
            self.team_ratings[home_team] += rating_change
            self.team_ratings[away_team] -= rating_change
            
            # Determine actual result
            actual_result = 'home_win' if hscore > ascore else ('away_win' if hscore < ascore else 'draw')
            
            # Add result info to prediction
            prediction_info.update({
                'hscore': hscore,
                'ascore': ascore,
                'actual_result': actual_result,
                'margin': actual_margin,
                'margin_error': margin_error,
                'rating_change': rating_change,
                'post_match_home_rating': self.team_ratings[home_team],
                'post_match_away_rating': self.team_ratings[away_team],
                'correct': (home_win_prob > 0.5 and hscore > ascore) or 
                           (home_win_prob < 0.5 and hscore < ascore) or 
                           (home_win_prob == 0.5 and hscore == ascore)
            })
            
            # Store the ratings change in history
            self.rating_history.append({
                'event': 'match',
                'match_id': match_id,
                'year': year,
                'round_number': round_number,
                'match_date': match_date,
                'home_team': home_team,
                'away_team': away_team,
                'home_score': hscore,
                'away_score': ascore,
                'home_rating_before': home_rating,
                'away_rating_before': away_rating,
                'home_rating_after': self.team_ratings[home_team],
                'away_rating_after': self.team_ratings[away_team],
                'rating_change': rating_change,
                'margin_error': margin_error
            })
        
        # Store the prediction
        self.predictions.append(prediction_info)
        
        return prediction_info
    
    def predict_match(self, home_team, away_team, match_id=None, year=None, round_number=None, match_date=None, venue=None):
        """
        Predict the outcome of a match without updating ratings
        """
        # Check if teams exist in ratings
        if home_team not in self.team_ratings:
            print(f"Warning: {home_team} not found in ratings, using base rating")
            self.team_ratings[home_team] = self.base_rating
            
        if away_team not in self.team_ratings:
            print(f"Warning: {away_team} not found in ratings, using base rating")
            self.team_ratings[away_team] = self.base_rating
        
        # Get current ratings
        home_rating = self.team_ratings[home_team]
        away_rating = self.team_ratings[away_team]
        
        # Predict margin and derive win probability
        predicted_margin = self.predict_margin(home_team, away_team)
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Create prediction result
        prediction = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'pre_match_home_rating': home_rating,
            'pre_match_away_rating': away_rating,
            'rating_difference': home_rating - away_rating,
            'adjusted_rating_difference': (home_rating + self.home_advantage) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_margin': predicted_margin,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
        }
        
        # Store the prediction
        self.predictions.append(prediction)
        
        return prediction
    
    def save_predictions_to_csv(self, filename):
        """Save predictions to CSV file using core function"""
        if not self.predictions:
            print("No predictions to save")
            return
        
        save_predictions_to_csv(self.predictions, filename)
    
    def save_rating_history_to_csv(self, filename):
        """Save rating history to CSV file"""
        if not self.rating_history:
            print("No rating history to save")
            return
        
        # Convert to DataFrame
        rows = []
        
        # Process each event
        for event in self.rating_history:
            event_type = event['event']
            
            if event_type == 'match':
                # For match events, add a row for each team
                home_row = {
                    'event': 'match',
                    'match_id': event['match_id'],
                    'date': event['match_date'],
                    'year': event['year'],
                    'round': event['round_number'],
                    'team': event['home_team'],
                    'opponent': event['away_team'],
                    'score': event['home_score'],
                    'opponent_score': event['away_score'],
                    'result': 'win' if event['home_score'] > event['away_score'] else 
                             ('loss' if event['home_score'] < event['away_score'] else 'draw'),
                    'rating_before': event['home_rating_before'],
                    'rating_after': event['home_rating_after'],
                    'rating_change': event['rating_change'],
                    'margin_error': event.get('margin_error', None)
                }
                
                away_row = {
                    'event': 'match',
                    'match_id': event['match_id'],
                    'date': event['match_date'],
                    'year': event['year'],
                    'round': event['round_number'],
                    'team': event['away_team'],
                    'opponent': event['home_team'],
                    'score': event['away_score'],
                    'opponent_score': event['home_score'],
                    'result': 'win' if event['away_score'] > event['home_score'] else 
                             ('loss' if event['away_score'] < event['home_score'] else 'draw'),
                    'rating_before': event['away_rating_before'],
                    'rating_after': event['away_rating_after'],
                    'rating_change': -event['rating_change'],
                    'margin_error': -event.get('margin_error', 0) if event.get('margin_error') is not None else None
                }
                
                rows.extend([home_row, away_row])
                
            elif event_type == 'season_carryover':
                # For season carryover, add a row for each team
                for team, rating_before in event['ratings_before'].items():
                    rating_after = event['ratings_after'][team]
                    
                    carryover_row = {
                        'event': 'season_carryover',
                        'date': None,
                        'year': event['year'],
                        'round': None,
                        'team': team,
                        'opponent': None,
                        'rating_before': rating_before,
                        'rating_after': rating_after,
                        'rating_change': rating_after - rating_before,
                        'margin_error': None
                    }
                    
                    rows.append(carryover_row)
        
        # Create DataFrame from all rows
        df = pd.DataFrame(rows)
        
        # Sort by date and match_id
        if 'date' in df.columns and not df['date'].isna().all():
            df = df.sort_values(['date', 'match_id'])
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        
        # Save to CSV
        df.to_csv(filename, index=False)
        print(f"Saved rating history with {len(df)} records to {filename}")


# fetch_matches function replaced by data_io.fetch_matches_for_prediction


def predict_matches(model_path, db_path='data/database/afl_predictions.db', start_year=2025, 
                   output_dir='.', save_to_db=True, predictor_id=7, override_completed=False):
    """
    Make margin-only ELO predictions for matches starting from specified year
    """
    # Load the predictor
    predictor = AFLMarginEloPredictor(model_path)
    
    # Get matches from database using core function
    matches = fetch_matches_for_prediction(db_path, start_year)
    
    if len(matches) == 0:
        print(f"No matches found from year {start_year} onwards")
        return
    
    # Get the years in the dataset
    years = matches['year'].unique()
    years.sort()
    
    print(f"Found {len(matches)} matches from {years.min()} to {years.max()}")
    
    # Check if we need to apply season carryover for the starting year
    # This happens when start_year is greater than the last year in the model's yearly_ratings
    if hasattr(predictor, 'yearly_ratings') and predictor.yearly_ratings:
        last_trained_year = max(map(int, predictor.yearly_ratings.keys()))
        if start_year > last_trained_year:
            print(f"Model trained through {last_trained_year}, applying season carryover for {start_year}")
            predictor.apply_season_carryover(start_year)
    
    # Track the current year to detect year changes
    current_year = None
    
    # Process matches in chronological order
    for i, match in matches.iterrows():
        match_year = match['year']
        
        # Apply season carryover at the start of a new season (but not for the first year if already handled above)
        if current_year is not None and match_year != current_year:
            predictor.apply_season_carryover(match_year)
        
        current_year = match_year
        
        # Determine if match has scores (completed)
        has_scores = not pd.isna(match['hscore']) and not pd.isna(match['ascore'])
        
        if has_scores:
            # For completed matches, update ratings
            predictor.update_ratings(
                home_team=match['home_team'],
                away_team=match['away_team'],
                hscore=match['hscore'],
                ascore=match['ascore'],
                match_id=match['match_id'],
                year=match['year'],
                round_number=match['round_number'],
                match_date=match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                venue=match['venue']
            )
        else:
            # For future matches, just predict without updating
            predictor.predict_match(
                home_team=match['home_team'],
                away_team=match['away_team'],
                match_id=match['match_id'],
                year=match['year'],
                round_number=match['round_number'],
                match_date=match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                venue=match['venue']
            )
    
    # Save predictions
    os.makedirs(output_dir, exist_ok=True)

    # Save predictions to CSV
    predictions_dir = os.path.join("data/predictions/margin")
    os.makedirs(predictions_dir, exist_ok=True)
    csv_filename = os.path.join(predictions_dir, f'margin_elo_predictions_{years.min()}_{years.max()}.csv')
    predictor.save_predictions_to_csv(csv_filename)

    print(f"\nSaved margin-only ELO predictions to: {csv_filename}")
    print("  - Win probabilities: Derived from margin predictions")
    print("  - Margins: Margin-only ELO model (rating_diff * margin_scale)")

    # Save to database if requested
    if save_to_db:
        save_predictions_to_database(predictor.predictions, db_path, predictor_id, 
                                    override_completed=override_completed)
    
    # Always save rating history for charts
    history_file = os.path.join(output_dir, f"margin_elo_rating_history_from_{start_year}.csv")
    predictor.save_rating_history_to_csv(history_file)
    
    # Evaluate the model on completed matches
    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    
    if completed_predictions:
        # Enhanced evaluation with BITS scoring
        print(f"\nPrediction Performance on {len(completed_predictions)} completed matches:")
        
        # Use comprehensive scoring from core module
        evaluation_results = evaluate_predictions(completed_predictions)
        print(format_scoring_summary(evaluation_results))
        
        # Additional margin-specific metrics
        mae_scores = []
        for p in completed_predictions:
            if 'predicted_margin' in p and 'margin' in p:
                mae = abs(p['predicted_margin'] - p['margin'])
                mae_scores.append(mae)
        
        if mae_scores:
            avg_mae = np.mean(mae_scores)
            print(f"\nMargin-Specific Metrics:")
            print(f"  Margin MAE: {avg_mae:.2f}")
            print(f"  Margin predictions evaluated: {len(mae_scores)}/{len(completed_predictions)}")
        else:
            print("\nMargin MAE: No margin data available for evaluation")
    else:
        print("\nNo completed matches found to evaluate prediction accuracy")
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(predictor.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


def main():
    """Main function to make margin-only ELO predictions"""
    parser = argparse.ArgumentParser(description='Make AFL Margin-Only ELO predictions')
    parser.add_argument('--start-year', type=int, required=True,
                        help='Start year for predictions (inclusive)')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to the trained margin-only ELO model JSON file')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='data/predictions/margin',
                        help='Directory to save output files')
    parser.add_argument('--save-to-db', action='store_true', default=True,
                        help='Save predictions directly to database (default: True)')
    parser.add_argument('--no-save-to-db', dest='save_to_db', action='store_false',
                        help='Disable database saving, use CSV output instead')
    parser.add_argument('--predictor-id', type=int, default=7,
                        help='Predictor ID for database storage (default: 7 for margin-only ELO)')
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