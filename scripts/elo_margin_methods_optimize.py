"""
AFL ELO Margin Methods

Optimizes margin derivation methods for a win ELO model and writes a
versioned testing artifact with compatibility metadata.
"""

import argparse
import json
import os
import time
from datetime import datetime, timezone
from typing import Dict, List, Tuple

import numpy as np


class ELOMarginMethods:
    """Collection of margin calculation methods built on win ELO ratings."""

    def __init__(self, home_advantage=35):
        self.home_advantage = float(home_advantage)

    def builtin_elo_margin(self, home_rating, away_rating, beta=0.04):
        rating_diff = (home_rating + self.home_advantage) - away_rating
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        return (win_probability - 0.5) / beta

    def simple_scaling_margin(self, home_rating, away_rating, scale_factor=0.125):
        rating_diff = (home_rating + self.home_advantage) - away_rating
        return rating_diff * scale_factor

    def linear_regression_margin(self, home_rating, away_rating, slope=0.1, intercept=0.0):
        rating_diff = (home_rating + self.home_advantage) - away_rating
        return rating_diff * slope + intercept

    def diminishing_returns_margin(self, home_rating, away_rating, beta=0.04):
        rating_diff = (home_rating + self.home_advantage) - away_rating
        win_probability = 1.0 / (1.0 + 10 ** (-rating_diff / 400))
        return (win_probability - 0.5) / beta


def _parse_train_end_year_from_path(model_path: str):
    import re

    match = re.search(r'trained_to_(\d{4})\.json$', str(model_path or ''))
    if not match:
        return None
    return int(match.group(1))


def _build_default_output_path(end_year: int) -> str:
    return os.path.join('data/models/win', f'optimal_margin_methods_trained_to_{end_year}.json')


def _build_signature(params: Dict) -> Dict:
    keys = [
        'base_rating',
        'k_factor',
        'default_home_advantage',
        'interstate_home_advantage',
        'home_advantage',
        'margin_factor',
        'season_carryover',
        'max_margin',
        'beta',
        'team_states'
    ]
    return {key: params.get(key) for key in keys}


def _sample_simple_candidates(n_calls: int, min_value: float, max_value: float, rng: np.random.Generator):
    base = np.array([0.1, 0.125, 0.15], dtype=float)
    sampled = rng.uniform(min_value, max_value, size=max(n_calls, 1))
    values = np.unique(np.clip(np.concatenate([base, sampled]), min_value, max_value))
    return [(float(value),) for value in values]


def _sample_diminishing_candidates(n_calls: int, min_value: float, max_value: float, rng: np.random.Generator):
    base = np.array([0.02, 0.03, 0.04, 0.05], dtype=float)
    sampled = rng.uniform(min_value, max_value, size=max(n_calls, 1))
    values = np.unique(np.clip(np.concatenate([base, sampled]), min_value, max_value))
    return [(float(value),) for value in values]


def _sample_linear_candidates(
    n_calls: int,
    slope_min: float,
    slope_max: float,
    intercept_min: float,
    intercept_max: float,
    rng: np.random.Generator
):
    base = np.array([
        [0.1, 0.0],
        [0.125, 0.0],
        [0.15, 0.0],
        [0.1, 1.0],
        [0.125, 1.0]
    ], dtype=float)

    sampled_slopes = rng.uniform(slope_min, slope_max, size=max(n_calls, 1))
    sampled_intercepts = rng.uniform(intercept_min, intercept_max, size=max(n_calls, 1))
    sampled = np.column_stack((sampled_slopes, sampled_intercepts))

    all_points = np.vstack((base, sampled))
    all_points[:, 0] = np.clip(all_points[:, 0], slope_min, slope_max)
    all_points[:, 1] = np.clip(all_points[:, 1], intercept_min, intercept_max)

    seen = set()
    candidates = []
    for slope, intercept in all_points:
        key = (round(float(slope), 6), round(float(intercept), 6))
        if key in seen:
            continue
        seen.add(key)
        candidates.append((float(slope), float(intercept)))

    return candidates


def _validate_ranges(args):
    if args.n_calls < 1:
        raise ValueError('--n-calls must be >= 1')

    pairs = [
        ('simple range', args.simple_min, args.simple_max),
        ('diminishing beta range', args.diminishing_beta_min, args.diminishing_beta_max),
        ('linear slope range', args.linear_slope_min, args.linear_slope_max),
        ('linear intercept range', args.linear_intercept_min, args.linear_intercept_max)
    ]

    for label, lower, upper in pairs:
        if lower >= upper:
            raise ValueError(f'{label} requires min < max')


def main():
    from core.data_io import fetch_afl_data, load_parameters, save_optimization_results
    from core.optimise import evaluate_margin_method_walkforward

    parser = argparse.ArgumentParser(description='Optimize AFL win-model margin derivation methods')
    parser.add_argument('--elo-params', type=str, required=True,
                        help='Path to trained win ELO model JSON (or params JSON with parameters key)')
    parser.add_argument('--db-path', type=str, default='data/database/afl_predictions.db',
                        help='Path to database (default: data/database/afl_predictions.db)')
    parser.add_argument('--start-year', type=int, default=1990,
                        help='Start year for optimization data (default: 1990)')
    parser.add_argument('--end-year', type=int, default=2024,
                        help='End year for optimization data (default: 2024)')
    parser.add_argument('--n-calls', type=int, default=100,
                        help='Number of sampled candidates per method (default: 100)')
    parser.add_argument('--random-seed', type=int, default=42,
                        help='Random seed for candidate sampling (default: 42)')
    parser.add_argument('--output-path', type=str, default=None,
                        help='Output path for optimized parameters (default: versioned path by end year)')

    parser.add_argument('--simple-min', type=float, default=0.05,
                        help='Minimum simple scale factor (default: 0.05)')
    parser.add_argument('--simple-max', type=float, default=0.25,
                        help='Maximum simple scale factor (default: 0.25)')
    parser.add_argument('--diminishing-beta-min', type=float, default=0.015,
                        help='Minimum diminishing beta (default: 0.015)')
    parser.add_argument('--diminishing-beta-max', type=float, default=0.08,
                        help='Maximum diminishing beta (default: 0.08)')
    parser.add_argument('--linear-slope-min', type=float, default=0.05,
                        help='Minimum linear slope (default: 0.05)')
    parser.add_argument('--linear-slope-max', type=float, default=0.25,
                        help='Maximum linear slope (default: 0.25)')
    parser.add_argument('--linear-intercept-min', type=float, default=-8.0,
                        help='Minimum linear intercept (default: -8.0)')
    parser.add_argument('--linear-intercept-max', type=float, default=8.0,
                        help='Maximum linear intercept (default: 8.0)')

    args = parser.parse_args()
    _validate_ranges(args)

    rng = np.random.default_rng(args.random_seed)

    loaded = load_parameters(args.elo_params)
    elo_params = loaded['parameters'] if isinstance(loaded, dict) and 'parameters' in loaded else loaded

    train_end_year_from_path = _parse_train_end_year_from_path(args.elo_params)
    output_path = args.output_path or _build_default_output_path(args.end_year)

    print('Loaded win ELO parameters:')
    for key, value in elo_params.items():
        print(f'  {key}: {value}')

    print(f"\nLoading match data from {args.start_year} to {args.end_year}...")
    matches_df = fetch_afl_data(args.db_path, args.start_year, args.end_year)
    print(f'Loaded {len(matches_df)} matches')

    methods = {
        'simple': _sample_simple_candidates(args.n_calls, args.simple_min, args.simple_max, rng),
        'diminishing_returns': _sample_diminishing_candidates(
            args.n_calls,
            args.diminishing_beta_min,
            args.diminishing_beta_max,
            rng
        ),
        'linear': _sample_linear_candidates(
            args.n_calls,
            args.linear_slope_min,
            args.linear_slope_max,
            args.linear_intercept_min,
            args.linear_intercept_max,
            rng
        )
    }

    print('\nTesting margin prediction methods...')

    best_method = None
    best_params = None
    best_score = float('inf')
    best_unweighted = float('inf')
    best_total_matches = 0
    all_results = {}

    for method_name, param_sets in methods.items():
        print(f"\n{'=' * 56}")
        print(f"TESTING: {method_name.upper().replace('_', ' ')}")
        print(f"Candidates: {len(param_sets)}")
        print(f"{'=' * 56}")

        method_best_score = float('inf')
        method_best_unweighted = float('inf')
        method_best_matches = 0
        method_best_params = None
        progress_interval = max(1, len(param_sets) // 10)
        method_started_at = time.time()

        for index, params in enumerate(param_sets, start=1):
            detailed = evaluate_margin_method_walkforward(
                list(params),
                method_name,
                elo_params,
                matches_df,
                verbose=False,
                return_detailed=True
            )

            weighted_mae = detailed['global_match_weighted_mae']
            unweighted_mae = detailed['unweighted_split_mae']
            total_matches = detailed['total_matches']

            if weighted_mae < method_best_score:
                method_best_score = weighted_mae
                method_best_unweighted = unweighted_mae
                method_best_matches = total_matches
                method_best_params = params

            if index == 1 or index == len(param_sets) or index % progress_interval == 0:
                elapsed_seconds = max(0.0, time.time() - method_started_at)
                rate = index / elapsed_seconds if elapsed_seconds > 0 else 0.0
                remaining = len(param_sets) - index
                eta_seconds = int(remaining / rate) if rate > 0 else 0
                progress_pct = (index / len(param_sets)) * 100.0
                print(
                    f'  Progress: {index}/{len(param_sets)} ({progress_pct:.0f}%) '
                    f'| best weighted MAE {method_best_score:.4f} '
                    f'| ETA ~{eta_seconds}s'
                )

        if method_name == 'simple':
            method_params = {'scale_factor': float(method_best_params[0])}
        elif method_name == 'diminishing_returns':
            method_params = {'beta': float(method_best_params[0])}
        elif method_name == 'linear':
            method_params = {
                'slope': float(method_best_params[0]),
                'intercept': float(method_best_params[1])
            }
        else:
            method_params = {f'param_{idx}': float(value) for idx, value in enumerate(method_best_params)}

        all_results[method_name] = {
            'score': float(method_best_score),
            'unweighted_split_mae': float(method_best_unweighted),
            'total_matches': int(method_best_matches),
            'params': method_params
        }

        print(f'Best weighted MAE: {method_best_score:.4f}')
        print(f'Best unweighted split MAE: {method_best_unweighted:.4f}')
        print(f'Total validation matches: {method_best_matches}')
        print(f'Best params: {method_params}')

        if method_best_score < best_score:
            best_score = method_best_score
            best_unweighted = method_best_unweighted
            best_total_matches = method_best_matches
            best_method = method_name
            best_params = method_params

    print(f"\n{'=' * 66}")
    print('MARGIN METHODS OPTIMIZATION COMPLETE')
    print(f"{'=' * 66}")
    print(f'Best method: {best_method}')
    print(f'Best weighted MAE: {best_score:.4f}')
    print(f'Best unweighted split MAE: {best_unweighted:.4f}')

    output_data = {
        'artifact_version': 2,
        'artifact_type': 'win_margin_methods',
        'created_at': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'train_window': {
            'start_year': int(args.start_year),
            'end_year': int(args.end_year)
        },
        'optimization_settings': {
            'selection_metric': 'global_match_weighted_mae',
            'n_calls': int(args.n_calls),
            'random_seed': int(args.random_seed),
            'search_space': {
                'simple': {
                    'scale_factor': [float(args.simple_min), float(args.simple_max)]
                },
                'diminishing_returns': {
                    'beta': [float(args.diminishing_beta_min), float(args.diminishing_beta_max)]
                },
                'linear': {
                    'slope': [float(args.linear_slope_min), float(args.linear_slope_max)],
                    'intercept': [float(args.linear_intercept_min), float(args.linear_intercept_max)]
                }
            }
        },
        'best_method': best_method,
        'best_params': best_params,
        'best_score': float(best_score),
        'best_unweighted_split_mae': float(best_unweighted),
        'best_total_matches': int(best_total_matches),
        'all_methods': all_results,
        'required_win_model': {
            'model_type': 'win_elo',
            'train_end_year': train_end_year_from_path,
            'parameter_signature': _build_signature(elo_params)
        },
        'elo_params_used': elo_params
    }

    save_optimization_results(output_data, output_path)
    print(f'\nSaved optimized margin methods to: {output_path}')


if __name__ == '__main__':
    main()
