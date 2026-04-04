import os
import sys
from pathlib import Path

import pandas as pd


SCRIPTS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, SCRIPTS_DIR)

import elo_margin_predict as margin_predict_module  # noqa: E402
import elo_margin_train as margin_train_module  # noqa: E402
import elo_predict_combined as combined_predict_module  # noqa: E402
import elo_win_predict as win_predict_module  # noqa: E402
import elo_win_train as win_train_module  # noqa: E402


def build_prediction_matches():
    return pd.DataFrame([
        {
            'match_id': 1,
            'round_number': '1',
            'match_date': pd.Timestamp('2026-03-10T09:30:00Z'),
            'venue': 'MCG',
            'year': 2026,
            'home_team': 'Cats',
            'away_team': 'Swans',
            'hscore': 90,
            'ascore': 80,
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'NSW',
        },
        {
            'match_id': 2,
            'round_number': '2',
            'match_date': pd.Timestamp('2099-04-10T09:30:00Z'),
            'venue': 'SCG',
            'year': 2026,
            'home_team': 'Swans',
            'away_team': 'Lions',
            'hscore': None,
            'ascore': None,
            'venue_state': 'NSW',
            'home_team_state': 'NSW',
            'away_team_state': 'QLD',
        },
    ])


def test_win_train_main_uses_loaded_parameters_and_writes_margin_artifact(monkeypatch, tmp_path):
    db_path = tmp_path / 'afl_predictions.db'
    db_path.write_text('', encoding='utf-8')
    margin_params_path = tmp_path / 'margin-methods.json'
    margin_params_path.write_text(
        (
            '{"best_method":"simple","parameters":{"scale_factor":0.12},"margin_mae":24.5}'
        ),
        encoding='utf-8',
    )
    output_dir = tmp_path / 'models'
    captured = {}

    class FakeModel:
        def __init__(self):
            self.predictions = [{'match_id': 1, 'home_win_probability': 61, 'actual_result': 'home_win'}]
            self.team_ratings = {'Cats': 1510.0, 'Swans': 1490.0}

        def evaluate_model(self):
            return {
                'accuracy': 0.75,
                'brier_score': 0.18,
                'log_loss': 0.52,
            }

        def get_model_data(self):
            return {
                'model_type': 'win_elo',
                'parameters': {'k_factor': 24},
                'team_ratings': self.team_ratings,
            }

    training_data = pd.DataFrame([
        {'year': 2025, 'home_team': 'Cats', 'away_team': 'Swans', 'hscore': 90, 'ascore': 80}
    ])
    loaded_params = {
        'base_rating': 1500,
        'k_factor': 24,
        'home_advantage': 30,
        'default_home_advantage': 30,
        'interstate_home_advantage': 60,
        'margin_factor': 0.35,
        'season_carryover': 0.6,
        'max_margin': 100,
        'beta': 0.05,
    }

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        'argv',
        [
            'elo_win_train.py',
            '--start-year', '2024',
            '--end-year', '2025',
            '--db-path', str(db_path),
            '--output-dir', str(output_dir),
            '--params-file', str(tmp_path / 'loaded-params.json'),
            '--margin-params', str(margin_params_path),
        ],
    )
    monkeypatch.setattr(win_train_module, 'fetch_afl_data', lambda *args, **kwargs: training_data)
    monkeypatch.setattr(win_train_module, 'load_parameters', lambda path: loaded_params)
    monkeypatch.setattr(
        win_train_module,
        'train_elo_model',
        lambda data, params: captured.update(train_data=data, train_params=params) or FakeModel(),
    )
    monkeypatch.setattr(
        win_train_module,
        'evaluate_predictions',
        lambda predictions: {
            'bits_score_per_game': 0.41,
            'bits_score_total': 4.1,
        },
    )
    monkeypatch.setattr(
        win_train_module,
        'save_model',
        lambda model_data, path: captured.update(model_data=model_data, model_path=Path(path)),
    )
    monkeypatch.setattr(
        win_train_module,
        'save_predictions_to_csv',
        lambda predictions, path: captured.update(csv_predictions=predictions, csv_path=Path(path)),
    )
    monkeypatch.setattr(
        win_train_module,
        'train_margin_model',
        lambda data, model, margin_params: captured.update(
            margin_training=(data, model, margin_params)
        ) or {'method': 'simple', 'parameters': {'scale_factor': 0.12}},
    )

    win_train_module.main()

    assert captured['train_data'].equals(training_data)
    assert captured['train_params'] == loaded_params
    assert captured['model_path'] == output_dir / 'afl_elo_win_trained_to_2025.json'
    assert captured['csv_path'] == Path('data/predictions/win/afl_elo_win_trained_to_2025_predictions.csv')
    assert captured['model_data']['performance_metrics'] == {
        'accuracy': 0.75,
        'brier_score': 0.18,
        'log_loss': 0.52,
        'bits_score_per_game': 0.41,
        'bits_score_total': 4.1,
    }
    assert captured['margin_training'][2] == {
        'best_method': 'simple',
        'parameters': {'scale_factor': 0.12},
        'margin_mae': 24.5,
    }
    margin_artifact_path = output_dir / 'afl_elo_win_margin_model_trained_to_2025.json'
    assert margin_artifact_path.exists()


def test_margin_train_main_unwraps_parameter_payload_and_persists_performance(monkeypatch, tmp_path):
    output_dir = tmp_path / 'margin-models'
    params_path = tmp_path / 'wrapped-params.json'
    params_path.write_text('{}', encoding='utf-8')
    captured = {}

    class FakeMarginModel:
        def get_model_data(self):
            return {
                'model_type': 'margin_only_elo',
                'parameters': {'margin_scale': 0.12},
                'team_ratings': {'Cats': 1512.0},
            }

    wrapped_params = {
        'parameters': {
            'base_rating': 1500,
            'k_factor': 20,
            'home_advantage': 25,
            'default_home_advantage': 25,
            'interstate_home_advantage': 55,
            'season_carryover': 0.65,
            'max_margin': 100,
            'margin_scale': 0.12,
            'scaling_factor': 45,
        }
    }
    training_data = pd.DataFrame([
        {'year': 2025, 'home_team': 'Cats', 'away_team': 'Swans', 'hscore': 90, 'ascore': 80}
    ])
    performance = {
        'mae': 14.2,
        'rmse': 18.5,
        'yearly_mae': {'2025': 14.2},
        'total_matches': 1,
        'win_accuracy': 1.0,
        'brier_score': 0.15,
        'bits_score': 0.42,
    }

    monkeypatch.setattr(
        sys,
        'argv',
        [
            'elo_margin_train.py',
            '--params-file', str(params_path),
            '--start-year', '2024',
            '--end-year', '2025',
            '--db-path', str(tmp_path / 'afl_predictions.db'),
            '--output-dir', str(output_dir),
        ],
    )
    monkeypatch.setattr(margin_train_module, 'load_parameters', lambda path: wrapped_params)
    monkeypatch.setattr(margin_train_module, 'fetch_afl_data', lambda *args, **kwargs: training_data)
    monkeypatch.setattr(
        margin_train_module,
        'train_margin_model',
        lambda data, params: captured.update(train_data=data, train_params=params) or (FakeMarginModel(), ['prediction']),
    )
    monkeypatch.setattr(margin_train_module, 'evaluate_model', lambda predictions: performance)
    monkeypatch.setattr(
        margin_train_module,
        'save_model',
        lambda model_data, path: captured.update(model_data=model_data, model_path=Path(path)),
    )

    margin_train_module.main()

    assert captured['train_data'].equals(training_data)
    assert captured['train_params'] == wrapped_params['parameters']
    assert captured['model_path'] == output_dir / 'afl_elo_margin_only_trained_to_2025.json'
    assert captured['model_data']['performance'] == performance
    assert captured['model_data']['mae'] == 14.2
    assert 'created_date' in captured['model_data']


def test_win_predict_matches_saves_completed_and_future_predictions_with_override_flag(monkeypatch, tmp_path):
    captured = {}
    instances = []

    class FakeWinModel:
        def __init__(self, **params):
            self.params = params
            self.team_ratings = {'Cats': 1510.0, 'Swans': 1495.0, 'Lions': 1502.0}
            self.predictions = []
            self.rating_history = []
            instances.append(self)

        def calculate_win_probability(self, *args, **kwargs):
            return 0.61

        def predict_margin(self, *args, **kwargs):
            return 12.5

        def apply_season_carryover(self, new_year):
            captured.setdefault('carryover_years', []).append(new_year)

        def update_ratings(self, **kwargs):
            self.predictions.append({
                'match_id': kwargs['match_id'],
                'home_team': kwargs['home_team'],
                'away_team': kwargs['away_team'],
                'home_win_probability': 0.61,
                'actual_result': 'home_win',
                'hscore': kwargs['hscore'],
                'ascore': kwargs['ascore'],
            })
            return self.predictions[-1]

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(win_predict_module, 'AFLEloModel', FakeWinModel)
    monkeypatch.setattr(
        win_predict_module,
        'load_model',
        lambda path: {
            'parameters': {'base_rating': 1500, 'k_factor': 24},
            'team_ratings': {'Cats': 1510.0},
        },
    )
    monkeypatch.setattr(win_predict_module, 'fetch_matches_for_prediction', lambda db_path, start_year: build_prediction_matches())
    monkeypatch.setattr(
        win_predict_module,
        'save_predictions_to_csv',
        lambda predictions, path: captured.update(csv_predictions=predictions, csv_path=Path(path)),
    )
    monkeypatch.setattr(
        win_predict_module,
        'save_predictions_to_database',
        lambda predictions, db_path, predictor_id, override_completed=False: captured.update(
            db_predictions=predictions,
            db_args={
                'db_path': db_path,
                'predictor_id': predictor_id,
                'override_completed': override_completed,
            },
        ),
    )
    monkeypatch.setattr(
        win_predict_module,
        'evaluate_predictions',
        lambda predictions: {'accuracy': 1.0, 'bits_score_per_game': 0.4},
    )
    monkeypatch.setattr(win_predict_module, 'format_scoring_summary', lambda results: 'summary')

    win_predict_module.predict_matches(
        model_path='data/models/win/model.json',
        db_path='data/database/test.db',
        start_year=2026,
        output_dir=str(tmp_path / 'artifacts'),
        save_to_db=True,
        predictor_id=42,
        override_completed=True,
    )

    assert instances[0].params == {'base_rating': 1500, 'k_factor': 24}
    assert [prediction['match_id'] for prediction in captured['csv_predictions']] == [1, 2]
    assert captured['csv_path'] == Path('data/predictions/win/win_elo_predictions_2026_2026.csv')
    assert captured['db_args'] == {
        'db_path': 'data/database/test.db',
        'predictor_id': 42,
        'override_completed': True,
    }
    assert captured['db_predictions'][0]['predicted_margin'] == 12.5
    assert captured['db_predictions'][1]['match_id'] == 2
    assert 'actual_result' not in captured['db_predictions'][1]


def test_margin_predict_matches_applies_initial_carryover_and_preserves_predictor_id(monkeypatch, tmp_path):
    captured = {}
    instances = []

    class FakeMarginPredictor:
        def __init__(self, model_path):
            self.model_path = model_path
            self.yearly_ratings = {'2025': {'Cats': 1510.0}}
            self.predictions = []
            self.rating_history = []
            self.team_ratings = {'Cats': 1510.0, 'Swans': 1495.0, 'Lions': 1502.0}
            self.carryover_years = []
            instances.append(self)

        def apply_season_carryover(self, new_year):
            self.carryover_years.append(new_year)

        def update_ratings(self, **kwargs):
            self.predictions.append({
                'match_id': kwargs['match_id'],
                'home_team': kwargs['home_team'],
                'away_team': kwargs['away_team'],
                'match_date': kwargs['match_date'],
                'home_win_probability': 0.58,
                'predicted_margin': 10.0,
                'actual_result': 'home_win',
                'margin': kwargs['hscore'] - kwargs['ascore'],
            })

        def predict_match(self, **kwargs):
            self.predictions.append({
                'match_id': kwargs['match_id'],
                'home_team': kwargs['home_team'],
                'away_team': kwargs['away_team'],
                'match_date': kwargs['match_date'],
                'home_win_probability': 0.58,
                'predicted_margin': 10.0,
            })

        def save_predictions_to_csv(self, filename):
            captured['csv_path'] = Path(filename)

        def save_rating_history_to_csv(self, filename):
            captured['history_path'] = Path(filename)

    monkeypatch.setattr(margin_predict_module, 'AFLMarginEloPredictor', FakeMarginPredictor)
    monkeypatch.setattr(
        margin_predict_module,
        'fetch_matches_for_prediction',
        lambda db_path, start_year: build_prediction_matches(),
    )
    monkeypatch.setattr(
        margin_predict_module,
        'save_predictions_to_database',
        lambda predictions, db_path, predictor_id, override_completed=False: captured.update(
            db_predictions=predictions,
            db_args={
                'db_path': db_path,
                'predictor_id': predictor_id,
                'override_completed': override_completed,
            },
        ),
    )
    monkeypatch.setattr(
        margin_predict_module,
        'evaluate_predictions',
        lambda predictions: {'accuracy': 1.0, 'bits_score_per_game': 0.4},
    )
    monkeypatch.setattr(margin_predict_module, 'format_scoring_summary', lambda results: 'summary')

    margin_predict_module.predict_matches(
        model_path='data/models/margin/model.json',
        db_path='data/database/test.db',
        start_year=2026,
        output_dir=str(tmp_path / 'artifacts'),
        save_to_db=True,
        predictor_id=71,
        override_completed=True,
    )

    assert instances[0].carryover_years == [2026]
    assert [prediction['match_id'] for prediction in captured['db_predictions']] == [1, 2]
    assert captured['db_args'] == {
        'db_path': 'data/database/test.db',
        'predictor_id': 71,
        'override_completed': True,
    }
    assert captured['csv_path'] == Path('data/predictions/margin/margin_elo_predictions_2026_2026.csv')
    assert captured['history_path'] == tmp_path / 'artifacts' / 'margin_elo_rating_history_from_2026.csv'


def test_combined_predict_matches_filters_to_future_predictions_before_database_save(monkeypatch, tmp_path):
    captured = {}
    instances = []

    matches_df = pd.DataFrame([
        {
            'match_id': 1,
            'round_number': '1',
            'match_date': pd.Timestamp('2026-03-10T09:30:00Z'),
            'venue': 'MCG',
            'year': 2026,
            'home_team': 'Cats',
            'away_team': 'Swans',
            'hscore': 90,
            'ascore': 80,
            'venue_state': 'VIC',
            'home_team_state': 'VIC',
            'away_team_state': 'NSW',
        },
        {
            'match_id': 2,
            'round_number': '2',
            'match_date': pd.Timestamp('2001-04-10T09:30:00Z'),
            'venue': 'MCG',
            'year': 2026,
            'home_team': 'Lions',
            'away_team': 'Swans',
            'hscore': None,
            'ascore': None,
            'venue_state': 'QLD',
            'home_team_state': 'QLD',
            'away_team_state': 'NSW',
        },
        {
            'match_id': 3,
            'round_number': '2',
            'match_date': pd.Timestamp('2099-04-10T09:30:00Z'),
            'venue': 'SCG',
            'year': 2026,
            'home_team': 'Swans',
            'away_team': 'Cats',
            'hscore': None,
            'ascore': None,
            'venue_state': 'NSW',
            'home_team_state': 'NSW',
            'away_team_state': 'VIC',
        },
    ])

    class FakeCombinedPredictor:
        def __init__(self, win_model_path, margin_model_path):
            self.win_model_path = win_model_path
            self.margin_model_path = margin_model_path
            self.yearly_ratings = {'2025': {'Cats': 1510.0}}
            self.predictions = []
            self.rating_history = []
            self.carryover_years = []
            self.win_ratings = {'Cats': 1510.0, 'Swans': 1495.0}
            self.margin_ratings = {'Cats': 1508.0, 'Swans': 1492.0}
            instances.append(self)

        def apply_season_carryover(self, new_year):
            self.carryover_years.append(new_year)

        def update_ratings(self, **kwargs):
            self.predictions.append({
                'match_id': kwargs['match_id'],
                'match_date': kwargs['match_date'],
                'home_team': kwargs['home_team'],
                'away_team': kwargs['away_team'],
                'home_win_probability': 0.63,
                'predicted_margin': 11.0,
                'actual_result': 'home_win',
                'correct': True,
            })

        def predict_match(self, **kwargs):
            self.predictions.append({
                'match_id': kwargs['match_id'],
                'match_date': kwargs['match_date'],
                'home_team': kwargs['home_team'],
                'away_team': kwargs['away_team'],
                'home_win_probability': 0.63,
                'predicted_margin': 11.0,
                'predicted_winner': kwargs['home_team'],
                'confidence': 0.63,
            })

        def save_predictions_to_csv(self, filename):
            captured['csv_path'] = Path(filename)
            captured['csv_predictions'] = list(self.predictions)

        def save_predictions_to_database(self, db_path, predictor_id=6):
            captured['db_path'] = db_path
            captured['predictor_id'] = predictor_id
            captured['db_predictions'] = list(self.predictions)

        def save_rating_history_to_csv(self, filename):
            captured['history_path'] = Path(filename)

    monkeypatch.setattr(combined_predict_module, 'AFLCombinedEloPredictor', FakeCombinedPredictor)
    monkeypatch.setattr(
        combined_predict_module,
        'fetch_matches_for_prediction',
        lambda db_path, start_year: matches_df,
    )
    monkeypatch.setattr(
        combined_predict_module,
        'evaluate_predictions',
        lambda predictions: {'accuracy': 1.0, 'bits_score_per_game': 0.4},
    )
    monkeypatch.setattr(combined_predict_module, 'format_scoring_summary', lambda results: 'summary')

    combined_predict_module.predict_matches(
        win_model_path='data/models/win/model.json',
        margin_model_path='data/models/margin/model.json',
        db_path='data/database/test.db',
        start_year=2026,
        output_dir=str(tmp_path / 'artifacts'),
        save_to_db=True,
        predictor_id=81,
        future_only=True,
    )

    assert instances[0].carryover_years == [2026]
    assert captured['predictor_id'] == 81
    assert [prediction['match_id'] for prediction in captured['csv_predictions']] == [3]
    assert [prediction['match_id'] for prediction in captured['db_predictions']] == [3]
    assert captured['csv_path'] == Path('data/predictions/combined/combined_elo_predictions_2026_2026.csv')
    assert captured['history_path'] == tmp_path / 'artifacts' / 'combined_elo_rating_history_from_2026.csv'
