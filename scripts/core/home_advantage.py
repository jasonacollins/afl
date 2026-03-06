#!/usr/bin/env python3
"""
Shared home-advantage helpers for AFL ELO models.

Strict interstate rule:
- Apply interstate advantage only when:
  1) home team is playing in its own state, and
  2) away team state differs from venue state.
- Otherwise apply default home advantage.
"""

from typing import Dict, Optional


def normalize_state(state_value: Optional[str]) -> Optional[str]:
    """Normalize state values to uppercase text or None."""
    if state_value is None:
        return None

    normalized = str(state_value).strip().upper()
    return normalized if normalized else None


def resolve_team_state(
    team_name: Optional[str],
    explicit_team_state: Optional[str] = None,
    team_states: Optional[Dict[str, str]] = None
) -> Optional[str]:
    """Resolve a team's state from explicit value first, then team-state mapping."""
    explicit = normalize_state(explicit_team_state)
    if explicit:
        return explicit

    if team_states and team_name is not None:
        return normalize_state(team_states.get(team_name))

    return None


def select_contextual_home_advantage(
    default_home_advantage: float,
    interstate_home_advantage: float,
    *,
    venue_state: Optional[str],
    home_team_state: Optional[str],
    away_team_state: Optional[str]
) -> float:
    """
    Select home advantage using strict interstate eligibility.

    Interstate applies only when:
    - home_team_state == venue_state
    - away_team_state != venue_state
    """
    venue_state_value = normalize_state(venue_state)
    home_state_value = normalize_state(home_team_state)
    away_state_value = normalize_state(away_team_state)

    # Unknown/INTL state context always falls back to default advantage.
    if (
        venue_state_value is None
        or home_state_value is None
        or away_state_value is None
        or venue_state_value == 'INTL'
    ):
        return float(default_home_advantage)

    if home_state_value == venue_state_value and away_state_value != venue_state_value:
        return float(interstate_home_advantage)

    return float(default_home_advantage)


def resolve_contextual_home_advantage(
    default_home_advantage: float,
    interstate_home_advantage: float,
    *,
    home_team: Optional[str],
    away_team: Optional[str],
    venue_state: Optional[str],
    home_team_state: Optional[str] = None,
    away_team_state: Optional[str] = None,
    team_states: Optional[Dict[str, str]] = None
) -> float:
    """Resolve team states and return contextual home advantage."""
    resolved_home_state = resolve_team_state(
        team_name=home_team,
        explicit_team_state=home_team_state,
        team_states=team_states
    )
    resolved_away_state = resolve_team_state(
        team_name=away_team,
        explicit_team_state=away_team_state,
        team_states=team_states
    )

    return select_contextual_home_advantage(
        default_home_advantage=default_home_advantage,
        interstate_home_advantage=interstate_home_advantage,
        venue_state=venue_state,
        home_team_state=resolved_home_state,
        away_team_state=resolved_away_state
    )
