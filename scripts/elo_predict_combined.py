import json
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import os
import argparse

# Import core modules
from core.data_io import (
    connect_sqlite,
    fetch_matches_for_prediction,
    save_predictions_to_csv,
    save_predictions_to_database,
    load_model
)
from core.elo_core import AFLEloModel, MarginEloModel
from core.home_advantage import resolve_contextual_home_advantage
from core.scoring import evaluate_predictions, format_scoring_summary


def parse_match_datetime(match_date_str):
    """Parse known match datetime formats into a timezone-aware UTC datetime."""
    if 'T' in match_date_str and 'Z' in match_date_str:
        return datetime.fromisoformat(match_date_str.replace('Z', '+00:00'))

    if 'T' in match_date_str:
        parsed = datetime.fromisoformat(match_date_str)
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    if ' ' in match_date_str:
        return datetime.strptime(match_date_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)

    return datetime.strptime(match_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)


def filter_future_predictions(predictions, verbose=False):
    """Keep only predictions for games that are incomplete and have not started."""
    current_time = datetime.now(timezone.utc)
    future_predictions = []

    for prediction in predictions:
        if 'actual_result' in prediction:
            continue

        match_date_str = prediction.get('match_date')
        if not match_date_str:
            if verbose:
                print(
                    f"Warning: No match date for match {prediction.get('match_id', 'unknown')}, including prediction"
                )
            future_predictions.append(prediction)
            continue

        try:
            match_date = parse_match_datetime(match_date_str)
            if match_date > current_time:
                future_predictions.append(prediction)
            elif verbose:
                print(f"Skipping match {prediction.get('match_id', 'unknown')} - game has started ({match_date_str})")
        except (ValueError, TypeError):
            if verbose:
                print(
                    f"Warning: Could not parse match date '{match_date_str}' for match {prediction.get('match_id', 'unknown')}, including prediction"
                )
            future_predictions.append(prediction)

    return future_predictions


class AFLCombinedEloPredictor:
    """
    Combined ELO predictor using both win and margin-only models for optimal predictions
    - Win predictions from win ELO model
    - Margin predictions from margin-only ELO model
    """
    def __init__(self, win_model_path, margin_model_path):
        """
        Initialize the combined ELO predictor
        
        Parameters:
        -----------
        win_model_path: str
            Path to the saved win ELO model JSON file
        margin_model_path: str
            Path to the saved margin-only ELO model JSON file
        """
        # Initialize empty attributes
        self.win_ratings = {}
        self.margin_ratings = {}
        self.win_params = {}
        self.margin_params = {}
        
        # Load both models
        if not self.load_win_model(win_model_path):
            raise ValueError(f"Failed to load win ELO model from {win_model_path}")
            
        if not self.load_margin_model(margin_model_path):
            raise ValueError(f"Failed to load margin-only ELO model from {margin_model_path}")
        
        self.predictions = []
        self.rating_history = []
    
    def load_win_model(self, model_path):
        """Load the trained win ELO model using core function"""
        try:
            model_data = load_model(model_path)
            
            # Verify this is a win ELO model
            if model_data.get('model_type') == 'margin_only_elo':
                raise ValueError("Expected win ELO model, got margin-only model")
            
            # Set parameters
            self.win_params = model_data['parameters']
            self.base_rating = self.win_params['base_rating']
            self.k_factor = self.win_params['k_factor']
            self.home_advantage = self.win_params['home_advantage']
            self.win_default_home_advantage = self.win_params.get(
                'default_home_advantage',
                self.win_params['home_advantage']
            )
            self.win_interstate_home_advantage = self.win_params.get(
                'interstate_home_advantage',
                self.win_params['home_advantage']
            )
            self.win_team_states = self.win_params.get('team_states', {})
            self.season_carryover = self.win_params['season_carryover']
            self.max_margin = self.win_params['max_margin']
            
            # win ELO model parameters
            if 'margin_factor' not in self.win_params:
                raise ValueError("win ELO model missing required 'margin_factor' parameter")
            if 'beta' not in self.win_params:
                raise ValueError("win ELO model missing required 'beta' parameter")
                
            self.margin_factor = self.win_params['margin_factor']
            self.beta = self.win_params['beta']
            
            # Set team ratings
            if 'team_ratings' not in model_data:
                raise ValueError("Model file missing required 'team_ratings' data")
            self.win_ratings = model_data['team_ratings']
            
            print(f"Loaded win ELO model with {len(self.win_ratings)} team ratings")
            print("Win model parameters:")
            for param, value in self.win_params.items():
                print(f"  {param}: {value}")
                
            return True
        except Exception as e:
            print(f"Error loading win model: {e}")
            return False
    
    def load_margin_model(self, model_path):
        """Load the trained margin-only ELO model using core function"""
        try:
            model_data = load_model(model_path)
            
            # Verify this is a margin-only model
            if model_data.get('model_type') not in ['margin_only_elo', 'margin_elo']:
                raise ValueError("Expected margin-only ELO model, got win model")
            
            # Set parameters
            self.margin_params = model_data['parameters']
            self.margin_scale = self.margin_params['margin_scale']
            self.scaling_factor = self.margin_params['scaling_factor']
            self.margin_home_advantage = self.margin_params.get(
                'home_advantage',
                self.home_advantage
            )
            self.margin_default_home_advantage = self.margin_params.get(
                'default_home_advantage',
                self.margin_home_advantage
            )
            self.margin_interstate_home_advantage = self.margin_params.get(
                'interstate_home_advantage',
                self.margin_home_advantage
            )
            self.margin_team_states = self.margin_params.get('team_states', {})
            
            # Set team ratings
            if 'team_ratings' not in model_data:
                raise ValueError("Margin model file missing required 'team_ratings' data")
            self.margin_ratings = model_data['team_ratings']
            
            # Store yearly ratings if available for season carryover detection
            self.yearly_ratings = model_data.get('yearly_ratings', {})
            
            print(f"Loaded margin-only ELO model with {len(self.margin_ratings)} team ratings")
            print(f"Margin model MAE: {model_data.get('mae', 'unknown')}")
            print("Margin model parameters:")
            for param, value in self.margin_params.items():
                print(f"  {param}: {value}")
                
            return True
        except Exception as e:
            print(f"Error loading margin model: {e}")
            return False
    
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def get_win_home_advantage(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        return resolve_contextual_home_advantage(
            default_home_advantage=self.win_default_home_advantage,
            interstate_home_advantage=self.win_interstate_home_advantage,
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state,
            team_states=self.win_team_states
        )

    def get_margin_home_advantage(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        return resolve_contextual_home_advantage(
            default_home_advantage=self.margin_default_home_advantage,
            interstate_home_advantage=self.margin_interstate_home_advantage,
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state,
            team_states=self.margin_team_states
        )

    def calculate_win_probability(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        """Calculate probability of home team winning using win ELO model"""
        home_rating = self.win_ratings.get(home_team, self.base_rating)
        away_rating = self.win_ratings.get(away_team, self.base_rating)
        
        applied_home_advantage = self.get_win_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        rating_diff = (home_rating + applied_home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def predict_margin(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        """Predict match margin using margin-only ELO model"""
        home_rating = self.margin_ratings.get(home_team, self.base_rating)
        away_rating = self.margin_ratings.get(away_team, self.base_rating)
        
        applied_home_advantage = self.get_margin_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        rating_diff = (home_rating + applied_home_advantage) - away_rating
        
        # Use margin_scale to convert rating difference to margin
        predicted_margin = rating_diff * self.margin_scale
        
        return predicted_margin
    
    def predict_margin_builtin(
        self,
        home_team,
        away_team,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        """Predict margin using built-in ELO calculation from win model"""
        win_prob = self.calculate_win_probability(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        predicted_margin = (win_prob - 0.5) / self.beta
        return predicted_margin
    
    def apply_season_carryover(self, new_year):
        """Apply regression to mean between seasons for both models"""
        print(f"Applying season carryover for {new_year}...")
        
        # Store current ratings before carryover
        win_ratings_before = self.win_ratings.copy()
        margin_ratings_before = self.margin_ratings.copy()
        
        # Apply carryover to win model
        for team in self.win_ratings:
            self.win_ratings[team] = self.base_rating + self.season_carryover * (self.win_ratings[team] - self.base_rating)
        
        # Apply carryover to margin model using margin model's carryover parameter
        margin_carryover = self.margin_params['season_carryover']
        for team in self.margin_ratings:
            self.margin_ratings[team] = self.base_rating + margin_carryover * (self.margin_ratings[team] - self.base_rating)
        
        # Store the ratings transition in history
        self.rating_history.append({
            'event': 'season_carryover',
            'year': new_year,
            'win_ratings_before': win_ratings_before,
            'win_ratings_after': self.win_ratings.copy(),
            'margin_ratings_before': margin_ratings_before,
            'margin_ratings_after': self.margin_ratings.copy()
        })
    
    def update_ratings(
        self,
        home_team,
        away_team,
        hscore,
        ascore,
        match_id=None,
        year=None,
        round_number=None,
        match_date=None,
        venue=None,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        """
        Update team ratings based on match result for both models
        """
        # Ensure teams exist in both rating systems
        if home_team not in self.win_ratings:
            print(f"Warning: {home_team} not found in win ratings, using base rating")
            self.win_ratings[home_team] = self.base_rating
            
        if away_team not in self.win_ratings:
            print(f"Warning: {away_team} not found in win ratings, using base rating")
            self.win_ratings[away_team] = self.base_rating
            
        if home_team not in self.margin_ratings:
            print(f"Warning: {home_team} not found in margin ratings, using base rating")
            self.margin_ratings[home_team] = self.base_rating
            
        if away_team not in self.margin_ratings:
            print(f"Warning: {away_team} not found in margin ratings, using base rating")
            self.margin_ratings[away_team] = self.base_rating
        
        # Get current ratings
        win_home_rating = self.win_ratings[home_team]
        win_away_rating = self.win_ratings[away_team]
        margin_home_rating = self.margin_ratings[home_team]
        margin_away_rating = self.margin_ratings[away_team]

        win_home_advantage = self.get_win_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        margin_home_advantage = self.get_margin_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        
        # Calculate predictions using both models
        home_win_prob = self.calculate_win_probability(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        predicted_margin = self.predict_margin(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        predicted_margin_builtin = self.predict_margin_builtin(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        
        # Store the pre-update prediction info
        prediction_info = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'win_home_rating': win_home_rating,
            'win_away_rating': win_away_rating,
            'margin_home_rating': margin_home_rating,
            'margin_away_rating': margin_away_rating,
            'win_rating_difference': win_home_rating - win_away_rating,
            'margin_rating_difference': margin_home_rating - margin_away_rating,
            'win_applied_home_advantage': win_home_advantage,
            'margin_applied_home_advantage': margin_home_advantage,
            'adjusted_win_rating_difference': (win_home_rating + win_home_advantage) - win_away_rating,
            'adjusted_margin_rating_difference': (margin_home_rating + margin_home_advantage) - margin_away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'predicted_margin': predicted_margin,  # From margin-only model
            'predicted_margin_builtin': predicted_margin_builtin,  # From win model
            'margin_method_used_in_db': 'margin_only_elo',  # Which method is saved to database
        }
        
        # If scores are provided, update ratings for both models
        if hscore is not None and ascore is not None:
            # Calculate actual margin
            actual_margin = hscore - ascore
            capped_margin = self._cap_margin(actual_margin)
            
            # Update win model ratings
            actual_result = 1.0 if hscore > ascore else 0.0
            if hscore == ascore:
                actual_result = 0.5
            
            # Win model: use margin-adjusted K-factor
            margin_multiplier = 1.0
            if self.margin_factor > 0:
                margin_multiplier = np.log1p(abs(capped_margin) * self.margin_factor) / np.log1p(self.max_margin * self.margin_factor)
            
            win_rating_change = self.k_factor * margin_multiplier * (actual_result - home_win_prob)
            
            # Update win ratings
            self.win_ratings[home_team] += win_rating_change
            self.win_ratings[away_team] -= win_rating_change
            
            # Update margin model ratings
            margin_error = predicted_margin - actual_margin
            margin_rating_change = -self.margin_params['k_factor'] * margin_error / self.scaling_factor
            
            # Update margin ratings
            self.margin_ratings[home_team] += margin_rating_change
            self.margin_ratings[away_team] -= margin_rating_change
            
            # Determine actual result
            actual_result_str = 'home_win' if hscore > ascore else ('away_win' if hscore < ascore else 'draw')
            
            # Add result info to prediction
            prediction_info.update({
                'hscore': hscore,
                'ascore': ascore,
                'actual_result': actual_result_str,
                'margin': actual_margin,
                'margin_error': margin_error,
                'win_rating_change': win_rating_change,
                'margin_rating_change': margin_rating_change,
                'post_win_home_rating': self.win_ratings[home_team],
                'post_win_away_rating': self.win_ratings[away_team],
                'post_margin_home_rating': self.margin_ratings[home_team],
                'post_margin_away_rating': self.margin_ratings[away_team],
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
                'win_home_rating_before': win_home_rating,
                'win_away_rating_before': win_away_rating,
                'win_home_rating_after': self.win_ratings[home_team],
                'win_away_rating_after': self.win_ratings[away_team],
                'win_rating_change': win_rating_change,
                'margin_home_rating_before': margin_home_rating,
                'margin_away_rating_before': margin_away_rating,
                'margin_home_rating_after': self.margin_ratings[home_team],
                'margin_away_rating_after': self.margin_ratings[away_team],
                'margin_rating_change': margin_rating_change,
                'margin_error': margin_error
            })
        
        # Store the prediction
        self.predictions.append(prediction_info)
        
        return prediction_info
    
    def predict_match(
        self,
        home_team,
        away_team,
        match_id=None,
        year=None,
        round_number=None,
        match_date=None,
        venue=None,
        venue_state=None,
        home_team_state=None,
        away_team_state=None
    ):
        """
        Predict the outcome of a match without updating ratings
        """
        # Check if teams exist in both rating systems
        if home_team not in self.win_ratings:
            print(f"Warning: {home_team} not found in win ratings, using base rating")
            self.win_ratings[home_team] = self.base_rating
            
        if away_team not in self.win_ratings:
            print(f"Warning: {away_team} not found in win ratings, using base rating")
            self.win_ratings[away_team] = self.base_rating
            
        if home_team not in self.margin_ratings:
            print(f"Warning: {home_team} not found in margin ratings, using base rating")
            self.margin_ratings[home_team] = self.base_rating
            
        if away_team not in self.margin_ratings:
            print(f"Warning: {away_team} not found in margin ratings, using base rating")
            self.margin_ratings[away_team] = self.base_rating
        
        # Get current ratings
        win_home_rating = self.win_ratings[home_team]
        win_away_rating = self.win_ratings[away_team]
        margin_home_rating = self.margin_ratings[home_team]
        margin_away_rating = self.margin_ratings[away_team]

        win_home_advantage = self.get_win_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        margin_home_advantage = self.get_margin_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        
        # Calculate predictions using both models
        home_win_prob = self.calculate_win_probability(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        predicted_margin = self.predict_margin(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        predicted_margin_builtin = self.predict_margin_builtin(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )
        
        # Create prediction result
        prediction = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'win_home_rating': win_home_rating,
            'win_away_rating': win_away_rating,
            'margin_home_rating': margin_home_rating,
            'margin_away_rating': margin_away_rating,
            'win_rating_difference': win_home_rating - win_away_rating,
            'margin_rating_difference': margin_home_rating - margin_away_rating,
            'win_applied_home_advantage': win_home_advantage,
            'margin_applied_home_advantage': margin_home_advantage,
            'adjusted_win_rating_difference': (win_home_rating + win_home_advantage) - win_away_rating,
            'adjusted_margin_rating_difference': (margin_home_rating + margin_home_advantage) - margin_away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_margin': predicted_margin,  # From margin-only model
            'predicted_margin_builtin': predicted_margin_builtin,  # From win model
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'margin_method_used_in_db': 'margin_only_elo',  # Which method is saved to database
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
    
    def save_predictions_to_database(self, db_path, predictor_id=6):
        """
        Save predictions directly to the database
        Note: Using predictor_id=6 by default for combined ELO
        """
        conn = connect_sqlite(db_path)
        cursor = conn.cursor()
        
        try:
            future_predictions = filter_future_predictions(self.predictions, verbose=True)
            
            if not future_predictions:
                print("No future match predictions to save (all games completed or started)")
                return
            
            print(f"Saving {len(future_predictions)} combined predictions to database for predictor {predictor_id}")
            
            # Begin transaction
            cursor.execute("BEGIN TRANSACTION")
            
            # Delete existing predictions for these matches
            match_ids = [p['match_id'] for p in future_predictions]
            placeholders = ','.join(['?' for _ in match_ids])
            cursor.execute(
                f"DELETE FROM predictions WHERE predictor_id = ? AND match_id IN ({placeholders})",
                [predictor_id] + match_ids
            )
            deleted_count = cursor.rowcount
            print(f"Deleted {deleted_count} existing combined ELO predictions")
            
            # Insert new predictions
            insert_count = 0
            for pred in future_predictions:
                # Convert probability to percentage (0-100)
                home_prob_pct = int(round(pred['home_win_probability'] * 100))
                
                # Determine tipped team
                if home_prob_pct >= 50:
                    tipped_team = 'home'
                else:
                    tipped_team = 'away'
                
                # Handle exact 50% predictions - default to home
                if home_prob_pct == 50:
                    tipped_team = 'home'
                
                # Use margin from margin-only model
                margin_value = round(pred['predicted_margin'], 1)
                
                cursor.execute(
                    """INSERT INTO predictions 
                       (match_id, predictor_id, home_win_probability, predicted_margin, tipped_team) 
                       VALUES (?, ?, ?, ?, ?)""",
                    (pred['match_id'], 
                     predictor_id, 
                     home_prob_pct,
                     margin_value,
                     tipped_team)
                )
                insert_count += 1
            
            # Commit transaction
            cursor.execute("COMMIT")
            print(f"Successfully saved {insert_count} combined predictions to database")
            
        except Exception as e:
            cursor.execute("ROLLBACK")
            print(f"Error saving predictions to database: {e}")
            raise
        finally:
            conn.close()
    
    def save_rating_history_to_csv(self, filename):
        """Save rating history to CSV file for both models"""
        if not self.rating_history:
            print("No rating history to save")
            return
        
        # Convert to DataFrame
        rows = []
        
        # Process each event
        for event in self.rating_history:
            event_type = event['event']
            
            if event_type == 'match':
                # For match events, add a row for each team with both model ratings
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
                    'win_rating_before': event['win_home_rating_before'],
                    'win_rating_after': event['win_home_rating_after'],
                    'win_rating_change': event['win_rating_change'],
                    'margin_rating_before': event['margin_home_rating_before'],
                    'margin_rating_after': event['margin_home_rating_after'],
                    'margin_rating_change': event['margin_rating_change'],
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
                    'win_rating_before': event['win_away_rating_before'],
                    'win_rating_after': event['win_away_rating_after'],
                    'win_rating_change': -event['win_rating_change'],
                    'margin_rating_before': event['margin_away_rating_before'],
                    'margin_rating_after': event['margin_away_rating_after'],
                    'margin_rating_change': -event['margin_rating_change'],
                    'margin_error': -event.get('margin_error', 0) if event.get('margin_error') is not None else None
                }
                
                rows.extend([home_row, away_row])
                
            elif event_type == 'season_carryover':
                # For season carryover, add a row for each team with both model ratings
                for team in event['win_ratings_before'].keys():
                    win_rating_before = event['win_ratings_before'][team]
                    win_rating_after = event['win_ratings_after'][team]
                    margin_rating_before = event['margin_ratings_before'][team]
                    margin_rating_after = event['margin_ratings_after'][team]
                    
                    carryover_row = {
                        'event': 'season_carryover',
                        'date': None,
                        'year': event['year'],
                        'round': None,
                        'team': team,
                        'opponent': None,
                        'win_rating_before': win_rating_before,
                        'win_rating_after': win_rating_after,
                        'win_rating_change': win_rating_after - win_rating_before,
                        'margin_rating_before': margin_rating_before,
                        'margin_rating_after': margin_rating_after,
                        'margin_rating_change': margin_rating_after - margin_rating_before,
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


def predict_matches(win_model_path, margin_model_path, db_path='data/database/afl_predictions.db', 
                   start_year=2025, output_dir='.', save_to_db=True, predictor_id=6, future_only=False):
    """
    Make combined ELO predictions for matches starting from specified year
    """
    # Load the predictor
    predictor = AFLCombinedEloPredictor(win_model_path, margin_model_path)
    
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
        
        # Apply season carryover at the start of a new season
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
                venue=match['venue'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
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
                venue=match['venue'],
                venue_state=match.get('venue_state'),
                home_team_state=match.get('home_team_state'),
                away_team_state=match.get('away_team_state')
            )

    if future_only:
        total_predictions = len(predictor.predictions)
        predictor.predictions = filter_future_predictions(predictor.predictions, verbose=False)
        print(
            f"Future-only mode enabled: kept {len(predictor.predictions)} of {total_predictions} predictions"
        )
    
    # Save predictions
    os.makedirs(output_dir, exist_ok=True)

    # Save predictions to CSV
    predictions_dir = os.path.join("data/predictions/combined")
    os.makedirs(predictions_dir, exist_ok=True)
    csv_filename = os.path.join(predictions_dir, f'combined_elo_predictions_{years.min()}_{years.max()}.csv')
    predictor.save_predictions_to_csv(csv_filename)

    print("Combined ELO model details:")
    print("  - Win probabilities: win ELO model")
    print("  - Margins: Margin-only ELO model")
    print("  - CSV includes both margin prediction methods for comparison")

    # Save to database if requested
    if save_to_db:
        predictor.save_predictions_to_database(db_path, predictor_id)
    
    # Always save rating history for charts
    history_file = os.path.join(output_dir, f"combined_elo_rating_history_from_{start_year}.csv")
    predictor.save_rating_history_to_csv(history_file)
    
    # Evaluate the model on completed matches
    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    
    if completed_predictions:
        correct_count = sum(1 for p in completed_predictions if p.get('correct', False))
        accuracy = correct_count / len(completed_predictions)
        
        # Calculate Brier score
        brier_scores = []
        mae_scores_margin = []
        mae_scores_builtin = []
        
        for p in completed_predictions:
            # Convert actual result to probability (1.0 for home win, 0.0 for away win, 0.5 for draw)
            if p['actual_result'] == 'home_win':
                actual_prob = 1.0
            elif p['actual_result'] == 'away_win':
                actual_prob = 0.0
            else:  # draw
                actual_prob = 0.5
            
            # Brier score: (predicted_prob - actual_prob)^2
            predicted_prob = p['home_win_probability']
            brier_score = (predicted_prob - actual_prob) ** 2
            brier_scores.append(brier_score)
            
            # MAE for both margin prediction methods
            if 'predicted_margin' in p and 'margin' in p:
                mae_margin = abs(p['predicted_margin'] - p['margin'])
                mae_scores_margin.append(mae_margin)
                
            if 'predicted_margin_builtin' in p and 'margin' in p:
                mae_builtin = abs(p['predicted_margin_builtin'] - p['margin'])
                mae_scores_builtin.append(mae_builtin)
        
        avg_brier = np.mean(brier_scores)
        avg_mae_margin = np.mean(mae_scores_margin) if mae_scores_margin else None
        avg_mae_builtin = np.mean(mae_scores_builtin) if mae_scores_builtin else None
        
        # Use comprehensive evaluation including BITS scoring
        print(f"\nDetailed Combined Model Performance:")
        evaluation_results = evaluate_predictions(completed_predictions)
        print(format_scoring_summary(evaluation_results))
        
        # Additional margin evaluation for both models
        if avg_mae_margin is not None:
            print(f"  Margin MAE (Margin-only model): {avg_mae_margin:.2f}")
        if avg_mae_builtin is not None:
            print(f"  Margin MAE (Built-in ELO): {avg_mae_builtin:.2f}")
        if avg_mae_margin is None and avg_mae_builtin is None:
            print("  Margin MAE: No margin data available")
    else:
        print("\nNo completed matches found to evaluate prediction accuracy")
    
    # Display final team ratings for both models
    print("\nFinal win ELO Ratings:")
    win_standard = sorted(predictor.win_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in win_standard:
        print(f"  {team}: {rating:.1f}")
    
    print("\nFinal Margin ELO Ratings:")
    sorted_margin = sorted(predictor.margin_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_margin:
        print(f"  {team}: {rating:.1f}")


def main():
    """Main function to make combined ELO predictions"""
    parser = argparse.ArgumentParser(description='Make AFL Combined ELO predictions')
    parser.add_argument('--start-year', type=int, required=True,
                        help='Start year for predictions (inclusive)')
    parser.add_argument('--win-model', type=str, required=True,
                        help='Path to the trained win ELO model JSON file')
    parser.add_argument('--margin-model', type=str, required=True,
                        help='Path to the trained margin-only ELO model JSON file')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='data/predictions/combined',
                        help='Directory to save output files')
    parser.add_argument('--save-to-db', action='store_true', default=True,
                        help='Save predictions directly to database (default: True)')
    parser.add_argument('--no-save-to-db', dest='save_to_db', action='store_false',
                        help='Disable database saving, use CSV output instead')
    parser.add_argument('--predictor-id', type=int, default=6,
                        help='Predictor ID for database storage (default: 6 for combined ELO)')
    parser.add_argument('--future-only', action='store_true',
                        help='Only output predictions for upcoming matches')

    args = parser.parse_args()
    
    predict_matches(
        win_model_path=args.win_model,
        margin_model_path=args.margin_model,
        db_path=args.db_path,
        start_year=args.start_year,
        output_dir=args.output_dir,
        save_to_db=args.save_to_db,
        predictor_id=args.predictor_id,
        future_only=args.future_only
    )


if __name__ == '__main__':
    main()
