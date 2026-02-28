// services/round-service.js
const { getQuery } = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

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
  } else if (ROUND_ORDER[roundNumber]) {
    return roundNumber;
  } else {
    return `Round ${roundNumber}`;
  }
}

module.exports = {
  ROUND_ORDER,
  ROUND_ORDER_SQL,
  getRoundsForYear,
  getRoundDisplayName,
  getAvailableYears,
  resolveYear
};
