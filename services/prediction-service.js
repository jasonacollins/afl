// services/prediction-service.js
const { getQuery, getOne, runQuery } = require('../models/db');
const { AppError, createNotFoundError, createValidationError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const roundService = require('./round-service');
const databaseHealthService = require('./database-health-service');

const MISSED_PREDICTION_DEFAULTS_ENABLED_AT_KEY = 'missed_prediction_defaults_enabled_at';

// Get predictions for a specific user
async function getPredictionsForUser(userId) {
  try {
    logger.debug(`Fetching predictions for user ID: ${userId}`);
    
    const predictions = await getQuery(
      'SELECT * FROM predictions WHERE predictor_id = ?',
      [userId]
    );
    
    logger.info(`Retrieved ${predictions.length} predictions for user ID: ${userId}`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching predictions for user', { 
      userId,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

function normalizeTippedTeam(probability, tippedTeam) {
  if (probability === 50) {
    return tippedTeam === 'away' ? 'away' : 'home';
  }

  return probability < 50 ? 'away' : 'home';
}

function normalizeMissedFlag(value) {
  if (value === true || value === 1 || value === '1' || value === 'true') {
    return 1;
  }

  if (value === false || value === 0 || value === '0' || value === 'false') {
    return 0;
  }

  throw createValidationError('Missed flag must be true or false');
}

async function getMissedPredictionDefaultsCutoff() {
  const row = await getOne(
    'SELECT value FROM app_config WHERE key = ?',
    [MISSED_PREDICTION_DEFAULTS_ENABLED_AT_KEY]
  );

  if (!row || !row.value) {
    return null;
  }

  const cutoffDate = new Date(row.value);
  if (Number.isNaN(cutoffDate.getTime())) {
    logger.warn('Invalid missed prediction defaults cutoff in app_config', {
      key: MISSED_PREDICTION_DEFAULTS_ENABLED_AT_KEY,
      value: row.value
    });
    return null;
  }

  return cutoffDate;
}

function normalizePredictorIds(predictorIds) {
  if (!Array.isArray(predictorIds)) {
    throw createValidationError('Predictor IDs must be an array');
  }

  return [...new Set(
    predictorIds
      .map((predictorId) => Number.parseInt(predictorId, 10))
      .filter((predictorId) => Number.isInteger(predictorId) && predictorId > 0)
  )];
}

// Get all predictions with match and predictor information
async function getAllPredictionsWithDetails() {
  try {
    logger.debug('Fetching all predictions with details');
    
    const predictions = await getQuery(`
      SELECT 
        p.*,
        pr.name as predictor_name,
        m.match_number,
        m.round_number,
        m.match_date,
        t1.name as home_team,
        t2.name as away_team,
        m.hscore,
        m.ascore
      FROM predictions p
      JOIN predictors pr ON p.predictor_id = pr.predictor_id
      JOIN matches m ON p.match_id = m.match_id
      JOIN teams t1 ON m.home_team_id = t1.team_id
      JOIN teams t2 ON m.away_team_id = t2.team_id
      ORDER BY pr.name, m.match_date
    `);
    
    logger.info(`Retrieved ${predictions.length} predictions with details`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching all predictions with details', { error: error.message });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

// Save or update prediction
async function savePrediction(matchId, predictorId, probability, options = {}) {
  let transactionStarted = false;

  try {
    // Validate inputs
    if (!matchId || !predictorId || probability === undefined) {
      throw createValidationError('Match ID, predictor ID, and probability are required');
    }
    
    if (probability !== null && (probability < 0 || probability > 100)) {
      throw createValidationError('Probability must be between 0 and 100');
    }
    
    const normalizedTippedTeam = normalizeTippedTeam(probability, options.tippedTeam);

    logger.debug(`Saving prediction for match ${matchId}, predictor ${predictorId}: ${probability}%`);
    await databaseHealthService.assertDatabaseHealthy({ context: 'saving prediction' });
    await runQuery('BEGIN IMMEDIATE TRANSACTION');
    transactionStarted = true;
    
    const existing = await getOne(
      'SELECT * FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, predictorId]
    );
    
    if (existing) {
      const result = await runQuery(
        'UPDATE predictions SET home_win_probability = ?, tipped_team = ? WHERE match_id = ? AND predictor_id = ?',
        [probability, normalizedTippedTeam, matchId, predictorId]
      );

      if (result.changes > 1) {
        throw new AppError(
          `Prediction uniqueness check failed while saving match ${matchId} for predictor ${predictorId}`,
          500,
          'DATABASE_HEALTH_ERROR'
        );
      }

      await runQuery('COMMIT');
      transactionStarted = false;
      
      logger.info(`Updated prediction for match ${matchId}, predictor ${predictorId}: ${probability}%`);
      
      return { action: 'updated', changes: result.changes };
    } else {
      const result = await runQuery(
        'INSERT INTO predictions (match_id, predictor_id, home_win_probability, tipped_team) VALUES (?, ?, ?, ?)',
        [matchId, predictorId, probability, normalizedTippedTeam]
      );

      await runQuery('COMMIT');
      transactionStarted = false;
      
      logger.info(`Created new prediction for match ${matchId}, predictor ${predictorId}: ${probability}%`);
      
      return { action: 'created', changes: result.changes };
    }
  } catch (error) {
    if (transactionStarted) {
      try {
        await runQuery('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error rolling back prediction save', {
          matchId,
          predictorId,
          error: rollbackError.message
        });
      }
    }

    if (error.isOperational) {
      throw error; // Re-throw validation errors
    }
    
    logger.error('Error saving prediction', { 
      matchId,
      predictorId,
      probability,
      error: error.message 
    });
    throw new AppError('Failed to save prediction', 500, 'DATABASE_ERROR');
  }
}

// Delete prediction
async function deletePrediction(matchId, predictorId) {
  try {
    if (!matchId || !predictorId) {
      throw createValidationError('Match ID and predictor ID are required');
    }
    
    logger.debug(`Deleting prediction for match ${matchId}, predictor ${predictorId}`);
    
    const result = await runQuery(
      'DELETE FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, predictorId]
    );
    
    if (result.changes === 0) {
      logger.warn(`No prediction found for match ${matchId}, predictor ${predictorId}`);
      throw createNotFoundError('Prediction');
    }
    
    logger.info(`Deleted prediction for match ${matchId}, predictor ${predictorId}`);
    
    return { changes: result.changes };
  } catch (error) {
    if (error.isOperational) {
      throw error; // Re-throw validation/not found errors
    }
    
    logger.error('Error deleting prediction', { 
      matchId,
      predictorId,
      error: error.message 
    });
    throw new AppError('Failed to delete prediction', 500, 'DATABASE_ERROR');
  }
}

async function ensureMissedPredictionsForUserAndYear(predictorId, year) {
  try {
    if (!predictorId || !year) {
      throw createValidationError('Predictor ID and year are required');
    }

    const predictor = await getOne(
      'SELECT year_joined FROM predictors WHERE predictor_id = ?',
      [predictorId]
    );

    if (!predictor) {
      throw createNotFoundError('Predictor');
    }

    if (predictor.year_joined && Number.parseInt(predictor.year_joined, 10) > Number.parseInt(year, 10)) {
      logger.debug('Skipping missed prediction reconciliation before predictor joined', {
        predictorId,
        year,
        yearJoined: predictor.year_joined
      });
      return { created: 0 };
    }

    const cutoffDate = await getMissedPredictionDefaultsCutoff();
    if (!cutoffDate) {
      logger.warn('Skipping missed prediction reconciliation because cutoff is unavailable', {
        predictorId,
        year
      });
      return { created: 0 };
    }

    const now = new Date();
    await databaseHealthService.assertDatabaseHealthy({ context: 'missed prediction reconciliation' });
    const candidateMatches = await getQuery(
      `
      SELECT m.match_id, m.match_date
      FROM matches m
      LEFT JOIN predictions p
        ON p.match_id = m.match_id
       AND p.predictor_id = ?
      WHERE m.year = ?
        AND p.prediction_id IS NULL
      ORDER BY m.match_date ASC
      `,
      [predictorId, year]
    );

    let created = 0;

    for (const match of candidateMatches) {
      if (!match.match_date) {
        continue;
      }

      const matchDate = new Date(match.match_date);
      if (Number.isNaN(matchDate.getTime())) {
        logger.warn('Skipping missed prediction reconciliation for invalid match date', {
          predictorId,
          year,
          matchId: match.match_id,
          matchDate: match.match_date
        });
        continue;
      }

      if (matchDate < cutoffDate || matchDate >= now) {
        continue;
      }

      const result = await runQuery(
        `INSERT OR IGNORE INTO predictions (
          match_id,
          predictor_id,
          home_win_probability,
          tipped_team,
          is_missed
        ) VALUES (?, ?, 50, 'home', 1)`,
        [match.match_id, predictorId]
      );

      created += result.changes || 0;
    }

    logger.info('Completed missed prediction reconciliation', {
      predictorId,
      year,
      created
    });

    return { created };
  } catch (error) {
    if (error.isOperational) {
      throw error;
    }

    logger.error('Error reconciling missed predictions', {
      predictorId,
      year,
      error: error.message
    });
    throw new AppError('Failed to reconcile missed predictions', 500, 'DATABASE_ERROR');
  }
}

async function ensureMissedPredictionsForPredictorsAndYear(predictorIds, year) {
  try {
    const normalizedYear = Number.parseInt(year, 10);
    if (!Number.isInteger(normalizedYear)) {
      throw createValidationError('Year is required');
    }

    const normalizedPredictorIds = normalizePredictorIds(predictorIds);
    if (normalizedPredictorIds.length === 0) {
      return { created: 0 };
    }

    const cutoffDate = await getMissedPredictionDefaultsCutoff();
    if (!cutoffDate) {
      logger.warn('Skipping bulk missed prediction reconciliation because cutoff is unavailable', {
        year: normalizedYear,
        predictorCount: normalizedPredictorIds.length
      });
      return { created: 0 };
    }

    const placeholders = normalizedPredictorIds.map(() => '?').join(', ');
    const nowIso = new Date().toISOString();
    const cutoffIso = cutoffDate.toISOString();
    await databaseHealthService.assertDatabaseHealthy({ context: 'bulk missed prediction reconciliation' });
    const result = await runQuery(
      `
      INSERT OR IGNORE INTO predictions (
        match_id,
        predictor_id,
        home_win_probability,
        tipped_team,
        is_missed
      )
      SELECT
        m.match_id,
        pr.predictor_id,
        50,
        'home',
        1
      FROM predictors pr
      JOIN matches m
        ON m.year = ?
      LEFT JOIN predictions p
        ON p.match_id = m.match_id
       AND p.predictor_id = pr.predictor_id
      WHERE pr.predictor_id IN (${placeholders})
        AND (pr.year_joined IS NULL OR CAST(pr.year_joined AS INTEGER) <= ?)
        AND p.prediction_id IS NULL
        AND m.match_date IS NOT NULL
        AND datetime(m.match_date) IS NOT NULL
        AND datetime(m.match_date) >= datetime(?)
        AND datetime(m.match_date) < datetime(?)
      `,
      [
        normalizedYear,
        ...normalizedPredictorIds,
        normalizedYear,
        cutoffIso,
        nowIso
      ]
    );

    const created = result.changes || 0;
    logger.info('Completed bulk missed prediction reconciliation', {
      year: normalizedYear,
      predictorCount: normalizedPredictorIds.length,
      created
    });

    return { created };
  } catch (error) {
    if (error.isOperational) {
      throw error;
    }

    logger.error('Error reconciling missed predictions in bulk', {
      predictorIds,
      year,
      error: error.message
    });
    throw new AppError('Failed to reconcile missed predictions', 500, 'DATABASE_ERROR');
  }
}

async function updatePredictionMissedFlag(matchId, predictorId, isMissed) {
  let transactionStarted = false;

  try {
    if (!matchId || !predictorId) {
      throw createValidationError('Match ID and predictor ID are required');
    }

    const normalizedIsMissed = normalizeMissedFlag(isMissed);
    await databaseHealthService.assertDatabaseHealthy({ context: 'updating missed prediction flag' });
    await runQuery('BEGIN IMMEDIATE TRANSACTION');
    transactionStarted = true;

    const existingPrediction = await getOne(
      'SELECT home_win_probability, tipped_team FROM predictions WHERE match_id = ? AND predictor_id = ?',
      [matchId, predictorId]
    );

    if (!existingPrediction) {
      if (normalizedIsMissed === 0) {
        await runQuery('COMMIT');
        transactionStarted = false;

        return {
          changes: 0,
          isMissed: false,
          created: false,
          probability: null,
          tippedTeam: null
        };
      }

      const insertResult = await runQuery(
        `INSERT INTO predictions (
          match_id,
          predictor_id,
          home_win_probability,
          tipped_team,
          is_missed
        ) VALUES (?, ?, 50, 'home', 1)`,
        [matchId, predictorId]
      );

      await runQuery('COMMIT');
      transactionStarted = false;

      logger.info(`Created default missed prediction for match ${matchId}, predictor ${predictorId}`);
      return {
        changes: insertResult.changes,
        isMissed: true,
        created: true,
        probability: 50,
        tippedTeam: 'home'
      };
    }

    const result = await runQuery(
      'UPDATE predictions SET is_missed = ? WHERE match_id = ? AND predictor_id = ?',
      [normalizedIsMissed, matchId, predictorId]
    );

    if (result.changes > 1) {
      throw new AppError(
        `Prediction uniqueness check failed while updating missed flag for match ${matchId} and predictor ${predictorId}`,
        500,
        'DATABASE_HEALTH_ERROR'
      );
    }

    await runQuery('COMMIT');
    transactionStarted = false;

    logger.info(`Updated missed flag for match ${matchId}, predictor ${predictorId}: ${normalizedIsMissed}`);
    return {
      changes: result.changes,
      isMissed: Boolean(normalizedIsMissed),
      created: false,
      probability: existingPrediction.home_win_probability,
      tippedTeam: existingPrediction.tipped_team || normalizeTippedTeam(existingPrediction.home_win_probability)
    };
  } catch (error) {
    if (transactionStarted) {
      try {
        await runQuery('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Error rolling back missed prediction flag update', {
          matchId,
          predictorId,
          error: rollbackError.message
        });
      }
    }

    if (error.isOperational) {
      throw error;
    }

    logger.error('Error updating missed prediction flag', {
      matchId,
      predictorId,
      isMissed,
      error: error.message
    });
    throw new AppError('Failed to update missed prediction flag', 500, 'DATABASE_ERROR');
  }
}

async function getPredictionsWithResultsForYear(predictorId, year) {
  try {
    logger.debug(`Fetching predictions with results for predictor ${predictorId}, year ${year}`);
    
    const predictions = await getQuery(`
      SELECT p.*, m.hscore, m.ascore, m.round_number
      FROM predictions p
      JOIN matches m ON p.match_id = m.match_id
      WHERE p.predictor_id = ?
      AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
      AND m.year = ?
    `, [predictorId, year]);
    
    logger.info(`Retrieved ${predictions.length} predictions with results for predictor ${predictorId}, year ${year}`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching predictions with results for year', { 
      predictorId,
      year,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

// Get predictions with results for a specific round and year
async function getPredictionsWithResultsForRound(predictorId, year, round) {
  try {
    logger.debug(`Fetching predictions with results for predictor ${predictorId}, year ${year}, round ${round}`);
    
    const predictions = await getQuery(`
      SELECT p.*, m.hscore, m.ascore, m.round_number
      FROM predictions p
      JOIN matches m ON p.match_id = m.match_id
      WHERE p.predictor_id = ?
      AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
      AND m.year = ? AND m.round_number = ?
    `, [predictorId, year, round]);
    
    logger.info(`Retrieved ${predictions.length} predictions with results for predictor ${predictorId}, year ${year}, round ${round}`);
    
    return predictions;
  } catch (error) {
    logger.error('Error fetching predictions with results for round', { 
      predictorId,
      year,
      round,
      error: error.message 
    });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

// Get predictions with results for a display round selection and year.
// Supports grouped selections like "Finals Week 1".
async function getPredictionsWithResultsForRoundSelection(predictorId, year, roundSelection) {
  try {
    const sourceRounds = roundService.expandRoundSelection(roundSelection);

    if (!sourceRounds || sourceRounds.length === 0) {
      logger.warn('No source rounds resolved for prediction round selection', {
        predictorId,
        year,
        roundSelection
      });
      return [];
    }

    logger.debug('Fetching predictions with results for round selection', {
      predictorId,
      year,
      roundSelection,
      sourceRounds
    });

    const placeholders = sourceRounds.map(() => '?').join(', ');
    const predictions = await getQuery(
      `
      SELECT p.*, m.hscore, m.ascore, m.round_number
      FROM predictions p
      JOIN matches m ON p.match_id = m.match_id
      WHERE p.predictor_id = ?
      AND m.hscore IS NOT NULL AND m.ascore IS NOT NULL
      AND m.year = ?
      AND m.round_number IN (${placeholders})
      `,
      [predictorId, year, ...sourceRounds]
    );

    logger.info(`Retrieved ${predictions.length} predictions with results for predictor ${predictorId}, year ${year}, round selection ${roundSelection}`);

    return predictions;
  } catch (error) {
    logger.error('Error fetching predictions with results for round selection', {
      predictorId,
      year,
      roundSelection,
      error: error.message
    });
    throw new AppError('Failed to fetch predictions', 500, 'DATABASE_ERROR');
  }
}

module.exports = {
  getPredictionsForUser,
  getAllPredictionsWithDetails,
  savePrediction,
  deletePrediction,
  ensureMissedPredictionsForUserAndYear,
  ensureMissedPredictionsForPredictorsAndYear,
  updatePredictionMissedFlag,
  getPredictionsWithResultsForYear,
  getPredictionsWithResultsForRound,
  getPredictionsWithResultsForRoundSelection
};
