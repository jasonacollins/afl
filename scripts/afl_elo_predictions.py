import json
import sqlite3
import pandas as pd
import numpy as np
from datetime import datetime, timezone
import os
import argparse

# Team state mapping for interstate home advantage calculation
TEAM_STATES = {
    'Adelaide': 'SA',
    'Brisbane Lions': 'QLD',
    'Carlton': 'VIC',
    'Collingwood': 'VIC',
    'Essendon': 'VIC',
    'Fremantle': 'WA',
    'Geelong': 'VIC',
    'Gold Coast': 'QLD',
    'Greater Western Sydney': 'NSW',
    'Hawthorn': 'VIC',
    'Melbourne': 'VIC',
    'North Melbourne': 'VIC',
    'Port Adelaide': 'SA',
    'Richmond': 'VIC',
    'St Kilda': 'VIC',
    'Sydney': 'NSW',
    'West Coast': 'WA',
    'Western Bulldogs': 'VIC'
}


class AFLEloPredictor:
    def __init__(self, model_path, margin_model_path=None):
        """
        Initialize the ELO predictor with a trained model
        
        Parameters:
        -----------
        model_path: str
            Path to the saved ELO model JSON file
        margin_model_path: str, optional
            Path to the saved margin model JSON file
        """
        self.margin_model = None
        self.is_margin_only_model = False
        self.dual_model_params = None  # Cache for dual-model margin parameters
        
        # Initialize empty attributes in case loading fails
        self.team_ratings = {}
        self.params = {}
        
        if not self.load_model(model_path):
            raise ValueError(f"Failed to load ELO model from {model_path}")
        
        # Load margin model if provided
        if margin_model_path:
            if self.load_margin_model(margin_model_path):
                print("✓ Margin model loaded successfully")
            else:
                print("✗ Failed to load margin model - using fallback")
        else:
            print("ℹ No margin model specified - using built-in margin calculation")
        
        self.predictions = []  # Store all predictions
        self.rating_history = []  # Store rating history
    
    def load_model(self, model_path):
        """Load the trained ELO model"""
        try:
            with open(model_path, 'r') as f:
                model_data = json.load(f)
            
            # Check if this is a margin-only model
            self.is_margin_only_model = model_data.get('model_type') == 'margin_only_elo'
            
            # Set parameters
            self.params = model_data['parameters']
            self.base_rating = self.params['base_rating']
            self.k_factor = self.params['k_factor']
            # Handle both old single home_advantage and new dual parameters
            if 'default_home_advantage' in self.params:
                self.default_home_advantage = self.params['default_home_advantage']
                self.interstate_home_advantage = self.params['interstate_home_advantage']
            else:
                # Fallback for old models - use single home_advantage for both
                self.default_home_advantage = self.params.get('home_advantage', 50)
                self.interstate_home_advantage = self.params.get('home_advantage', 50)
            self.season_carryover = self.params['season_carryover']
            self.max_margin = self.params['max_margin']
            
            # Handle different parameter structures
            if self.is_margin_only_model:
                # Margin-only model parameters
                self.margin_scale = self.params['margin_scale']
                self.margin_factor = 0.0  # Not used in margin-only models
                self.beta = 0.04  # Fallback for built-in calculations
                print(f"Loaded margin-only ELO model (MAE: {model_data.get('mae', 'unknown')})")
            else:
                # Standard ELO model parameters
                if 'margin_factor' not in self.params:
                    raise ValueError("Standard ELO model missing required 'margin_factor' parameter")
                if 'beta' not in self.params:
                    raise ValueError("Standard ELO model missing required 'beta' parameter")
                    
                self.margin_factor = self.params['margin_factor']
                self.beta = self.params['beta']
                self.margin_scale = self.params.get('margin_scale', 0.04)  # Default to 0.04 if not present
                print(f"Loaded standard ELO model")
            
            # Set team ratings
            if 'team_ratings' not in model_data:
                raise ValueError("Model file missing required 'team_ratings' data")
            self.team_ratings = model_data['team_ratings']
            
            # Store yearly ratings if available
            self.yearly_ratings = model_data.get('yearly_ratings', {})
            
            print(f"Model has {len(self.team_ratings)} team ratings")
            print("Model parameters:")
            for param, value in self.params.items():
                print(f"  {param}: {value}")
                
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            # Reset attributes to prevent partial loading
            self.team_ratings = {}
            self.params = {}
            return False
    
    def load_margin_model(self, margin_model_path):
        """Load the trained margin model"""
        try:
            with open(margin_model_path, 'r') as f:
                margin_data = json.load(f)
            
            # Check if this is a margin-only ELO model or dual-model margin parameters
            if 'model_type' in margin_data and margin_data['model_type'] == 'margin_only_elo':
                # This is a margin-only ELO model - store it for dual-model approach
                self.margin_model = {
                    'method': 'margin_only_elo',
                    'parameters': margin_data['parameters'],
                    'team_ratings': margin_data['team_ratings']
                }
                print(f"Loaded margin-only ELO model for dual-model approach")
                print("Margin-only model parameters:")
                for param, value in margin_data['parameters'].items():
                    if isinstance(value, (int, float)):
                        print(f"  {param}: {value:.4f}")
                    else:
                        print(f"  {param}: {value}")
            else:
                # This is dual-model margin parameters - use existing logic
                self.margin_model = margin_data
                method = self.margin_model['method']
                params = self.margin_model['parameters']
                
                print(f"Loaded margin model using {method.upper().replace('_', ' ')} method")
                print("Margin model parameters:")
                for param, value in params.items():
                    print(f"  {param}: {value:.4f}")
                
            # Load dual-model parameters for comprehensive CSV margin calculations
            self._load_dual_model_params()
            
            return True
        except Exception as e:
            print(f"Error loading margin model: {e}")
            return False
    
    def _load_dual_model_params(self):
        """Load dual-model margin parameters for comprehensive margin calculations"""
        try:
            import os
            dual_model_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'data', 'optimal_elo_margin_params.json')
            if os.path.exists(dual_model_path):
                with open(dual_model_path, 'r') as f:
                    self.dual_model_params = json.load(f)
                print("✓ Dual-model margin parameters loaded for comprehensive CSV output")
        except Exception as e:
            print(f"⚠ Could not load dual-model parameters: {e}")
            self.dual_model_params = None
    
    def _cap_margin(self, margin):
        """Cap margin to reduce effect of blowouts"""
        return min(abs(margin), self.max_margin) * np.sign(margin)
    
    def calculate_win_probability(self, home_team, away_team, venue_state=None):
        """Calculate probability of home team winning based on ELO difference"""
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # Apply contextual home ground advantage
        home_advantage = self.get_contextual_home_advantage(home_team, away_team, venue_state)
        rating_diff = (home_rating + home_advantage) - away_rating
        
        # Convert rating difference to win probability using logistic function
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        
        return win_probability
    
    def get_contextual_home_advantage(self, home_team, away_team, venue_state):
        """Calculate home advantage based on whether away team is traveling interstate"""
        away_team_state = TEAM_STATES.get(away_team)
        
        # Use venue state if available, otherwise fall back to home team state
        if venue_state is None:
            venue_state = TEAM_STATES.get(home_team)
        
        # If away team is from a different state than the venue, use interstate advantage
        if away_team_state and venue_state and away_team_state != venue_state:
            return self.interstate_home_advantage
        else:
            return self.default_home_advantage
    
    def predict_margin(self, home_team, away_team):
        """
        Predict match margin from rating difference - returns the margin used for database
        """
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        
        # For margin-only models, use margin_scale approach
        if self.is_margin_only_model:
            rating_diff = (home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - away_rating
            predicted_margin = rating_diff * self.margin_scale
            return predicted_margin
        
        # For standard models, use margin model if available
        if self.margin_model:
            method = self.margin_model['method']
            params = self.margin_model['parameters']
            
            if method == 'margin_only_elo':
                # Use separate margin-only model for dual-model approach
                margin_home_rating = self.margin_model['team_ratings'].get(home_team, self.base_rating)
                margin_away_rating = self.margin_model['team_ratings'].get(away_team, self.base_rating)
                margin_rating_diff = (margin_home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - margin_away_rating
                predicted_margin = margin_rating_diff * params['margin_scale']
                
            elif method == 'simple':
                # Simple scaling: margin = rating_diff * scale_factor
                rating_diff = (home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - away_rating
                predicted_margin = rating_diff * params['scale_factor']
                
            elif method == 'diminishing_returns':
                # Diminishing returns: margin = (win_prob - 0.5) / beta
                win_prob = self.calculate_win_probability(home_team, away_team)
                predicted_margin = (win_prob - 0.5) / params['beta']
                
            elif method == 'linear':
                # Linear regression: margin = rating_diff * slope + intercept
                rating_diff = (home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - away_rating
                predicted_margin = rating_diff * params['slope'] + params['intercept']
                
            else:
                raise ValueError(f"Unknown margin prediction method: {method}")
        else:
            # No margin model loaded - could either return 0 or raise an error
            print("WARNING: No margin model loaded. Returning 0 for margin prediction.")
            predicted_margin = 0
        
        return predicted_margin
    
    def predict_all_margins(self, home_team, away_team):
        """
        Predict match margin using all available methods for CSV export
        Returns dict with all margin predictions
        """
        home_rating = self.team_ratings.get(home_team, self.base_rating)
        away_rating = self.team_ratings.get(away_team, self.base_rating)
        rating_diff = (home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - away_rating
        
        margin_predictions = {}
        
        # 1. Margin-only ELO approach (if this is a margin-only model)
        if self.is_margin_only_model:
            margin_predictions['margin_only_elo'] = rating_diff * self.margin_scale
            margin_predictions['database_method'] = 'margin_only_elo'
        else:
            margin_predictions['margin_only_elo'] = None
        
        # 2. Built-in ELO margin calculation
        win_prob = self.calculate_win_probability(home_team, away_team)
        margin_predictions['builtin_elo'] = (win_prob - 0.5) / self.beta
        
        # 3. Linear regression method (if margin model available)
        if self.margin_model:
            method = self.margin_model['method']
            params = self.margin_model['parameters']
            
            # Handle margin-only ELO model for dual-model approach
            if method == 'margin_only_elo':
                # Use margin-only model ratings for margin prediction
                margin_home_rating = self.margin_model['team_ratings'].get(home_team, self.base_rating)
                margin_away_rating = self.margin_model['team_ratings'].get(away_team, self.base_rating)
                margin_rating_diff = (margin_home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - margin_away_rating
                
                margin_predictions['margin_only_elo'] = margin_rating_diff * params['margin_scale']
                if not self.is_margin_only_model:
                    margin_predictions['database_method'] = 'margin_only_elo'
            
            # Always calculate all margin methods for CSV comparison
            
            # Linear regression - use available parameters
            if 'all_methods' in self.margin_model and 'linear' in self.margin_model['all_methods']:
                linear_params = self.margin_model['all_methods']['linear']['parameters']
                margin_predictions['linear_regression'] = rating_diff * linear_params['slope'] + linear_params['intercept']
            elif method == 'linear' and 'slope' in params and 'intercept' in params:
                margin_predictions['linear_regression'] = rating_diff * params['slope'] + params['intercept']
            elif self.dual_model_params and 'all_methods' in self.dual_model_params and 'linear' in self.dual_model_params['all_methods']:
                linear_params = self.dual_model_params['all_methods']['linear']['parameters']
                margin_predictions['linear_regression'] = rating_diff * linear_params['slope'] + linear_params['intercept']
            else:
                margin_predictions['linear_regression'] = None
                
            # Simple scaling - use available parameters
            if 'all_methods' in self.margin_model and 'simple' in self.margin_model['all_methods']:
                simple_params = self.margin_model['all_methods']['simple']['parameters']
                margin_predictions['simple_scaling'] = rating_diff * simple_params['scale_factor']
            elif method == 'simple' and 'scale_factor' in params:
                margin_predictions['simple_scaling'] = rating_diff * params['scale_factor']
            elif self.dual_model_params and 'all_methods' in self.dual_model_params and 'simple' in self.dual_model_params['all_methods']:
                simple_params = self.dual_model_params['all_methods']['simple']['parameters']
                margin_predictions['simple_scaling'] = rating_diff * simple_params['scale_factor']
            else:
                # Use fallback simple scaling calculation
                margin_predictions['simple_scaling'] = rating_diff * 0.125  # Approximate scale factor
                
            # Diminishing returns - use available parameters
            if 'all_methods' in self.margin_model and 'diminishing_returns' in self.margin_model['all_methods']:
                dr_params = self.margin_model['all_methods']['diminishing_returns']['parameters']
                margin_predictions['diminishing_returns'] = (win_prob - 0.5) / dr_params['beta']
            elif method == 'diminishing_returns' and 'beta' in params:
                margin_predictions['diminishing_returns'] = (win_prob - 0.5) / params['beta']
            elif self.dual_model_params and 'all_methods' in self.dual_model_params and 'diminishing_returns' in self.dual_model_params['all_methods']:
                dr_params = self.dual_model_params['all_methods']['diminishing_returns']['parameters']
                margin_predictions['diminishing_returns'] = (win_prob - 0.5) / dr_params['beta']
            else:
                # Use main model beta as fallback
                margin_predictions['diminishing_returns'] = (win_prob - 0.5) / self.beta
                
            # Set database method based on margin model type
            if method == 'linear' and not self.is_margin_only_model:
                margin_predictions['database_method'] = 'linear_regression'
            elif method == 'simple' and not self.is_margin_only_model:
                margin_predictions['database_method'] = 'simple_scaling'
            elif method == 'diminishing_returns' and not self.is_margin_only_model:
                margin_predictions['database_method'] = 'diminishing_returns'
        else:
            # No margin model - calculate fallback values
            margin_predictions['linear_regression'] = None
            margin_predictions['simple_scaling'] = rating_diff * 0.125  # Fallback scale factor
            margin_predictions['diminishing_returns'] = (win_prob - 0.5) / self.beta
            if not self.is_margin_only_model:
                margin_predictions['database_method'] = 'builtin_elo'
        
        return margin_predictions

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
    
    def update_ratings(self, home_team, away_team, hscore, ascore, match_id=None, year=None, round_number=None, match_date=None, venue=None, venue_state=None):
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
        match_id: int
            Optional match ID for tracking
        year: int
            Season year
        round_number: str
            Optional round number for tracking
        match_date: str
            Optional match date for tracking
        venue: str
            Optional venue for tracking
            
        Returns:
        --------
        dict with updated prediction information
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
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team, venue_state=venue_state)
        
        # Get all margin predictions for CSV export
        all_margins = self.predict_all_margins(home_team, away_team)
        
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
            'adjusted_rating_difference': (home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            'predicted_margin': self.predict_margin(home_team, away_team),
            # Add all margin predictions for CSV export
            'predicted_margin_margin_only_elo': all_margins['margin_only_elo'],
            'predicted_margin_linear_regression': all_margins['linear_regression'],
            'predicted_margin_builtin_elo': all_margins['builtin_elo'],
            'predicted_margin_simple_scaling': all_margins['simple_scaling'],
            'predicted_margin_diminishing_returns': all_margins['diminishing_returns'],
            'margin_method_used_in_db': all_margins['database_method'],
        }
        
        # If scores are provided, update ratings and add result info
        if hscore is not None and ascore is not None:
            # Determine actual result (1 for home win, 0 for away win)
            actual_result = 1.0 if hscore > ascore else 0.0
            
            # Handle draws (0.5 points each)
            if hscore == ascore:
                actual_result = 0.5
            
            # Calculate rating change based on result and margin
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
            
            # Add result info to prediction
            prediction_info.update({
                'hscore': hscore,
                'ascore': ascore,
                'actual_result': 'home_win' if hscore > ascore else ('away_win' if hscore < ascore else 'draw'),
                'margin': margin,
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
                'rating_change': rating_change
            })
        
        # Store the prediction
        self.predictions.append(prediction_info)
        
        return prediction_info
    
    def predict_match(self, home_team, away_team, match_id=None, year=None, round_number=None, match_date=None, venue=None, venue_state=None):
        """
        Predict the outcome of a match without updating ratings
        
        Parameters:
        -----------
        home_team: str
            Name of home team
        away_team: str
            Name of away team
        match_id: int
            Optional match ID for tracking
        year: int
            Season year
        round_number: str
            Optional round number for tracking
        match_date: str
            Optional match date for tracking
        venue: str
            Optional venue for tracking
            
        Returns:
        --------
        dict with prediction information
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
        
        # Calculate win probability
        home_win_prob = self.calculate_win_probability(home_team, away_team, venue_state=venue_state)
        
        # Get all margin predictions for CSV export
        all_margins = self.predict_all_margins(home_team, away_team)
        
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
            'adjusted_rating_difference': (home_rating + self.get_contextual_home_advantage(home_team, away_team, None)) - away_rating,
            'home_win_probability': home_win_prob,
            'away_win_probability': 1 - home_win_prob,
            'predicted_margin': self.predict_margin(home_team, away_team),
            'predicted_winner': home_team if home_win_prob > 0.5 else away_team,
            'confidence': max(home_win_prob, 1 - home_win_prob),
            # Add all margin predictions for CSV export
            'predicted_margin_margin_only_elo': all_margins['margin_only_elo'],
            'predicted_margin_linear_regression': all_margins['linear_regression'],
            'predicted_margin_builtin_elo': all_margins['builtin_elo'],
            'predicted_margin_simple_scaling': all_margins['simple_scaling'],
            'predicted_margin_diminishing_returns': all_margins['diminishing_returns'],
            'margin_method_used_in_db': all_margins['database_method'],
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
        
        Parameters:
        -----------
        db_path: str
            Path to SQLite database
        predictor_id: int
            ID of the ELO predictor (default: 6)
        """
        import sqlite3
        
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
                        # Parse match date - handle both ISO format and simple date format
                        match_date_str = p['match_date']
                        if 'T' in match_date_str:
                            # ISO format with time
                            match_date = datetime.fromisoformat(match_date_str.replace('Z', '+00:00'))
                        else:
                            # Simple date format - assume UTC and add a default time
                            match_date = datetime.fromisoformat(match_date_str + 'T00:00:00+00:00')
                        
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
            
            print(f"Saving {len(future_predictions)} predictions to database for predictor {predictor_id}")
            
            # Begin transaction
            cursor.execute("BEGIN TRANSACTION")
            
            # Delete existing ELO predictions for these matches
            match_ids = [p['match_id'] for p in future_predictions]
            placeholders = ','.join(['?' for _ in match_ids])
            cursor.execute(
                f"DELETE FROM predictions WHERE predictor_id = ? AND match_id IN ({placeholders})",
                [predictor_id] + match_ids
            )
            deleted_count = cursor.rowcount
            print(f"Deleted {deleted_count} existing ELO predictions")
            
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
            print(f"Successfully saved {insert_count} predictions to database")
            
        except Exception as e:
            cursor.execute("ROLLBACK")
            print(f"Error saving predictions to database: {e}")
            raise
        finally:
            conn.close()
    
    def save_rating_history_to_csv(self, filename):
        """Save rating history to CSV file"""
        if not self.rating_history:
            print("No rating history to save")
            return
        
        # Convert to DataFrame
        df = pd.DataFrame()
        
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
                    'rating_change': event['rating_change']
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
                    'rating_change': -event['rating_change']
                }
                
                df = pd.concat([df, pd.DataFrame([home_row, away_row])], ignore_index=True)
                
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
                        'rating_change': rating_after - rating_before
                    }
                    
                    df = pd.concat([df, pd.DataFrame([carryover_row])], ignore_index=True)
        
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
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Year to start predictions from
        
    Returns:
    --------
    pandas DataFrame with matches
    """
    conn = sqlite3.connect(db_path)
    
    query = f"""
    SELECT 
        m.match_id, m.match_number, m.round_number, m.match_date, 
        m.venue, m.year, m.hscore, m.ascore, 
        ht.name as home_team, at.name as away_team,
        v.state as venue_state
    FROM 
        matches m
    JOIN 
        teams ht ON m.home_team_id = ht.team_id
    JOIN 
        teams at ON m.away_team_id = at.team_id
    LEFT JOIN 
        venues v ON m.venue_id = v.venue_id
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


def predict_matches(model_path, db_path='data/afl_predictions.db', start_year=2025, 
                   output_dir='.', save_to_db=True, predictor_id=6, margin_model_path=None):
    """
    Make predictions for matches starting from specified year
    
    Parameters:
    -----------
    model_path: str
        Path to the saved ELO model
    db_path: str
        Path to SQLite database
    start_year: int
        Year to start predictions from
    output_dir: str
        Directory to save output files
    save_to_db: bool
        Whether to save predictions directly to database (default: True)
    predictor_id: int
        Predictor ID for database storage (default: 6 for ELO)
        
    Returns:
    --------
    None
    """
    # Load the predictor
    predictor = AFLEloPredictor(model_path, margin_model_path)
    
    # Get matches from database
    matches = fetch_matches(db_path, start_year)
    
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
            # For completed matches, update ratings
            venue_state = match.get('venue_state') if pd.notna(match.get('venue_state')) else None
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
                venue_state=venue_state
            )
        else:
            # For future matches, just predict without updating
            venue_state = match.get('venue_state') if pd.notna(match.get('venue_state')) else None
            predictor.predict_match(
                home_team=match['home_team'],
                away_team=match['away_team'],
                match_id=match['match_id'],
                year=match['year'],
                round_number=match['round_number'],
                match_date=match['match_date'].isoformat() if pd.notna(match['match_date']) else None,
                venue=match['venue'],
                venue_state=venue_state
            )
    
    # Save predictions
    os.makedirs(output_dir, exist_ok=True)

    # Save predictions to CSV
    csv_filename = os.path.join(output_dir, f'elo_predictions_{years.min()}_{years.max()}.csv')
    predictor.save_predictions_to_csv(csv_filename)

    # Print which models were used
    print(f"\nSaved predictions to: {csv_filename}")
    if predictor.is_margin_only_model:
        print("  - Win probabilities: Margin-only ELO model")
        print("  - Margins (Database): Margin-only ELO model (rating_diff * margin_scale)")
        print("  - CSV includes all margin prediction methods for comparison")
    elif margin_model_path:
        print("  - Win probabilities: Standard ELO model")
        print("  - Margins (Database): Separate margin model (linear method)")
        print("  - CSV includes all margin prediction methods for comparison")
    else:
        print("  - Win probabilities: Standard ELO model")
        print("  - Margins (Database): Built-in ELO calculation")
        print("  - CSV includes all margin prediction methods for comparison")

    # Save to database if requested
    if save_to_db:
        predictor.save_predictions_to_database(db_path, predictor_id)
    
    # Always save rating history for charts
    history_file = os.path.join(output_dir, f"afl_elo_rating_history_from_{start_year}.csv")
    predictor.save_rating_history_to_csv(history_file)
    
    # Evaluate the model on completed matches
    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    
    if completed_predictions:
        correct_count = sum(1 for p in completed_predictions if p.get('correct', False))
        accuracy = correct_count / len(completed_predictions)
        
        # Calculate Brier score
        brier_scores = []
        mae_scores = []
        
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
            
            # MAE for margin prediction (if margin data available)
            if 'predicted_margin' in p and 'margin' in p:
                mae = abs(p['predicted_margin'] - p['margin'])
                mae_scores.append(mae)
        
        avg_brier = np.mean(brier_scores)
        avg_mae = np.mean(mae_scores) if mae_scores else None
        
        print(f"\nPrediction Performance on {len(completed_predictions)} completed matches:")
        print(f"  Accuracy: {accuracy:.4f}")
        print(f"  Brier Score: {avg_brier:.4f}")
        if avg_mae is not None:
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
    """Main function to make ELO predictions"""
    parser = argparse.ArgumentParser(description='Make AFL ELO predictions')
    parser.add_argument('--start-year', type=int, required=True,
                        help='Start year for predictions (inclusive)')
    parser.add_argument('--model-path', type=str, required=True,
                        help='Path to the trained ELO model JSON file')
    parser.add_argument('--db-path', type=str, default='data/afl_predictions.db',
                        help='Path to the SQLite database')
    parser.add_argument('--output-dir', type=str, default='.',
                        help='Directory to save output files')
    parser.add_argument('--save-to-db', action='store_true', default=True,
                        help='Save predictions directly to database (default: True)')
    parser.add_argument('--no-save-to-db', dest='save_to_db', action='store_false',
                        help='Disable database saving, use CSV output instead')
    parser.add_argument('--predictor-id', type=int, default=6,
                        help='Predictor ID for database storage (default: 6 for ELO)')
    parser.add_argument('--margin-model', type=str, default=None,
                    help='Path to the trained margin model JSON file (optional)')

    args = parser.parse_args()
    
    predict_matches(
        model_path=args.model_path,
        margin_model_path=args.margin_model,
        db_path=args.db_path,
        start_year=args.start_year,
        output_dir=args.output_dir,
        save_to_db=args.save_to_db,
        predictor_id=args.predictor_id
    )


if __name__ == '__main__':
    main()