#!/usr/bin/env python3
"""
Pytest test suite for AFL ELO optimization script validation.

Tests the optimization script functionality, parameter validation,
and home advantage application correctness.

Run with: pytest scripts/tests/test_optimization.py -v
"""

import pytest
import numpy as np
import pandas as pd
import sys
import os
import tempfile
import json
from unittest.mock import patch, MagicMock

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from core.elo_core import AFLEloModel
    from core.data_io import get_team_states
    from core.optimise import get_elo_parameter_space, WalkForwardEvaluator, CrossValidationEvaluator, create_optimization_objective
    
    # Get TEAM_STATES from data_io
    TEAM_STATES = get_team_states('data/database/afl_predictions.db')
    elo_space = get_elo_parameter_space().dimensions
    
    # Create a basic evaluation function for testing
    def evaluate_parameters_walkforward(params, data, verbose=False):
        """Test evaluation function"""
        if len(params) != 7:
            return np.inf
        
        param_dict = {
            'k_factor': params[0],
            'default_home_advantage': params[1], 
            'interstate_home_advantage': params[2],
            'margin_factor': params[3],
            'season_carryover': params[4],
            'max_margin': params[5],
            'beta': params[6]
        }
        
        evaluator = WalkForwardEvaluator(metric='brier_score')
        return evaluator.evaluate(AFLEloModel, param_dict, data)
    
except ImportError as e:
    pytest.skip(f"Required modules not available: {e}", allow_module_level=True)


class TestAFLEloModel:
    """Test the AFL ELO model implementation"""
    
    def test_model_initialization(self):
        """Test that AFLEloModel initializes with correct parameters"""
        model = AFLEloModel(
            k_factor=25,
            default_home_advantage=20,
            interstate_home_advantage=60,
            margin_factor=0.4,
            season_carryover=0.7,
            max_margin=100,
            beta=0.05
        )
        
        assert model.k_factor == 25
        assert model.default_home_advantage == 20
        assert model.interstate_home_advantage == 60
        assert model.margin_factor == 0.4
        assert model.season_carryover == 0.7
        assert model.max_margin == 100
        assert model.beta == 0.05
        assert model.base_rating == 1500  # default
    
    def test_dual_home_advantage_application(self):
        """Test that correct home advantage is applied based on game context"""
        from core.data_io import get_database_connection
        
        model = AFLEloModel(
            default_home_advantage=20,
            interstate_home_advantage=60
        )
        
        # Initialize teams with same rating for clean test
        teams = ['Richmond', 'Carlton', 'Adelaide', 'West Coast']
        model.initialize_ratings(teams)
        
        # Get database connection and find venues
        db_connection = get_database_connection('data/database/afl_predictions.db')
        cursor = db_connection.cursor()
        cursor.execute("SELECT name, state FROM venues WHERE state IN ('VIC', 'SA') LIMIT 2")
        venues = cursor.fetchall()
        
        if len(venues) >= 2:
            vic_venue = next(v[0] for v in venues if v[1] == 'VIC')
            sa_venue = next(v[0] for v in venues if v[1] == 'SA')
            
            # Same-state match (Victoria teams at VIC venue)
            same_state_prob = model.calculate_win_probability('Richmond', 'Carlton', vic_venue, db_connection)
            
            # Interstate match (Victoria vs South Australia at VIC venue)
            interstate_prob = model.calculate_win_probability('Richmond', 'Adelaide', vic_venue, db_connection)
            
            # Calculate expected probabilities
            expected_same_state = 1 / (1 + 10 ** (-20 / 400))
            expected_interstate = 1 / (1 + 10 ** (-60 / 400))
            
            # Validate calculations (within floating point precision)
            assert abs(same_state_prob - expected_same_state) < 1e-6
            assert abs(interstate_prob - expected_interstate) < 1e-6
            
            # Interstate should have higher win probability
            assert interstate_prob > same_state_prob
            
            # Should have significant difference (at least 5%)
            assert (interstate_prob - same_state_prob) > 0.05
    
    def test_contextual_home_advantage_logic(self):
        """Test get_contextual_home_advantage method directly"""
        from core.data_io import get_database_connection
        
        model = AFLEloModel(
            default_home_advantage=25,
            interstate_home_advantage=75
        )
        
        # Get database connection and find venues
        db_connection = get_database_connection('data/database/afl_predictions.db')
        cursor = db_connection.cursor()
        cursor.execute("SELECT name, state FROM venues WHERE state IN ('VIC', 'SA', 'WA') LIMIT 6")
        venues = cursor.fetchall()
        
        if venues:
            venues_by_state = {}
            for venue_name, state in venues:
                if state not in venues_by_state:
                    venues_by_state[state] = venue_name
            
            # Same-state scenarios
            if 'VIC' in venues_by_state:
                vic_same = model.get_contextual_home_advantage('Richmond', 'Carlton', venues_by_state['VIC'], db_connection)
                assert vic_same == 25
            
            if 'SA' in venues_by_state:
                sa_same = model.get_contextual_home_advantage('Adelaide', 'Port Adelaide', venues_by_state['SA'], db_connection)
                assert sa_same == 25
            
            # Interstate scenarios
            if 'VIC' in venues_by_state:
                vic_vs_sa = model.get_contextual_home_advantage('Richmond', 'Adelaide', venues_by_state['VIC'], db_connection)
                assert vic_vs_sa == 75
            
            if 'WA' in venues_by_state:
                wa_vs_vic = model.get_contextual_home_advantage('West Coast', 'Carlton', venues_by_state['WA'], db_connection)
                assert wa_vs_vic == 75
    
    def test_team_state_mapping_coverage(self):
        """Test that all current AFL teams have state mappings"""
        current_teams = [
            'Adelaide', 'Brisbane Lions', 'Carlton', 'Collingwood', 'Essendon',
            'Fremantle', 'Geelong', 'Gold Coast', 'Greater Western Sydney',
            'Hawthorn', 'Melbourne', 'North Melbourne', 'Port Adelaide',
            'Richmond', 'St Kilda', 'Sydney', 'West Coast', 'Western Bulldogs'
        ]
        
        for team in current_teams:
            assert team in TEAM_STATES, f"Team {team} missing from TEAM_STATES"
            assert TEAM_STATES[team] in ['VIC', 'SA', 'WA', 'QLD', 'NSW', 'TAS'], \
                f"Invalid state for team {team}: {TEAM_STATES[team]}"
    
    def test_interstate_detection_logic(self):
        """Test that interstate detection works correctly"""
        model = AFLEloModel()
        
        # Test cases: (home_team, away_team, expected_interstate)
        test_cases = [
            ('Richmond', 'Carlton', False),      # VIC vs VIC
            ('Adelaide', 'Port Adelaide', False), # SA vs SA
            ('West Coast', 'Fremantle', False),  # WA vs WA
            ('Richmond', 'Adelaide', True),      # VIC vs SA
            ('West Coast', 'Carlton', True),     # WA vs VIC
            ('Brisbane Lions', 'Sydney', True),  # QLD vs NSW
        ]
        
        for home_team, away_team, expected_interstate in test_cases:
            home_state = TEAM_STATES.get(home_team)
            away_state = TEAM_STATES.get(away_team)
            actual_interstate = home_state != away_state
            
            assert actual_interstate == expected_interstate, \
                f"{home_team} vs {away_team}: expected {expected_interstate}, got {actual_interstate}"


class TestOptimizationParameterSpace:
    """Test optimization parameter space configuration"""
    
    def test_parameter_space_structure(self):
        """Test that elo_space has correct parameters"""
        param_names = [dim.name for dim in elo_space]
        
        expected_params = [
            'k_factor', 'default_home_advantage', 'interstate_home_advantage',
            'margin_factor', 'season_carryover', 'max_margin', 'beta'
        ]
        
        assert param_names == expected_params
    
    def test_parameter_ranges_are_sensible(self):
        """Test that parameter ranges are reasonable for AFL ELO"""
        param_dict = {dim.name: dim for dim in elo_space}
        
        # k_factor should be reasonable for AFL
        k_factor = param_dict['k_factor']
        assert k_factor.low == 10
        assert k_factor.high == 50
        
        # Home advantages
        default_ha = param_dict['default_home_advantage']
        interstate_ha = param_dict['interstate_home_advantage']
        assert default_ha.low == 0
        assert default_ha.high == 80
        assert interstate_ha.low == 20
        assert interstate_ha.high == 120
        
        # Interstate minimum should be higher than default minimum
        assert interstate_ha.low > default_ha.low
        
        # Season carryover should be between 0 and 1
        carryover = param_dict['season_carryover']
        assert carryover.low >= 0.3
        assert carryover.high <= 0.95
    
    def test_parameter_types(self):
        """Test that parameters have correct types"""
        from skopt.space import Real, Integer
        
        param_dict = {dim.name: dim for dim in elo_space}
        
        # Integer parameters
        assert isinstance(param_dict['k_factor'], Integer)
        assert isinstance(param_dict['default_home_advantage'], Integer)
        assert isinstance(param_dict['interstate_home_advantage'], Integer)
        assert isinstance(param_dict['max_margin'], Integer)
        
        # Real parameters
        assert isinstance(param_dict['margin_factor'], Real)
        assert isinstance(param_dict['season_carryover'], Real)
        assert isinstance(param_dict['beta'], Real)


class TestObjectiveFunction:
    """Test the optimization objective function"""
    
    @pytest.fixture
    def sample_matches_data(self):
        """Create sample match data for testing"""
        data = []
        teams = ['Richmond', 'Carlton', 'Adelaide', 'West Coast']
        
        for i in range(50):  # Create 50 sample matches
            home_team = teams[i % len(teams)]
            away_team = teams[(i + 1) % len(teams)]
            
            if home_team == away_team:
                away_team = teams[(i + 2) % len(teams)]
            
            data.append({
                'id': i + 1,
                'year': 2022 + (i // 25),  # Two years of data
                'round': f'R{(i % 25) + 1}',
                'match_date': f'2022-03-{(i % 28) + 1:02d}',
                'home_team': home_team,
                'away_team': away_team,
                'hscore': 100 + (i % 20),  # Varied scores
                'ascore': 90 + (i % 15),
                'venue': 'Test Venue'
            })
        
        return pd.DataFrame(data)
    
    def test_objective_function_determinism(self, sample_matches_data):
        """Test that objective function returns identical results for identical parameters"""
        test_params = [25, 15, 45, 0.4, 0.7, 100, 0.05]
        
        # Run evaluation multiple times
        scores = []
        for _ in range(3):
            score = evaluate_parameters_walkforward(test_params, sample_matches_data, verbose=False)
            scores.append(score)
        
        # All scores should be identical (deterministic)
        assert len(set(scores)) == 1, f"Non-deterministic results: {scores}"
        assert all(np.isfinite(score) for score in scores), "Objective function returned non-finite values"
    
    def test_parameter_boundary_validation(self, sample_matches_data):
        """Test that boundary parameter values produce finite scores"""
        # Test minimum parameters
        min_params = [10, 0, 20, 0.1, 0.3, 60, 0.02]
        min_score = evaluate_parameters_walkforward(min_params, sample_matches_data, verbose=False)
        
        # Test maximum parameters
        max_params = [50, 80, 120, 0.7, 0.95, 180, 0.08]
        max_score = evaluate_parameters_walkforward(max_params, sample_matches_data, verbose=False)
        
        assert np.isfinite(min_score), f"Minimum parameters produced invalid score: {min_score}"
        assert np.isfinite(max_score), f"Maximum parameters produced invalid score: {max_score}"
        
        # Scores should be reasonable Brier scores (0-1 range)
        assert 0 <= min_score <= 1, f"Minimum score out of range: {min_score}"
        assert 0 <= max_score <= 1, f"Maximum score out of range: {max_score}"
    
    def test_home_advantage_parameter_effect(self, sample_matches_data):
        """Test that home advantage parameters affect performance"""
        # Test with reversed home advantage (should be worse)
        wrong_params = [25, 50, 30, 0.4, 0.7, 100, 0.05]  # default > interstate
        wrong_score = evaluate_parameters_walkforward(wrong_params, sample_matches_data, verbose=False)
        
        # Test with correct ordering
        right_params = [25, 30, 50, 0.4, 0.7, 100, 0.05]  # interstate > default
        right_score = evaluate_parameters_walkforward(right_params, sample_matches_data, verbose=False)
        
        assert np.isfinite(wrong_score) and np.isfinite(right_score)
        
        # Note: Due to limited test data, we can't guarantee which is better,
        # but both should produce valid scores
        assert 0 <= wrong_score <= 1
        assert 0 <= right_score <= 1
    
    def test_insufficient_data_handling(self):
        """Test that objective function handles insufficient data gracefully"""
        # Create data with only one season
        single_season_data = pd.DataFrame([{
            'id': 1,
            'year': 2022,
            'round': 'R1',
            'match_date': '2022-03-15',
            'home_team': 'Richmond',
            'away_team': 'Carlton',
            'hscore': 100,
            'ascore': 90,
            'venue': 'MCG'
        }])
        
        test_params = [25, 15, 45, 0.4, 0.7, 100, 0.05]
        score = evaluate_parameters_walkforward(test_params, single_season_data, verbose=False)
        
        # Should return infinity for insufficient data
        assert score == np.inf


class TestOptimizationIntegration:
    """Test integration aspects of the optimization system"""
    
    def test_parameter_extraction_and_serialization(self):
        """Test that optimization results can be properly serialized"""
        # Mock optimization result
        class MockResult:
            def __init__(self):
                self.x = [25, 15, 45, 0.4, 0.7, 100, 0.05]
                self.fun = 0.2234
                self.func_vals = [0.25, 0.24, 0.2234]
        
        result = MockResult()
        
        # Extract parameters as the optimization script does
        best_params = {
            'k_factor': result.x[0],
            'default_home_advantage': result.x[1],
            'interstate_home_advantage': result.x[2],
            'margin_factor': result.x[3],
            'season_carryover': result.x[4],
            'max_margin': result.x[5],
            'beta': result.x[6],
            'base_rating': 1500
        }
        
        # Convert to JSON-safe format
        json_safe_params = {}
        for key, value in best_params.items():
            if hasattr(value, 'item'):  # NumPy scalar
                json_safe_params[key] = value.item()
            else:
                json_safe_params[key] = float(value) if isinstance(value, (int, float)) else value
        
        output_data = {
            'parameters': json_safe_params,
            'log_loss': float(result.fun),
            'n_iterations': len(result.func_vals),
            'optimization_method': 'bayesian'
        }
        
        # Test JSON serialization
        json_str = json.dumps(output_data, indent=4)
        reloaded_data = json.loads(json_str)
        
        assert reloaded_data['parameters']['k_factor'] == 25
        assert reloaded_data['parameters']['default_home_advantage'] == 15
        assert reloaded_data['parameters']['interstate_home_advantage'] == 45
        assert reloaded_data['log_loss'] == 0.2234
        assert reloaded_data['optimization_method'] == 'bayesian'
    
    def test_optimization_configuration_validation(self):
        """Test that optimization configuration is set up correctly"""
        # This would test the actual gp_minimize parameters if we could access them
        # For now, we validate the parameter space is correctly configured
        
        assert len(elo_space) == 7, "Expected 7 optimization parameters"
        
        # Validate parameter order matches extraction logic
        expected_order = [
            'k_factor', 'default_home_advantage', 'interstate_home_advantage',
            'margin_factor', 'season_carryover', 'max_margin', 'beta'
        ]
        
        actual_order = [dim.name for dim in elo_space]
        assert actual_order == expected_order, f"Parameter order mismatch: {actual_order}"


if __name__ == '__main__':
    # Run tests if called directly
    pytest.main([__file__, '-v'])