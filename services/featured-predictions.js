// services/featured-predictions.js
const { getQuery, getOne, runQuery } = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const matchService = require('./match-service');
const roundService = require('./round-service');
const predictionService = require('./prediction-service');
const predictorService = require('./predictor-service');
const scoringService = require('../services/scoring-service');

// Get all homepage available predictor IDs
async function getHomepageAvailablePredictorIds() {
  try {
    logger.debug('Fetching homepage available predictor IDs');

    const predictors = await getQuery(
      'SELECT predictor_id FROM predictors WHERE homepage_available = 1 AND active = 1 ORDER BY display_name'
    );

    return predictors.map(p => p.predictor_id.toString());
  } catch (error) {
    logger.error('Error fetching homepage available predictors', { error: error.message });
    return [];
  }
}

// Get the default featured predictor ID
async function getDefaultFeaturedPredictorId() {
  try {
    logger.debug('Fetching default featured predictor ID');

    const predictor = await getOne(
      'SELECT predictor_id FROM predictors WHERE is_default_featured = 1 AND active = 1'
    );

    // If no default is set, use the first homepage available predictor
    if (!predictor) {
      const firstAvailable = await getOne(
        'SELECT predictor_id FROM predictors WHERE homepage_available = 1 AND active = 1 ORDER BY display_name LIMIT 1'
      );

      const defaultId = firstAvailable ? firstAvailable.predictor_id : null;
      logger.info(`No default featured predictor set, using first available: ${defaultId}`);
      return defaultId;
    }

    return predictor.predictor_id;
  } catch (error) {
    logger.error('Error fetching default featured predictor', { error: error.message });
    return null;
  }
}

// Get homepage available predictors with details
async function getHomepageAvailablePredictors() {
  try {
    logger.debug('Fetching homepage available predictors');

    const predictors = await getQuery(
      'SELECT predictor_id, name, display_name, is_default_featured FROM predictors WHERE homepage_available = 1 AND active = 1 ORDER BY display_name'
    );

    return predictors;
  } catch (error) {
    logger.error('Error fetching homepage available predictors', { error: error.message });
    return [];
  }
}

// Get the default featured predictor's details
async function getDefaultFeaturedPredictor() {
  try {
    const predictorId = await getDefaultFeaturedPredictorId();
    
    if (!predictorId) {
      logger.warn('No default featured predictor found');
      return null;
    }
    
    return await predictorService.getPredictorById(predictorId);
  } catch (error) {
    logger.error('Error fetching default featured predictor details', { error: error.message });
    return null;
  }
}

// Get predictions for a specific predictor for a specific round and year
async function getPredictionsForRound(predictorId, round, year) {
  try {
    if (!predictorId) {
      logger.warn('No predictor ID provided');
      return {
        predictor: null,
        matches: [],
        predictions: {}
      };
    }
    
    // Get predictor details
    const predictor = await predictorService.getPredictorById(predictorId);
    
    // Get matches for the round
    const matches = await matchService.getMatchesByRoundAndYear(round, year);
    
    // Get predictions for these matches
    const predictions = await predictionService.getPredictionsForUser(predictorId);
    
    // Create a map of match_id to prediction
    const predictionsMap = {};
    predictions.forEach(pred => {
      predictionsMap[pred.match_id] = {
        probability: pred.home_win_probability,
        tipped_team: pred.tipped_team || 'home',
        predicted_margin: pred.predicted_margin
      };
    });
    
    // Add accuracy metrics for completed matches
    const matchesWithMetrics = matches.map(match => {
      const result = { ...match };
      
      // If the match has a result and there's a prediction
      if (match.hscore !== null && match.ascore !== null && predictionsMap[match.match_id]) {
        const prediction = predictionsMap[match.match_id];
        const probability = prediction.probability;
        const tippedTeam = prediction.tipped_team;
        
        // Determine actual outcome
        const homeWon = match.hscore > match.ascore;
        const awayWon = match.hscore < match.ascore;
        const tie = match.hscore === match.ascore;
        const actualOutcome = homeWon ? 1 : (tie ? 0.5 : 0);
        
        // Calculate metrics
        const tipPoints = scoringService.calculateTipPoints(probability, match.hscore, match.ascore, tippedTeam);
        const brierScore = scoringService.calculateBrierScore(probability, actualOutcome);
        const bitsScore = scoringService.calculateBitsScore(probability, actualOutcome);
        
        result.metrics = {
          tipPoints,
          brierScore,
          bitsScore,
          correct: tipPoints === 1,
          incorrect: tipPoints === 0 && !tie,
          partial: tie
        };
      }
      
      return result;
    });
    
    return {
      predictor,
      matches: matchesWithMetrics,
      predictions: predictionsMap
    };
  } catch (error) {
    logger.error('Error fetching featured predictions', { 
      round,
      year,
      error: error.message 
    });
    throw new AppError('Failed to fetch featured predictions', 500, 'DATABASE_ERROR');
  }
}

// Get available years that have predictions for a specific predictor
async function getPredictionYearsForPredictor(predictorId) {
  try {
    if (!predictorId) {
      return [];
    }

    return await getQuery(
      `SELECT DISTINCT m.year
       FROM predictions p
       JOIN matches m ON p.match_id = m.match_id
       WHERE p.predictor_id = ?
       ORDER BY m.year DESC`,
      [predictorId]
    );
  } catch (error) {
    logger.error('Error fetching prediction years for predictor', {
      predictorId,
      error: error.message
    });
    return [];
  }
}

module.exports = {
  getHomepageAvailablePredictorIds,
  getDefaultFeaturedPredictorId,
  getHomepageAvailablePredictors,
  getDefaultFeaturedPredictor,
  getPredictionsForRound,
  getPredictionYearsForPredictor
};
