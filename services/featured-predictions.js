// services/featured-predictions.js
const { getQuery, getOne, runQuery } = require('../models/db');
const { AppError } = require('../utils/error-handler');
const { logger } = require('../utils/logger');
const matchService = require('./match-service');
const roundService = require('./round-service');
const predictionService = require('./prediction-service');
const predictorService = require('./predictor-service');
const scoringService = require('../services/scoring-service');

// Get the ID of the featured predictor
async function getFeaturedPredictorId() {
  try {
    logger.debug('Fetching featured predictor ID');
    
    const config = await getOne(
      'SELECT value FROM app_config WHERE key = ?',
      ['featured_predictor']
    );
    
    // Default to the first predictor if none is set
    if (!config) {
      const firstPredictor = await getOne(
        'SELECT predictor_id FROM predictors LIMIT 1'
      );
      
      const defaultId = firstPredictor ? firstPredictor.predictor_id : null;
      logger.info(`No featured predictor set, using default: ${defaultId}`);
      return defaultId;
    }
    
    return config.value;
  } catch (error) {
    logger.error('Error fetching featured predictor', { error: error.message });
    return null;
  }
}

// Get the featured predictor's details
async function getFeaturedPredictor() {
  try {
    const predictorId = await getFeaturedPredictorId();
    
    if (!predictorId) {
      logger.warn('No featured predictor found');
      return null;
    }
    
    return await predictorService.getPredictorById(predictorId);
  } catch (error) {
    logger.error('Error fetching featured predictor details', { error: error.message });
    return null;
  }
}

// Get predictions for the featured predictor for a specific round and year
async function getFeaturedPredictionsForRound(round, year) {
  try {
    const predictorId = await getFeaturedPredictorId();
    
    if (!predictorId) {
      logger.warn('No featured predictor found');
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

module.exports = {
  getFeaturedPredictorId,
  getFeaturedPredictor,
  getFeaturedPredictionsForRound
};