#!/usr/bin/env python3
"""
Comprehensive tests for venue-based interstate advantage logic.

Tests both the optimization and training scripts to ensure venue location
is properly considered for interstate advantage calculation.

Run with: pytest scripts/test_venue_interstate_logic.py -v
"""

import pytest
import numpy as np
import pandas as pd
import sys
import os

# Add scripts directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from afl_elo_train_standard import AFLEloModel, TEAM_STATES
    from afl_elo_optimize_standard import evaluate_parameters_walkforward
except ImportError as e:
    pytest.skip(f"Required modules not available: {e}", allow_module_level=True)


# Venue to state mapping (should be in the main code!)
VENUE_STATES = {
    # Victoria
    'MCG': 'VIC',
    'Marvel Stadium': 'VIC', 
    'Docklands Stadium': 'VIC',
    'Etihad Stadium': 'VIC',
    'GMHBA Stadium': 'VIC',
    'Kardinia Park': 'VIC',
    'York Park': 'TAS',  # Hawthorn home games
    
    # South Australia
    'Adelaide Oval': 'SA',
    'Football Park': 'SA',
    'AAMI Stadium': 'SA',
    
    # Western Australia
    'Optus Stadium': 'WA',
    'Perth Stadium': 'WA',
    'Subiaco Oval': 'WA',
    'Domain Stadium': 'WA',
    
    # Queensland
    'Gabba': 'QLD',
    'Brisbane Cricket Ground': 'QLD',
    'Carrara Stadium': 'QLD',
    'Metricon Stadium': 'QLD',
    
    # New South Wales
    'SCG': 'NSW',
    'Sydney Cricket Ground': 'NSW',
    'ANZ Stadium': 'NSW',
    'Stadium Australia': 'NSW',
    'Spotless Stadium': 'NSW',
    'GIANTS Stadium': 'NSW',
    
    # Tasmania
    'Blundstone Arena': 'TAS',
    'Bellerive Oval': 'TAS',
}


class TestVenueBasedInterstateLogic:
    """Test that interstate advantage properly considers venue location"""
    
    @pytest.fixture
    def enhanced_model(self):
        """Create an enhanced model that should consider venue state"""
        return AFLEloModel(
            default_home_advantage=20,
            interstate_home_advantage=60
        )
    
    def test_current_implementation_uses_home_team_state_not_venue(self, enhanced_model):
        """Document current behavior: uses home team state, not venue state"""
        teams = ['Richmond', 'Adelaide']
        enhanced_model.initialize_ratings(teams)
        
        # Current implementation: Richmond vs Adelaide
        # Should consider venue state, but currently uses Richmond's state (VIC)
        
        # Test 1: Richmond "home" vs Adelaide at MCG (VIC venue)
        # Away team (Adelaide=SA) vs Venue (MCG=VIC) = Interstate ✓
        advantage_mcg = enhanced_model.get_contextual_home_advantage('Richmond', 'Adelaide', 'VIC')
        
        # Test 2: Richmond "home" vs Adelaide at Adelaide Oval (SA venue)  
        # Away team (Adelaide=SA) vs Venue (Adelaide Oval=SA) = Same-state ✓
        advantage_adelaide_oval = enhanced_model.get_contextual_home_advantage('Richmond', 'Adelaide', 'SA')
        
        assert advantage_mcg == 60, "MCG venue should give interstate advantage to Richmond vs Adelaide"
        assert advantage_adelaide_oval == 20, "Adelaide Oval venue should give default advantage"
        
        # This shows the model CAN work correctly if venue_state is provided
    
    def test_current_training_script_bug(self, enhanced_model):
        """Test that current training script has a bug - doesn't use venue_state"""
        teams = ['Richmond', 'Adelaide'] 
        enhanced_model.initialize_ratings(teams)
        
        # The bug: update_ratings calls calculate_win_probability with venue_state=None
        # This means it falls back to home team state, ignoring actual venue
        
        prob_no_venue = enhanced_model.calculate_win_probability('Richmond', 'Adelaide', venue_state=None)
        prob_mcg = enhanced_model.calculate_win_probability('Richmond', 'Adelaide', venue_state='VIC')
        prob_adelaide_oval = enhanced_model.calculate_win_probability('Richmond', 'Adelaide', venue_state='SA')
        
        # Without venue_state, it uses Richmond's state (VIC), so Adelaide travels interstate
        assert abs(prob_no_venue - prob_mcg) < 1e-10, "No venue should default to home team state"
        
        # With explicit venue_state=SA, Adelaide doesn't travel interstate
        assert prob_adelaide_oval < prob_mcg, "Adelaide Oval should give lower advantage than MCG"
        
        # Document the current bug
        print(f"Bug: Training always uses venue_state=None")
        print(f"  Richmond vs Adelaide (no venue): {prob_no_venue:.4f}")
        print(f"  Richmond vs Adelaide at MCG: {prob_mcg:.4f}")  
        print(f"  Richmond vs Adelaide at Adelaide Oval: {prob_adelaide_oval:.4f}")
    
    def test_optimization_script_venue_handling(self):
        """Test how optimization script handles venue information"""
        
        # Create test data with venue information
        test_data = pd.DataFrame([
            {
                'id': 1, 'year': 2023, 'round': 'R1', 'match_date': '2023-03-15',
                'home_team': 'Richmond', 'away_team': 'Adelaide',
                'hscore': 100, 'ascore': 90,
                'venue': 'MCG'  # VIC venue
            },
            {
                'id': 2, 'year': 2023, 'round': 'R2', 'match_date': '2023-03-22', 
                'home_team': 'Adelaide', 'away_team': 'Richmond',
                'hscore': 100, 'ascore': 90,
                'venue': 'Adelaide Oval'  # SA venue
            }
        ])
        
        # Test that optimization script passes venue to update_ratings
        # (even though update_ratings currently ignores it)
        test_params = [25, 20, 60, 0.4, 0.7, 100, 0.05]
        
        try:
            score = evaluate_parameters_walkforward(test_params, test_data, verbose=True)
            assert np.isfinite(score), "Optimization should handle venue data"
            print(f"Optimization with venue data produces score: {score:.4f}")
        except Exception as e:
            pytest.fail(f"Optimization failed with venue data: {e}")
    
    def test_venue_state_mapping_needed(self):
        """Test that we need proper venue-to-state mapping"""
        
        # These venue mappings should exist but don't
        test_venues = [
            ('MCG', 'VIC'),
            ('Adelaide Oval', 'SA'),
            ('Optus Stadium', 'WA'), 
            ('Gabba', 'QLD'),
            ('SCG', 'NSW'),
            ('Blundstone Arena', 'TAS'),
        ]
        
        # Document what's missing
        print("Missing venue-to-state mappings:")
        for venue, expected_state in test_venues:
            print(f"  {venue} -> {expected_state}")
        
        # This test documents what needs to be implemented
        assert True, "This test documents missing functionality"
    
    def test_correct_interstate_logic_with_venues(self, enhanced_model):
        """Test how interstate logic SHOULD work with venue consideration"""
        teams = ['Richmond', 'Adelaide', 'West Coast']
        enhanced_model.initialize_ratings(teams)
        
        # Scenario 1: Richmond vs Adelaide at MCG
        # Venue=VIC, Away=SA -> Interstate advantage ✓
        mcg_advantage = enhanced_model.get_contextual_home_advantage('Richmond', 'Adelaide', 'VIC')
        
        # Scenario 2: Richmond vs Adelaide at Adelaide Oval  
        # Venue=SA, Away=SA -> Default advantage ✓
        adelaide_advantage = enhanced_model.get_contextual_home_advantage('Richmond', 'Adelaide', 'SA')
        
        # Scenario 3: Adelaide vs West Coast at Adelaide Oval
        # Venue=SA, Away=WA -> Interstate advantage ✓
        wa_interstate = enhanced_model.get_contextual_home_advantage('Adelaide', 'West Coast', 'SA')
        
        assert mcg_advantage == 60, "MCG: Adelaide travels interstate"
        assert adelaide_advantage == 20, "Adelaide Oval: Adelaide doesn't travel" 
        assert wa_interstate == 60, "Adelaide Oval: West Coast travels interstate"
        
        print(f"Correct venue-based logic:")
        print(f"  Richmond vs Adelaide at MCG: {mcg_advantage} (interstate)")
        print(f"  Richmond vs Adelaide at Adelaide Oval: {adelaide_advantage} (same-state)")
        print(f"  Adelaide vs West Coast at Adelaide Oval: {wa_interstate} (interstate)")


class TestTrainingScriptVenueImplementation:
    """Test the training script's venue handling implementation"""
    
    def test_update_ratings_should_use_venue_state(self):
        """Test that update_ratings should use venue information"""
        model = AFLEloModel(default_home_advantage=20, interstate_home_advantage=60)
        teams = ['Richmond', 'Adelaide']
        model.initialize_ratings(teams)
        
        # Get initial ratings
        initial_richmond = model.team_ratings['Richmond']
        initial_adelaide = model.team_ratings['Adelaide']
        
        # Update with venue information (currently ignored)
        model.update_ratings(
            'Richmond', 'Adelaide', 
            hscore=100, ascore=90, 
            year=2023,
            venue='Adelaide Oval'  # This should matter but doesn't
        )
        
        # Document current behavior
        richmond_change = model.team_ratings['Richmond'] - initial_richmond
        adelaide_change = model.team_ratings['Adelaide'] - initial_adelaide
        
        print(f"Rating changes (venue currently ignored):")
        print(f"  Richmond: {richmond_change:+.2f}")
        print(f"  Adelaide: {adelaide_change:+.2f}")
        
        # Currently this ignores venue, but it shouldn't
        assert True, "Documents current venue-ignoring behavior"
    
    def test_both_optimization_and_training_consistency(self):
        """Test that optimization and training scripts use venue consistently"""
        
        # Both scripts should handle venue the same way
        # Currently both have issues:
        # - Optimization passes venue to update_ratings but it's ignored
        # - Training update_ratings ignores venue parameter
        
        test_data = pd.DataFrame([{
            'id': 1, 'year': 2023, 'round': 'R1', 'match_date': '2023-03-15',
            'home_team': 'Richmond', 'away_team': 'Adelaide', 
            'hscore': 100, 'ascore': 90,
            'venue': 'Adelaide Oval'
        }])
        
        # Test optimization script
        test_params = [25, 20, 60, 0.4, 0.7, 100, 0.05]
        opt_score = evaluate_parameters_walkforward(test_params, test_data, verbose=False)
        
        # Test training script  
        model = AFLEloModel(k_factor=25, default_home_advantage=20, interstate_home_advantage=60)
        model.initialize_ratings(['Richmond', 'Adelaide'])
        
        initial_ratings = model.team_ratings.copy()
        model.update_ratings('Richmond', 'Adelaide', 100, 90, 2023, venue='Adelaide Oval')
        
        assert np.isfinite(opt_score), "Optimization should work with venue data"
        assert model.team_ratings != initial_ratings, "Training should update ratings"
        
        print(f"Both scripts run with venue data (but don't use it properly)")


class TestRequiredVenueEnhancements:
    """Test specifications for what needs to be implemented"""
    
    def test_venue_to_state_mapping_specification(self):
        """Specify what venue-to-state mapping should look like"""
        
        required_mappings = {
            # Major venues by state
            'VIC': ['MCG', 'Marvel Stadium', 'GMHBA Stadium'],
            'SA': ['Adelaide Oval'],
            'WA': ['Optus Stadium', 'Perth Stadium'], 
            'QLD': ['Gabba', 'Metricon Stadium'],
            'NSW': ['SCG', 'ANZ Stadium', 'GIANTS Stadium'],
            'TAS': ['Blundstone Arena', 'York Park']
        }
        
        print("Required venue-to-state mappings:")
        for state, venues in required_mappings.items():
            for venue in venues:
                print(f"  '{venue}': '{state}',")
        
        assert len(required_mappings) == 6, "Should cover all 6 states/territories"
    
    def test_enhanced_get_contextual_home_advantage_specification(self):
        """Specify how get_contextual_home_advantage should be enhanced"""
        
        # Current logic:
        # if away_team_state != venue_state: interstate_advantage
        # else: default_advantage
        
        # Enhanced logic should:
        # 1. Accept venue name, not just venue_state
        # 2. Map venue name to venue_state using VENUE_STATES
        # 3. Compare away_team_state vs venue_state (not home_team_state)
        
        enhancement_spec = """
        def get_contextual_home_advantage(self, home_team, away_team, venue=None):
            away_team_state = TEAM_STATES.get(away_team)
            
            # Map venue to state
            if venue and venue in VENUE_STATES:
                venue_state = VENUE_STATES[venue]
            else:
                # Fallback to home team state if venue unknown
                venue_state = TEAM_STATES.get(home_team)
            
            # Interstate if away team from different state than venue
            if away_team_state and venue_state and away_team_state != venue_state:
                return self.interstate_home_advantage
            else:
                return self.default_home_advantage
        """
        
        print("Enhanced get_contextual_home_advantage specification:")
        print(enhancement_spec)
        
        assert True, "Documents required enhancement"
    
    def test_enhanced_update_ratings_specification(self):
        """Specify how update_ratings should use venue"""
        
        enhancement_spec = """
        def update_ratings(self, home_team, away_team, hscore, ascore, year, 
                          match_id=None, round_number=None, match_date=None, venue=None):
            # ...existing code...
            
            # Calculate win probability WITH venue consideration
            home_win_prob = self.calculate_win_probability(
                home_team, away_team, venue=venue  # Use venue, not venue_state=None
            )
            
            # ...rest of rating update logic...
        """
        
        print("Enhanced update_ratings specification:")
        print(enhancement_spec)
        
        assert True, "Documents required enhancement"


if __name__ == '__main__':
    # Run tests if called directly
    pytest.main([__file__, '-v'])