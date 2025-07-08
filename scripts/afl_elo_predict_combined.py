import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import os
import argparse


class AFLCombinedEloPredictor:
    """
    Combined ELO predictor using both standard and margin-only models for optimal predictions
    - Win predictions from standard ELO model
    - Margin predictions from margin-only ELO model
    """
    def __init__(self, standard_model_path, margin_model_path):
        """
        Initialize the combined ELO predictor
        
        Parameters:
        -----------
        standard_model_path: str
            Path to the saved standard ELO model JSON file
        margin_model_path: str
            Path to the saved margin-only ELO model JSON file
        """
        # Initialize empty attributes
        self.standard_ratings = {}
        self.margin_ratings = {}
        self.standard_params = {}
        self.margin_params = {}
        
        # Load both models
        if not self.load_standard_model(standard_model_path):
            raise ValueError(f"Failed to load standard ELO model from {standard_model_path}")
            
        if not self.load_margin_model(margin_model_path):
            raise ValueError(f"Failed to load margin-only ELO model from {margin_model_path}")
        
        self.predictions = []
        self.rating_history = []
    
    def load_standard_model(self, model_path):
        """Load the trained standard ELO model"""
        try:
            with open(model_path, 'r') as f:
                model_data = json.load(f)
            
            # Verify this is a standard ELO model
            if model_data.get('model_type') == 'margin_only_elo':
                raise ValueError("Expected standard ELO model, got margin-only model")
            
            # Set parameters
            self.standard_params = model_data['parameters']
            self.base_rating = self.standard_params['base_rating']
            self.k_factor = self.standard_params['k_factor']
            self.home_advantage = self.standard_params['home_advantage']
            self.season_carryover = self.standard_params['season_carryover']
            self.max_margin = self.standard_params['max_margin']
            
            # Standard ELO model parameters
            if 'margin_factor' not in self.standard_params:
                raise ValueError("Standard ELO model missing required 'margin_factor' parameter")
            if 'beta' not in self.standard_params:
                raise ValueError("Standard ELO model missing required 'beta' parameter")
                
            self.margin_factor = self.standard_params['margin_factor']
            self.beta = self.standard_params['beta']
            
            # Set team ratings
            if 'team_ratings' not in model_data:
                raise ValueError("Model file missing required 'team_ratings' data")
            self.standard_ratings = model_data['team_ratings']
            
            print(f"Loaded standard ELO model with {len(self.standard_ratings)} team ratings")
            print("Standard model parameters:")
            for param, value in self.standard_params.items():
                print(f"  {param}: {value}")
                
            return True
        except Exception as e:
            print(f"Error loading standard model: {e}")
            return False
    
    def load_margin_model(self, model_path):
        """Load the trained margin-only ELO model"""
        try:
            with open(model_path, 'r') as f:
                model_data = json.load(f)
            
            # Verify this is a margin-only model
            if model_data.get('model_type') != 'margin_only_elo':
                raise ValueError("Expected margin-only ELO model, got standard model")
            
            # Set parameters
            self.margin_params = model_data['parameters']
            self.margin_scale = self.margin_params['margin_scale']
            self.scaling_factor = self.margin_params['scaling_factor']
            
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
    
    def calculate_win_probability(self, home_team, away_team):
        """Calculate probability of home team winning using standard ELO model"""
        home_rating = self.standard_ratings.get(home_team, self.base_rating)
        away_rating = self.standard_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def predict_margin(self, home_team, away_team):
        """Predict match margin using margin-only ELO model"""
        home_rating = self.margin_ratings.get(home_team, self.base_rating)
        away_rating = self.margin_ratings.get(away_team, self.base_rating)
        
        # Apply home ground advantage
        rating_diff = (home_rating + self.home_advantage) - away_rating
        
        # Use margin_scale to convert rating difference to margin
        predicted_margin = rating_diff * self.margin_scale
        
        return predicted_margin
    
    def predict_margin_builtin(self, home_team, away_team):
        """Predict margin using built-in ELO calculation from standard model"""
        win_prob = self.calculate_win_probability(home_team, away_team)
        predicted_margin = (win_prob - 0.5) / self.beta
        return predicted_margin
    
    def apply_season_carryover(self, new_year):
        """Apply regression to mean between seasons for both models"""
        print(f"Applying season carryover for {new_year}...")
        
        # Store current ratings before carryover
        standard_ratings_before = self.standard_ratings.copy()
        margin_ratings_before = self.margin_ratings.copy()
        
        # Apply carryover to standard model
        for team in self.standard_ratings:
            self.standard_ratings[team] = self.base_rating + self.season_carryover * (self.standard_ratings[team] - self.base_rating)
        
        # Apply carryover to margin model using margin model's carryover parameter
        margin_carryover = self.margin_params['season_carryover']
        for team in self.margin_ratings:
            self.margin_ratings[team] = self.base_rating + margin_carryover * (self.margin_ratings[team] - self.base_rating)
        
        # Store the ratings transition in history
        self.rating_history.append({
            'event': 'season_carryover',
            'year': new_year,
            'standard_ratings_before': standard_ratings_before,
            'standard_ratings_after': self.standard_ratings.copy(),
            'margin_ratings_before': margin_ratings_before,
            'margin_ratings_after': self.margin_ratings.copy()
        })
    
    def update_ratings(self, home_team, away_team, hscore, ascore, match_id=None, year=None, round_number=None, match_date=None, venue=None):
        """
        Update team ratings based on match result for both models
        """
        # Ensure teams exist in both rating systems
        if home_team not in self.standard_ratings:
            print(f"Warning: {home_team} not found in standard ratings, using base rating")
            self.standard_ratings[home_team] = self.base_rating
            
        if away_team not in self.standard_ratings:
            print(f"Warning: {away_team} not found in standard ratings, using base rating")
            self.standard_ratings[away_team] = self.base_rating
            
        if home_team not in self.margin_ratings:
            print(f"Warning: {home_team} not found in margin ratings, using base rating")
            self.margin_ratings[home_team] = self.base_rating
            
        if away_team not in self.margin_ratings:
            print(f"Warning: {away_team} not found in margin ratings, using base rating")
            self.margin_ratings[away_team] = self.base_rating
        
        # Get current ratings
        standard_home_rating = self.standard_ratings[home_team]
        standard_away_rating = self.standard_ratings[away_team]
        margin_home_rating = self.margin_ratings[home_team]
        margin_away_rating = self.margin_ratings[away_team]
        
        # Calculate predictions using both models
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        predicted_margin = self.predict_margin(home_team, away_team)
        predicted_margin_builtin = self.predict_margin_builtin(home_team, away_team)
        
        # Store the pre-update prediction info
        prediction_info = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'standard_home_rating': standard_home_rating,
            'standard_away_rating': standard_away_rating,
            'margin_home_rating': margin_home_rating,
            'margin_away_rating': margin_away_rating,
            'standard_rating_difference': standard_home_rating - standard_away_rating,
            'margin_rating_difference': margin_home_rating - margin_away_rating,
            'adjusted_standard_rating_difference': (standard_home_rating + self.home_advantage) - standard_away_rating,
            'adjusted_margin_rating_difference': (margin_home_rating + self.home_advantage) - margin_away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'predicted_margin': predicted_margin,  # From margin-only model
            'predicted_margin_builtin': predicted_margin_builtin,  # From standard model
            'margin_method_used_in_db': 'margin_only_elo',  # Which method is saved to database
        }
        
        # If scores are provided, update ratings for both models
        if hscore is not None and ascore is not None:
            # Calculate actual margin
            actual_margin = hscore - ascore
            capped_margin = self._cap_margin(actual_margin)
            
            # Update standard model ratings
            actual_result = 1.0 if hscore > ascore else 0.0
            if hscore == ascore:
                actual_result = 0.5
            
            # Standard model: use margin-adjusted K-factor
            margin_multiplier = 1.0
            if self.margin_factor > 0:
                margin_multiplier = np.log1p(abs(capped_margin) * self.margin_factor) / np.log1p(self.max_margin * self.margin_factor)
            
            standard_rating_change = self.k_factor * margin_multiplier * (actual_result - home_win_prob)
            
            # Update standard ratings
            self.standard_ratings[home_team] += standard_rating_change
            self.standard_ratings[away_team] -= standard_rating_change
            
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
                'standard_rating_change': standard_rating_change,
                'margin_rating_change': margin_rating_change,
                'post_standard_home_rating': self.standard_ratings[home_team],
                'post_standard_away_rating': self.standard_ratings[away_team],
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
                'standard_home_rating_before': standard_home_rating,
                'standard_away_rating_before': standard_away_rating,
                'standard_home_rating_after': self.standard_ratings[home_team],
                'standard_away_rating_after': self.standard_ratings[away_team],
                'standard_rating_change': standard_rating_change,
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
    
    def predict_match(self, home_team, away_team, match_id=None, year=None, round_number=None, match_date=None, venue=None):
        """
        Predict the outcome of a match without updating ratings
        """
        # Check if teams exist in both rating systems
        if home_team not in self.standard_ratings:
            print(f"Warning: {home_team} not found in standard ratings, using base rating")
            self.standard_ratings[home_team] = self.base_rating
            
        if away_team not in self.standard_ratings:
            print(f"Warning: {away_team} not found in standard ratings, using base rating")
            self.standard_ratings[away_team] = self.base_rating
            
        if home_team not in self.margin_ratings:
            print(f"Warning: {home_team} not found in margin ratings, using base rating")
            self.margin_ratings[home_team] = self.base_rating
            
        if away_team not in self.margin_ratings:
            print(f"Warning: {away_team} not found in margin ratings, using base rating")
            self.margin_ratings[away_team] = self.base_rating
        
        # Get current ratings
        standard_home_rating = self.standard_ratings[home_team]
        standard_away_rating = self.standard_ratings[away_team]
        margin_home_rating = self.margin_ratings[home_team]
        margin_away_rating = self.margin_ratings[away_team]
        
        # Calculate predictions using both models
        home_win_prob = self.calculate_win_probability(home_team, away_team)
        predicted_margin = self.predict_margin(home_team, away_team)
        predicted_margin_builtin = self.predict_margin_builtin(home_team, away_team)
        
        # Create prediction result
        prediction = {
            'match_id': match_id,
            'round_number': round_number,
            'match_date': match_date,
            'venue': venue,
            'year': year,
            'home_team': home_team,
            'away_team': away_team,
            'standard_home_rating': standard_home_rating,
            'standard_away_rating': standard_away_rating,
            'margin_home_rating': margin_home_rating,
            'margin_away_rating': margin_away_rating,
            'standard_rating_difference': standard_home_rating - standard_away_rating,
            'margin_rating_difference': margin_home_rating - margin_away_rating,
            'adjusted_standard_rating_difference': (standard_home_rating + self.home_advantage) - standard_away_rating,
            'adjusted_margin_rating_difference': (margin_home_rating + self.home_advantage) - margin_away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_margin': predicted_margin,  # From margin-only model
            'predicted_margin_builtin': predicted_margin_builtin,  # From standard model
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'margin_method_used_in_db': 'margin_only_elo',  # Which method is saved to database
        }
        
        # Store the prediction
        self.predictions.append(prediction)
        
        return prediction
    
    def save_predictions_to_csv(self, filename):
        """Save predictions to CSV file"""
        if not self.predictions:
            print("No predictions to save")
            return
        
        # Convert predictions to DataFrame
        df = pd.DataFrame(self.predictions)
        
        # Ensure directory exists
        os.makedirs(os.path.dirname(os.path.abspath(filename)), exist_ok=True)
        
        # Save to CSV
        df.to_csv(filename, index=False)
        print(f"Saved {len(df)} predictions to {filename}")
    
    def save_predictions_to_database(self, db_path, predictor_id=6):
        """
        Save predictions directly to the database
        Note: Using predictor_id=6 by default for combined ELO
        """
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        try:
            # Get current time in UTC for comparison
            current_time = datetime.now(timezone.utc)
            
            # Filter out completed games and games that have started
            future_predictions = []
            for p in self.predictions:
                # Skip if game is completed (has actual_result)
                if 'actual_result' in p:
                    continue
                
                # Skip if game has started (match_date is in the past)
                if p.get('match_date'):
                    try:
                        # Parse match date - handle multiple formats
                        match_date_str = p['match_date']
                        if 'T' in match_date_str and 'Z' in match_date_str:
                            # Full ISO format with timezone
                            match_date = datetime.fromisoformat(match_date_str.replace('Z', '+00:00'))
                        elif 'T' in match_date_str:
                            # ISO format without timezone: "2025-07-10T19:30:00"
                            match_date = datetime.fromisoformat(match_date_str).replace(tzinfo=timezone.utc)
                        elif ' ' in match_date_str:
                            # Format like "2025-03-07 19:40:00"
                            match_date = datetime.strptime(match_date_str, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                        else:
                            # Just date, add default time
                            match_date = datetime.strptime(match_date_str, '%Y-%m-%d').replace(tzinfo=timezone.utc)
                        
                        # Only include games that haven't started yet
                        if match_date > current_time:
                            future_predictions.append(p)
                        else:
                            print(f"Skipping match {p.get('match_id', 'unknown')} - game has started ({match_date_str})")
                    except (ValueError, TypeError) as e:
                        print(f"Warning: Could not parse match date '{match_date_str}' for match {p.get('match_id', 'unknown')}, including prediction")
                        future_predictions.append(p)
                else:
                    # No match date available - include the prediction with warning
                    print(f"Warning: No match date for match {p.get('match_id', 'unknown')}, including prediction")
                    future_predictions.append(p)
            
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
                    'standard_rating_before': event['standard_home_rating_before'],
                    'standard_rating_after': event['standard_home_rating_after'],
                    'standard_rating_change': event['standard_rating_change'],
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
                    'standard_rating_before': event['standard_away_rating_before'],
                    'standard_rating_after': event['standard_away_rating_after'],
                    'standard_rating_change': -event['standard_rating_change'],
                    'margin_rating_before': event['margin_away_rating_before'],
                    'margin_rating_after': event['margin_away_rating_after'],
                    'margin_rating_change': -event['margin_rating_change'],
                    'margin_error': -event.get('margin_error', 0) if event.get('margin_error') is not None else None
                }
                
                rows.extend([home_row, away_row])
                
            elif event_type == 'season_carryover':
                # For season carryover, add a row for each team with both model ratings
                for team in event['standard_ratings_before'].keys():
                    standard_rating_before = event['standard_ratings_before'][team]
                    standard_rating_after = event['standard_ratings_after'][team]
                    margin_rating_before = event['margin_ratings_before'][team]
                    margin_rating_after = event['margin_ratings_after'][team]
                    
                    carryover_row = {
                        'event': 'season_carryover',
                        'date': None,
                        'year': event['year'],
                        'round': None,
                        'team': team,
                        'opponent': None,
                        'standard_rating_before': standard_rating_before,
                        'standard_rating_after': standard_rating_after,
                        'standard_rating_change': standard_rating_after - standard_rating_before,
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


def fetch_matches(db_path, start_year):
    """
    Fetch AFL matches from the database starting from a specific year
    """
    conn = sqlite3.connect(db_path)
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year, m.hscore, m.ascore, 
        ht.name as home_team, at.name as away_team
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    WHERE 
        m.year >= ?
    ORDER BY 
        m.year, m.match_date
    """
    
    matches = pd.read_sql_query(query, conn, params=(start_year,))
    conn.close()
    
    # Convert match_date to datetime for sorting
    matches['match_date'] = pd.to_datetime(matches['match_date'], errors='coerce')
    
    # Sort by date to ensure chronological order
    matches = matches.sort_values(['year', 'match_date'])
    
    return matches


def predict_matches(standard_model_path, margin_model_path, db_path='data/afl_predictions.db', 
                   start_year=2025, output_dir='.', save_to_db=True, predictor_id=6):
    """
    Make combined ELO predictions for matches starting from specified year
    """
    # Load the predictor
    predictor = AFLCombinedEloPredictor(standard_model_path, margin_model_path)
    
    # Get matches from database
    matches = fetch_matches(db_path, start_year)
    
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
    csv_filename = os.path.join(output_dir, f'combined_elo_predictions_{years.min()}_{years.max()}.csv')
    predictor.save_predictions_to_csv(csv_filename)

    print(f"\nSaved combined ELO predictions to: {csv_filename}")
    print("  - Win probabilities: Standard ELO model")
    print("  - Margins (Database): Margin-only ELO model")
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
        
        print(f"\nPrediction Performance on {len(completed_predictions)} completed matches:")
        print(f"  Accuracy: {accuracy:.4f}")
        print(f"  Brier Score: {avg_brier:.4f}")
        if avg_mae_margin is not None:
            print(f"  Margin MAE (Margin-only model): {avg_mae_margin:.2f}")
        if avg_mae_builtin is not None:
            print(f"  Margin MAE (Built-in ELO): {avg_mae_builtin:.2f}")
        if avg_mae_margin is None and avg_mae_builtin is None:
            print("  Margin MAE: No margin data available")
    else:
        print("\nNo completed matches found to evaluate prediction accuracy")
    
    # Display final team ratings for both models
    print("\nFinal Standard ELO Ratings:")
    sorted_standard = sorted(predictor.standard_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_standard:
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
    parser.add_argument('--standard-model', type=str, required=True,
                        help='Path to the trained standard ELO model JSON file')
    parser.add_argument('--margin-model', type=str, required=True,
                        help='Path to the trained margin-only ELO model JSON file')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
    parser.add_argument('--save-to-db', action='store_true', default=True,
                        help='Save predictions directly to database (default: True)')
    parser.add_argument('--no-save-to-db', dest='save_to_db', action='store_false',
                        help='Disable database saving, use CSV output instead')
    parser.add_argument('--predictor-id', type=int, default=6,
                        help='Predictor ID for database storage (default: 6 for combined ELO)')

    args = parser.parse_args()
    
    predict_matches(
        standard_model_path=args.standard_model,
        margin_model_path=args.margin_model,
        db_path=args.db_path,
        start_year=args.start_year,
        output_dir=args.output_dir,
        save_to_db=args.save_to_db,
        predictor_id=args.predictor_id
    )


if __name__ == '__main__':
    main()