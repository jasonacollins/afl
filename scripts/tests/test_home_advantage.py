#!/usr/bin/env python3
"""
Focused pytest tests specifically for home advantage application validation.

These tests ensure the dual home advantage system is working correctly
and that the optimization script is applying the right advantage values.

Run with: pytest scripts/tests/test_home_advantage.py -v
"""

import pytest
import numpy as np
import sys
import os

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from core.elo_core import AFLEloModel
    from core.data_io import get_team_states
    
    # Get TEAM_STATES from data_io - use absolute path for testing
    import os
    db_path = os.path.join(os.path.dirname(__file__), '../../data/database/afl_predictions.db')
    TEAM_STATES = get_team_states(db_path)
    
except ImportError as e:
    pytest.skip(f"Required modules not available: {e}", allow_module_level=True)


class TestHomeAdvantageApplication:
    """Focused tests for home advantage application correctness"""
    
    @pytest.fixture
    def test_model(self):
        """Create a test model with clear parameter differences"""
        return AFLEloModel(
            base_rating=1500,
            k_factor=25,
            default_home_advantage=20,     # Same-state advantage
            interstate_home_advantage=60,  # Interstate advantage (3x higher)
            margin_factor=0.4,
            season_carryover=0.7,
            max_margin=100,
            beta=0.05
        )
    
    def test_same_state_matches_use_default_advantage(self, test_model):
        """Test that same-state matches use default_home_advantage"""
        teams = ['Richmond', 'Carlton', 'Collingwood', 'Melbourne']
        test_model.initialize_ratings(teams)
        
        # All Victoria teams - should use default advantage
        vic_matches = [
            ('Richmond', 'Carlton'),
            ('Collingwood', 'Melbourne'),
            ('Carlton', 'Richmond'),
        ]
        
        expected_prob = 1 / (1 + 10 ** (-20 / 400))  # default_home_advantage = 20
        
        for home, away in vic_matches:
            prob = test_model.calculate_win_probability(home, away)
            assert abs(prob - expected_prob) < 1e-6, \
                f"Same-state match {home} vs {away}: expected {expected_prob:.6f}, got {prob:.6f}"
    
    def test_interstate_matches_use_interstate_advantage(self, test_model):
        """Test that interstate matches use interstate_home_advantage"""
        teams = ['Richmond', 'Adelaide', 'West Coast', 'Brisbane Lions', 'Sydney']
        test_model.initialize_ratings(teams)
        
        # Interstate matches - should use interstate advantage
        interstate_matches = [
            ('Richmond', 'Adelaide'),      # VIC vs SA
            ('West Coast', 'Richmond'),    # WA vs VIC
            ('Brisbane Lions', 'Adelaide'), # QLD vs SA
            ('Sydney', 'West Coast'),      # NSW vs WA
        ]
        
        expected_prob = 1 / (1 + 10 ** (-60 / 400))  # interstate_home_advantage = 60
        
        for home, away in interstate_matches:
            prob = test_model.calculate_win_probability(home, away)
            assert abs(prob - expected_prob) < 1e-6, \
                f"Interstate match {home} vs {away}: expected {expected_prob:.6f}, got {prob:.6f}"
    
    def test_interstate_advantage_is_significantly_higher(self, test_model):
        """Test that interstate advantage provides significantly higher win probability"""
        teams = ['Richmond', 'Carlton', 'Adelaide']
        test_model.initialize_ratings(teams)
        
        same_state_prob = test_model.calculate_win_probability('Richmond', 'Carlton')
        interstate_prob = test_model.calculate_win_probability('Richmond', 'Adelaide')
        
        # Interstate should be higher
        assert interstate_prob > same_state_prob
        
        # Should have substantial difference (at least 5% given our test parameters)
        difference = interstate_prob - same_state_prob
        assert difference > 0.05, f"Advantage difference too small: {difference:.6f}"
        
        # With our test parameters (20 vs 60), should be about 5.67% difference
        expected_difference = 0.0567
        assert abs(difference - expected_difference) < 0.001, \
            f"Expected difference ~{expected_difference:.4f}, got {difference:.6f}"
    
    def test_contextual_advantage_calculation_direct(self, test_model):
        """Test get_contextual_home_advantage method directly"""
        from core.data_io import get_database_connection
        
        # Get database connection
        import os
        db_path = os.path.join(os.path.dirname(__file__), '../../data/database/afl_predictions.db')
        db_connection = get_database_connection(db_path)
        
        # Initialize team ratings with database to load team states
        teams = ['Richmond', 'Carlton', 'Adelaide', 'Port Adelaide']
        test_model.initialize_ratings(teams, db_path)
        
        # Query database for actual venues by state
        cursor = db_connection.cursor()
        cursor.execute("SELECT name, state FROM venues WHERE state IS NOT NULL")
        venues_by_state = {}
        for venue_name, state in cursor.fetchall():
            if state not in venues_by_state:
                venues_by_state[state] = []
            venues_by_state[state].append(venue_name)
        
        # Find same-state scenarios from database
        if 'VIC' in venues_by_state:
            vic_venue = venues_by_state['VIC'][0]
            advantage = test_model.get_contextual_home_advantage('Richmond', 'Carlton', vic_venue, db_connection)
            assert advantage == 20, f"Same-state VIC teams at {vic_venue}: expected 20, got {advantage}"
        
        if 'SA' in venues_by_state:
            sa_venue = venues_by_state['SA'][0]
            advantage = test_model.get_contextual_home_advantage('Adelaide', 'Port Adelaide', sa_venue, db_connection)
            assert advantage == 20, f"Same-state SA teams at {sa_venue}: expected 20, got {advantage}"
        
        # Find interstate scenarios from database
        if 'VIC' in venues_by_state:
            vic_venue = venues_by_state['VIC'][0]
            advantage = test_model.get_contextual_home_advantage('Richmond', 'Adelaide', vic_venue, db_connection)
            assert advantage == 60, f"Interstate VIC vs SA at {vic_venue}: expected 60, got {advantage}"
        
        if 'SA' in venues_by_state:
            sa_venue = venues_by_state['SA'][0]
            advantage = test_model.get_contextual_home_advantage('Adelaide', 'Richmond', sa_venue, db_connection)
            assert advantage == 60, f"Interstate SA vs VIC at {sa_venue}: expected 60, got {advantage}"
    
    def test_venue_state_fallback_logic(self, test_model):
        """Test that venue_state falls back to default when no venue provided"""
        
        # When no venue is provided, should use default home advantage
        no_venue_advantage = test_model.get_contextual_home_advantage('Richmond', 'Adelaide', None)
        assert no_venue_advantage == 20, f"No venue provided: expected 20, got {no_venue_advantage}"
        
        # Same for other teams
        no_venue_advantage2 = test_model.get_contextual_home_advantage('Adelaide', 'Richmond', None)
        assert no_venue_advantage2 == 20, f"No venue provided: expected 20, got {no_venue_advantage2}"
    
    @pytest.mark.parametrize("home_team,away_team,expected_interstate", [
        # Same-state cases
        ('Richmond', 'Carlton', False),
        ('Adelaide', 'Port Adelaide', False),  
        ('West Coast', 'Fremantle', False),
        ('Brisbane Lions', 'Gold Coast', False),
        ('Sydney', 'Greater Western Sydney', False),
        
        # Interstate cases
        ('Richmond', 'Adelaide', True),
        ('West Coast', 'Carlton', True),
        ('Brisbane Lions', 'Sydney', True),
        ('Adelaide', 'Fremantle', True),
        ('Geelong', 'Port Adelaide', True),
    ])
    def test_interstate_detection_comprehensive(self, test_model, home_team, away_team, expected_interstate):
        """Comprehensive test of interstate detection logic"""
        home_state = TEAM_STATES.get(home_team)
        away_state = TEAM_STATES.get(away_team)
        
        # Verify both teams have state mappings
        assert home_state is not None, f"No state mapping for {home_team}"
        assert away_state is not None, f"No state mapping for {away_team}"
        
        # Test the logic
        actual_interstate = home_state != away_state
        assert actual_interstate == expected_interstate, \
            f"{home_team} ({home_state}) vs {away_team} ({away_state}): " \
            f"expected interstate={expected_interstate}, got {actual_interstate}"
        
        # Test that the model applies correct advantage
        expected_advantage = 60 if expected_interstate else 20
        actual_advantage = test_model.get_contextual_home_advantage(home_team, away_team, home_state)
        assert actual_advantage == expected_advantage, \
            f"{home_team} vs {away_team}: expected advantage {expected_advantage}, got {actual_advantage}"
    
    def test_probability_calculations_are_mathematically_correct(self, test_model):
        """Test that probability calculations follow correct ELO formula"""
        teams = ['Richmond', 'Adelaide']
        test_model.initialize_ratings(teams)
        
        # Get the probabilities
        same_state_prob = test_model.calculate_win_probability('Richmond', 'Carlton')
        interstate_prob = test_model.calculate_win_probability('Richmond', 'Adelaide')
        
        # Manual calculation using ELO formula: 1 / (1 + 10^(-rating_diff/400))
        
        # Same-state: rating_diff = (1500 + 20) - 1500 = 20
        manual_same_state = 1 / (1 + 10 ** (-20 / 400))
        
        # Interstate: rating_diff = (1500 + 60) - 1500 = 60  
        manual_interstate = 1 / (1 + 10 ** (-60 / 400))
        
        assert abs(same_state_prob - manual_same_state) < 1e-10, \
            f"Same-state calculation error: model={same_state_prob:.10f}, manual={manual_same_state:.10f}"
        
        assert abs(interstate_prob - manual_interstate) < 1e-10, \
            f"Interstate calculation error: model={interstate_prob:.10f}, manual={manual_interstate:.10f}"
        
        # Verify the actual probability values match our expectations
        assert abs(same_state_prob - 0.5288) < 0.001, f"Same-state prob: {same_state_prob:.4f}"
        assert abs(interstate_prob - 0.5855) < 0.001, f"Interstate prob: {interstate_prob:.4f}"


class TestHomeAdvantageParameterValidation:
    """Test that home advantage parameters are validated correctly"""
    
    def test_interstate_advantage_should_be_higher_than_default(self):
        """Test the logical expectation that interstate advantage > default"""
        
        # This should be enforced by the optimization parameter space
        from core.optimise import get_elo_parameter_space
        elo_space = get_elo_parameter_space().dimensions
        
        param_dict = {dim.name: dim for dim in elo_space}
        default_range = param_dict['default_home_advantage']
        interstate_range = param_dict['interstate_home_advantage']
        
        # Interstate minimum should be higher than default minimum
        assert interstate_range.low > default_range.low
        
        # Interstate range should allow for values higher than default maximum
        assert interstate_range.high > default_range.high
    
    def test_extreme_parameter_combinations(self):
        """Test that extreme but valid parameter combinations work"""
        
        # Minimum interstate advantage
        model1 = AFLEloModel(default_home_advantage=0, interstate_home_advantage=20)
        teams = ['Richmond', 'Adelaide']
        model1.initialize_ratings(teams)
        
        prob1 = model1.calculate_win_probability('Richmond', 'Adelaide')
        assert 0.5 < prob1 < 1.0, f"Minimum interstate advantage: {prob1}"
        
        # Maximum advantages
        model2 = AFLEloModel(default_home_advantage=80, interstate_home_advantage=120)
        model2.initialize_ratings(teams)
        
        same_state_prob = model2.calculate_win_probability('Richmond', 'Carlton')
        interstate_prob = model2.calculate_win_probability('Richmond', 'Adelaide')
        
        assert interstate_prob > same_state_prob
        assert 0.5 < same_state_prob < 1.0
        assert 0.5 < interstate_prob < 1.0
    
    def test_parameter_consistency_across_calculations(self):
        """Test that home advantage parameters are consistently applied"""
        
        model = AFLEloModel(default_home_advantage=15, interstate_home_advantage=45)
        teams = ['Richmond', 'Carlton', 'Adelaide', 'West Coast']
        model.initialize_ratings(teams)
        
        # Test that home advantage is consistently applied
        # Both teams get home advantage when they're the home team
        richmond_home_prob = model.calculate_win_probability('Richmond', 'Carlton')
        carlton_home_prob = model.calculate_win_probability('Carlton', 'Richmond')
        
        # Both should be > 0.5 because both get home advantage
        assert richmond_home_prob > 0.5, f"Richmond home advantage not applied: {richmond_home_prob}"
        assert carlton_home_prob > 0.5, f"Carlton home advantage not applied: {carlton_home_prob}"
        
        # Since teams have equal ratings, home advantage should give identical probabilities
        assert abs(richmond_home_prob - carlton_home_prob) < 1e-10, \
            f"Home advantage not consistent: Richmond={richmond_home_prob}, Carlton={carlton_home_prob}"
        
        # All interstate matches with same home/away pattern should be identical
        interstate_probs = [
            model.calculate_win_probability('Richmond', 'Adelaide'),
            model.calculate_win_probability('Richmond', 'West Coast'),
        ]
        
        assert abs(interstate_probs[0] - interstate_probs[1]) < 1e-10, \
            f"Interstate probabilities should be identical: {interstate_probs}"


if __name__ == '__main__':
    # Run tests if called directly
    pytest.main([__file__, '-v'])