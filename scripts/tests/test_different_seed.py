#!/usr/bin/env python3
"""
Test optimization with different random seeds
"""

import sys
sys.path.append('scripts')
from skopt import gp_minimize
from scripts.afl_elo_optimize_standard import elo_space, evaluate_parameters_walkforward
from afl_elo_train_standard import fetch_afl_data

matches_df = fetch_afl_data('data/afl_predictions.db', start_year=1990, end_year=2024)

def test_seed(seed):
    print(f"\n=== Testing with random seed {seed} ===")
    call_count = [0]
    
    def logged_objective(params):
        call_count[0] += 1
        score = evaluate_parameters_walkforward(params, matches_df, verbose=False)
        if call_count[0] <= 5:  # Only log first 5
            print(f"Call {call_count[0]:2d}: Score {score:.6f} - k:{params[0]:2.0f}, dha:{params[1]:2.0f}, iha:{params[2]:3.0f}")
        return score

    result = gp_minimize(
        func=logged_objective,
        dimensions=elo_space,
        n_calls=10,
        n_initial_points=5,
        random_state=seed
    )
    
    print(f"Best score: {result.fun:.6f}")
    return result.fun

# Test several different seeds
seeds = [42, 123, 456, 789, 999]
for seed in seeds:
    test_seed(seed)