import pandas as pd
import numpy as np
import sqlite3
from sklearn.model_selection import TimeSeriesSplit
import matplotlib.pyplot as plt
import json
import os
import argparse
from datetime import datetime

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
    
    def predict_margin(self, home_team, away_team):
        """
        Predict match margin from win probability
        
        Parameters:
        -----------
        home_team: str
            Name of home team
        away_team: str
            Name of away team
            
        Returns:
        --------
        float: Predicted margin (positive = home win, negative = away win)
        """
        win_prob = self.calculate_win_probability(home_team, away_team)
        
        # Avoid log(0) or log(1) errors
        win_prob = np.clip(win_prob, 0.001, 0.999)
        
        # Convert probability to expected margin using log-odds
        log_odds = np.log(win_prob / (1 - win_prob))
        predicted_margin = self.beta * log_odds
        
        return predicted_margin

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
            'predicted_margin': self.predict_margin(home_team, away_team),
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
                'beta': self.beta,
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


def fetch_afl_data(db_path, start_year=None, end_year=None):
    """
    Fetch historical AFL match data from SQLite database
    
    Parameters:
    -----------
    db_path: str
        Path to SQLite database
    start_year: int
        Optional starting year for data. If provided, only games from this year onward are fetched.
    end_year: int
        Optional ending year for data. If provided, only games up to this year are fetched.
        
    Returns:
    --------
    pandas DataFrame with match data
    """
    conn = sqlite3.connect(db_path)
    
    year_clause = ""
    if start_year:
        year_clause += f"AND m.year >= {start_year} "
    if end_year:
        year_clause += f"AND m.year <= {end_year}"
    
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
        m.hscore IS NOT NULL AND m.ascore IS NOT NULL
        {year_clause}
    ORDER BY 
        m.year, m.match_date
    """
    
    df = pd.read_sql_query(query, conn)
    conn.close()
    
    return df


def train_elo_model(data, params=None):
    """
    Train the ELO model on the provided data with optional parameters
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    params: dict
        Optional model parameters
        
    Returns:
    --------
    trained ELO model
    """
    if params is None:
        model = AFLEloModel()
    else:
        model = AFLEloModel(
            base_rating=params.get('base_rating', 1500),
            k_factor=params.get('k_factor', 20),
            home_advantage=params.get('home_advantage', 50),
            margin_factor=params.get('margin_factor', 0.3),
            season_carryover=params.get('season_carryover', 0.6),
            max_margin=params.get('max_margin', 120),
            beta=params.get('beta', 0.05)
        )
    
    # Get unique teams
    all_teams = pd.concat([data['home_team'], data['away_team']]).unique()
    
    # Initialize ratings
    model.initialize_ratings(all_teams)
    
    # Process matches chronologically
    prev_year = None
    
    for _, match in data.iterrows():
        # Apply season carryover at the start of a new season
        if prev_year is not None and match['year'] != prev_year:
            # Save ratings at the end of the previous year
            model.save_yearly_ratings(prev_year)
            # Apply carryover for the new year
            model.apply_season_carryover(match['year'])
        
        # Update ratings based on match result
        model.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            hscore=match['hscore'],
            ascore=match['ascore'],
            year=match['year'],
            match_id=match['match_id'],
            round_number=match['round_number'],
            match_date=match['match_date'],
            venue=match['venue']
        )
        
        prev_year = match['year']
    
    # Save ratings for the final year
    if prev_year:
        model.save_yearly_ratings(prev_year)
    
    return model


def parameter_tuning(data, param_grid, cv=5, max_combinations=None):
    """
    Find optimal ELO parameters using grid search
    
    Parameters:
    -----------
    data: pandas DataFrame
        Historical match data
    param_grid: dict
        Dictionary of parameter ranges to test
    cv: int
        Number of cross-validation splits
    max_combinations: int
        Maximum number of parameter combinations to test (None for all)
        
    Returns:
    --------
    dict with best parameters and results
    """
    # Create time-based splits to avoid training on future data
    tscv = TimeSeriesSplit(n_splits=cv)
    
    best_score = float('inf')  # Using log loss, lower is better
    best_params = None
    all_results = []
    
    # Sort data by date to ensure chronological order
    data = data.sort_values(['year', 'match_date'])
    
    # Create parameter combinations
    param_combinations = []
    
    # Simple grid search using loops
    for k_factor in param_grid['k_factor']:
        for home_advantage in param_grid['home_advantage']:
            for margin_factor in param_grid['margin_factor']:
                for season_carryover in param_grid['season_carryover']:
                    for max_margin in param_grid['max_margin']:
                        for beta in param_grid.get('beta', [0.05]):  # Default if not in grid
                            params = {
                                'base_rating': param_grid['base_rating'][0],  # Use first value
                                'k_factor': k_factor,
                                'home_advantage': home_advantage,
                                'margin_factor': margin_factor,
                                'season_carryover': season_carryover,
                                'max_margin': max_margin,
                                'beta': beta
                            }
                            param_combinations.append(params)
    
    # Limit the number of combinations if specified
    if max_combinations and len(param_combinations) > max_combinations:
        print(f"Limiting to {max_combinations} random parameter combinations out of {len(param_combinations)} total")
        import random
        random.shuffle(param_combinations)
        param_combinations = param_combinations[:max_combinations]
    
    total_combinations = len(param_combinations)
    print(f"Testing {total_combinations} parameter combinations with {cv}-fold cross-validation...")
    
    # Print a few examples of parameter combinations
    print("\nSample of parameter combinations to test:")
    for i, params in enumerate(param_combinations[:3]):
        print(f"  Combination {i+1}: {params}")
    if len(param_combinations) > 3:
        print(f"  ... plus {len(param_combinations) - 3} more combinations")
    
    # Track progress
    start_time = datetime.now()
    
    for i, params in enumerate(param_combinations):
        if i % 10 == 0:  # Print progress every 10 combinations
            elapsed = datetime.now() - start_time
            if i > 0:
                avg_time_per_combo = elapsed.total_seconds() / i
                est_remaining = (total_combinations - i) * avg_time_per_combo
                print(f"Testing combination {i+1}/{total_combinations} - "
                      f"Elapsed: {elapsed.total_seconds()/60:.1f} min, "
                      f"Est. remaining: {est_remaining/60:.1f} min")
            else:
                print(f"Testing combination {i+1}/{total_combinations}")
        
        # Cross-validation scores for this parameter set
        cv_scores = []
        
        for train_idx, test_idx in tscv.split(data):
            train_data = data.iloc[train_idx]
            test_data = data.iloc[test_idx]
            
            # Train model on training data
            model = train_elo_model(train_data, params)
            
            # Predict on test data
            test_probs = []
            test_results = []
            
            # Get the year of the earliest test game
            test_year = test_data['year'].min()
            
            # Apply season carryover if needed
            if test_year > train_data['year'].max():
                model.apply_season_carryover(test_year)
            
            for _, match in test_data.iterrows():
                prob = model.calculate_win_probability(match['home_team'], match['away_team'])
                test_probs.append(prob)
                # Actual result (1 for home win, 0 for away win, 0.5 for draw)
                if match['hscore'] > match['ascore']:
                    result = 1.0
                elif match['hscore'] < match['ascore']:
                    result = 0.0
                else:
                    result = 0.5
                test_results.append(result)
            
            # Clip probabilities to avoid log(0) issues
            test_probs = [max(min(p, 0.999), 0.001) for p in test_probs]
            
            # Calculate log loss for this fold
            log_losses = []
            for true_val, pred_val in zip(test_results, test_probs):
                # Calculate loss based on actual outcome
                if true_val == 1.0:
                    loss = -np.log(pred_val)
                elif true_val == 0.0:
                    loss = -np.log(1 - pred_val)
                else:  # Draw (0.5)
                    # For a draw, use proximity to 0.5 for the loss calculation
                    loss = -np.log(1 - abs(0.5 - pred_val))
                
                log_losses.append(loss)

            fold_loss = np.mean(log_losses)
            cv_scores.append(fold_loss)
        
        # Average score across CV folds
        avg_score = np.mean(cv_scores)
        
        result = {
            'params': params,
            'log_loss': avg_score,
            'cv_scores': cv_scores
        }
        all_results.append(result)
        
        # Update best parameters if this is better
        if avg_score < best_score:
            best_score = avg_score
            best_params = params
            print(f"\nNew best parameters found (log loss: {best_score:.4f}):")
            for k, v in best_params.items():
                print(f"  {k}: {v}")
    
    # Sort results by score
    all_results.sort(key=lambda x: x['log_loss'])
    
    # Print the top 3 parameter combinations
    print("\nTop 3 parameter combinations:")
    for i, result in enumerate(all_results[:3]):
        print(f"  {i+1}. Log loss: {result['log_loss']:.4f}, Parameters: {result['params']}")
    
    total_time = datetime.now() - start_time
    print(f"\nParameter tuning completed in {total_time.total_seconds()/60:.1f} minutes")
    
    return {
        'best_params': best_params,
        'best_score': best_score,
        'all_results': all_results
    }


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
        with open(args.params_file, 'r') as f:
            params_data = json.load(f)
        
        # Handle both old format and new format
        if 'parameters' in params_data:
            best_params = params_data['parameters']
        else:
            best_params = params_data
        
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
        tuning_results = parameter_tuning(data, param_grid, cv=args.cv_folds, max_combinations=args.max_combinations)
        
        # Display best parameters
        best_params = tuning_results['best_params']
        print(f"\nBest parameters found:")
        for key, value in best_params.items():
            print(f"  {key}: {value}")
        print(f"Best log loss: {tuning_results['best_score']:.4f}")
        
        # Save tuning results
        tuning_file = os.path.join(args.output_dir, f"afl_elo_tuning_results_{args.end_year}.json")
        with open(tuning_file, 'w') as f:
            # Convert numpy arrays to lists for JSON serialization
            tuning_results_json = {
                'best_params': best_params,
                'best_score': float(tuning_results['best_score']),
                'all_results': [
                    {
                        'params': result['params'],
                        'log_loss': float(result['log_loss']),
                        'cv_scores': [float(score) for score in result['cv_scores']]
                    }
                    for result in tuning_results['all_results']
                ]
            }
            json.dump(tuning_results_json, f, indent=4)
        
        print(f"Tuning results saved to {tuning_file}")
        
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
    
    model.save_model(model_file)
    print(f"\nModel saved to {model_file}")
    
    model.save_predictions_to_csv(predictions_file)
    
    # Display final team ratings
    print("\nFinal Team Ratings:")
    sorted_ratings = sorted(model.team_ratings.items(), key=lambda x: x[1], reverse=True)
    for team, rating in sorted_ratings:
        print(f"  {team}: {rating:.1f}")


if __name__ == "__main__":
    main()