#!/usr/bin/env python3
"""
Unit tests for the percentile interpolation helper used in the season simulator.
These tests ensure we retain fractional win intervals instead of snapping to
whole numbers when summarising Monte Carlo outcomes.
"""

import os
import sys

import numpy as np

# Add parent directory so we can import season_simulator module
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(CURRENT_DIR, '..'))

from season_simulator import interpolate_percentile  # noqa: E402


def test_interpolation_returns_fractional_bounds_for_discrete_data():
    """10th/90th percentiles should interpolate between integer win totals."""
    wins = np.array([10] * 600 + [11] * 200 + [12] * 200)

    lower = interpolate_percentile(wins, 10)
    upper = interpolate_percentile(wins, 90)

    assert 10 <= lower < 11
    assert 11 <= upper < 12
    assert lower < upper


def test_interpolation_handles_single_value_distribution():
    """If every simulation yields the same total, the percentile should match it."""
    wins = np.array([14] * 1000)

    assert interpolate_percentile(wins, 10) == 14
    assert interpolate_percentile(wins, 90) == 14
