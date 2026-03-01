// services/round-service.js
const { getQuery } = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

const FINALS_WEEK_1_LABEL = 'Finals Week 1';
const FINALS_WEEK_1_ROUNDS = ['Elimination Final', 'Qualifying Final'];

// Define round order constants
const ROUND_ORDER = {
  'OR': 0,                    // Opening Round
  'Elimination Final': 100,
  'Qualifying Final': 101,
  'Semi Final': 102,
  'Preliminary Final': 103,
  'Grand Final': 104,
  'default_final': 999,       // Unknown finals
  'regular_min': 1,
  'regular_max': 99
};

// SQL fragment for round ordering
const ROUND_ORDER_SQL = `
  CASE 
    WHEN round_number = 'OR' THEN ${ROUND_ORDER['OR']}
    WHEN round_number LIKE '%' AND CAST(round_number AS INTEGER) BETWEEN ${ROUND_ORDER.regular_min} AND ${ROUND_ORDER.regular_max} THEN CAST(round_number AS INTEGER)
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
    
    logger.info(`Retrieved ${rounds.length} rounds for year ${year}`);
    
    return rounds;
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
  } else if (roundNumber === FINALS_WEEK_1_LABEL) {
    return FINALS_WEEK_1_LABEL;
  } else if (ROUND_ORDER[roundNumber]) {
    return roundNumber;
  } else {
    return `Round ${roundNumber}`;
  }
}

function isFinalsWeek1Round(roundNumber) {
  return FINALS_WEEK_1_ROUNDS.includes(roundNumber);
}

function normalizeRoundForDisplay(roundNumber) {
  if (!roundNumber) {
    return roundNumber;
  }

  if (roundNumber === FINALS_WEEK_1_LABEL || isFinalsWeek1Round(roundNumber)) {
    return FINALS_WEEK_1_LABEL;
  }

  return roundNumber;
}

function expandRoundSelection(roundSelection, availableRounds = null) {
  if (roundSelection === FINALS_WEEK_1_LABEL || isFinalsWeek1Round(roundSelection)) {
    if (Array.isArray(availableRounds) && availableRounds.length > 0) {
      const availableRoundSet = new Set(availableRounds);
      const presentRounds = FINALS_WEEK_1_ROUNDS.filter(round => availableRoundSet.has(round));

      if (presentRounds.length > 0) {
        return presentRounds;
      }
    }

    return [...FINALS_WEEK_1_ROUNDS];
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

  return rounds.reduce((accumulator, roundObj) => {
    if (!isFinalsWeek1Round(roundObj.round_number)) {
      accumulator.push({
        ...roundObj,
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
      round_number: FINALS_WEEK_1_LABEL,
      source_round_numbers: finalsWeek1RoundNumbers.length > 0
        ? finalsWeek1RoundNumbers
        : [...FINALS_WEEK_1_ROUNDS]
    };

    if (finalsWeek1Rows.length > 0 && typeof finalsWeek1Rows[0].isCompleted !== 'undefined') {
      combinedRound.isCompleted = finalsWeek1Rows.every(row => row.isCompleted);
    }

    accumulator.push(combinedRound);
    return accumulator;
  }, []);
}

module.exports = {
  FINALS_WEEK_1_LABEL,
  FINALS_WEEK_1_ROUNDS,
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
