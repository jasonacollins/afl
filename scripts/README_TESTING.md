# AFL ELO Optimization Testing

This directory contains pytest tests for validating the AFL ELO optimization system.

## Test Files

### `test_optimization.py`
Comprehensive tests for the optimization script functionality:
- **TestAFLEloModel**: Core ELO model functionality
- **TestOptimizationParameterSpace**: Parameter space validation  
- **TestObjectiveFunction**: Objective function behavior
- **TestOptimizationIntegration**: Integration and serialization

### `test_home_advantage.py`
Focused tests specifically for home advantage application:
- **TestHomeAdvantageApplication**: Validates correct advantage values are applied
- **TestHomeAdvantageParameterValidation**: Parameter consistency and validation

## Key Test Validations

### ✅ Home Advantage Application
- **Same-state matches**: Use `default_home_advantage` (e.g., VIC vs VIC)
- **Interstate matches**: Use `interstate_home_advantage` (e.g., VIC vs SA)
- **Mathematical correctness**: Probabilities match ELO formula exactly
- **Significant difference**: Interstate advantage > same-state advantage

### ✅ Optimization Configuration  
- **Parameter space**: 7 parameters with sensible ranges
- **Parameter types**: Integer vs Real parameters correctly defined
- **Boundary conditions**: Min/max parameter values produce valid results
- **Determinism**: Identical parameters always produce identical results

### ✅ Model Integration
- **Team state mapping**: All 18 AFL teams have correct state assignments
- **Interstate detection**: Correctly identifies same-state vs interstate games
- **JSON serialization**: Optimization results serialize correctly
- **Parameter extraction**: Results correctly converted to model parameters

## Running Tests

### All Tests
```bash
python3 -m pytest scripts/test_*.py -v
```

### Specific Test Files
```bash
# Home advantage tests only
python3 -m pytest scripts/test_home_advantage.py -v

# Optimization tests only  
python3 -m pytest scripts/test_optimization.py -v
```

### With Coverage
```bash
python3 -m pytest scripts/test_*.py --cov=scripts --cov-report=html
```

## Test Requirements

Install test dependencies:
```bash
pip install -r scripts/requirements-test.txt
```

Required packages:
- pytest >= 7.0.0
- numpy >= 1.21.0
- pandas >= 1.3.0
- scikit-optimize >= 0.9.0
- scikit-learn >= 1.0.0

## Test Results Summary

**33 tests total - All passing ✅**

Key validations confirmed:
- ✅ Correct home advantage applied (same-state: 52.88%, interstate: 58.55%)
- ✅ Parameter space covers valid AFL ELO ranges  
- ✅ Objective function is deterministic and mathematically sound
- ✅ All 18 AFL teams have correct state mappings
- ✅ Interstate detection logic works correctly
- ✅ Optimization results serialize properly to JSON

## Test Philosophy

These tests follow best practices:
- **Unit tests**: Test individual components in isolation
- **Integration tests**: Test component interactions
- **Property-based tests**: Validate mathematical relationships
- **Boundary tests**: Test edge cases and parameter limits
- **Regression tests**: Ensure existing functionality continues working

The tests validate that the optimization script correctly implements the dual home advantage system and produces mathematically sound results.