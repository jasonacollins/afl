// services/match-service.js
const { getQuery, getOne, runQuery } = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');

// Get matches with team information
async function getMatchesWithTeams(whereClause = '', params = []) {
  try {
    const query = `
      SELECT m.*, 
        t1.name as home_team, 
        t1.abbrev as home_team_abbrev,
        t2.name as away_team,
        t2.abbrev as away_team_abbrev 
      FROM matches m
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      ${whereClause}
    `;
    
    logger.debug('Fetching matches with teams', { whereClause, params });
    
    const matches = await getQuery(query, params);
    
    logger.debug(`Fetched ${matches.length} matches`);
    
    return matches;
  } catch (error) {
    logger.error('Error fetching matches with teams', { 
      error: error.message,
      whereClause,
      params
    });
    throw new AppError('Failed to fetch matches', 500, 'DATABASE_ERROR');
  }
}

// Get matches for specific round and year
async function getMatchesByRoundAndYear(round, year) {
  try {
    logger.debug(`Fetching matches for round ${round}, year ${year}`);
    
    const matches = await getMatchesWithTeams(
      'WHERE m.round_number = ? AND m.year = ? ORDER BY m.match_date',
      [round, year]
    );
    
    return matches;
  } catch (error) {
    logger.error('Error fetching matches by round and year', { 
      error: error.message,
      round,
      year
    });
    throw error; // Re-throw the error from getMatchesWithTeams
  }
}

// Get completed matches for year
async function getCompletedMatchesForYear(year) {
  try {
    logger.debug(`Fetching completed matches for year ${year}`);
    
    const matches = await getMatchesWithTeams(
      'WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL AND m.year = ? ORDER BY m.match_date DESC',
      [year]
    );
    
    logger.info(`Found ${matches.length} completed matches for year ${year}`);
    
    return matches;
  } catch (error) {
    logger.error('Error fetching completed matches for year', { 
      error: error.message,
      year
    });
    throw error; // Re-throw the error from getMatchesWithTeams
  }
}

// Process matches to add isLocked field
function processMatchLockStatus(matches) {
  logger.debug(`Processing lock status for ${matches.length} matches`);
  
  const processedMatches = matches.map(match => {
    let isLocked = false;
    
    if (match.match_date) {
      try {
        const matchDate = new Date(match.match_date);
        
        // Check if date is valid
        if (isNaN(matchDate.getTime())) {
          logger.warn('Invalid match date format', { 
            matchId: match.match_id,
            matchDate: match.match_date
          });
        } else {
          isLocked = new Date() > matchDate;
        }
      } catch (error) {
        logger.error('Error parsing match date', { 
          matchId: match.match_id,
          matchDate: match.match_date,
          error: error.message
        });
      }
    }
    
    return {
      ...match,
      isLocked
    };
  });
  
  const lockedCount = processedMatches.filter(m => m.isLocked).length;
  logger.debug(`Processed ${matches.length} matches: ${lockedCount} locked`);
  
  return processedMatches;
}

// Get completed matches for a specific round and year
async function getCompletedMatchesForRound(year, round) {
  try {
    logger.debug(`Fetching completed matches for year ${year}, round ${round}`);
    
    const matches = await getMatchesWithTeams(
      'WHERE m.hscore IS NOT NULL AND m.ascore IS NOT NULL AND m.year = ? AND m.round_number = ? ORDER BY m.match_date DESC',
      [year, round]
    );
    
    logger.info(`Found ${matches.length} completed matches for year ${year}, round ${round}`);
    
    return matches;
  } catch (error) {
    logger.error('Error fetching completed matches for round', { 
      error: error.message,
      year,
      round
    });
    throw error;
  }
}

// Get the most recent round with completed results
async function getMostRecentRoundWithResults() {
  try {
    logger.debug('Finding most recent round with completed results');
    
    const result = await getOne(
      `SELECT year, round_number, MAX(match_date) as latest_date
       FROM matches 
       WHERE hscore IS NOT NULL AND ascore IS NOT NULL
       ORDER BY year DESC, match_date DESC
       LIMIT 1`
    );
    
    if (result) {
      logger.info(`Most recent round with results: ${result.year}, round ${result.round_number}`);
      return {
        year: result.year,
        round: result.round_number
      };
    } else {
      logger.warn('No completed matches found');
      return null;
    }
  } catch (error) {
    logger.error('Error finding most recent round with results', { 
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  getMatchesWithTeams,
  getMatchesByRoundAndYear,
  getCompletedMatchesForYear,
  getCompletedMatchesForRound,
  getMostRecentRoundWithResults,
  processMatchLockStatus
};
