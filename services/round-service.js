// services/round-service.js
const { getQuery } = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

const FINALS_WEEK_2_LABEL = 'Finals Week 2';
const LEGACY_FINALS_WEEK_1_LABEL = 'Finals Week 1';
const FINALS_WEEK_2_ROUNDS = ['Elimination Final', 'Qualifying Final'];
const WILDCARD_FINALS_LABEL = 'Wildcard Finals';
const WILDCARD_FINALS_SOURCE_ROUNDS = [WILDCARD_FINALS_LABEL, 'Wildcard Round'];

// Define round order constants
const ROUND_ORDER = {
  'OR': 0,                    // Opening Round
  'Wildcard Finals': 100,
  'Wildcard Round': 100,      // Backward compatibility
  'Elimination Final': 101,
  'Qualifying Final': 102,
  'Semi Final': 103,
  'Preliminary Final': 104,
  'Grand Final': 105,
  'default_final': 999,       // Unknown finals
  'regular_min': 1,
  'regular_max': 99
};

// SQL fragment for round ordering
const ROUND_ORDER_SQL = `
  CASE 
    WHEN round_number = 'OR' THEN ${ROUND_ORDER['OR']}
    WHEN round_number LIKE '%' AND CAST(round_number AS INTEGER) BETWEEN ${ROUND_ORDER.regular_min} AND ${ROUND_ORDER.regular_max} THEN CAST(round_number AS INTEGER)
    WHEN round_number = 'Wildcard Finals' THEN ${ROUND_ORDER['Wildcard Finals']}
    WHEN round_number = 'Wildcard Round' THEN ${ROUND_ORDER['Wildcard Round']}
    WHEN round_number = 'Elimination Final' THEN ${ROUND_ORDER['Elimination Final']}
    WHEN round_number = 'Qualifying Final' THEN ${ROUND_ORDER['Qualifying Final']}
    WHEN round_number = 'Semi Final' THEN ${ROUND_ORDER['Semi Final']}
    WHEN round_number = 'Preliminary Final' THEN ${ROUND_ORDER['Preliminary Final']}
    WHEN round_number = 'Grand Final' THEN ${ROUND_ORDER['Grand Final']}
    ELSE ${ROUND_ORDER.default_final}
  END
`;

// Get all rounds for a specific year
async function getRoundsForYear(year) {
  try {
    logger.debug(`Fetching rounds for year: ${year}`);
    
    const rounds = await getQuery(
      `SELECT DISTINCT round_number 
       FROM matches 
       WHERE year = ?
       ORDER BY ${ROUND_ORDER_SQL}`,
      [year]
    );

    const finalRounds = new Set([
      'Elimination Final',
      'Qualifying Final',
      'Semi Final',
      'Preliminary Final',
      'Grand Final'
    ]);
    const hasAnyFinalRound = rounds.some((row) => finalRounds.has(row.round_number));
    const hasWildcardFinals = rounds.some((row) => WILDCARD_FINALS_SOURCE_ROUNDS.includes(row.round_number));

    let normalizedRounds = rounds;
    if (Number(year) >= 2026 && hasAnyFinalRound && !hasWildcardFinals) {
      const firstFinalIndex = rounds.findIndex((row) => finalRounds.has(row.round_number));
      const wildcardEntry = { round_number: WILDCARD_FINALS_LABEL };
      normalizedRounds = firstFinalIndex >= 0
        ? [
            ...rounds.slice(0, firstFinalIndex),
            wildcardEntry,
            ...rounds.slice(firstFinalIndex)
          ]
        : [...rounds, wildcardEntry];
    }
    
    logger.info(`Retrieved ${normalizedRounds.length} rounds for year ${year}`);
    
    return normalizedRounds;
  } catch (error) {
    logger.error('Error fetching rounds for year', { 
      year,
      error: error.message 
    });
    throw new AppError('Failed to fetch rounds', 500, 'DATABASE_ERROR');
  }
}

// Get available years that have match data
async function getAvailableYears(options = {}) {
  try {
    const { minYear = null } = options;
    const query = minYear !== null
      ? 'SELECT DISTINCT year FROM matches WHERE year >= ? ORDER BY year DESC'
      : 'SELECT DISTINCT year FROM matches ORDER BY year DESC';
    const params = minYear !== null ? [minYear] : [];

    return await getQuery(query, params);
  } catch (error) {
    logger.error('Error fetching available years', {
      minYear: options.minYear,
      error: error.message
    });
    throw new AppError('Failed to fetch available years', 500, 'DATABASE_ERROR');
  }
}

function parseYear(rawValue) {
  const parsed = parseInt(rawValue, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

// Resolve a requested year against available match data.
// Falls back to latest available year, then current calendar year when DB is empty.
async function resolveYear(requestedYear, options = {}) {
  const { minYear = null } = options;
  const years = await getAvailableYears({ minYear });
  const availableYears = years
    .map(row => parseInt(row.year, 10))
    .filter(year => !Number.isNaN(year));

  const parsedRequestedYear = parseYear(requestedYear);
  const currentCalendarYear = new Date().getFullYear();

  let selectedYear = parsedRequestedYear;
  let usedFallback = false;

  if (parsedRequestedYear === null || !availableYears.includes(parsedRequestedYear)) {
    selectedYear = availableYears.length > 0 ? availableYears[0] : currentCalendarYear;
    usedFallback = parsedRequestedYear !== null;
  }

  return {
    selectedYear,
    years,
    usedFallback
  };
}

// Get round display name
function getRoundDisplayName(roundNumber) {
  if (roundNumber === 'OR') {
    return 'Opening Round';
  } else if (WILDCARD_FINALS_SOURCE_ROUNDS.includes(roundNumber)) {
    return WILDCARD_FINALS_LABEL;
  } else if (roundNumber === FINALS_WEEK_2_LABEL || roundNumber === LEGACY_FINALS_WEEK_1_LABEL) {
    return FINALS_WEEK_2_LABEL;
  } else if (ROUND_ORDER[roundNumber]) {
    return roundNumber;
  } else {
    return `Round ${roundNumber}`;
  }
}

function isFinalsWeek1Round(roundNumber) {
  return FINALS_WEEK_2_ROUNDS.includes(roundNumber);
}

function normalizeRoundForDisplay(roundNumber) {
  if (!roundNumber) {
    return roundNumber;
  }

  if (WILDCARD_FINALS_SOURCE_ROUNDS.includes(roundNumber)) {
    return WILDCARD_FINALS_LABEL;
  }

  if (
    roundNumber === FINALS_WEEK_2_LABEL ||
    roundNumber === LEGACY_FINALS_WEEK_1_LABEL ||
    isFinalsWeek1Round(roundNumber)
  ) {
    return FINALS_WEEK_2_LABEL;
  }

  return roundNumber;
}

function expandRoundSelection(roundSelection, availableRounds = null) {
  if (
    roundSelection === FINALS_WEEK_2_LABEL ||
    roundSelection === LEGACY_FINALS_WEEK_1_LABEL ||
    isFinalsWeek1Round(roundSelection)
  ) {
    if (Array.isArray(availableRounds) && availableRounds.length > 0) {
      const availableRoundSet = new Set(availableRounds);
      const presentRounds = FINALS_WEEK_2_ROUNDS.filter(round => availableRoundSet.has(round));

      if (presentRounds.length > 0) {
        return presentRounds;
      }
    }

    return [...FINALS_WEEK_2_ROUNDS];
  }

  if (WILDCARD_FINALS_SOURCE_ROUNDS.includes(roundSelection)) {
    if (Array.isArray(availableRounds) && availableRounds.length > 0) {
      const availableRoundSet = new Set(availableRounds);
      const presentWildcardRounds = WILDCARD_FINALS_SOURCE_ROUNDS.filter(
        round => availableRoundSet.has(round)
      );

      if (presentWildcardRounds.length > 0) {
        return presentWildcardRounds;
      }
    }

    return [...WILDCARD_FINALS_SOURCE_ROUNDS];
  }

  return [roundSelection];
}

function combineRoundsForDisplay(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) {
    return [];
  }

  const finalsWeek1Rows = rounds.filter(roundObj => isFinalsWeek1Round(roundObj.round_number));
  const finalsWeek1RoundNumbers = finalsWeek1Rows.map(roundObj => roundObj.round_number);
  let finalsWeek1Added = false;
  const emittedDisplayRounds = new Set();

  return rounds.reduce((accumulator, roundObj) => {
    if (WILDCARD_FINALS_SOURCE_ROUNDS.includes(roundObj.round_number)) {
      if (emittedDisplayRounds.has(WILDCARD_FINALS_LABEL)) {
        return accumulator;
      }

      emittedDisplayRounds.add(WILDCARD_FINALS_LABEL);
      accumulator.push({
        ...roundObj,
        round_number: WILDCARD_FINALS_LABEL,
        source_round_numbers: expandRoundSelection(WILDCARD_FINALS_LABEL),
        isSynthetic: roundObj.isSynthetic || roundObj.synthetic || false
      });
      return accumulator;
    }

    if (!isFinalsWeek1Round(roundObj.round_number)) {
      const displayRound = normalizeRoundForDisplay(roundObj.round_number);
      if (emittedDisplayRounds.has(displayRound)) {
        return accumulator;
      }

      emittedDisplayRounds.add(displayRound);
      accumulator.push({
        ...roundObj,
        round_number: displayRound,
        source_round_numbers: [roundObj.round_number]
      });
      return accumulator;
    }

    if (finalsWeek1Added) {
      return accumulator;
    }

    finalsWeek1Added = true;

    const combinedRound = {
      ...roundObj,
      round_number: FINALS_WEEK_2_LABEL,
      source_round_numbers: finalsWeek1RoundNumbers.length > 0
        ? finalsWeek1RoundNumbers
        : [...FINALS_WEEK_2_ROUNDS]
    };

    if (finalsWeek1Rows.length > 0 && typeof finalsWeek1Rows[0].isCompleted !== 'undefined') {
      combinedRound.isCompleted = finalsWeek1Rows.every(row => row.isCompleted);
    }

    accumulator.push(combinedRound);
    return accumulator;
  }, []);
}

module.exports = {
  FINALS_WEEK_1_LABEL: FINALS_WEEK_2_LABEL, // Backward compatibility export
  FINALS_WEEK_1_ROUNDS: FINALS_WEEK_2_ROUNDS, // Backward compatibility export
  FINALS_WEEK_2_LABEL,
  FINALS_WEEK_2_ROUNDS,
  WILDCARD_FINALS_LABEL,
  WILDCARD_ROUND_LABEL: WILDCARD_FINALS_LABEL, // Backward compatibility export
  WILDCARD_FINALS_SOURCE_ROUNDS,
  ROUND_ORDER,
  ROUND_ORDER_SQL,
  getRoundsForYear,
  getRoundDisplayName,
  getAvailableYears,
  resolveYear,
  isFinalsWeek1Round,
  normalizeRoundForDisplay,
  expandRoundSelection,
  combineRoundsForDisplay
};
