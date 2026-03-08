import argparse
import json
import os
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from core.data_io import (
    fetch_matches_for_prediction,
    save_predictions_to_csv,
    save_predictions_to_database,
    load_model
)
from core.elo_core import AFLEloModel
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


def parse_train_end_year_from_path(path_value):
    import re

    match = re.search(r'trained_to_(\d{4})\.json$', str(path_value or ''))
    if not match:
        return None
    return int(match.group(1))


def normalize_margin_methods_artifact(raw_artifact):
    """Normalize legacy and v2 artifacts into a consistent structure."""
    all_methods_raw = raw_artifact.get('all_methods')
    if not isinstance(all_methods_raw, dict) or not all_methods_raw:
        raise ValueError('Margin methods artifact must contain non-empty all_methods')

    all_methods = {}
    for method_name, method_data in all_methods_raw.items():
        if isinstance(method_data, dict) and isinstance(method_data.get('params'), dict):
            params = method_data['params']
            score = method_data.get('score')
        elif isinstance(method_data, dict):
            params = {k: v for k, v in method_data.items() if k != 'score'}
            score = method_data.get('score')
        else:
            raise ValueError(f'Invalid method definition for {method_name}')

        all_methods[method_name] = {
            'params': params,
            'score': score
        }

    best_method = raw_artifact.get('best_method')
    if not best_method:
        # Legacy fallback: choose best by score if possible.
        ranked = [
            (name, data.get('score')) for name, data in all_methods.items() if data.get('score') is not None
        ]
        if ranked:
            best_method = min(ranked, key=lambda row: row[1])[0]
        else:
            best_method = next(iter(all_methods.keys()))

    if best_method not in all_methods:
        raise ValueError(f"best_method '{best_method}' not present in all_methods")

    best_params = raw_artifact.get('best_params')
    if not isinstance(best_params, dict):
        best_params = all_methods[best_method]['params']

    required_win_model = raw_artifact.get('required_win_model')
    if not isinstance(required_win_model, dict):
        legacy_params = raw_artifact.get('elo_params_used')
        if isinstance(legacy_params, dict):
            required_win_model = {
                'model_type': raw_artifact.get('model_type', 'win_elo'),
                'train_end_year': (
                    raw_artifact.get('train_window', {}).get('end_year')
                    if isinstance(raw_artifact.get('train_window'), dict)
                    else None
                ),
                'parameter_signature': legacy_params
            }

    return {
        'artifact_version': raw_artifact.get('artifact_version', 1),
        'best_method': best_method,
        'best_params': best_params,
        'all_methods': all_methods,
        'required_win_model': required_win_model,
        'train_window': raw_artifact.get('train_window'),
        'raw': raw_artifact
    }


class AFLOptimalMarginPredictor:
    """Win ELO predictor with optimized margin derivation methods for testing."""

    def __init__(self, elo_model_path, margin_methods_path, method_override=None, allow_model_mismatch=False):
        self.elo_model_path = elo_model_path
        self.margin_methods_path = margin_methods_path
        self.allow_model_mismatch = bool(allow_model_mismatch)

        self.model_data = None
        self.elo_params = {}
        self.win_model = None
        self.margin_artifact = None
        self.selected_method = None

        self.predictions = []
        self.rating_history = []

        self._load_model_artifacts(method_override)

    def _load_model_artifacts(self, method_override):
        self.model_data = load_model(self.elo_model_path)

        if self.model_data.get('model_type') == 'margin_only_elo':
            raise ValueError('Expected win ELO model, got margin-only model')

        self.elo_params = self.model_data['parameters']

        self.win_model = AFLEloModel(**self.elo_params)
        self.win_model.team_ratings = self.model_data['team_ratings'].copy()

        with open(self.margin_methods_path, 'r', encoding='utf-8') as handle:
            margin_artifact_raw = json.load(handle)

        self.margin_artifact = normalize_margin_methods_artifact(margin_artifact_raw)

        chosen_method = method_override or self.margin_artifact['best_method']
        if chosen_method not in self.margin_artifact['all_methods']:
            raise ValueError(
                f"method_override '{chosen_method}' not present in artifact methods: "
                f"{', '.join(sorted(self.margin_artifact['all_methods'].keys()))}"
            )
        self.selected_method = chosen_method

        self._validate_model_compatibility()

        print(f"Loaded win ELO model with {len(self.win_model.team_ratings)} teams")
        print(f"Loaded margin methods artifact v{self.margin_artifact['artifact_version']}")
        print(f"Using margin method: {self.selected_method}")

    def _validate_model_compatibility(self):
        if self.allow_model_mismatch:
            print('Warning: compatibility guard bypassed via --allow-model-mismatch')
            return

        required = self.margin_artifact.get('required_win_model')
        if not isinstance(required, dict):
            raise ValueError(
                'Margin methods artifact is missing required_win_model compatibility metadata. '
                'Re-run optimization or use --allow-model-mismatch to bypass.'
            )

        required_model_type = required.get('model_type')
        model_type = self.model_data.get('model_type')
        if required_model_type and model_type != required_model_type:
            raise ValueError(
                f'Model type mismatch: required {required_model_type}, got {model_type}'
            )

        required_train_end = required.get('train_end_year')
        model_train_end = parse_train_end_year_from_path(self.elo_model_path)
        if required_train_end is not None and model_train_end is not None and required_train_end != model_train_end:
            raise ValueError(
                f'Win model train cutoff mismatch: artifact requires {required_train_end}, '
                f'but model path resolves to {model_train_end}'
            )

        signature = required.get('parameter_signature')
        if isinstance(signature, dict):
            for key, expected in signature.items():
                if expected is None:
                    continue
                actual = self.elo_params.get(key)
                if actual != expected:
                    raise ValueError(
                        f"Win model parameter mismatch for '{key}': expected {expected}, got {actual}"
                    )

    def _resolve_rating_diff_and_win_prob(self, match):
        home_team = match['home_team']
        away_team = match['away_team']

        if home_team not in self.win_model.team_ratings:
            self.win_model.team_ratings[home_team] = self.win_model.base_rating
        if away_team not in self.win_model.team_ratings:
            self.win_model.team_ratings[away_team] = self.win_model.base_rating

        home_rating = self.win_model.team_ratings[home_team]
        away_rating = self.win_model.team_ratings[away_team]

        venue_state = match.get('venue_state')
        home_team_state = match.get('home_team_state')
        away_team_state = match.get('away_team_state')

        applied_home_advantage = self.win_model.get_contextual_home_advantage(
            home_team=home_team,
            away_team=away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )

        rating_diff = (home_rating + applied_home_advantage) - away_rating

        win_probability = self.win_model.calculate_win_probability(
            home_team,
            away_team,
            venue_state=venue_state,
            home_team_state=home_team_state,
            away_team_state=away_team_state
        )

        return {
            'home_rating': home_rating,
            'away_rating': away_rating,
            'applied_home_advantage': applied_home_advantage,
            'rating_diff': rating_diff,
            'home_win_probability': win_probability
        }

    def _predict_margin_by_method(self, method_name, method_params, rating_diff, win_probability):
        if method_name == 'simple':
            return rating_diff * float(method_params['scale_factor'])

        if method_name == 'linear':
            slope = float(method_params['slope'])
            intercept = float(method_params.get('intercept', 0.0))
            return (rating_diff * slope) + intercept

        if method_name == 'diminishing_returns':
            beta = float(method_params['beta'])
            if beta == 0:
                raise ValueError('diminishing_returns beta cannot be zero')
            return (win_probability - 0.5) / beta

        raise ValueError(f'Unsupported margin method: {method_name}')

    def predict_match(self, match):
        details = self._resolve_rating_diff_and_win_prob(match)

        margin_predictions = {}
        for method_name, method_data in self.margin_artifact['all_methods'].items():
            margin_predictions[f'predicted_margin_{method_name}'] = self._predict_margin_by_method(
                method_name,
                method_data['params'],
                details['rating_diff'],
                details['home_win_probability']
            )

        selected_margin = margin_predictions[f'predicted_margin_{self.selected_method}']

        prediction = {
            'match_id': match.get('match_id'),
            'round_number': match.get('round_number'),
            'match_date': match['match_date'].isoformat() if pd.notna(match.get('match_date')) else None,
            'venue': match.get('venue'),
            'year': match.get('year'),
            'home_team': match['home_team'],
            'away_team': match['away_team'],
            'home_win_probability': details['home_win_probability'],
            'away_win_probability': 1 - details['home_win_probability'],
            'predicted_margin': selected_margin,
            'predicted_winner': match['home_team'] if details['home_win_probability'] > 0.5 else match['away_team'],
            'confidence': max(details['home_win_probability'], 1 - details['home_win_probability']),
            'margin_method_selected': self.selected_method,
            'applied_home_advantage': details['applied_home_advantage'],
            'adjusted_rating_difference': details['rating_diff']
        }
        prediction.update(margin_predictions)

        return prediction

    def update_ratings_for_completed_match(self, match):
        return self.win_model.update_ratings(
            home_team=match['home_team'],
            away_team=match['away_team'],
            hscore=match['hscore'],
            ascore=match['ascore'],
            year=match['year'],
            match_id=match.get('match_id'),
            round_number=match.get('round_number'),
            match_date=match['match_date'].isoformat() if pd.notna(match.get('match_date')) else None,
            venue=match.get('venue'),
            venue_state=match.get('venue_state'),
            home_team_state=match.get('home_team_state'),
            away_team_state=match.get('away_team_state')
        )


def run_predictions(
    start_year,
    elo_model,
    margin_methods,
    output_dir,
    db_path,
    save_to_db,
    predictor_id,
    future_only,
    override_completed,
    method_override,
    allow_model_mismatch
):
    predictor = AFLOptimalMarginPredictor(
        elo_model,
        margin_methods,
        method_override=method_override,
        allow_model_mismatch=allow_model_mismatch
    )

    matches_df = fetch_matches_for_prediction(db_path, start_year)
    if matches_df.empty:
        print(f'No matches found from year {start_year}')
        return

    years = matches_df['year'].unique()
    years.sort()

    total_matches = len(matches_df)
    print(f'Processing {total_matches} matches from {years.min()} to {years.max()}')
    progress_interval = max(1, total_matches // 20)

    current_year = None
    completed_count = 0
    upcoming_count = 0

    for index, (_, match) in enumerate(matches_df.iterrows(), start=1):
        match_year = match['year']
        if current_year is not None and match_year != current_year:
            predictor.win_model.apply_season_carryover(match_year)

        current_year = match_year

        prediction = predictor.predict_match(match)

        has_scores = not pd.isna(match['hscore']) and not pd.isna(match['ascore'])
        if has_scores:
            actual_margin = int(match['hscore'] - match['ascore'])
            prediction['actual_margin'] = actual_margin
            prediction['actual_result'] = (
                'home_win' if actual_margin > 0 else ('away_win' if actual_margin < 0 else 'draw')
            )
            predictor.update_ratings_for_completed_match(match)
            completed_count += 1
        else:
            upcoming_count += 1

        predictor.predictions.append(prediction)

        if index == 1 or index == total_matches or index % progress_interval == 0:
            pct = (index / total_matches) * 100.0
            print(
                f'Progress: {index}/{total_matches} ({pct:.0f}%) '
                f'| completed {completed_count} | upcoming {upcoming_count}'
            )

    completed_predictions = [p for p in predictor.predictions if 'actual_result' in p]
    if completed_predictions:
        print('\nDetailed Prediction Performance (win probabilities):')
        evaluation_results = evaluate_predictions(completed_predictions)
        print(format_scoring_summary(evaluation_results))

        selected_mae = np.mean([
            abs(p['predicted_margin'] - p['actual_margin']) for p in completed_predictions
        ])
        print(f"  Selected Margin Method ({predictor.selected_method}) MAE: {selected_mae:.2f}")

        for method_name in sorted(predictor.margin_artifact['all_methods'].keys()):
            method_mae = np.mean([
                abs(p[f'predicted_margin_{method_name}'] - p['actual_margin'])
                for p in completed_predictions
            ])
            print(f'  {method_name} MAE: {method_mae:.2f}')
    else:
        print('\nNo completed matches found to evaluate prediction accuracy')

    if future_only:
        total_predictions = len(predictor.predictions)
        predictor.predictions = filter_future_predictions(predictor.predictions, verbose=False)
        print(
            f"Future-only mode enabled: kept {len(predictor.predictions)} "
            f"of {total_predictions} predictions"
        )

    os.makedirs(output_dir, exist_ok=True)
    csv_filename = os.path.join(output_dir, f'win_margin_methods_predictions_{years.min()}_{years.max()}.csv')
    save_predictions_to_csv(predictor.predictions, csv_filename)
    print(f"\nSaved win-margin-method predictions to: {csv_filename}")

    if save_to_db:
        formatted_predictions = []
        for pred in predictor.predictions:
            formatted_predictions.append({
                'match_id': pred.get('match_id'),
                'home_team': pred['home_team'],
                'away_team': pred['away_team'],
                'match_date': pred.get('match_date'),
                'home_win_probability': pred['home_win_probability'],
                'predicted_margin': pred['predicted_margin'],
                'predicted_winner': pred['predicted_winner'],
                'confidence': pred['confidence'],
                'actual_result': pred.get('actual_result')
            })

        save_predictions_to_database(
            formatted_predictions,
            db_path,
            predictor_id,
            override_completed=override_completed
        )


def main():
    parser = argparse.ArgumentParser(description='Generate AFL win-model predictions with optimized margin methods')
    parser.add_argument('--start-year', type=int, required=True, help='Start year for predictions')
    parser.add_argument('--elo-model', required=True, help='Path to trained win ELO model JSON file')
    parser.add_argument('--margin-methods', required=True, help='Path to optimized margin methods JSON file')
    parser.add_argument('--output-dir', default='data/predictions/win', help='Output directory for files')
    parser.add_argument('--db-path', default='data/database/afl_predictions.db', help='Database path')
    parser.add_argument('--save-to-db', action='store_true', default=True,
                        help='Save predictions to database (default: True)')
    parser.add_argument('--no-save-to-db', dest='save_to_db', action='store_false',
                        help='Skip saving predictions to database')
    parser.add_argument('--predictor-id', type=int,
                        help='Predictor ID for database storage (required unless --no-save-to-db)')
    parser.add_argument('--future-only', action='store_true',
                        help='Only keep future fixtures in output (drop completed/started matches)')
    parser.add_argument('--override-completed', action='store_true',
                        help='Override predictions for completed/started matches when saving to DB')
    parser.add_argument('--method-override', choices=['simple', 'linear', 'diminishing_returns'], default=None,
                        help='Override artifact best_method for this run')
    parser.add_argument('--allow-model-mismatch', action='store_true',
                        help='Bypass model/artifact compatibility guard (unsafe)')

    args = parser.parse_args()

    if args.save_to_db and not args.predictor_id:
        parser.error('--predictor-id is required unless --no-save-to-db is used')

    if not os.path.exists(args.elo_model):
        parser.error(f'Win ELO model file not found: {args.elo_model}')
    if not os.path.exists(args.margin_methods):
        parser.error(f'Margin methods file not found: {args.margin_methods}')

    run_predictions(
        start_year=args.start_year,
        elo_model=args.elo_model,
        margin_methods=args.margin_methods,
        output_dir=args.output_dir,
        db_path=args.db_path,
        save_to_db=args.save_to_db,
        predictor_id=args.predictor_id,
        future_only=args.future_only,
        override_completed=args.override_completed,
        method_override=args.method_override,
        allow_model_mismatch=args.allow_model_mismatch
    )


if __name__ == '__main__':
    main()
